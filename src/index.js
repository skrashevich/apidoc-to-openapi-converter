'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

function latestVersion(entries) {
  const versions = entries.map((e) => e.version).filter(Boolean);
  if (!versions.length) return '1.0.0';
  return versions.sort((a, b) => {
    const ap = a.split('.').map(Number);
    const bp = b.split('.').map(Number);
    for (let i = 0; i < Math.max(ap.length, bp.length); i++) {
      const av = ap[i] || 0;
      const bv = bp[i] || 0;
      if (av !== bv) return bv - av;
    }
    return 0;
  })[0];
}

function normalizePath(url) {
  return url.replace(/:([a-zA-Z0-9_]+)/g, '{$1}');
}

function stripHtml(text) {
  if (!text) return '';
  return text
    .replace(/<[^>]*>/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractStatusCode(label, fallback) {
  if (!label) return fallback;
  const match = String(label).match(/\b(\d{3})\b/);
  return match ? match[1] : fallback;
}

function mapSingleType(type) {
  if (!type) return { type: 'string' };
  const trimmed = type.trim();
  const arrayMatch = trimmed.endsWith('[]');
  if (arrayMatch) {
    const itemType = trimmed.slice(0, -2);
    return { type: 'array', items: mapSingleType(itemType) };
  }

  const slashIndex = trimmed.indexOf('/');
  if (slashIndex !== -1) {
    return mapSingleType(trimmed.slice(0, slashIndex));
  }

  const stringWithLength = trimmed.match(/string\[(\d+)\]/i);
  if (stringWithLength) {
    return { type: 'string', maxLength: Number(stringWithLength[1]) };
  }

  const lower = trimmed.toLowerCase();
  switch (lower) {
    case 'string':
      return { type: 'string' };
    case 'integer':
      return { type: 'integer' };
    case 'number':
      return { type: 'number' };
    case 'float':
    case 'double':
      return { type: 'number' };
    case 'boolean':
    case 'bool':
      return { type: 'boolean' };
    case 'object':
      return { type: 'object' };
    case 'array':
      return { type: 'array', items: {} };
    case 'buffer':
      return { type: 'string', format: 'binary' };
    default:
      return { type: 'object', description: `Original type: ${trimmed}` };
  }
}

function mapTypeToSchema(type) {
  if (!type) return { type: 'string' };
  const nullable = /\bnull\b/i.test(type);
  const parts = type.split('|').map((p) => p.trim()).filter(Boolean);
  const filtered = parts.filter((p) => !/^null$/i.test(p));

  if (filtered.length > 1) {
    const schema = { oneOf: filtered.map((p) => mapSingleType(p)) };
    if (nullable) schema.nullable = true;
    return schema;
  }

  const schema = mapSingleType(filtered[0] || type);
  if (nullable) schema.nullable = true;
  return schema;
}

function parseExample(content) {
  if (!content) return { status: null, body: null };
  const statusMatch = content.match(/HTTP\/1\.1\s+(\d{3})/i);
  const status = statusMatch ? statusMatch[1] : null;

  const lines = content.split('\n');
  if (statusMatch && /^HTTP\/1\.1/i.test(lines[0])) {
    lines.shift();
  }

  const bodyText = lines.join('\n').trim();
  if (!bodyText) return { status, body: null };

  const clean = bodyText.replace(/\t/g, '  ');
  try {
    return { status, body: JSON.parse(clean) };
  } catch (e) {
    return { status, body: clean };
  }
}

function ensureResponse(op, statusCode, description) {
  const status = statusCode || '200';
  if (!op.responses[status]) {
    op.responses[status] = { description: description || '' };
  } else if (!op.responses[status].description && description) {
    op.responses[status].description = description;
  }
  return op.responses[status];
}

function addResponsesFromFields(op, section, fallbackStatus, defaultDescription) {
  if (!section || !section.fields) return;
  for (const groupName of Object.keys(section.fields)) {
    const statusCode = extractStatusCode(groupName, fallbackStatus);
    const fields = section.fields[groupName];
    const properties = {};
    const required = [];

    for (const f of fields) {
      properties[f.field] = {
        ...mapTypeToSchema(f.type),
        ...(f.description ? { description: stripHtml(f.description) } : {})
      };
      if (!f.optional) required.push(f.field);
    }

    const response = ensureResponse(op, statusCode, defaultDescription);
    response.content = response.content || {};
    response.content['application/json'] = response.content['application/json'] || {};
    response.content['application/json'].schema = {
      type: 'object',
      properties,
      ...(required.length ? { required } : {})
    };
  }
}

function addExamples(op, section, fallbackStatus, defaultDescription) {
  if (!section || !section.examples) return;
  for (const ex of section.examples) {
    const parsed = parseExample(ex.content || '');
    const statusCode = parsed.status || extractStatusCode(ex.title, fallbackStatus) || fallbackStatus;
    const response = ensureResponse(op, statusCode, defaultDescription);
    if (parsed.body === null) continue;

    response.content = response.content || {};
    const media = response.content['application/json'] || {};
    if (media.example === undefined) {
      media.example = parsed.body;
    }
    response.content['application/json'] = media;
  }
}

function convertApiDocToOpenApi({ apiDataPath, apiDataJs, openapiInfo } = {}) {
  if (!apiDataJs) {
    if (!apiDataPath) throw new Error('convertApiDocToOpenApi: provide apiDataPath or apiDataJs');
    apiDataJs = fs.readFileSync(path.resolve(apiDataPath), 'utf8');
  }

  let apiObject = null;
  const sandbox = {
    define: (obj) => {
      apiObject = obj;
    },
    window: {}
  };

  vm.createContext(sandbox);
  vm.runInContext(apiDataJs, sandbox, { filename: apiDataPath || 'api_data.js' });

  if (!apiObject || !Array.isArray(apiObject.api)) {
    throw new Error('Cannot find api array in api_data.js');
  }

  const apiEntries = apiObject.api;
  const operationIdCounter = Object.create(null);
  const bodyMethods = new Set(['post', 'put', 'patch']);

  function sanitizeOperationId(base) {
    const normalized = (base || 'operation')
      .replace(/[^A-Za-z0-9_]+/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_+|_+$/g, '');
    const count = (operationIdCounter[normalized] || 0) + 1;
    operationIdCounter[normalized] = count;
    return count === 1 ? normalized : `${normalized}_${count}`;
  }

  const openapi = {
    openapi: '3.0.3',
    info: {
      title: 'API (converted from apiDoc)',
      version: latestVersion(apiEntries),
      description: 'This specification is automatically converted from apiDoc (api_data.js).',
      ...(openapiInfo || {})
    },
    paths: {},
    components: { schemas: {} }
  };

  for (const entry of apiEntries) {
    const method = (entry.type || 'get').toLowerCase();
    const rawPath = entry.url || '/unknown';
    const normalizedPath = normalizePath(rawPath);

    if (!openapi.paths[normalizedPath]) openapi.paths[normalizedPath] = {};
    if (openapi.paths[normalizedPath][method]) continue;

    const op = {
      tags: entry.group ? [entry.group] : undefined,
      summary: entry.title || entry.name || '',
      description: stripHtml(entry.description || ''),
      operationId: sanitizeOperationId(entry.name || `${method}_${normalizedPath}`),
      parameters: [],
      responses: {}
    };

    const bodyProperties = {};
    const bodyRequired = [];

    if (entry.parameter && entry.parameter.fields) {
      for (const groupName of Object.keys(entry.parameter.fields)) {
        const params = entry.parameter.fields[groupName];
        for (const p of params) {
          const inPath = rawPath.includes(`:${p.field}`) || normalizedPath.includes(`{${p.field}}`);
          const desc = stripHtml(p.description || '');
          const schema = mapTypeToSchema(p.type);

          if (inPath) {
            op.parameters.push({
              name: p.field,
              in: 'path',
              required: true,
              schema,
              description: desc
            });
          } else if (!bodyMethods.has(method)) {
            op.parameters.push({
              name: p.field,
              in: 'query',
              required: !p.optional,
              schema,
              description: desc
            });
          } else {
            bodyProperties[p.field] = { ...schema, ...(desc ? { description: desc } : {}) };
            if (!p.optional) bodyRequired.push(p.field);
          }
        }
      }
    }

    if (entry.header && entry.header.fields) {
      for (const groupName of Object.keys(entry.header.fields)) {
        const headers = entry.header.fields[groupName];
        for (const h of headers) {
          op.parameters.push({
            name: h.field,
            in: 'header',
            required: !h.optional,
            schema: mapTypeToSchema(h.type),
            description: stripHtml(h.description || '')
          });
        }
      }
    }

    if (op.parameters.length === 0) delete op.parameters;

    if (Object.keys(bodyProperties).length > 0) {
      op.requestBody = {
        required: bodyRequired.length > 0,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: bodyProperties,
              ...(bodyRequired.length ? { required: bodyRequired } : {})
            }
          }
        }
      };
    }

    const successDescription = stripHtml(entry.title || entry.name || 'Success');
    addResponsesFromFields(op, entry.success, '200', successDescription);
    addResponsesFromFields(op, entry.error, '400', stripHtml(entry.title || entry.name || 'Error'));
    addExamples(op, entry.success, '200', successDescription);
    addExamples(op, entry.error, '400', 'Error');

    if (Object.keys(op.responses).length === 0) {
      op.responses['200'] = { description: successDescription || 'Success' };
    }

    openapi.paths[normalizedPath][method] = op;
  }

  return JSON.stringify(openapi, null, 2);
}

module.exports = {
  convertApiDocToOpenApi
};

