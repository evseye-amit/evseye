import 'reflect-metadata';
import {
  UnauthorizedException,
  ValidationPipe,
  type ExecutionContext,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from '@nestjs/platform-fastify';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { DeploymentAutoPayPolicyController } from '../../src/payments/deployment-autopay-policy.controller.js';
import { DeploymentAutoPayPolicyService } from '../../src/payments/deployment-autopay-policy.service.js';
import { ClientContextService } from '../../src/auth/client-context.service.js';
import { AccessTokenGuard } from '../../src/auth/guards/access-token.guard.js';
import { RolesGuard } from '../../src/auth/guards/roles.guard.js';

describe('Client onboarding AutoPay HTTP policy', () => {
  let app: NestFastifyApplication;
  const service = {
    get: vi.fn(async () => ({ enabled: false })),
    set: vi.fn(async () => ({ enabled: true })),
    history: vi.fn(async () => ({ items: [] })),
  };
  const url = '/api/v1/client/deployment-autopay-policy';
  const headers = { authorization: 'Bearer admin' };
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [DeploymentAutoPayPolicyController],
      providers: [
        ClientContextService,
        RolesGuard,
        { provide: DeploymentAutoPayPolicyService, useValue: service },
      ],
    })
      .overrideGuard(AccessTokenGuard)
      .useValue({
        canActivate(context: ExecutionContext) {
          const req = context.switchToHttp().getRequest();
          if (!req.headers.authorization) throw new UnauthorizedException();
          req.user = {
            id: 'admin',
            clientId:
              req.headers.authorization === 'Bearer unscoped'
                ? null
                : 'client-a',
            roles: [
              req.headers.authorization === 'Bearer rider'
                ? 'RIDER'
                : 'CLIENT_ADMIN',
            ],
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
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });
  beforeEach(() => vi.clearAllMocks());
  afterAll(async () => {
    await app?.close();
  });
  it('rejects anonymous, non-admin and unscoped callers for reads and writes', async () => {
    for (const [authorization, status] of [
      [undefined, 401],
      ['Bearer rider', 403],
      ['Bearer unscoped', 403],
    ] as const) {
      for (const method of ['GET', 'PUT'] as const) {
        expect(
          (
            await app.inject({
              method,
              url,
              headers: authorization ? { authorization } : {},
              ...(method === 'PUT'
                ? { payload: { enabled: true, revision: 0 } }
                : {}),
            })
          ).statusCode,
        ).toBe(status);
      }
    }
    expect(service.get).not.toHaveBeenCalled();
    expect(service.set).not.toHaveBeenCalled();
  });
  it('uses the session client and rejects client ID injection and malformed writes', async () => {
    expect(
      (
        await app.inject({
          method: 'PUT',
          url,
          headers,
          payload: { enabled: true, revision: 0 },
        })
      ).statusCode,
    ).toBe(200);
    expect(service.set).toHaveBeenCalledWith('client-a', 'admin', {
      enabled: true,
      revision: 0,
    });
    for (const payload of [
      { enabled: true, revision: 0, clientId: 'client-b' },
      { enabled: 'true', revision: 0 },
      { enabled: true, revision: -1 },
      { enabled: true },
    ]) {
      expect(
        (await app.inject({ method: 'PUT', url, headers, payload })).statusCode,
      ).toBe(400);
    }
    expect(service.set).toHaveBeenCalledTimes(1);
  });
  it('scopes history and validates pagination', async () => {
    expect(
      (
        await app.inject({
          method: 'GET',
          url: `${url}/history?page=2`,
          headers,
        })
      ).statusCode,
    ).toBe(200);
    expect(service.history).toHaveBeenCalledWith('client-a', 2);
    for (const page of ['0', '-1', '1.5', '100001'])
      expect(
        (
          await app.inject({
            method: 'GET',
            url: `${url}/history?page=${page}`,
            headers,
          })
        ).statusCode,
      ).toBe(400);
  });
});
