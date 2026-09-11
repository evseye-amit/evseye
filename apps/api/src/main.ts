import { ConfigService } from '@nestjs/config';
import type { Environment } from './config/environment.js';
import { createApplication } from './app.factory.js';

async function bootstrap() {
  const app = await createApplication();
  const config = app.get(ConfigService<Environment, true>);
  await app.listen({ port: config.getOrThrow('API_PORT'), host: '0.0.0.0' });
}
await bootstrap();
