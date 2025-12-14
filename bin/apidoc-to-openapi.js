#!/usr/bin/env node
'use strict';

const path = require('path');
const { convertApiDocToOpenApi } = require('../src/index');

function printHelp() {
  process.stderr.write(
    [
      'Usage:',
      '  apidoc-to-openapi <path/to/api_data.js> [output.json]',
      '',
      'Examples:',
      '  apidoc-to-openapi apidoc_output/api_data.js > openapi.json',
      '  apidoc-to-openapi apidoc_output/api_data.js openapi.json',
      ''
    ].join('\n')
  );
}

const args = process.argv.slice(2);
if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
  printHelp();
  process.exit(args.length === 0 ? 1 : 0);
}

const apiDataPath = path.resolve(args[0]);
const outputPath = args[1] ? path.resolve(args[1]) : null;

try {
  const output = convertApiDocToOpenApi({ apiDataPath });
  if (outputPath) {
    require('fs').mkdirSync(path.dirname(outputPath), { recursive: true });
    require('fs').writeFileSync(outputPath, output);
    process.stderr.write(`OpenAPI spec written to ${outputPath}\n`);
  } else {
    process.stdout.write(output + '\n');
  }
} catch (err) {
  process.stderr.write((err && err.stack) ? String(err.stack) : String(err));
  process.stderr.write('\n');
  process.exit(1);
}

