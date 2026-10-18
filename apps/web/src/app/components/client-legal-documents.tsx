"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { sessionFetch } from "../../lib/session-fetch";
import { ClientDataTable, type ClientColumn } from "./client-data-table";
import { ClientFormDialog } from "./client-form-dialog";

import { LegalAcceptanceFields, type LegalAcceptanceCopy } from "./legal-acceptance-fields";

type LegalDocument = {
  id: string; appCode: string; role: string; kind: string; locale: string;
  version: string; title: string; content: string; effectiveAt: string;
  acceptance?: LegalAcceptanceCopy | null;
  publishedAt: string | null; retiredAt: string | null;
};
type LegalForm = Pick<LegalDocument, "appCode" | "role" | "kind" | "locale" | "version" | "title" | "content" | "acceptance"> & { effectiveAt: string };
const emptyForm = (): LegalForm => ({ appCode: "RIDER", role: "RIDER", kind: "TERMS_AND_CONDITIONS", locale: "en", version: "", title: "Rider Terms & Conditions", content: "", effectiveAt: new Date().toISOString().slice(0, 10) });
const statusOf = (document: LegalDocument) => document.retiredAt ? "Retired" : document.publishedAt ? "Published"
  : document.content.includes("[CLIENT_REVIEW_REQUIRED: English placeholder") ? "Translation pending" : "Draft";
const needsLegalReview = (document: LegalDocument) => [
  "[CLIENT_REVIEW_REQUIRED", "[ক্লায়েন্টের পর্যালোচনা প্রয়োজন", "[ક્લાયન્ટની સમીક્ષા જરૂરી",
  "[क्लाइंट की समीक्षा ज़रूरी है", "[ಗ್ರಾಹಕರ ಪರಿಶೀಲನೆ ಅಗತ್ಯ",
  "[ക്ലയന്റ് പരിശോധന ആവശ്യമാണ്", "[ग्राहकाने पुनरावलोकन करणे आवश्यक",
  "[କ୍ଲାଏଣ୍ଟଙ୍କ ସମୀକ୍ଷା ଆବଶ୍ୟକ", "[ਕਲਾਇੰਟ ਦੁਆਰਾ ਸਮੀਖਿਆ ਲੋੜੀਂਦੀ",
  "[ਗਾਹਕ ਦੁਆਰਾ ਸਮੀਖਿਆ ਲੋੜੀਂਦੀ", "[வாடிக்கையாளர் ஆய்வு தேவை",
  "[క్లయింట్ సమీక్ష అవసరం", "[کلائنٹ کا جائزہ درکار ہے",
].some((marker) => document.content.includes(marker));
const dateOf = (value: string) => new Date(value).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric" });

async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await sessionFetch(`/api/v1/legal/documents${path}`, { cache: "no-store", ...options, headers: { ...(options.body ? { "Content-Type": "application/json" } : {}), ...options.headers } });
  const body = await response.json() as { data?: T; error?: { message?: string }; message?: string };
  if (!response.ok || body.data === undefined) throw new Error(body.error?.message ?? body.message ?? "Unable to manage legal documents.");
  return body.data;
}

const columns: ClientColumn<LegalDocument>[] = [
  { key: "document", label: "Document", value: (row) => `${row.title} ${row.kind} ${row.locale}`, render: (row) => <span className="client-legal-title"><strong>{row.title}</strong><small>{row.kind.replaceAll("_", " ")} · {row.locale.toUpperCase()}</small></span> },
  { key: "audience", label: "App / Role", value: (row) => `${row.appCode} / ${row.role.replaceAll("_", " ")}` },
  { key: "version", label: "Version", value: (row) => row.version },
  { key: "effectiveAt", label: "Effective date", value: (row) => row.effectiveAt, render: (row) => dateOf(row.effectiveAt) },
  { key: "status", label: "Status", value: statusOf, render: (row) => <span className={`status status-${statusOf(row).toLowerCase().replaceAll(" ", "-")}`}>{statusOf(row)}</span>, filterOptions: ["Translation pending", "Draft", "Published", "Retired"] },
];

