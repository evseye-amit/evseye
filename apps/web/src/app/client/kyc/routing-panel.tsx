"use client";

import { useCallback, useEffect, useState } from "react";
import { sessionFetch } from "../../../lib/session-fetch";

type PolicyRow = { id: string; code: string; name: string; verificationType: string; strategy: string;
  version: number; clientId: string | null; status: string; updatedAt: string };
type Policy = PolicyRow & { description: string | null; maxProvidersPerVerification: number; maxAttempts: number;
  allowParallel: boolean; allowHedging: boolean; arbitrationMode: string | null;
  fallbackCategories: string[] | null;
  providers: { id: string; priority: number; weight: number | null; hedgeDelayMs: number | null;
    timeoutMs: number | null; maxAttempts: number | null; isEnabled: boolean;
    provider: { id: string; code: string; name: string } }[] };

async function api<T>(path: string): Promise<T> {
  const response = await sessionFetch(`/api/v1/kyc/admin/${path}`, { cache: "no-store" });
  const body = await response.json() as { data?: T; error?: { message?: string }; message?: string };
  if (!response.ok || !body.data) throw new Error(body.error?.message ?? body.message ?? "Unable to load routing policies.");
  return body.data;
}

const explanations: Record<string, string> = {
  PRIORITY: "Use the highest priority eligible provider without automatic failover.",
  FALLBACK: "Try the next eligible provider only for configured technical failures.",
  WEIGHTED: "Distribute requests by normalized weights among eligible providers.",
  PARALLEL: "Call eligible providers together; multiple billable calls may occur.",
  HEDGED: "Start a secondary provider after its delay if the primary has no acceptable result.",
};

export default function RoutingPanel() {
  const [rows, setRows] = useState<PolicyRow[]>([]);
  const [selected, setSelected] = useState<Policy | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    setLoading(true); setError("");
    try { setRows(await api<PolicyRow[]>("routing-policies")); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to load routing policies."); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);

  async function open(id: string) {
    setError("");
    try { setSelected(await api<Policy>(`routing-policies/${id}`)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to load routing policy."); }
  }

  return <section><h2>Routing policies</h2><p>Active policy versions determine provider selection for new verifications.</p>
    {loading && <p role="status">Loading policies…</p>}{error && <p role="alert">{error}</p>}
    {!loading && (rows.length ? <table><thead><tr><th>Policy</th><th>Verification type</th><th>Strategy</th><th>Version</th><th>Scope</th><th>Status</th><th>Updated</th></tr></thead>
      <tbody>{rows.map((row) => <tr key={row.id}><td><button type="button" onClick={() => void open(row.id)}>{row.name}</button></td>
        <td>{row.verificationType}</td><td>{row.strategy}</td><td>{row.version}</td><td>{row.clientId ? "CLIENT" : "GLOBAL"}</td>
        <td>{row.status}</td><td>{new Date(row.updatedAt).toLocaleString()}</td></tr>)}</tbody></table> : <p>No routing policies configured.</p>)}
    {selected && <article className="client-metric-card" style={{ marginTop: "2rem" }}><h3>{selected.name} · v{selected.version}</h3>
      <p>{selected.code} · {selected.verificationType} · {selected.clientId ? "Client" : "Global"}</p>
      <p>{explanations[selected.strategy] ?? "This strategy is reserved for a later phase."}</p>
      <p>Maximum providers: {selected.maxProvidersPerVerification} · Total attempt budget: {selected.maxAttempts}</p>
      {selected.arbitrationMode && <p>Arbitration: {selected.arbitrationMode}</p>}
      {selected.strategy === "FALLBACK" && <p>Fallback categories: {selected.fallbackCategories?.join(", ") ?? "Default technical failures"}</p>}
      <h4>Providers</h4><table><thead><tr><th>Provider</th><th>Priority</th><th>Weight</th><th>Normalized share</th><th>Hedge delay</th><th>Timeout</th><th>Enabled</th></tr></thead>
        <tbody>{selected.providers.map((item) => {
          const total = selected.providers.reduce((sum, provider) => sum + (provider.isEnabled ? provider.weight ?? 0 : 0), 0);
          return <tr key={item.id}><td>{item.provider.name}</td><td>{item.priority}</td><td>{item.weight ?? "—"}</td>
            <td>{selected.strategy === "WEIGHTED" && total > 0 ? `${Math.round(100 * (item.weight ?? 0) / total)}%` : "—"}</td>
            <td>{item.hedgeDelayMs == null ? "—" : `${item.hedgeDelayMs} ms`}</td><td>{item.timeoutMs == null ? "Capability default" : `${item.timeoutMs} ms`}</td>
            <td>{item.isEnabled ? "Yes" : "No"}</td></tr>;
        })}</tbody></table>
    </article>}
  </section>;
}
