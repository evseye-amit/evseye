"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { sessionFetch } from "../../../lib/session-fetch";
import WorkflowPanel from "./workflow-panel";
import RoutingPanel from "./routing-panel";
import CommercialPanel from "./commercial-panel";

type Status = "CREATED" | "PROCESSING" | "OTP_REQUIRED" | "VERIFIED" | "FAILED" | "MANUAL_REVIEW";
type Verification = { id: string; riderId: string; verificationType: string; status: Status;
  requestedAt: string; completedAt?: string | null; resultCode?: string | null;
  finalProvider?: { name: string; code: string } | null;
  attempts?: { id: string; attemptNumber: number; status: string; latencyMs?: number | null;
    reason?: string; isLateCompletion?: boolean; provider?: { code: string; name: string };
    failureCategory?: string | null }[];
  results?: { normalizedData: Record<string, string | boolean | null>; status: string }[];
  routingDecision?: { routingPolicyVersion: number; strategy: string; selectedProviders: string[];
    decisionReason: string; routingPolicy?: { code: string; name: string } | null } | null;
  providerConflicts?: { provider: { code: string }; resultStatus: string; conflictType: string; resolution: string }[];
  routingTimeline?: { id: string; action: string; createdAt: string; newData?: Record<string, string | number | string[] | null> | null }[];
  auditTimeline?: { id: string; action: string; actorId: string | null; createdAt: string }[] };
type Provider = { id: string; name: string; code: string; status: string; environment: string; isActive: boolean;
  capabilities: { verificationType: string; isEnabled: boolean; timeoutMs: number; maxRetries: number }[] };
type Overview = { total: number; byStatus: Record<string, number> };
type Health = { status: string; recentRequests: number; successRate: number | null;
  failureRate: number | null; averageLatencyMs: number | null; lastSuccessAt: string | null; lastFailureAt: string | null };
type CapabilityHealth = { provider: { id: string; name: string }; verificationType: string; status: string;
  recentRequests: number; technicalFailureRate: number | null; businessFailureRate: number | null;
  p50LatencyMs: number | null; p95LatencyMs: number | null; p99LatencyMs: number | null };

async function api<T>(path: string): Promise<T> {
  const response = await sessionFetch(`/api/v1/kyc/${path}`, { cache: "no-store" });
  const body = await response.json() as { data?: T; error?: { message?: string }; message?: string };
  if (!response.ok || !body.data) throw new Error(body.error?.message ?? body.message ?? "Unable to load KYC data.");
  return body.data;
}

