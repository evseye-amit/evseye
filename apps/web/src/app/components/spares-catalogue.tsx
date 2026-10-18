"use client";
import { useEffect, useState, type FormEvent } from "react";
import { sessionFetch } from "../../lib/session-fetch";
import { ClientFormDialog } from "./client-form-dialog";
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
export function SparesCatalogue({ platform = false }: { platform?: boolean }) {
  const root = platform ? "platform/spares" : "client/spares";
  const [items, setItems] = useState<Spare[]>([]),
    [total, setTotal] = useState(0),
    [page, setPage] = useState(1),
    [search, setSearch] = useState(""),
    [status, setStatus] = useState("ALL"),
    [origin, setOrigin] = useState("ALL"),
    [epoch, setEpoch] = useState(0),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(false);
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
    const params = new URLSearchParams({
      page: String(page),
      limit: "25",
      status,
      ...(!platform ? { origin } : {}),
      ...(search ? { search } : {}),
    });
    void Promise.resolve()
      .then(() => {
        if (active) setLoading(true);
        return api<{ items: Spare[]; total: number }>(`${root}?${params}`);
      })
      .then((data) => {
        if (active) {
          setItems(data.items);
          setTotal(data.total);
        }
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
  }, [root, page, search, status, origin, epoch, platform]);
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
  return (
    <section className="table-card">
      <div className="form-actions">
        <h2>{platform ? "Spares Master" : "Spares & Penalties"}</h2>
        <button disabled={busy} onClick={() => open()}>
          Add spare
        </button>
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
      </div>
      <p>
        {platform
          ? "Reference catalogue copied to new clients. Each client configures its own penalties."
          : "Fleet Managers can select only enabled, configured penalties. Spare rate and GST are reference information; the configured penalty is the final unit charge."}
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      <div className="form-grid">
        <label>
          Search name, code or HSN
          <input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
        </label>
        <label>
          Status
          <select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
          >
            <option value="ALL">All</option>
            <option value="ACTIVE">{platform ? "Active" : "Enabled"}</option>
            <option value="INACTIVE">
              {platform ? "Inactive" : "Disabled"}
            </option>
            {!platform && <option value="UNCONFIGURED">Not configured</option>}
          </select>
        </label>
        {!platform && (
          <label>
            Origin
            <select
              value={origin}
              onChange={(e) => {
                setOrigin(e.target.value);
                setPage(1);
              }}
            >
              <option value="ALL">All</option>
              <option value="MASTER">Master copy</option>
              <option value="CLIENT">Client-created</option>
              <option value="NON_SPARE">Other penalties</option>
            </select>
          </label>
        )}
      </div>
      {loading && <p>Loading spares…</p>}
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Part code</th>
              <th>Name</th>
              <th>Rate</th>
              <th>GST %</th>
              <th>HSN</th>
              {!platform && (
                <>
                  <th>Unit penalty</th>
                  <th>Evidence</th>
                  <th>Origin</th>
                </>
              )}
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {items.map((row) => (
              <tr key={row.id}>
                <td>{row.code}</td>
                <td>
                  {row.name}
                  {row.masterUpdateAvailable && (
                    <small> · Master update available</small>
                  )}
                  {row.masterInactive && <small> · Master inactive</small>}
                </td>
                <td>{row.baseRate ?? "—"}</td>
                <td>{row.gstPercent ?? "—"}</td>
                <td>{row.hsnCode ?? "—"}</td>
                {!platform && (
                  <>
                    <td>{row.penaltyAmount ?? "Not configured"}</td>
                    <td>{row.evidenceRequired ? "Required" : "Optional"}</td>
                    <td>
                      {row.origin === "MASTER"
                        ? "Master copy"
                        : row.origin === "CLIENT"
                          ? "Client-created"
                          : "Other penalty"}
                    </td>
                  </>
                )}
                <td>
                  {row.isActive
                    ? platform
                      ? "Active"
                      : "Enabled"
                    : platform
                      ? "Inactive"
                      : "Disabled"}
                </td>
                <td>
                  <button
                    className="secondary table-action"
                    disabled={busy}
                    onClick={() => open(row)}
                  >
                    Edit
                  </button>
                  <button
                    className="secondary table-action"
                    disabled={busy}
                    onClick={() =>
                      void run(async () =>
                        setHistory({
                          name: row.name,
                          items: await api<Revision[]>(
                            `${root}/${row.id}/history`,
                          ),
                        }),
                      )
                    }
                  >
                    History
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!loading && !items.length && (
        <p>No spares found. Add a spare or import available master items.</p>
      )}
      <div className="form-actions">
        <button
          className="secondary"
          disabled={page === 1 || busy}
          onClick={() => setPage((p) => p - 1)}
        >
          Previous
        </button>
        <span>
          Page {page} · {total} items
        </span>
        <button
          className="secondary"
          disabled={page * 25 >= total || busy}
          onClick={() => setPage((p) => p + 1)}
        >
          Next
        </button>
      </div>
      {showForm && (
        <ClientFormDialog
          title={editing ? "Edit spare" : "Add spare"}
          error={error}
          busy={busy}
          wide
          onClose={() => setShowForm(false)}
        >
          <form onSubmit={save}>
            <div className="form-actions">
              <h2>{editing ? "Edit spare / penalty" : "Add spare"}</h2>
              <button
                type="button"
                className="secondary"
                disabled={busy}
                onClick={() => setShowForm(false)}
              >
                Close
              </button>
            </div>
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
            <button disabled={busy}>Save</button>
          </form>
        </ClientFormDialog>
      )}
      {history && (
        <ClientFormDialog
          title="Spare history"
          onClose={() => setHistory(null)}
        >
          <div className="form-actions">
            <h2>{history.name} · History</h2>
            <button className="secondary" onClick={() => setHistory(null)}>
              Close
            </button>
          </div>
          {!history.items.length && <p>No recorded revisions yet.</p>}
          {history.items.map((r) => (
            <article key={r.id}>
              <h3>
                Version {r.version} · {new Date(r.createdAt).toLocaleString()}
              </h3>
              <p>{r.reason}</p>
              <p>
                {r.snapshot.name ?? r.snapshot.description} · Rate:{" "}
                {r.snapshot.baseRate ?? "—"} · GST:{" "}
                {r.snapshot.gstPercent ?? "—"}% · HSN:{" "}
                {r.snapshot.hsnCode ?? "—"}
              </p>
              {!platform && (
                <p>
                  Penalty:{" "}
                  {r.snapshot.penaltyConfigured
                    ? r.snapshot.amount
                    : "Not configured"}{" "}
                  · Evidence:{" "}
                  {r.snapshot.evidenceRequired ? "Required" : "Optional"} ·{" "}
                  {r.snapshot.isActive ? "Enabled" : "Disabled"}
                </p>
              )}
            </article>
          ))}
        </ClientFormDialog>
      )}
      {updates && (
        <ClientFormDialog
          title="Review master updates"
          error={error}
          busy={busy}
          wide
          onClose={() => setUpdates(null)}
        >
          <div className="form-actions">
            <h2>Review master updates</h2>
            <button
              className="secondary"
              disabled={busy}
              onClick={() => setUpdates(null)}
            >
              Close
            </button>
          </div>
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
