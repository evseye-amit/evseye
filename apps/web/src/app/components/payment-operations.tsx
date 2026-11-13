"use client";

import { PaymentOperationsTools } from './payment-operations-tools';
import { useCallback, useEffect, useRef, useState } from 'react';
import { sessionFetch } from '../../lib/session-fetch';
import { formatMoney, formatDateTime } from '../../lib/presentation';
import { ClientDataTable } from './client-data-table';
import { ClientFormDialog } from './client-form-dialog';
import { operationsCsv, filterOperations, operationAction, readRefundDraft, type Operation, type RefundDraft } from './payment-operations-model';

type Settlement = { id: string; provider: string; providerSettlementId: string; currency: string; netAmount: string; status: string; settledAt: string;
  items?: { id: string; kind: string; providerReference: string; amount: string; status: string; reviewCode: string | null }[] };
type Mandate = { id: string; riderId: string; provider: string; mandateNumber: string; status: string; autoDebitEnabled: boolean };
type Page<T> = { items: T[]; page: number; hasMore: boolean };
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
  const [page, setPage] = useState(1), [more, setMore] = useState({ payments: false, settlements: false, autopay: false });
  const [exporting, setExporting] = useState(false), [exportProgress, setExportProgress] = useState(0);
  const exportCancelled = useRef(false);
  const [items, setItems] = useState<Operation[]>([]), [settlements, setSettlements] = useState<Settlement[]>([]), [mandates, setMandates] = useState<Mandate[]>([]);
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false);
  const [view, setView] = useState<'payments' | 'settlements' | 'autopay'>('payments');
  const [query, setQuery] = useState(''), [providerFilter, setProviderFilter] = useState(''), [stateFilter, setStateFilter] = useState('');
  const [detail, setDetail] = useState<Operation | null>(null), [settlement, setSettlement] = useState<Settlement | null>(null);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [draft, setDraft] = useState<RefundDraft | null>(null), [submitted, setSubmitted] = useState(false);
  const generation = useRef(0), active = useRef(true), mutation = useRef(false);
  useEffect(() => { const requests = generation; active.current = true; return () => { active.current = false; requests.current++; }; }, []);
  const storageKey = (paymentId: string) => `payment-refund:${identityKey}:${paymentId}`;
  const load = useCallback(async () => {
    const current = ++generation.current;
    setBusy(true); setError('');
    setItems([]); setSettlements([]); setMandates([]);
    setMore({ payments: false, settlements: false, autopay: false });
    try {
      const [reconciliation, reports, subscriptions] = await Promise.all([
        api<Page<Operation>>(`payment-reconciliation?page=${page}`), api<Page<Settlement>>(`finance/provider-settlements?page=${page}`), api<Page<Mandate>>(`autopay/mandates?page=${page}`),
      ]);
      if (!active.current || current !== generation.current) return;
      setItems(reconciliation.items); setSettlements(reports.items); setMandates(subscriptions.items);
      setMore({ payments: reconciliation.hasMore, settlements: reports.hasMore, autopay: subscriptions.hasMore });
    } catch (cause) { if (active.current && current === generation.current) setError(cause instanceof Error ? cause.message : 'Unable to load operations.'); }
    finally { if (active.current && current === generation.current) setBusy(false); }
  }, [page]);
  useEffect(() => { if (!open) return; const timer = setTimeout(() => void load(), 0); return () => clearTimeout(timer); }, [open, refreshKey, load]);
  async function run(work: () => Promise<void>) {
    if (mutation.current) return;
    mutation.current = true; setBusy(true); setError(''); setNotice('');
    try { await work(); if (active.current) await load(); }
    catch (cause) { if (active.current) setError(cause instanceof Error ? cause.message : 'Payment operation failed.'); }
    finally { mutation.current = false; if (active.current) setBusy(false); }
  }
  async function exportHistory() {
    if (exporting) return;
    exportCancelled.current = false; setExporting(true); setExportProgress(0); setError('');
    const rows: Record<string, unknown>[] = [];
    const seen = new Set<string>();
    const path = view === 'payments' ? 'payment-reconciliation' : view === 'settlements' ? 'finance/provider-settlements' : 'autopay/mandates';
    try {
      for (let index = 1; ; index++) {
        if (index > 999999) throw new Error('Export exceeds the supported page range. Narrow the report.');
        const result = await api<Page<Operation | Settlement | Mandate>>(`${path}?page=${index}`);
        if (!active.current || exportCancelled.current) return;
        const selected = view === 'payments' ? filterOperations(result.items as Operation[], query, providerFilter, stateFilter) : result.items;
        for (const item of selected) {
          const key = `${'source' in item ? item.source : view}:${item.id}`;
          if (!seen.has(key)) { rows.push({ ...item }); seen.add(key); }
        }
        setExportProgress(rows.length);
        if (!result.hasMore) break;
      }
      if (!active.current || exportCancelled.current) return;
      const blob = new Blob([operationsCsv(rows)], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob), link = document.createElement('a');
      link.href = url; link.download = `payment-${view}-${new Date().toISOString().slice(0, 10)}.csv`; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNotice(`Exported ${rows.length} records. This is an operational report, not confirmation of bank receipt.`);
    } catch (cause) { if (active.current) setError(cause instanceof Error ? cause.message : 'Export failed; no partial file was downloaded.'); }
    finally { if (active.current) setExporting(false); }
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
      <p className="muted">Check gateway payments, refunds, AutoPay mandates and settlement exceptions. Browse history in batches of up to 200 per reconciliation source/report list, or 100 mandates. New records or status changes during browsing can move page boundaries; refresh from batch 1 before an audit export.</p>
      <div className="row-actions">{(['payments', 'settlements', 'autopay'] as const).map(value => <button type="button" key={value} aria-pressed={view === value} disabled={busy} onClick={() => { setView(value); setPage(1); }}>{value === 'autopay' ? 'AutoPay' : value === 'payments' ? 'Payments and refunds' : 'Settlements'}</button>)}<button type="button" disabled={busy} onClick={() => void load()}>Refresh status</button></div>
      <div className="row-actions"><button type="button" disabled={busy || page === 1} onClick={() => setPage(value => value - 1)}>Previous batch</button><span>History batch {page}</span><button type="button" disabled={busy || !more[view]} onClick={() => setPage(value => value + 1)}>Next batch</button><button type="button" disabled={busy || exporting} onClick={() => void exportHistory()}>Export full {view} history{view === 'payments' ? ' with filters' : ''}</button>{exporting && <><span role="status">Preparing export: {exportProgress} records</span><button type="button" onClick={() => { exportCancelled.current = true; }}>Cancel export</button></>}</div>
      {error && <p role="alert" className="error">{error}</p>}{notice && <p role="status">{notice}</p>}
      {view === 'payments' && <><div className="row-actions">
        <label>Find reference or rider<input value={query} onChange={event => setQuery(event.target.value)} /></label>
        <label>Gateway<select value={providerFilter} onChange={event => setProviderFilter(event.target.value)}><option value="">All gateways</option>{[...new Set(['RAZORPAY', 'CASHFREE', ...items.map(item => item.provider)].filter((value): value is string => Boolean(value)))].sort().map(value => <option key={value}>{value}</option>)}</select></label>
        <label>State<select value={stateFilter} onChange={event => setStateFilter(event.target.value)}><option value="">All states</option>{[...new Set([...items.map(item => item.state), ...(stateFilter ? [stateFilter] : [])])].sort().map(value => <option key={value}>{value}</option>)}</select></label>
        <button type="button" onClick={() => { setQuery(''); setProviderFilter(''); setStateFilter(''); }}>Clear filters</button>
      </div><p>Showing {filterOperations(items, query, providerFilter, stateFilter).length} of {items.length} loaded records. Filters apply to this batch; full-history export applies the same filters to every batch.</p><ClientDataTable rows={filterOperations(items, query, providerFilter, stateFilter)} loading={busy} getRowId={item => `${item.source}:${item.id}`} columns={[
        { key: 'source', label: 'Source', value: item => item.source }, { key: 'provider', label: 'Gateway', value: item => item.provider ?? '—' },
        { key: 'rider', label: 'Rider', value: item => [item.riderName, item.riderCode].filter(Boolean).join(' · ') || item.riderId || '—' }, { key: 'state', label: 'State', value: item => item.state },
        { key: 'amount', label: 'Amount', value: item => Number(item.amount ?? 0), render: item => item.amount ? formatMoney(item.amount, 'INR') : '—' },
      ]} actions={item => <div className="row-actions"><button type="button" onClick={() => setDetail(item)}>Details</button>{operationAction(item) && <button type="button" disabled={busy} onClick={() => recover(item)}>Check provider</button>}{item.refundSupported && <button type="button" disabled={busy} onClick={() => openRefund(item)}>Request refund</button>}</div>} /></>}
      <PaymentOperationsTools key={identityKey} settlements={settlements} payments={items} onChanged={() => void load()} />
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
    {detail && <ClientFormDialog title="Payment operation" onClose={() => setDetail(null)}><p>{detail.source} · {detail.provider} · {detail.state}</p><p>Reference: {detail.id}</p>{detail.providerRefundId && <p>Gateway refund: {detail.providerRefundId}</p>}{detail.aged && <p role="status">Refund has been pending for over 24 hours. Check provider status and review the original request; do not submit a replacement.</p>}{detail.refundReviewReason && <p>{detail.refundReviewReason}</p>}{detail.reviewCode && <p>{detail.reviewCode}</p>}{detail.captures?.map(capture => <p key={capture.id}>{capture.providerPaymentId} · {formatMoney(capture.amount, 'INR')} · {capture.status} · {capture.reason} {capture.providerRefundId && `Refund: ${capture.providerRefundId}`}</p>)}</ClientFormDialog>}
    {settlement && <ClientFormDialog title="Settlement matching" wide onClose={() => setSettlement(null)}><p>{settlement.provider} · {settlement.providerSettlementId} · {settlement.status}</p><button type="button" disabled={busy} onClick={() => void run(async () => { const result = await api<Settlement>(`finance/provider-settlements/${enc(settlement.id)}/rematch`, post({})); if (active.current) { setSettlement(result); setNotice('Matching refreshed from current payment/refund evidence. No financial posting or bank confirmation was created.'); } })}>Recheck matching</button><ClientDataTable rows={settlement.items ?? []} getRowId={item => item.id} columns={[
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
