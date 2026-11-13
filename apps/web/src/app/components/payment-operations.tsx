"use client";

import { useCallback, useEffect, useRef, useState } from 'react';
import { sessionFetch } from '../../lib/session-fetch';
import { formatMoney, formatDateTime } from '../../lib/presentation';
import { ClientDataTable } from './client-data-table';
import { ClientFormDialog } from './client-form-dialog';
import { operationAction, readRefundDraft, type Operation, type RefundDraft } from './payment-operations-model';

type Settlement = { id: string; provider: string; providerSettlementId: string; currency: string; netAmount: string; status: string; settledAt: string;
  items?: { id: string; kind: string; providerReference: string; amount: string; status: string; reviewCode: string | null }[] };
type Mandate = { id: string; riderId: string; provider: string; mandateNumber: string; status: string; autoDebitEnabled: boolean };
type ImportReport = { provider?: string; providerSettlementId: string; currency: string; netAmount: string; items: unknown[] };
async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await sessionFetch(`/api/v1/client/${path}`, init);
  const body = await response.json();
  if (!response.ok) throw new Error(body.error?.message ?? body.message ?? 'Payment operation failed.');
  return (body.data ?? body) as T;
}
const post = (body: unknown, key?: string): RequestInit => ({ method: 'POST', headers: { 'Content-Type': 'application/json', ...(key ? { 'Idempotency-Key': key } : {}) }, body: JSON.stringify(body) });
const enc = encodeURIComponent;

