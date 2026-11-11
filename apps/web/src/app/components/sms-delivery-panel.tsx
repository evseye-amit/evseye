"use client";
import { useEffect, useState } from "react";
type Delivery = { id: string; provider: string; status: string; attempt: number; errorCode?: string | null; createdAt: string; otpRequest: { phone: string; purpose: string } };
export function SmsDeliveryPanel({ token }: { token: string }) {
  const [rows, setRows] = useState<Delivery[]>([]); const [error, setError] = useState(""); const [loading, setLoading] = useState(false);
  const [filters, setFilters] = useState({ clientId: "", provider: "", status: "", from: "", to: "" });
  const load = async () => { setLoading(true); setError(""); try { const query = new URLSearchParams({ limit: "100", ...Object.fromEntries(Object.entries(filters).filter(([, value]) => value)) }); const response = await fetch(`/api/v1/auth/sms-deliveries?${query}`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" }); const body = await response.json(); if (!response.ok) throw new Error(body.error?.message ?? body.message ?? "Unable to load SMS delivery history."); setRows(body.data ?? []); } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to load SMS delivery history."); } finally { setLoading(false); } };
  useEffect(() => { void load(); }, []);
  return <>
    <section className="sa-page-head">
      <div><h2>SMS delivery</h2><p>Review OTP delivery attempts, provider outcomes, and delivery failures.</p></div>
      <div className="sa-actions"><button type="button" className="secondary" disabled={loading} onClick={() => void load()}>{loading ? "Refreshing…" : "Refresh"}</button></div>
    </section>
    <section className="sa-card sa-sms-delivery-panel">
      <div className="sa-card-head"><div><h3>Delivery history</h3><p>{rows.length ? `${rows.length} records loaded` : "Filter delivery attempts by client, provider, status, or date."}</p></div></div>
      <form className="sa-feature-toolbar" onSubmit={(event) => { event.preventDefault(); void load(); }}>
        <input aria-label="Client ID" placeholder="Client ID" value={filters.clientId} onChange={(event) => setFilters({ ...filters, clientId: event.target.value })} />
        <input aria-label="Provider" placeholder="Provider" value={filters.provider} onChange={(event) => setFilters({ ...filters, provider: event.target.value })} />
        <input aria-label="Status" placeholder="Status" value={filters.status} onChange={(event) => setFilters({ ...filters, status: event.target.value })} />
        <input aria-label="From date" type="date" value={filters.from} onChange={(event) => setFilters({ ...filters, from: event.target.value })} />
        <input aria-label="To date" type="date" value={filters.to} onChange={(event) => setFilters({ ...filters, to: event.target.value })} />
        <button type="submit" disabled={loading}>Apply filters</button>
        {(Object.values(filters).some(Boolean)) && <button type="button" className="secondary" onClick={() => { setFilters({ clientId: "", provider: "", status: "", from: "", to: "" }); void load(); }}>Clear</button>}
      </form>
      {error && <p className="sa-form-error" role="alert">{error}</p>}
      <div className="sa-commercial-table-wrap"><table className="sa-commercial-table"><thead><tr><th>Created</th><th>Phone</th><th>Purpose</th><th>Provider</th><th>Status</th><th>Attempt</th><th>Error</th></tr></thead><tbody>
        {rows.map((row) => <tr key={row.id}><td>{new Date(row.createdAt).toLocaleString("en-IN")}</td><td>{row.otpRequest.phone}</td><td>{row.otpRequest.purpose}</td><td>{row.provider}</td><td><span className={`sa-status-pill sa-status-${row.status.toLowerCase()}`}>{row.status}</span></td><td>{row.attempt}</td><td>{row.errorCode ?? "—"}</td></tr>)}
        {!rows.length && !loading && <tr><td colSpan={7} className="sa-commercial-empty">No SMS delivery records found.</td></tr>}
      </tbody></table></div>
    </section>
  </>;
}
