import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { CashfreePaymentProvider } from './cashfree-payment.provider.js';
import {
  mandateStatus,
  moneyToProvider,
  paymentStatus,
  providerErrorCategory,
} from './cashfree-mapper.js';
import type {
  CreateMandateInput,
  PaymentInput,
} from '../payment-provider.interface.js';

const config = {
  getOrThrow: (key: string) =>
    ({
      CASHFREE_SUBSCRIPTION_RETURN_URL: 'https://app.example/return',
      CASHFREE_WEBHOOK_SECRET: 'secret',
    })[key as 'CASHFREE_WEBHOOK_SECRET'],
};
const http = { request: vi.fn() };
const provider = new CashfreePaymentProvider(http as never, config as never);
const mandate: CreateMandateInput = {
  providerMandateId: 'EVSEYE_123',
  idempotencyKey: 'mandate-123',
  customer: { name: 'Rider', phone: '9876543210' },
  planName: 'Weekly rental',
  mode: 'ON_DEMAND',
  maxAmount: '2500.00',
  expiresAt: '2027-12-01T00:00:00+05:30',
  paymentMethods: ['UPI_AUTOPAY', 'ENACH'],
};
const payment: PaymentInput = {
  providerMandateId: 'EVSEYE_123',
  providerPaymentId: 'EVSEYE_PAY_1',
  idempotencyKey: 'pay-1',
  amount: '1650.00',
  scheduledAt: '2026-09-30T10:00:00+05:30',
};

describe('CashfreePaymentProvider', () => {
  it('maps an on-demand UPI/eNACH mandate and session response', async () => {
    http.request.mockResolvedValueOnce({
      subscription_id: 'EVSEYE_123',
      subscription_status: 'INITIALIZED',
      subscription_session_id: 'session-1',
    });
    const result = await provider.createMandate(mandate);
    expect(result).toEqual({
      providerMandateId: 'EVSEYE_123',
      status: 'CREATED',
      rawStatus: 'INITIALIZED',
      sessionId: 'session-1',
    });
    expect(http.request).toHaveBeenLastCalledWith(
      'POST',
      '/subscriptions',
      expect.objectContaining({
        plan_details: expect.objectContaining({
          plan_type: 'ON_DEMAND',
          plan_max_amount: 2500,
        }),
        authorization_details: { payment_methods: ['upi', 'enach'] },
      }),
      'mandate-123',
    );
  });
  it('maps periodic plan and charge/auth distinctly', async () => {
    http.request.mockResolvedValueOnce({
      subscription_id: 'EVSEYE_123',
      subscription_status: 'ACTIVE',
    });
    await provider.createMandate({
      ...mandate,
      mode: 'PERIODIC',
      periodicAmount: '1500.00',
      intervalType: 'WEEK',
      intervals: 1,
      firstChargeAt: '2026-10-01T00:00:00+05:30',
    });
    expect(http.request).toHaveBeenLastCalledWith(
      'POST',
      '/subscriptions',
      expect.objectContaining({
        plan_details: expect.objectContaining({
          plan_type: 'PERIODIC',
          plan_amount: 1500,
          plan_interval_type: 'WEEK',
          plan_intervals: 1,
        }),
      }),
      'mandate-123',
    );
    http.request.mockResolvedValueOnce({
      subscription_id: 'EVSEYE_123',
      payment_id: 'EVSEYE_PAY_1',
      payment_status: 'PENDING',
      data: { url: 'https://cashfree.com/pay' },
    });
    expect((await provider.authorizeMandate(payment)).authorizationUrl).toBe(
      'https://cashfree.com/pay',
    );
    expect(http.request).toHaveBeenLastCalledWith(
      'POST',
      '/subscriptions/pay',
      expect.objectContaining({ payment_type: 'AUTH', payment_amount: 1650 }),
      'pay-1',
    );
    http.request.mockResolvedValueOnce({
      subscription_id: 'EVSEYE_123',
      payment_id: 'EVSEYE_PAY_1',
      payment_status: 'SUCCESS',
      cf_payment_id: 123,
    });
    expect((await provider.createPayment(payment)).providerReference).toBe(
      '123',
    );
    expect(http.request).toHaveBeenLastCalledWith(
      'POST',
      '/subscriptions/pay',
      expect.objectContaining({ payment_type: 'CHARGE' }),
      'pay-1',
    );
  });
  it('maps management, retry and refunds to subscription endpoints', async () => {
    http.request.mockResolvedValueOnce({
      subscription_id: 'EVSEYE_123',
      subscription_status: 'PAUSED',
    });
    expect((await provider.pauseMandate('EVSEYE_123', 'pause-1')).status).toBe(
      'PAUSED',
    );
    expect(http.request).toHaveBeenLastCalledWith(
      'POST',
      '/subscriptions/EVSEYE_123/manage',
      { subscription_id: 'EVSEYE_123', action: 'PAUSE' },
      'pause-1',
    );
    http.request.mockResolvedValueOnce({
      subscription_id: 'EVSEYE_123',
      payment_id: 'EVSEYE_PAY_1',
      payment_status: 'PENDING',
    });
    await provider.retryPayment(
      'EVSEYE_123',
      'EVSEYE_PAY_1',
      '2026-10-01T00:00:00Z',
      'retry-1',
    );
    expect(http.request).toHaveBeenLastCalledWith(
      'POST',
      '/subscriptions/EVSEYE_123/payments/EVSEYE_PAY_1/manage',
      expect.objectContaining({ action: 'RETRY' }),
      'retry-1',
    );
    http.request.mockResolvedValueOnce({
      refund_id: 'REF_1',
      refund_status: 'PENDING',
    });
    await provider.createRefund({
      providerMandateId: 'EVSEYE_123',
      providerPaymentId: 'EVSEYE_PAY_1',
      providerRefundId: 'REF_1',
      providerPaymentReference: '123',
      amount: '100.00',
      idempotencyKey: 'refund-1',
    });
    expect(http.request).toHaveBeenLastCalledWith(
      'POST',
      '/subscriptions/EVSEYE_123/refunds',
      expect.objectContaining({ refund_amount: 100 }),
      'refund-1',
    );
  });
  it('rejects unknown statuses and unsafe amounts', () => {
    expect(mandateStatus('new future state')).toBe('UNKNOWN');
    expect(paymentStatus('new future state')).toBe('UNKNOWN');
    expect(() => moneyToProvider('1.234')).toThrow();
    expect(providerErrorCategory(503)).toBe('PROVIDER_UNAVAILABLE');
  });
  it('verifies raw-body webhook signature before parsing', () => {
    const raw = Buffer.from('{"type":"SUBSCRIPTION_STATUS_CHANGED"}');
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = createHmac('sha256', 'secret')
      .update(timestamp)
      .update(raw)
      .digest('base64');
    expect(provider.verifyWebhook(raw, timestamp, signature).payload).toEqual({
      type: 'SUBSCRIPTION_STATUS_CHANGED',
    });
    expect(() => provider.verifyWebhook(raw, timestamp, 'invalid')).toThrow();
  });
});
