"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { sessionFetch } from "../../../lib/session-fetch";

type LegalDocument = {
  id: string;
  appCode: string;
  role: string;
  kind: string;
  locale: string;
  version: string;
  title: string;
  content: string;
  effectiveAt: string;
  publishedAt: string | null;
  retiredAt: string | null;
};

type LegalForm = Pick<LegalDocument, "appCode" | "role" | "kind" | "locale" | "version" | "title" | "content"> & {
  effectiveAt: string;
};

const emptyForm = (): LegalForm => ({
  appCode: "RIDER",
  role: "RIDER",
  kind: "TERMS_AND_CONDITIONS",
  locale: "en",
  version: "",
  title: "Rider Terms & Conditions",
  content: "",
  effectiveAt: new Date().toISOString().slice(0, 10),
});

async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await sessionFetch(`/api/v1/legal/documents${path}`, {
    cache: "no-store",
    ...options,
    headers: { ...(options.body ? { "Content-Type": "application/json" } : {}), ...options.headers },
  });
  const body = await response.json() as { data?: T; error?: { message?: string }; message?: string };
  if (!response.ok || body.data === undefined)
    throw new Error(body.error?.message ?? body.message ?? "Unable to manage legal documents.");
  return body.data;
}

export default function ClientLegalDocumentsPage() {
  const [authorized, setAuthorized] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [documents, setDocuments] = useState<LegalDocument[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<LegalForm>(emptyForm);
  const [showForm, setShowForm] = useState(false);
  const [preview, setPreview] = useState<LegalDocument | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await sessionFetch("/api/v1/auth/me", { cache: "no-store" });
      if (!response.ok) throw new Error("Please sign in as a Client Admin.");
      const body = await response.json() as { data?: { roles?: string[] } };
      if (!body.data?.roles?.includes("CLIENT_ADMIN")) throw new Error("Only Client Admins can manage legal documents.");
      setAuthorized(true);
      setDocuments(await api<LegalDocument[]>(""));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to load legal documents.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  function startNew() {
    setEditingId(null);
    setForm(emptyForm());
    setShowForm(true);
    setError("");
    setNotice("");
  }

  function startEdit(document: LegalDocument) {
    if (document.publishedAt) return;
    setEditingId(document.id);
    setForm({ appCode: document.appCode, role: document.role, kind: document.kind,
      locale: document.locale, version: document.version, title: document.title,
      content: document.content, effectiveAt: new Date(document.effectiveAt).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }) });
    setShowForm(true);
    setError("");
    setNotice("");
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const payload = { ...form, appCode: form.appCode.trim().toUpperCase(),
        version: form.version.trim(), title: form.title.trim(),
        content: form.content.trim(), locale: form.locale.trim().toLowerCase(),
        effectiveAt: new Date(`${form.effectiveAt}T00:00:00+05:30`).toISOString() };
      await api(editingId ? `/${editingId}` : "/drafts", {
        method: editingId ? "PATCH" : "POST", body: JSON.stringify(payload),
      });
      setShowForm(false);
      setEditingId(null);
      setNotice(editingId ? "Draft updated." : "Draft created.");
      setDocuments(await api<LegalDocument[]>(""));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to save draft.");
    } finally {
      setBusy(false);
    }
  }

  async function publish(document: LegalDocument) {
    if (!window.confirm(`Publish ${document.title} version ${document.version}? Published content cannot be edited or deleted.`)) return;
    setBusy(true); setError(""); setNotice("");
    try {
      await api(`/${document.id}/publish`, { method: "POST" });
      setDocuments(await api<LegalDocument[]>(""));
      setNotice(`Version ${document.version} published.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to publish draft.");
    } finally { setBusy(false); }
  }

  async function remove(document: LegalDocument) {
    if (!window.confirm(`Delete draft ${document.title} version ${document.version}?`)) return;
    setBusy(true); setError(""); setNotice("");
    try {
      await api(`/${document.id}`, { method: "DELETE" });
      setDocuments(await api<LegalDocument[]>(""));
      setNotice("Draft deleted.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to delete draft.");
    } finally { setBusy(false); }
  }

  return <main className="client-dashboard legal-documents-page">
    <header className="legal-documents-header">
      <div><p className="eyebrow">CLIENT OPERATIONS</p><h1>Legal documents</h1>
        <p className="muted">Prepare terms and privacy policies for each app and user role. Published versions remain available as a permanent record.</p></div>
      <div className="sa-actions"><Link className="secondary" href="/?workspace=operations">Back to operations</Link>
        {authorized && <button type="button" onClick={startNew}>+ New draft</button>}</div>
    </header>
    {error && <p className="error" role="alert">{error}</p>}
    {notice && <p className="notice" role="status">{notice}</p>}
    {loading ? <p className="muted">Loading documents…</p> : authorized && <>
      <div className="table-wrap"><table><thead><tr><th>Document</th><th>App / role</th><th>Version</th><th>Effective date</th><th>Status</th><th>Actions</th></tr></thead>
        <tbody>{documents.map((document) => <tr key={document.id}>
          <td><strong>{document.title}</strong><br /><small>{document.locale} · {document.kind.replaceAll("_", " ")}</small></td>
          <td>{document.appCode} / {document.role.replaceAll("_", " ")}</td>
          <td>{document.version}</td>
          <td>{new Date(document.effectiveAt).toLocaleDateString("en-IN")}</td>
          <td>{document.retiredAt ? "Retired" : document.publishedAt ? "Published" : "Draft"}</td>
          <td><div className="sa-actions"><button type="button" className="secondary" onClick={() => setPreview(document)}>Preview</button>
            {!document.publishedAt && <><button type="button" className="secondary" disabled={busy} onClick={() => startEdit(document)}>Edit</button>
              <button type="button" disabled={busy} onClick={() => void publish(document)}>Publish</button>
              <button type="button" className="danger" disabled={busy} onClick={() => void remove(document)}>Delete draft</button></>}</div></td>
        </tr>)}</tbody></table></div>
      {documents.length === 0 && <p className="muted">No legal documents yet. Create a draft to begin.</p>}
    </>}
    {showForm && <section className="action-card legal-documents-form"><h2>{editingId ? "Edit draft" : "New legal document draft"}</h2>
      <p className="muted">Write HTML content for the rider app viewer. Review the preview before publishing.</p>
      <form className="form-stack" onSubmit={(event) => void save(event)}>
        <div className="form-grid">
          <label>App code *<input required maxLength={40} value={form.appCode} onChange={(event) => setForm({ ...form, appCode: event.target.value })} /></label>
          <label>User role *<select value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value })}>
            {["RIDER", "FLEET_MANAGER", "TEAM_LEAD", "OPERATIONS_MANAGER", "CLIENT_ADMIN", "KYC_OPERATOR"].map((role) => <option key={role} value={role}>{role.replaceAll("_", " ")}</option>)}</select></label>
          <label>Document type *<select value={form.kind} onChange={(event) => setForm({ ...form, kind: event.target.value, title: event.target.value === "PRIVACY_POLICY" ? "Rider Privacy Policy" : "Rider Terms & Conditions" })}>
            <option value="TERMS_AND_CONDITIONS">Terms & Conditions</option>
            <option value="PRIVACY_POLICY">Privacy Policy</option></select></label>
          <label>Language *<input required pattern="[a-z]{2}" maxLength={2} value={form.locale} onChange={(event) => setForm({ ...form, locale: event.target.value })} /></label>
          <label>Version *<input required maxLength={80} value={form.version} onChange={(event) => setForm({ ...form, version: event.target.value })} placeholder="1.0.1" /></label>
          <label>Effective date *<input required type="date" value={form.effectiveAt} onChange={(event) => setForm({ ...form, effectiveAt: event.target.value })} /></label>
          <label>Title *<input required maxLength={200} value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} /></label>
        </div>
        <label>Document HTML *<textarea required rows={18} maxLength={100000} value={form.content} onChange={(event) => setForm({ ...form, content: event.target.value })} /></label>
        <div className="form-actions"><button disabled={busy}>{busy ? "Saving…" : "Save draft"}</button>
          <button type="button" className="secondary" onClick={() => setShowForm(false)}>Cancel</button></div>
      </form>
    </section>}
    {preview && <section className="action-card legal-documents-preview"><div className="sa-actions"><h2>Preview · {preview.title} ({preview.version})</h2>
      <button type="button" className="secondary" onClick={() => setPreview(null)}>Close</button></div>
      <iframe title={`${preview.title} preview`} sandbox="" srcDoc={preview.content} /></section>}
  </main>;
}
