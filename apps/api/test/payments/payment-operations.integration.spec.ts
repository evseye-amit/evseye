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
