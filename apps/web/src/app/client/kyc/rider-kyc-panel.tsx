"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ClientDataTable } from "../../components/client-data-table";
import { sessionFetch } from "../../../lib/session-fetch";

type Rider = { id: string; name: string; mobile: string; riderCode?: string; kycStatus: string; createdAt: string; kycVerifiedAt?: string | null };
const views = [["attention", "Needs attention"], ["PENDING", "In progress"], ["VERIFIED", "Verified"], ["all", "All riders"]] as const;

export default function RiderKycPanel() {
  const [rows, setRows] = useState<Rider[]>([]);
  const [view, setView] = useState<string>("attention");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const riders: Rider[] = [];
        for (let page = 1; ; page++) {
          const response = await sessionFetch(`/api/v1/riders?page=${page}&pageSize=100`, { cache: "no-store", signal: controller.signal });
          const body = await response.json();
          if (!response.ok || !body.data) throw new Error(body.error?.message ?? body.message ?? "Unable to load riders.");
          const data = body.data as { items: Rider[]; meta: { total: number } };
          riders.push(...data.items);
          if (riders.length >= data.meta.total || !data.items.length) break;
        }
        if (!controller.signal.aborted) setRows(riders);
      } catch (cause) { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Unable to load riders."); }
      finally { if (!controller.signal.aborted) setLoading(false); }
    }
    void load();
    return () => controller.abort();
  }, []);
  const filtered = rows.filter(row => view === "all" || (view === "attention" ? row.kycStatus !== "VERIFIED" : row.kycStatus === view));
  return <section className="kyc-riders">
    <div className="kyc-section-heading"><p>Overall status reflects document approval. Provider checks are listed separately.</p><Link className="button secondary" href="/?tab=rider-document-review">Review documents →</Link></div>
    {error && <p className="error" role="alert">{error}</p>}
    <div className="reconciliation-tabs" aria-label="Rider KYC views">{views.map(([value, label]) => <button key={value} type="button" aria-pressed={view === value} onClick={() => setView(value)}>{label}</button>)}</div>
    <ClientDataTable key={view} rows={filtered} loading={loading} getRowId={row => row.id} emptyMessage={error ? "Rider data is unavailable. Refresh to try again." : view === "attention" ? "No riders awaiting KYC completion." : "No riders match this view."} columns={[
      { key: "name", label: "Rider", value: row => row.name, render: row => <><strong>{row.name}</strong><small className="record-secondary">{row.riderCode ?? row.id}</small></> },
      { key: "mobile", label: "Mobile", value: row => row.mobile },
      { key: "status", label: "KYC status", value: row => row.kycStatus, render: row => <span className={`status status-${row.kycStatus.toLowerCase()}`}>{row.kycStatus.replaceAll("_", " ")}</span> },
      { key: "created", label: "Joined", value: row => row.createdAt, render: row => new Date(row.createdAt).toLocaleDateString("en-IN") },
      { key: "verified", label: "Verified on", value: row => row.kycVerifiedAt ?? "", render: row => row.kycVerifiedAt ? new Date(row.kycVerifiedAt).toLocaleDateString("en-IN") : "—" },
    ]} />
  </section>;
}
