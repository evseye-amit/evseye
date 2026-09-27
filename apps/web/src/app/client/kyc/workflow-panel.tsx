"use client";

import { useCallback, useEffect, useState } from "react";
import { sessionFetch } from "../../../lib/session-fetch";

type WorkflowRow = { id: string; riderId: string; rider?: { name: string }; clientId: string;
  workflowVersion: number; status: string; startedAt: string; completedAt?: string | null;
  workflowDefinition: { code: string; name: string }; stepExecutions: { status: string; workflowStep: { name: string } }[];
  decisions: { decision: string; reasonCode: string; decidedAt: string }[]; ageHours?: number };
type Definition = { id: string; code: string; name: string; version: number; status: string;
  steps: { id: string; code: string; name: string; sequence: number; isRequired: boolean; failureBehavior: string; actionMode: string }[];
  rules: { id: string; code: string; priority: number; condition: { kind: string; statuses?: string[] }; action: string; reasonCode: string }[] };
type Detail = { id: string; status: string; workflowVersion: number; rider: { name: string };
  workflowDefinition: Definition; stepExecutions: { id: string; workflowStepId: string; status: string; failureReason?: string | null;
    verification?: { id: string; status: string; resultCode?: string | null } | null }[];
  reconciliations: { id: string; type: string; status: string; score?: number | null }[];
  decisions: { id: string; decision: string; reasonCode: string; summary?: string | null; decidedAt: string }[];
  auditTimeline: { id: string; action: string; createdAt: string }[] };

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await sessionFetch(`/api/v1/kyc/admin/${path}`, { cache: "no-store", ...init });
  const body = await response.json() as { data?: T; message?: string; error?: { message?: string } };
  if (!response.ok || body.data === undefined) throw new Error(body.error?.message ?? body.message ?? "KYC request failed.");
  return body.data;
}

