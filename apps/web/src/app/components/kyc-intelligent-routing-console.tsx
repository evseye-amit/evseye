"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { sessionFetch } from "../../lib/session-fetch";

type Policy = { id: string; code: string; version: number; clientId?: string | null;
  verificationType: string; mode: string; status: string; rolloutPercent: number;
  observationWindowMinutes: number; minimumSampleSize: number; maxSnapshotAgeMinutes: number;
  latencyTargetMs: number; weights: Record<string, number>; sourceShadowPolicyId?: string | null };
type Control = { scopeKey: string; disabled: boolean; reason: string; updatedAt: string };
type Preview = { usable: boolean; reason: string; selectedProviderId?: string | null;
  scores: { providerId: string; score: number; components: Record<string, number>; sampleSize: number;
    insufficientData: boolean }[] };
type Shadow = { total: number; agreement: number; agreementRate: number | null;
  items: { id: string; policyId: string; actualProviderId?: string | null; shadowProviderId?: string | null;
    reason: string; createdAt: string }[] };
type Readiness = { providerId: string; provider: string; verificationType: string; environment: string;
  active: boolean; credentialConfigured: boolean; costConfigured: boolean; slaConfigured: boolean;
  health: string; circuitOpen: boolean; timeoutMs: number };
const base = "/api/v1/platform/kyc/intelligent-routing";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await sessionFetch(`${base}/${path}`, { cache: "no-store", ...init });
  const body = await response.json() as { data?: T; error?: { message?: string }; message?: string };
  if (!response.ok || body.data === undefined) throw new Error(body.error?.message ?? body.message ?? "Routing request failed.");
  return body.data;
}

