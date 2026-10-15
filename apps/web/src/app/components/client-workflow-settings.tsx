"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { sessionFetch as fetch } from "../../lib/session-fetch";
import { ClientFormDialog } from "./client-form-dialog";

type Row = Record<string, unknown>;
type Override = { featureId: string; enabled: boolean; configuration: Record<string, unknown> };

async function data(path: string, method = "GET", body?: unknown) {
  const response = await fetch(`/api/v1/platform${path}`, {
    method, headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error?.message || payload.message || "Workflow action failed.");
  return payload.data;
}

export function ClientWorkflowSettings({ clientId, clientName }: { clientId: string; clientName: string }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [subscription, setSubscription] = useState<Row | null>(null);
  const [packageRevision, setPackageRevision] = useState<Row | null>(null);
  const [revisions, setRevisions] = useState<Row[]>([]);
  const [overrides, setOverrides] = useState<Override[]>([]);
  const [featureId, setFeatureId] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [configuration, setConfiguration] = useState("{}");

  const included = useMemo(() => {
    const snapshot = packageRevision?.snapshot as { features?: Row[] } | undefined;
    return snapshot?.features ?? [];
  }, [packageRevision]);

  const load = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      const subscriptions = await fetch(`/api/v1/platform/commercial/subscriptions?clientId=${encodeURIComponent(clientId)}`)
        .then(async (response) => {
          const payload = await response.json();
          if (!response.ok) throw new Error(payload.error?.message || "Could not load subscriptions.");
          return payload.data as Row[];
        });
      const active = subscriptions.find((item) => item.status === "ACTIVE") ?? null;
      setSubscription(active);
      if (!active) return;
      const [packageVersions, clientVersions] = await Promise.all([
        data(`/packages/${active.packageId}/revisions`),
        data(`/subscriptions/${active.id}/workflow-revisions`),
      ]);
      setPackageRevision((packageVersions as Row[]).find((item) => item.id === active.packageRevisionId) ?? null);
      setRevisions(clientVersions as Row[]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load workflow versions.");
    } finally { setBusy(false); }
  }, [clientId]);

  useEffect(() => { if (open) void load(); }, [open, load]);

  function selectFeature(id: string) {
    setFeatureId(id);
    const existing = overrides.find((item) => item.featureId === id);
    setEnabled(existing?.enabled ?? true);
    setConfiguration(JSON.stringify(existing?.configuration ?? {}, null, 2));
  }

  function saveOverride() {
    try {
      if (!featureId) throw new Error("Choose an included Feature.");
      const parsed: unknown = JSON.parse(configuration);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
        throw new Error("Configuration must be a JSON object.");
      const feature = included.find((item) => item.featureId === featureId)?.feature as Row | undefined;
      if (!enabled && String(feature?.code) === "SELECT_APP_LANGUAGE")
        throw new Error("Language selection is mandatory.");
      setOverrides((current) => [...current.filter((item) => item.featureId !== featureId),
        { featureId, enabled, configuration: parsed as Record<string, unknown> }]);
      setNotice("Override added to this draft. Create a version to review it.");
      setError("");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Invalid configuration."); }
  }

  async function createDraft() {
    if (!subscription) return;
    setBusy(true); setError("");
    try {
      await data(`/subscriptions/${subscription.id}/workflow-revisions`, "POST", { overrides });
      setRevisions(await data(`/subscriptions/${subscription.id}/workflow-revisions`) as Row[]);
      setNotice("Draft created. Review its snapshot, then publish it.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not create draft."); }
    finally { setBusy(false); }
  }

  async function publish(id: string) {
    if (!subscription) return;
    setBusy(true); setError("");
    try {
      await data(`/workflow-revisions/${id}/publish`, "POST");
      setRevisions(await data(`/subscriptions/${subscription.id}/workflow-revisions`) as Row[]);
      setNotice("Client workflow version published.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not publish version."); }
    finally { setBusy(false); }
  }

  return <>
    <button type="button" className="secondary" onClick={() => setOpen(true)}>Workflow versions</button>
    {open && <ClientFormDialog title={`Workflow versions — ${clientName}`} wide busy={busy} error={error} onClose={() => setOpen(false)}>
      <header className="sa-commercial-head"><div><h2>Workflow versions — {clientName}</h2><p>Override included Features for this client. Published versions remain available for review.</p></div><button type="button" className="secondary" onClick={() => setOpen(false)}>Close</button></header>
      {notice && <p className="notice" role="status">{notice}</p>}
      {!subscription || !packageRevision ? <p className="muted">An active subscription with a published Package version is required.</p> : <>
        <section className="sa-commercial-section">
          <div className="sa-commercial-section-head"><div><h3>Client Feature overrides</h3><p>Current Package: {String((subscription.package as Row)?.name ?? "Package")} v{String(packageRevision.version)}. An empty configuration keeps the Package default.</p></div></div>
          <div className="sa-commercial-grid">
            <label><span>Included Feature</span><select value={featureId} onChange={(event) => selectFeature(event.target.value)}><option value="">Select Feature</option>{included.map((item) => { const feature = item.feature as Row; return <option key={String(item.featureId)} value={String(item.featureId)}>{String(feature.name)} · {String(feature.category)}</option>; })}</select></label>
            <label className="sa-toggle"><input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} /> Enabled for this client</label>
            <label><span>Configuration override (JSON)</span><textarea rows={7} value={configuration} onChange={(event) => setConfiguration(event.target.value)} spellCheck={false} /></label>
            <div className="sa-commercial-form-action"><button type="button" disabled={busy || !featureId} onClick={saveOverride}>Add override</button></div>
          </div>
          <div className="sa-commercial-table-wrap"><table className="sa-commercial-table"><thead><tr><th>Feature</th><th>Enabled</th><th>Configuration</th><th>Action</th></tr></thead><tbody>{overrides.length ? overrides.map((item) => <tr key={item.featureId}><td>{String((included.find((part) => part.featureId === item.featureId)?.feature as Row)?.name ?? item.featureId)}</td><td>{item.enabled ? "Yes" : "No"}</td><td><code>{JSON.stringify(item.configuration)}</code></td><td><button type="button" className="secondary" onClick={() => setOverrides((current) => current.filter((part) => part.featureId !== item.featureId))}>Remove</button></td></tr>) : <tr><td colSpan={4} className="sa-commercial-empty">No client overrides in this draft.</td></tr>}</tbody></table></div>
          <div className="sa-dialog-actions"><button type="button" disabled={busy} onClick={() => void createDraft()}>Create client draft</button></div>
        </section>
        <section className="sa-commercial-section"><div className="sa-commercial-section-head"><div><h3>Saved versions</h3><p>Review the exact override snapshot before publishing.</p></div></div>
          <div className="sa-commercial-table-wrap"><table className="sa-commercial-table"><thead><tr><th>Version</th><th>Status</th><th>Configuration</th><th>Action</th></tr></thead><tbody>{revisions.length ? revisions.map((item) => <tr key={String(item.id)}><td>v{String(item.version)}</td><td>{item.publishedAt ? "Published" : "Draft"}</td><td><details><summary>Review snapshot</summary><pre>{JSON.stringify(item.snapshot, null, 2)}</pre></details></td><td>{item.publishedAt ? "—" : <button type="button" disabled={busy} onClick={() => void publish(String(item.id))}>Publish</button>}</td></tr>) : <tr><td colSpan={4} className="sa-commercial-empty">No client versions yet.</td></tr>}</tbody></table></div>
        </section>
      </>}
    </ClientFormDialog>}
  </>;
}
