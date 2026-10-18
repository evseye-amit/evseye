"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { ClientDataTable, type ClientColumn } from "./client-data-table";
import { ClientFormDialog } from "./client-form-dialog";
import { useLocale } from "./locale-provider";
import { workPartnerCategories } from "../../lib/domain-enums";
import { ClientBulkImportWorkspace, type ClientImportHistoryEntry } from "./client-bulk-import-workspace";
import { parseWorkPartnerImport, workPartnerImportColumns, workPartnerRequiredColumns, workPartnerFailuresCsv, type WorkPartnerImportFailure } from "./work-partner-import";

type RawRow = Record<string, unknown>;
type WorkPartner = {
  id: string;
  code: string;
  name: string;
  legalName: string;
  category: string;
  logo: string | null;
  workType: string | null;
  website: string | null;
  status: string;
};
type Draft = {
  name: string;
  code: string;
  legalName: string;
  category: string;
  logo: string | null;
  workType: string | null;
  website: string | null;
  status: "ACTIVE" | "INACTIVE";
};
type Request = (
  path: string,
  options?: RequestInit,
  token?: string,
) => Promise<unknown>;
type Mode = "platform" | "client";

const emptyDraft = (): Draft => ({
  name: "",
  code: "",
  legalName: "",
  category: "OTHER", logo: null, workType: null, website: null,
  status: "ACTIVE",
});

function asRows(value: unknown): WorkPartner[] {
  const rows: unknown[] = Array.isArray(value)
    ? value
    : value && typeof value === "object" && Array.isArray((value as RawRow).items)
      ? (value as RawRow).items as unknown[]
      : [];
  return rows.filter((row: unknown): row is WorkPartner => Boolean(row && typeof row === "object" && "id" in row));
}

function text(value: unknown, fallback = "—") {
  const result = String(value ?? "").trim();
  return result || fallback;
}

function statusLabel(value: unknown, translate: (source: string) => string) {
  if (value === "ACTIVE") return translate("Active");
  if (value === "INACTIVE") return translate("Inactive");
  return text(value);
}

