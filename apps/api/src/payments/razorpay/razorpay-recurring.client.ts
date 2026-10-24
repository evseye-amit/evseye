import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { z } from 'zod';
import {
  RazorpayClient,
  RazorpayProviderError,
  orderSchema,
  paymentSchema,
} from './razorpay.client.js';
const remoteId = (prefix: string) =>
  z.string().regex(new RegExp(`^${prefix}_[A-Za-z0-9]+$`));
const registration = z.object({
  id: remoteId('inv'),
  receipt: z.string().nullable(),
  customer_id: remoteId('cust'),
  order_id: remoteId('order').nullable(),
  payment_id: remoteId('pay').nullable(),
  status: z.string(),
  amount: z.number().int().nonnegative(),
  currency: z.string(),
  short_url: z.string().url().nullable(),
});
export type RazorpayRegistration = z.infer<typeof registration>;
const token = z.object({
  id: remoteId('token'),
  method: z.string(),
  recurring: z.boolean(),
  recurring_details: z.object({
    status: z.string(),
    failure_reason: z.string().nullable().optional(),
  }),
  max_amount: z.number().int().positive().optional(),
  expired_at: z.number().int().positive().optional(),
});
const recurringPayment = paymentSchema.extend({
  customer_id: z.string().nullable().optional(),
  token_id: z.string().nullable().optional(),
  method: z.string().optional(),
  error_code: z.string().nullable().optional(),
  error_reason: z.string().nullable().optional(),
});
export type RazorpayRecurringPayment = z.infer<typeof recurringPayment>;
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new RazorpayProviderError();
  return result.data;
}
@Injectable()
export class RazorpayRecurringClient extends RazorpayClient {
  constructor(config: ConfigService) {
    super(config);
  }
  async createRegistration(body: Record<string, unknown>) {
    return parse(
      registration,
      await this.request('subscription_registration/auth_links', 'POST', body),
    );
  }
  async fetchRegistration(id: string) {
    remoteId('inv').parse(id);
    return parse(registration, await this.request(`invoices/${id}`));
  }
  async findRegistrations(receipt: string, createdAt: Date) {
    const found: RazorpayRegistration[] = [];
    // Receipt is not assumed to be a supported server-side invoice filter.
    for (let skip = 0; skip < 1000; skip += 100) {
      const page = parse(
        z.object({ items: z.array(z.unknown()) }),
        await this.request(
          `invoices?from=${Math.floor(createdAt.getTime() / 1000) - 60}&count=100&skip=${skip}`,
        ),
      );
      for (const item of page.items) {
        if (
          item &&
          typeof item === 'object' &&
          'receipt' in item &&
          item.receipt === receipt
        )
          found.push(parse(registration, item));
      }
      if (page.items.length < 100) return found;
    }
    // Do not bind a partial search result: a second matching registration may exist.
    throw new RazorpayProviderError();
  }
  async cancelRegistration(id: string) {
    remoteId('inv').parse(id);
    return parse(
      registration,
      await this.request(`invoices/${id}/cancel`, 'POST'),
    );
  }
  async fetchToken(customerId: string, tokenId: string) {
    remoteId('cust').parse(customerId);
    remoteId('token').parse(tokenId);
    return parse(
      token,
      await this.request(`customers/${customerId}/tokens/${tokenId}`),
    );
  }
  async cancelToken(customerId: string, tokenId: string) {
    remoteId('cust').parse(customerId);
    remoteId('token').parse(tokenId);
    return parse(
      z.object({ status: z.string() }),
      await this.request(
        `customers/${customerId}/tokens/${tokenId}/cancel`,
        'PUT',
      ),
    );
  }
  async createDebitOrder(
    amount: number,
    receipt: string,
    tokenId: string,
    scheduledAt: Date,
  ) {
    return parse(
      orderSchema,
      await this.request('orders', 'POST', {
        amount,
        currency: 'INR',
        receipt,
        payment_capture: true,
        partial_payment: false,
        notification: {
          token_id: tokenId,
          payment_after: Math.ceil(scheduledAt.getTime() / 1000),
        },
        notes: { purpose: 'AUTOPAY_DEBIT', reference: receipt },
      }),
    );
  }
  async createRecurringPayment(input: {
    customerId: string;
    tokenId: string;
    orderId: string;
    amount: number;
    email: string;
    contact: string;
  }) {
    return parse(
      z.object({ razorpay_payment_id: remoteId('pay') }),
      await this.request('payments/create/recurring', 'POST', {
        customer_id: input.customerId,
        token: input.tokenId,
        order_id: input.orderId,
        amount: input.amount,
        currency: 'INR',
        email: input.email,
        contact: input.contact,
        recurring: true,
        description: 'EVsEye recurring invoice payment',
      }),
    );
  }
  async recurringPayment(id: string) {
    remoteId('pay').parse(id);
    return parse(recurringPayment, await this.request(`payments/${id}`));
  }
  async recurringOrderPayments(id: string) {
    remoteId('order').parse(id);
    return parse(
      z.object({ items: z.array(recurringPayment) }),
      await this.request(`orders/${id}/payments`),
    ).items;
  }
}
