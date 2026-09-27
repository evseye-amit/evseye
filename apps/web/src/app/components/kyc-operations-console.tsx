"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { sessionFetch } from "../../lib/session-fetch";

type Tab = "command" | "verifications" | "workflows" | "reviews" | "providers" | "alerts" | "audit";
type Page<T> = { items: T[]; total: number; skip: number; pageSize: number };
type Summary = { hours: number; total: number; inProgress: number; verified: number; rejected: number;
  manualReview: number; technicalFailures: number; stuck: number; fallbackExecutions: number;
  providerConflicts: number; overdueReviews: number; routing: Record<string, number> };
type Verification = { id: string; clientId: string; riderId: string; verificationType: string; status: string;
  resultCode?: string | null; requestedAt: string; updatedAt: string; attemptCount: number; flags: string[];
  finalProvider?: { name: string } | null; workflowStepExecution?: { workflowExecutionId: string;
    workflowStep: { name: string } } | null };
type Workflow = { id: string; clientId: string; riderId: string; status: string; startedAt: string;
  updatedAt: string; reviewPriority?: string; reviewAssignedTo?: string | null; reviewDueAt?: string | null;
  reviewVersion: number; flags: string[]; workflowDefinition: { name: string; code: string };
  stepExecutions?: { status: string; workflowStep: { name: string } }[] };
type Provider = { id: string; code: string; name: string; environment: string; isActive: boolean;
  health?: string; circuitOpen?: boolean; capabilities: { verificationType: string; isEnabled: boolean;
    health?: { status: string; recentRequests: number; technicalFailureRate: number | null;
      timeoutRate: number | null; p95LatencyMs: number | null } }[] };
type Alert = { id: string; type: string; severity: string; status: string; clientId?: string | null;
  entityId?: string | null; capability?: string | null; firstSeenAt: string; lastSeenAt: string;
  occurrenceCount: number };
type Audit = { id: string; actorId?: string | null; clientId?: string | null; action: string;
  entityType: string; entityId?: string | null; createdAt: string;
  previous?: Record<string, string | number | boolean | null> | null;
  current?: Record<string, string | number | boolean | null> | null };
type Detail = { id: string; status: string; riderId: string; clientId: string; verificationType: string;
  flags: string[]; resultCode?: string | null; consentId?: string | null; recoveryVersion: number;
  routingDecision?: { strategy: string; routingPolicyVersion: number;
    selectedProviders: string[]; decisionReason: string; routingPolicy?: { name: string } | null } | null;
  attempts: { id: string; attemptNumber: number; provider: { name: string }; reason: string; status: string;
    failureCategory?: string | null; latencyMs?: number | null; cost?: string | null }[];
  providerConflicts: { provider: { code: string }; resultStatus: string; resolution: string }[];
  featureConsumption?: { id: string; quantity: string; source: string; reversedAt?: string | null } | null;
  timeline: { id: string; timestamp: string; title: string; category: string }[] };
type WorkflowDetail = { id: string; clientId: string; riderId: string; status: string; workflowVersion: number;
  reviewPriority: string; reviewAssignedTo?: string | null; reviewDueAt?: string | null;
  flags: string[]; workflowDefinition: { name: string; code: string };
  steps: { id: string; name: string; code: string; sequence: number; isRequired: boolean;
    execution?: { status: string; verificationId?: string | null; failureReason?: string | null } | null }[];
  decisions: { id: string; decision: string; reasonCode: string; decidedAt: string }[];
  reconciliations: { type: string; status: string; score?: number | null }[];
  timeline: { id: string; timestamp: string; title: string; category: string }[] };

async function get<T>(base: string, path: string): Promise<T> {
  const response = await sessionFetch(`/api/v1/${base}/${path}`, { cache: "no-store" });
  const body = await response.json() as { data?: T; error?: { message?: string }; message?: string };
  if (!response.ok || body.data === undefined) throw new Error(body.error?.message ?? body.message ?? "KYC request failed.");
  return body.data;
}

