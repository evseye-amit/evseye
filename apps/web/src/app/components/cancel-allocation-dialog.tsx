"use client";

import { useEffect, useRef, useState } from "react";
import { ClientFormDialog } from "./client-form-dialog";
import { sessionFetch } from "../../lib/session-fetch";

type Allocation = { id: string; status: string; rider: { name: string; mobile: string } };
async function request<T>(path: string, body?: { reason: string }): Promise<T> {
  const response = await sessionFetch(`/api/v1${path}`, body ? {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  } : undefined);
  const result = await response.json();
  if (!response.ok) throw new Error(result.error?.message ?? result.message ?? "Unable to cancel allocation.");
  return result.data as T;
}

export function CancelAllocationDialog({ fleetId, fleetName, onClose, onDone }: {
  fleetId: string; fleetName: string; onClose: () => void; onDone: () => void;
}) {
  const [allocation, setAllocation] = useState<Allocation | null>(null);
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const submitting = useRef(false);
  useEffect(() => {
    let active = true;
    void Promise.all(["INITIATED", "INSPECTION_PENDING", "OTP_PENDING"].map(status =>
      request<{ items: Allocation[]; meta: { total: number } }>(`/allocations?${new URLSearchParams({ fleetId, status, pageSize: "2" })}`)
    )).then(results => {
      if (!active) return;
      if (results.reduce((sum, result) => sum + result.meta.total, 0) !== 1)
        throw new Error("A single pending allocation could not be found. Refresh the fleet list before trying again.");
      setAllocation(results.flatMap(result => result.items)[0]);
    }).catch(cause => { if (active) setError(cause instanceof Error ? cause.message : "Unable to load allocation."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [fleetId, retry]);
  async function cancel() {
    if (!allocation || submitting.current || reason.trim().length < 3) return;
    submitting.current = true; setBusy(true); setError("");
    try {
      await request(`/allocations/${allocation.id}/cancel`, { reason: reason.trim() });
      onDone();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to cancel allocation.");
    } finally { submitting.current = false; setBusy(false); }
  }
  return <ClientFormDialog title="Cancel allocation?" busy={busy} error={error} onClose={onClose}>
    <p><strong>{fleetName}</strong></p>
    {loading && <p role="status">Loading current allocation…</p>}
    {!loading && !allocation && <button type="button" className="secondary" onClick={() => { setLoading(true); setError(""); setAllocation(null); setRetry(value => value + 1); }}>Retry loading allocation</button>}
    {allocation && <form className="form-stack" onSubmit={event => { event.preventDefault(); void cancel(); }}>
      <p>Rider: {allocation.rider.name} · {allocation.rider.mobile}</p>
      <p>Stage: {allocation.status.replaceAll("_", " ").toLowerCase()}</p>
      <p>This cancels the reservation and makes the fleet available again. Existing readiness checks and QC approvals are preserved. Any remaining readiness blockers still apply.</p>
      <label>Cancellation reason *<textarea required minLength={3} maxLength={1000} disabled={busy} value={reason} onChange={event => setReason(event.target.value)} /></label>
      <div className="form-actions">
        <button type="button" className="secondary" disabled={busy} onClick={onClose}>Keep allocation</button>
        <button className="danger" disabled={busy || reason.trim().length < 3}>{busy ? "Cancelling…" : "Cancel allocation"}</button>
      </div>
    </form>}
  </ClientFormDialog>;
}
