"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { sessionFetch } from "../../lib/session-fetch";

type Tab = "overview" | "cost" | "commercial" | "providers" | "routing" | "sla" | "data-quality";
type Row = Record<string, unknown>;
type Report = { metadata: { from: string; to: string; timezone: string; generatedAt: string }; rows?: Row[];
  unconfigured?: boolean; note?: string; [key: string]: unknown };
const tabs: Tab[] = ["overview", "cost", "commercial", "providers", "routing", "sla", "data-quality"];
const display = (value: unknown): string => value === null || value === undefined ? "—" :
  typeof value === "object" ? JSON.stringify(value) : String(value);
const title = (name: string) => name.replaceAll("_", " ").replaceAll(/([a-z])([A-Z])/g, "$1 $2");

export default function KycAnalyticsConsole({ platform = false }: { platform?: boolean }) {
  const [tab, setTab] = useState<Tab>("overview");
  const [authorized, setAuthorized] = useState(false);
  const [from, setFrom] = useState(() => new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10));
  const [to, setTo] = useState(() => new Date(Date.now() + 86400000).toISOString().slice(0, 10));
  const [clientDraft, setClientDraft] = useState("");
  const [clientId, setClientId] = useState("");
  const [type, setType] = useState("");
  const [providerDraft, setProviderDraft] = useState("");
  const [providerId, setProviderId] = useState("");
  const [strategy, setStrategy] = useState("");
  const [currency, setCurrency] = useState("");
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [costForm, setCostForm] = useState({ providerId: "", type: "PAN_VERIFICATION", costPerRequest: "",
    currency: "INR", billingRule: "UNKNOWN", reason: "" });
  const [slaForm, setSlaForm] = useState({ providerId: "", type: "PAN_VERIFICATION", effectiveFrom: "",
    minimumSampleSize: "30", technicalSuccessTarget: "", p95LatencyTargetMs: "" });
  const [loading, setLoading] = useState(false);
  const base = platform ? "platform/kyc/analytics" : "kyc/analytics";

  useEffect(() => {
    let live = true;
    void sessionFetch("/api/v1/auth/me", { cache: "no-store" }).then(async (response) => {
      if (!response.ok) throw new Error("Sign in to view KYC analytics.");
      const body = await response.json() as { data?: { role?: string; roles?: string[] } };
      const roles = body.data?.roles ?? (body.data?.role ? [body.data.role] : []);
      if (!roles.some((role) => platform ? role === "SUPER_ADMIN" : ["CLIENT_ADMIN", "KYC_OPERATOR"].includes(role)))
        throw new Error("You are not authorized to view KYC analytics.");
      if (live) setAuthorized(true);
    }).catch((cause) => { if (live) setError(cause instanceof Error ? cause.message : "Unauthorized."); });
    return () => { live = false; };
  }, [platform]);

  const load = useCallback(async () => {
    if (!authorized) return;
    setLoading(true); setError("");
    try {
      const params = new URLSearchParams({ from: new Date(`${from}T00:00:00Z`).toISOString(),
        to: new Date(`${to}T00:00:00Z`).toISOString() });
      if (platform && clientId) params.set("clientId", clientId);
      if (platform && type) params.set("verificationType", type);
      if (platform && providerId) params.set("providerId", providerId);
      if (platform && strategy) params.set("strategy", strategy);
      if (platform && currency) params.set("currency", currency);
      const response = await sessionFetch(`/api/v1/${base}/${tab}?${params}`, { cache: "no-store" });
      const body = await response.json() as { data?: Report; error?: { message?: string }; message?: string };
      if (!response.ok || !body.data) throw new Error(body.error?.message ?? body.message ?? "Analytics request failed.");
      setReport(body.data);
    } catch (cause) { setReport(null); setError(cause instanceof Error ? cause.message : "Analytics request failed."); }
    finally { setLoading(false); }
  }, [authorized, base, clientId, currency, from, platform, providerId, strategy, tab, to, type]);
  useEffect(() => { void load(); }, [load]);

  async function configure(path: string, method: "POST" | "PATCH", payload: object) {
    setError(""); setMessage("");
    try {
      const response = await sessionFetch(`/api/v1/${base}/${path}`, { method,
        headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const body = await response.json() as { error?: { message?: string }; message?: string };
      if (!response.ok) throw new Error(body.error?.message ?? body.message ?? "Configuration failed.");
      setMessage("Configuration saved for future observations.");
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Configuration failed."); }
  }

  const rows = report?.rows ?? [];
  const keys = rows.length ? Object.keys(rows[0]).filter((key) => !["clientId", "providerId", "policyId"].includes(key)) : [];
  function preset(days: number, offset = 0) {
    const utcToday = new Date();
    utcToday.setUTCHours(0, 0, 0, 0);
    setFrom(new Date(utcToday.getTime() - (days + offset) * 86400000).toISOString().slice(0, 10));
    setTo(new Date(utcToday.getTime() - offset * 86400000).toISOString().slice(0, 10));
  }
  return <main className="client-dashboard" style={{ padding: "2rem", maxWidth: 1440, margin: "0 auto" }}>
    <header className="client-dashboard-header"><div><p className="eyebrow">{platform ? "EVsEYE INTELLIGENCE" : "CLIENT WORKSPACE"}</p>
      <h1>KYC Analytics</h1><p>Historical activity, consumption and {platform ? "observed cost, provider performance and SLA" : "verification outcomes"}</p></div>
      <div>{platform && <><Link href="/platform/kyc/intelligent-routing">Intelligent Routing</Link>{" · "}</>}
      <Link href={platform ? "/platform/kyc" : "/client/kyc/operations"}>Command Center</Link></div></header>
    {error && <p role="alert">{error}</p>}
    {message && <p role="status">{message}</p>}
    {authorized && <><nav aria-label="KYC analytics sections" style={{ display: "flex", gap: ".5rem", flexWrap: "wrap", margin: "1.5rem 0" }}>
      {(platform ? tabs : tabs.slice(0, 1)).map((item) => <button key={item} type="button" aria-current={tab === item ? "page" : undefined}
        onClick={() => setTab(item)}>{title(item)}</button>)}</nav>
      <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap", marginBottom: "1rem" }}>
        <button type="button" onClick={() => preset(1, -1)}>Today</button>
        <button type="button" onClick={() => preset(1)}>Yesterday</button>
        <button type="button" onClick={() => preset(7, -1)}>Last 7 days</button>
        <button type="button" onClick={() => preset(30, -1)}>Last 30 days</button>
        <label>From (UTC) <input type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label>
        <label>To, exclusive (UTC) <input type="date" value={to} onChange={(event) => setTo(event.target.value)} /></label>
        {platform && <><label>Client ID <input value={clientDraft} placeholder="All clients" onChange={(event) => setClientDraft(event.target.value)} /></label>
          <button type="button" onClick={() => setClientId(clientDraft.trim())}>Apply client</button>
          <label>Type <select value={type} onChange={(event) => setType(event.target.value)}><option value="">All</option>
            {["PAN_VERIFICATION", "AADHAAR_OTP", "BANK_ACCOUNT_VERIFICATION", "IFSC_VERIFICATION", "FACE_MATCH", "LIVENESS"].map((item) => <option key={item}>{item}</option>)}</select></label>
          <label>Provider ID <input value={providerDraft} onChange={(event) => setProviderDraft(event.target.value)} placeholder="All providers" /></label>
          <button type="button" onClick={() => setProviderId(providerDraft.trim())}>Apply provider</button>
          <label>Strategy <select value={strategy} onChange={(event) => setStrategy(event.target.value)}><option value="">All</option>
            {["PRIORITY", "FALLBACK", "WEIGHTED", "PARALLEL", "HEDGED"].map((item) => <option key={item}>{item}</option>)}</select></label>
          <label>Currency <input maxLength={3} value={currency} onChange={(event) => setCurrency(event.target.value.toUpperCase())} placeholder="All" /></label></>}
      </div>
      {loading && <p role="status">Loading analytics…</p>}
      {report && <><p>Window: {report.metadata.from.slice(0, 10)} to {report.metadata.to.slice(0, 10)} (exclusive), {report.metadata.timezone}. Generated {new Date(report.metadata.generatedAt).toLocaleString()}.</p>
        {report.note && <p>{report.note}</p>}
        {tab === "overview" && <section className="client-metrics" aria-label="KYC analytics overview">
          {Object.entries(report).filter(([key, value]) => key !== "metadata" && key !== "statusByType" &&
            (typeof value === "number" || typeof value === "string")).map(([key, value]) =>
            <article key={key}><small>{title(key)}</small><strong>{display(value)}</strong></article>)}
        </section>}
        {tab === "overview" && Array.isArray(report.statusByType) && <section><h2>Verification outcomes by type</h2>
          <p>{(report.statusByType as Row[]).length ? "Cohort is based on verification request time." : "No verifications in this window."}</p>
          {(report.statusByType as Row[]).map((row, index) => <div key={index} style={{ marginBottom: ".8rem" }}>
            <p>{display(row.verificationType)}: {display(row.count)} requests, {display(row.success)} verified</p>
            <div role="img" aria-label={`${display(row.verificationType)} verified ${display(row.success)} of ${display(row.count)}`}
              style={{ width: "100%", height: 10, background: "#e2e8f0", borderRadius: 6 }}>
              <div style={{ width: `${Number(row.count) ? Math.min(100, Number(row.success) * 100 / Number(row.count)) : 0}%`,
                height: "100%", background: "#0f766e", borderRadius: 6 }} /></div>
          </div>)}</section>}
        {tab === "data-quality" && <section className="client-metrics" aria-label="Analytics data quality">
          {Object.entries(report).filter(([key, value]) => key !== "metadata" && typeof value === "number")
            .map(([key, value]) => <article key={key}><small>{title(key)}</small><strong>{display(value)}</strong></article>)}
        </section>}
        {tab !== "overview" && tab !== "data-quality" && <section><h2>{title(tab)}</h2>
          {report.unconfigured && <p>No provider SLA policy is configured for this window.</p>}
          {!rows.length && <p>No observations for this window. Zero is not inferred from missing data.</p>}
          {!!rows.length && <div style={{ overflowX: "auto" }}><table><thead><tr>{keys.map((key) => <th key={key}>{title(key)}</th>)}<th>Operations</th></tr></thead>
            <tbody>{rows.map((row, index) => <tr key={index}>{keys.map((key) => <td key={key}>{display(row[key])}</td>)}
              <td><Link href={platform ? "/platform/kyc" : "/client/kyc/operations"}>Open KYC</Link>
                {platform && tab === "sla" && typeof row.policyId === "string" && <button type="button" onClick={() => {
                  const date = window.prompt("End this SLA policy at what UTC date (YYYY-MM-DD)?");
                  if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) void configure(`sla/policies/${row.policyId}/close`, "PATCH", {
                    effectiveUntil: new Date(`${date}T00:00:00Z`).toISOString() });
                }}>Close policy</button>}</td></tr>)}</tbody></table></div>}
        </section>}
        {tab === "commercial" && Array.isArray(report.addOnPurchases) && <section><h2>Add-on purchases</h2>
          {(report.addOnPurchases as Row[]).length === 0 ? <p>No add-on purchases in this window.</p> :
            (report.addOnPurchases as Row[]).map((row, index) => <p key={index}>{display(row.featureCode)}: {display(row.quantityPurchased)} purchased,
              {" "}{display(row.currency)} {display(row.netAmount)} net purchase amount</p>)}</section>}
        {tab === "routing" && Array.isArray(report.fallbackPairs) && <section><h2>Primary to fallback provider pairs</h2>
          {(report.fallbackPairs as Row[]).length === 0 ? <p>No fallback attempts in this window.</p> :
            (report.fallbackPairs as Row[]).map((row, index) => <p key={index}>{display(row.primaryProvider)} → {display(row.fallbackProvider)}:
              {" "}{display(row.fallbackAttempts)} fallback attempts, {display(row.recovered)} recovered,
              {" "}{display(row.currency)} {display(row.knownIncrementalCost)} known incremental cost</p>)}</section>}
        {tab === "sla" && report.internalService && <section><h2>EVsEye workflow turnaround</h2><p>{display(report.internalService)}</p></section>}
        {platform && tab === "providers" && <section><h2>Configure future provider cost snapshots</h2>
          <p>Enter the contracted per-request cost and billing rule. This changes future attempts only.</p>
          <form onSubmit={(event) => { event.preventDefault(); void configure(
            `providers/${costForm.providerId}/capabilities/${costForm.type}/cost`, "PATCH", {
              costPerRequest: costForm.costPerRequest || undefined, currency: costForm.currency,
              billingRule: costForm.billingRule, reason: costForm.reason }); }}>
            <label>Provider ID <input required value={costForm.providerId} onChange={(event) => setCostForm({ ...costForm, providerId: event.target.value })} /></label>
            <label>Capability <select value={costForm.type} onChange={(event) => setCostForm({ ...costForm, type: event.target.value })}>
              {["PAN_VERIFICATION", "AADHAAR_OTP", "BANK_ACCOUNT_VERIFICATION", "IFSC_VERIFICATION"].map((item) => <option key={item}>{item}</option>)}</select></label>
            <label>Unit cost <input inputMode="decimal" value={costForm.costPerRequest} onChange={(event) => setCostForm({ ...costForm, costPerRequest: event.target.value })} placeholder="Unknown if blank" /></label>
            <label>Currency <input required maxLength={3} value={costForm.currency} onChange={(event) => setCostForm({ ...costForm, currency: event.target.value.toUpperCase() })} /></label>
            <label>Billing rule <select value={costForm.billingRule} onChange={(event) => setCostForm({ ...costForm, billingRule: event.target.value })}>
              {["UNKNOWN", "EVERY_ATTEMPT", "TECHNICAL_COMPLETION", "BUSINESS_SUCCESS"].map((item) => <option key={item}>{item}</option>)}</select></label>
            <label>Reason <input required minLength={5} value={costForm.reason} onChange={(event) => setCostForm({ ...costForm, reason: event.target.value })} /></label>
            <button type="submit">Save provider cost</button>
          </form></section>}
        {platform && tab === "sla" && <section><h2>Configure effective-dated provider SLA</h2>
          <form onSubmit={(event) => { event.preventDefault(); void configure("sla/policies", "POST", {
            providerId: slaForm.providerId, verificationType: slaForm.type,
            effectiveFrom: new Date(`${slaForm.effectiveFrom}T00:00:00Z`).toISOString(),
            minimumSampleSize: Number(slaForm.minimumSampleSize),
            ...(slaForm.technicalSuccessTarget ? { technicalSuccessTarget: slaForm.technicalSuccessTarget } : {}),
            ...(slaForm.p95LatencyTargetMs ? { p95LatencyTargetMs: Number(slaForm.p95LatencyTargetMs) } : {}),
          }); }}>
            <label>Provider ID <input required value={slaForm.providerId} onChange={(event) => setSlaForm({ ...slaForm, providerId: event.target.value })} /></label>
            <label>Capability <select value={slaForm.type} onChange={(event) => setSlaForm({ ...slaForm, type: event.target.value })}>
              {["PAN_VERIFICATION", "AADHAAR_OTP", "BANK_ACCOUNT_VERIFICATION", "IFSC_VERIFICATION"].map((item) => <option key={item}>{item}</option>)}</select></label>
            <label>Effective from (UTC) <input required type="date" value={slaForm.effectiveFrom} onChange={(event) => setSlaForm({ ...slaForm, effectiveFrom: event.target.value })} /></label>
            <label>Minimum sample <input required type="number" min={1} value={slaForm.minimumSampleSize} onChange={(event) => setSlaForm({ ...slaForm, minimumSampleSize: event.target.value })} /></label>
            <label>Technical success minimum % <input inputMode="decimal" value={slaForm.technicalSuccessTarget} onChange={(event) => setSlaForm({ ...slaForm, technicalSuccessTarget: event.target.value })} /></label>
            <label>P95 latency maximum ms <input type="number" min={1} value={slaForm.p95LatencyTargetMs} onChange={(event) => setSlaForm({ ...slaForm, p95LatencyTargetMs: event.target.value })} /></label>
            <button type="submit">Create SLA policy</button>
          </form></section>}
        {platform && ["cost", "commercial"].includes(tab) && <p>Known amounts exclude attempts with unknown cost or billability. Included package revenue is not allocated to individual verifications.</p>}
      </>}
    </>}
  </main>;
}