async function send<T>(base: string, path: string, method: "POST" | "PATCH", payload?: object, extraHeaders?: Record<string, string>): Promise<T> {
  const response = await sessionFetch(`/api/v1/${base}/${path}`, { method, headers: { "Content-Type": "application/json", ...extraHeaders },
    body: JSON.stringify(payload ?? {}) });
  const body = await response.json() as { data?: T; error?: { message?: string }; message?: string };
  if (!response.ok || body.data === undefined) throw new Error(body.error?.message ?? body.message ?? "KYC action failed.");
  return body.data;
}

const time = (value?: string | null) => value ? new Date(value).toLocaleString() : "—";
const label = (value: string) => value.replaceAll("_", " ");

export default function KycOperationsConsole({ platform = false }: { platform?: boolean }) {
  const base = platform ? "platform/kyc/operations" : "kyc/operations";
  const [authorized, setAuthorized] = useState(false);
  const [canAssignOthers, setCanAssignOthers] = useState(false);
  const [tab, setTab] = useState<Tab>("command");
  const [hours, setHours] = useState(24);
  const [skip, setSkip] = useState(0);
  const [filter, setFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [strategy, setStrategy] = useState("");
  const [failureCategory, setFailureCategory] = useState("");
  const [search, setSearch] = useState("");
  const [searchDraft, setSearchDraft] = useState("");
  const [clientId, setClientId] = useState("");
  const [clientIdDraft, setClientIdDraft] = useState("");
  const [summary, setSummary] = useState<Summary | null>(null);
  const [rows, setRows] = useState<Page<Verification | Workflow | Alert | Audit> | null>(null);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [retryPreview, setRetryPreview] = useState<{ allowed: boolean; reason: string; expectedVersion: number;
    attemptsRemaining: number; newVendorCostPossible: boolean } | null>(null);
  const [retryForm, setRetryForm] = useState<Record<string, string>>({});
  const [retryKey, setRetryKey] = useState("");
  const [workflowDetail, setWorkflowDetail] = useState<WorkflowDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    if (!authorized || document.hidden) return;
    setBusy(true); setError("");
    try {
      const params = new URLSearchParams({ hours: String(hours), skip: String(skip) });
      if (platform && clientId) params.set("clientId", clientId);
      if (filter) params.set(tab === "verifications" || tab === "workflows" && filter === "STUCK" ? "flag" : tab === "alerts" || tab === "reviews" && filter === "COMPLETED" ? "status" :
        tab === "reviews" ? "flag" : "status", filter);
      if (search) params.set("search", search);
      if (tab === "verifications") {
        if (typeFilter) params.set("type", typeFilter);
        if (strategy) params.set("strategy", strategy);
        if (failureCategory) params.set("failureCategory", failureCategory);
      }
      if (tab === "command") setSummary(await get<Summary>(base, `summary?${params}`));
      else if (tab === "providers") setProviders(await get<Provider[]>(base, "providers"));
      else setRows(await get<Page<Verification | Workflow | Alert | Audit>>(base,
        `${tab === "reviews" ? "manual-reviews" : tab}?${params}`));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to load KYC operations."); }
    finally { setBusy(false); }
  }, [authorized, base, clientId, failureCategory, filter, hours, platform, search, skip, strategy, tab, typeFilter]);

  useEffect(() => {
    let live = true;
    void sessionFetch("/api/v1/auth/me", { cache: "no-store" }).then(async (response) => {
      if (!response.ok) throw new Error("Sign in to access KYC operations.");
      const body = await response.json() as { data?: { role?: string; roles?: string[] } };
      const roles = body.data?.roles ?? (body.data?.role ? [body.data.role] : []);
      if (!roles.some((role) => platform ? role === "SUPER_ADMIN" : ["CLIENT_ADMIN", "KYC_OPERATOR"].includes(role)))
        throw new Error("You are not authorized to view this console.");
      if (live) { setAuthorized(true); setCanAssignOthers(roles.includes("CLIENT_ADMIN")); }
    }).catch((cause) => { if (live) setError(cause instanceof Error ? cause.message : "Unauthorized."); });
    return () => { live = false; };
  }, [platform]);
  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);
  useEffect(() => {
    const timer = window.setInterval(() => { if (!document.hidden && !detail && !workflowDetail) void load(); }, 60_000);
    return () => window.clearInterval(timer);
  }, [detail, workflowDetail, load]);

  async function openVerification(id: string) {
    setError("");
    try {
      setDetail(await get<Detail>(base, `verifications/${id}`));
      setRetryForm({}); setRetryKey(crypto.randomUUID());
      setRetryPreview(!platform && canAssignOthers ? await get(base, `verifications/${id}/recovery-options`) : null);
    }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to load verification."); }
  }
  async function retryVerification() {
    if (!detail || !retryPreview?.allowed || !retryKey) return;
    if (!window.confirm("This retry may generate an additional provider request and vendor cost. It will not create another client usage entry. Continue?")) return;
    setError(""); setMessage("");
    try {
      const input = { riderId: detail.riderId, type: detail.verificationType,
        ...(detail.consentId ? { consentId: detail.consentId } : {}),
        ...(detail.verificationType === "PAN_VERIFICATION" ? { pan: retryForm.pan, name: retryForm.name,
          dateOfBirth: retryForm.dateOfBirth } : detail.verificationType === "BANK_ACCOUNT_VERIFICATION"
          ? { accountNumber: retryForm.accountNumber, ifsc: retryForm.ifsc } : { ifsc: retryForm.ifsc }) };
      await send(base, `verifications/${detail.id}/retry`, "POST", { expectedVersion: retryPreview.expectedVersion,
        reason: retryForm.reason, input }, { "Idempotency-Key": retryKey });
      setMessage("Technical retry recorded."); setRetryForm({});
      setDetail(await get<Detail>(base, `verifications/${detail.id}`));
      setRetryPreview(await get(base, `verifications/${detail.id}/recovery-options`));
      setRetryKey(crypto.randomUUID()); await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Technical retry failed."); }
  }
  async function openWorkflow(id: string) {
    setError("");
    try { setWorkflowDetail(await get<WorkflowDetail>(base, `workflows/${id}`)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to load workflow."); }
  }
  async function act(path: string, method: "POST" | "PATCH", payload?: object) {
    setError(""); setMessage("");
    try { await send(base, path, method, payload); setMessage("Action recorded."); await load(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Action failed."); }
  }
  async function assign(row: Workflow, self: boolean) {
    const reason = window.prompt(self ? "Reason for assigning this review to yourself" : "Reason for unassigning this review");
    if (!reason) return;
    await act(`manual-reviews/${row.id}/assignment`, "PATCH", { assignedTo: self ? undefined : null,
      expectedVersion: row.reviewVersion, reason });
  }
  async function assignToUser(row: Workflow) {
    const assignedTo = window.prompt("Reviewer user ID (same client)");
    if (!assignedTo) return;
    const reason = window.prompt(`Reason to assign review ${row.id} to ${assignedTo}`);
    if (!reason) return;
    await act(`manual-reviews/${row.id}/assignment`, "PATCH", { assignedTo,
      expectedVersion: row.reviewVersion, reason });
  }
  async function resolve(row: Workflow, action: "APPROVE" | "REJECT") {
    const reason = window.prompt(`${action} review ${row.id}? Enter a reason (at least 5 characters).`);
    if (!reason || !window.confirm(`Confirm ${action.toLowerCase()} for review ${row.id}?`)) return;
    await act(`manual-reviews/${row.id}/resolve`, "POST", { action, expectedVersion: row.reviewVersion, reason });
  }
  async function setPriority(row: Workflow) {
    const priority = window.prompt("Priority: LOW, NORMAL, HIGH or CRITICAL", row.reviewPriority ?? "NORMAL")?.toUpperCase();
    if (!priority || !["LOW", "NORMAL", "HIGH", "CRITICAL"].includes(priority)) return;
    const reason = window.prompt(`Reason to set ${priority} priority`);
    if (!reason) return;
    await act(`manual-reviews/${row.id}/priority`, "PATCH", { priority, expectedVersion: row.reviewVersion, reason });
  }
  async function resume(row: Workflow) {
    try {
      const preview = await get<{ allowed: boolean; reason: string; expectedVersion: number;
        newProviderCallPossible: boolean; newClientUsagePossible: boolean }>(base, `workflows/${row.id}/recovery-options`);
      if (!preview.allowed) { setMessage(preview.reason); return; }
      const reason = window.prompt(`Resume workflow ${row.id}? ${preview.reason} No new provider call or client usage. Enter reason:`);
      if (!reason || !window.confirm(`Confirm resume for workflow ${row.id}?`)) return;
      await act(`workflows/${row.id}/resume`, "POST", { expectedVersion: preview.expectedVersion, reason });
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Recovery preview failed."); }
  }

  return <main className="client-dashboard" style={{ padding: "2rem", maxWidth: 1360, margin: "0 auto" }}>
    <header className="client-dashboard-header"><div><p className="eyebrow">{platform ? "EVsEYE OPERATIONS" : "CLIENT WORKSPACE"}</p>
      <h1>KYC Command Center</h1><p>Verification, workflow, provider and incident operations</p></div>
      <div><Link href={platform ? "/platform/kyc/analytics" : "/client/kyc/analytics"}>Analytics</Link>{" · "}
      {platform && <><Link href="/platform/kyc/intelligent-routing">Intelligent Routing</Link>{" · "}</>}
      <Link href={platform ? "/platform/dashboard" : "/client/kyc"}>Back</Link></div></header>
    {error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}
    {authorized && <><nav aria-label="KYC operations sections" style={{ display: "flex", gap: ".5rem", flexWrap: "wrap", margin: "1.5rem 0" }}>
      {(["command", "verifications", "workflows", "reviews", "providers", "alerts", "audit"] as Tab[]).map((item) =>
        <button key={item} type="button" aria-current={tab === item ? "page" : undefined}
          onClick={() => { setTab(item); setSkip(0); setFilter(""); setSearch(""); setSearchDraft("");
            setDetail(null); setWorkflowDetail(null); setRetryForm({}); }}>{item === "command" ? "Command Center" :
            item === "reviews" ? "Manual Review" : label(item[0].toUpperCase() + item.slice(1))}</button>)}</nav>
      <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap", marginBottom: "1rem" }}>
        <label>Time window <select value={hours} onChange={(event) => { setHours(Number(event.target.value)); setSkip(0); }}>
          <option value={1}>Last hour</option><option value={24}>Last 24 hours</option><option value={168}>Last 7 days</option></select></label>
        {platform && <label>Client ID <input value={clientIdDraft} placeholder="All clients" onChange={(event) => setClientIdDraft(event.target.value)} /></label>}
        {["verifications", "workflows", "reviews", "alerts"].includes(tab) && <label>Queue
          <select value={filter} onChange={(event) => { setFilter(event.target.value); setSkip(0); }}><option value="">All</option>
            {(tab === "verifications" ? ["STUCK", "FALLBACK_USED", "PROVIDER_CONFLICT", "ROUTING_EXHAUSTED"] :
              tab === "reviews" ? ["UNASSIGNED", "MINE", "OTHERS", "HIGH_PRIORITY", "APPROACHING_SLA", "OVERDUE", "COMPLETED"] :
                tab === "alerts" ? ["OPEN", "ACKNOWLEDGED", "RESOLVED"] :
                  ["STUCK", "IN_PROGRESS", "ACTION_REQUIRED", "MANUAL_REVIEW", "FAILED", "VERIFIED", "EXPIRED"])
              .map((value) => <option key={value}>{value}</option>)}</select></label>}
        {["verifications", "workflows"].includes(tab) && <label>Safe ID or workflow code
          <input value={searchDraft} onChange={(event) => setSearchDraft(event.target.value)} /></label>}
        {(platform || ["verifications", "workflows"].includes(tab)) && <button type="button" onClick={() => {
          setClientId(clientIdDraft.trim()); setSearch(searchDraft.trim()); setSkip(0);
        }}>Apply search</button>}
        {tab === "verifications" && <><label>Verification type <select value={typeFilter} onChange={(event) => { setTypeFilter(event.target.value); setSkip(0); }}>
          <option value="">All</option>{["PAN_VERIFICATION", "AADHAAR_OTP", "BANK_ACCOUNT_VERIFICATION", "IFSC_VERIFICATION"].map((item) => <option key={item}>{item}</option>)}</select></label>
          <label>Routing strategy <select value={strategy} onChange={(event) => { setStrategy(event.target.value); setSkip(0); }}>
            <option value="">All</option>{["PRIORITY", "WEIGHTED", "FALLBACK", "PARALLEL", "HEDGED"].map((item) => <option key={item}>{item}</option>)}</select></label>
          <label>Failure category <select value={failureCategory} onChange={(event) => { setFailureCategory(event.target.value); setSkip(0); }}>
            <option value="">All</option>{["PROVIDER_TIMEOUT", "PROVIDER_UNAVAILABLE", "PROVIDER_ERROR", "RATE_LIMITED", "AUTHENTICATION_FAILED", "INVALID_INPUT", "IDENTITY_MISMATCH", "OTP_FAILED", "DOCUMENT_INVALID", "PAN_NOT_VERIFIED"].map((item) => <option key={item}>{item}</option>)}</select></label></>}
      </div>
      {busy && <p role="status">Loading operations…</p>}
      {tab === "command" && summary && <><section className="client-metrics" aria-label="KYC operations metrics">
        {([ ["Total verifications", summary.total], ["In progress", summary.inProgress], ["Verified", summary.verified],
          ["Rejected", summary.rejected], ["Technical failures", summary.technicalFailures], ["Manual review", summary.manualReview],
          ["Stuck", summary.stuck], ["Overdue reviews", summary.overdueReviews],
          ["Fallbacks", summary.fallbackExecutions], ["Provider conflicts", summary.providerConflicts] ] as [string, number][])
          .map(([name, value]) => <article key={name} className="client-metric-card"><span>{name}</span><strong>{value}</strong></article>)}
      </section><section><h2>Routing strategies</h2><p>{Object.entries(summary.routing).map(([name, count]) => `${label(name)}: ${count}`).join(" · ") || "No routing decisions in this window."}</p></section></>}
      {tab === "providers" && <section><h2>Provider operations</h2>{providers.length === 0 ? <p>No providers configured.</p> :
        providers.map((provider) => <article key={provider.id} className="client-metric-card" style={{ marginBottom: "1rem" }}>
          <h3>{provider.name}</h3><p>{provider.code} · {provider.environment} · {provider.isActive ? "Enabled" : "Disabled"}
            {provider.health ? ` · ${provider.health}` : ""}{provider.circuitOpen === undefined ? "" : provider.circuitOpen ? " · Circuit OPEN" : " · Circuit CLOSED"}</p>
          <ul>{provider.capabilities.map((capability) => <li key={capability.verificationType}>{label(capability.verificationType)}:
            {capability.isEnabled ? " enabled" : " disabled"} · {capability.health?.status ?? "UNKNOWN"} · {capability.health?.recentRequests ?? 0} requests
            {capability.health?.technicalFailureRate == null ? "" : ` · ${Math.round(capability.health.technicalFailureRate * 100)}% technical failures`}
            {capability.health?.p95LatencyMs == null ? "" : ` · P95 ${capability.health.p95LatencyMs} ms`}
            {platform && <button type="button" onClick={() => { const reason = window.prompt(`Reason to ${capability.isEnabled ? "disable" : "enable"} ${capability.verificationType}`);
              if (reason && window.confirm(`Confirm ${capability.isEnabled ? "disable" : "enable"} ${capability.verificationType}?`))
                void act(`providers/${provider.id}/state`, "PATCH", { enabled: !capability.isEnabled,
                  capability: capability.verificationType, reason }); }}>{capability.isEnabled ? "Disable capability" : "Enable capability"}</button>}</li>)}</ul>
          {platform && <button type="button" onClick={() => { const reason = window.prompt(`Reason to ${provider.isActive ? "disable" : "enable"} ${provider.name}`);
            if (reason && window.confirm(`Confirm ${provider.isActive ? "disable" : "enable"} ${provider.name}?`))
              void act(`providers/${provider.id}/state`, "PATCH", { enabled: !provider.isActive, reason }); }}>
            {provider.isActive ? "Disable" : "Enable"}</button>}</article>)}</section>}
      {tab !== "command" && tab !== "providers" && rows && <section><h2>{tab === "reviews" ? "Manual Review" : label(tab[0].toUpperCase() + tab.slice(1))} ({rows.total})</h2>
        {rows.items.length === 0 ? <p>No records found.</p> : <div style={{ overflowX: "auto" }}><table><thead><tr>
          <th>ID / Event</th><th>Client</th><th>State</th><th>Context</th><th>Time</th><th>Actions</th></tr></thead><tbody>
          {rows.items.map((entry) => {
            if (tab === "verifications") { const row = entry as Verification; return <tr key={row.id}>
              <td><button type="button" onClick={() => void openVerification(row.id)}>{row.id}</button></td><td>{row.clientId}</td>
              <td>{label(row.status)}{row.flags.length ? ` · ${row.flags.map(label).join(", ")}` : ""}</td>
              <td>{label(row.verificationType)} · Rider {row.riderId} · {row.finalProvider?.name ?? "No provider"} · {row.attemptCount} attempts</td>
              <td>{time(row.updatedAt)}</td><td><button type="button" onClick={() => void openVerification(row.id)}>Details</button></td></tr>; }
            if (tab === "workflows" || tab === "reviews") { const row = entry as Workflow; return <tr key={row.id}>
              <td><button type="button" onClick={() => void openWorkflow(row.id)}>{row.id}</button></td><td>{row.clientId}</td><td>{label(row.status)}{row.flags.length ? ` · ${row.flags.map(label).join(", ")}` : ""}</td>
              <td>{row.workflowDefinition.name} · Rider {row.riderId}{row.reviewPriority ? ` · ${row.reviewPriority} priority` : ""}
                {row.reviewAssignedTo ? ` · Assigned ${row.reviewAssignedTo}` : ""}</td><td>{time(row.reviewDueAt ?? row.updatedAt)}</td>
              <td>{tab === "reviews" && row.status === "MANUAL_REVIEW" && !platform ? <>
                <button type="button" onClick={() => void assign(row, true)}>Assign to me</button>{" "}
                {canAssignOthers && <><button type="button" onClick={() => void assignToUser(row)}>Assign to user</button>{" "}
                  <button type="button" onClick={() => void assign(row, false)}>Unassign</button>{" "}</>}
                {canAssignOthers && <><button type="button" onClick={() => void setPriority(row)}>Priority</button>{" "}</>}
                <button type="button" onClick={() => void resolve(row, "APPROVE")}>Approve</button>{" "}
                <button type="button" onClick={() => void resolve(row, "REJECT")}>Reject</button></> :
                tab === "workflows" && !platform && canAssignOthers ? <button type="button" onClick={() => void resume(row)}>Recovery preview</button> : "—"}</td></tr>; }
            if (tab === "alerts") { const row = entry as Alert; return <tr key={row.id}>
              <td>{label(row.type)}</td><td>{row.clientId ?? "Global"}</td><td>{row.severity} · {row.status}</td>
              <td>{row.capability ? label(row.capability) : row.entityId ?? "—"} · {row.occurrenceCount} observations</td>
              <td>{time(row.lastSeenAt)}</td><td>{platform && row.status !== "RESOLVED" && <>
                {row.status === "OPEN" && <button type="button" onClick={() => void act(`alerts/${row.id}/acknowledge`, "POST")}>Acknowledge</button>}{" "}
                <button type="button" onClick={() => void act(`alerts/${row.id}/resolve`, "POST")}>Resolve</button></>}</td></tr>; }
            const row = entry as Audit; return <tr key={row.id}><td>{label(row.action)}</td><td>{row.clientId ?? "Global"}</td>
              <td>{row.entityType}</td><td>{row.entityId ?? "—"} · Actor {row.actorId ?? "System"}
                {row.previous && Object.keys(row.previous).length > 0 ? ` · Previous: ${JSON.stringify(row.previous)}` : ""}
                {row.current && Object.keys(row.current).length > 0 ? ` · Current: ${JSON.stringify(row.current)}` : ""}</td>
              <td>{time(row.createdAt)}</td><td>—</td></tr>;
          })}</tbody></table></div>}
        <div style={{ display: "flex", gap: "1rem", margin: "1rem 0" }}><button type="button" disabled={skip === 0}
          onClick={() => setSkip(Math.max(0, skip - 50))}>Previous</button><span>{skip + 1}–{Math.min(skip + 50, rows.total)} of {rows.total}</span>
          <button type="button" disabled={skip + 50 >= rows.total} onClick={() => setSkip(skip + 50)}>Next</button></div></section>}
      {detail && <section className="client-metric-card" aria-label="Verification details"><button type="button" onClick={() => { setDetail(null); setRetryForm({}); }}>Close details</button>
        <h2>Verification {detail.id}</h2><p>Client {detail.clientId} · Rider {detail.riderId} · {label(detail.verificationType)} · {label(detail.status)}</p>
        <p>Flags: {detail.flags.map(label).join(", ") || "None"} · Result: {detail.resultCode ?? "Pending"}</p>
        <h3>Workflow and routing</h3><p>{detail.routingDecision ? `${detail.routingDecision.routingPolicy?.name ?? "Policy"} v${detail.routingDecision.routingPolicyVersion} · ${label(detail.routingDecision.strategy)} · ${detail.routingDecision.decisionReason}` : "No routing decision recorded."}</p>
        <h3>Client usage</h3><p>{detail.featureConsumption ? `${detail.featureConsumption.quantity} verification · ${label(detail.featureConsumption.source)}${detail.featureConsumption.reversedAt ? " · Reversed" : ""}` : "No consumption recorded."}</p>
        <h3>Provider attempts</h3><ul>{detail.attempts.map((attempt) => <li key={attempt.id}>#{attempt.attemptNumber} · {attempt.provider.name} · {label(attempt.reason)} · {label(attempt.status)}
          {attempt.failureCategory ? ` · ${label(attempt.failureCategory)}` : ""}{attempt.latencyMs != null ? ` · ${attempt.latencyMs} ms` : ""}
          {platform && attempt.cost != null ? ` · vendor cost ${attempt.cost}` : ""}</li>)}</ul>
        <h3>Provider conflicts</h3><p>{detail.providerConflicts.map((conflict) => `${conflict.provider.code}: ${conflict.resultStatus} (${conflict.resolution})`).join(" · ") || "None"}</p>
        <h3>Unified timeline</h3><ol>{detail.timeline.map((event) => <li key={event.id}>{time(event.timestamp)} · {event.category} · {label(event.title)}</li>)}</ol>
        {!platform && canAssignOthers && retryPreview && <section aria-label="Technical recovery"><h3>Technical recovery</h3>
          <p>{retryPreview.reason} · Remaining attempts: {retryPreview.attemptsRemaining}</p>
          {retryPreview.allowed && <form autoComplete="off" onSubmit={(event) => { event.preventDefault(); void retryVerification(); }}>
            <p>Re-enter the original identity input. The server checks its fingerprint before making a provider request.</p>
            {detail.verificationType === "PAN_VERIFICATION" && <><label>PAN <input required value={retryForm.pan ?? ""} maxLength={10}
              onChange={(event) => setRetryForm((prior) => ({ ...prior, pan: event.target.value }))} /></label>{" "}
              <label>Name <input required value={retryForm.name ?? ""} onChange={(event) => setRetryForm((prior) => ({ ...prior, name: event.target.value }))} /></label>{" "}
              <label>Date of birth (DD/MM/YYYY) <input required value={retryForm.dateOfBirth ?? ""} placeholder="DD/MM/YYYY"
                onChange={(event) => setRetryForm((prior) => ({ ...prior, dateOfBirth: event.target.value }))} /></label></>}
            {detail.verificationType === "BANK_ACCOUNT_VERIFICATION" && <label>Account number <input required value={retryForm.accountNumber ?? ""}
              onChange={(event) => setRetryForm((prior) => ({ ...prior, accountNumber: event.target.value }))} /></label>}
            {(["BANK_ACCOUNT_VERIFICATION", "IFSC_VERIFICATION"].includes(detail.verificationType)) && <label>IFSC <input required value={retryForm.ifsc ?? ""}
              onChange={(event) => setRetryForm((prior) => ({ ...prior, ifsc: event.target.value }))} /></label>}
            <label>Reason <input required minLength={5} maxLength={500} value={retryForm.reason ?? ""}
              onChange={(event) => setRetryForm((prior) => ({ ...prior, reason: event.target.value }))} /></label>
            <button type="submit">Retry technical failure</button>
          </form>}</section>}</section>}
      {workflowDetail && <section className="client-metric-card" aria-label="Workflow details">
        <button type="button" onClick={() => setWorkflowDetail(null)}>Close workflow</button>
        <h2>{workflowDetail.workflowDefinition.name} · v{workflowDetail.workflowVersion}</h2>
        <p>Execution {workflowDetail.id} · Client {workflowDetail.clientId} · Rider {workflowDetail.riderId} · {label(workflowDetail.status)}</p>
        <p>Flags: {workflowDetail.flags.map(label).join(", ") || "None"} · Priority {workflowDetail.reviewPriority} · Due {time(workflowDetail.reviewDueAt)}</p>
        <h3>Steps</h3><ol>{workflowDetail.steps.map((step) => <li key={step.id}>{step.name} · {step.execution ? label(step.execution.status) : "Not started"}
          {step.execution?.verificationId && <> · <button type="button" onClick={() => void openVerification(step.execution!.verificationId!)}>Verification details</button></>}</li>)}</ol>
        <h3>Decisions</h3><ul>{workflowDetail.decisions.map((decision) => <li key={decision.id}>{time(decision.decidedAt)} · {label(decision.decision)} · {label(decision.reasonCode)}</li>)}</ul>
        <h3>Reconciliation</h3><ul>{workflowDetail.reconciliations.map((item) => <li key={item.type}>{label(item.type)} · {label(item.status)}{item.score == null ? "" : ` · ${item.score}`}</li>)}</ul>
        <h3>Timeline</h3><ol>{workflowDetail.timeline.map((event) => <li key={event.id}>{time(event.timestamp)} · {event.category} · {label(event.title)}</li>)}</ol>
      </section>}
    </>}
  </main>;
}
