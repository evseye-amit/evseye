import { ClientResolverService } from './client-identity/client-resolver.service.js';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { AppModule } from './app.module.js';
import type { AuthUser } from './auth/interfaces/auth-user.interface.js';
import { HttpExceptionFilter } from './common/filters/http-exception.filter.js';
import { requestLocale } from './common/locale.js';
import type { Environment } from './config/environment.js';
import { completeSwaggerDocument, SWAGGER_TAGS } from './swagger.js';

export async function createApplication(): Promise<NestFastifyApplication> {
  const requestStartedAt = new WeakMap<FastifyRequest, number>();
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({
      logger: {
        redact: {
          paths: ['req.headers.authorization', 'req.headers.cookie', 'req.headers["x-client-proxy-secret"]'],
          remove: true,
        },
      },
    }),
    { rawBody: true },
  );
  const config = app.get(ConfigService<Environment, true>);
  const origins = config
    .getOrThrow<string>('CORS_ORIGINS')
    .split(',')
    .map((origin: string) => origin.trim());
  const swaggerSetting = config.get('SWAGGER_ENABLED');
  const swaggerEnabled = swaggerSetting === 'true' ||
    (swaggerSetting === undefined && config.get('NODE_ENV') !== 'production');

  await app.register(helmet as never, swaggerEnabled ? {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
      },
    },
  } : {});
  await app.register(cors as never, {
    credentials: false,
    origin: async (origin: string | undefined) => {
      if (!origin) return true;
      try {
        const url = new URL(origin);
        if (config.get('NODE_ENV') === 'production' && url.protocol !== 'https:') return false;
        if (!['https:', 'http:'].includes(url.protocol) || url.origin !== origin) return false;
        if (origins.includes(origin)) return true;
        return Boolean(await app.get(ClientResolverService).resolve(url.host));
      } catch { return false; }
    },
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  });
  const fastify = app.getHttpAdapter().getInstance() as FastifyInstance;
  fastify.addHook('onRequest', (request, reply, done) => {
    requestStartedAt.set(request, Date.now());
    reply.header('x-request-id', request.id);
    reply.header('Content-Language', requestLocale(request.headers['accept-language']));
    const vary = reply.getHeader('Vary');
    reply.header('Vary', vary ? `${vary}, Accept-Language` : 'Accept-Language');
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
  if (swaggerEnabled) {
    let swaggerBuilder = new DocumentBuilder()
      .setTitle('EVs Eye API')
      .setDescription('Endpoints are grouped by business area. Authenticate with an OTP endpoint, then use its access token with Authorize. Client endpoints use the client associated with that token. Rider and Fleet Manager apps can send Accept-Language: en, hi, te, or kn; responses include Content-Language. Machine-readable codes remain unchanged.')
      .setVersion('1.0')
      .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' })
      .addApiKey({ type: 'apiKey', in: 'header', name: 'x-device-secret' }, 'deviceSecret');
    for (const [name, description] of SWAGGER_TAGS) {
      swaggerBuilder = swaggerBuilder.addTag(name, description);
    }
    const swaggerConfig = swaggerBuilder.build();
    const document = completeSwaggerDocument(SwaggerModule.createDocument(app, swaggerConfig));
    SwaggerModule.setup('api/docs', app, document, {
      jsonDocumentUrl: 'api/docs-json',
      swaggerOptions: {
        persistAuthorization: true,
        tagsSorter: 'alpha',
        operationsSorter: 'alpha',
      },
    });
  }
  return app;
}
