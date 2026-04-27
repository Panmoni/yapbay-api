import { generateOpenApiDocument } from '../src/openapi';

process.stdout.write(JSON.stringify(generateOpenApiDocument(), null, 2));
