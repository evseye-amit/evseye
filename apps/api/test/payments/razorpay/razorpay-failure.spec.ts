import { describe, expect, it } from 'vitest';
import { classifyRazorpayFailure } from '../../../src/payments/razorpay/razorpay-failure.js';
describe('authoritative Razorpay failure classification', () => {
  it.each(['bank_not_available', 'bank_technical_error', 'insufficient_funds', 'payment_timed_out'])('allows policy-controlled retry for %s', error_reason => {
    expect(classifyRazorpayFailure([{ error_reason, error_code: 'BAD_REQUEST_ERROR' }])).toMatchObject({ failureCode: error_reason.toUpperCase(), retryability: 'RETRYABLE' });
  });
  it.each(['authentication_failed', 'invalid_amount', 'mandate_cancelled', 'payment_risk_check_failed'])('requires action for %s', error_reason => {
    expect(classifyRazorpayFailure([{ error_reason }]).retryability).toBe('NON_RETRYABLE');
  });
  it('fails closed for unclassified or mixed reasons', () => {
    expect(classifyRazorpayFailure([{ error_code: 'BAD_REQUEST_ERROR' }]).retryability).toBe('UNKNOWN');
    expect(classifyRazorpayFailure([{ error_reason: 'bank_not_available' }, {}]).retryability).toBe('UNKNOWN');
    expect(classifyRazorpayFailure([{ error_reason: 'bank_not_available' }, { error_reason: 'mandate_cancelled' }]).retryability).toBe('NON_RETRYABLE');
  });
});
