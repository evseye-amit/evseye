import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Environment } from '../../config/environment.js';
import type {
  CheckoutOrderInput,
  CheckoutOrderResult,
  CheckoutPaymentResult,
  CheckoutRefundInput,
  CreateMandateInput,
  MandateResult,
  PaymentInput,
  PaymentProvider,
  PaymentResult,
  RefundInput,
  RefundResult,
  VerifiedWebhook,
} from '../payment-provider.interface.js';
import { CashfreeHttpClient } from './cashfree-http.client.js';
import {
  mandateStatus,
  moneyToProvider,
  paymentStatus,
  refundStatus,
} from './cashfree-mapper.js';

type Payload = Record<string, unknown>;
const id = (value: string) => encodeURIComponent(value);
const field = (value: unknown) => (typeof value === 'string' ? value : '');
function failure(raw: string): {
  failureCode: string;
  retryability: 'RETRYABLE' | 'NON_RETRYABLE' | 'UNKNOWN';
} {
  const code = raw.toUpperCase();
  if (code.includes('INSUFFICIENT') || code.includes('BALANCE'))
    return { failureCode: 'INSUFFICIENT_FUNDS', retryability: 'RETRYABLE' };
  if (
    code.includes('ISSUER_NOT_AVAILABLE') ||
    code.includes('BANK_UNAVAILABLE') ||
    code.includes('TIMEOUT')
  )
    return { failureCode: 'PROVIDER_UNAVAILABLE', retryability: 'RETRYABLE' };
  if (
    code.includes('MANDATE') &&
    (code.includes('REVOK') || code.includes('CANCEL'))
  )
    return { failureCode: 'MANDATE_REVOKED', retryability: 'NON_RETRYABLE' };
  if (code.includes('MANDATE') && code.includes('EXPIR'))
    return { failureCode: 'MANDATE_EXPIRED', retryability: 'NON_RETRYABLE' };
  if (code.includes('LIMIT') || code.includes('AMOUNT_EXCEEDED'))
    return {
      failureCode: 'MANDATE_LIMIT_EXCEEDED',
      retryability: 'NON_RETRYABLE',
    };
  if (
    code.includes('MANDATE') &&
    (code.includes('INVALID') || code.includes('INACTIVE'))
  )
    return { failureCode: 'MANDATE_INACTIVE', retryability: 'NON_RETRYABLE' };
  return { failureCode: 'UNKNOWN', retryability: 'UNKNOWN' };
}

@Injectable()
export class CashfreePaymentProvider implements PaymentProvider {
  constructor(
    private readonly http: CashfreeHttpClient,
    private readonly config: ConfigService<Environment, true>,
  ) {}
  assertChargeEligible(input: {
    amount: string;
    currency: string;
    scheduledAt: Date;
  }): void {
    if (input.currency !== 'INR')
      throw new BadRequestException('Cashfree AutoPay supports INR only.');
    const istDay = (value: Date) =>
      new Date(value.getTime() + 330 * 60000).toISOString().slice(0, 10);
    if (
      input.scheduledAt <= new Date() ||
      input.scheduledAt.getTime() < Date.now() + 24 * 3600000 ||
      istDay(input.scheduledAt) <= istDay(new Date())
    )
      throw new BadRequestException(
        'Cashfree charge must be scheduled at least 24 hours ahead and after today in India.',
      );
    moneyToProvider(input.amount);
  }

  async createCheckoutOrder(
    input: CheckoutOrderInput,
  ): Promise<CheckoutOrderResult> {
    if (input.currency !== 'INR')
      throw new BadRequestException(
        'Cashfree checkout currently supports INR.',
      );
    const result = await this.http.request<Payload>(
      'POST',
      '/orders',
      {
        order_id: input.orderId,
        order_amount: moneyToProvider(input.amount),
        order_currency: input.currency,
        customer_details: {
          customer_id: input.customer.id,
          customer_phone: input.customer.phone,
          ...(input.customer.name
            ? { customer_name: input.customer.name }
            : {}),
        },
        ...(input.notifyUrl
          ? { order_meta: { notify_url: input.notifyUrl } }
          : {}),
      },
      input.idempotencyKey,
      '2025-01-01',
    );
    const orderId = field(result.order_id),
      paymentSessionId = field(result.payment_session_id);
    if (orderId !== input.orderId || !paymentSessionId)
      throw new BadRequestException(
        'Cashfree checkout response is incomplete.',
      );
    return { orderId, paymentSessionId, rawStatus: field(result.order_status), expiresAt: field(result.order_expiry_time) || undefined };
  }