export function PaymentOperations({ identityKey, refreshKey = 0 }: { identityKey: string; refreshKey?: number }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Operation[]>([]), [settlements, setSettlements] = useState<Settlement[]>([]), [mandates, setMandates] = useState<Mandate[]>([]);
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false);
  const [view, setView] = useState<'payments' | 'settlements' | 'autopay'>('payments');
  const [detail, setDetail] = useState<Operation | null>(null), [settlement, setSettlement] = useState<Settlement | null>(null);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [draft, setDraft] = useState<RefundDraft | null>(null), [submitted, setSubmitted] = useState(false);
  const generation = useRef(0), active = useRef(true), mutation = useRef(false);
  useEffect(() => { const requests = generation; active.current = true; return () => { active.current = false; requests.current++; }; }, []);
  const storageKey = (paymentId: string) => `payment-refund:${identityKey}:${paymentId}`;
  const load = useCallback(async () => {
    const current = ++generation.current;
    setBusy(true); setError('');
    try {
      const [reconciliation, reports, subscriptions] = await Promise.all([
        api<{ items: Operation[] }>('payment-reconciliation'), api<Settlement[]>('finance/provider-settlements'), api<Mandate[]>('autopay/mandates'),
      ]);
      if (!active.current || current !== generation.current) return;
      setItems(reconciliation.items); setSettlements(reports); setMandates(subscriptions);
    } catch (cause) { if (active.current && current === generation.current) setError(cause instanceof Error ? cause.message : 'Unable to load operations.'); }
    finally { if (active.current && current === generation.current) setBusy(false); }
  }, []);
  useEffect(() => { if (!open) return; const timer = setTimeout(() => void load(), 0); return () => clearTimeout(timer); }, [open, refreshKey, load]);
  async function run(work: () => Promise<void>) {
    if (mutation.current) return;
    mutation.current = true; setBusy(true); setError(''); setNotice('');
    try { await work(); if (active.current) await load(); }
    catch (cause) { if (active.current) setError(cause instanceof Error ? cause.message : 'Payment operation failed.'); }
    finally { mutation.current = false; if (active.current) setBusy(false); }
  }
  function recover(item: Operation) {
    const action = operationAction(item); if (!action || !item.riderId) return;
    void run(async () => {
      await api(action === 'VERIFY_REFUND'
        ? `riders/${enc(item.riderId!)}/payments/refunds/${enc(item.id)}/verify`
        : `payment-reconciliation/${enc(item.riderId!)}/${enc(item.id)}/retry`, post({ ...(action === 'RECOVER' ? { source: item.source } : {}) }));
      if (active.current) setNotice('Provider status checked. Review the refreshed state before taking another action.');
    });
  }
  function openRefund(item: Operation) {
    if (!item.refundSupported || !item.paymentId || !item.riderId) return;
    try {
      const saved = readRefundDraft(sessionStorage.getItem(storageKey(item.paymentId)), item.paymentId, item.riderId);
      setDraft(saved ?? { key: crypto.randomUUID(), paymentId: item.paymentId, riderId: item.riderId, amount: '', reason: '', treatment: 'UNALLOCATED_RETURN' });
      setSubmitted(Boolean(saved)); setError('');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to restore the refund request.'); }
  }
  function submitRefund() {
    if (!draft) return;
    const request = { ...draft, reason: draft.reason.trim() };
    void run(async () => {
      // Persistence must succeed before the financial request. Transport retries reuse this exact body/key.
      sessionStorage.setItem(storageKey(request.paymentId), JSON.stringify(request));
      setSubmitted(true);
      const result = await api<{ status: string }>(`riders/${enc(request.riderId)}/payments/${enc(request.paymentId)}/refunds`, post({ amount: request.amount, reason: request.reason, treatment: request.treatment }, request.key));
      sessionStorage.removeItem(storageKey(request.paymentId));
      if (active.current) { setDraft(null); setNotice(`Refund recorded: ${result.status}. Provider verification determines completion.`); }
    });
  }
  async function selectReport(file: File | undefined) {
    setReport(null); setError(''); if (!file) return;
    try {
      if (file.size > 1_000_000) throw new Error('Report must be smaller than 1 MB.');
      const parsed = JSON.parse(await file.text()) as ImportReport;
      if (!parsed || !['CASHFREE', 'RAZORPAY'].includes(parsed.provider ?? 'CASHFREE') || typeof parsed.providerSettlementId !== 'string' || !Array.isArray(parsed.items)) throw new Error('Select a normalized Cashfree or Razorpay settlement report.');
      if (active.current) setReport(parsed);
    } catch (cause) { if (active.current) setError(cause instanceof Error ? cause.message : 'Invalid report.'); }
  }
  return <section className="client-manager-actions">
    <button type="button" className="secondary" onClick={() => setOpen(!open)}>{open ? 'Hide online payment operations' : 'Online payment operations'}</button>
    {open && <>
      <p className="muted">Check gateway payments, refunds, AutoPay mandates and settlement exceptions. Each source shows its most recent records, up to 200 (100 mandates).</p>
      <div className="row-actions">{(['payments', 'settlements', 'autopay'] as const).map(value => <button type="button" key={value} aria-pressed={view === value} onClick={() => setView(value)}>{value === 'autopay' ? 'AutoPay' : value === 'payments' ? 'Payments and refunds' : 'Settlements'}</button>)}<button type="button" disabled={busy} onClick={() => void load()}>Refresh status</button></div>
      {error && <p role="alert" className="error">{error}</p>}{notice && <p role="status">{notice}</p>}
      {view === 'payments' && <ClientDataTable rows={items} loading={busy} getRowId={item => `${item.source}:${item.id}`} columns={[
        { key: 'source', label: 'Source', value: item => item.source }, { key: 'provider', label: 'Gateway', value: item => item.provider ?? '—' },
        { key: 'rider', label: 'Rider reference', value: item => item.riderId ?? '—' }, { key: 'state', label: 'State', value: item => item.state },
        { key: 'amount', label: 'Amount', value: item => Number(item.amount ?? 0), render: item => item.amount ? formatMoney(item.amount, 'INR') : '—' },
      ]} actions={item => <div className="row-actions"><button type="button" onClick={() => setDetail(item)}>Details</button>{operationAction(item) && <button type="button" disabled={busy} onClick={() => recover(item)}>Check provider</button>}{item.refundSupported && <button type="button" disabled={busy} onClick={() => openRefund(item)}>Request refund</button>}</div>} />}
      {view === 'settlements' && <>
        <label>Import normalized settlement report (.json)<input type="file" accept=".json,application/json" disabled={busy} onChange={event => void selectReport(event.target.files?.[0])} /></label>
        {report && <p>{report.provider ?? 'CASHFREE'} · {report.providerSettlementId} · {report.items.length} entries · Net {formatMoney(report.netAmount, report.currency)} <button type="button" disabled={busy} onClick={() => void run(async () => { await api('finance/provider-settlements/imports', post(report)); if (active.current) { setReport(null); setNotice('Settlement report imported. Matching does not certify bank receipt.'); } })}>Import and match</button></p>}
        <ClientDataTable rows={settlements} loading={busy} getRowId={item => item.id} columns={[
          { key: 'provider', label: 'Gateway', value: item => item.provider }, { key: 'reference', label: 'Settlement reference', value: item => item.providerSettlementId },
          { key: 'status', label: 'State', value: item => item.status }, { key: 'net', label: 'Net amount', value: item => Number(item.netAmount), render: item => formatMoney(item.netAmount, item.currency) },
          { key: 'date', label: 'Settled at', value: item => item.settledAt, render: item => formatDateTime(item.settledAt) },
        ]} actions={item => <button type="button" disabled={busy} onClick={() => void run(async () => { const result = await api<Settlement>(`finance/provider-settlements/${enc(item.id)}`); if (active.current) setSettlement(result); })}>View matching</button>} />
      </>}
      {view === 'autopay' && <ClientDataTable rows={mandates} loading={busy} getRowId={item => item.id} columns={[
        { key: 'number', label: 'Mandate', value: item => item.mandateNumber }, { key: 'rider', label: 'Rider reference', value: item => item.riderId },
        { key: 'provider', label: 'Gateway', value: item => item.provider }, { key: 'status', label: 'State', value: item => item.status },
        { key: 'enabled', label: 'Auto debit', value: item => item.autoDebitEnabled ? 'Enabled' : 'Disabled' },
      ]} />}
    </>}
    {detail && <ClientFormDialog title="Payment operation" onClose={() => setDetail(null)}><p>{detail.source} · {detail.provider} · {detail.state}</p><p>Reference: {detail.id}</p>{detail.refundReviewReason && <p>{detail.refundReviewReason}</p>}{detail.reviewCode && <p>{detail.reviewCode}</p>}{detail.captures?.map(capture => <p key={capture.id}>{capture.providerPaymentId} · {formatMoney(capture.amount, 'INR')} · {capture.status} · {capture.reason} {capture.providerRefundId && `Refund: ${capture.providerRefundId}`}</p>)}</ClientFormDialog>}
    {settlement && <ClientFormDialog title="Settlement matching" wide onClose={() => setSettlement(null)}><p>{settlement.provider} · {settlement.providerSettlementId} · {settlement.status}</p><ClientDataTable rows={settlement.items ?? []} getRowId={item => item.id} columns={[
      { key: 'kind', label: 'Type', value: item => item.kind }, { key: 'reference', label: 'Gateway reference', value: item => item.providerReference },
      { key: 'amount', label: 'Amount', value: item => Number(item.amount), render: item => formatMoney(item.amount, settlement.currency) }, { key: 'status', label: 'Matching result', value: item => item.reviewCode ?? item.status },
    ]} /></ClientFormDialog>}
    {draft && <ClientFormDialog title="Request payment refund" busy={busy} error={error} onClose={() => setDraft(null)}><form className="form-stack" onSubmit={event => { event.preventDefault(); submitRefund(); }}>
      <p>A return uses unallocated payment funds. A full reversal reopens the payment’s financial allocations. The server checks the available amount.</p>
      {submitted && <p>The request was submitted or its outcome is uncertain. Retry uses the same saved request. Check refund status before starting another request.</p>}
      <label>Amount (INR)<input required pattern="[1-9][0-9]*(\.[0-9]{1,2})?" value={draft.amount} disabled={submitted || busy} onChange={event => setDraft({ ...draft, amount: event.target.value })} /></label>
      <label>Reason<textarea required minLength={3} maxLength={500} value={draft.reason} disabled={submitted || busy} onChange={event => setDraft({ ...draft, reason: event.target.value })} /></label>
      <label>Accounting treatment<select value={draft.treatment} disabled={submitted || busy} onChange={event => setDraft({ ...draft, treatment: event.target.value as RefundDraft['treatment'] })}><option value="UNALLOCATED_RETURN">Return unallocated funds</option><option value="PAYMENT_REVERSAL">Reverse full payment</option></select></label>
      <button type="submit" disabled={busy}>{submitted ? 'Retry saved request' : 'Submit refund request'}</button>
    </form></ClientFormDialog>}
  </section>;
}
