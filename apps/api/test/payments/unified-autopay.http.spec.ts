import { ConfigService } from '@nestjs/config';
import { WalletAutoRechargeService } from '../../src/payments/wallet-auto-recharge.service.js';
import 'reflect-metadata';
import { UnauthorizedException, ValidationPipe, type ExecutionContext } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { UnifiedAutoPayController, UnifiedAutoPayPolicyController, UnifiedAutoPayOperationsController } from '../../src/payments/unified-autopay.controller.js';
import { UnifiedAutoPayService } from '../../src/payments/unified-autopay.service.js';
import { MandateService } from '../../src/payments/mandate.service.js';
import { ClientContextService } from '../../src/auth/client-context.service.js';
import { AccessTokenGuard } from '../../src/auth/guards/access-token.guard.js';
import { RolesGuard } from '../../src/auth/guards/roles.guard.js';
describe('unified AutoPay HTTP contract', () => {
  let app: NestFastifyApplication;
  const service = { current: vi.fn().mockResolvedValue({ enabled: false, revision: 0, effectiveStatus: 'OFF' }), set: vi.fn().mockResolvedValue({ enabled: true }), recharges: vi.fn().mockResolvedValue({ items: [], page: 1, hasMore: false }), prepareSetup: vi.fn() };
  const funding = { policy: vi.fn().mockResolvedValue({ enabled: false, revision: 0, threshold: '550.00', rechargeAmount: '750.00' }), setPolicy: vi.fn().mockResolvedValue({ enabled: true }), policyHistory: vi.fn().mockResolvedValue({ items: [], hasMore: false }), list: vi.fn().mockResolvedValue({ items: [], hasMore: false }), verifyForClient: vi.fn().mockResolvedValue({ status: 'PENDING' }) };
  const mandates = { create: vi.fn(), verify: vi.fn(), cancel: vi.fn() };
  const headers = { authorization: 'Bearer rider' };
  const base = '/api/v1/rider-app/autopay';
  beforeAll(async () => {
    const module = await Test.createTestingModule({ controllers: [UnifiedAutoPayController, UnifiedAutoPayPolicyController, UnifiedAutoPayOperationsController], providers: [ClientContextService, RolesGuard, { provide: ConfigService, useValue: new ConfigService({}) }, { provide: WalletAutoRechargeService, useValue: funding }, { provide: UnifiedAutoPayService, useValue: service }, { provide: MandateService, useValue: mandates }] }).overrideGuard(AccessTokenGuard).useValue({ canActivate(context: ExecutionContext) {
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
  it('accepts a simple enable action and email-only setup, rejecting removed consent fields', async () => {
    expect((await app.inject({ method: 'PUT', url: base, headers, payload: { enabled: true, expectedRevision: 0 } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'PUT', url: base, headers, payload: { enabled: true, expectedRevision: 0, consentVersion: 'unified-autopay-v1' } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: `${base}/mandates`, headers: { ...headers, 'idempotency-key': 'setup-key-123' }, payload: { email: 'rider@example.com' } })).statusCode).toBe(201);
    expect(mandates.create).toHaveBeenCalledWith('client', 'user', 'setup-key-123', 'UPI_AUTOPAY', 'rider@example.com', true);
    service.prepareSetup.mockClear();
  });
  it('validates setup before changing collection mode and bounds recharge history', async () => {
    expect((await app.inject({ method: 'POST', url: `${base}/mandates`, headers, payload: { email: 'test@example.com' } })).statusCode).toBe(400);
    expect(service.prepareSetup).not.toHaveBeenCalled();
    expect((await app.inject({ method: 'GET', url: `${base}/recharges?page=0`, headers })).statusCode).toBe(400);
    expect((await app.inject({ method: 'GET', url: `${base}/recharges?page=1`, headers })).statusCode).toBe(200);
  });
  it.each([
    ['GET', '/api/v1/rider-app/payments/autopay'],
    ['POST', '/api/v1/rider-app/payments/autopay'],
    ['POST', '/api/v1/rider-app/payments/autopay/enable'],
    ['POST', '/api/v1/rider-app/payments/autopay/disable'],
    ['GET', '/api/v1/rider-app/payments/autopay/upcoming'],
    ['GET', '/api/v1/rider-app/payments/autopay/debits'],
    ['POST', '/api/v1/rider-app/payments/autopay/id/verify'],
    ['POST', '/api/v1/rider-app/payments/autopay/id/cancel'],
    ['POST', '/api/v1/rider-app/payments/autopay/id/pause'],
    ['POST', '/api/v1/rider-app/payments/autopay/id/resume'],
    ['GET', '/api/v1/rider-app/wallet/autopay'],
    ['PUT', '/api/v1/rider-app/wallet/autopay'],
    ['GET', '/api/v1/client/wallet-autopay-policy'],
    ['PUT', '/api/v1/client/wallet-autopay-policy'],
    ['GET', '/api/v1/client/wallet-autopay-policy/requests'],
    ['POST', '/api/v1/client/wallet-autopay-policy/requests/id/verify'],
    ['GET', '/api/v1/client/wallet-autopay-policy/history'],
    ['GET', '/api/v1/client/deployment-autopay-policy'],
    ['PUT', '/api/v1/client/deployment-autopay-policy'],
    ['GET', '/api/v1/client/deployment-autopay-policy/history'],
  ] as const)('retires %s %s without an alias', async (method, url) => {
    expect((await app.inject({ method, url, headers })).statusCode).toBe(404);
  });
  it('keeps one tenant-scoped admin policy and recharge operations API', async () => {
    const admin = { authorization: 'Bearer admin' };
    const policy = '/api/v1/client/autopay/policy', recharges = '/api/v1/client/autopay/recharges';
    expect((await app.inject({ method: 'GET', url: policy, headers })).statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: recharges, headers })).statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: policy, headers: admin })).statusCode).toBe(200);
    expect((await app.inject({ method: 'PUT', url: policy, headers: admin, payload: { enabled: true, threshold: '550.00', rechargeAmount: '750.00', revision: 0 } })).statusCode).toBe(200);
    expect(funding.setPolicy).toHaveBeenCalledWith('client', 'user', expect.objectContaining({ enabled: true, revision: 0 }));
    expect((await app.inject({ method: 'GET', url: `${recharges}?page=0`, headers: admin })).statusCode).toBe(400);
    expect((await app.inject({ method: 'GET', url: `${recharges}?page=2`, headers: admin })).statusCode).toBe(200);
    expect(funding.list).toHaveBeenCalledWith('client', 2);
    expect((await app.inject({ method: 'POST', url: `${recharges}/request-id/verify`, headers: admin })).statusCode).toBe(201);
    expect(funding.verifyForClient).toHaveBeenCalledWith('client', 'request-id');
  });

});
