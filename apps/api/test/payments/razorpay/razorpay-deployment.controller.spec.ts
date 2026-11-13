import { describe, expect, it, vi } from 'vitest';
import { RazorpayWebhookController } from '../../../src/payments/razorpay/razorpay-deployment.controller.js';

describe('Razorpay webhook endpoint', () => {
  it('requires raw webhook bytes and forwards signature/event headers without user authentication', () => {
    const service = { webhook: vi.fn().mockReturnValue({ received: true }) };
    const controller = new RazorpayWebhookController(service as never);
    expect(() => controller.webhook({} as never, 'signature', 'event')).toThrow(
      'Raw webhook body',
    );
    const raw = Buffer.from('{ "event": "payment.captured" }');
    expect(
      controller.webhook({ rawBody: raw } as never, 'signature', 'event'),
    ).toEqual({ received: true });
    expect(service.webhook).toHaveBeenCalledWith(raw, 'signature', 'event');
  });
});