export default function KycIntelligentRoutingConsole() {
  const [authorized, setAuthorized] = useState(false);
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [controls, setControls] = useState<Control[]>([]);
  const [shadow, setShadow] = useState<Shadow | null>(null);
  const [readiness, setReadiness] = useState<Readiness[]>([]);
  const [preview, setPreview] = useState<Record<string, Preview>>({});
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({ code: "PAN_ROUTING", clientId: "", verificationType: "PAN_VERIFICATION",
    mode: "SHADOW", observationWindowMinutes: 60, minimumSampleSize: 30, maxSnapshotAgeMinutes: 10,
    latencyTargetMs: 1000, unknownCostBehavior: "NEUTRAL", rolloutPercent: 0, sourceShadowPolicyId: "",
    reliability: 3, latency: 1, cost: 1, sla: 1, health: 1, reason: "" });

  useEffect(() => {
    let live = true;
    void sessionFetch("/api/v1/auth/me", { cache: "no-store" }).then(async (response) => {
      if (!response.ok) throw new Error("Sign in to access intelligent routing.");
      const body = await response.json() as { data?: { role?: string; roles?: string[] } };
      const roles = body.data?.roles ?? (body.data?.role ? [body.data.role] : []);
      if (!roles.includes("SUPER_ADMIN")) throw new Error("Only platform administrators can manage intelligent routing.");
      if (live) setAuthorized(true);
    }).catch((cause) => { if (live) setError(cause instanceof Error ? cause.message : "Unauthorized."); });
    return () => { live = false; };
  }, []);

  const load = useCallback(async () => {
    if (!authorized) return;
    setLoading(true); setError("");
    try {
      const [nextPolicies, nextControls, nextShadow, nextReadiness] = await Promise.all([
        request<Policy[]>("policies"), request<Control[]>("controls"), request<Shadow>("shadow"), request<Readiness[]>("readiness"),
      ]);
      setPolicies(nextPolicies); setControls(nextControls); setShadow(nextShadow); setReadiness(nextReadiness);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to load routing state."); }
    finally { setLoading(false); }
  }, [authorized]);
  useEffect(() => { void load(); }, [load]);

  async function command(path: string, method: "POST" | "PATCH", payload: object) {
    setError(""); setMessage("");
    try {
      await request(path, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      setMessage("Routing configuration saved and audited."); await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Routing configuration failed."); }
  }
  async function state(policy: Policy, action: "activate" | "pause") {
    const reason = window.prompt(`${action === "activate" ? "Activate" : "Pause"} ${policy.code} v${policy.version}: reason (10+ characters)`);
    if (!reason || reason.trim().length < 10) return;
    if (!window.confirm(`${action === "activate" ? "Activate" : "Pause"} ${policy.code} v${policy.version}? This changes future routing only.`)) return;
    await command(`policies/${policy.id}/${action}`, "PATCH", { reason, confirm: true });
  }
  async function control(scopeKey: string, disabled: boolean) {
    const reason = window.prompt(`${disabled ? "Disable" : "Enable"} intelligent routing for ${scopeKey}: reason (10+ characters)`);
    if (!reason || reason.trim().length < 10) return;
    if (!window.confirm(`${disabled ? "Disable" : "Enable"} intelligent routing for ${scopeKey}?`)) return;
    await command("controls", "PATCH", { scopeKey, disabled, reason, confirm: true });
  }
  async function score(policy: Policy) {
    setError("");
    try {
      const clientId = policy.clientId ?? window.prompt("Client ID for this preview");
      if (!clientId) return;
      const result = await request<Preview>(`policies/${policy.id}/preview?clientId=${encodeURIComponent(clientId)}`);
      setPreview({ ...preview, [policy.id]: result });
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Preview failed."); }
  }

  return <main className="client-dashboard" style={{ padding: "2rem", maxWidth: 1400, margin: "0 auto" }}>
    <header className="client-dashboard-header"><div><p className="eyebrow">EVsEYE PLATFORM</p>
      <h1>Intelligent KYC Routing</h1><p>Versioned policies, shadow evaluation, controlled rollout and provider readiness</p></div>
      <Link href="/platform/kyc/analytics">KYC Analytics</Link></header>
    {error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}
    {authorized && <>
      {loading && <p role="status">Loading routing controls…</p>}
      <section><h2>Kill switches</h2><p>When disabled, routing uses the existing static provider policy.</p>
        {controls.map((item) => <p key={item.scopeKey}><strong>{item.scopeKey}</strong>: {item.disabled ? "Disabled" : "Enabled"}
          {" · "}{item.reason} {" "}<button type="button" onClick={() => void control(item.scopeKey, !item.disabled)}>
            {item.disabled ? "Enable" : "Disable"}</button></p>)}
        <button type="button" onClick={() => { const scope = window.prompt("Scope: TYPE:CAPABILITY or CLIENT:UUID");
          if (scope) void control(scope, true); }}>Add scoped kill switch</button></section>
      <section><h2>Routing policies</h2>
        {!policies.length && <p>No intelligent policy exists. Static routing remains in effect.</p>}
        <div style={{ overflowX: "auto" }}><table><thead><tr><th>Policy</th><th>Scope</th><th>Mode</th><th>Rollout</th>
          <th>Observation</th><th>Minimum sample</th><th>Status</th><th>Actions</th></tr></thead><tbody>
          {policies.map((policy) => <tr key={policy.id}><td>{policy.code} v{policy.version}</td>
            <td>{policy.clientId ?? "Global"} · {policy.verificationType}</td><td>{policy.mode}</td>
            <td>{policy.rolloutPercent}%</td><td>{policy.observationWindowMinutes} min</td>
            <td>{policy.minimumSampleSize}</td><td>{policy.status}</td><td>
              <button type="button" onClick={() => void score(policy)}>Score preview</button>
              {policy.status === "DRAFT" || policy.status === "PAUSED" ? <button type="button" onClick={() => void state(policy, "activate")}>Activate</button> : null}
              {policy.status === "ACTIVE" && <button type="button" onClick={() => void state(policy, "pause")}>Pause</button>}
            </td></tr>)}</tbody></table></div>
        {policies.map((policy) => preview[policy.id] && <div key={policy.id}><h3>Preview: {policy.code} v{policy.version}</h3>
          <p>{preview[policy.id].usable ? `Hypothetical provider ${preview[policy.id].selectedProviderId}` : preview[policy.id].reason}</p>
          {preview[policy.id].scores.map((row) => <p key={row.providerId}>{row.providerId}: {row.score.toFixed(3)},
            sample {row.sampleSize}{row.insufficientData ? " (insufficient data)" : ""}; components {JSON.stringify(row.components)}</p>)}</div>)}
      </section>
      <section><h2>Create draft policy version</h2><p>Drafts do not affect traffic. Scored activation requires prior shadow evidence.</p>
        <form onSubmit={(event) => { event.preventDefault(); void command("policies", "POST", {
          code: form.code, clientId: form.clientId || undefined, verificationType: form.verificationType,
          mode: form.mode, observationWindowMinutes: form.observationWindowMinutes,
          minimumSampleSize: form.minimumSampleSize, maxSnapshotAgeMinutes: form.maxSnapshotAgeMinutes,
          latencyTargetMs: form.latencyTargetMs, unknownCostBehavior: form.unknownCostBehavior,
          rolloutPercent: form.rolloutPercent, sourceShadowPolicyId: form.sourceShadowPolicyId || undefined,
          weights: { reliability: form.reliability, latency: form.latency, cost: form.cost, sla: form.sla, health: form.health },
          reason: form.reason }); }}>
          <label>Code <input required value={form.code} onChange={(event) => setForm({ ...form, code: event.target.value.toUpperCase() })} /></label>
          <label>Client ID (optional) <input value={form.clientId} onChange={(event) => setForm({ ...form, clientId: event.target.value })} /></label>
          <label>Capability <select value={form.verificationType} onChange={(event) => setForm({ ...form, verificationType: event.target.value })}>
            {["PAN_VERIFICATION", "AADHAAR_OTP", "BANK_ACCOUNT_VERIFICATION", "IFSC_VERIFICATION"].map((item) => <option key={item}>{item}</option>)}</select></label>
          <label>Mode <select value={form.mode} onChange={(event) => setForm({ ...form, mode: event.target.value })}>
            {["STATIC", "RULE_BASED", "SCORED", "SHADOW"].map((item) => <option key={item}>{item}</option>)}</select></label>
          <label>Rollout % <input type="number" min={0} max={100} value={form.rolloutPercent} onChange={(event) => setForm({ ...form, rolloutPercent: Number(event.target.value) })} /></label>
          <label>Observation minutes <input type="number" min={15} value={form.observationWindowMinutes} onChange={(event) => setForm({ ...form, observationWindowMinutes: Number(event.target.value) })} /></label>
          <label>Minimum sample <input type="number" min={1} value={form.minimumSampleSize} onChange={(event) => setForm({ ...form, minimumSampleSize: Number(event.target.value) })} /></label>
          <label>Snapshot max age minutes <input type="number" min={1} value={form.maxSnapshotAgeMinutes} onChange={(event) => setForm({ ...form, maxSnapshotAgeMinutes: Number(event.target.value) })} /></label>
          <label>Latency target ms <input type="number" min={1} value={form.latencyTargetMs} onChange={(event) => setForm({ ...form, latencyTargetMs: Number(event.target.value) })} /></label>
          <label>Unknown cost <select value={form.unknownCostBehavior} onChange={(event) => setForm({ ...form, unknownCostBehavior: event.target.value })}>
            <option>NEUTRAL</option><option>EXCLUDE</option></select></label>
          <label>Shadow policy ID for scored activation <input value={form.sourceShadowPolicyId} onChange={(event) => setForm({ ...form, sourceShadowPolicyId: event.target.value })} /></label>
          {(["reliability", "latency", "cost", "sla", "health"] as const).map((key) => <label key={key}>{key} weight
            <input type="number" min={0} step="0.1" value={form[key]} onChange={(event) => setForm({ ...form, [key]: Number(event.target.value) })} /></label>)}
          <label>Reason <input required minLength={10} value={form.reason} onChange={(event) => setForm({ ...form, reason: event.target.value })} /></label>
          <button type="submit">Create draft</button>
        </form></section>
      <section><h2>Shadow evaluation</h2><p>Sample {shadow?.total ?? 0}; agreement {shadow?.agreementRate === null || shadow?.agreementRate === undefined
        ? "insufficient data" : `${(shadow.agreementRate * 100).toFixed(1)}%`}.</p>
        {shadow?.items.slice(0, 20).map((item) => <p key={item.id}>{new Date(item.createdAt).toLocaleString()}: actual {item.actualProviderId ?? "—"},
          hypothetical {item.shadowProviderId ?? "—"} · {item.reason}</p>)}</section>
      <section><h2>Provider readiness</h2><div style={{ overflowX: "auto" }}><table><thead><tr><th>Provider</th><th>Capability</th><th>Environment</th>
        <th>Active</th><th>Credentials</th><th>Cost</th><th>SLA</th><th>Health</th><th>Timeout</th></tr></thead><tbody>
        {readiness.map((item) => <tr key={`${item.providerId}:${item.verificationType}`}><td>{item.provider}</td>
          <td>{item.verificationType}</td><td>{item.environment}</td><td>{item.active ? "Yes" : "No"}</td>
          <td>{item.credentialConfigured ? "Configured" : "Missing"}</td><td>{item.costConfigured ? "Configured" : "Unknown"}</td>
          <td>{item.slaConfigured ? "Configured" : "Missing"}</td><td>{item.health}{item.circuitOpen ? " · circuit open" : ""}</td>
          <td>{item.timeoutMs} ms</td></tr>)}</tbody></table></div></section>
    </>}
  </main>;
}
