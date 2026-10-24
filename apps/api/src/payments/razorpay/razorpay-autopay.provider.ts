import {
  BadRequestException,
  ConflictException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Prisma,
  type PaymentMandate,
  type PaymentTransaction,
} from '@prisma/client';
import { z } from 'zod';
import { PENALTY_INVOICE } from '../../submission-penalties/penalty-accounting.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { AutoPayProvider } from '../autopay-provider.interface.js';
import {
  ProviderRequestError,
  type CreateMandateInput,
  type MandateResult,
  type PaymentInput,
  type PaymentResult,
} from '../payment-provider.interface.js';
import { RazorpayProviderError } from './razorpay.client.js';
import {
  RazorpayRecurringClient,
  type RazorpayRegistration,
} from './razorpay-recurring.client.js';

const leadMs = 25 * 3600000;
const states: Record<string, MandateResult['status']> = {
  confirmed: 'ACTIVE',
  initiated: 'AUTHORIZATION_PENDING',
  paused: 'PAUSED',
  rejected: 'FAILED',
  cancelled: 'CANCELLED',
  expired: 'EXPIRED',
};
const paise = (value: string | Prisma.Decimal) => {
  const amount = new Prisma.Decimal(value).mul(100);
  if (
    !amount.isInteger() ||
    amount.lt(100) ||
    amount.gt(Number.MAX_SAFE_INTEGER)
  )
    throw new BadRequestException(
      'Razorpay AutoPay amounts must be at least INR 1 with at most two decimal places.',
    );
  return amount.toNumber();
};
@Injectable()
export class RazorpayAutoPayProvider implements AutoPayProvider {
  constructor(
    private readonly db: PrismaService,
    private readonly gateway: RazorpayRecurringClient,
    private readonly config: ConfigService,
  ) {}
  private assertNew(clientId: string, keyId?: string | null) {
    this.gateway.assertConfigured(clientId, keyId ?? undefined);
    if (this.config.get('RAZORPAY_AUTOPAY_ENABLED') !== 'true')
      throw new ServiceUnavailableException({
        code: 'RAZORPAY_AUTOPAY_UNAVAILABLE',
        message: 'Razorpay UPI AutoPay is not enabled for this environment.',
      });
  }
  private async mandate(reference: string) {
    const m = await this.db.paymentMandate.findUnique({
      where: { providerMandateId: reference },
    });
    if (!m || m.provider !== 'RAZORPAY')
      throw new ConflictException('Razorpay mandate is not registered.');
    this.gateway.assertConfigured(m.clientId, m.providerKeyId ?? undefined);
    return m;
  }
  private result(
    m: PaymentMandate,
    status: MandateResult['status'],
    rawStatus: string,
  ): MandateResult {
    return { providerMandateId: m.providerMandateId, status, rawStatus };
  }
  assertChargeEligible(input: {
    amount: string;
    currency: string;
    scheduledAt: Date;
  }) {
    // Phase 1 deliberately stays within the regular-industry unattended debit band.
    if (input.currency !== 'INR' || paise(input.amount) > 1500000)
      throw new BadRequestException(
        'Razorpay unattended UPI AutoPay supports INR 1.00–15,000.00 per debit in this integration.',
      );
    if (input.scheduledAt.getTime() < Date.now() + leadMs)
      throw new BadRequestException(
        'Schedule Razorpay AutoPay at least 25 hours ahead for pre-debit notification.',
      );
  }
  assertMandateEligible(clientId: string, input: CreateMandateInput) {
    this.assertNew(clientId);
    if (
      input.paymentMethods.length !== 1 ||
      input.paymentMethods[0] !== 'UPI_AUTOPAY'
    )
      throw new BadRequestException(
        'Razorpay AutoPay currently supports UPI mandates only.',
      );
    if (!z.string().email().safeParse(input.customer.email).success)
      throw new BadRequestException(
        'A valid Rider email address is required for Razorpay AutoPay registration.',
      );
    const maximum = paise(input.maxAmount);
    if (maximum > 1500000)
      throw new BadRequestException(
        'Configure the Razorpay UPI mandate limit at INR 15,000.00 or below for unattended debits.',
      );
    const authAmount = paise(input.authorizationAmount ?? '1.00');
    if (authAmount > maximum)
      throw new BadRequestException(
        'Authorisation amount cannot exceed the mandate maximum.',
      );
  }
  async createMandate(input: CreateMandateInput): Promise<MandateResult> {
    let m = await this.mandate(input.providerMandateId);
    this.assertNew(m.clientId, m.providerKeyId);
    this.assertMandateEligible(m.clientId, input);
    const maximum = paise(input.maxAmount);
    const authAmount = paise(input.authorizationAmount ?? '1.00');
    if (m.providerRegistrationId) return this.fetchMandate(m.providerMandateId);
    const claim = await this.db.paymentMandate.updateMany({
      where: { id: m.id, providerCreateClaimedAt: null },
      data: {
        providerCustomerEmail: input.customer.email,
        providerCreateClaimedAt: new Date(),
        providerKeyId: this.gateway.keyId,
        providerFrequency: 'as_presented',
        authorizationAmount: new Prisma.Decimal(authAmount).div(100),
        providerTermsSnapshot: {
          version: 1,
          maxAmountPaise: maximum,
          authorizationAmountPaise: authAmount,
          frequency: 'as_presented',
          expiresAt: m.expiresAt.toISOString(),
        },
      },
    });
    m = await this.mandate(input.providerMandateId);
    if (!claim.count) return this.fetchMandate(m.providerMandateId);
    try {
      const remote = await this.gateway.createRegistration({
        customer: {
          name: input.customer.name,
          email: input.customer.email,
          contact: input.customer.phone,
        },
        type: 'link',
        amount: authAmount,
        currency: 'INR',
        description: 'EVsEye UPI AutoPay authorisation',
        receipt: m.id,
        subscription_registration: {
          method: 'upi',
          max_amount: maximum,
          expire_at: Math.floor(m.expiresAt.getTime() / 1000),
          frequency: 'as_presented',
        },
        // The authorisation link expires independently of the mandate's validity.
        expire_by: Math.floor(
          Math.min(m.expiresAt.getTime(), Date.now() + 86400000) / 1000,
        ),
        sms_notify: true,
        email_notify: true,
        notes: { purpose: 'AUTOPAY_AUTHORIZATION', mandateId: m.id },
      });
      await this.bindRegistration(m, remote);
      return this.fetchMandate(m.providerMandateId);
    } catch (error) {
      if (error instanceof RazorpayProviderError && error.definitive)
        throw new ProviderRequestError('INVALID_REQUEST');
      throw error;
    }
  }
  private async bindRegistration(
    m: PaymentMandate,
    remote: RazorpayRegistration,
  ) {
    if (
      remote.receipt !== m.id ||
      remote.currency !== 'INR' ||
      remote.amount !== paise(m.authorizationAmount ?? '1.00') ||
      (m.providerRegistrationId && m.providerRegistrationId !== remote.id) ||
      (m.providerCustomerId && m.providerCustomerId !== remote.customer_id) ||
      (m.providerAuthorizationOrderId &&
        m.providerAuthorizationOrderId !== remote.order_id)
    )
      throw new ConflictException('Razorpay authorisation identity mismatch.');
    if (remote.short_url) {
      const url = new URL(remote.short_url);
      if (
        url.protocol !== 'https:' ||
        !['rzp.io', 'razorpay.com', 'rzp.co'].some(
          (host) => url.hostname === host || url.hostname.endsWith(`.${host}`),
        )
      )
        throw new ConflictException('Invalid Razorpay authorisation URL.');
    }
    return this.db.paymentMandate.update({
      where: { id: m.id },
      data: {
        providerRegistrationId: remote.id,
        providerCustomerId: remote.customer_id,
        providerAuthorizationOrderId: remote.order_id,
        authorizationUrl: remote.short_url,
      },
    });
  }
  async fetchMandate(reference: string): Promise<MandateResult> {
    let m = await this.mandate(reference);
    await this.db.paymentMandate.update({
      where: { id: m.id },
      data: { providerCheckedAt: new Date() },
    });
    if (!m.providerRegistrationId) {
      if (
        !m.providerCreateClaimedAt ||
        Date.now() - m.providerCreateClaimedAt.getTime() < 30000
      )
        return this.result(m, 'UNKNOWN', 'REGISTRATION_CREATE_PENDING');
      const matches = await this.gateway.findRegistrations(
        m.id,
        m.providerCreateClaimedAt,
      );
      if (matches.length !== 1)
        return this.result(m, 'UNKNOWN', 'REGISTRATION_CREATE_REQUIRES_REVIEW');
      m = await this.bindRegistration(m, matches[0]);
    }
    const registration = await this.gateway.fetchRegistration(
      m.providerRegistrationId!,
    );
    m = await this.bindRegistration(m, registration);
    if (registration.status === 'cancelled')
      return this.result(m, 'CANCELLED', 'REGISTRATION_CANCELLED');
    if (registration.status === 'expired')
      return this.result(m, 'EXPIRED', 'REGISTRATION_EXPIRED');
    if (!registration.payment_id || !registration.order_id)
      return this.result(m, 'AUTHORIZATION_PENDING', 'REGISTRATION_PENDING');
    const payment = await this.gateway.recurringPayment(
      registration.payment_id,
    );
    if (
      payment.id !== registration.payment_id ||
      payment.order_id !== registration.order_id ||
      payment.customer_id !== registration.customer_id ||
      payment.amount !== paise(m.authorizationAmount!) ||
      payment.currency !== m.currency ||
      payment.method !== 'upi'
    )
      throw new ConflictException('Razorpay authorisation payment mismatch.');
    if (
      !payment.token_id ||
      !payment.captured ||
      !['captured', 'refunded'].includes(payment.status)
    )
      return this.result(
        m,
        'AUTHORIZATION_PENDING',
        'AUTHORISATION_NOT_CAPTURED',
      );
    if (m.providerTokenId && m.providerTokenId !== payment.token_id)
      throw new ConflictException('Razorpay authorisation token changed.');
    const token = await this.gateway.fetchToken(
      registration.customer_id,
      payment.token_id,
    );
    if (
      token.id !== payment.token_id ||
      token.method !== 'upi' ||
      (!token.recurring &&
        !['cancelled', 'rejected', 'expired'].includes(
          token.recurring_details.status,
        ))
    )
      throw new ConflictException('Razorpay mandate token mismatch.');
    const expiry = token.expired_at
      ? new Date(Math.min(m.expiresAt.getTime(), token.expired_at * 1000))
      : m.expiresAt;
    const maximum = token.max_amount
      ? Prisma.Decimal.min(
          m.maxAmount,
          new Prisma.Decimal(token.max_amount).div(100),
        )
      : m.maxAmount;
    await this.db.paymentMandate.update({
      where: { id: m.id },
      data: {
        providerTokenId: token.id,
        providerAuthorizationPaymentId: payment.id,
        expiresAt: expiry,
        maxAmount: maximum,
      },
    });
    const status =
      expiry <= new Date()
        ? 'EXPIRED'
        : (states[token.recurring_details.status] ?? 'UNKNOWN');
    return this.result(
      m,
      status,
      m.providerCancelRequestedAt && status !== 'CANCELLED'
        ? 'CANCELLATION_PENDING'
        : token.recurring_details.status.toUpperCase(),
    );
  }
  async cancelMandate(reference: string, _key: string): Promise<MandateResult> {
    await this.fetchMandate(reference);
    const m = await this.mandate(reference);
    // Stop new local schedules while remote cancellation is being confirmed.
    await this.db.paymentMandate.update({
      where: { id: m.id },
      data: {
        autoDebitEnabled: false,
        providerCancelRequestedAt: m.providerCancelRequestedAt ?? new Date(),
      },
    });
    if (m.providerTokenId && m.providerCustomerId) {
      const token = await this.gateway.fetchToken(
        m.providerCustomerId,
        m.providerTokenId,
      );
      if (token.recurring_details.status !== 'cancelled')
        await this.gateway.cancelToken(m.providerCustomerId, m.providerTokenId);
    } else if (m.providerRegistrationId) {
      const registration = await this.gateway.fetchRegistration(
        m.providerRegistrationId,
      );
      if (!['cancelled', 'expired'].includes(registration.status))
        await this.gateway.cancelRegistration(m.providerRegistrationId);
    } else
      throw new ConflictException(
        'Registration creation is uncertain. Reconcile it before cancellation.',
      );
    return this.fetchMandate(reference);
  }
  async pauseMandate(_reference: string, _key: string): Promise<MandateResult> {
    throw new BadRequestException({
      code: 'MANDATE_ACTION_UNSUPPORTED',
      message:
        'Pause this bank mandate in the UPI app. Use AutoPay disable to stop new EVsEye collection requests.',
    });
  }
  async resumeMandate(
    _reference: string,
    _key: string,
  ): Promise<MandateResult> {
    throw new BadRequestException({
      code: 'MANDATE_ACTION_UNSUPPORTED',
      message:
        'Resume this bank mandate in the UPI app, then verify its status before enabling collection.',
    });
  }

