import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { AppModule } from './app.module.js';
import type { AuthUser } from './auth/interfaces/auth-user.interface.js';
import { HttpExceptionFilter } from './common/filters/http-exception.filter.js';
import type { Environment } from './config/environment.js';

async function bootstrap() {
  const requestStartedAt = new WeakMap<FastifyRequest, number>();
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({
      logger: {
        redact: {
          paths: ['req.headers.authorization', 'req.headers.cookie'],
          remove: true,
        },
      },
    }),
  );
  const config = app.get(ConfigService<Environment, true>);
  const origins = config
    .getOrThrow<string>('CORS_ORIGINS')
    .split(',')
    .map((origin: string) => origin.trim());

  // Fastify plugin types can resolve through a separate pnpm peer graph even
  // when all packages target Fastify v5. Runtime compatibility is guaranteed
  // by the pinned Fastify major version in this workspace.
  await app.register(helmet as never);
  await app.register(cors as never, {
    credentials: true,
    origin: origins,
  });
  const fastify = app.getHttpAdapter().getInstance() as FastifyInstance;
  fastify.addHook('onRequest', (request, reply, done) => {
    requestStartedAt.set(request, Date.now());
    reply.header('x-request-id', request.id);
    done();
  });
  fastify.addHook('onResponse', (request, reply, done) => {
    const user = (request as FastifyRequest & { user?: AuthUser }).user;
    request.log.info({
      event: 'request_completed',
      requestId: request.id,
      tenantId: user?.tenantId,
      userId: user?.id,
      endpoint: request.routeOptions.url,
      method: request.method,
      statusCode: reply.statusCode,
      durationMs: Date.now() - (requestStartedAt.get(request) ?? Date.now()),
    });
    done();
  });
  app.setGlobalPrefix('api/v1', { exclude: ['health', 'health/ready'] });
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );
  app.useGlobalFilters(new HttpExceptionFilter());

  await app.listen({ port: config.getOrThrow('API_PORT'), host: '0.0.0.0' });
}
await bootstrap();
