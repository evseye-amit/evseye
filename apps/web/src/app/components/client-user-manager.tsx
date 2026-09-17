"use client";

import { useState, type FormEvent } from "react";
import { ClientDataTable, type ClientColumn } from "./client-data-table";
import { ClientDeleteDialog, type ClientDeleteConfirmation } from "./client-delete-dialog";
import { ClientFormDialog } from "./client-form-dialog";

type Row = Record<string, unknown>;
type Kind = "fleet-managers" | "team-leads";
type Request = (path: string, options?: RequestInit) => Promise<unknown>;

function HubMultiSelect({ hubs, selectedIds, onChange }: {
  hubs: Row[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
}) {
  return <div className="client-hub-multiselect-field">
    <span>Assigned hubs *</span>
    <details className="client-hub-multiselect">
      <summary>{selectedIds.length ? `${selectedIds.length} hub${selectedIds.length === 1 ? "" : "s"} selected` : "Select assigned hubs"}</summary>
      <div className="client-hub-options">
        {hubs.length ? hubs.map((hub) => {
          const id = String(hub.id);
          return <label key={id}><input type="checkbox" checked={selectedIds.includes(id)} onChange={(event) => onChange(event.target.checked ? [...selectedIds, id] : selectedIds.filter((value) => value !== id))} />{String(hub.name)} ({String(hub.code)})</label>;
        }) : <p>Create a hub before assigning a Fleet Manager.</p>}
      </div>
    </details>
    {selectedIds.length > 0 && <div className="client-hub-chips">{selectedIds.map((id) => {
      const hub = hubs.find((item) => String(item.id) === id);
      const label = hub ? `${String(hub.name)} (${String(hub.code)})` : id;
      return <button key={id} type="button" aria-label={`Remove ${label} from assigned hubs`} onClick={() => onChange(selectedIds.filter((value) => value !== id))}>{label}<span aria-hidden="true">×</span></button>;
    })}</div>}
  </div>;
}

export function parseCsv(input: string): string[][] {
  input = input.replace(/^\uFEFF/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    if (character === '"') {
      if (quoted && input[index + 1] === '"') { cell += '"'; index += 1; }
      else quoted = !quoted;
    } else if (character === "," && !quoted) { row.push(cell); cell = ""; }
    else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && input[index + 1] === "\n") index += 1;
      row.push(cell); if (row.some((value) => value.trim())) rows.push(row);
      row = []; cell = "";
    } else cell += character;
  }
  if (quoted) throw new Error("CSV has an unclosed quote.");
  row.push(cell); if (row.some((value) => value.trim())) rows.push(row);
  return rows;
}

