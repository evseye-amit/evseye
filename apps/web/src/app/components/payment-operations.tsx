"use client";

import { PaymentOperationsTools } from './payment-operations-tools';
import { useCallback, useEffect, useRef, useState } from 'react';
import { sessionFetch } from '../../lib/session-fetch';
import { formatMoney, formatDateTime } from '../../lib/presentation';
import { ClientDataTable } from './client-data-table';
import { ClientFormDialog } from './client-form-dialog';
import { operationsCsv, selectOperationView, type OperationView, filterOperations, operationAction, readRefundDraft, type Operation, type RefundDraft } from './payment-operations-model';

type Settlement = { id: string; provider: string; providerSettlementId: string; currency: string; netAmount: string; status: string; settledAt: string;
  items?: { id: string; kind: string; providerReference: string; amount: string; status: string; reviewCode: string | null }[] };
type Mandate = { riderName?: string | null; riderMobile?: string | null; id: string; riderId: string; provider: string; mandateNumber: string; status: string; autoDebitEnabled: boolean; maxAmount?: string; expiresAt?: string; method?: string };
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

export function PaymentOperations({ identityKey, refreshKey = 0, onOpenAutoPaySettings, initialView = "payments", standalone = false }: { identityKey: string; initialView?: "payments" | "settlements" | "autopay"; standalone?: boolean; refreshKey?: number; onOpenAutoPaySettings?: () => void }) {
  const [operationView, setOperationView] = useState<OperationView>('attention');
  const [adoption, setAdoption] = useState<Operation | null>(null);
  const [toolBusy, setToolBusy] = useState(false);
  const [open, setOpen] = useState(standalone);
  const [page, setPage] = useState(1), [more, setMore] = useState({ payments: false, settlements: false, autopay: false });
  const [exporting, setExporting] = useState(false), [exportProgress, setExportProgress] = useState(0);
  const exportCancelled = useRef(false);
  const [items, setItems] = useState<Operation[]>([]), [settlements, setSettlements] = useState<Settlement[]>([]), [mandates, setMandates] = useState<Mandate[]>([]);
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false);
  const [view, setView] = useState<'payments' | 'settlements' | 'autopay'>(initialView);
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
      if (view === 'autopay') {
        const result = await api<Page<Mandate>>(`autopay/mandates?page=${page}`);
        if (active.current && current === generation.current) { setMandates(result.items); setMore({ payments: false, settlements: false, autopay: result.hasMore }); }
        return;
      }
      if (view === 'payments') {
        const result = await api<Page<Operation>>(`payment-reconciliation?page=${page}`);
        if (active.current && current === generation.current) { setItems(result.items); setMore({ payments: result.hasMore, settlements: false, autopay: false }); }
        return;
      }
      const [reconciliation, reports, subscriptions] = await Promise.all([
        api<Page<Operation>>(`payment-reconciliation?page=${page}`), api<Page<Settlement>>(`finance/provider-settlements?page=${page}`), api<Page<Mandate>>(`autopay/mandates?page=${page}`),
      ]);
      if (!active.current || current !== generation.current) return;
      setItems(reconciliation.items); setSettlements(reports.items); setMandates(subscriptions.items);
      setMore({ payments: reconciliation.hasMore, settlements: reports.hasMore, autopay: subscriptions.hasMore });
    } catch (cause) { if (active.current && current === generation.current) setError(cause instanceof Error ? cause.message : 'Unable to load operations.'); }
    finally { if (active.current && current === generation.current) setBusy(false); }
  }, [page, view]);
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
        const selected = view === 'payments' ? filterOperations(selectOperationView(result.items as Operation[], operationView), query, providerFilter, stateFilter) : result.items;
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
  if (view === 'autopay') return <section className="sa-form autopay-card autopay-mandates" aria-label="AutoPay mandates">
    <div className="autopay-heading"><div><h2>Mandates</h2><p className="muted">Rider authorizations for automatic payments.</p></div><div className="form-actions">
      <button type="button" className="secondary" disabled={busy} onClick={() => void load()}>Refresh</button>
      <button type="button" className="secondary" disabled={busy || exporting} onClick={() => void exportHistory()}>Export mandates</button>
      {onOpenAutoPaySettings && <button type="button" className="secondary" onClick={onOpenAutoPaySettings}>⚙ Settings</button>}
    </div></div>
    <div className="autopay-amounts"><label>Search this batch<input value={query} placeholder="Rider name, mobile or mandate reference" onChange={event => setQuery(event.target.value)} /></label>
    <label>Status<select value={stateFilter} onChange={event => setStateFilter(event.target.value)}><option value="">All statuses</option>{Array.from(new Set([...mandates.map(item => item.status), ...(stateFilter ? [stateFilter] : [])])).sort().map(status => <option key={status}>{status}</option>)}</select></label></div>
    {error && <p className="error" role="alert">{error}</p>}
    {exporting && <div role="status">Preparing export: {exportProgress} records <button type="button" className="secondary" onClick={() => { exportCancelled.current = true; }}>Cancel export</button></div>}
    {!busy && !error && mandates.length === 0 && page === 1 ? <div className="autopay-empty"><h3>No AutoPay mandates yet</h3><p>Mandates will appear after riders complete authorization.</p></div> :
      <ClientDataTable rows={mandates.filter(item => (!stateFilter || item.status === stateFilter) && [item.riderName, item.riderMobile, item.riderId, item.mandateNumber].some(value => value?.toLowerCase().includes(query.trim().toLowerCase())))} loading={busy} getRowId={item => item.id} columns={[
        { key: 'number', label: 'Mandate', value: item => item.mandateNumber },
        { key: 'rider', label: 'Rider', value: item => item.riderName ? `${item.riderName}${item.riderMobile ? ` (${item.riderMobile})` : ''}` : 'Rider unavailable' },
        { key: 'provider', label: 'Gateway', value: item => item.provider },
        { key: 'method', label: 'Method', value: item => item.method ?? '—' },
        { key: 'status', label: 'Status', value: item => item.status, render: item => <span className={`autopay-status ${item.status === 'ACTIVE' ? 'is-enabled' : ''}`}>{item.status.replaceAll('_', ' ')}</span> },
        { key: 'max', label: 'Maximum debit', value: item => item.maxAmount ?? '', render: item => item.maxAmount ? formatMoney(item.maxAmount, 'INR') : '—' },
        { key: 'expires', label: 'Expires', value: item => item.expiresAt ?? '', render: item => item.expiresAt ? formatDateTime(item.expiresAt) : '—' },
        { key: 'enabled', label: 'Auto debit', value: item => item.autoDebitEnabled ? 'Enabled' : 'Disabled' },
      ]} />}
    {(page > 1 || more.autopay) && <div className="form-actions"><button type="button" className="secondary" disabled={busy || page === 1} onClick={() => setPage(value => value - 1)}>Previous</button><span>Page {page}</span><button type="button" className="secondary" disabled={busy || !more.autopay} onClick={() => setPage(value => value + 1)}>Next</button></div>}
  </section>;
  return <section className="client-manager-actions reconciliation-workspace sa-form">
    {!standalone && <button type="button" className="secondary" onClick={() => setOpen(!open)}>{open ? 'Hide online payment operations' : 'Online payment operations'}</button>}
    {open && <>

      <div className="reconciliation-heading"><div><h2>Payment review</h2><p className="muted">Review payment exceptions and track refunds.</p></div><div className="form-actions">
        <button type="button" className="secondary" disabled={busy || toolBusy || exporting} onClick={() => page === 1 ? void load() : setPage(1)}>Refresh</button>
        <button type="button" className="secondary" disabled={busy || exporting} onClick={() => void exportHistory()}>Export</button>
      </div></div>
      {!standalone && <div className="form-actions">{(['payments', 'settlements', 'autopay'] as const).map(value => <button type="button" className="secondary" key={value} aria-pressed={view === value} disabled={busy} onClick={() => { setView(value); setPage(1); }}>{value}</button>)}</div>}
      {error && <p role="alert" className="error">{error}</p>}{notice && <p role="status">{notice}</p>}
      {exporting && <p role="status">Preparing export: {exportProgress} records <button type="button" className="secondary" onClick={() => { exportCancelled.current = true; }}>Cancel export</button></p>}
      {view === 'payments' && <>
        <div className="reconciliation-tabs" aria-label="Payment views">{([['attention', 'Needs attention'], ['refunds', 'Refund history'], ['all', 'All records']] as const).map(([value, label]) => <button type="button" key={value} aria-pressed={operationView === value} disabled={busy || exporting} onClick={() => { setOperationView(value); setStateFilter(''); setPage(1); }}>{label}</button>)}</div>
        <div className="reconciliation-card">
          <div className="reconciliation-filters">
            <label>Search this batch<input value={query} placeholder="Rider or payment reference" disabled={exporting} onChange={event => setQuery(event.target.value)} /></label>
            <label>Gateway<select value={providerFilter} disabled={exporting} onChange={event => setProviderFilter(event.target.value)}><option value="">All gateways</option><option>RAZORPAY</option><option>CASHFREE</option></select></label>
            <label>Status<select value={stateFilter} disabled={exporting} onChange={event => setStateFilter(event.target.value)}><option value="">All statuses</option>{[...new Set([...selectOperationView(items, operationView).map(item => item.state), ...(stateFilter ? [stateFilter] : [])])].sort().map(value => <option key={value} value={value}>{value.replaceAll('_', ' ')}</option>)}</select></label>
            <button type="button" className="secondary" disabled={exporting} onClick={() => { setQuery(''); setProviderFilter(''); setStateFilter(''); }}>Clear</button>
          </div>
          <p className="muted reconciliation-hint">Filters apply to the loaded batch. Export includes all batches for this view and these filters.</p>
          <ClientDataTable rows={filterOperations(selectOperationView(items, operationView), query, providerFilter, stateFilter)} searchable={false} filterable={false} pagination={false} loading={busy} getRowId={item => `${item.source}:${item.id}`} emptyMessage={operationView === 'attention' ? 'No matching items need attention in this batch.' : 'No matching records in this batch.'} columns={[
            { key: 'source', label: 'Source', value: item => item.source },
            { key: 'reference', label: 'Reference', value: item => item.providerRefundId ?? item.paymentId ?? item.id },
            { key: 'provider', label: 'Gateway', value: item => item.provider ?? '—' },
            { key: 'rider', label: 'Rider', value: item => [item.riderName, item.riderCode].filter(Boolean).join(' · ') || item.riderId || '—' },
            { key: 'state', label: 'Status', value: item => item.state, render: item => <span className="reconciliation-status">{item.state.replaceAll('_', ' ')}</span> },
            { key: 'amount', label: 'Amount', value: item => Number(item.amount ?? 0), render: item => item.amount ? formatMoney(item.amount, 'INR') : '—' },
          ]} actions={item => <div className="row-actions">
            <button type="button" className="secondary" onClick={() => setDetail(item)}>Details</button>
            {operationAction(item) && <button type="button" className="secondary" disabled={busy || toolBusy} onClick={() => recover(item)}>Check provider</button>}
            {item.refundSupported && <button type="button" className="secondary" disabled={busy || toolBusy} onClick={() => openRefund(item)}>Request refund</button>}
            {item.refundSupported && item.provider === 'RAZORPAY' && <button type="button" className="secondary" disabled={busy || toolBusy} onClick={() => setAdoption(item)}>Record existing refund</button>}
          </div>} />
          {(page > 1 || more.payments) && <div className="reconciliation-pagination"><button type="button" className="secondary" disabled={busy || page === 1} onClick={() => setPage(value => value - 1)}>Previous</button><span>Batch {page}</span><button type="button" className="secondary" disabled={busy || !more.payments} onClick={() => setPage(value => value + 1)}>Next</button></div>}
        </div>
        <PaymentOperationsTools key={identityKey} mode="payment-alerts" settlements={[]} payments={[]} onChanged={() => void load()} />
      </>}
      {view === 'settlements' && <>
        <label>Import normalized settlement report (.json)<input type="file" accept=".json,application/json" disabled={busy} onChange={event => void selectReport(event.target.files?.[0])} /></label>
        {report && <p>{report.provider ?? 'CASHFREE'} · {report.providerSettlementId} · {report.items.length} entries · Net {formatMoney(report.netAmount, report.currency)} <button type="button" disabled={busy} onClick={() => void run(async () => { await api('finance/provider-settlements/imports', post(report)); if (active.current) { setReport(null); setNotice('Settlement report imported. Matching does not certify bank receipt.'); } })}>Import and match</button></p>}
        <ClientDataTable rows={settlements} loading={busy} getRowId={item => item.id} columns={[
          { key: 'provider', label: 'Gateway', value: item => item.provider }, { key: 'reference', label: 'Settlement reference', value: item => item.providerSettlementId },
          { key: 'status', label: 'State', value: item => item.status }, { key: 'net', label: 'Net amount', value: item => Number(item.netAmount), render: item => formatMoney(item.netAmount, item.currency) },
          { key: 'date', label: 'Settled at', value: item => item.settledAt, render: item => formatDateTime(item.settledAt) },
        ]} actions={item => <button type="button" disabled={busy} onClick={() => void run(async () => { const result = await api<Settlement>(`finance/provider-settlements/${enc(item.id)}`); if (active.current) setSettlement(result); })}>View matching</button>} />
      </>}

    </>}
    {adoption && <ClientFormDialog title="Record existing gateway refund" busy={toolBusy} onClose={() => setAdoption(null)}><p>Verify and record a refund already issued in Razorpay. This action does not issue a new refund.</p><PaymentOperationsTools mode="adoption" settlements={[]} payments={[adoption]} onBusyChange={setToolBusy} onChanged={() => void load()} /></ClientFormDialog>}
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
