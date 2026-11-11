"use client";

import { useCallback, useEffect, useState } from "react";
import { ClientDataTable } from "../../components/client-data-table";
import { ClientFormDialog } from "../../components/client-form-dialog";
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
    <ClientDataTable rows={rows} loading={loading} getRowId={(row) => row.id} emptyMessage="No routing policies configured." columns={[
      { key: "policy", label: "Policy", value: (row) => row.name },
      { key: "type", label: "Verification type", value: (row) => row.verificationType.replaceAll("_", " ") },
      { key: "strategy", label: "Strategy", value: (row) => row.strategy },
      { key: "version", label: "Version", value: (row) => row.version },
      { key: "scope", label: "Scope", value: (row) => row.clientId ? "Client" : "Global" },
      { key: "status", label: "Status", value: (row) => row.status, render: (row) => <span className={`status status-${row.status.toLowerCase()}`}>{row.status}</span> },
      { key: "updated", label: "Updated", value: (row) => row.updatedAt, render: (row) => new Date(row.updatedAt).toLocaleString("en-IN") },
    ]} actions={(row) => <button type="button" className="secondary table-action" onClick={() => void open(row.id)}>Details</button>} />
    {selected && <ClientFormDialog title={`${selected.name} · v${selected.version}`} wide error={error} onClose={() => setSelected(null)}>
      <p>{selected.code} · {selected.verificationType} · {selected.clientId ? "Client" : "Global"}</p>
      <p>{explanations[selected.strategy] ?? "This strategy is reserved for a later phase."}</p>
      <p>Maximum providers: {selected.maxProvidersPerVerification} · Total attempt budget: {selected.maxAttempts}</p>
      {selected.arbitrationMode && <p>Arbitration: {selected.arbitrationMode}</p>}
      {selected.strategy === "FALLBACK" && <p>Fallback categories: {selected.fallbackCategories?.join(", ") ?? "Default technical failures"}</p>}
      <h4>Providers</h4><ClientDataTable rows={selected.providers} getRowId={(row) => row.id} emptyMessage="No providers in this policy." columns={[
        { key: "provider", label: "Provider", value: (row) => row.provider.name },
        { key: "priority", label: "Priority", value: (row) => row.priority },
        { key: "weight", label: "Weight", value: (row) => row.weight ?? "—" },
        { key: "share", label: "Normalized share", value: (row) => { const total = selected.providers.reduce((sum, provider) => sum + (provider.isEnabled ? provider.weight ?? 0 : 0), 0); return selected.strategy === "WEIGHTED" && total > 0 ? `${Math.round(100 * (row.weight ?? 0) / total)}%` : "—"; } },
        { key: "delay", label: "Hedge delay", value: (row) => row.hedgeDelayMs == null ? "—" : `${row.hedgeDelayMs} ms` },
        { key: "timeout", label: "Timeout", value: (row) => row.timeoutMs == null ? "Capability default" : `${row.timeoutMs} ms` },
        { key: "enabled", label: "Enabled", value: (row) => row.isEnabled ? "Yes" : "No" },
      ]} />
    </ClientFormDialog>}
  </section>;
}
