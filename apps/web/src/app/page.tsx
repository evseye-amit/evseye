"use client";

import { FormEvent, useEffect, useState } from "react";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000/api/v1";
type Tab = "dashboard" | "fleets" | "riders" | "allocations";
type RecordItem = Record<string, unknown>;

interface Dashboard {
  fleet: Record<string, number>;
  riders: Record<string, number>;
  activeAllocations: number;
  iot: { online: number; offline: number };
}

async function request(path: string, options: RequestInit = {}, token?: string) {
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...options.headers },
  });
  const body = (await response.json().catch(() => ({}))) as { data?: unknown; message?: string };
  if (!response.ok) throw new Error(body.message ?? "Request failed. Please try again.");
  return body.data;
}

function Metric({ label, value }: { label: string; value: number }) {
  return <article className="metric"><span>{label}</span><strong>{value}</strong></article>;
}

function Status({ value }: { value: string }) {
  return <span className={`status status-${value.toLowerCase().replaceAll("_", "-")}`}>{value.replaceAll("_", " ")}</span>;
}

export default function Home() {
  const [phone, setPhone] = useState("");
  const [tenantSlug, setTenantSlug] = useState("demo-tenant");
  const [otpRequestId, setOtpRequestId] = useState("");
  const [code, setCode] = useState("");
  const [token, setToken] = useState("");
  const [tab, setTab] = useState<Tab>("dashboard");
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [items, setItems] = useState<RecordItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    const saved = sessionStorage.getItem("evs-eye-access-token");
    if (!saved) return;
    const timer = window.setTimeout(() => setToken(saved), 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!token) return;
    void loadView(tab);
    // Loading belongs to the selected view and intentionally runs after sign-in/tab change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, tab]);

  async function loadView(nextTab: Tab) {
    setLoading(true); setError("");
    try {
      if (nextTab === "dashboard") setDashboard(await request("/dashboard", {}, token) as Dashboard);
      else setItems((await request(`/${nextTab}?page=1&pageSize=20`, {}, token) as { items: RecordItem[] }).items);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to load data."); }
    finally { setLoading(false); }
  }

  async function sendOtp(event: FormEvent) {
    event.preventDefault(); setLoading(true); setError("");
    try {
      const data = await request("/auth/otp/request", { method: "POST", body: JSON.stringify({ phone, tenantSlug }) }) as { otpRequestId: string };
      setOtpRequestId(data.otpRequestId); setNotice("OTP sent. Enter the six-digit code to continue.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to request OTP."); }
    finally { setLoading(false); }
  }

  async function verifyOtp(event: FormEvent) {
    event.preventDefault(); setLoading(true); setError("");
    try {
      const data = await request("/auth/otp/verify", { method: "POST", body: JSON.stringify({ otpRequestId, code }) }) as { accessToken: string };
      sessionStorage.setItem("evs-eye-access-token", data.accessToken); setToken(data.accessToken); setNotice("");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to verify OTP."); }
    finally { setLoading(false); }
  }

  function signOut() { sessionStorage.removeItem("evs-eye-access-token"); setToken(""); setOtpRequestId(""); setCode(""); setDashboard(null); setItems([]); }

  if (!token) return <main className="auth-shell"><section className="auth-card">
    <p className="eyebrow">EVS EYE · OPERATIONS</p><h1>Fleet control, clearly seen.</h1><p className="muted">Use your operations mobile number to enter the tenant workspace.</p>
    {!otpRequestId ? <form onSubmit={sendOtp} className="form-stack"><label>Tenant slug<input value={tenantSlug} onChange={(e) => setTenantSlug(e.target.value)} required /></label><label>Mobile number<input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+919999999999" required /></label><button disabled={loading}>{loading ? "Sending…" : "Send OTP"}</button></form> : <form onSubmit={verifyOtp} className="form-stack"><label>Six-digit OTP<input value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" pattern="[0-9]{6}" maxLength={6} required /></label><button disabled={loading}>{loading ? "Verifying…" : "Verify and enter"}</button><button type="button" className="secondary" onClick={() => setOtpRequestId("")}>Use another number</button></form>}
    {notice && <p className="notice">{notice}</p>}{error && <p className="error">{error}</p>}
  </section></main>;

  const title = tab[0].toUpperCase() + tab.slice(1);
  return <main className="app-shell"><aside className="sidebar"><div><p className="eyebrow">EVS EYE</p><h2>Operations</h2></div><nav>{(["dashboard", "fleets", "riders", "allocations"] as Tab[]).map((item) => <button key={item} className={tab === item ? "nav-active" : ""} onClick={() => setTab(item)}>{item}</button>)}</nav><button className="sign-out" onClick={signOut}>Sign out</button></aside>
    <section className="workspace"><header><div><p className="eyebrow">TENANT WORKSPACE</p><h1>{title}</h1></div><button className="secondary" onClick={() => void loadView(tab)}>Refresh</button></header>{error && <p className="error">{error}</p>}{loading && <p className="muted">Loading current data…</p>}
      {!loading && tab === "dashboard" && dashboard && <div className="dashboard-grid"><Metric label="Total fleet" value={Object.values(dashboard.fleet).reduce((sum, value) => sum + value, 0)} /><Metric label="Available" value={dashboard.fleet.AVAILABLE ?? 0} /><Metric label="Active allocations" value={dashboard.activeAllocations} /><Metric label="IoT online" value={dashboard.iot.online} /><Metric label="IoT offline" value={dashboard.iot.offline} /><Metric label="KYC pending" value={dashboard.riders.PENDING ?? 0} /></div>}
      {!loading && tab !== "dashboard" && <div className="table-wrap"><table><thead><tr>{tab === "fleets" ? <><th>Vehicle</th><th>OEM</th><th>Status</th><th>Hub</th></> : tab === "riders" ? <><th>Rider</th><th>Mobile</th><th>Status</th></> : <><th>Fleet</th><th>Rider</th><th>Status</th><th>Created</th></>}</tr></thead><tbody>{items.map((item) => tab === "fleets" ? <tr key={String(item.id)}><td>{String(item.vehicleNumber)}</td><td>{String(item.oem)}</td><td><Status value={String(item.status)} /></td><td>{(item.hub as RecordItem | null)?.name as string ?? "—"}</td></tr> : tab === "riders" ? <tr key={String(item.id)}><td>{String(item.name)}</td><td>{String(item.mobile)}</td><td><Status value={String(item.status)} /></td></tr> : <tr key={String(item.id)}><td>{String((item.fleet as RecordItem)?.vehicleNumber ?? "—")}</td><td>{String((item.rider as RecordItem)?.name ?? "—")}</td><td><Status value={String(item.status)} /></td><td>{new Date(String(item.createdAt)).toLocaleDateString()}</td></tr>)}</tbody></table>{items.length === 0 && <p className="empty">No records match this view.</p>}</div>}
    </section>
  </main>;
}
