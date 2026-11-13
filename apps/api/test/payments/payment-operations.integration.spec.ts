import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { createTestPrisma } from '../helpers/prisma-client.js';
import { ProviderSettlementService, type SettlementImport } from '../../src/payments/provider-settlement.service.js';
import { PaymentReconciliationService } from '../../src/payments/payment-reconciliation.service.js';

const url = process.env.PAYMENT_CONFIGURATION_TEST_DATABASE_URL;
if (url && !new URL(url).pathname.includes('_test_')) throw new Error('Use a disposable _test_ database.');
const db = createTestPrisma(url ?? 'postgresql://unused:unused@localhost:5432/unused');
afterAll(() => db.$disconnect());
describe.skipIf(!url)('Payment operations with PostgreSQL', () => {
  it('reaches older collection records and labels riders without crossing clients', async () => {
    const client = await db.client.create({ data: { name: 'History test', slug: randomUUID(), status: 'ACTIVE' } });
    const rider = await db.rider.create({ data: { clientId: client.id, name: 'History rider', mobile: randomUUID(), status: 'ACTIVE' } });
    await db.paymentCollectionRequest.createMany({ data: Array.from({ length: 201 }, (_, index) => ({ clientId: client.id, riderId: rider.id, collectionType: 'INVOICE_PAYMENT', method: 'UPI', provider: 'RAZORPAY', status: 'PENDING' as const, amount: '1.00', currency: 'INR', idempotencyKey: randomUUID(), createdAt: new Date(1700000000000 + index) })) });
    const service = new PaymentReconciliationService(db as never, {} as never, {} as never, {} as never);
    const first = await service.report(client.id, undefined, 1);
    const second = await service.report(client.id, undefined, 2);
    expect(first.items).toHaveLength(200); expect(first.hasMore).toBe(true);
    expect(second.items).toHaveLength(1); expect(second.hasMore).toBe(false);
    expect(new Set([...first.items, ...second.items].map(item => item.id)).size).toBe(201);
    expect(second.items[0].riderName).toBe('History rider');
    const empty = await service.report(randomUUID(), undefined, 2);
    expect(empty.items).toEqual([]); expect(empty.hasMore).toBe(false);
  });

  it('matches Razorpay payments once under concurrent import and isolates tenants', async () => {
    const client = await db.client.create({ data: { name: 'Operations test', slug: randomUUID(), status: 'ACTIVE' } });
    const user = await db.user.create({ data: { clientId: client.id, name: 'Operator', mobile: randomUUID(), role: 'CLIENT_ADMIN' } });
    const rider = await db.rider.create({ data: { clientId: client.id, name: 'Test rider', mobile: randomUUID(), status: 'ACTIVE' } });
    const paymentReference = `pay_${randomUUID().replaceAll('-', '')}`;
    await db.paymentCollectionRequest.create({ data: { clientId: client.id, riderId: rider.id, collectionType: 'INVOICE_PAYMENT', method: 'UPI', provider: 'RAZORPAY', status: 'SUCCESS', amount: '500.00', currency: 'INR', idempotencyKey: randomUUID(), providerPaymentId: paymentReference } });
    const service = new ProviderSettlementService(db as never);
    const report: SettlementImport = { provider: 'RAZORPAY', providerSettlementId: randomUUID(), currency: 'INR', grossAmount: '500.00', refundAmount: '0.00', feeAmount: '10.00', taxAmount: '1.80', netAmount: '488.20', settledAt: new Date().toISOString(), items: [{ kind: 'PAYMENT', providerReference: paymentReference, amount: '500.00' }] };
    const [a, b] = await Promise.all([service.importReport(client.id, user.id, report), service.importReport(client.id, user.id, report)]);
    expect(a!.id).toBe(b!.id);
    expect(a!.status).toBe('REPORT_MATCHED');
    expect(await db.providerSettlement.count({ where: { clientId: client.id } })).toBe(1);
    expect(await db.riderPayment.count({ where: { clientId: client.id } })).toBe(0);
    await expect(service.importReport(client.id, user.id, { ...report, feeAmount: '9.00', netAmount: '489.20' })).rejects.toThrow('SETTLEMENT_IMPORT_CONFLICT');
    const other = await db.client.create({ data: { name: 'Other operations test', slug: randomUUID(), status: 'ACTIVE' } });
    const foreign = await service.importReport(other.id, user.id, report);
    expect(foreign!.items[0].status).toBe('MISSING_INTERNAL');
    await expect(service.detail(other.id, a!.id)).rejects.toThrow('SETTLEMENT_NOT_FOUND');
    const operations = new PaymentReconciliationService(db as never, {} as never, {} as never, {} as never);
    const own = await operations.report(client.id, rider.id);
    expect(own.items.some(item => item.source === 'CHECKOUT' && item.state === 'PROVIDER_SUCCESS_LOCAL_PENDING')).toBe(true);
    const hidden = await operations.report(other.id, rider.id);
    expect(hidden.items.some(item => item.source === 'CHECKOUT')).toBe(false);
  });
});
