import 'reflect-metadata';
import {
  Controller,
  Get,
  UseGuards,
  ValidationPipe,
  UnauthorizedException,
  type ExecutionContext,
} from '@nestjs/common';
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import { AccessTokenGuard } from '../../src/auth/guards/access-token.guard.js';
import { RolesGuard } from '../../src/auth/guards/roles.guard.js';
import { ClientResolverService } from '../../src/client-identity/client-resolver.service.js';
import {
  AppUpdateAdminController,
  AuthenticatedAppUpdateController,
  PublicAppUpdateController,
} from '../../src/app-updates/app-update.controller.js';
import { AppUpdateService } from '../../src/app-updates/app-update.service.js';
import { AppUpdateInterceptor } from '../../src/app-updates/app-update.interceptor.js';
import { HttpExceptionFilter } from '../../src/common/filters/http-exception.filter.js';

@Controller('test-mobile')
@UseGuards(AccessTokenGuard)
class MobileProbeController {
  @Get() read() {
    return { data: 'handler reached' };
  }
}
describe('app update HTTP boundary', () => {
  let app: NestFastifyApplication;
  const check = vi
    .fn()
    .mockResolvedValue({
      decision: 'required_update',
      message: 'Update required.',
      policyRevision: 2,
    });
  const service = {
    check,
    clientForCode: vi.fn().mockResolvedValue('client-a'),
    list: vi.fn().mockResolvedValue([]),
  };
  const identity = {
    appCode: 'RIDER_APP',
    platform: 'ANDROID',
    applicationId: 'com.example.rider',
    channel: 'PRODUCTION',
    installed: { version: '1.0.0', build: '1' },
  };
  const metadata = {
    'x-app-code': 'RIDER_APP',
    'x-app-platform': 'ANDROID',
    'x-app-id': 'com.example.rider',
    'x-app-channel': 'PRODUCTION',
    'x-app-version': '1.0.0',
    'x-app-build': '1',
  };
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [
        AppUpdateAdminController,
        AuthenticatedAppUpdateController,
        PublicAppUpdateController,
        MobileProbeController,
      ],
      providers: [
        { provide: AppUpdateService, useValue: service },
        {
          provide: ClientResolverService,
          useValue: { fromRequest: vi.fn().mockResolvedValue(null) },
        },
        RolesGuard,
      ],
    })
      .overrideGuard(AccessTokenGuard)
      .useValue({
        canActivate: (context: ExecutionContext) => {
          const request = context.switchToHttp().getRequest();
          if (!request.headers.authorization) throw new UnauthorizedException();
          const admin = request.headers.authorization === 'Bearer admin';
          request.user = {
            id: admin ? 'admin' : 'rider',
            clientId: admin ? null : 'client-a',
            roles: [admin ? 'SUPER_ADMIN' : 'RIDER'],
          };
          return true;
        },
      })
      .compile();
    app = module.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
    );
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    );
    app.useGlobalFilters(new HttpExceptionFilter());
    app.useGlobalInterceptors(new AppUpdateInterceptor(service as never));
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });
  afterAll(async () => {
    await app?.close();
  });
  it('allows prelogin checks, validates nested metadata, and disables HTTP caching', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/public/app-updates/check',
      payload: { ...identity, companyCode: 'example' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().data.decision).toBe('required_update');
    expect(response.headers['cache-control']).toBe('no-store');
    const malformed = await app.inject({
      method: 'POST',
      url: '/api/v1/public/app-updates/check',
      payload: {
        ...identity,
        companyCode: 'example',
        installed: { version: 'bad', build: '1' },
      },
    });
    expect(malformed.statusCode).toBe(400);
  });
  it('requires authentication and SUPER_ADMIN for management', async () => {
    const url = '/api/v1/platform/clients/client-a/app-updates';
    expect((await app.inject({ method: 'GET', url })).statusCode).toBe(401);
    expect(
      (
        await app.inject({
          method: 'GET',
          url,
          headers: { authorization: 'Bearer rider' },
        })
      ).statusCode,
    ).toBe(403);
    const allowed = await app.inject({
      method: 'GET',
      url,
      headers: { authorization: 'Bearer admin' },
    });
    expect(allowed.statusCode).toBe(200);
    expect(allowed.json()).toEqual({ data: [] });
  });
  it('rejects caller-supplied client IDs and allows authenticated checks while outdated', async () => {
    const url = '/api/v1/app-updates/check',
      headers = { ...metadata, authorization: 'Bearer rider' };
    expect(
      (
        await app.inject({
          method: 'POST',
          url,
          headers,
          payload: { ...identity, clientId: 'client-b' },
        })
      ).statusCode,
    ).toBe(400);
    const response = await app.inject({
      method: 'POST',
      url,
      headers,
      payload: identity,
    });
    expect(response.statusCode).toBe(200);
    expect(check).toHaveBeenLastCalledWith(
      'client-a',
      expect.objectContaining({ appCode: 'RIDER_APP' }),
    );
  });
  it('blocks protected requests with the 426 contract but permits legacy requests', async () => {
    const url = '/api/v1/test-mobile';
    const blocked = await app.inject({
      method: 'GET',
      url,
      headers: { ...metadata, authorization: 'Bearer rider' },
    });
    expect(blocked.statusCode).toBe(426);
    expect(blocked.headers['cache-control']).toBe('no-store');
    expect(blocked.json().error).toMatchObject({
      code: 'APP_UPDATE_REQUIRED',
      issues: [{ decision: 'required_update', policyRevision: 2 }],
    });
    const legacy = await app.inject({
      method: 'GET',
      url,
      headers: { authorization: 'Bearer rider' },
    });
    expect(legacy.statusCode).toBe(200);
    expect(legacy.json().data).toBe('handler reached');
  });
});
