import 'reflect-metadata';
import { UnauthorizedException, ValidationPipe, type ExecutionContext } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { UnifiedAutoPayController } from '../../src/payments/unified-autopay.controller.js';
import { UnifiedAutoPayService } from '../../src/payments/unified-autopay.service.js';
import { MandateService } from '../../src/payments/mandate.service.js';
import { ClientContextService } from '../../src/auth/client-context.service.js';
import { AccessTokenGuard } from '../../src/auth/guards/access-token.guard.js';
import { RolesGuard } from '../../src/auth/guards/roles.guard.js';
describe('unified AutoPay HTTP contract', () => {
  let app: NestFastifyApplication;
  const service = { current: vi.fn().mockResolvedValue({ enabled: false, revision: 0, effectiveStatus: 'OFF' }), set: vi.fn().mockResolvedValue({ enabled: true }), recharges: vi.fn().mockResolvedValue({ items: [], page: 1, hasMore: false }), prepareSetup: vi.fn() };
  const mandates = { create: vi.fn(), verify: vi.fn(), cancel: vi.fn() };
  const headers = { authorization: 'Bearer rider' };
  const base = '/api/v1/rider-app/autopay';
  beforeAll(async () => {
    const module = await Test.createTestingModule({ controllers: [UnifiedAutoPayController], providers: [ClientContextService, RolesGuard, { provide: UnifiedAutoPayService, useValue: service }, { provide: MandateService, useValue: mandates }] }).overrideGuard(AccessTokenGuard).useValue({ canActivate(context: ExecutionContext) {
      const request = context.switchToHttp().getRequest();
      if (!request.headers.authorization) throw new UnauthorizedException();
      request.user = { id: 'user', clientId: 'client', roles: [request.headers.authorization === 'Bearer admin' ? 'CLIENT_ADMIN' : 'RIDER'] };
      return true;
    } }).compile();
    app = module.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });
  afterAll(async () => app.close());
  it('requires rider authentication and returns the authoritative state envelope', async () => {
    expect((await app.inject({ method: 'GET', url: base })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: base, headers: { authorization: 'Bearer admin' } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: base, headers })).json()).toMatchObject({ data: { revision: 0, effectiveStatus: 'OFF' } });
    expect(service.current).toHaveBeenCalledWith('client', 'user');
  });
  it('requires optimistic revision and rejects caller-supplied ownership', async () => {
    expect((await app.inject({ method: 'PUT', url: base, headers, payload: { enabled: true } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'PUT', url: base, headers, payload: { enabled: false, expectedRevision: 0, riderId: 'other' } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'PUT', url: base, headers, payload: { enabled: false, expectedRevision: 0 } })).statusCode).toBe(200);
    expect(service.set).toHaveBeenCalledWith('client', 'user', expect.objectContaining({ enabled: false, expectedRevision: 0 }));
  });
  it('validates setup before changing collection mode and bounds recharge history', async () => {
    expect((await app.inject({ method: 'POST', url: `${base}/mandates`, headers, payload: { email: 'test@example.com' } })).statusCode).toBe(400);
    expect(service.prepareSetup).not.toHaveBeenCalled();
    expect((await app.inject({ method: 'GET', url: `${base}/recharges?page=0`, headers })).statusCode).toBe(400);
    expect((await app.inject({ method: 'GET', url: `${base}/recharges?page=1`, headers })).statusCode).toBe(200);
  });
});
