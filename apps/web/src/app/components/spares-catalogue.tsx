"use client";
import { useEffect, useState, type FormEvent } from "react";
import { sessionFetch } from "../../lib/session-fetch";
import { ClientFormDialog } from "./client-form-dialog";
import { ClientDataTable, type ClientColumn } from "./client-data-table";
import { PlatformDataTable } from "./platform-data-table";
import { ClientBulkImportWorkspace, type ClientImportHistoryEntry } from "./client-bulk-import-workspace";
import { parseSpareImport, spareColumns, spareRequiredColumns, spareFailuresCsv, type SpareImportFailure } from "./spares-import";
type Spare = {
  id: string;
  code: string;
  name: string;
  description?: string;
  category?: string;
  baseRate: string | null;
  gstPercent: string | null;
  hsnCode: string | null;
  unit: string;
  isActive: boolean;
  version: number;
  configurationVersion?: number;
  vehicleTypeIds: string[];
  origin?: "MASTER" | "CLIENT" | "NON_SPARE";
  penaltyAmount?: string | null;
  penaltyConfigured?: boolean;
  evidenceRequired?: boolean;
  masterUpdateAvailable?: boolean;
  masterInactive?: boolean;
  isSpare?: boolean;
};
type Form = {
  code: string;
  name: string;
  baseRate: string;
  gstPercent: string;
  hsnCode: string;
  unit: string;
  isActive: boolean;
  penaltyAmount: string;
  evidenceRequired: boolean;
  reason: string;
  vehicleTypeIds: string[];
};
type Update = {
  priceId: string;
  code: string;
  expectedVersion: number;
  masterVersion: number;
  masterActive: boolean;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
};
type Revision = {
  id: string;
  version: number;
  reason: string;
  createdAt: string;
  snapshot: Partial<Spare> & { amount?: string };
};
const empty = (): Form => ({
  code: "",
  name: "",
  baseRate: "",
  gstPercent: "",
  hsnCode: "",
  unit: "PIECE",
  isActive: false,
  penaltyAmount: "",
  evidenceRequired: true,
  reason: "",
  vehicleTypeIds: [],
});
async function api<T>(
  path: string,
  method = "GET",
  data?: unknown,
): Promise<T> {
  const response = await sessionFetch(`/api/v1/${path}`, {
    method,
    ...(data === undefined
      ? {}
      : {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        }),
  });
  const body = await response.json();
  if (!response.ok)
    throw new Error(
      Array.isArray(body.error?.message)
        ? body.error.message.join("; ")
        : (body.error?.message ??
            body.message ??
            "Unable to save spare settings."),
    );
  return body.data as T;
}
export function SparesCatalogue({ platform = false, refreshKey = 0 }: { platform?: boolean; refreshKey?: number }) {
  const root = platform ? "platform/spares" : "client/spares";
  const [items, setItems] = useState<Spare[]>([]),
    [epoch, setEpoch] = useState(0),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(false);
  const [bulk, setBulk] = useState(false);
  const [imports, setImports] = useState<ClientImportHistoryEntry[]>([]);
  const [importsLoading, setImportsLoading] = useState(false);
  const [editing, setEditing] = useState<Spare | null>(null),
    [showForm, setShowForm] = useState(false),
    [form, setForm] = useState<Form>(empty),
    [history, setHistory] = useState<{
      name: string;
      items: Revision[];
    } | null>(null),
    [updates, setUpdates] = useState<Update[] | null>(null),
    [selected, setSelected] = useState<string[]>([]),
    [updateReason, setUpdateReason] = useState(""),
    [vehicleTypes, setVehicleTypes] = useState<{ id: string; name: string }[]>(
      [],
    );
  useEffect(() => {
    let active = true;
    const path = platform
      ? "platform/vehicle-types"
      : "client/fleet-readiness/context";
    void api<unknown>(path)
      .then((data) => {
        if (!active) return;
        const values = Array.isArray(data)
          ? data
          : ((data as { vehicleTypes?: unknown[] }).vehicleTypes ?? []);
        setVehicleTypes(values as { id: string; name: string }[]);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [platform]);
  useEffect(() => {
    let active = true;
    void Promise.resolve()
      .then(async () => {
        if (active) { setLoading(true); setError(""); }
        // Load every API page before using the shared table's local filters/pagination.
        const rows: Spare[] = [];
        let page = 1;
        while (active) {
          const data = await api<{ items: Spare[]; total: number }>(`${root}?page=${page}&limit=100`);
          rows.push(...data.items);
          if (!data.items.length || rows.length >= data.total) break;
          page++;
        }
        if (active) setItems(rows);
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [root, epoch, refreshKey]);
  useEffect(() => {
    if (!bulk) return;
    let active = true;
    void Promise.resolve().then(async () => {
      if (active) setImportsLoading(true);
      const data = await api<ClientImportHistoryEntry[]>(`${root}/imports`);
      if (active) setImports(data);
    }).catch((cause) => {
      if (active) setError(cause instanceof Error ? cause.message : "Unable to load import history.");
    }).finally(() => { if (active) setImportsLoading(false); });
    return () => { active = false; };
  }, [bulk, root, epoch]);
  async function run(task: () => Promise<void>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await task();
      setEpoch((e) => e + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to complete action.");
    } finally {
      setBusy(false);
    }
  }
  function open(row?: Spare) {
    setEditing(row ?? null);
    setForm(
      row
        ? {
            code: row.code,
            name: row.name,
            baseRate: row.baseRate ?? "",
            gstPercent: row.gstPercent ?? "",
            hsnCode: row.hsnCode ?? "",
            unit: row.unit,
            isActive: row.isActive,
            penaltyAmount: row.penaltyAmount ?? "",
            evidenceRequired: row.evidenceRequired !== false,
            reason: "",
            vehicleTypeIds: row.vehicleTypeIds,
          }
        : { ...empty(), isActive: platform },
    );
    setError("");
    setShowForm(true);
  }
  const referenceEditable = platform || !editing || editing.origin === "CLIENT";
  const nonSpare = editing?.origin === "NON_SPARE";
  async function save(event: FormEvent) {
    event.preventDefault();
    await run(async () => {
      const metadata = {
        name: form.name,
        baseRate: form.baseRate,
        gstPercent: form.gstPercent,
        hsnCode: form.hsnCode,
        unit: form.unit,
        vehicleTypeIds: form.vehicleTypeIds,
      };
      const settings = {
        isActive: form.isActive,
        ...(!platform
          ? {
              penaltyAmount: form.penaltyAmount.trim() || null,
              evidenceRequired: form.evidenceRequired,
            }
          : {}),
      };
      const body = editing
        ? {
            expectedVersion: platform
              ? editing.version
              : editing.configurationVersion,
            reason: form.reason,
            ...settings,
            ...(referenceEditable && !nonSpare ? metadata : {}),
          }
        : { code: form.code, ...metadata, ...settings };
      await api(
        `${root}${editing ? `/${editing.id}` : ""}`,
        editing ? "PATCH" : "POST",
        body,
      );
      setShowForm(false);
      setNotice(
        editing
          ? "Spare settings updated. Existing rider charges retain their original amounts."
          : "Spare created.",
      );
    });
  }
  const change = (key: keyof Form, value: Form[keyof Form]) =>
    setForm((f) => ({ ...f, [key]: value }));
  const columns: ClientColumn<Spare>[] = [
    { key: "code", label: "Part code", value: (row) => row.code },
    { key: "name", label: "Name", value: (row) => row.name, render: (row) => <>{row.name}{row.masterUpdateAvailable && <small> · Master update available</small>}{row.masterInactive && <small> · Master inactive</small>}</> },
    { key: "baseRate", label: "Rate", value: (row) => row.baseRate === null ? "—" : Number(row.baseRate) },
    { key: "gstPercent", label: "GST %", value: (row) => row.gstPercent === null ? "—" : Number(row.gstPercent) },
    { key: "hsnCode", label: "HSN", value: (row) => row.hsnCode ?? "—" },
    { key: "unit", label: "Unit", value: (row) => row.unit },
    ...(!platform ? [
      { key: "penaltyAmount", label: "Unit penalty", value: (row: Spare) => row.penaltyAmount == null ? "Not configured" : Number(row.penaltyAmount) },
      { key: "evidenceRequired", label: "Evidence", value: (row: Spare) => row.evidenceRequired ? "Required" : "Optional" },
      { key: "origin", label: "Origin", value: (row: Spare) => row.origin === "MASTER" ? "Master copy" : row.origin === "CLIENT" ? "Client-created" : "Other penalty" },
    ] : []),
    { key: "isActive", label: "Status", value: (row) => !platform && !row.penaltyConfigured ? "Not configured" : row.isActive ? platform ? "Active" : "Enabled" : platform ? "Inactive" : "Disabled" },
  ];
  if (bulk) return <section className="client-manager-actions">
    {error && <p className="error" role="alert">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    <ClientBulkImportWorkspace
      title={platform ? "Spares Master" : "Spares & Penalties"}
      eyebrow={platform ? "SUPER ADMIN IMPORT" : "CLIENT OPERATIONS IMPORT"}
      requiredColumns={spareRequiredColumns.join(", ")}
      template={`${spareColumns(platform).join(",")}\n`}
      history={imports} historyLoading={importsLoading} busy={busy}
      onBack={() => { if (!busy) setBulk(false); }}
      onUpload={(file) => run(async () => {
        if (!/\.csv$/i.test(file.name)) throw new Error("Choose a CSV file.");
        if (file.size > 5 * 1024 * 1024) throw new Error("CSV must be 5 MB or smaller.");
        const rows = parseSpareImport(await file.text(), platform);
        const result = await api<{ passedRows: number; failedRows: number }>(`${root}/bulk`, "POST", { filename: file.name, rows });
        setNotice(`Bulk upload complete: ${result.passedRows} passed, ${result.failedRows} failed.`);
      })}
      onDownloadFailures={(id) => run(async () => {
        const failures = await api<SpareImportFailure[]>(`${root}/imports/${id}/failures`);
        const url = URL.createObjectURL(new Blob([spareFailuresCsv(failures, platform)], { type: "text/csv;charset=utf-8" }));
        const link = document.createElement("a");
        link.href = url; link.download = "spares-failed-records.csv"; link.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      })}
      help={<p className="sa-bulk-help">Maximum 100 spares per upload. Adds new codes only; duplicates are reported without overwriting settings. Use true/false for flags and semicolon-separated vehicle type IDs. {!platform && "Uploads create client-owned spares; use Import missing master spares to copy the master catalogue."}</p>}
    />
  </section>;
  return (
    <section className={platform ? "sa-catalogue" : "client-manager-actions"}>
      <section className={platform ? "sa-page-head" : "sa-page-head client-page-head"}>
        <div className="sa-actions">
        <button className="secondary" disabled={busy || loading} onClick={() => { setError(""); setNotice(""); setBulk(true); }}>Bulk upload</button>
        {!platform && (
          <>
            <button
              className="secondary"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const result = await api<{
                    imported: number;
                    conflicts: { code: string }[];
                  }>(`${root}/import-missing`, "POST");
                  setNotice(
                    `Imported ${result.imported} spare(s).${result.conflicts.length ? ` Codes requiring review: ${result.conflicts.map((c) => c.code).join(", ")}. Client-created spares were preserved.` : ""}`,
                  );
                })
              }
            >
              Import missing master spares
            </button>
            <button
              className="secondary"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  setUpdates(await api<Update[]>(`${root}/master-updates`));
                  setSelected([]);
                  setUpdateReason("");
                })
              }
            >
              Review master updates
            </button>
          </>
        )}
        <button disabled={busy} onClick={() => open()}>
          + Add spare
        </button>
        </div>
      </section>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {loading && <p role="status">Loading spares…</p>}
      {platform ? <section className="sa-management oem-table-only">
        <PlatformDataTable
          headings={["Part code", "Name", "Rate", "GST %", "HSN", "Unit", "Status", "", ""]}
          columnFilters={[
            { type: "text" }, { type: "text" }, { type: "number" }, { type: "number" },
            { type: "text" }, { type: "select" }, { type: "select", options: ["ACTIVE", "INACTIVE"] }, null, null,
          ]}
          rows={items.map((row) => [
            row.code, row.name, row.baseRate === null ? "—" : Number(row.baseRate),
            row.gstPercent === null ? "—" : Number(row.gstPercent), row.hsnCode ?? "—", row.unit,
            row.isActive ? "ACTIVE" : "INACTIVE",
            <button key="edit" className="secondary" disabled={busy} onClick={() => open(row)}>Edit</button>,
            <button key="history" className="secondary" disabled={busy} onClick={() => void run(async () => setHistory({ name: row.name, items: await api<Revision[]>(`${root}/${row.id}/history`) }))}>History</button>,
          ])}
        />
      </section> : <ClientDataTable rows={items} columns={columns} getRowId={(row) => row.id}
        emptyMessage="No spares found. Add a spare or import available master items."
        actions={(row) => <>
          <button className="secondary table-action" disabled={busy} onClick={() => open(row)}>Edit</button>
          <button className="secondary table-action" disabled={busy} onClick={() => void run(async () => setHistory({ name: row.name, items: await api<Revision[]>(`${root}/${row.id}/history`) }))}>History</button>
        </>}
      />}
      {showForm && (
        <ClientFormDialog
          surfaceClassName="spares-dialog-surface"
          title={editing ? "Edit spare" : "Add spare"}
          error={error}
          busy={busy}
          wide
          onClose={() => setShowForm(false)}
          heading={<>{editing ? "Edit spare / penalty" : "Add spare"}</>}>
          <form onSubmit={save}>

            <div className="form-grid">
              <label>
                Part code
                <input
                  required
                  maxLength={60}
                  disabled={!!editing}
                  pattern="[A-Z][A-Z0-9_-]{1,59}"
                  value={form.code}
                  onChange={(e) => change("code", e.target.value.toUpperCase())}
                />
              </label>
              <label>
                Name
                <input
                  required
                  maxLength={180}
                  readOnly={!referenceEditable || nonSpare}
                  value={form.name}
                  onChange={(e) => change("name", e.target.value)}
                />
              </label>
              {!nonSpare && (
                <>
                  <label>
                    Base rate before GST
                    <input
                      required
                      type="number"
                      min="0"
                      step="0.01"
                      readOnly={!referenceEditable}
                      value={form.baseRate}
                      onChange={(e) => change("baseRate", e.target.value)}
                    />
                  </label>
                  <label>
                    GST percentage
                    <input
                      required
                      type="number"
                      min="0"
                      max="100"
                      step="0.01"
                      readOnly={!referenceEditable}
                      value={form.gstPercent}
                      onChange={(e) => change("gstPercent", e.target.value)}
                    />
                  </label>
                  <label>
                    HSN code
                    <input
                      required
                      pattern="[0-9]{4,8}"
                      maxLength={8}
                      readOnly={!referenceEditable}
                      value={form.hsnCode}
                      onChange={(e) => change("hsnCode", e.target.value)}
                    />
                  </label>
                  <label>
                    Unit
                    <input
                      required
                      maxLength={30}
                      readOnly={!referenceEditable}
                      value={form.unit}
                      onChange={(e) => change("unit", e.target.value)}
                    />
                  </label>
                  <label>
                    Applicable vehicle types (empty means all)
                    <select
                      multiple
                      disabled={!referenceEditable}
                      value={form.vehicleTypeIds}
                      onChange={(e) =>
                        change(
                          "vehicleTypeIds",
                          Array.from(e.target.selectedOptions, (o) => o.value),
                        )
                      }
                    >
                      {vehicleTypes.map((v) => (
                        <option key={v.id} value={v.id}>
                          {v.name}
                        </option>
                      ))}
                    </select>
                  </label>
                </>
              )}
              {!platform && (
                <>
                  <label>
                    Final penalty per unit (blank = not configured)
                    <input
                      type="number"
                      min="0.01"
                      step="0.01"
                      value={form.penaltyAmount}
                      onChange={(e) => change("penaltyAmount", e.target.value)}
                    />
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      checked={form.evidenceRequired}
                      onChange={(e) =>
                        change("evidenceRequired", e.target.checked)
                      }
                    />
                    Evidence required for this penalty
                  </label>
                </>
              )}
              <label>
                <input
                  type="checkbox"
                  checked={form.isActive}
                  onChange={(e) => change("isActive", e.target.checked)}
                />
                {platform
                  ? "Active in master catalogue"
                  : "Enabled for Fleet Managers"}
              </label>
              {editing && (
                <label>
                  Reason for change
                  <textarea
                    required
                    maxLength={500}
                    value={form.reason}
                    onChange={(e) => change("reason", e.target.value)}
                  />
                </label>
              )}
            </div>
            <div className="sa-dialog-actions">
              <button type="button" className="secondary" disabled={busy} onClick={() => setShowForm(false)}>Cancel</button>
              <button type="submit" disabled={busy}>{busy ? "Saving…" : "Save"}</button>
            </div>
          </form>
        </ClientFormDialog>
      )}
      {history && (
        <ClientFormDialog
          surfaceClassName="spares-dialog-surface"
          title="Spare history"
          wide
          onClose={() => setHistory(null)}
          heading={<>Spare history</>}>
          <header className="spares-dialog-header">
            <div>

              <p>{history.name}</p>
            </div>
            <button type="button" className="secondary" onClick={() => setHistory(null)}>Close</button>
          </header>
          {!history.items.length && <p className="muted">No recorded revisions yet.</p>}
          <div className="spares-revision-list">
          {history.items.map((r) => (
            <article className="spares-revision-card" key={r.id}>
              <div className="spares-revision-heading">
                <h3>Version {r.version}</h3>
                <time dateTime={r.createdAt}>{new Date(r.createdAt).toLocaleString()}</time>
              </div>
              <p className="spares-revision-reason">{r.reason}</p>
              <dl className="spares-revision-details">
                <div className="spares-revision-name"><dt>Part name</dt><dd>{r.snapshot.name ?? r.snapshot.description ?? "—"}</dd></div>
                <div><dt>Part code</dt><dd>{r.snapshot.code ?? "—"}</dd></div>
                <div><dt>Base rate</dt><dd>{r.snapshot.baseRate == null ? "—" : new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(Number(r.snapshot.baseRate))}</dd></div>
                <div><dt>GST</dt><dd>{r.snapshot.gstPercent == null ? "—" : `${r.snapshot.gstPercent}%`}</dd></div>
                <div><dt>HSN code</dt><dd>{r.snapshot.hsnCode ?? "—"}</dd></div>
                <div><dt>Unit</dt><dd>{r.snapshot.unit ?? "—"}</dd></div>
                <div><dt>Status</dt><dd>{r.snapshot.isActive ? "Active" : "Inactive"}</dd></div>
                {!platform && <>
                  <div><dt>Penalty per unit</dt><dd>{r.snapshot.penaltyConfigured && r.snapshot.amount != null ? new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(Number(r.snapshot.amount)) : "Not configured"}</dd></div>
                  <div><dt>Evidence</dt><dd>{r.snapshot.evidenceRequired ? "Required" : "Optional"}</dd></div>
                </>}
              </dl>
            </article>
          ))}
          </div>
        </ClientFormDialog>
      )}
      {updates && (
        <ClientFormDialog
          surfaceClassName="spares-dialog-surface"
          title="Review master updates"
          error={error}
          busy={busy}
          wide
          onClose={() => setUpdates(null)}
          heading={<>Review master updates</>}>

          <p>
            Applying updates preserves your penalty amount, evidence requirement
            and enabled status. Client-created spares are unaffected.
          </p>
          {!updates.length && <p>No master updates are pending.</p>}
          {updates.map((update) => (
            <fieldset key={update.priceId}>
              <legend>
                <label>
                  <input
                    type="checkbox"
                    checked={selected.includes(update.priceId)}
                    onChange={(e) =>
                      setSelected((current) =>
                        e.target.checked
                          ? [...current, update.priceId]
                          : current.filter((id) => id !== update.priceId),
                      )
                    }
                  />
                  {update.code} · master version {update.masterVersion}
                  {!update.masterActive ? " (inactive)" : ""}
                </label>
              </legend>
              {["name", "baseRate", "gstPercent", "hsnCode", "unit"].map(
                (key) => (
                  <p key={key}>
                    {
                      {
                        name: "Name",
                        baseRate: "Rate",
                        gstPercent: "GST %",
                        hsnCode: "HSN",
                        unit: "Unit",
                      }[key as "name"]
                    }
                    : {String(update.before[key] ?? "—")} →{" "}
                    {String(update.after[key] ?? "—")}
                  </p>
                ),
              )}
              <p>
                Applicable vehicle types:{" "}
                {((update.after.vehicleTypeIds ?? []) as string[])
                  .map(
                    (id) =>
                      vehicleTypes.find((v) => v.id === id)?.name ??
                      "Unknown type",
                  )
                  .join(", ") || "All"}
              </p>
            </fieldset>
          ))}
          <label>
            Reason
            <textarea
              value={updateReason}
              onChange={(e) => setUpdateReason(e.target.value)}
              maxLength={500}
            />
          </label>
          <button
            disabled={busy || !selected.length || !updateReason.trim()}
            onClick={() =>
              void run(async () => {
                const result = await api<{ updated: number }>(
                  `${root}/master-updates/apply`,
                  "POST",
                  {
                    reason: updateReason,
                    items: updates
                      .filter((u) => selected.includes(u.priceId))
                      .map(({ priceId, expectedVersion, masterVersion }) => ({
                        priceId,
                        expectedVersion,
                        masterVersion,
                      })),
                  },
                );
                setUpdates(null);
                setNotice(`Updated ${result.updated} spare(s).`);
              })
            }
          >
            Apply selected updates
          </button>
        </ClientFormDialog>
      )}
    </section>
  );
}