export default function KycAdministration() {
  const [authorized, setAuthorized] = useState(false);
  const [canManagePolicy, setCanManagePolicy] = useState(false);
  const [tab, setTab] = useState<"overview" | "providers" | "verifications" | "health" | "workflows" | "reviews" | "definitions" | "routing" | "commercial">("overview");
  const [overview, setOverview] = useState<Overview | null>(null);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [rows, setRows] = useState<Verification[]>([]);
  const [selected, setSelected] = useState<Verification | null>(null);
  const [health, setHealth] = useState<Record<string, Health>>({});
  const [capabilityHealth, setCapabilityHealth] = useState<CapabilityHealth[]>([]);
  const [status, setStatus] = useState("");
  const [type, setType] = useState("");
  const [page, setPage] = useState(0);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const meResponse = await sessionFetch("/api/v1/auth/me", { cache: "no-store" });
      if (!meResponse.ok) throw new Error("Please sign in to view KYC administration.");
      const me = await meResponse.json() as { data?: { roles?: string[]; role?: string } };
      const roles = me.data?.roles ?? (me.data?.role ? [me.data.role] : []);
      if (!roles.some((role) => role === "CLIENT_ADMIN" || role === "KYC_OPERATOR"))
        throw new Error("You are not authorized to view KYC administration.");
      setAuthorized(true);
      setCanManagePolicy(roles.includes("CLIENT_ADMIN"));
      if (tab === "overview") setOverview(await api<Overview>("admin/overview"));
      if (tab === "providers" || tab === "health") {
        const list = await api<Provider[]>("admin/providers");
        setProviders(list);
        if (tab === "health") {
          const entries = await Promise.all(list.map(async (provider) => {
            const result = await api<Health>(`admin/providers/${provider.id}/health`);
            return [provider.id, result] as const;
          }));
          setHealth(Object.fromEntries(entries));
          setCapabilityHealth(await api<CapabilityHealth[]>("admin/provider-capability-health"));
        }
      }
      if (tab === "verifications") {
        const query = new URLSearchParams({ skip: String(page * 50) });
        if (status) query.set("status", status);
        if (type) query.set("type", type);
        setRows(await api<Verification[]>(`verifications?${query}`));
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to load KYC data."); }
    finally { setLoading(false); }
  }, [tab, page, status, type]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function openDetail(id: string) {
    setError("");
    try { setSelected(await api<Verification>(`verifications/${id}`)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to load verification."); }
  }

  return <main className="client-dashboard" style={{ padding: "2rem", maxWidth: 1200, margin: "0 auto" }}>
    <header className="client-dashboard-header"><div><p className="eyebrow">CLIENT WORKSPACE</p><h1>KYC &amp; Verification</h1>
      <p>Client scoped verification operations</p></div><div><Link href="/client/kyc/operations">Command Center</Link>{" · "}<Link href="/client">Back to dashboard</Link></div></header>
    {authorized && <nav aria-label="KYC sections" style={{ display: "flex", gap: "1rem", margin: "1.5rem 0" }}>
      {(["overview", "workflows", "verifications", "reviews", "definitions", "providers", "routing", "health", "commercial"] as const).map((item) =>
        <button key={item} type="button" aria-current={tab === item ? "page" : undefined}
          onClick={() => { setTab(item); setSelected(null); }}>{item === "reviews" ? "Manual Review" : item === "routing" ? "Routing Policies" : item === "definitions" ? "Definitions" : item === "commercial" ? "Policy & Usage" : item[0].toUpperCase() + item.slice(1)}</button>)}
    </nav>}
    {loading && <p role="status">Loading KYC data…</p>}
    {error && <p role="alert">{error}</p>}
    {authorized && (tab === "workflows" || tab === "reviews" || tab === "definitions") && <WorkflowPanel view={tab} />}
    {authorized && tab === "routing" && <RoutingPanel />}
    {authorized && tab === "commercial" && <CommercialPanel canManage={canManagePolicy} />}
    {!loading && authorized && tab === "overview" && overview && <section className="client-metrics" aria-label="KYC metrics">
      {(["Total", "VERIFIED", "FAILED", "PROCESSING", "OTP_REQUIRED", "MANUAL_REVIEW"] as const).map((label) =>
        <article className="client-metric-card" key={label}><span>{label.replaceAll("_", " ")}</span>
          <strong>{label === "Total" ? overview.total : overview.byStatus[label] ?? 0}</strong></article>)}
    </section>}
    {!loading && authorized && tab === "providers" && <section><h2>Providers</h2>
      {providers.length === 0 ? <p>No providers configured.</p> : providers.map((provider) =>
        <article key={provider.id} className="client-metric-card" style={{ marginBottom: "1rem" }}>
          <h3>{provider.name}</h3><p>{provider.code} · {provider.environment} · {provider.status} · {provider.isActive ? "Enabled" : "Disabled"}</p>
          <ul>{provider.capabilities.map((capability) => <li key={capability.verificationType}>
            {capability.verificationType.replaceAll("_", " ")} · {capability.isEnabled ? "Enabled" : "Disabled"}
            {" · "}{capability.timeoutMs} ms timeout · {capability.maxRetries} retries</li>)}</ul>
        </article>)}
    </section>}
    {!loading && authorized && tab === "health" && <section><h2>Provider health</h2>
      {capabilityHealth.length > 0 && <table><thead><tr><th>Provider</th><th>Capability</th><th>Status</th><th>Requests</th><th>Technical failures</th><th>Business failures</th><th>P50 / P95 / P99</th></tr></thead>
        <tbody>{capabilityHealth.map((item) => <tr key={`${item.provider.id}-${item.verificationType}`}><td>{item.provider.name}</td><td>{item.verificationType}</td>
          <td>{item.status}</td><td>{item.recentRequests}</td><td>{item.technicalFailureRate == null ? "—" : `${Math.round(item.technicalFailureRate * 100)}%`}</td>
          <td>{item.businessFailureRate == null ? "—" : `${Math.round(item.businessFailureRate * 100)}%`}</td>
          <td>{[item.p50LatencyMs, item.p95LatencyMs, item.p99LatencyMs].map((value) => value == null ? "—" : `${value} ms`).join(" / ")}</td></tr>)}</tbody></table>}
      {providers.length === 0 ? <p>No providers configured.</p> : providers.map((provider) =>
        <article key={provider.id} className="client-metric-card"><h3>{provider.name}</h3>
          <p>{health[provider.id]?.status ?? "UNKNOWN"}</p>
          {health[provider.id] && <p>Recent requests: {health[provider.id]?.recentRequests} · Success: {health[provider.id]?.successRate == null ? "—" : `${Math.round((health[provider.id]?.successRate ?? 0) * 100)}%`}
            {" · "}Failure: {health[provider.id]?.failureRate == null ? "—" : `${Math.round((health[provider.id]?.failureRate ?? 0) * 100)}%`}
            {" · "}Average latency: {health[provider.id]?.averageLatencyMs ?? "—"} ms</p>}
          {health[provider.id] && <p>Last success: {health[provider.id]?.lastSuccessAt ? new Date(health[provider.id]?.lastSuccessAt ?? "").toLocaleString() : "—"}
            {" · "}Last failure: {health[provider.id]?.lastFailureAt ? new Date(health[provider.id]?.lastFailureAt ?? "").toLocaleString() : "—"}</p>}
        </article>)}
    </section>}
    {!loading && authorized && tab === "verifications" && <section><h2>Verifications</h2>
      <div style={{ display: "flex", gap: "1rem", marginBottom: "1rem" }}>
        <label>Status <select value={status} onChange={(event) => { setStatus(event.target.value); setPage(0); }}>
          <option value="">All</option>{["CREATED", "PROCESSING", "OTP_REQUIRED", "VERIFIED", "FAILED", "MANUAL_REVIEW"].map((value) => <option key={value}>{value}</option>)}
        </select></label>
        <label>Type <select value={type} onChange={(event) => { setType(event.target.value); setPage(0); }}>
          <option value="">All</option>{["PAN_VERIFICATION", "AADHAAR_OTP", "BANK_ACCOUNT_VERIFICATION", "IFSC_VERIFICATION"].map((value) => <option key={value}>{value}</option>)}
        </select></label>
      </div>
      {rows.length === 0 ? <p>No verifications found.</p> : <table><thead><tr><th>ID</th><th>Rider</th><th>Type</th><th>Status</th><th>Provider</th><th>Requested</th></tr></thead>
        <tbody>{rows.map((row) => <tr key={row.id}><td><button type="button" onClick={() => void openDetail(row.id)}>{row.id.slice(0, 8)}</button></td>
          <td>{row.riderId.slice(0, 8)}</td><td>{row.verificationType}</td><td>{row.status}</td><td>{row.finalProvider?.name ?? "—"}</td>
          <td>{new Date(row.requestedAt).toLocaleString()}</td></tr>)}</tbody></table>}
      <div style={{ display: "flex", gap: "1rem", marginTop: "1rem" }}>
        <button type="button" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</button>
        <span>Page {page + 1}</span><button type="button" disabled={rows.length < 50} onClick={() => setPage(page + 1)}>Next</button>
      </div>
      {selected && <article className="client-metric-card" style={{ marginTop: "2rem" }}><h3>Verification {selected.id}</h3>
        <p>Rider: {selected.riderId} · {selected.verificationType} · {selected.status}</p>
        <p>Provider: {selected.finalProvider?.name ?? "—"} · Requested: {new Date(selected.requestedAt).toLocaleString()}</p>
        {selected.resultCode && <p>Result: {selected.resultCode}</p>}
        <h4>Routing</h4>{selected.routingDecision ? <p>Policy: {selected.routingDecision.routingPolicy?.code ?? "Legacy single provider"}
          {" · "}Version {selected.routingDecision.routingPolicyVersion} · {selected.routingDecision.strategy}
          {" · "}Selected: {selected.routingDecision.selectedProviders.join(", ")}</p> : <p>No routing decision recorded.</p>}
        {selected.providerConflicts?.length ? <ul>{selected.providerConflicts.map((conflict) => <li key={conflict.provider.code}>
          {conflict.provider.code}: {conflict.resultStatus} · {conflict.resolution}</li>)}</ul> : null}
        {selected.routingTimeline?.length ? <ol>{selected.routingTimeline.map((event) => <li key={event.id}>
          {new Date(event.createdAt).toLocaleString()} · {event.action} {event.newData ? `· ${Object.entries(event.newData).map(([key, value]) => `${key}: ${value}`).join(", ")}` : ""}</li>)}</ol> : null}
        <h4>Normalized results</h4>{selected.results?.length ? selected.results.map((result, index) =>
          <pre key={index}>{JSON.stringify(result.normalizedData, null, 2)}</pre>) : <p>No result yet.</p>}
        <h4>Attempts</h4>{selected.attempts?.map((attempt) => <p key={attempt.id}>#{attempt.attemptNumber} · {attempt.provider?.name ?? "Provider"} · {attempt.reason ?? "PRIMARY"} · {attempt.status}
          {attempt.isLateCompletion ? " · Late completion" : ""}
          {attempt.latencyMs != null ? ` · ${attempt.latencyMs} ms` : ""}
          {attempt.failureCategory ? ` · ${attempt.failureCategory}` : ""}
          </p>)}
        <h4>Audit timeline</h4>{selected.auditTimeline?.length ? selected.auditTimeline.map((event) =>
          <p key={event.id}>{new Date(event.createdAt).toLocaleString()} · {event.action}</p>) : <p>No audit events yet.</p>}
      </article>}
    </section>}
  </main>;
}
