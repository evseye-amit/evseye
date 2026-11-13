export type Operation = {
  source: string; id: string; riderId: string | null; state: string; amount: string | null;
  provider?: string; paymentId?: string | null; refundSupported?: boolean; refundReviewReason?: string | null;
  settlementId?: string; reviewCode?: string;
  captures?: { id: string; providerPaymentId: string; providerRefundId: string | null; amount: string; status: string; reason: string | null }[];
};

export function operationAction(item: Operation): 'RECOVER' | 'VERIFY_REFUND' | null {
  if (!item.riderId || ['MATCHED', 'LEGACY_SETTLED', 'REFUNDED'].includes(item.state)) return null;
  if (['CHECKOUT', 'AUTOPAY', 'DEPLOYMENT'].includes(item.source)) return 'RECOVER';
  if (item.source === 'REFUND' && !['FAILED', 'CANCELLED'].includes(item.state)) return 'VERIFY_REFUND';
  return null;
}

export type RefundDraft = { key: string; paymentId: string; riderId: string; amount: string; reason: string; treatment: 'UNALLOCATED_RETURN' | 'PAYMENT_REVERSAL' };
export function readRefundDraft(raw: string | null, paymentId: string, riderId: string): RefundDraft | null {
  if (!raw) return null;
  const value = JSON.parse(raw) as RefundDraft;
  if (value.paymentId !== paymentId || value.riderId !== riderId || typeof value.key !== 'string' ||
      !/^[A-Za-z0-9:_-]{8,120}$/.test(value.key) || typeof value.reason !== 'string' ||
      !/^[1-9]\d*(\.\d{1,2})?$/.test(value.amount) || !['UNALLOCATED_RETURN', 'PAYMENT_REVERSAL'].includes(value.treatment)) {
    throw new Error('The saved refund request could not be restored. Review the payment with support before requesting another refund.');
  }
  return value;
}
