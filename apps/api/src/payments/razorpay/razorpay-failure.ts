// Classify only authoritative failed payments, never a timeout creating a debit.
// Exact reasons: https://github.com/razorpay/markdown-docs/blob/master/errors/payments/list.md
const transient = new Set(['bank_not_available', 'bank_technical_error', 'bank_cutoff_in_progress', 'payment_declined_due_to_high_traffic', 'insufficient_funds', 'insufficient_fund', 'payment_timed_out']);
const permanent = new Set(['authentication_failed', 'input_validation_failed', 'invalid_amount', 'invalid_currency', 'recurring_payment_not_enabled', 'payment_risk_check_failed', 'mandate_cancelled', 'mandate_expired', 'token_expired', 'token_revoked']);

export function classifyRazorpayFailure(payments: Array<{ error_reason?: string | null; error_code?: string | null }>) {
  const reasons = payments.map(p => (p.error_reason || p.error_code || 'UNKNOWN').toLowerCase());
  const retryability = reasons.some(r => permanent.has(r)) ? 'NON_RETRYABLE'
    : reasons.length && reasons.every(r => transient.has(r)) ? 'RETRYABLE' : 'UNKNOWN';
  return { failureCode: (reasons.find(r => permanent.has(r)) ?? reasons[0] ?? 'UNKNOWN').toUpperCase(), retryability } as const;
}
