"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { ClientDataTable, type ClientColumn } from "./client-data-table";
import { ClientFormDialog } from "./client-form-dialog";
import { useLocale } from "./locale-provider";

type RawRow = Record<string, unknown>;
type WorkPartner = {
  id: string;
  code: string;
  name: string;
  legalName: string;
  status: string;
};
type Draft = {
  name: string;
  code: string;
  legalName: string;
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

function clientName(client: RawRow) {
  return text(client.businessFleetName ?? client.name ?? client.legalEntityName ?? client.id);
}

function clientLabel(client: RawRow, translate: (source: string) => string) {
  return `${clientName(client)} · ${text(client.companyCode)} · ${statusLabel(client.status, translate)}`;
}

export function WorkPartnerManager({
  mode,
  request,
  token,
  clients = [],
}: {
  mode: Mode;
  request: Request;
  token: string;
  clients?: RawRow[];
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
  const [copyMaster, setCopyMaster] = useState<WorkPartner | null>(null);
  const [copyTargetId, setCopyTargetId] = useState("");
  const [masterOptions, setMasterOptions] = useState<WorkPartner[]>([]);
  const [copyLoading, setCopyLoading] = useState(false);
  const [busy, setBusy] = useState(false);

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
      status: row.status === "INACTIVE" ? "INACTIVE" : "ACTIVE",
    });
    setFormError("");
    setNotice("");
    setDialog("form");
  }

  function openPlatformCopy(row: WorkPartner) {
    if (row.status !== "ACTIVE") return;
    setCopyMaster(row);
    setCopyTargetId("");
    setCopyError("");
    setNotice("");
    setDialog("copy");
  }

  function openClientCopy() {
    setCopyMaster(null);
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
      const body = editing
        ? { name, legalName, status: draft.status }
        : { name, code, legalName, status: draft.status };
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
    if (mode === "platform" && !copyTargetId) {
      setCopyError(t("Client is required."));
      return;
    }
    if (mode === "client" && !copyTargetId) {
      setCopyError(t("Shared work partner is required."));
      return;
    }
    if (mode === "platform" && !copyMaster) return;
    setBusy(true);
    setCopyError("");
    try {
      const path = mode === "platform"
        ? `/platform/clients/${copyTargetId}/work-partners/copies`
        : "/client/work-partners/copies";
      const masterId = mode === "platform" ? copyMaster?.id : copyTargetId;
      await request(
        path,
        { method: "POST", body: JSON.stringify({ masterId }) },
        token,
      );
      await loadRows();
      setDialog(null);
      setNotice(t(mode === "platform" ? "Work partner copied to client." : "Work partner copied."));
    } catch (cause) {
      setCopyError(cause instanceof Error ? cause.message : t("Unable to copy work partner."));
      if (mode === "client") void loadMasterOptions(false);
    } finally {
      setBusy(false);
    }
  }

  const columns: ClientColumn<WorkPartner>[] = [
    { key: "name", label: "Name", value: (row) => text(row.name) },
    { key: "code", label: "Code", value: (row) => text(row.code) },
    { key: "legalName", label: "Legal company name", value: (row) => text(row.legalName) },
    { key: "status", label: "Status", value: (row) => row.status, render: (row) => statusLabel(row.status, t) },
  ];

  return (
    <section className="client-manager-actions">
      <section className="sa-page-head client-page-head">
        <div className="sa-actions">
          <button type="button" onClick={openCreate} disabled={busy}>
            + {t("Add work partner")}
          </button>
          {mode === "client" && (
            <button type="button" className="secondary" onClick={openClientCopy} disabled={busy}>
              {t("Copy from master")}
            </button>
          )}
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
              {mode === "platform" && (
                row.status === "ACTIVE" ? (
                  <button type="button" className="table-action" onClick={() => openPlatformCopy(row)} disabled={busy}>{t("Copy to client")}</button>
                ) : (
                  <>
                    <button type="button" className="table-action" disabled aria-describedby={`inactive-copy-${row.id}`}>{t("Copy to client")}</button>
                    <span id={`inactive-copy-${row.id}`} className="muted">{t("Inactive masters cannot be copied.")}</span>
                  </>
                )
              )}
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
            <label>{t("Status")} *<select required value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value === "INACTIVE" ? "INACTIVE" : "ACTIVE" })}><option value="ACTIVE">{t("Active")}</option><option value="INACTIVE">{t("Inactive")}</option></select></label>
            <div className="form-actions"><button type="submit" disabled={busy}>{t(busy ? "Saving…" : "Save")}</button><button type="button" className="secondary" onClick={() => setDialog(null)} disabled={busy}>{t("Cancel")}</button></div>
          </form>
        </ClientFormDialog>
      )}
      {dialog === "copy" && (
        <ClientFormDialog
          title={mode === "platform" ? "Copy work partner to client" : "Copy work partner from master"}
          busy={busy || copyLoading}
          error={copyError}
          onClose={() => setDialog(null)}
        >
          <form className="form-stack" onSubmit={(event) => void submitCopy(event)}>
            <h2>{t(mode === "platform" ? "Copy work partner to client" : "Copy work partner from master")}</h2>
            {mode === "platform" ? (
              <>
                <p className="muted">{copyMaster ? `${copyMaster.name} · ${copyMaster.code}` : ""}</p>
                <label>{t("Client")} *<select required value={copyTargetId} onChange={(event) => setCopyTargetId(event.target.value)}><option value="">{t("Select a client")}</option>{clients.map((client) => <option key={String(client.id)} value={String(client.id)}>{clientLabel(client, t)}</option>)}</select></label>
                {!clients.length && <p className="muted">{t("No clients available.")}</p>}
              </>
            ) : copyLoading ? (
              <p className="muted" role="status">{t("Loading shared work partners…")}</p>
            ) : masterOptions.length ? (
              <label>{t("Shared work partner")} *<select required value={copyTargetId} onChange={(event) => setCopyTargetId(event.target.value)}><option value="">{t("Select a shared work partner")}</option>{masterOptions.map((master) => <option key={master.id} value={master.id}>{master.name} · {master.code}</option>)}</select></label>
            ) : (
              <p className="muted">{t("No active shared work partners are available.")}</p>
            )}
            <div className="form-actions"><button type="submit" disabled={busy || copyLoading || (mode === "platform" ? !copyMaster || !clients.length : !masterOptions.length)}>{t(copyLoading ? "Loading…" : "Copy")}</button><button type="button" className="secondary" onClick={() => setDialog(null)} disabled={busy || copyLoading}>{t("Cancel")}</button></div>
          </form>
        </ClientFormDialog>
      )}
    </section>
  );
}
