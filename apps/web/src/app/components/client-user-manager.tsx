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
  const resource = isFleetManager ? "fleet-managers" : "team-leaders";
  const title = isFleetManager ? "Fleet Manager" : "Team Lead";
  const [editing, setEditing] = useState<Row | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState("");
  const [deleteConfirmation, setDeleteConfirmation] = useState<ClientDeleteConfirmation | null>(null);
  const [reassigning, setReassigning] = useState<Row | null>(null);
  const [targetTeamLeaderId, setTargetTeamLeaderId] = useState("");
  const [reassignError, setReassignError] = useState("");
  const [draft, setDraft] = useState({ name: "", mobile: "", employeeCode: "", designation: "", joiningDate: "", hubIds: [] as string[], primaryHubId: "", isActive: true });
  const start = (row?: Row) => {
    const user = (row?.user as Row | undefined) ?? row;
    const assigned = ((row?.hubAssignments as Row[]) ?? []).map((item) => String(item.hubId));
    setEditing(row ?? null);
    setFormError("");
    setDraft({
      name: String(user?.name ?? ""), mobile: String(user?.mobile ?? ""),
      employeeCode: String(row?.employeeCode ?? ""), designation: String(row?.designation ?? ""),
      joiningDate: row?.joiningDate ? String(row.joiningDate).slice(0, 10) : "",
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
        : { name: draft.name, mobile: draft.mobile, employeeCode: draft.employeeCode || undefined, designation: draft.designation || undefined, joiningDate: draft.joiningDate || undefined, isActive: draft.isActive };
      await request(`/client/users/${resource}${editing ? `/${editing.id}` : ""}`, { method: editing ? "PATCH" : "POST", body: JSON.stringify(body) });
      await refresh(); setOpen(false); report(`${title} ${editing ? "updated" : "added"}.`);
    } catch (error) { const message = error instanceof Error ? error.message : "Unable to save."; setFormError(message); report(message, true); }
    finally { setBusy(false); }
  };
  const remove = async (row: Row) => {
    setBusy(true);
    try { await request(`/client/users/${resource}/${row.id}`, { method: "DELETE" }); await refresh(); report(`${title} deleted.`); }
    catch (error) { report(error instanceof Error ? error.message : "Unable to delete.", true); }
    finally { setBusy(false); }
  };
  const reassign = async (event: FormEvent) => {
    event.preventDefault();
    if (!reassigning) return;
    setBusy(true);
    setReassignError("");
    try {
      const count = Number(((reassigning._count as Row | undefined)?.riders) ?? 0);
      await request(`/client/users/team-leaders/${reassigning.id}/reassign`, {
        method: "POST",
        body: JSON.stringify({ targetTeamLeaderId: count ? targetTeamLeaderId : undefined }),
      });
      await refresh();
      setReassigning(null);
      report(`${count} rider${count === 1 ? "" : "s"} reassigned. Team Lead deactivated.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to reassign riders.";
      setReassignError(message);
      report(message, true);
    } finally { setBusy(false); }
  };
  const eligibleLeaders = rows.filter((row) => row.id !== reassigning?.id && (row.user as Row | undefined)?.isActive !== false);
  const assignedRiders = Number(((reassigning?._count as Row | undefined)?.riders) ?? 0);
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
        </> : <>
          <label>Employee code (optional)<input maxLength={50} value={draft.employeeCode} onChange={(event) => setDraft({ ...draft, employeeCode: event.target.value })} /></label>
          <label>Designation (optional)<input maxLength={100} value={draft.designation} onChange={(event) => setDraft({ ...draft, designation: event.target.value })} /></label>
          <label>Joining date (optional)<input type="date" value={draft.joiningDate} onChange={(event) => setDraft({ ...draft, joiningDate: event.target.value })} /></label>
          <label>Status *<select required value={draft.isActive ? "ACTIVE" : "INACTIVE"} onChange={(event) => setDraft({ ...draft, isActive: event.target.value === "ACTIVE" })}><option value="ACTIVE">Active</option><option value="INACTIVE" disabled={Boolean(editing && Number(((editing._count as Row | undefined)?.riders) ?? 0))}>Inactive</option></select></label>
          {editing && Number(((editing._count as Row | undefined)?.riders) ?? 0) > 0 && <p className="muted">Use Reassign to transfer riders before deactivating this Team Lead.</p>}
        </>}
        <div className="form-actions"><button disabled={busy || (isFleetManager && !draft.hubIds.length)}>Save {title}</button><button type="button" className="secondary" onClick={() => setOpen(false)}>Cancel</button></div>
      </form></ClientFormDialog>}
      {reassigning && <ClientFormDialog title={`Reassign ${String((reassigning.user as Row | undefined)?.name ?? "Team Lead")}`} error={reassignError} busy={busy} onClose={() => setReassigning(null)}>
        <h2>Reassign riders</h2>
        <p>{assignedRiders ? `${assignedRiders} rider${assignedRiders === 1 ? "" : "s"} will be moved to another Team Lead before this account is deactivated.` : "This Team Lead has no assigned riders. The account will be deactivated."}</p>
        <form className="form-stack" onSubmit={(event) => void reassign(event)}>
          {assignedRiders > 0 && <label>Receiving Team Lead *<select required value={targetTeamLeaderId} onChange={(event) => setTargetTeamLeaderId(event.target.value)}><option value="">Select an active Team Lead</option>{eligibleLeaders.map((leader) => <option key={String(leader.id)} value={String(leader.id)}>{String((leader.user as Row | undefined)?.name ?? "Team Lead")} · {String((leader.user as Row | undefined)?.mobile ?? "")}</option>)}</select></label>}
          {assignedRiders > 0 && !eligibleLeaders.length && <p className="error">Add or activate another Team Lead before reassignment.</p>}
          <div className="form-actions"><button type="button" className="secondary" onClick={() => setReassigning(null)}>Cancel</button><button disabled={busy || (assignedRiders > 0 && (!targetTeamLeaderId || !eligibleLeaders.length))}>Reassign and deactivate</button></div>
        </form>
      </ClientFormDialog>}
      <ClientDataTable rows={rows} columns={columns} getRowId={(row) => String(row.id)} actions={(row) => <>
        <button type="button" className="secondary table-action" disabled={busy} onClick={() => start(row)}>Edit</button>
        {isFleetManager ? <button type="button" className="danger table-action" disabled={busy} onClick={() => setDeleteConfirmation({ title: `Delete ${title}?`, description: `This ${title.toLowerCase()} will be removed from the active list. Existing history is retained.`, confirmLabel: `Delete ${title}`, onConfirm: () => remove(row) })}>Delete</button>
          : <button type="button" className="secondary table-action" disabled={busy || (row.user as Row | undefined)?.isActive === false} onClick={() => { setReassigning(row); setTargetTeamLeaderId(""); setReassignError(""); }}>Reassign</button>}
      </>} />
      <ClientDeleteDialog confirmation={deleteConfirmation} busy={busy} onClose={() => setDeleteConfirmation(null)} />
    </section>
  );
}
