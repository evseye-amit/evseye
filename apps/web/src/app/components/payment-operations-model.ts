export type Operation = {
  source: string; id: string; riderId: string | null; state: string; amount: string | null;
  riderName?: string | null; riderCode?: string | null; provider?: string; paymentId?: string | null; refundSupported?: boolean; refundReviewReason?: string | null;
  settlementId?: string; reviewCode?: string;
  providerRefundId?: string | null; aged?: boolean;
  captures?: { id: string; providerPaymentId: string; providerRefundId: string | null; amount: string; status: string; reason: string | null }[];
};

export function filterOperations(items: Operation[], query: string, provider: string, state: string) {
  const needle = query.trim().toLowerCase();
  return items.filter(item => (!provider || item.provider === provider) && (!state || item.state === state) &&
    (!needle || [item.id, item.riderId, item.riderName, item.riderCode, item.paymentId, item.providerRefundId, item.source, item.reviewCode,
      ...((item.captures ?? []).flatMap(capture => [capture.providerPaymentId, capture.providerRefundId]))]
      .some(value => value?.toLowerCase().includes(needle))));
}

/** Quote every field and neutralize spreadsheet formulas in exported references. */
export function operationsCsv(rows: Record<string, unknown>[]): string {
  const columns = [...new Set(rows.flatMap(row => Object.keys(row)))];
  const cell = (value: unknown) => {
    let text = value == null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
    if (/^[\s]*[=+@-]/.test(text) || /^[\t\r\n]/.test(text)) text = "'" + text;
    return '"' + text.replaceAll('"', '""') + '"';
  };
  return [columns.map(cell).join(','), ...rows.map(row => columns.map(column => cell(row[column])).join(','))].join('\r\n');
}

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
