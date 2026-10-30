import { readdir, readFile, writeFile } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import { Logger } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { createApplication } from '../dist/app.factory.js';
import { completeSwaggerDocument, SWAGGER_TAGS } from '../dist/swagger.js';

Logger.overrideLogger(false);

async function findTypeScriptFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) => {
      const path = resolve(directory, entry.name);
      return entry.isDirectory()
        ? findTypeScriptFiles(path)
        : entry.isFile() && path.endsWith('.ts')
          ? [path]
          : [];
    }),
  );
  return nested.flat();
}

const sourceRoot = resolve('src');
const controllerFiles = new Map();
for (const file of await findTypeScriptFiles(sourceRoot)) {
  const source = await readFile(file, 'utf8');
  for (const [, className] of source.matchAll(/export\s+class\s+(\w+)/g)) {
    controllerFiles.set(className, `apps/api/${relative(process.cwd(), file)}`);
  }
}

const app = await createApplication();

try {
  let builder = new DocumentBuilder()
    .setTitle('EVs Eye API')
    .setDescription(
      'Endpoints are grouped by business area. Authenticate with an OTP endpoint, then use its access token with Authorize. Client endpoints use the client associated with that token. Rider and Fleet Manager apps can send Accept-Language: en, hi, te, or kn; responses include Content-Language. Machine-readable codes remain unchanged.',
    )
    .setVersion('1.0')
    .addBearerAuth({
      type: 'http',
      scheme: 'bearer',
      bearerFormat: 'JWT',
    })
    .addApiKey(
      { type: 'apiKey', in: 'header', name: 'x-device-secret' },
      'deviceSecret',
    );

  for (const [name, description] of SWAGGER_TAGS) {
    builder = builder.addTag(name, description);
  }

  const document = completeSwaggerDocument(
    SwaggerModule.createDocument(app, builder.build(), {
      operationIdFactory: (controller, method) => `${controller}_${method}`,
    }),
  );
  const operations = Object.entries(document.paths)
    .flatMap(([path, pathItem]) =>
      Object.entries(pathItem ?? {})
        .filter(([method]) =>
          ['get', 'post', 'put', 'patch', 'delete'].includes(method),
        )
        .map(([method, operation]) => {
          const operationId = operation.operationId;
          const controllerClass = [...controllerFiles.keys()]
            .sort((left, right) => right.length - left.length)
            .find((name) => operationId?.startsWith(`${name}_`));
          const controllerFile = controllerClass
            ? controllerFiles.get(controllerClass)
            : undefined;
          if (!controllerFile) {
            throw new Error(`Could not map OpenAPI operation to source: ${operationId}`);
          }
          return {
            method: method.toUpperCase(),
            path,
            operationId,
            controllerClass,
            controllerFile,
            tags: operation.tags ?? [],
            security: operation.security ?? [],
          };
        }),
    )
    .sort((left, right) =>
      `${left.path} ${left.method}`.localeCompare(
        `${right.path} ${right.method}`,
      ),
    );

  const output = `${JSON.stringify(operations, null, 2)}\n`;
  const outputPath = process.argv[2];
  if (outputPath) {
    await writeFile(resolve(outputPath), output);
    console.error(`Wrote ${operations.length} operations to ${resolve(outputPath)}`);
  } else {
    process.stdout.write(output);
  }
} finally {
  await app.close();
}