  async fetchCheckoutOrder(orderId: string) {
    const result = await this.http.request<Payload>('GET', `/orders/${id(orderId)}`, undefined, undefined, '2025-01-01');
    if (field(result.order_id) !== orderId) throw new BadRequestException('Cashfree checkout order identity mismatch.');
    const rawStatus = field(result.order_status);
    return {
      orderId,
      status: (['ACTIVE', 'PAID', 'EXPIRED'].includes(rawStatus) ? rawStatus : 'UNKNOWN') as 'ACTIVE' | 'PAID' | 'EXPIRED' | 'UNKNOWN',
      expiresAt: field(result.order_expiry_time) || undefined,
    };
  }

  async fetchCheckoutPayments(
    orderId: string,
  ): Promise<CheckoutPaymentResult[]> {
    const response = await this.http.request<Payload[]>(
      'GET',
      `/orders/${id(orderId)}/payments`,
      undefined,
      undefined,
      '2025-01-01',
    );
    if (!Array.isArray(response))
      throw new BadRequestException(
        'Cashfree payment verification response is invalid.',
      );
    return response.map((item) => ({
      orderId: field(item.order_id),
      providerPaymentId:
        item.cf_payment_id == null ? '' : String(item.cf_payment_id),
      status:
        field(item.payment_status) === 'USER_DROPPED'
          ? 'FAILED'
          : paymentStatus(item.payment_status),
      rawStatus: field(item.payment_status),
      amount: item.payment_amount == null ? '' : String(item.payment_amount),
      currency: field(item.payment_currency),
      providerReference: field(item.bank_reference) || undefined,
    }));
  }
  verifyCheckoutWebhook(
    rawBody: Buffer,
    timestamp: string,
    signature: string,
  ): VerifiedWebhook {
    const secret = this.config.getOrThrow('CASHFREE_CLIENT_SECRET');
    const expected = createHmac('sha256', secret)
      .update(timestamp)
      .update(rawBody)
      .digest();
    const actual = Buffer.from(signature, 'base64');
    if (
      !timestamp ||
      !signature ||
      actual.length !== expected.length ||
      !timingSafeEqual(actual, expected)
    )
      throw new UnauthorizedException(
        'Invalid Cashfree checkout webhook signature.',
      );
    try {
      return { payload: JSON.parse(rawBody.toString('utf8')) as unknown };
    } catch {
      throw new BadRequestException(
        'Invalid Cashfree checkout webhook payload.',
      );
    }
  }
  async createCheckoutRefund(
    input: CheckoutRefundInput,
  ): Promise<RefundResult> {
    const response = await this.http.request<Payload | Payload[]>(
      'POST',
      `/orders/${id(input.orderId)}/refunds`,
      {
        refund_amount: moneyToProvider(input.amount),
        refund_id: input.refundId,
        refund_note: input.note,
        refund_speed: 'STANDARD',
      },
      input.idempotencyKey,
      '2025-01-01',
    );
    const payload = Array.isArray(response) ? response[0] : response;
    if (!payload)
      throw new BadRequestException('Checkout refund response is empty.');
    if (field(payload.refund_id) !== input.refundId)
      throw new BadRequestException('Checkout refund identity mismatch.');
    return this.refund(payload);
  }
  async fetchCheckoutRefund(
    orderId: string,
    refundId: string,
  ): Promise<RefundResult> {
    const payload = await this.http.request<Payload>(
      'GET',
      `/orders/${id(orderId)}/refunds/${id(refundId)}`,
      undefined,
      undefined,
      '2025-01-01',
    );
    if (field(payload.refund_id) !== refundId)
      throw new BadRequestException('Checkout refund identity mismatch.');
    return this.refund(payload);
  }

