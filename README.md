# apidoc-to-openapi-converter

This project provides a Node.js script to convert API documentation written in [apiDoc](https://apidocjs.com/) format into the [OpenAPI](https://www.openapis.org/) specification. Use this tool to migrate existing apiDoc documentation to the widely adopted OpenAPI standard and integrate with tools like Swagger UI or OpenAPI code generators.

## Features
- Parses apiDoc-generated documentation and maps endpoints, parameters and responses to an OpenAPI 3 specification.
- Outputs a single JSON file containing your API definition.

## Prerequisites
- **Node.js** installed on your system.
- The [apiDoc](https://apidocjs.com/) tool installed to generate the intermediate apiDoc output.

## Usage
1. Generate your apiDoc documentation as JSON by running apiDoc on your source files:
   ```bash
   apidoc -i <source-code-folder> -o apidoc_output
   ```
   This produces a file called `api_data.js` inside the `apidoc_output` directory containing the extracted API information.
2. Run the converter on the `api_data.js` file and redirect the result to an OpenAPI file:
   ```bash
   node converter.js apidoc_output/api_data.js > openapi.json
   ```
3. Open `openapi.json` with an OpenAPI-compatible tool (e.g. Swagger UI) to view or further process the specification.

## Install (npm)

Global install (recommended for CLI):

```bash
npm i -g apidoc-to-openapi-converter
apidoc-to-openapi apidoc_output/api_data.js > openapi.json
```

Without global install:

```bash
npx -p apidoc-to-openapi-converter apidoc-to-openapi apidoc_output/api_data.js > openapi.json
```

## Programmatic usage

```js
const { convertApiDocToOpenApi } = require('apidoc-to-openapi-converter');
const openapiJson = convertApiDocToOpenApi({ apiDataPath: 'apidoc_output/api_data.js' });
```

## Contributing
Contributions are welcome! If you find a bug or have ideas for improvements, please open an issue or submit a pull request.

## License
This project currently does not include a license file. Feel free to suggest an appropriate license via a pull request.
