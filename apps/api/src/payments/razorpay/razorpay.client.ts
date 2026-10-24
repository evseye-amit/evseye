import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

export const orderSchema = z.object({
  id: z.string().regex(/^order_[A-Za-z0-9]+$/),
  amount: z.number().int().positive(),
  currency: z.string(),
  receipt: z.string().nullable(),
  status: z.string(),
});
export const paymentSchema = z.object({
  id: z.string().regex(/^pay_[A-Za-z0-9]+$/),
  order_id: z.string().nullable(),
  amount: z.number().int().nonnegative(),
  currency: z.string(),
  status: z.string(),
  captured: z.boolean(),
  amount_refunded: z.number().int().nonnegative().default(0),
});
export const refundSchema = z.object({
  id: z.string(),
  payment_id: z.string(),
  amount: z.number().int(),
  status: z.string(),
  receipt: z.string().nullable().optional(),
});
export type RazorpayPayment = z.infer<typeof paymentSchema>;
export function verifyRazorpaySignature(
  body: string | Buffer,
  signature: string,
  secret: string,
) {
  if (!/^[a-fA-F0-9]{64}$/.test(signature))
    throw new BadRequestException('Invalid Razorpay signature.');
  const expected = createHmac('sha256', secret).update(body).digest();
  if (!timingSafeEqual(expected, Buffer.from(signature, 'hex')))
    throw new BadRequestException('Invalid Razorpay signature.');
}

export class RazorpayProviderError extends ServiceUnavailableException {
  constructor(public readonly definitive = false) {
    super({
      code: 'RAZORPAY_PROVIDER_UNAVAILABLE',
      message:
        'Payment confirmation is temporarily unavailable. Retry shortly; do not pay again if money was debited.',
    });
  }
}
function decode<T>(schema: z.ZodType<T>, data: unknown): T {
  const parsed = schema.safeParse(data);
  if (!parsed.success) throw new RazorpayProviderError();
  return parsed.data;
}

@Injectable()
export class RazorpayClient {
  constructor(private readonly config: ConfigService) {}
  get keyId(): string {
    return this.config.get<string>('RAZORPAY_KEY_ID') ?? '';
  }
  get enabled() {
    return this.config.get<string>('RAZORPAY_ENABLED') === 'true';
  }
  assertConfigured(clientId?: string, keyId?: string) {
    const clients = (this.config.get<string>('RAZORPAY_CLIENT_IDS') ?? '')
      .split(',')
      .map((v) => v.trim());
    if (
      !this.enabled ||
      !this.keyId ||
      !this.config.get('RAZORPAY_KEY_SECRET') ||
      !this.config.get('RAZORPAY_WEBHOOK_SECRET') ||
      (clientId && !clients.includes(clientId)) ||
      (keyId && keyId !== this.keyId)
    )
      throw new ServiceUnavailableException({
        code: 'RAZORPAY_UNAVAILABLE',
        message:
          'Online payment is unavailable for this workspace or merchant account.',
      });
  }
  verifyCheckout(orderId: string, paymentId: string, signature: string) {
    this.assertConfigured();
    verifyRazorpaySignature(
      `${orderId}|${paymentId}`,
      signature,
      this.config.getOrThrow<string>('RAZORPAY_KEY_SECRET'),
    );
  }
  verifyWebhook(body: Buffer, signature: string) {
    this.assertConfigured();
    verifyRazorpaySignature(
      body,
      signature,
      this.config.getOrThrow<string>('RAZORPAY_WEBHOOK_SECRET'),
    );
  }
  protected async request(
    path: string,
    method = 'GET',
    body?: unknown,
  ): Promise<unknown> {
    this.assertConfigured();
    try {
      const response = await fetch(`https://api.razorpay.com/v1/${path}`, {
        method,
        signal: AbortSignal.timeout(8000),
        headers: {
          Authorization: `Basic ${Buffer.from(`${this.keyId}:${this.config.getOrThrow<string>('RAZORPAY_KEY_SECRET')}`).toString('base64')}`,
          'Content-Type': 'application/json',
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      if (!response.ok)
        throw new RazorpayProviderError(
          [400, 401, 403, 404, 422].includes(response.status),
        );
      return await response.json();
    } catch (error) {
      if (error instanceof RazorpayProviderError) throw error;
      // Never expose gateway payloads, credentials or customer details in errors.
      throw new RazorpayProviderError();
    }
  }
  async createOrder(
    amount: number,
    currency: string,
    receipt: string,
    notes: Record<string, string>,
  ) {
    return decode(
      orderSchema,
      await this.request('orders', 'POST', {
        amount,
        currency,
        receipt,
        notes,
        partial_payment: false,
      }),
    );
  }
  async findOrders(receipt: string) {
    return decode(
      z.object({ items: z.array(orderSchema) }),
      await this.request(
        `orders?receipt=${encodeURIComponent(receipt)}&count=100`,
      ),
    ).items.filter((v) => v.receipt === receipt);
  }
  async fetchOrder(id: string) {
    if (!/^order_[A-Za-z0-9]+$/.test(id))
      throw new BadRequestException('Invalid Razorpay order ID.');
    return decode(orderSchema, await this.request(`orders/${id}`));
  }
  async fetchPayment(id: string) {
    if (!/^pay_[A-Za-z0-9]+$/.test(id))
      throw new BadRequestException('Invalid Razorpay payment ID.');
    return decode(paymentSchema, await this.request(`payments/${id}`));
  }
  async orderPayments(id: string) {
    if (!/^order_[A-Za-z0-9]+$/.test(id))
      throw new BadRequestException('Invalid Razorpay order ID.');
    return decode(
      z.object({ items: z.array(paymentSchema) }),
      await this.request(`orders/${id}/payments`),
    ).items;
  }
  async refund(paymentId: string, amount: number, receipt: string) {
    return decode(
      refundSchema,
      await this.request(`payments/${paymentId}/refund`, 'POST', {
        amount,
        receipt,
        notes: {
          reason: 'Duplicate or cancelled deployment payment',
          captureId: receipt,
        },
      }),
    );
  }
  async fetchRefund(id: string) {
    return decode(
      refundSchema,
      await this.request(`refunds/${encodeURIComponent(id)}`),
    );
  }
  async findRefunds(paymentId: string) {
    return decode(
      z.object({ items: z.array(refundSchema) }),
      await this.request(`payments/${paymentId}/refunds?count=100`),
    ).items;
  }
}
