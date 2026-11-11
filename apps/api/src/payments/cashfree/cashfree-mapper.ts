import { BadRequestException } from '@nestjs/common';
import type {
  MandateStatus,
  PaymentStatus,
  RefundStatus,
} from '../payment-provider.interface.js';

export function mandateStatus(value: unknown): MandateStatus {
  switch (String(value ?? '').toUpperCase()) {
    case 'INITIALIZED':
    case 'CREATED':
      return 'CREATED';
    case 'BANK_APPROVAL_PENDING':
    case 'PENDING':
    case 'AUTHORIZATION_PENDING':
      return 'AUTHORIZATION_PENDING';
    case 'ACTIVE':
      return 'ACTIVE';
    case 'ON_HOLD':
    case 'ONHOLD':
    case 'PAUSED':
    case 'CUSTOMER_PAUSED':
      return 'PAUSED';
    case 'CANCELLED':
    case 'CUSTOMER_CANCELLED':
      return 'CANCELLED';
    case 'FAILED':
    case 'AUTHENTICATION_FAILED':
      return 'FAILED';
    case 'EXPIRED':
    case 'LINK_EXPIRED':
    case 'CARD_EXPIRED':
    case 'COMPLETED':
      return 'EXPIRED';
    default:
      return 'UNKNOWN';
  }
}
export function paymentStatus(value: unknown): PaymentStatus {
  switch (String(value ?? '').toUpperCase()) {
    case 'SUCCESS':
      return 'SUCCESS';
    case 'FAILED':
      return 'FAILED';
    case 'CANCELLED':
      return 'CANCELLED';
    case 'PENDING':
    case 'INITIALIZED':
    case 'PROCESSING':
    case 'SCHEDULED':
      return 'PENDING';
    default:
      return 'UNKNOWN';
  }
}
export function refundStatus(value: unknown): RefundStatus {
  switch (String(value ?? '').toUpperCase()) {
    case 'SUCCESS':
      return 'SUCCESS';
    case 'FAILED':
    case 'CANCELLED':
      return 'FAILED';
    case 'PENDING':
    case 'PROCESSING':
    case 'INITIALIZED':
      return 'PENDING';
    default:
      return 'UNKNOWN';
  }
}
export function moneyToProvider(amount: string): number {
  if (!/^(0|[1-9]\d*)(\.\d{1,2})?$/.test(amount))
    throw new BadRequestException(
      'Amount must be a non-negative INR decimal with at most two places.',
    );
  const value = Number(amount);
  if (!Number.isSafeInteger(Math.round(value * 100)))
    throw new BadRequestException('Amount exceeds safe payment range.');
  return value;
}
export function providerErrorCategory(
  status: number,
  code?: string,
):
  | 'PROVIDER_UNAVAILABLE'
  | 'AUTHENTICATION_FAILED'
  | 'INVALID_REQUEST'
  | 'RATE_LIMITED'
  | 'UNKNOWN' {
  if (status === 401 || status === 403) return 'AUTHENTICATION_FAILED';
  if (status === 429) return 'RATE_LIMITED';
  if (status >= 500) return 'PROVIDER_UNAVAILABLE';
  if (
    status === 400 ||
    status === 404 ||
    status === 409 ||
    code === 'invalid_request'
  )
    return 'INVALID_REQUEST';
  return 'UNKNOWN';
}
