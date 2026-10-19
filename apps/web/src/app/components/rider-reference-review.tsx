"use client";

import { useEffect, useState, type FormEvent } from "react";
import { sessionFetch } from "../../lib/session-fetch";
import { ClientDataTable, type ClientColumn } from "./client-data-table";
import { ClientFormDialog } from "./client-form-dialog";

type Reference = {
  id: string; riderName: string; riderMobile: string; name: string; mobile: string; relation: string;
  status: "PENDING" | "APPROVED" | "REJECTED"; rejectionReason: string | null;
  reviewedAt: string | null; reviewedBy: { name: string } | null;
};

const columns: ClientColumn<Reference>[] = [
  { key: "rider", label: "Rider", value: (row) => row.riderName },
  { key: "riderMobile", label: "Rider mobile", value: (row) => row.riderMobile },
  { key: "name", label: "Reference", value: (row) => row.name },
  { key: "mobile", label: "Reference mobile", value: (row) => row.mobile },
  { key: "relation", label: "Relationship", value: (row) => row.relation },
  { key: "status", label: "Review status", value: (row) => row.status,
    render: (row) => <span className={`status status-${row.status.toLowerCase()}`}>{row.status}</span> },
  { key: "reviewer", label: "Reviewed by", value: (row) => row.reviewedBy?.name ?? "—" },
  { key: "reason", label: "Rejection reason", value: (row) => row.rejectionReason ?? "—" },
];

async function request(path: string, options?: RequestInit) {
  const response = await sessionFetch(`/api/v1${path}`, options);
  const body = await response.json();
  if (!response.ok) throw new Error(body.error?.message ?? "Unable to process rider reference.");
  return body.data;
}

export function RiderReferenceReview() {
  const [rows, setRows] = useState<Reference[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [rejecting, setRejecting] = useState<Reference | null>(null);
  const [reason, setReason] = useState("");

  useEffect(() => {
    let active = true;
    request("/rider-references").then((data) => { if (active) setRows(data); })
      .catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : "Unable to load references."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  async function review(reference: Reference, action: "approve" | "reject") {
    if (busyId) return;
    setBusyId(reference.id); setError(""); setNotice("");
    try {
      const updated = await request(`/rider-references/${reference.id}/${action}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        ...(action === "reject" ? { body: JSON.stringify({ rejectionReason: reason.trim() }) } : {}),
      }) as Reference;
      setRows((current) => current.map((row) => row.id === reference.id ? { ...row, ...updated } : row));
      setRejecting(null); setReason("");
      setNotice(action === "approve" ? "Reference approved." : "Reference rejected.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to review reference."); }
    finally { setBusyId(""); }
  }

  function reject(event: FormEvent) {
    event.preventDefault();
    if (rejecting && reason.trim()) void review(rejecting, "reject");
  }

  return <>
    <section className="client-page-intro client-review-intro">

      <p className="muted">Contact each reference to verify their details, then approve it or record a rejection reason.</p>
      <div className="client-review-counts">{(["PENDING", "APPROVED", "REJECTED"] as const).map((status) =>
        <span key={status}><strong>{rows.filter((row) => row.status === status).length}</strong> {status[0] + status.slice(1).toLowerCase()}</span>)}</div>
    </section>
    {error && <p className="error" role="alert">{error}</p>}
    {notice && <p className="notice" role="status">{notice}</p>}
    {loading ? <p className="muted">Loading rider references…</p> :
      <ClientDataTable rows={rows} columns={columns} getRowId={(row) => row.id} emptyMessage="No rider references have been provided."
        actions={(row) => row.status === "PENDING" ? <>
          <button type="button" className="table-action" disabled={Boolean(busyId)} onClick={() => void review(row, "approve")}>{busyId === row.id ? "Saving…" : "Approve"}</button>
          <button type="button" className="danger table-action" disabled={Boolean(busyId)} onClick={() => { setError(""); setReason(""); setRejecting(row); }}>Reject</button>
        </> : <span className="muted">{row.reviewedAt ? new Date(row.reviewedAt).toLocaleString() : "Reviewed"}</span>} />}
    {rejecting && <ClientFormDialog title="Reject rider reference" busy={Boolean(busyId)} error={error} onClose={() => setRejecting(null)} heading={<>Reject rider reference</>}>
      <form className="form-stack" onSubmit={reject}>
        <p className="muted">{rejecting.name} · {rejecting.relation} · {rejecting.mobile}</p>
        <label>Rejection reason *<textarea required maxLength={1000} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Explain why this reference could not be verified." /></label>
        <div className="form-actions"><button className="danger" disabled={Boolean(busyId) || !reason.trim()}>{busyId ? "Rejecting…" : "Reject reference"}</button>
          <button type="button" className="secondary" disabled={Boolean(busyId)} onClick={() => setRejecting(null)}>Cancel</button></div>
      </form>
    </ClientFormDialog>}
  </>;
}
