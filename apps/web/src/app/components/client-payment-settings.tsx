"use client";

import { useEffect, useRef, useState } from "react";
import { sessionFetch } from "../../lib/session-fetch";
import { ClientFormDialog } from "./client-form-dialog";

type Version = { id: string; version: number; keyId: string; secretReference: string; merchantAccountId: string | null; createdAt: string };
type Provider = { id: string; provider: string; environment: string; keyId: string; secretReference: string; merchantAccountId: string | null; status: string; resolved?: boolean; currentVersion: number; updatedAt: string; versions: Version[] };
type Form = { keyId: string; secretReference: string; merchantAccountId: string; status: string };
const empty: Form = { keyId: "", secretReference: "", merchantAccountId: "", status: "ACTIVE" };

export function ClientPaymentSettings({ clientId, clientName }: { clientId: string; clientName: string }) {
  const [open, setOpen] = useState(false), [rows, setRows] = useState<Provider[]>([]);
  const [environment, setEnvironment] = useState("TEST"), [form, setForm] = useState<Form>(empty);
  const [busy, setBusy] = useState(false), [loaded, setLoaded] = useState(false), [review, setReview] = useState(false);
  const [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [provider, setProvider] = useState("RAZORPAY");
  const [reload, setReload] = useState(0);
  const generation = useRef(0), saving = useRef(false);
  const current = rows.find(row => row.environment === environment && row.provider === provider);
  const rotation = Boolean(current && (current.keyId !== form.keyId.trim() || current.secretReference !== form.secretReference.trim() || (current.merchantAccountId ?? "") !== form.merchantAccountId.trim()));
  useEffect(() => {
    const requests = generation;
    const request = ++requests.current;
    if (!open) return;
    const controller = new AbortController();
    async function load() {
      setBusy(true); setLoaded(false); setReview(false); setError(""); setNotice("");
      try {
        const response = await sessionFetch(`/api/v1/platform/clients/${clientId}/payment-providers`, { signal: controller.signal });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error?.message || "Could not load payment configuration.");
        if (request !== generation.current) return;
        const providers: Provider[] = payload.data ?? [];
        const selected = providers.find(row => row.environment === environment && row.provider === provider);
        setRows(providers); setForm(selected ? { keyId: selected.keyId, secretReference: selected.secretReference, merchantAccountId: selected.merchantAccountId ?? "", status: selected.status } : empty); setLoaded(true);
      } catch (cause) { if (!controller.signal.aborted && request === generation.current) setError(cause instanceof Error ? cause.message : "Could not load configuration."); }
      finally { if (request === generation.current) setBusy(false); }
    }
    void load();
    return () => { controller.abort(); requests.current++; };
  }, [clientId, environment, provider, open, reload]);
  function edit(field: keyof Form, value: string) { setForm(previous => ({ ...previous, [field]: value })); setReview(false); setNotice(""); }
  async function save() {
    if (saving.current || !loaded) return;
    saving.current = true; setBusy(true); setError("");
    const request = generation.current;
    try {
      const response = await sessionFetch(`/api/v1/platform/clients/${clientId}/payment-providers/${provider.toLowerCase()}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ provider, environment, keyId: form.keyId.trim(), secretReference: form.secretReference.trim(), merchantAccountId: form.merchantAccountId.trim() || undefined, status: form.status, expectedRevision: current?.updatedAt ?? "NEW" }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error?.message || "Could not save configuration. Reload before retrying an uncertain result.");
      if (request !== generation.current) return;
      setNotice(`Saved version ${payload.data.currentVersion}. Reload to refresh configuration health and history.`); setLoaded(false); setReview(false);
    } catch (cause) { if (request === generation.current) setError(cause instanceof Error ? cause.message : "Could not save configuration."); }
    finally { saving.current = false; if (request === generation.current) setBusy(false); }
  }
  const valid = new RegExp(provider === "CASHFREE" ? "^[A-Za-z0-9_-]{3,128}$" : environment === "TEST" ? "^rzp_test_[A-Za-z0-9]+$" : "^rzp_live_[A-Za-z0-9]+$").test(form.keyId.trim()) && /^env:[A-Z][A-Z0-9_]{2,127}$/.test(form.secretReference.trim());
  return <><button type="button" onClick={() => setOpen(true)}>Payments</button>{open && <ClientFormDialog title={`Payments — ${clientName}`} wide busy={busy} error={error} onClose={() => { if (!saving.current) setOpen(false); }}>
    <p>New payments use the selected configuration. Existing payments retain their original merchant version. Keep earlier secrets available for recovery.</p>
    <label>Gateway<select disabled={busy} value={provider} onChange={event => { setLoaded(false); setReview(false); setProvider(event.target.value); }}><option value="RAZORPAY">Razorpay</option><option value="CASHFREE">Cashfree</option></select></label>
    <p>Cashfree is optional. Leave it unconfigured when unused. Disable the existing gateway before activating another.</p>
    <label>Environment<select disabled={busy} value={environment} onChange={event => { setLoaded(false); setReview(false); setEnvironment(event.target.value); }}><option value="TEST">Test</option><option value="PRODUCTION">Production</option></select></label>
    <button type="button" disabled={busy} onClick={() => { setLoaded(false); setReview(false); setReload(value => value + 1); }}>Reload saved configuration (discard edits)</button>
    {current && <p>Version {current.currentVersion} · {current.status} · {current.resolved ? "Configuration resolved" : "Configuration unavailable"}</p>}
    <p>Resolution does not certify gateway connectivity. Cashfree supports checkout and AutoPay; deployment remains Razorpay-only.</p>
    <fieldset disabled={busy || !loaded}><legend>{provider} merchant</legend>
      <label>Key ID<input value={form.keyId} onChange={event => edit("keyId", event.target.value)} /></label>
      <label>Versioned secret reference<input value={form.secretReference} placeholder="env:CLIENT_RAZORPAY_V2" onChange={event => edit("secretReference", event.target.value)} /></label>
      <label>Merchant account ID (optional)<input value={form.merchantAccountId} onChange={event => edit("merchantAccountId", event.target.value)} /></label>
      <label>Status<select value={form.status} onChange={event => edit("status", event.target.value)}><option value="ACTIVE">Active</option><option value="DISABLED">Disabled</option></select></label>
      <button type="button" disabled={!valid} onClick={() => setReview(true)}>Review changes</button>
    </fieldset>
    {review && <section aria-label="Configuration change review"><h3>Review {environment.toLowerCase()} configuration</h3><p>{rotation ? "Creates a new merchant version." : current ? "Updates the current configuration." : "Creates the first merchant version."} Status: {form.status}. Key: {form.keyId}. Secret reference: {form.secretReference}.</p><p>{form.status === "DISABLED" ? "New payments will be blocked. Existing payments can still recover using saved credentials." : "New payments will use this merchant after saving."}</p>{environment === "PRODUCTION" && <p>These changes affect production payment routing.</p>}<button type="button" disabled={busy || !loaded} onClick={() => void save()}>Confirm and save</button></section>}
    {notice && <p role="status">{notice}</p>}
    <h3>Retained merchant versions</h3><p>Latest 100 versions for this environment. Secret values are never displayed.</p>
    {current?.versions?.length ? <ul>{current.versions.map(version => <li key={version.id}>Version {version.version}{version.version === current.currentVersion ? " (current)" : " (historical)"} · {version.keyId} · {version.secretReference} · Merchant {version.merchantAccountId ?? "not specified"} · {version.createdAt}</li>)}</ul> : <p>No retained versions to display.</p>}
  </ClientFormDialog>}</>;
}