export default function WorkflowPanel({ view }: { view: "workflows" | "reviews" | "definitions" }) {
  const [rows, setRows] = useState<WorkflowRow[]>([]);
  const [definitions, setDefinitions] = useState<Definition[]>([]);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(0);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      if (view === "definitions") setDefinitions(await api<Definition[]>("workflow-definitions"));
      else {
        const query = new URLSearchParams({ skip: String(page * 50) });
        if (view === "workflows" && status) query.set("status", status);
        const items = await api<WorkflowRow[]>(`${view === "reviews" ? "manual-reviews" : "workflows"}?${query}`);
        const loadedAt = Date.now();
        setRows(items.map((item) => ({ ...item, ageHours: item.decisions[0]?.decidedAt ?
          Math.max(0, Math.floor((loadedAt - new Date(item.decisions[0].decidedAt).getTime()) / 3600000)) : undefined })));
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to load workflows."); }
    finally { setLoading(false); }
  }, [view, page, status]);

  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);

  async function open(id: string) {
    setError("");
    try { setDetail(await api<Detail>(`${view === "reviews" ? "manual-reviews" : "workflows"}/${id}`)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to load workflow."); }
  }

  async function review(approve: boolean) {
    if (!detail || reason.trim().length < 5 || !window.confirm(`${approve ? "Approve" : "Reject"} this KYC review?`)) return;
    setBusy(true); setError("");
    try {
      const updated = await api<Detail>(`manual-reviews/${detail.id}/${approve ? "approve" : "reject"}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason: reason.trim() }),
      });
      setDetail(updated); setReason(""); await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to submit review."); }
    finally { setBusy(false); }
  }

  return <section>
    <h2>{view === "reviews" ? "Manual review" : view === "definitions" ? "Workflow definitions" : "Workflows"}</h2>
    {view === "workflows" && <label>Status <select value={status} onChange={(event) => { setStatus(event.target.value); setPage(0); }}>
      <option value="">All</option>{["ACTION_REQUIRED", "IN_PROGRESS", "VERIFIED", "MANUAL_REVIEW", "REJECTED", "EXPIRED"].map((value) => <option key={value}>{value}</option>)}
    </select></label>}
    {loading && <p role="status">Loading workflows…</p>}
    {error && <p role="alert">{error}</p>}
    {!loading && view === "definitions" && (definitions.length ? definitions.map((definition) => <article className="client-metric-card" key={definition.id} style={{ marginTop: "1rem" }}>
      <h3>{definition.name} · v{definition.version}</h3><p>{definition.code} · {definition.status}</p>
      <h4>Steps</h4><ol>{definition.steps.map((step) => <li key={step.id}>{step.name} · {step.isRequired ? "Required" : "Optional"} · {step.actionMode} · {step.failureBehavior}</li>)}</ol>
      <h4>Decision rules</h4><ol>{definition.rules.map((rule) => <li key={rule.id}>Priority {rule.priority}: {rule.condition.kind}{rule.condition.statuses?.length ? ` (${rule.condition.statuses.join(", ")})` : ""} → {rule.action} · {rule.reasonCode}</li>)}</ol>
    </article>) : <p>No workflow definitions configured.</p>)}
    {!loading && view !== "definitions" && <>
      {rows.length ? <table><thead><tr><th>Workflow</th><th>Rider</th><th>Client</th><th>Version</th><th>Current step</th><th>Status</th><th>Decision</th>{view === "reviews" && <><th>Reason</th><th>Questionable check</th><th>Age</th></>}<th>Started</th><th>Completed</th></tr></thead>
        <tbody>{rows.map((row) => <tr key={row.id}><td><button type="button" onClick={() => void open(row.id)}>{row.id.slice(0, 8)}</button> · {row.workflowDefinition.code}</td>
          <td>{row.rider?.name ?? row.riderId.slice(0, 8)}</td><td>{row.clientId.slice(0, 8)}</td><td>{row.workflowVersion}</td>
          <td>{row.stepExecutions.find((step) => ["IN_PROGRESS", "ACTION_REQUIRED"].includes(step.status))?.workflowStep.name ?? "—"}</td><td>{row.status}</td>
          <td>{row.decisions[0]?.decision ?? "—"}</td>{view === "reviews" && <><td>{row.decisions[0]?.reasonCode ?? "—"}</td>
            <td>{row.stepExecutions.find((step) => step.status === "FAILED")?.workflowStep.name ?? "—"}</td>
            <td>{row.ageHours == null ? "—" : `${row.ageHours} h`}</td></>}
          <td>{new Date(row.startedAt).toLocaleString()}</td><td>{row.completedAt ? new Date(row.completedAt).toLocaleString() : "—"}</td></tr>)}</tbody></table>
        : <p>{view === "reviews" ? "No reviews pending." : "No workflows found."}</p>}
      <div style={{ display: "flex", gap: "1rem", marginTop: "1rem" }}><button type="button" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</button>
        <span>Page {page + 1}</span><button type="button" disabled={rows.length < 50} onClick={() => setPage(page + 1)}>Next</button></div>
    </>}
    {detail && view !== "definitions" && <article className="client-metric-card" style={{ marginTop: "2rem" }}>
      <h3>{detail.rider.name} · {detail.status}</h3><p>Workflow {detail.id} · Version {detail.workflowVersion}</p>
      <h4>Progress</h4><ol>{detail.workflowDefinition.steps.map((step) => {
        const execution = detail.stepExecutions.find((item) => item.workflowStepId === step.id);
        return <li key={step.id}>{step.name} — {execution?.status ?? "PENDING"}{execution?.verification ? ` · ${execution.verification.status}` : ""}
          {execution?.failureReason ? ` · ${execution.failureReason}` : ""}</li>;
      })}<li>Reconciliation — {detail.reconciliations.length ? "COMPLETED" : "PENDING"}</li>
        <li>Decision — {detail.decisions.at(-1)?.decision ?? "PENDING"}</li></ol>
      <h4>Reconciliation</h4>{detail.reconciliations.length ? <ul>{detail.reconciliations.map((result) => <li key={result.id}>{result.type}: {result.status}
        {result.score == null ? "" : ` (${result.score}/100)`}</li>)}</ul> : <p>Awaiting completed verifications.</p>}
      <h4>Decision history</h4>{detail.decisions.length ? <ul>{detail.decisions.map((decision) => <li key={decision.id}>{decision.decision} · {decision.summary ?? decision.reasonCode} · {new Date(decision.decidedAt).toLocaleString()}</li>)}</ul> : <p>No decision yet.</p>}
      <h4>Audit timeline</h4>{detail.auditTimeline.length ? <ul>{detail.auditTimeline.map((event) => <li key={event.id}>{new Date(event.createdAt).toLocaleString()} · {event.action}</li>)}</ul> : <p>No events yet.</p>}
      {view === "reviews" && detail.status === "MANUAL_REVIEW" && <div><label>Review reason <input value={reason} minLength={5} maxLength={500}
        onChange={(event) => setReason(event.target.value)} /></label><div style={{ display: "flex", gap: "1rem" }}>
        <button type="button" disabled={busy || reason.trim().length < 5} onClick={() => void review(true)}>Approve</button>
        <button type="button" disabled={busy || reason.trim().length < 5} onClick={() => void review(false)}>Reject</button></div></div>}
    </article>}
  </section>;
}
