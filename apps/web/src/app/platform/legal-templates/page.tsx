"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { sessionFetch } from "../../../lib/session-fetch";

type Template = {
  id: string; appCode: string; role: string; kind: string; locale: string;
  version: string; title: string; content: string; isActive: boolean;
};
type Form = Omit<Template, "id">;
const blank = (): Form => ({ appCode: "RIDER", role: "RIDER", kind: "TERMS_AND_CONDITIONS", locale: "en", version: "1.0.0", title: "Rider Terms & Conditions", content: "", isActive: true });

async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await sessionFetch(`/api/v1/platform/legal-templates${path}`, {
    cache: "no-store", ...options,
    headers: { ...(options.body ? { "Content-Type": "application/json" } : {}), ...options.headers },
  });
  const body = await response.json() as { data?: T; error?: { message?: string }; message?: string };
  if (!response.ok || body.data === undefined) throw new Error(body.error?.message ?? body.message ?? "Unable to manage templates.");
  return body.data;
}

export default function PlatformLegalTemplatesPage() {
  const [authorized, setAuthorized] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<Form>(blank);
  const [showForm, setShowForm] = useState(false);
  const [preview, setPreview] = useState<Template | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const response = await sessionFetch("/api/v1/auth/me", { cache: "no-store" });
      if (!response.ok) throw new Error("Please sign in as Super Admin.");
      const body = await response.json() as { data?: { roles?: string[] } };
      if (!body.data?.roles?.includes("SUPER_ADMIN")) throw new Error("Only Super Admin can manage legal templates.");
      setAuthorized(true);
      setTemplates(await api<Template[]>(""));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to load templates."); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(""); setNotice("");
    try {
      const payload = { ...form, appCode: form.appCode.trim().toUpperCase(), locale: form.locale.trim().toLowerCase(), version: form.version.trim(), title: form.title.trim(), content: form.content.trim() };
      await api(editingId ? `/${editingId}` : "", { method: editingId ? "PATCH" : "POST", body: JSON.stringify(payload) });
      setTemplates(await api<Template[]>("")); setShowForm(false); setEditingId(null);
      setNotice("Template saved. New clients receive a draft copy when they are created.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to save template."); }
    finally { setBusy(false); }
  }

  async function remove(template: Template) {
    if (!window.confirm(`Remove template ${template.title} version ${template.version}? Existing client drafts will remain.`)) return;
    setBusy(true); setError("");
    try { await api(`/${template.id}`, { method: "DELETE" }); setTemplates(await api<Template[]>("")); setNotice("Template removed."); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to remove template."); }
    finally { setBusy(false); }
  }

  return <main className="client-dashboard legal-documents-page">
    <header className="legal-documents-header"><div><p className="eyebrow">SUPER ADMIN</p><h1>Legal document templates</h1>
      <p className="muted">Active templates are copied into each new client as unpublished drafts. Review client-specific facts before publishing.</p></div>
      <div className="sa-actions"><Link className="secondary" href="/platform/dashboard">Back to dashboard</Link>
        {authorized && <button type="button" onClick={() => { setEditingId(null); setForm(blank()); setShowForm(true); }}>+ New template</button>}</div></header>
    {error && <p className="error" role="alert">{error}</p>}{notice && <p className="notice" role="status">{notice}</p>}
    {loading ? <p className="muted">Loading templates…</p> : authorized && <>
      <div className="table-wrap"><table><thead><tr><th>Document</th><th>App / role</th><th>Version</th><th>Status</th><th>Actions</th></tr></thead>
      <tbody>{templates.map(template => <tr key={template.id}><td><strong>{template.title}</strong><br /><small>{template.locale} · {template.kind.replaceAll("_", " ")}</small></td>
        <td>{template.appCode} / {template.role.replaceAll("_", " ")}</td><td>{template.version}</td><td>{template.isActive ? "Active" : "Inactive"}</td>
        <td><div className="sa-actions"><button type="button" className="secondary" onClick={() => setPreview(template)}>Preview</button>
          <button type="button" className="secondary" disabled={busy} onClick={() => { setEditingId(template.id); setForm({ appCode: template.appCode, role: template.role, kind: template.kind, locale: template.locale, version: template.version, title: template.title, content: template.content, isActive: template.isActive }); setShowForm(true); }}>Edit</button>
          <button type="button" className="danger" disabled={busy} onClick={() => void remove(template)}>Remove</button></div></td></tr>)}</tbody></table></div>
      {templates.length === 0 && <p className="muted">No templates yet. Create one to supply drafts for new clients.</p>}
    </>}
    {showForm && <section className="action-card legal-documents-form"><h2>{editingId ? "Edit template" : "New template"}</h2>
      <p className="muted">Use {"{{CLIENT_LEGAL_NAME}}"}, {"{{CLIENT_NAME}}"} and {"{{CLIENT_CODE}}"} for values filled during client creation. Mark client-specific facts with [CLIENT_REVIEW_REQUIRED] so the draft cannot be published until reviewed.</p>
      <form className="form-stack" onSubmit={(event) => void save(event)}><div className="form-grid">
        <label>App code *<input required maxLength={40} value={form.appCode} onChange={event => setForm({ ...form, appCode: event.target.value })} /></label>
        <label>User role *<select value={form.role} onChange={event => setForm({ ...form, role: event.target.value })}>{["RIDER", "FLEET_MANAGER", "TEAM_LEAD", "OPERATIONS_MANAGER", "CLIENT_ADMIN", "KYC_OPERATOR"].map(role => <option key={role} value={role}>{role.replaceAll("_", " ")}</option>)}</select></label>
        <label>Document type *<select value={form.kind} onChange={event => setForm({ ...form, kind: event.target.value })}><option value="TERMS_AND_CONDITIONS">Terms & Conditions</option><option value="PRIVACY_POLICY">Privacy Policy</option></select></label>
        <label>Language *<input required pattern="[a-z]{2}" maxLength={2} value={form.locale} onChange={event => setForm({ ...form, locale: event.target.value })} /></label>
        <label>Version *<input required maxLength={80} value={form.version} onChange={event => setForm({ ...form, version: event.target.value })} /></label>
        <label>Title *<input required maxLength={200} value={form.title} onChange={event => setForm({ ...form, title: event.target.value })} /></label>
        <label><input type="checkbox" checked={form.isActive} onChange={event => setForm({ ...form, isActive: event.target.checked })} /> Active for new clients</label>
      </div><label>Document HTML *<textarea required rows={18} maxLength={100000} value={form.content} onChange={event => setForm({ ...form, content: event.target.value })} /></label>
      <div className="form-actions"><button disabled={busy}>{busy ? "Saving…" : "Save template"}</button><button type="button" className="secondary" onClick={() => setShowForm(false)}>Cancel</button></div></form></section>}
    {preview && <section className="action-card legal-documents-preview"><div className="sa-actions"><h2>Preview · {preview.title} ({preview.version})</h2><button type="button" className="secondary" onClick={() => setPreview(null)}>Close</button></div><iframe title={`${preview.title} preview`} sandbox="" srcDoc={preview.content} /></section>}
  </main>;
}