export function ClientUserManager({ kind, rows, hubs, columns, request, refresh, report, onBulk }: {
  kind: Kind;
  rows: Row[];
  hubs: Row[];
  columns: ClientColumn<Row>[];
  request: Request;
  refresh: () => Promise<void>;
  report: (message: string, error?: boolean) => void;
  onBulk: () => void;
}) {
  const isFleetManager = kind === "fleet-managers";
  const title = isFleetManager ? "Fleet Manager" : "Team Lead";
  const [editing, setEditing] = useState<Row | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState("");
  const [deleteConfirmation, setDeleteConfirmation] = useState<ClientDeleteConfirmation | null>(null);
  const [draft, setDraft] = useState({ name: "", mobile: "", employeeCode: "", designation: "", hubIds: [] as string[], primaryHubId: "", isActive: true });
  const start = (row?: Row) => {
    const user = (row?.user as Row | undefined) ?? row;
    const assigned = ((row?.hubAssignments as Row[]) ?? []).map((item) => String(item.hubId));
    setEditing(row ?? null);
    setFormError("");
    setDraft({
      name: String(user?.name ?? ""), mobile: String(user?.mobile ?? ""),
      employeeCode: String(row?.employeeCode ?? ""), designation: String(row?.designation ?? ""),
      hubIds: assigned, primaryHubId: String(((row?.hubAssignments as Row[]) ?? []).find((item) => item.isPrimary)?.hubId ?? assigned[0] ?? ""), isActive: user?.isActive !== false,
    });
    setOpen(true);
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      const body = isFleetManager
        ? { name: draft.name, mobile: draft.mobile, hubIds: draft.hubIds, primaryHubId: draft.primaryHubId, isActive: draft.isActive }
        : { name: draft.name, mobile: draft.mobile, employeeCode: draft.employeeCode || undefined, designation: draft.designation || undefined };
      await request(`/client/users/${kind}${editing ? `/${editing.id}` : ""}`, { method: editing ? "PATCH" : "POST", body: JSON.stringify(body) });
      await refresh(); setOpen(false); report(`${title} ${editing ? "updated" : "added"}.`);
    } catch (error) { const message = error instanceof Error ? error.message : "Unable to save."; setFormError(message); report(message, true); }
    finally { setBusy(false); }
  };
  const remove = async (row: Row) => {
    setBusy(true);
    try { await request(`/client/users/${kind}/${row.id}`, { method: "DELETE" }); await refresh(); report(`${title} deleted.`); }
    catch (error) { report(error instanceof Error ? error.message : "Unable to delete.", true); }
    finally { setBusy(false); }
  };
  return (
    <section className="client-manager-actions">
      <section className="sa-page-head client-page-head"><div className="sa-actions"><button type="button" className="secondary" onClick={onBulk}>Bulk upload</button><button type="button" onClick={() => start()} disabled={busy}>+ Add {title}</button></div></section>
      {open && <ClientFormDialog title={`${editing ? "Edit" : "Add"} ${title}`} error={formError} busy={busy} onClose={() => setOpen(false)}><form className="form-stack" onSubmit={(event) => void submit(event)}>
        <h2>{editing ? "Edit" : "Add"} {title}</h2>
        <label>Name *<input required maxLength={150} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
        <label>Mobile number *<input required inputMode="tel" value={draft.mobile} onChange={(event) => setDraft({ ...draft, mobile: event.target.value })} /></label>
        {isFleetManager ? <>
          <HubMultiSelect hubs={hubs} selectedIds={draft.hubIds} onChange={(hubIds) => setDraft((current) => ({ ...current, hubIds, primaryHubId: hubIds.includes(current.primaryHubId) ? current.primaryHubId : hubIds[0] ?? "" }))} />
          <label>Primary hub *<select required value={draft.primaryHubId} onChange={(event) => setDraft({ ...draft, primaryHubId: event.target.value })}><option value="">Select hub</option>{hubs.filter((hub) => draft.hubIds.includes(String(hub.id))).map((hub) => <option key={String(hub.id)} value={String(hub.id)}>{String(hub.name)} ({String(hub.code)})</option>)}</select></label>
          <label>Status<select value={draft.isActive ? "ACTIVE" : "INACTIVE"} onChange={(event) => setDraft({ ...draft, isActive: event.target.value === "ACTIVE" })}><option value="ACTIVE">Active</option><option value="INACTIVE">Inactive</option></select></label>
        </> : <><label>Employee code<input value={draft.employeeCode} onChange={(event) => setDraft({ ...draft, employeeCode: event.target.value })} /></label><label>Designation<input value={draft.designation} onChange={(event) => setDraft({ ...draft, designation: event.target.value })} /></label></>}
        <div className="form-actions"><button disabled={busy || (isFleetManager && !draft.hubIds.length)}>Save {title}</button><button type="button" className="secondary" onClick={() => setOpen(false)}>Cancel</button></div>
      </form></ClientFormDialog>}
      <ClientDataTable rows={rows} columns={columns} getRowId={(row) => String(row.id)} actions={(row) => <>
        <button type="button" className="secondary table-action" disabled={busy} onClick={() => start(row)}>Edit</button>
        <button type="button" className="danger table-action" disabled={busy} onClick={() => setDeleteConfirmation({ title: `Delete ${title}?`, description: `This ${title.toLowerCase()} will be removed from the active list. Existing history is retained.`, confirmLabel: `Delete ${title}`, onConfirm: () => remove(row) })}>Delete</button>
      </>} />
      <ClientDeleteDialog confirmation={deleteConfirmation} busy={busy} onClose={() => setDeleteConfirmation(null)} />
    </section>
  );
}