  private async transaction(reference: string, paymentReference: string) {
    const m = await this.mandate(reference);
    const t = await this.db.paymentTransaction.findFirst({
      where: {
        provider: 'RAZORPAY',
        providerPaymentId: paymentReference,
        mandateId: m.id,
        clientId: m.clientId,
      },
    });
    if (!t)
      throw new ConflictException('Razorpay AutoPay debit is not registered.');
    return { m, t };
  }
  private paymentResult(
    m: PaymentMandate,
    t: PaymentTransaction,
    status: PaymentResult['status'],
    rawStatus: string,
    extra: Partial<PaymentResult> = {},
  ): PaymentResult {
    return {
      providerMandateId: m.providerMandateId,
      providerPaymentId: t.providerPaymentId,
      status,
      rawStatus,
      ...extra,
    };
  }
  private async bindOrder(
    t: PaymentTransaction,
    remote: {
      id: string;
      receipt: string | null;
      amount: number;
      currency: string;
    },
  ) {
    if (
      remote.receipt !== t.id ||
      remote.amount !== paise(t.amount) ||
      remote.currency !== t.currency ||
      (t.providerOrderId && t.providerOrderId !== remote.id)
    )
      throw new ConflictException('Razorpay recurring order mismatch.');
    return this.db.paymentTransaction.update({
      where: { id: t.id },
      data: { providerOrderId: remote.id },
    });
  }
  async createPayment(input: PaymentInput): Promise<PaymentResult> {
    let { m, t } = await this.transaction(
      input.providerMandateId,
      input.providerPaymentId,
    );
    this.assertNew(m.clientId, m.providerKeyId);
    if (
      !t.amount.eq(input.amount) ||
      new Date(input.scheduledAt).getTime() !== t.scheduledAt.getTime()
    )
      throw new ConflictException(
        'Razorpay recurring request does not match its saved amount/schedule.',
      );
    if (!t.providerOrderId && !t.providerOrderClaimedAt) {
      const profile = await this.db.riderPaymentProfile.findUnique({
        where: {
          clientId_riderId: { clientId: t.clientId, riderId: t.riderId },
        },
      });
      if (
        !m.autoDebitEnabled ||
        !profile?.autoPayEnabled ||
        m.providerCancelRequestedAt
      )
        return this.paymentResult(m, t, 'CANCELLED', 'LOCAL_AUTOPAY_DISABLED');
    }
    if (!t.providerOrderId) {
      this.assertChargeEligible({
        amount: t.amount.toFixed(2),
        currency: t.currency,
        scheduledAt: t.scheduledAt,
      });
      const claim = await this.db.paymentTransaction.updateMany({
        where: { id: t.id, providerOrderClaimedAt: null },
        data: {
          providerOrderClaimedAt: new Date(),
          providerKeyId: this.gateway.keyId,
        },
      });
      t = (await this.transaction(m.providerMandateId, t.providerPaymentId)).t;
      try {
        if (claim.count) {
          const verified = await this.fetchMandate(m.providerMandateId);
          m = await this.mandate(m.providerMandateId);
          if (
            verified.status !== 'ACTIVE' ||
            !m.autoDebitEnabled ||
            !m.providerTokenId
          )
            return this.paymentResult(m, t, 'CANCELLED', 'MANDATE_NOT_ACTIVE');
          t = await this.bindOrder(
            t,
            await this.gateway.createDebitOrder(
              paise(t.amount),
              t.id,
              m.providerTokenId,
              t.scheduledAt,
            ),
          );
        } else {
          if (
            !t.providerOrderClaimedAt ||
            Date.now() - t.providerOrderClaimedAt.getTime() < 30000
          )
            return this.paymentResult(m, t, 'UNKNOWN', 'ORDER_CREATE_PENDING');
          const matches = await this.gateway.findOrders(t.id);
          if (matches.length !== 1)
            return this.paymentResult(
              m,
              t,
              'UNKNOWN',
              'ORDER_CREATE_REQUIRES_REVIEW',
            );
          t = await this.bindOrder(t, matches[0]);
        }
      } catch (error) {
        if (error instanceof RazorpayProviderError && error.definitive)
          throw new ProviderRequestError('INVALID_REQUEST');
        throw error;
      }
    }
    return this.fetchPayment(m.providerMandateId, t.providerPaymentId);
  }
  async fetchPayment(
    reference: string,
    paymentReference: string,
  ): Promise<PaymentResult> {
    let { m, t } = await this.transaction(reference, paymentReference);
    this.gateway.assertConfigured(
      m.clientId,
      t.providerKeyId ?? m.providerKeyId ?? undefined,
    );
    await this.db.paymentTransaction.update({
      where: { id: t.id },
      data: { providerCheckedAt: new Date() },
    });
    if (!t.providerOrderId) {
      if (t.providerOrderClaimedAt) {
        const matches = await this.gateway.findOrders(t.id);
        if (matches.length !== 1)
          return this.paymentResult(
            m,
            t,
            'UNKNOWN',
            'ORDER_CREATE_REQUIRES_REVIEW',
          );
        t = await this.bindOrder(t, matches[0]);
      } else if (['CANCELLED', 'FAILED'].includes(t.status))
        return this.paymentResult(
          m,
          t,
          t.status as 'CANCELLED' | 'FAILED',
          'NO_DEBIT_SUBMITTED',
        );
      else
        return this.createPayment({
          providerMandateId: reference,
          providerPaymentId: paymentReference,
          idempotencyKey: t.id,
          amount: t.amount.toFixed(2),
          scheduledAt: t.scheduledAt.toISOString(),
        });
    }
    const remotes = await this.gateway.recurringOrderPayments(
      t.providerOrderId!,
    );
    if (
      t.gatewayPaymentId &&
      !remotes.some((payment) => payment.id === t.gatewayPaymentId)
    ) {
      const payment = await this.gateway.recurringPayment(t.gatewayPaymentId);
      if (payment.id !== t.gatewayPaymentId)
        throw new ConflictException(
          'Razorpay recurring payment identity mismatch.',
        );
      remotes.push(payment);
    }
    for (const payment of remotes) {
      if (
        payment.order_id !== t.providerOrderId ||
        payment.amount !== paise(t.amount) ||
        payment.currency !== t.currency ||
        (payment.customer_id != null &&
          payment.customer_id !== m.providerCustomerId) ||
        (payment.token_id != null && payment.token_id !== m.providerTokenId) ||
        (payment.method != null && payment.method !== 'upi') ||
        (payment.captured &&
          (payment.customer_id !== m.providerCustomerId ||
            payment.token_id !== m.providerTokenId ||
            payment.method !== 'upi'))
      )
        throw new ConflictException(
          'Razorpay recurring payment proof mismatch.',
        );
    }
    const captures = remotes.filter(
      (p) => p.captured && ['captured', 'refunded'].includes(p.status),
    );
    for (const payment of captures) {
      const existing = await this.db.razorpayAutoPayCapture.findUnique({
        where: { providerPaymentId: payment.id },
      });
      if (existing && existing.transactionId !== t.id)
        throw new ConflictException(
          'Razorpay payment has already been used for another debit.',
        );
      const reason =
        captures.length > 1
          ? 'MULTIPLE_CAPTURES_REQUIRE_REVIEW'
          : payment.amount_refunded > 0 || payment.status === 'refunded'
            ? 'EXTERNAL_REFUND_REQUIRES_REVIEW'
            : null;
      await this.db.razorpayAutoPayCapture.upsert({
        where: { providerPaymentId: payment.id },
        create: {
          transactionId: t.id,
          providerPaymentId: payment.id,
          amountPaise: BigInt(payment.amount),
          currency: payment.currency,
          status: reason ? 'REVIEW_REQUIRED' : 'OBSERVED',
          reason,
        },
        update: reason ? { status: 'REVIEW_REQUIRED', reason } : {},
      });
      if (reason) {
        await this.db.paymentTransaction.update({
          where: { id: t.id },
          data: { failureCode: reason, retryability: 'NON_RETRYABLE' },
        });
      }
    }
    if (
      captures.length > 1 ||
      captures.some((p) => p.amount_refunded > 0 || p.status === 'refunded')
    )
      return this.paymentResult(m, t, 'UNKNOWN', 'CAPTURE_REQUIRES_REVIEW', {
        failureCode:
          captures.length > 1
            ? 'MULTIPLE_CAPTURES_REQUIRE_REVIEW'
            : 'EXTERNAL_REFUND_REQUIRES_REVIEW',
        retryability: 'NON_RETRYABLE',
      });
    if (captures.length === 1) {
      const payment = captures[0];
      await this.db.paymentTransaction.update({
        where: { id: t.id },
        data: { gatewayPaymentId: payment.id },
      });
      return this.paymentResult(m, t, 'SUCCESS', 'CAPTURED', {
        amount: new Prisma.Decimal(payment.amount).div(100).toFixed(2),
        paymentType: 'CHARGE',
        providerReference: payment.id,
      });
    }
    if (remotes.some((p) => ['authorized', 'created'].includes(p.status)))
      return this.paymentResult(
        m,
        t,
        'PENDING',
        'AWAITING_GATEWAY_CONFIRMATION',
      );
    if (remotes.length)
      return this.paymentResult(m, t, 'FAILED', 'FAILED', {
        failureCode: remotes[0].error_code ?? 'PROVIDER_DECLINED',
        retryability: 'UNKNOWN',
      });
    if (t.providerDebitClaimedAt)
      return this.paymentResult(
        m,
        t,
        t.failureCode === 'PROVIDER_REJECTED' ? 'FAILED' : 'UNKNOWN',
        'DEBIT_CREATE_UNCERTAIN',
        {
          failureCode: t.failureCode ?? 'DEBIT_CREATE_UNCERTAIN',
          retryability: 'UNKNOWN',
        },
      );
    if (['CANCELLED', 'FAILED'].includes(t.status))
      return this.paymentResult(
        m,
        t,
        t.status as 'CANCELLED' | 'FAILED',
        'NO_DEBIT_SUBMITTED',
      );
    // Claim before the debit POST. Recovery polls this order rather than submitting twice.
    this.assertNew(m.clientId, m.providerKeyId);
    const invoice = await this.db.riderInvoice.findFirst({
      where: { id: t.invoiceId, clientId: t.clientId, riderId: t.riderId },
    });
    const profile = await this.db.riderPaymentProfile.findUnique({
      where: { clientId_riderId: { clientId: t.clientId, riderId: t.riderId } },
    });
    const verified = await this.fetchMandate(m.providerMandateId);
    m = await this.mandate(m.providerMandateId);
    if (
      !invoice ||
      invoice.invoiceType === PENALTY_INVOICE ||
      !['FINALIZED', 'PARTIALLY_PAID', 'OVERDUE'].includes(invoice.status) ||
      !invoice.outstandingAmount.eq(t.amount) ||
      verified.status !== 'ACTIVE' ||
      !m.autoDebitEnabled ||
      !profile?.autoPayEnabled ||
      m.expiresAt <= t.scheduledAt
    )
      return this.paymentResult(
        m,
        t,
        'CANCELLED',
        'OBLIGATION_OR_MANDATE_CHANGED',
      );
    if (!m.providerCustomerId || !m.providerTokenId || t.amount.gt(m.maxAmount))
      throw new ConflictException(
        'Razorpay confirmed mandate cannot cover this debit.',
      );
    const rider = await this.db.rider.findFirst({
      where: { clientId: m.clientId, id: m.riderId },
      select: { mobile: true },
    });
    if (
      !rider ||
      !z.string().email().safeParse(m.providerCustomerEmail).success
    )
      throw new BadRequestException(
        'A valid Rider email is required for recurring collection.',
      );
    const claim = await this.db.paymentTransaction.updateMany({
      where: { id: t.id, providerDebitClaimedAt: null },
      data: { providerDebitClaimedAt: new Date() },
    });
    if (!claim.count)
      return this.paymentResult(m, t, 'UNKNOWN', 'DEBIT_CREATE_PENDING');
    try {
      const response = await this.gateway.createRecurringPayment({
        customerId: m.providerCustomerId,
        tokenId: m.providerTokenId,
        orderId: t.providerOrderId!,
        amount: paise(t.amount),
        email: m.providerCustomerEmail!,
        contact: rider.mobile,
      });
      await this.db.paymentTransaction.update({
        where: { id: t.id },
        data: { gatewayPaymentId: response.razorpay_payment_id },
      });
      return this.paymentResult(
        m,
        t,
        'PENDING',
        'AWAITING_PREDEBIT_AND_CAPTURE',
        { providerReference: response.razorpay_payment_id },
      );
    } catch (error) {
      if (error instanceof RazorpayProviderError && error.definitive)
        throw new ProviderRequestError('INVALID_REQUEST');
      throw error;
    }
  }
}
