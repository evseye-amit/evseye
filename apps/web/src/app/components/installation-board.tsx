"use client";
import { usePanelLoading } from "./panel-loading";
import { useEffect, useState } from "react";
import { sessionFetch } from "../../lib/session-fetch";
import { ClientDataTable } from "./client-data-table";
import { ClientFormDialog } from "./client-form-dialog";
export type InstallationDefinition = {
  code: string;
  name: string;
  component: "NONE" | "BATTERY" | "CONTROLLER" | "IOT";
  dependencies: string[];
  hubIds: string[];
  vehicleTypeIds: string[];
  verificationRequired: boolean;
  items: { code: string; label: string; required: boolean; allowNA: boolean }[];
  photoTypes: string[];
};
async function api<T>(
  path: string,
  method = "GET",
  data?: unknown,
): Promise<T> {
  const res = await sessionFetch(`/api/v1/client/${path}`, {
    method,
    ...(data === undefined
      ? {}
      : {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        }),
  });
  const body = await res.json();
  if (!res.ok)
    throw new Error(
      body.error?.message ?? "Unable to complete installation action.",
    );
  return body.data as T;
}
type Check = { result: "PASS" | "FAIL" | "NA"; notes: string };
type Row = {
  id: string;
  code: string;
  status: string;
  revision: number;
  assignedToId: string | null;
  definition: InstallationDefinition;
  preparation: {
    currentRevision: number;
    id: string;
    hub: { name: string };
    fleet: { fleetCode: string; vehicleNumber: string | null };
  };
};
type Detail = Row & {
  fleet: { fleetCode: string };
  reason: string | null;
  checklist: Record<string, Check>;
  events: Array<{ id: string; action: string; createdAt: string }>;
  history: Array<{
    revision: number;
    photoIds?: string[];
    decision?: string;
    reason?: string;
    submittedAt?: string;
  }>;
  requiredPhotoTypes: string[];
  photos: { id: string; photoType: string }[];
  timeline: { id: string; code: string; status: string }[];
  assignees: { id: string; name: string }[];
  permissions: {
    canWork: boolean;
    canReview: boolean;
    canManage: boolean;
    userId: string;
  };
  inventory: {
    batteries: { id: string; serialNumber: string }[];
    controllers: { id: string; controllerNumber: string }[];
    iotDevices: { id: string; deviceNumber: string }[];
  };
  components: {
    batteries: { id: string; serial: string }[];
    controllers: { id: string; serial: string }[];
    iot: { id: string; serial: string } | null;
  };
};
const label = (v: string) => v.replaceAll("_", " ");
export function InstallationBoard({ refreshKey = 0 }: { refreshKey?: number }) {
  const [rows, setRows] = useState<Row[]>([]),
    [total, setTotal] = useState(0),
    [page, setPage] = useState(1),
    [search, setSearch] = useState(""),
    [stage, setStage] = useState(""),
    [status, setStatus] = useState(""),
    [hub, setHub] = useState(""),
    [epoch, setEpoch] = useState(0),
    [summary, setSummary] = useState<{ status: string; _count: number }[]>([]);
  const [context, setContext] = useState<{
      hubs: { id: string; name: string }[];
    } | null>(null),
    [policy, setPolicy] = useState<{
      operatingMode: string;
      configuration: { stages: InstallationDefinition[] };
    } | null>(null),
    [candidates, setCandidates] = useState<{ id: string; fleetCode: string }[]>(
      [],
    ),
    [candidateTotal, setCandidateTotal] = useState(0),
    [candidatePage, setCandidatePage] = useState(1);
  const [detail, setDetail] = useState<Detail | null>(null),
    [checks, setChecks] = useState<Record<string, Check>>({}),
    [reason, setReason] = useState(""),
    [failed, setFailed] = useState<string[]>([]),
    [assignee, setAssignee] = useState(""),
    [batteryIds, setBatteryIds] = useState<string[]>([]),
    [controllerId, setControllerId] = useState(""),
    [iotDeviceId, setIotDeviceId] = useState("");
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(false),
    [preview, setPreview] = useState<string | null>(null);
  const [inventorySearch, setInventorySearch] = useState(""),
    [inventoryPage, setInventoryPage] = useState(1),
    [inventory, setInventory] = useState<{
      items: { id: string; label: string }[];
      total: number;
    }>({ items: [], total: 0 });
  const [hardwareLabels, setHardwareLabels] = useState<Record<string, string>>(
    {},
  );
  const [contextLoading, setContextLoading] = useState(false);
  usePanelLoading(loading || busy || contextLoading);
  const detailId = detail?.id;
  useEffect(() => {
    if (!detailId) return;
    let active = true;
    void api<typeof inventory>(
      `fleet-installations/${detailId}/inventory?${new URLSearchParams({ page: String(inventoryPage), limit: "20", search: inventorySearch })}`,
    )
      .then((r) => {
        if (active) {
          setInventory(r);
          setHardwareLabels((previous) => ({
            ...previous,
            ...Object.fromEntries(r.items.map((item) => [item.id, item.label])),
          }));
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [detailId, inventorySearch, inventoryPage, epoch]);
  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => { if (active) { setContextLoading(true); setError(""); } return Promise.all([
      api<NonNullable<typeof context>>("fleet-readiness/context"),
      api<NonNullable<typeof policy>>("fleet-readiness/policy"),
    ]); })
      .then(([c, p]) => {
        if (active) {
          setContext(c);
          setPolicy(p);
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      }).finally(() => { if (active) setContextLoading(false); });
    return () => {
      active = false;
    };
  }, [refreshKey]);
  useEffect(() => {
    let active = true;
    const q = new URLSearchParams({
      page: String(page),
      limit: "20",
      ...(search ? { search } : {}),
      ...(stage ? { stage } : {}),
      ...(status ? { status } : {}),
      ...(hub ? { hubId: hub } : {}),
    });
    void Promise.resolve()
      .then(() => {
        if (active) { setLoading(true); setError(""); }
        return api<{ items: Row[]; total: number; summary: typeof summary }>(
          `fleet-installations?${q}`,
        );
      })
      .then((r) => {
        if (active) {
          const lastPage = Math.max(1, Math.ceil(r.total / 20));
          if (page > lastPage) { setPage(lastPage); return; }
          setRows(r.items);
          setTotal(r.total);
          setSummary(r.summary);
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
  }, [page, search, stage, status, hub, epoch, refreshKey]);
  useEffect(() => {
    let active = true;
    const q = new URLSearchParams({
      page: String(candidatePage),
      limit: "20",
      ...(search ? { search } : {}),
      ...(hub ? { hubId: hub } : {}),
    });
    void api<{ items: typeof candidates; total: number }>(
      `fleet-preparations/candidates?${q}`,
    )
      .then((r) => {
        if (active) {
          const lastPage = Math.max(1, Math.ceil(r.total / 20));
          if (candidatePage > lastPage) { setCandidatePage(lastPage); return; }
          setCandidates(r.items);
          setCandidateTotal(r.total);
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [candidatePage, search, hub, epoch, refreshKey]);
  async function open(id: string) {
    const d = await api<Detail>(`fleet-installations/${id}`);
    setDetail(d);
    setHardwareLabels((previous) => ({
      ...previous,
      ...Object.fromEntries(
        [
          ...d.components.batteries,
          ...d.components.controllers,
          ...(d.components.iot ? [d.components.iot] : []),
        ].map((c) => [c.id, c.serial]),
      ),
    }));
    if (detail?.id !== id) {
      setInventorySearch("");
      setInventoryPage(1);
    }
    setChecks(d.checklist);
    setAssignee(d.assignedToId ?? "");
    setBatteryIds(d.components.batteries.map((b) => b.id));
    setControllerId(d.components.controllers[0]?.id ?? "");
    setIotDeviceId(d.components.iot?.id ?? "");
    setReason("");
    setFailed([]);
  }
  async function run(task: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await task();
      setEpoch((n) => n + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action failed");
    } finally {
      setBusy(false);
    }
  }
  async function action(name: string, extra: Record<string, unknown> = {}) {
    if (!detail) return;
    await run(async () => {
      await api(`fleet-installations/${detail.id}/${name}`, "POST", {
        revision: detail.revision,
        ...extra,
      });
      await open(detail.id);
    });
  }
  async function photo(id: string) {
    if (!detail) return;
    await run(async () => {
      const r = await api<{ url: string }>(
        `fleet-installations/${detail.id}/photos/${id}/download-url`,
      );
      setPreview(r.url);
    });
  }
  async function upload(slot: string, file: File) {
    if (!detail) return;
    await run(async () => {
      const r = await api<{ photo: { id: string }; uploadUrl: string }>(
        `fleet-installations/${detail.id}/upload-intents`,
        "POST",
        {
          revision: detail.revision,
          photoType: slot,
          mimeType: file.type,
          sizeBytes: file.size,
        },
      );
      const response = await fetch(r.uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": file.type },
        body: file,
      });
      if (!response.ok) throw new Error("Photo upload failed.");
      await api(
        `fleet-installations/${detail.id}/photos/${r.photo.id}/complete`,
        "POST",
        { revision: detail.revision },
      );
      await open(detail.id);
    });
  }
  const installedOptions = detail
    ? detail.definition.component === "BATTERY"
      ? detail.components.batteries
      : detail.definition.component === "CONTROLLER"
        ? detail.components.controllers
        : detail.components.iot
          ? [detail.components.iot]
          : []
    : [];
  const selectedHardware =
    detail?.definition.component === "BATTERY"
      ? batteryIds
      : detail?.definition.component === "CONTROLLER"
        ? [controllerId]
        : [iotDeviceId];
  const pinned = [
    ...new Map(
      [
        ...installedOptions.map((c) => ({ id: c.id, label: c.serial })),
        ...selectedHardware
          .filter((id) => id && hardwareLabels[id])
          .map((id) => ({ id, label: hardwareLabels[id] })),
      ].map((item) => [item.id, item]),
    ).values(),
  ];
  const inventoryOptions = [
    ...pinned,
    ...inventory.items.filter((i) => !pinned.some((c) => c.id === i.id)),
  ];
  function photoLabel(slot: string) {
    if (!detail) return label(slot);
    let text = slot;
    for (const component of [
      ...detail.components.batteries,
      ...detail.components.controllers,
      ...(detail.components.iot ? [detail.components.iot] : []),
    ])
      text = text.replace(component.id, component.serial);
    return label(text);
  }
  const editable =
    detail?.permissions.canWork &&
    detail.assignedToId === detail.permissions.userId &&
    detail.status === "IN_PROGRESS";
  return (
    <section className="table-card client-operational-list">

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {policy?.operatingMode !== "STAGED_PREPARATION_QC" && (
        <p>
          Dedicated Installation Board not available in your package.
        </p>
      )}
      <div className="client-review-counts">{summary.map((entry) => <span key={entry.status}><strong>{entry._count}</strong> {label(entry.status)}</span>)}</div>
      <ClientDataTable rows={rows} loading={loading} getRowId={(row) => row.id} emptyMessage="No installation work found."
        server={{ page, limit: 20, total, search, filterCount: [hub,stage,status].filter(Boolean).length, onReset: () => { setSearch(""); setHub(""); setStage(""); setStatus(""); setPage(1); setCandidatePage(1); }, onSearch: value => { setSearch(value); setPage(1); setCandidatePage(1); }, onPage: setPage }}
        columns={[
          { key: "scooter", label: "Scooter", value: (row) => row.preparation.fleet.vehicleNumber ?? row.preparation.fleet.fleetCode },
          { key: "hub", label: "Hub", serverFilter: (id) => (<select id={id} aria-label="Filter by Hub"
            value={hub}
            onChange={(e) => {
              setHub(e.target.value);
              setPage(1);
              setCandidatePage(1);
            }}
          >
            <option value="">All permitted hubs</option>
            {context?.hubs.map((h) => (
              <option key={h.id} value={h.id}>
                {h.name}
              </option>
            ))}
          </select>), value: (row) => row.preparation.hub.name },
          { key: "stage", label: "Stage", serverFilter: (id) => (<select id={id} aria-label="Filter by Stage"
            value={stage}
            onChange={(e) => {
              setStage(e.target.value);
              setPage(1);
            }}
          >
            <option value="">All stages</option>
            {policy?.configuration.stages.map((s) => (
              <option key={s.code} value={s.code}>
                {s.name}
              </option>
            ))}
          </select>), value: (row) => row.definition.name },
          { key: "status", label: "Status", serverFilter: (id) => (<select id={id} aria-label="Filter by Status"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
          >
            <option value="">All statuses</option>
            {[
              "WAITING",
              "READY",
              "IN_PROGRESS",
              "SUBMITTED",
              "COMPLETED",
              "REWORK_REQUIRED",
            ].map((s) => (
              <option key={s} value={s}>{label(s)}</option>
            ))}
          </select>), value: (row) => label(row.status), render: (row) => <span className={`status status-${row.status.toLowerCase()}`}>{label(row.status)}</span> },
        ]} actions={(row) => <button type="button" className="secondary table-action" disabled={busy || loading} onClick={() => void run(() => open(row.id))}>Open</button>} />
      {policy?.operatingMode === "STAGED_PREPARATION_QC" && (
        <>
          <h3>Scooters awaiting preparation</h3>
          <ClientDataTable rows={candidates} searchable={false} loading={loading} getRowId={(fleet) => fleet.id} emptyMessage="No scooters awaiting preparation." server={{ page: candidatePage, limit: 20, total: candidateTotal, search, onSearch: setSearch, onPage: setCandidatePage }} columns={[
            { key: "fleetCode", label: "Scooter", value: (fleet) => fleet.fleetCode },
          ]} actions={(fleet) => <button type="button" className="secondary table-action" disabled={busy || loading} onClick={() => void run(async () => { const preparation = await api<{ id: string }>(`fleets/${fleet.id}/preparations`, "POST"); const stages = await api<{ items: Row[] }>(`fleet-installations?limit=100&search=${encodeURIComponent(fleet.fleetCode)}`); const first = stages.items.find((stage) => stage.preparation.id === preparation.id); if (first) await open(first.id); setEpoch((value) => value + 1); })}>Start preparation cycle</button>} />
        </>
      )}
      {detail && (
        <ClientFormDialog
          error={error}
          busy={busy}
          wide
          title={`${detail.fleet.fleetCode} · ${detail.definition.name}`}
          onClose={() => setDetail(null)}
          heading={<>
              {detail.fleet.fleetCode} · {detail.definition.name}
            </>}>

          <p>
            Revision {detail.revision} · {label(detail.status)}
          </p>
          <p>{detail.reason}</p>
          <h3>Preparation timeline</h3>
          {detail.timeline.map((s) => (
            <p key={s.id}>
              {s.code}: {label(s.status)}
            </p>
          ))}
          <h3>Installed hardware</h3>
          <p>
            {[
              ...detail.components.batteries.map((b) => `Battery ${b.serial}`),
              ...detail.components.controllers.map(
                (c) => `Controller ${c.serial}`,
              ),
              ...(detail.components.iot
                ? [`IoT ${detail.components.iot.serial}`]
                : []),
            ].join(" · ") || "No hardware installed"}
          </p>
          {detail.permissions.canWork &&
            ["WAITING", "READY", "IN_PROGRESS"].includes(detail.status) &&
            (!detail.assignedToId ||
              detail.assignedToId === detail.permissions.userId) && (
              <button disabled={busy} onClick={() => void action("claim")}>
                Claim / start stage
              </button>
            )}
          {detail.permissions.canManage &&
            ["WAITING", "READY", "IN_PROGRESS", "REWORK_REQUIRED"].includes(
              detail.status,
            ) && (
              <label>
                Assign staff
                <select
                  value={assignee}
                  onChange={(e) => setAssignee(e.target.value)}
                >
                  <option value="">Select staff</option>
                  {detail.assignees.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
                <button
                  disabled={busy || !assignee}
                  onClick={() => void action("assign", { userId: assignee })}
                >
                  Assign
                </button>
              </label>
            )}
          {detail.status === "REWORK_REQUIRED" &&
            detail.permissions.canWork &&
            detail.assignedToId === detail.permissions.userId && (
              <button disabled={busy} onClick={() => void action("rework")}>
                Start new revision
              </button>
            )}
          {editable && detail.definition.component !== "NONE" && (
            <fieldset>
              <legend>Install or confirm hardware</legend>
              <label>
                Search available hardware by serial
                <input
                  value={inventorySearch}
                  onChange={(e) => {
                    setInventorySearch(e.target.value);
                    setInventoryPage(1);
                  }}
                />
              </label>
              <div className="form-actions">
                <button
                  type="button"
                  disabled={inventoryPage === 1}
                  onClick={() => setInventoryPage((p) => p - 1)}
                >
                  Previous hardware
                </button>
                <span>
                  {inventory.total} matches · page {inventoryPage}
                </span>
                <button
                  type="button"
                  disabled={inventoryPage * 20 >= inventory.total}
                  onClick={() => setInventoryPage((p) => p + 1)}
                >
                  Next hardware
                </button>
              </div>
              {detail.definition.component === "BATTERY" && (
                <select
                  multiple
                  value={batteryIds}
                  onChange={(e) =>
                    setBatteryIds(
                      Array.from(e.target.selectedOptions, (o) => o.value),
                    )
                  }
                >
                  {inventoryOptions.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.label}
                    </option>
                  ))}
                </select>
              )}
              {detail.definition.component === "CONTROLLER" && (
                <select
                  value={controllerId}
                  onChange={(e) => setControllerId(e.target.value)}
                >
                  <option value="">Select controller</option>
                  {inventoryOptions.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.label}
                    </option>
                  ))}
                </select>
              )}
              {detail.definition.component === "IOT" && (
                <select
                  value={iotDeviceId}
                  onChange={(e) => setIotDeviceId(e.target.value)}
                >
                  <option value="">Select IoT device</option>
                  {inventoryOptions.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.label}
                    </option>
                  ))}
                </select>
              )}
              <p>
                Changing hardware resets this stage and its dependent stages.
                Confirm the new revision before uploading evidence.
              </p>
              <button
                disabled={busy}
                onClick={() =>
                  void action(
                    "components",
                    detail.definition.component === "BATTERY"
                      ? { batteryIds }
                      : detail.definition.component === "CONTROLLER"
                        ? { controllerId }
                        : { iotDeviceId },
                  )
                }
              >
                Save hardware
              </button>
            </fieldset>
          )}
          <h3>Checklist</h3>
          {detail.definition.items.map((item) => (
            <label key={item.code}>
              {item.label}
              <select
                disabled={!editable || busy}
                value={checks[item.code]?.result ?? ""}
                onChange={(e) =>
                  setChecks((c) => ({
                    ...c,
                    [item.code]: {
                      result: e.target.value as Check["result"],
                      notes: c[item.code]?.notes ?? "",
                    },
                  }))
                }
              >
                <option value="">Select result</option>
                <option value="PASS">Pass</option>
                <option value="FAIL">Fail</option>
                {item.allowNA && <option value="NA">Not applicable</option>}
              </select>
              <input
                placeholder="Notes / reason"
                disabled={!editable || busy}
                value={checks[item.code]?.notes ?? ""}
                onChange={(e) =>
                  setChecks((c) => ({
                    ...c,
                    [item.code]: {
                      result: c[item.code]?.result ?? "PASS",
                      notes: e.target.value,
                    },
                  }))
                }
              />
            </label>
          ))}
          {editable && (
            <button
              disabled={busy}
              onClick={() => void action("save", { checklist: checks })}
            >
              Save checklist
            </button>
          )}
          <h3>Photos</h3>
          {detail.requiredPhotoTypes.map((slot) => (
            <div key={slot}>
              <span>{photoLabel(slot)}</span>
              {detail.photos
                .filter((p) => p.photoType === slot)
                .map((p) => (
                  <button key={p.id} onClick={() => void photo(p.id)}>
                    View photo
                  </button>
                ))}
              {editable && (
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  disabled={busy}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void upload(slot, file);
                    e.target.value = "";
                  }}
                />
              )}
            </div>
          ))}
          {editable && (
            <button disabled={busy} onClick={() => void action("submit")}>
              Submit stage
            </button>
          )}
          {detail.status === "SUBMITTED" && detail.permissions.canReview && (
            <fieldset>
              <legend>Review installation</legend>
              <label>
                Rejection reason
                <textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              </label>
              {detail.definition.items.map((i) => (
                <label key={i.code}>
                  <input
                    type="checkbox"
                    checked={failed.includes(i.code)}
                    onChange={(e) =>
                      setFailed((f) =>
                        e.target.checked
                          ? [...f, i.code]
                          : f.filter((c) => c !== i.code),
                      )
                    }
                  />
                  {i.label}
                </label>
              ))}
              <button disabled={busy} onClick={() => void action("approve")}>
                Approve
              </button>
              <button
                className="danger"
                disabled={busy || !reason.trim() || !failed.length}
                onClick={() =>
                  void action("reject", { reason, failedItems: failed })
                }
              >
                Reject
              </button>
            </fieldset>
          )}
          {detail.permissions.canManage &&
            !["APPROVED", "INVALIDATED", "CANCELLED"].includes(
              (detail.preparation as { status?: string }).status ?? "",
            ) && (
              <fieldset>
                <legend>Cancel preparation cycle</legend>
                <label>
                  Mandatory reason
                  <textarea
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                  />
                </label>
                <button
                  className="danger"
                  disabled={busy || !reason.trim()}
                  onClick={() =>
                    void run(async () => {
                      await api(
                        `fleet-preparations/${detail.preparation.id}/cancel`,
                        "POST",
                        {
                          revision: detail.preparation.currentRevision,
                          reason,
                        },
                      );
                      setDetail(null);
                    })
                  }
                >
                  Cancel entire preparation
                </button>
              </fieldset>
            )}
          <h3>Activity</h3>
          {detail.events?.map((e) => (
            <p key={e.id}>
              {label(e.action)} · {new Date(e.createdAt).toLocaleString()}
            </p>
          ))}
          <h3>Revision history</h3>
          {detail.history.map((h, index) => (
            <article key={index}>
              <p>
                Revision {h.revision} · {h.decision ?? "Submitted"} ·{" "}
                {h.reason ?? h.submittedAt}
              </p>
              {h.photoIds?.map((id) => (
                <button
                  className="secondary"
                  key={id}
                  onClick={() => void photo(id)}
                >
                  View submitted photo
                </button>
              ))}
            </article>
          ))}
        </ClientFormDialog>
      )}
      {preview && (
        <ClientFormDialog
          title="Installation photo"
          wide
          onClose={() => setPreview(null)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- Private evidence uses short-lived signed URLs. */}
          <img
            src={preview}
            alt="Installation evidence"
            style={{
              maxWidth: "100%",
              maxHeight: "70vh",
              objectFit: "contain",
            }}
          />
          <div className="form-actions"><a className="button secondary" href={preview} target="_blank" rel="noreferrer" download>Download photo</a><button type="button" className="secondary" onClick={() => setPreview(null)}>Close preview</button></div>
        </ClientFormDialog>
      )}
    </section>
  );
}
export function InstallationStageSettings({
  value,
  templates,
  onChange,
  hubs,
  vehicleTypes,
}: {
  value: InstallationDefinition[];
  templates: InstallationDefinition[];
  onChange: (v: InstallationDefinition[]) => void;
  hubs: { id: string; name: string }[];
  vehicleTypes: { id: string; name: string }[];
}) {
  function update(index: number, patch: Partial<InstallationDefinition>) {
    onChange(value.map((s, i) => (i === index ? { ...s, ...patch } : s)));
  }
  return (
    <fieldset>
      <legend>Installation stages</legend>
      {!value.length && (
        <button
          type="button"
          onClick={() => onChange(structuredClone(templates))}
        >
          Use intake, battery and controller template
        </button>
      )}
      <p>
        All applicable stages must finish before RFD submits to QC. Empty hub or
        vehicle type selections apply to all.
      </p>
      {value.map((s, index) => (
        <fieldset key={index}>
          <legend>Stage {index + 1}</legend>
          <label>
            Code
            <input
              value={s.code}
              onChange={(e) =>
                update(index, {
                  code: e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, ""),
                })
              }
            />
          </label>
          <label>
            Name
            <input
              value={s.name}
              onChange={(e) => update(index, { name: e.target.value })}
            />
          </label>
          <label>
            Hardware
            <select
              value={s.component}
              onChange={(e) =>
                update(index, {
                  component: e.target
                    .value as InstallationDefinition["component"],
                })
              }
            >
              {["NONE", "BATTERY", "CONTROLLER", "IOT"].map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
          <label>
            Prerequisite stages
            <select
              multiple
              value={s.dependencies}
              onChange={(e) =>
                update(index, {
                  dependencies: Array.from(
                    e.target.selectedOptions,
                    (o) => o.value,
                  ),
                })
              }
            >
              {value
                .filter((_, i) => i !== index)
                .map((d) => (
                  <option key={d.code} value={d.code}>
                    {d.name || d.code}
                  </option>
                ))}
            </select>
          </label>
          <label>
            Applicable hubs
            <select
              multiple
              value={s.hubIds}
              onChange={(e) =>
                update(index, {
                  hubIds: Array.from(e.target.selectedOptions, (o) => o.value),
                })
              }
            >
              {hubs.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Vehicle types
            <select
              multiple
              value={s.vehicleTypeIds}
              onChange={(e) =>
                update(index, {
                  vehicleTypeIds: Array.from(
                    e.target.selectedOptions,
                    (o) => o.value,
                  ),
                })
              }
            >
              {vehicleTypes.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <input
              type="checkbox"
              checked={s.verificationRequired}
              onChange={(e) =>
                update(index, { verificationRequired: e.target.checked })
              }
            />
            Require independent stage verification
          </label>
          <h4>Checklist</h4>
          {s.items.map((item, i) => (
            <div key={i} className="form-grid">
              <label>
                Code
                <input
                  value={item.code}
                  onChange={(e) =>
                    update(index, {
                      items: s.items.map((v, j) =>
                        j === i
                          ? { ...v, code: e.target.value.toUpperCase() }
                          : v,
                      ),
                    })
                  }
                />
              </label>
              <label>
                Label
                <input
                  value={item.label}
                  onChange={(e) =>
                    update(index, {
                      items: s.items.map((v, j) =>
                        j === i ? { ...v, label: e.target.value } : v,
                      ),
                    })
                  }
                />
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={item.required}
                  onChange={(e) =>
                    update(index, {
                      items: s.items.map((v, j) =>
                        j === i ? { ...v, required: e.target.checked } : v,
                      ),
                    })
                  }
                />
                Required
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={item.allowNA}
                  onChange={(e) =>
                    update(index, {
                      items: s.items.map((v, j) =>
                        j === i ? { ...v, allowNA: e.target.checked } : v,
                      ),
                    })
                  }
                />
                Allow not applicable with reason
              </label>
              <button
                type="button"
                onClick={() =>
                  update(index, { items: s.items.filter((_, j) => j !== i) })
                }
              >
                Remove check
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() =>
              update(index, {
                items: [
                  ...s.items,
                  {
                    code: `CHECK_${s.items.length + 1}`,
                    label: "New check",
                    required: true,
                    allowNA: false,
                  },
                ],
              })
            }
          >
            Add check
          </button>
          <label>
            Photo slots (comma separated codes)
            <input
              value={s.photoTypes.join(",")}
              onChange={(e) =>
                update(index, {
                  photoTypes: e.target.value
                    .toUpperCase()
                    .split(",")
                    .map((v) => v.trim()),
                })
              }
            />
          </label>
          <button
            type="button"
            className="danger"
            onClick={() => onChange(value.filter((_, i) => i !== index))}
          >
            Remove stage
          </button>
        </fieldset>
      ))}
      <button
        type="button"
        onClick={() =>
          onChange([
            ...value,
            {
              code: `STAGE_${value.length + 1}`,
              name: "New stage",
              component: "NONE",
              dependencies: [],
              hubIds: [],
              vehicleTypeIds: [],
              verificationRequired: false,
              items: [
                {
                  code: "CONFIRMED",
                  label: "Work confirmed",
                  required: true,
                  allowNA: false,
                },
              ],
              photoTypes: ["EVIDENCE"],
            },
          ])
        }
      >
        Add installation stage
      </button>
    </fieldset>
  );
}
