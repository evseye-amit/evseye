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

  async function discard(id: string) {
    if (!subscription) return;
    setBusy(true); setError("");
    try {
      await data(`/workflow-revisions/${id}`, "DELETE");
      setRevisions(await data(`/subscriptions/${subscription.id}/workflow-revisions`) as Row[]);
      setNotice("Draft version discarded.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not discard draft."); }
    finally { setBusy(false); }
  }

  return <>
    <button type="button" className="secondary" onClick={() => setOpen(true)}>Versions</button>
    {open && <ClientFormDialog title={`Versions — ${clientName}`} wide busy={busy} error={error} onClose={() => setOpen(false)} heading={<>Versions — {clientName}</>}>
      <header className="sa-commercial-head"><div><p>Review immutable client onboarding workflow versions. Drafts can be published or discarded.</p></div></header>
      {notice && <p className="notice" role="status">{notice}</p>}
      {!subscription ? <p className="muted">An active subscription is required before workflow versions can be reviewed.</p> : <section className="sa-commercial-section"><div className="sa-commercial-section-head"><div><h3>Workflow versions</h3><p>Review the exact immutable snapshot before publishing.</p></div></div>
        <div className="sa-commercial-table-wrap"><table className="sa-commercial-table"><thead><tr><th>Version</th><th>Status</th><th>Created</th><th>Published</th><th>Snapshot</th><th>Action</th></tr></thead><tbody>{revisions.length ? revisions.map((item) => <tr key={String(item.id)}><td>v{String(item.version)}</td><td>{item.publishedAt ? "Published" : "Draft"}</td><td>{item.createdAt ? new Date(String(item.createdAt)).toLocaleDateString("en-IN") : "—"}</td><td>{item.publishedAt ? new Date(String(item.publishedAt)).toLocaleDateString("en-IN") : "—"}</td><td><details><summary>Review</summary><pre>{JSON.stringify(item.snapshot, null, 2)}</pre></details></td><td>{item.publishedAt ? "—" : <span className="sa-client-actions"><button type="button" disabled={busy} onClick={() => void publish(String(item.id))}>Publish</button><button type="button" className="danger" disabled={busy} onClick={() => void discard(String(item.id))}>Discard</button></span>}</td></tr>) : <tr><td colSpan={6} className="sa-commercial-empty">No client versions yet.</td></tr>}</tbody></table></div>
      </section>}
      <div className="form-actions"><button type="button" className="secondary" onClick={() => setOpen(false)}>Close</button></div>
    </ClientFormDialog>}
  </>;
}
