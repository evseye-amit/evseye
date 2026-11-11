"use client";
import { formatDateTime } from "../../lib/presentation";

import Link from "next/link";
import { ClientDataTable, type ClientColumn } from "./client-data-table";
import { ClientFormDialog } from "./client-form-dialog";
import { guardLinkNavigation, requestNavigation, markFormsSaved } from "./unsaved-changes";
import { useCallback, useEffect, useRef, useState } from "react";
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

const time = formatDateTime;
const label = (value: string) => value.replaceAll("_", " ");

export default function KycOperationsConsole({ platform = false }: { platform?: boolean }) {
  const base = platform ? "platform/kyc/operations" : "kyc/operations";
  const [actionBusy, setActionBusy] = useState(false);
  const [actionForm, setActionForm] = useState({ reason: "", assignedTo: "", priority: "NORMAL" });
  const [actionDialog, setActionDialog] = useState<{ title: string; description: string; kind: "reason" | "assignment" | "priority" | "retry"; submit: (values: typeof actionForm) => Promise<boolean> } | null>(null);
  const loadGeneration = useRef(0);
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
    const generation = ++loadGeneration.current;
    setBusy(true); setError("");
    const currentGet = async <T,>(path: string) => { const value = await get<T>(base, path); if (generation !== loadGeneration.current) throw new Error("View changed."); return value; };
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
      if (tab === "command") setSummary(await currentGet<Summary>(`summary?${params}`));
      else if (tab === "providers") setProviders(await currentGet<Provider[]>("providers"));
      else {
        const page = await currentGet<Page<Verification | Workflow | Alert | Audit>>(`${tab === "reviews" ? "manual-reviews" : tab}?${params}`);
        const lastSkip = Math.floor(Math.max(0, page.total - 1) / 50) * 50;
        if (skip > lastSkip) { setSkip(lastSkip); return; }
        setRows(page);
      }
    } catch (cause) { if (generation === loadGeneration.current) setError(cause instanceof Error ? cause.message : "Unable to load KYC operations."); }
    finally { if (generation === loadGeneration.current) setBusy(false); }
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
    const timer = window.setInterval(() => { if (!document.hidden && !detail && !workflowDetail && !actionDialog) void load(); }, 60_000);
    return () => window.clearInterval(timer);
  }, [detail, workflowDetail, actionDialog, load]);

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
    if (!detail || !retryPreview?.allowed || !retryKey || actionBusy) return false;
    setActionBusy(true);
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
      setRetryKey(crypto.randomUUID()); markFormsSaved(); await load(); return true;
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Technical retry failed."); return false; }
    finally { setActionBusy(false); }
  }
  async function openWorkflow(id: string) {
    setError("");
    try { setWorkflowDetail(await get<WorkflowDetail>(base, `workflows/${id}`)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to load workflow."); }
  }
  async function act(path: string, method: "POST" | "PATCH", payload?: object) {
    if (actionBusy) return false;
    setActionBusy(true); setError(""); setMessage("");
    try { await send(base, path, method, payload); setMessage("Action recorded."); await load(); return true; }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Action failed."); return false; }
    finally { setActionBusy(false); }
  }
  function queueAction(title: string, description: string, submit: (values: typeof actionForm) => Promise<boolean>, kind: "reason" | "assignment" | "priority" | "retry" = "reason", priority = "NORMAL") {
    setError(""); setActionForm({ reason: "", assignedTo: "", priority }); setActionDialog({ title, description, submit, kind });
  }
  function assign(row: Workflow, self: boolean) {
    queueAction(self ? "Assign review to me" : "Unassign review", `Review ${row.id}. Provide the reason for this assignment change.`, (values) => act(`manual-reviews/${row.id}/assignment`, "PATCH", { assignedTo: self ? undefined : null, expectedVersion: row.reviewVersion, reason: values.reason.trim() }));
  }
  function assignToUser(row: Workflow) {
    queueAction("Assign review to user", `Review ${row.id}. The reviewer must belong to the same client.`, (values) => act(`manual-reviews/${row.id}/assignment`, "PATCH", { assignedTo: values.assignedTo.trim(), expectedVersion: row.reviewVersion, reason: values.reason.trim() }), "assignment");
  }
  function resolve(row: Workflow, action: "APPROVE" | "REJECT") {
    queueAction(action === "APPROVE" ? "Approve workflow review" : "Reject workflow review", `Review ${row.id}. This records a workflow decision; rider document approval remains separate.`, (values) => act(`manual-reviews/${row.id}/resolve`, "POST", { action, expectedVersion: row.reviewVersion, reason: values.reason.trim() }));
  }
  function setPriority(row: Workflow) {
    queueAction("Change review priority", `Review ${row.id}. Choose the priority and record the reason.`, (values) => act(`manual-reviews/${row.id}/priority`, "PATCH", { priority: values.priority, expectedVersion: row.reviewVersion, reason: values.reason.trim() }), "priority", row.reviewPriority ?? "NORMAL");
  }
  async function resume(row: Workflow) {
    setError("");
    try {
      const preview = await get<{ allowed: boolean; reason: string; expectedVersion: number; newProviderCallPossible: boolean; newClientUsagePossible: boolean }>(base, `workflows/${row.id}/recovery-options`);
      if (!preview.allowed) { setMessage(preview.reason); return; }
      queueAction("Resume workflow", `${preview.reason} No new provider call or client usage.`, (values) => act(`workflows/${row.id}/resume`, "POST", { expectedVersion: preview.expectedVersion, reason: values.reason.trim() }));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Recovery preview failed."); }
  }
  const rowColumns: ClientColumn<Verification | Workflow | Alert | Audit>[] = [
    { key: "record", label: "Record / Event", value: (entry) => "type" in entry ? label(entry.type) : "action" in entry ? label(entry.action) : entry.id },
    ...(platform ? [{ key: "client", label: "Client", value: (entry: Verification | Workflow | Alert | Audit) => entry.clientId ?? "Global" }] : []),
    { key: "status", label: "Status", value: (entry) => "status" in entry ? label(entry.status) : entry.entityType, render: (entry) => "status" in entry ? <span className={`status status-${entry.status.toLowerCase()}`}>{label(entry.status)}</span> : entry.entityType },
    { key: "context", label: "Context", value: (entry) => "verificationType" in entry ? `${label(entry.verificationType)} · Rider ${entry.riderId} · ${entry.finalProvider?.name ?? "No provider"} · ${entry.attemptCount} attempts` : "workflowDefinition" in entry ? `${entry.workflowDefinition.name} · Rider ${entry.riderId} · ${entry.reviewPriority ?? "NORMAL"} priority · ${entry.reviewAssignedTo ?? "Unassigned"}` : "occurrenceCount" in entry ? `${entry.capability ?? entry.entityId ?? "—"} · ${entry.severity} · ${entry.occurrenceCount} observations` : `${entry.entityId ?? "—"} · Actor ${entry.actorId ?? "System"}`, render: (entry) => "action" in entry ? <><p>{entry.entityId ?? "—"} · Actor {entry.actorId ?? "System"}</p><details><summary>View field changes</summary><dl className="record-field-changes">{[...new Set([...Object.keys(entry.previous ?? {}), ...Object.keys(entry.current ?? {})])].map((key) => <div key={key}><dt>{label(key)}</dt><dd>{String(entry.previous?.[key] ?? "—")} → {String(entry.current?.[key] ?? "—")}</dd></div>)}</dl></details></> : "flags" in entry ? <span>{"verificationType" in entry ? `${label(entry.verificationType)} · ${entry.finalProvider?.name ?? "No provider"} · ${entry.attemptCount} attempts` : `${entry.workflowDefinition.name} · ${entry.reviewPriority ?? "NORMAL"} priority · ${entry.reviewAssignedTo ?? "Unassigned"}`}<small className="record-secondary">Rider {entry.riderId}{entry.flags.length ? ` · ${entry.flags.map(label).join(", ")}` : ""}</small></span> : `${entry.capability ?? entry.entityId ?? "—"} · ${entry.severity} · ${entry.occurrenceCount} observations` },
    { key: "time", label: "Updated / Due", value: (entry) => "reviewDueAt" in entry && entry.reviewDueAt ? entry.reviewDueAt : "updatedAt" in entry ? entry.updatedAt : "lastSeenAt" in entry ? entry.lastSeenAt : "createdAt" in entry ? entry.createdAt : "", render: (entry) => time("updatedAt" in entry ? ("reviewDueAt" in entry ? entry.reviewDueAt ?? entry.updatedAt : entry.updatedAt) : "lastSeenAt" in entry ? entry.lastSeenAt : "createdAt" in entry ? entry.createdAt : null) },
  ];

  return <main className={`client-dashboard kyc-workspace ${platform ? "" : "client-operations-main"}`} onClickCapture={guardLinkNavigation}>
    <header className="client-dashboard-header"><div><p className="eyebrow">{platform ? "EVsEYE OPERATIONS" : "CLIENT WORKSPACE"}</p>
      <h1>{platform ? "KYC Command Center" : "KYC Operations"}</h1><p>Verification, workflow, provider and incident operations</p></div>
      <div><Link href={platform ? "/platform/kyc/analytics" : "/client/kyc/analytics"}>Analytics</Link>{" · "}
      {platform && <><Link href="/platform/kyc/intelligent-routing">Intelligent Routing</Link>{" · "}</>}
      <Link href={platform ? "/platform/dashboard" : "/client/kyc"}>Back</Link></div></header>
    {error && !actionDialog && !detail && !workflowDetail && <p className="error" role="alert">{error}</p>}{message && <p className="notice" role="status">{message}</p>}
    {!platform && <p className="muted">Rider KYC verification follows onboarding document approval. Provider checks and workflow decisions below are tracked separately.</p>}
    {authorized && <><nav aria-label="KYC operations sections" style={{ display: "flex", gap: ".5rem", flexWrap: "wrap", margin: "1.5rem 0" }}>
      {(["command", "verifications", "workflows", "reviews", "providers", "alerts", "audit"] as Tab[]).map((item) =>
        <button key={item} type="button" aria-current={tab === item ? "page" : undefined}
          onClick={() => requestNavigation(() => { setTab(item); setRows(null); loadGeneration.current += 1; setSkip(0); setFilter(""); setSearch(""); setSearchDraft("");
            setDetail(null); setWorkflowDetail(null); setRetryForm({}); })}>{item === "command" ? "Command Center" :
            item === "reviews" ? "Manual Review" : label(item[0].toUpperCase() + item.slice(1))}</button>)}</nav>
      <div className="client-filter-bar">
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
            {platform && <button type="button" onClick={() => queueAction(capability.isEnabled ? "Disable capability" : "Enable capability", label(capability.verificationType), (values) => act(`providers/${provider.id}/state`, "PATCH", { enabled: !capability.isEnabled, capability: capability.verificationType, reason: values.reason.trim() }))}>{capability.isEnabled ? "Disable capability" : "Enable capability"}</button>}</li>)}</ul>
          {platform && <button type="button" onClick={() => queueAction(provider.isActive ? "Disable provider" : "Enable provider", provider.name, (values) => act(`providers/${provider.id}/state`, "PATCH", { enabled: !provider.isActive, reason: values.reason.trim() }))}>{provider.isActive ? "Disable" : "Enable"}</button>}</article>)}</section>}
      {tab !== "command" && tab !== "providers" && rows && <section><h2>{tab === "reviews" ? "Manual Review" : label(tab[0].toUpperCase() + tab.slice(1))}</h2>
        <ClientDataTable key={tab} rows={rows.items} columns={rowColumns} getRowId={(row) => row.id} loading={busy} searchable={false} server={{ page: Math.floor(skip / 50) + 1, limit: 50, total: rows.total, search, onSearch: setSearch, onPage: (page) => setSkip((page - 1) * 50) }} actions={(entry) => "verificationType" in entry ? <button type="button" className="secondary table-action" disabled={actionBusy} onClick={() => void openVerification(entry.id)}>Details</button> : "workflowDefinition" in entry ? <>
          <button type="button" className="secondary table-action" disabled={actionBusy} onClick={() => void openWorkflow(entry.id)}>Details</button>
          {tab === "reviews" && entry.status === "MANUAL_REVIEW" && !platform && <><button type="button" className="secondary table-action" disabled={actionBusy} onClick={() => assign(entry, true)}>Assign to me</button>{canAssignOthers && <><button type="button" className="secondary table-action" onClick={() => assignToUser(entry)}>Assign to user</button><button type="button" className="secondary table-action" onClick={() => assign(entry, false)}>Unassign</button><button type="button" className="secondary table-action" onClick={() => setPriority(entry)}>Priority</button></>}<button type="button" disabled={actionBusy} onClick={() => resolve(entry, "APPROVE")}>Approve</button><button type="button" className="danger table-action" disabled={actionBusy} onClick={() => resolve(entry, "REJECT")}>Reject</button></>}
          {tab === "workflows" && !platform && canAssignOthers && <button type="button" className="secondary table-action" disabled={actionBusy} onClick={() => void resume(entry)}>Recovery preview</button>}
        </> : "occurrenceCount" in entry && platform && entry.status !== "RESOLVED" ? <>{entry.status === "OPEN" && <button type="button" className="secondary table-action" disabled={actionBusy} onClick={() => void act(`alerts/${entry.id}/acknowledge`, "POST")}>Acknowledge</button>}<button type="button" className="secondary table-action" disabled={actionBusy} onClick={() => void act(`alerts/${entry.id}/resolve`, "POST")}>Resolve</button></> : <span className="muted">—</span>} />
      </section>}
      {detail && <ClientFormDialog title="Provider verification details" wide busy={actionBusy} error={error} onClose={() => { setDetail(null); setRetryForm({}); }}><details><summary>Record identifiers</summary><p>Verification {detail.id} · Client {detail.clientId} · Rider {detail.riderId}</p></details><p>Client {detail.clientId} · Rider {detail.riderId} · {label(detail.verificationType)} · {label(detail.status)}</p>
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
          {retryPreview.allowed && <form autoComplete="off" className="form-stack" onSubmit={(event) => { event.preventDefault(); queueAction("Retry technical verification?", "This retry may generate an additional provider request and vendor cost. It will not create another client usage entry.", () => retryVerification(), "retry"); }}>
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
          </form>}</section>}</ClientFormDialog>}
      {workflowDetail && <ClientFormDialog title={`${workflowDetail.workflowDefinition.name} · v${workflowDetail.workflowVersion}`} wide busy={actionBusy} error={error} onClose={() => setWorkflowDetail(null)}>
        <p>Execution {workflowDetail.id} · Client {workflowDetail.clientId} · Rider {workflowDetail.riderId} · {label(workflowDetail.status)}</p>
        <p>Flags: {workflowDetail.flags.map(label).join(", ") || "None"} · Priority {workflowDetail.reviewPriority} · Due {time(workflowDetail.reviewDueAt)}</p>
        <h3>Steps</h3><ol>{workflowDetail.steps.map((step) => <li key={step.id}>{step.name} · {step.execution ? label(step.execution.status) : "Not started"}
          {step.execution?.verificationId && <> · <button type="button" onClick={() => void openVerification(step.execution!.verificationId!)}>Verification details</button></>}</li>)}</ol>
        <h3>Decisions</h3><ul>{workflowDetail.decisions.map((decision) => <li key={decision.id}>{time(decision.decidedAt)} · {label(decision.decision)} · {label(decision.reasonCode)}</li>)}</ul>
        <h3>Reconciliation</h3><ul>{workflowDetail.reconciliations.map((item) => <li key={item.type}>{label(item.type)} · {label(item.status)}{item.score == null ? "" : ` · ${item.score}`}</li>)}</ul>
        <h3>Timeline</h3><ol>{workflowDetail.timeline.map((event) => <li key={event.id}>{time(event.timestamp)} · {event.category} · {label(event.title)}</li>)}</ol>
      </ClientFormDialog>}
    </>}
    {actionDialog && <ClientFormDialog title={actionDialog.title} busy={actionBusy} error={error} onClose={() => setActionDialog(null)}><form className="form-stack" onSubmit={async (event) => { event.preventDefault(); if (await actionDialog.submit(actionForm)) setActionDialog(null); }}><p>{actionDialog.description}</p>
      {actionDialog.kind === "assignment" && <label>Reviewer user ID *<input aria-label="Reviewer user ID" required value={actionForm.assignedTo} onChange={(event) => setActionForm({ ...actionForm, assignedTo: event.target.value })} /></label>}
      {actionDialog.kind === "priority" && <label>Priority *<select aria-label="Priority" value={actionForm.priority} onChange={(event) => setActionForm({ ...actionForm, priority: event.target.value })}>{["LOW", "NORMAL", "HIGH", "CRITICAL"].map((priority) => <option key={priority}>{priority}</option>)}</select></label>}
      {actionDialog.kind !== "retry" && <label>Reason *<textarea aria-label="Reason" required minLength={5} maxLength={500} value={actionForm.reason} onChange={(event) => setActionForm({ ...actionForm, reason: event.target.value })} /></label>}
      <div className="form-actions"><button type="button" className="secondary" disabled={actionBusy} onClick={() => setActionDialog(null)}>Cancel</button><button disabled={actionBusy || (actionDialog.kind !== "retry" && actionForm.reason.trim().length < 5)}>{actionBusy ? "Saving…" : "Confirm"}</button></div>
    </form></ClientFormDialog>}
  </main>;
}
