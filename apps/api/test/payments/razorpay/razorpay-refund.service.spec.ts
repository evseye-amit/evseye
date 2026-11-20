import { describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import { RazorpayRefundService } from '../../../src/payments/razorpay/razorpay-refund.service.js';
const refund = { id: 'local-refund', clientId: 'client-a', providerRefundId: 'receipt', amount: new Prisma.Decimal('25.00'), currency: 'INR' };
const source = { kind: 'RAZORPAY' as const, provider: 'RAZORPAY' as const, paymentId: 'pay_original', orderId: 'order_original', configurationVersionId: 'historical-v1', amount: new Prisma.Decimal('100.00'), refundedAmount: new Prisma.Decimal(0), currency: 'INR' };
function fixture() {
  const remote = { id: 'rfnd_verified', payment_id: 'pay_original', amount: 2500, receipt: refund.id, status: 'processed' };
  const gateway = { fetchPayment: vi.fn().mockResolvedValue({ id: source.paymentId, order_id: source.orderId, amount: 10000, amount_refunded: 0, currency: 'INR', captured: true, status: 'captured' }), createPaymentRefund: vi.fn().mockResolvedValue(remote), fetchRefund: vi.fn().mockResolvedValue(remote), findRefunds: vi.fn().mockResolvedValue([remote]) };
  return { gateway, service: new RazorpayRefundService(gateway as never) };
}
describe('Razorpay refund recovery', () => {
  it('creates using the original merchant version and stable local refund ID', async () => {
    const f = fixture();
    expect(await f.service.observe(refund as never, source, true)).toMatchObject({ status: 'SUCCESS', gatewayRefundId: 'rfnd_verified', amount: '25.00' });
    expect(f.gateway.createPaymentRefund).toHaveBeenCalledWith('pay_original', 2500, refund.id, 'client-a', 'historical-v1');
  });
  it('recovers lost responses without creating a second refund', async () => {
    const f = fixture();
    expect(await f.service.observe(refund as never, source)).toMatchObject({ status: 'SUCCESS' });
    expect(f.gateway.createPaymentRefund).not.toHaveBeenCalled();
    expect(f.gateway.findRefunds).toHaveBeenCalledWith('pay_original', 'client-a', 'historical-v1', 0);
  });
  it('keeps missing refunds uncertain and reserved', async () => {
    const f = fixture(); f.gateway.findRefunds.mockResolvedValue([]);
    expect(await f.service.observe(refund as never, source)).toMatchObject({ status: 'UNKNOWN' });
    expect(f.gateway.createPaymentRefund).not.toHaveBeenCalled();
  });
  it.each([{ payment_id: 'pay_foreign' }, { amount: 2499 }, { receipt: 'foreign-refund' }])('rejects mismatched refund evidence %j', async change => {
    const f = fixture(); f.gateway.fetchRefund.mockResolvedValue({ id: 'rfnd_verified', payment_id: source.paymentId, amount: 2500, receipt: refund.id, status: 'processed', ...change });
    await expect(f.service.observe({ ...refund, providerReference: 'rfnd_verified' } as never, source)).rejects.toThrow('IDENTITY_MISMATCH');
  });
  it('rejects an order/payment mismatch before refund creation', async () => {
    const f = fixture(); f.gateway.fetchPayment.mockResolvedValue({ id: source.paymentId, order_id: 'order_other', captured: true, status: 'captured', amount: 10000, currency: 'INR' });
    await expect(f.service.observe(refund as never, source, true)).rejects.toThrow('SOURCE_PAYMENT_MISMATCH');
    expect(f.gateway.createPaymentRefund).not.toHaveBeenCalled();
  });
});
