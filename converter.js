const path = require('path');
const { convertApiDocToOpenApi } = require('./src/index');

if (process.argv.length < 3) {
  console.error('Usage: node converter.js <api_data.js> [output.json]');
  process.exit(1);
}

const apiDataPath = path.resolve(process.argv[2]);
const outputPath = process.argv[3] ? path.resolve(process.argv[3]) : null;
const output = convertApiDocToOpenApi({ apiDataPath });

if (outputPath) {
  const fs = require('fs');
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, output);
  console.error(`OpenAPI spec written to ${outputPath}`);
} else {
  console.log(output);
}