export function ClientLegalDocuments() {
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
    setLoading(true); setError("");
    try { setDocuments(await api<LegalDocument[]>("")); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to load legal documents."); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);

  function startNew() { setEditingId(null); setForm(emptyForm()); setShowForm(true); setError(""); setNotice(""); }
  function startEdit(document: LegalDocument) {
    if (document.publishedAt) return;
    setEditingId(document.id);
    setForm({ appCode: document.appCode, role: document.role, kind: document.kind, locale: document.locale, version: document.version, title: document.title, content: document.content, acceptance: document.acceptance, effectiveAt: new Date(document.effectiveAt).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }) });
    setShowForm(true); setError(""); setNotice("");
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(""); setNotice("");
    try {
      const payload = { ...form, appCode: form.appCode.trim().toUpperCase(), version: form.version.trim(), title: form.title.trim(), content: form.content.trim(), locale: form.locale.trim().toLowerCase(), effectiveAt: new Date(`${form.effectiveAt}T00:00:00+05:30`).toISOString() };
      await api(editingId ? `/${editingId}` : "/drafts", { method: editingId ? "PATCH" : "POST", body: JSON.stringify(payload) });
      setShowForm(false); setEditingId(null); setNotice(editingId ? "Draft updated." : "Draft created."); setDocuments(await api<LegalDocument[]>(""));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to save draft."); }
    finally { setBusy(false); }
  }
  async function publish(document: LegalDocument) {
    if (!window.confirm(`Publish ${document.title} version ${document.version}? Published content cannot be edited or deleted.`)) return;
    setBusy(true); setError(""); setNotice("");
    try { await api(`/${document.id}/publish`, { method: "POST" }); setDocuments(await api<LegalDocument[]>("")); setNotice(`Version ${document.version} published.`); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to publish draft."); }
    finally { setBusy(false); }
  }
  async function remove(document: LegalDocument) {
    if (!window.confirm(`Delete draft ${document.title} version ${document.version}?`)) return;
    setBusy(true); setError(""); setNotice("");
    try { await api(`/${document.id}`, { method: "DELETE" }); setDocuments(await api<LegalDocument[]>("")); setNotice("Draft deleted."); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to delete draft."); }
    finally { setBusy(false); }
  }

  return <div className="client-legal-documents">
    <section className="action-card client-legal-intro"><div><p className="eyebrow">CLIENT LEGAL LIBRARY</p><h2>Legal documents</h2><p className="muted">Prepare terms, privacy policies and privacy consent for each app and user role. Published versions stay available as a permanent record.</p></div><button type="button" onClick={startNew}>+ New draft</button></section>
    {error && !showForm && <p className="error" role="alert">{error}</p>}{notice && <p className="notice" role="status">{notice}</p>}
    {loading ? <p className="muted">Loading documents…</p> : <ClientDataTable rows={documents} columns={columns} getRowId={(row) => row.id} emptyMessage="No legal documents yet. Create a draft to begin." actions={(document) => <><button type="button" className="secondary table-action" onClick={() => setPreview(document)}>Preview</button>{!document.publishedAt && <><button type="button" className="secondary table-action" disabled={busy} onClick={() => startEdit(document)}>Edit</button><button type="button" className="table-action" disabled={busy || needsLegalReview(document)} title={needsLegalReview(document) ? "Translate the document and resolve every legal review marker before publishing." : undefined} onClick={() => void publish(document)}>Publish</button><button type="button" className="danger table-action" disabled={busy} onClick={() => void remove(document)}>Delete draft</button></>}</>} />}
    {showForm && <ClientFormDialog title={editingId ? "Edit legal draft" : "Create legal draft"} wide busy={busy} error={error} onClose={() => setShowForm(false)}><p className="eyebrow">LEGAL DOCUMENT</p><h2>{editingId ? "Edit draft" : "Create a draft"}</h2><p className="muted">Write the document in HTML, then preview it before publishing.</p><form className="form-stack" onSubmit={(event) => void save(event)}><div className="form-grid">
      <label>App code *<input required maxLength={40} value={form.appCode} onChange={(event) => setForm({ ...form, appCode: event.target.value })} /></label>
      <label>User role *<select value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value })}>{["RIDER", "FLEET_MANAGER", "TEAM_LEAD", "OPERATIONS_MANAGER", "CLIENT_ADMIN", "KYC_OPERATOR"].map((role) => <option key={role} value={role}>{role.replaceAll("_", " ")}</option>)}</select></label>
      <label>Document type *<select value={form.kind} onChange={(event) => setForm({ ...form, kind: event.target.value, title: event.target.value === "PRIVACY_CONSENT" ? "Privacy Notice cum Consent Form" : event.target.value === "PRIVACY_POLICY" ? "Rider Privacy Policy" : "Rider Terms & Conditions" })}><option value="TERMS_AND_CONDITIONS">Terms &amp; Conditions</option><option value="PRIVACY_POLICY">Privacy Policy</option><option value="PRIVACY_CONSENT">Privacy Notice and Consent</option></select></label>
      <label>Language *<input required pattern="[a-z]{2}" maxLength={2} value={form.locale} onChange={(event) => setForm({ ...form, locale: event.target.value })} /></label>
      <label>Version *<input required maxLength={80} value={form.version} onChange={(event) => setForm({ ...form, version: event.target.value })} placeholder="1.0.1" /></label>
      <label>Effective date *<input required type="date" value={form.effectiveAt} onChange={(event) => setForm({ ...form, effectiveAt: event.target.value })} /></label>
      <label>Title *<input required maxLength={200} value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} /></label>
    </div><label>Document HTML *<textarea required rows={16} maxLength={100000} value={form.content} onChange={(event) => setForm({ ...form, content: event.target.value })} /></label>{form.kind === "PRIVACY_CONSENT" && <LegalAcceptanceFields locale={form.locale} value={form.acceptance} onChange={(acceptance) => setForm({ ...form, acceptance })} />}<div className="form-actions"><button disabled={busy}>{busy ? "Saving…" : "Save draft"}</button><button type="button" className="secondary" onClick={() => setShowForm(false)}>Cancel</button></div></form></ClientFormDialog>}
    {preview && <ClientFormDialog title={`Preview ${preview.title}`} wide onClose={() => setPreview(null)}><p className="eyebrow">DOCUMENT PREVIEW · VERSION {preview.version}</p><h2>{preview.title}</h2><div className="legal-documents-preview"><iframe title={`${preview.title} preview`} sandbox="" srcDoc={preview.content} /></div><div className="form-actions"><button type="button" className="secondary" onClick={() => setPreview(null)}>Close preview</button></div></ClientFormDialog>}
  </div>;
}
