import 'reflect-metadata';
import { UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { CommonPaymentController } from '../../src/payments/common-payment.controller.js';
import { CommonPaymentService } from '../../src/payments/common-payment.service.js';
import { ClientContextService } from '../../src/auth/client-context.service.js';
import { AccessTokenGuard } from '../../src/auth/guards/access-token.guard.js';
import { RolesGuard } from '../../src/auth/guards/roles.guard.js';

describe('mobile payment HTTP contract', () => {
  let app: NestFastifyApplication;
  const payment = { paymentRequestId: 'collection:00000000-0000-4000-a000-000000000001', provider: 'RAZORPAY', status: 'PENDING', checkout: { type: 'RAZORPAY', orderId: 'order_test', keyId: 'rzp_test_public', amountPaise: 50000 }, currency: 'INR', amount: '500.00' };
  const service = {
    pending: vi.fn().mockResolvedValue([payment]),
    abandon: vi.fn().mockResolvedValue({ ...payment, status: 'CANCELLED', checkout: null }),
    capabilities: vi.fn().mockResolvedValue({ contractVersion: 1, availabilityBasis: 'POLICY', connectivityVerified: false, purposes: {} }),
    create: vi.fn().mockResolvedValue(payment), detail: vi.fn().mockResolvedValue(payment),
    verify: vi.fn().mockResolvedValue({ ...payment, status: 'SUCCEEDED', checkout: null }),
    reconcile: vi.fn().mockResolvedValue({ ...payment, status: 'SUCCEEDED', checkout: null }),
  };
  const auth = { authorization: 'Bearer rider' };
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [CommonPaymentController],
      providers: [{ provide: CommonPaymentService, useValue: service }, ClientContextService, RolesGuard],
    }).overrideGuard(AccessTokenGuard).useValue({
      canActivate(context: ExecutionContext) {
        const request = context.switchToHttp().getRequest();
        if (!request.headers.authorization) throw new UnauthorizedException();
        request.user = { id: 'user-a', clientId: request.headers.authorization === 'Bearer unscoped' ? null : 'client-a', roles: [request.headers.authorization === 'Bearer admin' ? 'CLIENT_ADMIN' : 'RIDER'] };
        return true;
      },
    }).compile();
    app = module.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.setGlobalPrefix('api/v1');
    await app.init(); await app.getHttpAdapter().getInstance().ready();
  });
  beforeEach(() => vi.clearAllMocks());
  afterAll(async () => { await app?.close(); });
  it('rejects missing authentication, wrong roles and identities without a client', async () => {
    const url = '/api/v1/rider-app/payments/orders/capabilities';
    expect((await app.inject({ method: 'GET', url })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url, headers: { authorization: 'Bearer admin' } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url, headers: { authorization: 'Bearer unscoped' } })).statusCode).toBe(403);
    expect(service.capabilities).not.toHaveBeenCalled();
  });
  it('keeps capabilities distinct from opaque payment IDs and returns a data envelope', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/rider-app/payments/orders/capabilities', headers: auth });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ data: { contractVersion: 1, availabilityBasis: 'POLICY', connectivityVerified: false } });
    expect(service.capabilities).toHaveBeenCalledWith('client-a', 'user-a');
    expect(service.detail).not.toHaveBeenCalled();
  });
  it('exposes authenticated pending lookup and explicit local abandonment', async () => {
    const base = '/api/v1/rider-app/payments/orders';
    expect((await app.inject({ method: 'GET', url: `${base}/pending`, headers: auth })).json()).toEqual({ data: [payment] });
    expect(service.pending).toHaveBeenCalledWith('client-a', 'user-a');
    expect(service.detail).not.toHaveBeenCalled();
    const response = await app.inject({ method: 'POST', url: `${base}/${encodeURIComponent(payment.paymentRequestId)}/abandon`, headers: auth });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ data: { status: 'CANCELLED', checkout: null } });
    expect(service.abandon).toHaveBeenCalledWith('client-a', 'user-a', payment.paymentRequestId);
    expect((await app.inject({ method: 'POST', url: `${base}/${payment.paymentRequestId}/abandon` })).statusCode).toBe(401);
  });
  it('preserves old create calls and forwards stable idempotency headers for new clients', async () => {
    const url = '/api/v1/rider-app/payments/orders';
    const payload = { purpose: 'SUBMISSION_PENALTY' };
    const old = await app.inject({ method: 'POST', url, headers: auth, payload });
    expect(old.statusCode).toBe(200);
    expect(old.json()).toEqual({ data: payment });
    expect(service.create).toHaveBeenLastCalledWith('client-a', 'user-a', payload, undefined);
    await app.inject({ method: 'POST', url, headers: { ...auth, 'Idempotency-Key': 'request-key-1' }, payload });
    expect(service.create).toHaveBeenLastCalledWith('client-a', 'user-a', payload, 'request-key-1');
  });
  it('decodes opaque IDs and recovers with authenticated ownership without an SDK callback', async () => {
    const url = `/api/v1/rider-app/payments/orders/${encodeURIComponent(payment.paymentRequestId)}`;
    expect((await app.inject({ method: 'GET', url, headers: auth })).json()).toEqual({ data: payment });
    const result = await app.inject({ method: 'POST', url: `${url}/reconcile`, headers: auth, payload: {} });
    expect(result.statusCode).toBe(200);
    expect(result.json()).toMatchObject({ data: { status: 'SUCCEEDED', checkout: null } });
    expect(service.reconcile).toHaveBeenCalledWith('client-a', 'user-a', payment.paymentRequestId);
    expect(service.create).not.toHaveBeenCalled();
    expect(service.verify).not.toHaveBeenCalled();
  });
});
