"use client";

import { useEffect, useRef, useState } from "react";
import { ClientDataTable } from "./client-data-table";
import { formatDateTime, formatMoney } from "../../lib/presentation";

type Earning = { id: string; transactionNumber: string; transactionType: string; description: string; currency: string; amount: string; referenceType: string | null; referenceId: string | null; postedAt: string };
type Result = {
  rider: { id: string; name: string; mobile: string };
  summary: { currency: string; allTimeAmount: string; periodAmount: string }[];
  items: Earning[]; meta: { page: number; pageSize: number; total: number };
};
const types = [
  ["REWARD", "Reward"], ["REFERRAL_REWARD", "Referral reward"], ["SELF_SUBMISSION_REWARD", "Self-submission reward"],
];
export function RiderRewardEarnings({ rider, request }: {
  rider: { id: string; name: string; mobile: string };
  request: (path: string) => Promise<unknown>;
}) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [type, setType] = useState("");
  const [retry, setRetry] = useState(0);
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ signature: string; data: Result } | null>(null);
  const [loading, setLoading] = useState(true);
  const requestRef = useRef(request);
  useEffect(() => { requestRef.current = request; }, [request]);
  const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize), ...(from ? { from } : {}), ...(to ? { to } : {}), ...(type ? { type } : {}) });
  const signature = `/riders/${rider.id}/earnings?${params}`;
  const invalidDates = Boolean(from && to && from > to);
  useEffect(() => {
    if (invalidDates) return;
    let active = true;
    const timer = window.setTimeout(async () => {
      setLoading(true); setError("");
      try {
        const data = await requestRef.current(signature) as Result;
        if (!active) return;
        const lastPage = Math.max(1, Math.ceil(data.meta.total / data.meta.pageSize));
        if (page > lastPage) { setPage(lastPage); return; }
        setResult({ signature, data });
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : "Unable to load earnings.");
      } finally { if (active) setLoading(false); }
    }, 150);
    return () => { active = false; window.clearTimeout(timer); };
  }, [signature, page, retry, invalidDates]);
  const current = !invalidDates && result?.signature === signature ? result.data : null;
  const awaiting = !invalidDates && !error && (loading || !current);
  return <>
    <p className="muted">Posted wallet rewards only. Reversed rewards are excluded.</p>
    <div className="client-filter-bar">
      <label>From (UTC)<input type="date" value={from} max={to || undefined} onChange={event => { setFrom(event.target.value); setPage(1); setError(""); }} /></label>
      <label>To (UTC)<input type="date" value={to} min={from || undefined} onChange={event => { setTo(event.target.value); setPage(1); setError(""); }} /></label>
      <label>Earning type<select value={type} onChange={event => { setType(event.target.value); setPage(1); setError(""); }}><option value="">All reward types</option>{types.map(([value, name]) => <option key={value} value={value}>{name}</option>)}</select></label>
      <button type="button" className="secondary" onClick={() => { setFrom(""); setTo(""); setType(""); setPage(1); setError(""); setRetry(value => value + 1); }}>Clear filters</button>
    </div>
    {invalidDates && <p className="error" role="alert">From date must not be after To date.</p>}
    {error && <div className="error" role="alert"><p>{error}</p><button type="button" className="secondary" onClick={() => { setError(""); setRetry(value => value + 1); }}>Retry</button></div>}
    {awaiting && <p className="muted" role="status">Loading earnings…</p>}
    {!error && !awaiting && current && <>
      {current.summary.length ? <div className="dashboard-grid">{current.summary.map(total => <section className="action-card" key={total.currency}>
        <p className="eyebrow">{total.currency} rewards</p>
        <p>All-time earnings: <strong>{formatMoney(total.allTimeAmount, total.currency)}</strong></p>
        <p>Selected period / type: <strong>{formatMoney(total.periodAmount, total.currency)}</strong></p>
      </section>)}</div> : <p className="muted">No wallet reward earnings recorded for this rider.</p>}
    </>}
    {!invalidDates && <ClientDataTable rows={!error ? current?.items ?? [] : []} loading={awaiting} getRowId={row => row.id}
      searchable={false} filterable={false} sortable={false}
      columns={[
        { key: 'date', label: 'Date', value: row => row.postedAt, render: row => formatDateTime(row.postedAt) },
        { key: 'type', label: 'Earning type', value: row => types.find(([value]) => value === row.transactionType)?.[1] ?? row.transactionType },
        { key: 'description', label: 'Description', value: row => row.description },
        { key: 'amount', label: 'Amount', value: row => row.amount, render: row => formatMoney(row.amount, row.currency) },
        { key: 'reference', label: 'Reference', value: row => row.transactionNumber, render: row => <>{row.transactionNumber}{row.referenceId && <small className="muted" style={{ display: 'block', overflowWrap: 'anywhere' }}>{row.referenceType} · {row.referenceId}</small>}</> },
      ]}
      server={{ page, limit: pageSize, total: !error ? current?.meta.total ?? 0 : 0, search: '', onSearch: () => {}, onPage: setPage, onLimit: size => { setPageSize(size); setPage(1); } }}
      emptyMessage={error ? "Unable to load earnings. Retry to continue." : "No reward earnings in the selected period."} />}
  </>;
}
