/** Provider-neutral contract. Amounts are decimal strings in INR. */
export type MandateStatus =
  | 'CREATED'
  | 'AUTHORIZATION_PENDING'
  | 'ACTIVE'
  | 'PAUSED'
  | 'CANCELLED'
  | 'FAILED'
  | 'EXPIRED'
  | 'UNKNOWN';
export type PaymentStatus =
  'PENDING' | 'SUCCESS' | 'FAILED' | 'CANCELLED' | 'UNKNOWN';
export type RefundStatus = 'PENDING' | 'SUCCESS' | 'FAILED' | 'UNKNOWN';
export type PaymentMethod = 'UPI_AUTOPAY' | 'ENACH';
export type MandateMode = 'ON_DEMAND' | 'PERIODIC';

export interface CreateMandateInput {
  providerMandateId: string;
  idempotencyKey: string;
  customer: { name: string; email?: string; phone: string };
  planName: string;
  mode: MandateMode;
  maxAmount: string;
  periodicAmount?: string;
  intervalType?: 'DAY' | 'WEEK' | 'MONTH' | 'YEAR';
  intervals?: number;
  firstChargeAt?: string;
  expiresAt: string;
  paymentMethods: PaymentMethod[];
  authorizationAmount?: string;
  refundAuthorizationAmount?: boolean;
}
export interface MandateResult {
  providerMandateId: string;
  status: MandateStatus;
  rawStatus: string;
  sessionId?: string;
}
export interface PaymentInput {
  providerMandateId: string;
  providerPaymentId: string;
  idempotencyKey: string;
  amount: string;
  scheduledAt: string;
  remarks?: string;
}
export interface PaymentResult {
  providerMandateId: string;
  providerPaymentId: string;
  status: PaymentStatus;
  rawStatus: string;
  amount?: string;
  paymentType?: string;
  providerReference?: string;
  authorizationUrl?: string;
}
export interface RefundInput {
  providerMandateId: string;
  providerPaymentId: string;
  providerRefundId: string;
  providerPaymentReference: string;
  amount: string;
  idempotencyKey: string;
  note?: string;
}
export interface RefundResult {
  providerRefundId: string;
  status: RefundStatus;
  rawStatus: string;
}
export interface VerifiedWebhook {
  payload: unknown;
}

export interface PaymentProvider {
  createMandate(input: CreateMandateInput): Promise<MandateResult>;
  fetchMandate(providerMandateId: string): Promise<MandateResult>;
  pauseMandate(
    providerMandateId: string,
    idempotencyKey: string,
  ): Promise<MandateResult>;
  resumeMandate(
    providerMandateId: string,
    idempotencyKey: string,
  ): Promise<MandateResult>;
  cancelMandate(
    providerMandateId: string,
    idempotencyKey: string,
  ): Promise<MandateResult>;
  authorizeMandate(input: PaymentInput): Promise<PaymentResult>;
  createPayment(input: PaymentInput): Promise<PaymentResult>;
  fetchPayment(
    providerMandateId: string,
    providerPaymentId: string,
  ): Promise<PaymentResult>;
  retryPayment(
    providerMandateId: string,
    providerPaymentId: string,
    nextScheduledAt: string,
    idempotencyKey: string,
  ): Promise<PaymentResult>;
  createRefund(input: RefundInput): Promise<RefundResult>;
  fetchRefund(
    providerMandateId: string,
    providerRefundId: string,
  ): Promise<RefundResult>;
  verifyWebhook(
    rawBody: Buffer,
    timestamp: string,
    signature: string,
  ): VerifiedWebhook;
}
export const PAYMENT_PROVIDER = Symbol('PAYMENT_PROVIDER');
