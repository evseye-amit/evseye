import {
  BadRequestException,
  Injectable,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { RazorpayConfigurationService } from './razorpay-configuration.service.js';

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
  constructor(private readonly config: ConfigService, @Optional() private readonly clientConfiguration?: RazorpayConfigurationService) {}
  get keyId(): string {
    return this.config.get<string>('RAZORPAY_KEY_ID') ?? '';
  }
  async configurationFor(clientId?: string, configurationVersionId?: string | null) {
    if (clientId && this.clientConfiguration) {
      return configurationVersionId
        ? this.clientConfiguration.resolveVersion(clientId, configurationVersionId)
        : this.clientConfiguration.resolve(clientId);
    }
    if (configurationVersionId)
      throw new ServiceUnavailableException('The saved merchant configuration cannot be resolved.');
    await this.assertConfigured(clientId);
    return { configurationVersionId: undefined, keyId: this.keyId,
      keySecret: this.config.getOrThrow<string>('RAZORPAY_KEY_SECRET'),
      webhookSecret: this.config.getOrThrow<string>('RAZORPAY_WEBHOOK_SECRET'),
      environment: this.config.get<string>('RAZORPAY_ENVIRONMENT') ?? 'LEGACY' };
  }
  async keyIdFor(clientId?: string, configurationVersionId?: string | null): Promise<string> {
    if (clientId && this.clientConfiguration) {
      return (await this.configurationFor(clientId, configurationVersionId)).keyId;
    }
    return this.keyId;
  }
  async environmentFor(clientId?: string, configurationVersionId?: string | null): Promise<string> {
    if (clientId && this.clientConfiguration)
      return (await this.configurationFor(clientId, configurationVersionId)).environment;
    return this.config.get<string>('RAZORPAY_ENVIRONMENT') ?? 'LEGACY';
  }
  get enabled() {
    return this.config.get<string>('RAZORPAY_ENABLED') === 'true';
  }
  async assertConfigured(clientId?: string, keyId?: string, configurationVersionId?: string | null): Promise<void> {
    if (clientId && this.clientConfiguration) {
      const credentials = await this.configurationFor(clientId, configurationVersionId);
      if (keyId && keyId !== credentials.keyId)
        throw new ServiceUnavailableException({
          code: 'RAZORPAY_CONFIGURATION_MISMATCH',
          message: 'The saved payment merchant configuration is unavailable. Restore it before retrying.',
        });
      return;
    }
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
  async verifyCheckout(
    orderId: string,
    paymentId: string,
    signature: string,
    clientId?: string,
    configurationVersionId?: string | null,
  ) {
    const { keySecret: secret } = await this.configurationFor(clientId, configurationVersionId);
    verifyRazorpaySignature(
      `${orderId}|${paymentId}`,
      signature,
      secret,
    );
  }
  async verifyWebhook(body: Buffer, signature: string, clientId?: string, configurationVersionId?: string | null) {
    if (clientId && this.clientConfiguration && !configurationVersionId) {
      const versions = await this.clientConfiguration.webhookVersions(clientId);
      let unavailable: ServiceUnavailableException | undefined;
      for (const version of versions) {
        try {
          const credentials = await this.configurationFor(clientId, version);
          verifyRazorpaySignature(body, signature, credentials.webhookSecret);
          return version;
        } catch (error) {
          if (error instanceof ServiceUnavailableException) {
            unavailable = error;
            continue;
          }
          if (!(error instanceof BadRequestException)) throw error;
        }
      }
      if (versions.length) {
        if (unavailable) throw unavailable;
        throw new BadRequestException('Invalid Razorpay signature.');
      }
    }
    const { webhookSecret: secret } = await this.configurationFor(clientId, configurationVersionId);
    verifyRazorpaySignature(
      body,
      signature,
      secret,
    );
    return configurationVersionId ?? null;
  }
  protected async request(
    path: string,
    method = 'GET',
    body?: unknown,
    clientId?: string,
    configurationVersionId?: string | null,
  ): Promise<unknown> {
    const credentials = await this.configurationFor(clientId, configurationVersionId);
    try {
      const response = await fetch(`https://api.razorpay.com/v1/${path}`, {
        method,
        signal: AbortSignal.timeout(8000),
        headers: {
          Authorization: `Basic ${Buffer.from(`${credentials.keyId}:${credentials.keySecret}`).toString('base64')}`,
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
    clientId?: string,
    configurationVersionId?: string | null,
  ) {
    return decode(
      orderSchema,
      await this.request('orders', 'POST', {
        amount,
        currency,
        receipt,
        notes,
        partial_payment: false,
      }, clientId, configurationVersionId),
    );
  }
  async findOrders(receipt: string, clientId?: string, configurationVersionId?: string | null) {
    return decode(
      z.object({ items: z.array(orderSchema) }),
      await this.request(
        `orders?receipt=${encodeURIComponent(receipt)}&count=100`, 'GET', undefined, clientId, configurationVersionId,
      ),
    ).items.filter((v) => v.receipt === receipt);
  }
  async fetchOrder(id: string, clientId?: string, configurationVersionId?: string | null) {
    if (!/^order_[A-Za-z0-9]+$/.test(id))
      throw new BadRequestException('Invalid Razorpay order ID.');
    return decode(orderSchema, await this.request(`orders/${id}`, 'GET', undefined, clientId, configurationVersionId));
  }
  async fetchPayment(id: string, clientId?: string, configurationVersionId?: string | null) {
    if (!/^pay_[A-Za-z0-9]+$/.test(id))
      throw new BadRequestException('Invalid Razorpay payment ID.');
    return decode(paymentSchema, await this.request(`payments/${id}`, 'GET', undefined, clientId, configurationVersionId));
  }
  async orderPayments(id: string, clientId?: string, configurationVersionId?: string | null) {
    if (!/^order_[A-Za-z0-9]+$/.test(id))
      throw new BadRequestException('Invalid Razorpay order ID.');
    return decode(
      z.object({ items: z.array(paymentSchema) }),
      await this.request(`orders/${id}/payments`, 'GET', undefined, clientId, configurationVersionId),
    ).items;
  }
  async refund(paymentId: string, amount: number, receipt: string, clientId?: string, configurationVersionId?: string | null) {
    return decode(
      refundSchema,
      await this.request(`payments/${paymentId}/refund`, 'POST', {
        amount,
        receipt,
        notes: {
          reason: 'Duplicate or cancelled deployment payment',
          captureId: receipt,
        },
      }, clientId, configurationVersionId),
    );
  }
  async fetchRefund(id: string, clientId?: string, configurationVersionId?: string | null) {
    return decode(
      refundSchema,
      await this.request(`refunds/${encodeURIComponent(id)}`, 'GET', undefined, clientId, configurationVersionId),
    );
  }
  async findRefunds(paymentId: string, clientId?: string, configurationVersionId?: string | null) {
    return decode(
      z.object({ items: z.array(refundSchema) }),
      await this.request(`payments/${paymentId}/refunds?count=100`, 'GET', undefined, clientId, configurationVersionId),
    ).items;
  }
}
