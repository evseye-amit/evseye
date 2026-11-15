"use client";

import { useEffect, useRef, useState } from "react";
import { sessionFetch } from "../../lib/session-fetch";
import { ClientDataTable } from "./client-data-table";
import { ClientFormDialog } from "./client-form-dialog";
import { PaymentOperationsTools } from "./payment-operations-tools";
import { operationsCsv } from "./payment-operations-model";

type Settlement = {
  id: string; provider: string; providerSettlementId: string; status: string;
  netAmount: string; currency: string; settledAt: string; bankConfirmedAt: string | null;
  items?: { id: string; kind: string; providerReference: string; amount: string; status: string; reviewCode: string | null }[];
};
type Page = { items: Settlement[]; hasMore: boolean };
type Filters = { search: string; provider: string; status: string; from: string; to: string };
const empty: Filters = { search: "", provider: "", status: "", from: "", to: "" };
type Report = { provider: string; providerSettlementId: string; netAmount: string; currency: string; items: unknown[] };
type Dialog = { type: "add" | "fetch" | "import" } | { type: "bank" | "matching"; row: Settlement };
const money = (amount: string, currency: string) => new Intl.NumberFormat("en-IN", { style: "currency", currency }).format(Number(amount));
const date = (value: string) => new Date(value).toLocaleDateString("en-IN", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });
const post = (body: unknown): RequestInit => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await sessionFetch(`/api/v1/client/finance/provider-settlements${path}`, init);
  const body = await response.json();
  if (!response.ok) throw new Error(body.error?.message ?? body.message ?? "Settlement operation failed.");
  return body.data ?? body;
}
function query(filters: Filters, page: number) {
  const params = new URLSearchParams({ page: String(page) });
  Object.entries(filters).forEach(([key, value]) => { if (value) params.set(key, value); });
  return `?${params}`;
}
export function SettlementWorkspace({ refreshKey }: { refreshKey: number }) {
  const [draft, setDraft] = useState(empty), [filters, setFilters] = useState(empty);
  const [page, setPage] = useState(1), [reload, setReload] = useState(0);
  const [rows, setRows] = useState<Settlement[]>([]), [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [dialog, setDialog] = useState<Dialog | null>(null), [dialogError, setDialogError] = useState("");
  const [report, setReport] = useState<Report | null>(null), [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(false), [exportCount, setExportCount] = useState(0);
  const active = useRef(true), submitting = useRef(false), cancelExport = useRef(false), exportingRef = useRef(false), fileVersion = useRef(0);
  useEffect(() => { active.current = true; return () => { active.current = false; cancelExport.current = true; }; }, []);
  useEffect(() => {
    const controller = new AbortController();
    void api<Page>(query(filters, page), { signal: controller.signal }).then(result => {
      if (!controller.signal.aborted) { setRows(result.items); setHasMore(result.hasMore); setError(""); }
    }).catch(cause => { if (!controller.signal.aborted) { setRows([]); setHasMore(false); setError(cause.message); } })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [filters, page, reload, refreshKey]);
  const changed = () => { setLoading(true); setPage(1); setReload(value => value + 1); };
  function open(next: Dialog) { setDialogError(""); setNotice(""); setReport(null); fileVersion.current++; setDialog(next); }
  async function mutate(work: () => Promise<void>) {
    if (submitting.current) return;
    submitting.current = true; setBusy(true); setDialogError("");
    try { await work(); } catch (cause) { if (active.current) setDialogError(cause instanceof Error ? cause.message : "Unable to complete operation."); }
    finally { submitting.current = false; if (active.current) setBusy(false); }
  }
  async function selectFile(file?: File) {
    const version = ++fileVersion.current; setReport(null); setDialogError("");
    if (!file) return;
    try {
      if (file.size > 1_000_000) throw new Error("Choose a JSON report smaller than 1 MB.");
      const value = JSON.parse(await file.text());
      if (!value || !["RAZORPAY", "CASHFREE"].includes(value.provider ?? "CASHFREE") || typeof value.providerSettlementId !== "string" || !Array.isArray(value.items) || !Number.isFinite(Number(value.netAmount)) || !/^[A-Z]{3}$/.test(value.currency)) throw new Error("Choose a valid normalized settlement report.");
      if (active.current && version === fileVersion.current) setReport({ ...value, provider: value.provider ?? "CASHFREE" });
    } catch (cause) { if (active.current && version === fileVersion.current) setDialogError(cause instanceof Error ? cause.message : "Invalid report."); }
  }
  async function exportRows() {
    if (exportingRef.current) return;
    exportingRef.current = true; setExporting(true); setExportCount(0); cancelExport.current = false; setError("");
    try {
      const records: Settlement[] = [], seen = new Set<string>();
      for (let next = 1; ; next++) {
        if (next > 999999) throw new Error("Export is too large. Narrow the filters.");
        const result = await api<Page>(query(filters, next));
        if (!active.current || cancelExport.current) return;
        for (const row of result.items) if (!seen.has(row.id)) { records.push(row); seen.add(row.id); }
        setExportCount(records.length);
        if (!result.hasMore) break;
      }
      const url = URL.createObjectURL(new Blob([operationsCsv(records)], { type: "text/csv;charset=utf-8" }));
      const link = document.createElement("a"); link.href = url; link.download = `settlements-${new Date().toISOString().slice(0, 10)}.csv`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (cause) { if (active.current) setError(cause instanceof Error ? cause.message : "Export failed; no partial file was downloaded."); }
    finally { exportingRef.current = false; if (active.current) setExporting(false); }
  }
  const filtered = Object.values(filters).some(Boolean);
  return <div className="settlement-workspace">
    <section className="sa-form settlement-card" aria-label="Settlement history">
      <div className="settlement-heading"><div><h2>Settlement history</h2><p className="muted">Track gateway settlements and confirm bank receipts.</p></div>
        <div className="form-actions"><button type="button" className="secondary" disabled={loading || busy} onClick={changed}>Refresh</button><button type="button" className="secondary" disabled={loading || exporting} onClick={() => void exportRows()}>Export</button><button type="button" onClick={() => open({ type: "add" })}>+ Add settlement</button></div></div>
      <form className="settlement-filters" onSubmit={event => { event.preventDefault(); setLoading(true); setPage(1); setFilters({ ...draft }); }}>
        <label>Settlement reference<input placeholder="Search reference…" value={draft.search} maxLength={120} onChange={e => setDraft({ ...draft, search: e.target.value })} /></label>
        <label>Gateway<select value={draft.provider} onChange={e => setDraft({ ...draft, provider: e.target.value })}><option value="">All gateways</option><option>RAZORPAY</option><option>CASHFREE</option></select></label>
        <label>Matching status<select value={draft.status} onChange={e => setDraft({ ...draft, status: e.target.value })}><option value="">All statuses</option><option value="REPORT_MATCHED">Matched</option><option value="REQUIRES_REVIEW">Needs review</option></select></label>
        <label>From (UTC)<input type="date" value={draft.from} max={draft.to || undefined} onChange={e => setDraft({ ...draft, from: e.target.value })} /></label>
        <label>To (UTC)<input type="date" value={draft.to} min={draft.from || undefined} onChange={e => setDraft({ ...draft, to: e.target.value })} /></label>
        <div className="form-actions"><button className="secondary" disabled={loading}>Apply</button><button type="button" className="secondary" onClick={() => { setDraft(empty); setFilters({ ...empty }); setPage(1); setLoading(true); }}>Clear</button></div>
      </form>
      <p className="muted settlement-help">Filters apply across all records. Export includes all records matching the applied filters. Gateway matching does not confirm bank receipt.</p>
      {error && <p className="error" role="alert">{error}</p>}{notice && <p className="autopay-message" role="status">{notice}</p>}
      {exporting && <p role="status">Preparing export: {exportCount} records <button type="button" className="secondary" onClick={() => { cancelExport.current = true; }}>Cancel export</button></p>}
      <ClientDataTable rows={rows} loading={loading} searchable={false} pagination={false} filterable={false} sortable={false} getRowId={row => row.id}
        emptyMessage={error ? "Settlement records could not be loaded. Try Refresh." : filtered ? "No settlements match your filters." : "No settlements yet. Add a gateway settlement or import a report to get started."}
        columns={[
          { key: "date", label: "Date (UTC)", value: row => row.settledAt, render: row => date(row.settledAt) },
          { key: "reference", label: "Settlement reference", value: row => row.providerSettlementId },
          { key: "provider", label: "Gateway", value: row => row.provider },
          { key: "net", label: "Net amount", value: row => Number(row.netAmount), render: row => <span className="settlement-money">{money(row.netAmount, row.currency)}</span> },
          { key: "status", label: "Matching status", value: row => row.status, render: row => <span className={`settlement-badge ${row.status === "REPORT_MATCHED" ? "is-confirmed" : "is-review"}`}>{row.status === "REPORT_MATCHED" ? "Matched" : row.status === "REQUIRES_REVIEW" ? "Needs review" : row.status}</span> },
          { key: "bank", label: "Bank receipt", value: row => row.bankConfirmedAt ? "Confirmed" : "Awaiting confirmation", render: row => <span className={`settlement-badge ${row.bankConfirmedAt ? "is-confirmed" : ""}`}>{row.bankConfirmedAt ? "Confirmed" : "Awaiting confirmation"}</span> },
        ]} actions={row => <div className="form-actions"><button type="button" className="secondary" disabled={loading || busy} onClick={() => { open({ type: "matching", row }); void mutate(async () => { const detail = await api<Settlement>(`/${encodeURIComponent(row.id)}`); if (active.current) setDialog({ type: "matching", row: detail }); }); }}>View matching</button>{!row.bankConfirmedAt && <button type="button" className="secondary" disabled={loading || busy} onClick={() => open({ type: "bank", row })}>Confirm bank receipt</button>}</div>} />
      {(page > 1 || hasMore) && <div className="settlement-pagination"><button type="button" className="secondary" disabled={loading || page === 1} onClick={() => { setLoading(true); setPage(value => value - 1); }}>Previous</button><span>Page {page}</span><button type="button" className="secondary" disabled={loading || !hasMore} onClick={() => { setLoading(true); setPage(value => value + 1); }}>Next</button></div>}
    </section>
    <PaymentOperationsTools mode="alerts" settlements={[]} payments={[]} onChanged={() => { setLoading(true); setReload(value => value + 1); }} />
    {dialog && <ClientFormDialog title={dialog.type === "add" ? "Add settlement" : dialog.type === "fetch" ? "Fetch from gateway" : dialog.type === "import" ? "Import settlement report" : dialog.type === "bank" ? "Confirm bank receipt" : "Settlement matching"} busy={busy} error={dialogError} onClose={() => { fileVersion.current++; setDialog(null); }} surfaceClassName="settlement-dialog">
      {dialog.type === "add" && <div className="settlement-options"><button type="button" className="secondary" onClick={() => open({ type: "fetch" })}><strong>Fetch from gateway</strong><span>Retrieve a settlement using its gateway reference and date.</span></button><button type="button" className="secondary" onClick={() => open({ type: "import" })}><strong>Import report</strong><span>Upload a normalized JSON settlement report.</span></button></div>}
      {dialog.type === "fetch" && <PaymentOperationsTools mode="fetch" settlements={[]} payments={[]} onChanged={changed} onBusyChange={setBusy} />}
      {dialog.type === "bank" && <><p className="autopay-message">{dialog.row.providerSettlementId} · Expected net amount {money(dialog.row.netAmount, dialog.row.currency)}</p><PaymentOperationsTools mode="bank" settlements={[dialog.row]} payments={[]} onChanged={changed} onBusyChange={setBusy} /></>}
      {dialog.type === "import" && <form className="settlement-form" onSubmit={event => { event.preventDefault(); if (!report) return; void mutate(async () => { await api("/imports", post(report)); if (active.current) { setDialog(null); setReport(null); setNotice("Report imported and matched. Bank receipt still needs confirmation."); changed(); } }); }}>
        <label>Settlement report (.json)<input type="file" accept=".json,application/json" required disabled={busy} onChange={event => void selectFile(event.target.files?.[0])} /></label><p className="muted">Choose a normalized Razorpay or Cashfree report under 1 MB.</p>
        {report && <div className="autopay-message">{report.provider} · {report.providerSettlementId}<br />{report.items.length} entries · Net {money(report.netAmount, report.currency)}</div>}
        <button disabled={busy || !report}>{busy ? "Importing…" : "Import and match"}</button>
      </form>}
      {dialog.type === "matching" && <><p>{dialog.row.provider} · {dialog.row.providerSettlementId}</p><p className="muted">Matching compares gateway entries with payment and refund evidence. It does not confirm a bank receipt.</p><button type="button" className="secondary" disabled={busy} onClick={() => { const row = dialog.row; void mutate(async () => { const detail = await api<Settlement>(`/${encodeURIComponent(row.id)}/rematch`, post({})); if (active.current) { setDialog({ type: "matching", row: detail }); changed(); } }); }}>Recheck matching</button>
        <ClientDataTable rows={dialog.row.items ?? []} loading={busy} getRowId={row => row.id} columns={[
          { key: "kind", label: "Type", value: row => row.kind }, { key: "ref", label: "Gateway reference", value: row => row.providerReference },
          { key: "amount", label: "Amount", value: row => Number(row.amount), render: row => money(row.amount, dialog.row.currency) },
          { key: "status", label: "Matching result", value: row => row.reviewCode ?? row.status },
        ]} /></>}
    </ClientFormDialog>}
  </div>;
}