  private mandate(payload: Payload): MandateResult {
    const rawStatus = field(payload.subscription_status);
    return {
      providerMandateId: field(payload.subscription_id),
      status: mandateStatus(rawStatus),
      rawStatus,
      sessionId: field(payload.subscription_session_id) || undefined,
    };
  }
  private payment(payload: Payload): PaymentResult {
    const rawStatus = field(payload.payment_status);
    const normalizedStatus = paymentStatus(rawStatus);
    const data = payload.data as Payload | undefined;
    return {
      providerMandateId: field(payload.subscription_id),
      providerPaymentId: field(payload.payment_id),
      status: normalizedStatus,
      rawStatus,
      ...(normalizedStatus === 'FAILED'
        ? failure(
            field(payload.payment_error_code) ||
              field(payload.payment_failure_reason),
          )
        : {}),
      amount:
        typeof payload.payment_amount === 'number' ||
        typeof payload.payment_amount === 'string'
          ? String(payload.payment_amount)
          : undefined,
      paymentType: field(payload.payment_type) || undefined,
      providerReference:
        payload.cf_payment_id == null
          ? undefined
          : String(payload.cf_payment_id),
      authorizationUrl:
        data && typeof data.url === 'string' ? data.url : undefined,
    };
  }
  private refund(payload: Payload): RefundResult {
    const rawStatus = field(payload.refund_status);
    return {
      providerRefundId: field(payload.refund_id),
      status: refundStatus(rawStatus),
      rawStatus,
      amount:
        payload.refund_amount == null
          ? undefined
          : String(payload.refund_amount),
      currency: field(payload.refund_currency) || undefined,
    };
  }
  async createMandate(input: CreateMandateInput): Promise<MandateResult> {
    if (!input.paymentMethods.length)
      throw new BadRequestException(
        'Select at least one mandate payment method.',
      );
    if (
      input.mode === 'PERIODIC' &&
      (!input.periodicAmount ||
        !input.intervalType ||
        !input.intervals ||
        !input.firstChargeAt)
    ) {
      throw new BadRequestException(
        'Periodic mandates require amount, interval, and first charge time.',
      );
    }
    const methods = [
      ...new Set(
        input.paymentMethods.map((method) =>
          method === 'UPI_AUTOPAY' ? 'upi' : 'enach',
        ),
      ),
    ];
    const plan: Payload = {
      plan_name: input.planName,
      plan_type: input.mode,
      plan_max_amount: moneyToProvider(input.maxAmount),
      plan_currency: 'INR',
    };
    if (input.mode === 'PERIODIC') {
      plan.plan_amount = moneyToProvider(input.periodicAmount!);
      plan.plan_interval_type = input.intervalType;
      plan.plan_intervals = input.intervals;
    }
    const payload = await this.http.request<Payload>(
      'POST',
      '/subscriptions',
      {
        subscription_id: input.providerMandateId,
        customer_details: {
          customer_name: input.customer.name,
          customer_phone: input.customer.phone,
          ...(input.customer.email
            ? { customer_email: input.customer.email }
            : {}),
        },
        plan_details: plan,
        authorization_details: {
          payment_methods: methods,
          ...(input.authorizationAmount
            ? {
                authorization_amount: moneyToProvider(
                  input.authorizationAmount,
                ),
              }
            : {}),
          ...(input.refundAuthorizationAmount === undefined
            ? {}
            : { authorization_amount_refund: input.refundAuthorizationAmount }),
        },
        subscription_meta: {
          return_url: this.config.getOrThrow(
            'CASHFREE_SUBSCRIPTION_RETURN_URL',
          ),
          notification_channel: ['SMS'],
        },
        subscription_expiry_time: input.expiresAt,
        ...(input.mode === 'PERIODIC'
          ? { subscription_first_charge_time: input.firstChargeAt }
          : {}),
      },
      input.idempotencyKey,
    );
    return this.mandate(payload);
  }
  async fetchMandate(providerMandateId: string): Promise<MandateResult> {
    return this.mandate(
      await this.http.request<Payload>(
        'GET',
        `/subscriptions/${id(providerMandateId)}`,
      ),
    );
  }
  private async manage(
    providerMandateId: string,
    action: 'PAUSE' | 'ACTIVATE' | 'CANCEL',
    idempotencyKey: string,
  ): Promise<MandateResult> {
    const payload = await this.http.request<Payload>(
      'POST',
      `/subscriptions/${id(providerMandateId)}/manage`,
      { subscription_id: providerMandateId, action },
      idempotencyKey,
    );
    // Manage responses may omit current status. Fetch authoritative state in that case.
    return payload.subscription_status
      ? this.mandate(payload)
      : this.fetchMandate(providerMandateId);
  }
  pauseMandate(providerMandateId: string, idempotencyKey: string) {
    return this.manage(providerMandateId, 'PAUSE', idempotencyKey);
  }
  resumeMandate(providerMandateId: string, idempotencyKey: string) {
    return this.manage(providerMandateId, 'ACTIVATE', idempotencyKey);
  }
  cancelMandate(providerMandateId: string, idempotencyKey: string) {
    return this.manage(providerMandateId, 'CANCEL', idempotencyKey);
  }
  private async pay(
    input: PaymentInput,
    paymentType: 'AUTH' | 'CHARGE',
  ): Promise<PaymentResult> {
    return this.payment(
      await this.http.request<Payload>(
        'POST',
        '/subscriptions/pay',
        {
          subscription_id: input.providerMandateId,
          payment_id: input.providerPaymentId,
          payment_amount: moneyToProvider(input.amount),
          payment_schedule_date: input.scheduledAt,
          payment_type: paymentType,
          ...(input.remarks ? { payment_remarks: input.remarks } : {}),
        },
        input.idempotencyKey,
      ),
    );
  }
  authorizeMandate(input: PaymentInput) {
    return this.pay(input, 'AUTH');
  }
  createPayment(input: PaymentInput) {
    return this.pay(input, 'CHARGE');
  }
  async fetchPayment(
    providerMandateId: string,
    providerPaymentId: string,
  ): Promise<PaymentResult> {
    return this.payment(
      await this.http.request<Payload>(
        'GET',
        `/subscriptions/${id(providerMandateId)}/payments/${id(providerPaymentId)}`,
      ),
    );
  }
  async retryPayment(
    providerMandateId: string,
    providerPaymentId: string,
    nextScheduledAt: string,
    idempotencyKey: string,
  ): Promise<PaymentResult> {
    const payload = await this.http.request<Payload>(
      'POST',
      `/subscriptions/${id(providerMandateId)}/payments/${id(providerPaymentId)}/manage`,
      {
        subscription_id: providerMandateId,
        payment_id: providerPaymentId,
        action: 'RETRY',
        action_details: { next_scheduled_time: nextScheduledAt },
      },
      idempotencyKey,
    );
    return payload.payment_status
      ? this.payment(payload)
      : this.fetchPayment(providerMandateId, providerPaymentId);
  }
  async createRefund(input: RefundInput): Promise<RefundResult> {
    if (
      !/^\d+$/.test(input.providerPaymentReference) ||
      !Number.isSafeInteger(Number(input.providerPaymentReference))
    ) {
      throw new BadRequestException(
        'Cashfree payment reference must be a numeric provider ID.',
      );
    }
    const payload = await this.http.request<Payload>(
      'POST',
      `/subscriptions/${id(input.providerMandateId)}/refunds`,
      {
        subscription_id: input.providerMandateId,
        payment_id: input.providerPaymentId,
        cf_payment_id: Number(input.providerPaymentReference),
        refund_id: input.providerRefundId,
        refund_amount: moneyToProvider(input.amount),
        refund_note: input.note ?? 'Rider payment refund',
        refund_speed: 'STANDARD',
      },
      input.idempotencyKey,
    );
    return this.refund(payload);
  }
  async fetchRefund(
    providerMandateId: string,
    providerRefundId: string,
  ): Promise<RefundResult> {
    return this.refund(
      await this.http.request<Payload>(
        'GET',
        `/subscriptions/${id(providerMandateId)}/refunds/${id(providerRefundId)}`,
      ),
    );
  }
  verifyWebhook(
    rawBody: Buffer,
    timestamp: string,
    signature: string,
  ): VerifiedWebhook {
    // Cashfree Subscriptions signs timestamp + original raw body with its webhook secret.
    const secret = this.config.getOrThrow('CASHFREE_WEBHOOK_SECRET');
    const expected = createHmac('sha256', secret)
      .update(timestamp)
      .update(rawBody)
      .digest();
    const actual = Buffer.from(signature, 'base64');
    if (
      !timestamp ||
      !signature ||
      actual.length !== expected.length ||
      !timingSafeEqual(actual, expected)
    ) {
      throw new UnauthorizedException('Invalid Cashfree webhook signature.');
    }
    try {
      return { payload: JSON.parse(rawBody.toString('utf8')) as unknown };
    } catch {
      throw new BadRequestException('Invalid Cashfree webhook payload.');
    }
  }
}
