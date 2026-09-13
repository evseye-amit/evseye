import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { AppModule } from './app.module.js';
import type { AuthUser } from './auth/interfaces/auth-user.interface.js';
import { HttpExceptionFilter } from './common/filters/http-exception.filter.js';
import type { Environment } from './config/environment.js';

export async function createApplication(): Promise<NestFastifyApplication> {
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

  await app.register(helmet as never);
  await app.register(cors as never, {
    credentials: true,
    origin: origins,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
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
      clientId: user?.clientId,
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
  return app;
}