export function WorkPartnerManager({
  mode,
  request,
  token,
}: {
  mode: Mode;
  request: Request;
  token: string;
}) {
  const { t } = useLocale();
  const [rows, setRows] = useState<WorkPartner[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [notice, setNotice] = useState("");
  const [dialog, setDialog] = useState<"form" | "copy" | null>(null);
  const [editing, setEditing] = useState<WorkPartner | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [formError, setFormError] = useState("");
  const [copyError, setCopyError] = useState("");
  const [copyTargetId, setCopyTargetId] = useState("");
  const [masterOptions, setMasterOptions] = useState<WorkPartner[]>([]);
  const [copyLoading, setCopyLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [bulk, setBulk] = useState(false);
  const [bulkError, setBulkError] = useState("");
  const [imports, setImports] = useState<ClientImportHistoryEntry[]>([]);
  const [importsLoading, setImportsLoading] = useState(false);
  const root = mode === "platform" ? "/platform/work-partners" : "/client/work-partners";

  const loadRows = useCallback(async (initial = false) => {
    if (initial) setLoading(true);
    else setRefreshing(true);
    setLoadError("");
    try {
      const data = await request(
        mode === "platform" ? "/platform/work-partners" : "/client/work-partners",
        {},
        token,
      );
      setRows(asRows(data));
    } catch (cause) {
      setLoadError(cause instanceof Error ? cause.message : t("Unable to load work partners."));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [mode, request, t, token]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadRows(true), 0);
    return () => window.clearTimeout(timer);
  }, [loadRows]);

  const loadMasterOptions = useCallback(async (clearError = true) => {
    if (clearError) setCopyError("");
    setCopyLoading(true);
    try {
      const data = await request("/client/work-partners/masters", {}, token);
      setMasterOptions(asRows(data).filter((row) => row.status === "ACTIVE"));
    } catch (cause) {
      setCopyError(cause instanceof Error ? cause.message : t("Unable to load shared work partners."));
    } finally {
      setCopyLoading(false);
    }
  }, [request, t, token]);

  function openCreate() {
    setEditing(null);
    setDraft(emptyDraft());
    setFormError("");
    setNotice("");
    setDialog("form");
  }

  function openEdit(row: WorkPartner) {
    setEditing(row);
    setDraft({
      name: text(row.name, ""),
      code: text(row.code, ""),
      legalName: text(row.legalName, ""),
      category: row.category ?? "OTHER", logo: row.logo ?? null, workType: row.workType ?? null, website: row.website ?? null,
      status: row.status === "INACTIVE" ? "INACTIVE" : "ACTIVE",
    });
    setFormError("");
    setNotice("");
    setDialog("form");
  }

  function openClientCopy() {
    setCopyTargetId("");
    setCopyError("");
    setMasterOptions([]);
    setNotice("");
    setDialog("copy");
    void loadMasterOptions();
  }

  async function submitForm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = draft.name.trim();
    const code = draft.code.trim();
    const legalName = draft.legalName.trim();
    if (!name || !code || !legalName) {
      setFormError(t("Name, code, and legal company name are required."));
      return;
    }
    setBusy(true);
    setFormError("");
    try {
      const details = { category: draft.category, logo: draft.logo?.trim() || null, workType: draft.workType?.trim() || null, website: draft.website?.trim() || null };
      const body = editing
        ? { name, legalName, status: draft.status, ...details }
        : { name, code, legalName, status: draft.status, ...details };
      await request(
        `${mode === "platform" ? "/platform/work-partners" : "/client/work-partners"}${editing ? `/${editing.id}` : ""}`,
        { method: editing ? "PATCH" : "POST", body: JSON.stringify(body) },
        token,
      );
      await loadRows();
      setDialog(null);
      setNotice(t(editing ? "Work partner updated." : "Work partner added."));
    } catch (cause) {
      setFormError(cause instanceof Error ? cause.message : t("Unable to save work partner."));
    } finally {
      setBusy(false);
    }
  }

  async function submitCopy(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!copyTargetId) { setCopyError(t("Shared work partner is required.")); return; }
    setBusy(true); setCopyError("");
    try {
      await request("/client/work-partners/copies", { method: "POST", body: JSON.stringify({ masterId: copyTargetId }) }, token);
      await loadRows(); setDialog(null); setNotice(t("Work partner copied."));
    } catch (cause) {
      setCopyError(cause instanceof Error ? cause.message : t("Unable to copy work partner."));
      void loadMasterOptions(false);
    } finally { setBusy(false); }
  }

  async function loadImports() {
    setImportsLoading(true);
    try { setImports(await request(`${root}/imports`, {}, token) as ClientImportHistoryEntry[]); }
    catch (cause) { setBulkError(cause instanceof Error ? cause.message : "Unable to load import history."); }
    finally { setImportsLoading(false); }
  }

  async function upload(file: File) {
    setBusy(true); setBulkError(""); setNotice("");
    try {
      if (!/\.csv$/i.test(file.name)) throw new Error("Choose a CSV file.");
      if (file.size > 5 * 1024 * 1024) throw new Error("CSV must be 5 MB or smaller.");
      const rows = parseWorkPartnerImport(await file.text());
      const result = await request(`${root}/bulk`, { method: "POST", body: JSON.stringify({ filename: file.name, rows }) }, token) as { passedRows: number; failedRows: number };
      setNotice(`Bulk upload complete: ${result.passedRows} passed, ${result.failedRows} failed.`);
    } catch (cause) { setBulkError(cause instanceof Error ? cause.message : "Unable to import work partners."); }
    finally { await Promise.all([loadRows(), loadImports()]); setBusy(false); }
  }

  async function downloadFailures(id: string) {
    setBusy(true); setBulkError("");
    try {
      const failures = await request(`${root}/imports/${id}/failures`, {}, token) as WorkPartnerImportFailure[];
      const url = URL.createObjectURL(new Blob([workPartnerFailuresCsv(failures)], { type: "text/csv;charset=utf-8" }));
      const link = document.createElement("a"); link.href = url; link.download = "work-partner-failed-records.csv"; link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (cause) { setBulkError(cause instanceof Error ? cause.message : "Unable to download failed records."); }
    finally { setBusy(false); }
  }

  const columns: ClientColumn<WorkPartner>[] = [
    { key: "category", label: "Category", value: (row) => (row.category ?? "OTHER").replaceAll("_", " ") },
    { key: "name", label: "Name", value: (row) => text(row.name) },
    { key: "code", label: "Code", value: (row) => text(row.code) },
    { key: "legalName", label: "Legal company name", value: (row) => text(row.legalName) },
    { key: "status", label: "Status", value: (row) => row.status, render: (row) => statusLabel(row.status, t) },
  ];

  if (bulk) return <section className="client-manager-actions">
    {bulkError && <p className="error" role="alert">{bulkError}</p>}
    {notice && <p className="notice" role="status">{notice}</p>}
    <ClientBulkImportWorkspace title="Work Partners" eyebrow={mode === "platform" ? "SUPER ADMIN IMPORT" : "CLIENT OPERATIONS IMPORT"}
      requiredColumns={workPartnerRequiredColumns.join(", ")} template={`${workPartnerImportColumns.join(",")}\n`}
      history={imports} historyLoading={importsLoading} busy={busy} onBack={() => setBulk(false)} onUpload={upload} onDownloadFailures={downloadFailures}
      help={<><p className="sa-bulk-help">Maximum 100 work partners per upload. Adds new codes only; existing entries are never overwritten. Category defaults to OTHER and status defaults to ACTIVE when blank.</p><p className="sa-bulk-help">Categories: {workPartnerCategories.join(", ")}. Status: ACTIVE or INACTIVE. Logo paths must refer to local work partner assets.</p></>}
    />
  </section>;
  return (
    <section className="client-manager-actions">
      <section className="sa-page-head client-page-head">
        <div className="sa-actions">
          <button type="button" className="secondary" disabled={busy} onClick={() => { setBulkError(""); setNotice(""); setBulk(true); void loadImports(); }}>{t("Bulk upload")}</button>
          {mode === "client" && (
            <button type="button" className="secondary" onClick={openClientCopy} disabled={busy}>
              {t("Copy from master")}
            </button>
          )}
          <button type="button" onClick={openCreate} disabled={busy}>+ {t("Add work partner")}</button>
        </div>
      </section>
      {notice && <p className="notice" role="status" aria-live="polite">{notice}</p>}
      {loading ? (
        <p className="muted" role="status">{t("Loading work partners…")}</p>
      ) : loadError ? (
        <div role="alert">
          <p className="error">{loadError}</p>
          <button type="button" className="secondary" onClick={() => void loadRows(true)} disabled={refreshing}>{t("Retry")}</button>
        </div>
      ) : (
        <ClientDataTable
          rows={rows}
          columns={columns}
          getRowId={(row) => row.id}
          emptyMessage={mode === "platform" ? "No shared work partners yet." : "No work partners for this client yet."}
          actions={(row) => (
            <>
              <button type="button" className="secondary table-action" onClick={() => openEdit(row)} disabled={busy}>{t("Edit")}</button>

            </>
          )}
        />
      )}
      {dialog === "form" && (
        <ClientFormDialog
          title={editing ? "Edit work partner" : "Add work partner"}
          busy={busy}
          error={formError}
          onClose={() => setDialog(null)}
        >
          <form className="form-stack" onSubmit={(event) => void submitForm(event)}>
            <h2>{t(editing ? "Edit work partner" : "Add work partner")}</h2>
            <label>{t("Name")} *<input required maxLength={150} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
            <label>{t("Code")} *<input required maxLength={50} readOnly={Boolean(editing)} value={draft.code} onChange={(event) => setDraft({ ...draft, code: event.target.value })} aria-describedby={editing ? "work-partner-code-help" : undefined} /></label>
            {editing && <small id="work-partner-code-help">{t("Code cannot be changed after creation.")}</small>}
            <label>{t("Legal company name")} *<input required maxLength={160} value={draft.legalName} onChange={(event) => setDraft({ ...draft, legalName: event.target.value })} /></label>
            <label>{t("Category")} *<select required value={draft.category} onChange={(event) => setDraft({ ...draft, category: event.target.value })}>{workPartnerCategories.map((category) => <option key={category} value={category}>{t(category.replaceAll("_", " "))}</option>)}</select></label>
            <label>{t("Logo asset path")}<input maxLength={250} placeholder="/logos/work-partners/PARTNER.svg" value={draft.logo ?? ""} onChange={(event) => setDraft({ ...draft, logo: event.target.value })} /><small>{t("Use an installed work partner logo asset.")}</small></label>
            <label>{t("Work type")}<input maxLength={500} value={draft.workType ?? ""} onChange={(event) => setDraft({ ...draft, workType: event.target.value })} /></label>
            <label>{t("Website")}<input maxLength={500} value={draft.website ?? ""} onChange={(event) => setDraft({ ...draft, website: event.target.value })} /></label>
            <label>{t("Status")} *<select required value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value === "INACTIVE" ? "INACTIVE" : "ACTIVE" })}><option value="ACTIVE">{t("Active")}</option><option value="INACTIVE">{t("Inactive")}</option></select></label>
            <div className="form-actions"><button type="submit" disabled={busy}>{t(busy ? "Saving…" : "Save")}</button><button type="button" className="secondary" onClick={() => setDialog(null)} disabled={busy}>{t("Cancel")}</button></div>
          </form>
        </ClientFormDialog>
      )}
      {dialog === "copy" && (
        <ClientFormDialog
          title="Copy work partner from master"
          busy={busy || copyLoading}
          error={copyError}
          onClose={() => setDialog(null)}
        >
          <form className="form-stack" onSubmit={(event) => void submitCopy(event)}>
            <h2>{t("Copy work partner from master")}</h2>
            {copyLoading ? (
              <p className="muted" role="status">{t("Loading shared work partners…")}</p>
            ) : masterOptions.length ? (
              <label>{t("Shared work partner")} *<select required value={copyTargetId} onChange={(event) => setCopyTargetId(event.target.value)}><option value="">{t("Select a shared work partner")}</option>{masterOptions.map((master) => <option key={master.id} value={master.id}>{master.name} · {master.code}</option>)}</select></label>
            ) : (
              <p className="muted">{t("No active shared work partners are available.")}</p>
            )}
            <div className="form-actions"><button type="submit" disabled={busy || copyLoading || !masterOptions.length}>{t(copyLoading ? "Loading…" : "Copy")}</button><button type="button" className="secondary" onClick={() => setDialog(null)} disabled={busy || copyLoading}>{t("Cancel")}</button></div>
          </form>
        </ClientFormDialog>
      )}
    </section>
  );
}
