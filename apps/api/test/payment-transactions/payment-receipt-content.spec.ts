import 'reflect-metadata';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { ClientPaymentTransactionsController } from '../../src/payment-transactions/payment-transactions.controller.js';
import { PaymentTransactionsService } from '../../src/payment-transactions/payment-transactions.service.js';
import { ClientContextService } from '../../src/auth/client-context.service.js';
import { AccessTokenGuard } from '../../src/auth/guards/access-token.guard.js';
import { RolesGuard } from '../../src/auth/guards/roles.guard.js';
import { ROLES_KEY } from '../../src/auth/decorators/roles.decorator.js';

describe('receipt image response', () => {
  let app: NestFastifyApplication | undefined;
  afterAll(async () => { await app?.close(); });
  it('checks payment access before reading private bytes', async () => {
    const media = { paymentContent: vi.fn() };
    const service = new PaymentTransactionsService({} as never, media as never, {} as never);
    vi.spyOn(service, 'detail').mockRejectedValue(new Error('Payment not found'));
    await expect(service.receiptContent('client-a', { id: 'admin', clientId: 'client-a', roles: ['CLIENT_ADMIN'] }, 'DEPLOYMENT', 'payment', 'photo')).rejects.toThrow('Payment not found');
    expect(media.paymentContent).not.toHaveBeenCalled();
  });
  it('streams image bytes with private headers through the API rather than redirecting to storage', async () => {
    expect(Reflect.getMetadata(ROLES_KEY, ClientPaymentTransactionsController)).toEqual(['CLIENT_ADMIN']);
    const receiptContent = vi.fn().mockResolvedValue({ bytes: Buffer.from([137, 80, 78, 71]), mimeType: 'image/png', filename: 'receipt.png' });
    const module = await Test.createTestingModule({ controllers: [ClientPaymentTransactionsController], providers: [
      { provide: PaymentTransactionsService, useValue: { receiptContent } },
      { provide: ClientContextService, useValue: { requireClientId: () => 'client-a' } },
    ] }).overrideGuard(AccessTokenGuard).useValue({ canActivate: (context: { switchToHttp: () => { getRequest: () => { user?: unknown } } }) => { context.switchToHttp().getRequest().user = { id: 'admin', roles: ['CLIENT_ADMIN'] }; return true; } }).overrideGuard(RolesGuard).useValue({ canActivate: () => true }).compile();
    app = module.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.init(); await app.getHttpAdapter().getInstance().ready();
    const response = await app.inject({ method: 'GET', url: '/client/payment-transactions/DEPLOYMENT/00000000-0000-4000-a000-000000000001/receipts/00000000-0000-4000-a000-000000000002/content' });
    expect(response.statusCode).toBe(200);
    expect(response.rawPayload).toEqual(Buffer.from([137, 80, 78, 71]));
    expect(response.headers['content-type']).toBe('image/png');
    expect(response.headers['cache-control']).toContain('no-store');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['location']).toBeUndefined();
    expect(receiptContent).toHaveBeenCalledWith('client-a', expect.objectContaining({ id: 'admin' }), 'DEPLOYMENT', '00000000-0000-4000-a000-000000000001', '00000000-0000-4000-a000-000000000002');
  });
});
