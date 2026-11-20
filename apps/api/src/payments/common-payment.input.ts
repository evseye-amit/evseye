import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';

const amount = z
  .string()
  .regex(/^(?:0|[1-9]\d{0,11})(?:\.\d{1,2})?$/)
  .optional();
export const paymentOrderInput = z.discriminatedUnion('purpose', [
  z
    .object({
      purpose: z.literal('DEPLOYMENT'),
      allocationId: z.string().uuid(),
      setupAutoPay: z.boolean().optional(),
      email: z.string().trim().email().max(254).optional(),
      autoPayConsent: z.object({ accepted: z.literal(true), version: z.enum(['deployment-autopay-v1', 'unified-autopay-v1']), consentRevision: z.number().int().positive().optional(), maxAmount: z.string().regex(/^[1-9]\d*(\.\d{1,2})?$/), validityDays: z.number().int().positive() }).strict().optional(),
    })
    .strict(),
  z
    .object({
      purpose: z.literal('SUBMISSION_PENALTY'),
      provider: z.enum(['RAZORPAY', 'CASHFREE']).optional(),
      amount,
    })
    .strict(),
  z
    .object({
      purpose: z.literal('INVOICE'),
      provider: z.enum(['RAZORPAY', 'CASHFREE']).optional(),
      invoiceId: z.string().uuid(),
      useWallet: z.boolean().optional(),
    })
    .strict(),
  z.object({ purpose: z.literal('OUTSTANDING'), amount }).strict(),
  z.object({ purpose: z.literal('TOP_UP'), amount: z.string() }).strict(),
  z
    .object({
      purpose: z.literal('SECURITY_DEPOSIT'),
      depositId: z.string().uuid(),
    })
    .strict(),
]);
export const razorpayCallbackInput = z
  .object({
    razorpayOrderId: z.string().regex(/^order_[A-Za-z0-9]+$/),
    razorpayPaymentId: z.string().regex(/^pay_[A-Za-z0-9]+$/),
    razorpaySignature: z.string().regex(/^[a-fA-F0-9]{64}$/),
  })
  .strict();
export function parseOrderInput(body: unknown) {
  const result = paymentOrderInput.safeParse(body);
  if (!result.success)
    throw new BadRequestException({ code: 'VALIDATION_FAILED', message: 'Provide a supported payment purpose and only its allowed fields.' });
  if (result.data.purpose === 'DEPLOYMENT' && result.data.setupAutoPay && !result.data.email)
    throw new BadRequestException({ code: 'VALIDATION_FAILED', message: 'Email is required for combined AutoPay checkout.' });
  return result.data;
}
export function parseRazorpayCallback(body: unknown) {
  const result = razorpayCallbackInput.safeParse(body);
  if (!result.success)
    throw new BadRequestException(
      'A valid Razorpay order ID, payment ID and signature are required.',
    );
  return result.data;
}
export function parsePaymentRequestId(id: string) {
  const result = z
    .string()
    .regex(
      /^(collection|deployment):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    )
    .safeParse(id);
  if (!result.success)
    throw new BadRequestException('Invalid payment request ID.');
  const [kind, recordId] = id.split(':');
  return { kind, recordId };
}
