"use client";
import { usePanelLoading } from "./panel-loading";
import { useEffect, useState, type FormEvent } from "react";
import { sessionFetch } from "../../lib/session-fetch";
import { ClientDataTable } from "./client-data-table";
import { ClientFormDialog } from "./client-form-dialog";

import {
  InstallationStageSettings,
  type InstallationDefinition,
} from "./installation-board";
type Mode =
  "SIMPLE" | "ONBOARDING_EVIDENCE" | "PREPARATION_QC" | "STAGED_PREPARATION_QC";
type Check = { result: "PASS" | "FAIL" | "NA"; notes: string };
type Configuration = {
  stages: InstallationDefinition[];
  independentReview: boolean;
  minBatteryCount: number;
  requireController: boolean;
  iotRequired: boolean;
  items: Array<{
    code: string;
    label: string;
    required: boolean;
    allowNA: boolean;
  }>;
  photoTypes: string[];
};
type Policy = {
  installationStageTemplates?: InstallationDefinition[];
  operatingMode: Mode;
  version: number;
  configuration: Configuration;
};
type Hub = { id: string; name: string };
type User = {
  id: string;
  name: string;
  mobile: string;
  role: string;
  isActive: boolean;
};
type Assignment = {
  hubId: string;
  userId: string;
  canPrepare: boolean;
  canReview: boolean;
  stageCodes?: string[];
  reviewStageCodes?: string[];
};
type Context = {
  hubs: Hub[];
  vehicleTypes: Hub[];
  prepareHubIds: string[];
  reviewHubIds: string[];
  preparers: Array<{ id: string; name: string; hubIds: string[] }>;
  canManage: boolean;
  isAdmin: boolean;
  userId: string;
};
type Scooter = {
  id: string;
  fleetCode: string;
  vehicleNumber: string | null;
  chassisNumber: string;
  status: string;
  currentHubId: string;
  currentHub?: Hub;
};
type Row = {
  id: string;
  fleetId: string;
  hubId: string;
  status: string;
  assignedToId: string | null;
  currentRevision: number;
  updatedAt: string;
  fleet: Scooter;
  hub?: Hub;
  assignee?: { name: string };
};
type Revision = {
  id: string;
  revision: number;
  checklist: Record<string, Check> | { odometerKm: number };
  rejectionReason: string | null;
  decision: string | null;
  failedItems: string[];
  submittedAt: string | null;
  reviewedAt: string | null;
};
type Photo = { id: string; entityId: string; photoType: string };
type Detail = Row & {
  stages: Array<{
    id: string;
    code: string;
    status: string;
    definition: InstallationDefinition;
  }>;
  current: Revision;
  revisions: Revision[];
  configuration: Configuration;
  requiredPhotoTypes: string[];
  photos: Photo[];
  components: {
    hubId: string;
    batteries: Array<{ id: string; serial: string; slot: string }>;
    controllers: Array<{ id: string; serial: string }>;
    iot: { id: string; serial: string } | null;
  };
  invalidationReason?: string;
  permissions: { canPrepare: boolean; canReview: boolean; canAssign: boolean };
  events: Array<{
    id: string;
    action: string;
    createdAt: string;
    data: unknown;
  }>;
};
type Page<T> = { items: T[]; total: number };
const label = (value: string) => value.replaceAll("_", " ");
const requiredChecks = [
  "IDENTITY",
  "COMPONENTS",
  "BODY",
  "TYRES",
  "BRAKES",
  "STEERING",
  "LIGHTS",
  "DASHBOARD",
  "WIRING",
  "BATTERY_MOUNTING",
  "CHARGING",
  "KEYS",
  "OPERATIONAL_TEST",
];
const editableStatuses = ["PENDING", "IN_PROGRESS", "REWORK_REQUIRED"];
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
      body.error?.message ?? "Unable to complete readiness action.",
    );
  return body.data as T;
}

export function FleetReadiness({
  view, refreshKey = 0,
}: {
  refreshKey?: number;
  view: "preparation" | "qc" | "settings" | "staff";
}) {
  const [context, setContext] = useState<Context | null>(null),
    [policy, setPolicy] = useState<Policy | null>(null);
  const [rows, setRows] = useState<Row[]>([]),
    [candidates, setCandidates] = useState<Scooter[]>([]),
    [total, setTotal] = useState(0),
    [page, setPage] = useState(1),
    [candidatePage, setCandidatePage] = useState(1),
    [candidateTotal, setCandidateTotal] = useState(0);
  const [search, setSearch] = useState(""),
    [hub, setHub] = useState(""),
    [status, setStatus] = useState(""),
    [owner, setOwner] = useState("");
  const [summary, setSummary] = useState<
      Array<{ status: string; _count: { _all: number } }>
    >([]),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(false);
  const [detail, setDetail] = useState<Detail | null>(null),
    [checks, setChecks] = useState<Record<string, Check>>({}),
    [odometer, setOdometer] = useState(""),
    [reason, setReason] = useState(""),
    [failed, setFailed] = useState<string[]>([]),
    [assignee, setAssignee] = useState("");
  const [preview, setPreview] = useState<{ url: string; name: string } | null>(
      null,
    ),
    [staff, setStaff] = useState<{
      users: User[];
      hubs: Hub[];
      assignments: Assignment[];
    } | null>(null),
    [selectedUser, setSelectedUser] = useState(""),
    [grants, setGrants] = useState<Assignment[]>([]);
  const [newStaff, setNewStaff] = useState({
      name: "",
      mobile: "",
      role: "RFD_MANAGER",
    }),
    [policyReason, setPolicyReason] = useState(""),
    [impact, setImpact] = useState<Record<string, unknown> | null>(null),
    [extraCode, setExtraCode] = useState(""),
    [extraLabel, setExtraLabel] = useState("");
  const [contextLoading, setContextLoading] = useState(false);
  const [staffLoading, setStaffLoading] = useState(false);
  usePanelLoading(loading || busy || contextLoading || staffLoading);
  const [epoch, setEpoch] = useState(0);
  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => { if (active) { setContextLoading(true); setError(""); } return Promise.all([
      api<Context>("fleet-readiness/context"),
      api<Policy>("fleet-readiness/policy"),
    ]); })
      .then(([c, p]) => {
        if (active) {
          setContext(c);
          setPolicy((current) => view === "settings" && current ? current : p);
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      }).finally(() => { if (active) setContextLoading(false); });
    return () => {
      active = false;
    };
  }, [view, refreshKey]);
  useEffect(() => {
    if (view !== "staff") return;
    let active = true;
    void Promise.resolve().then(() => { if (active) { setStaffLoading(true); setError(""); } return api<NonNullable<typeof staff>>("fleet-readiness/staff"); })
      .then((s) => {
        if (active) setStaff(s);
      })
      .catch((e) => {
        if (active) setError(e.message);
      }).finally(() => { if (active) setStaffLoading(false); });
    return () => {
      active = false;
    };
  }, [view, epoch, refreshKey]);
  useEffect(() => {
    if (!["preparation", "qc"].includes(view)) return;
    let active = true;
    const query = new URLSearchParams({
      page: String(page),
      limit: "20",
      ...(search ? { search } : {}),
      ...(hub ? { hubId: hub } : {}),
      ...(status ? { status } : {}),
      ...(owner ? { assignedToId: owner } : {}),
    });
    void Promise.resolve()
      .then(() => {
        if (active) {
          setLoading(true);
          setError("");
        }
        return Promise.all([
          api<Page<Row>>(
            `${view === "qc" ? "fleet-qc" : "fleet-preparations"}?${query}`,
          ),
          api<typeof summary>("fleet-preparations/summary"),
          view === "preparation"
            ? api<Page<Scooter>>(
                `fleet-preparations/candidates?${new URLSearchParams({ page: String(candidatePage), limit: "20", ...(search ? { search } : {}), ...(hub ? { hubId: hub } : {}) })}`,
              )
            : Promise.resolve({ items: [], total: 0 }),
        ]);
      })
      .then(([r, s, c]) => {
        if (active) {
          const lastPage = Math.max(1, Math.ceil(r.total / 20));
          const lastCandidatePage = Math.max(1, Math.ceil(c.total / 20));
          if (page > lastPage || candidatePage > lastCandidatePage) {
            setPage(Math.min(page, lastPage));
            setCandidatePage(Math.min(candidatePage, lastCandidatePage));
            return;
          }
          setRows(r.items);
          setTotal(r.total);
          setSummary(s);
          setCandidates(c.items);
          setCandidateTotal(c.total);
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
  }, [view, page, candidatePage, search, hub, status, owner, epoch, refreshKey]);
  const loadDetail = async (id: string) => {
    const d = await api<Detail>(`fleet-preparations/${id}`);
    setDetail(d);
    setChecks(
      Object.fromEntries(
        Object.entries(d.current.checklist).filter(
          ([key]) => key !== "odometerKm",
        ),
      ) as Record<string, Check>,
    );
    setOdometer(
      String((d.current.checklist as { odometerKm?: number }).odometerKm ?? ""),
    );
    setReason("");
    setFailed([]);
    setAssignee(d.assignedToId ?? "");
    setRows((current) =>
      current.map((row) =>
        row.id === id
          ? {
              ...row,
              ...d,
              assignee: d.assignedToId
                ? (context?.preparers.find((p) => p.id === d.assignedToId) ??
                  row.assignee)
                : undefined,
            }
          : row,
      ),
    );
    if (detail?.id === id && detail.status !== d.status) {
      setSummary((current) => {
        const counts = new Map(
          current.map((row) => [row.status, row._count._all]),
        );
        counts.set(
          detail.status,
          Math.max(0, (counts.get(detail.status) ?? 0) - 1),
        );
        counts.set(d.status, (counts.get(d.status) ?? 0) + 1);
        return [...counts].map(([status, count]) => ({
          status,
          _count: { _all: count },
        }));
      });
    }
    return d;
  };
  const run = async (action: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to complete action.");
    } finally {
      setBusy(false);
    }
  };
  const mutate = async (path: string, body: unknown, method = "POST") =>
    run(async () => {
      await api(path, method, body);
      if (detail) await loadDetail(detail.id);
      setNotice("Saved successfully.");
    });
  async function upload(slot: string, file: File) {
    if (!detail) return;
    await run(async () => {
      const mime = file.type as "image/jpeg" | "image/png" | "image/webp";
      const ext =
        mime === "image/jpeg" ? "jpg" : mime === "image/png" ? "png" : "webp";
      const intent = await api<{ photo: { id: string }; uploadUrl: string }>(
        `fleet-preparations/${detail.id}/upload-intents`,
        "POST",
        {
          revision: detail.currentRevision,
          photoType: slot,
          mimeType: mime,
          fileName: `evidence.${ext}`,
          sizeBytes: file.size,
        },
      );
      // Starting rework can create a new revision during upload-intent creation.
      const latest = await api<Detail>(`fleet-preparations/${detail.id}`);
      const sent = await fetch(intent.uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": mime },
        body: file,
      });
      if (!sent.ok) throw new Error("Image upload failed.");
      await api(
        `fleet-preparations/${detail.id}/photos/${intent.photo.id}/complete`,
        "POST",
        { revision: latest.currentRevision },
      );
      await loadDetail(detail.id);
      setNotice("Photo uploaded.");
    });
  }
  const slotLabel = (slot: string) => {
    let text = slot;
    for (const component of [
      ...(detail?.components.batteries ?? []),
      ...(detail?.components.controllers ?? []),
    ])
      text = text.replace(component.id, component.serial);
    return label(text);
  };
  const config = policy?.configuration;
  const setConfig = (patch: Partial<Configuration>) => {
    if (policy) {
      setPolicy({
        ...policy,
        configuration: { ...policy.configuration, ...patch },
      });
      setImpact(null);
    }
  };
  return (
    <section className="action-card readiness-workspace">
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
      {policy && (
        <p>
          <strong>Operating mode: {label(policy.operatingMode)}</strong> ·
          Allocation and submission photos remain mandatory.
        </p>
      )}
      {!["PREPARATION_QC", "STAGED_PREPARATION_QC"].includes(
        policy?.operatingMode ?? "",
      ) &&
        view === "preparation" && (
          <p>
            Preparation is optional for this operating mode. Client Admin can
            enable Preparation + QC in Fleet Readiness Settings.
          </p>
        )}
      {["preparation", "qc"].includes(view) && (
        <>
          <div className="metrics">
            {summary.map((s) => (
              <div className="metric" key={s.status}>
                <span>{label(s.status)}</span>
                <strong>{s._count._all}</strong>
              </div>
            ))}
          </div>
          <div className="client-filter-bar">
            <label>
              Search scooter
              <input
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                  setCandidatePage(1);
                }}
                placeholder="Registration, fleet code or chassis"
              />
            </label>
            <label>
              Hub
              <select
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
              </select>
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
                <option value="">
                  {view === "qc" ? "Awaiting QC" : "All statuses"}
                </option>
                {[
                  "PENDING",
                  "IN_PROGRESS",
                  "AWAITING_QC",
                  "REWORK_REQUIRED",
                  "APPROVED",
                  "INVALIDATED",
                  "CANCELLED",
                ].map((s) => (
                  <option key={s} value={s}>{label(s)}</option>
                ))}
              </select>
            </label>
            <label>
              <input
                type="checkbox"
                checked={!!owner}
                onChange={(e) => {
                  setOwner(e.target.checked ? (context?.userId ?? "") : "");
                  setPage(1);
                }}
              />
              Assigned to me
            </label>
            <button
              type="button"
              className="secondary"
              disabled={loading || busy}
              onClick={() => setEpoch((n) => n + 1)}
            >
              Refresh
            </button>
          </div>
          <ClientDataTable rows={rows} loading={loading} searchable={false} getRowId={(row) => row.id} emptyMessage="No preparations in this view."
            server={{ page, limit: 20, total, search, onSearch: setSearch, onPage: setPage }}
            columns={[
              { key: "scooter", label: "Scooter", value: (row) => row.fleet?.vehicleNumber || row.fleet?.fleetCode, render: (row) => <span className="client-record-title"><strong>{row.fleet?.vehicleNumber || row.fleet?.fleetCode}</strong><small>{row.fleet?.chassisNumber}</small></span> },
              { key: "hub", label: "Hub", value: (row) => row.hub?.name ?? "—" },
              { key: "assignee", label: "Assigned to", value: (row) => row.assignee?.name ?? "Unassigned" },
              { key: "status", label: "Status", value: (row) => label(row.status), render: (row) => <span className={`status status-${row.status.toLowerCase()}`}>{label(row.status)}</span> },
              { key: "revision", label: "Revision", value: (row) => row.currentRevision },
              { key: "updated", label: "Updated", value: (row) => row.updatedAt, render: (row) => new Date(row.updatedAt).toLocaleString() },
            ]} actions={(row) => <button type="button" disabled={busy || loading} className="secondary table-action" onClick={() => void run(async () => { await loadDetail(row.id); })}>Open</button>} />
          {view === "preparation" && (
            <>
              <h3>Scooters awaiting preparation</h3>
              <p>Use search and hub filters to browse scooters.</p>
              <ClientDataTable rows={candidates} loading={loading} searchable={false} getRowId={(fleet) => fleet.id} emptyMessage="No scooters awaiting preparation."
                server={{ page: candidatePage, limit: 20, total: candidateTotal, search, onSearch: setSearch, onPage: setCandidatePage }}
                columns={[
                  { key: "scooter", label: "Scooter", value: (fleet) => fleet.vehicleNumber || fleet.fleetCode, render: (fleet) => <span className="client-record-title"><strong>{fleet.vehicleNumber || fleet.fleetCode}</strong><small>{fleet.chassisNumber}</small></span> },
                  { key: "hub", label: "Hub", value: (fleet) => fleet.currentHub?.name ?? "—" },
                  { key: "status", label: "Status", value: (fleet) => label(fleet.status), render: (fleet) => <span className={`status status-${fleet.status.toLowerCase()}`}>{label(fleet.status)}</span> },
                ]} actions={(fleet) => <button type="button" className="secondary table-action" disabled={busy || loading || !["PREPARATION_QC", "STAGED_PREPARATION_QC"].includes(policy?.operatingMode ?? "") || !context?.prepareHubIds.includes(fleet.currentHubId)} onClick={() => void run(async () => { const preparation = await api<{ id: string }>(`fleets/${fleet.id}/preparations`, "POST"); await loadDetail(preparation.id); setEpoch((n) => n + 1); })}>Start preparation</button>} />
            </>
          )}
        </>
      )}
      {view === "settings" && policy && config && context?.isAdmin && (
        <form
          onSubmit={(event: FormEvent) => {
            event.preventDefault();
            void run(async () => {
              const p = await api<Policy>("fleet-readiness/policy", "PUT", {
                ...policy,
                expectedVersion: policy.version,
                version: undefined,
                reason: policyReason,
              });
              setPolicy(p);
              setPolicyReason("");
              setImpact(null);
              setNotice(
                "Readiness policy saved. Existing preparation cycles retain their checklist version.",
              );
            });
          }}
        >
          <h3>Fleet readiness policy · version {policy.version}</h3>
          <label>
            Operating mode
            <select
              value={policy.operatingMode}
              onChange={(e) => {
                setPolicy({ ...policy, operatingMode: e.target.value as Mode });
                setImpact(null);
              }}
            >
              <option value="SIMPLE">Simple</option>
              <option value="PREPARATION_QC">Preparation + QC</option>
              <option value="STAGED_PREPARATION_QC">
                Staged Preparation + QC
              </option>
              <option value="ONBOARDING_EVIDENCE">Onboarding evidence</option>
            </select>
          </label>
          <InstallationStageSettings
            templates={policy.installationStageTemplates ?? []}
            value={config.stages ?? []}
            onChange={(stages) => {
              setConfig({ stages });
              setImpact(null);
            }}
            hubs={context?.hubs ?? []}
            vehicleTypes={context?.vehicleTypes ?? []}
          />
          <label>
            <input
              type="checkbox"
              checked={config.independentReview}
              onChange={(e) =>
                setConfig({ independentReview: e.target.checked })
              }
            />
            Require a different person for QC
          </label>
          <label>
            Minimum installed batteries
            <input
              type="number"
              min={1}
              max={8}
              value={config.minBatteryCount}
              onChange={(e) =>
                setConfig({ minBatteryCount: Number(e.target.value) })
              }
            />
          </label>
          <label>
            <input
              type="checkbox"
              checked={config.requireController}
              onChange={(e) =>
                setConfig({ requireController: e.target.checked })
              }
            />
            Controller required
          </label>
          <label>
            <input
              type="checkbox"
              checked={config.iotRequired}
              onChange={(e) => setConfig({ iotRequired: e.target.checked })}
            />
            IoT installation required
          </label>
          <h3>Preparation checklist</h3>
          {config.items.map((item) => (
            <div className="form-actions" key={item.code}>
              <span>
                {item.label} ({item.code})
              </span>
              <label>
                <input
                  type="checkbox"
                  checked={item.required}
                  disabled={requiredChecks.includes(item.code)}
                  onChange={(e) =>
                    setConfig({
                      items: config.items.map((i) =>
                        i.code === item.code
                          ? { ...i, required: e.target.checked }
                          : i,
                      ),
                    })
                  }
                />
                Required
              </label>
              {!item.required && (
                <label>
                  <input
                    type="checkbox"
                    checked={item.allowNA}
                    onChange={(e) =>
                      setConfig({
                        items: config.items.map((i) =>
                          i.code === item.code
                            ? { ...i, allowNA: e.target.checked }
                            : i,
                        ),
                      })
                    }
                  />
                  Allow not applicable with reason
                </label>
              )}
            </div>
          ))}
          <div className="form-actions">
            <input
              aria-label="New checklist code"
              placeholder="Additional check code"
              value={extraCode}
              onChange={(e) => setExtraCode(e.target.value.toUpperCase())}
            />
            <input
              aria-label="New checklist label"
              placeholder="Additional check description"
              value={extraLabel}
              onChange={(e) => setExtraLabel(e.target.value)}
            />
            <button
              type="button"
              className="secondary"
              onClick={() => {
                if (extraCode && extraLabel) {
                  setConfig({
                    items: [
                      ...config.items,
                      {
                        code: extraCode,
                        label: extraLabel,
                        required: false,
                        allowNA: true,
                      },
                    ],
                  });
                  setExtraCode("");
                  setExtraLabel("");
                }
              }}
            >
              Add check
            </button>
          </div>
          <label>
            Photo slots (comma separated; component photos are added
            automatically)
            <input
              value={config.photoTypes.join(",")}
              onChange={(e) =>
                setConfig({
                  photoTypes: e.target.value
                    .toUpperCase()
                    .split(",")
                    .map((s) => s.trim()),
                })
              }
            />
          </label>
          <label>
            Reason for policy change
            <textarea
              required
              maxLength={500}
              value={policyReason}
              onChange={(e) => setPolicyReason(e.target.value)}
            />
          </label>
          <div className="form-actions">
            <button
              type="button"
              disabled={busy}
              className="secondary"
              onClick={() =>
                void run(async () =>
                  setImpact(
                    await api<Record<string, unknown>>(
                      "fleet-readiness/policy/preview",
                      "POST",
                      {
                        operatingMode: policy.operatingMode,
                        configuration: policy.configuration,
                      },
                    ),
                  ),
                )
              }
            >
              Preview impact
            </button>
            <button disabled={busy || !impact || Boolean(impact.blocked)}>
              Save policy
            </button>
          </div>
          {impact && (
            <div role="status">
              <p>{String(impact.message)}</p>
              <p>
                Unallocated scooters: {String(impact.unallocatedScooters)} ·
                Active allocations: {String(impact.activeAllocations)} ·
                In-progress allocations/submissions:{" "}
                {String(impact.inProgressAllocations)} · Open preparations:{" "}
                {String(impact.openPreparations)}
              </p>
              <p>{String(impact.policyEffect ?? "")}</p>
              {Boolean(impact.blocked) && (
                <p className="error">
                  Finish the in-progress work before changing operating mode.
                </p>
              )}
            </div>
          )}
        </form>
      )}
      {view === "staff" && staff && context?.canManage && (
        <>
          <h3>Installation, preparation & QC staff</h3>
          <p>
            Permissions apply only to the selected hubs. Staff may have both
            responsibilities; independent QC still prevents reviewing their own
            work.
          </p>
          <label>
            Staff member
            <select
              value={selectedUser}
              onChange={(e) => {
                const id = e.target.value;
                setSelectedUser(id);
                setGrants(
                  staff.hubs.map(
                    (h) =>
                      staff.assignments.find(
                        (a) => a.userId === id && a.hubId === h.id,
                      ) ?? {
                        hubId: h.id,
                        userId: id,
                        canPrepare: false,
                        canReview: false,
                      },
                  ),
                );
              }}
            >
              <option value="">Select staff</option>
              {staff.users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name} · {label(u.role)}
                  {!u.isActive ? " (inactive)" : ""}
                </option>
              ))}
            </select>
          </label>
          {selectedUser &&
            grants.map((g) => (
              <div key={g.hubId} className="form-actions">
                <strong>
                  {staff.hubs.find((h) => h.id === g.hubId)?.name}
                </strong>
                {policy?.configuration.stages?.map((stage) => (
                  <div key={stage.code}>
                    <strong>{stage.name}</strong>
                    {(["stageCodes", "reviewStageCodes"] as const).map(
                      (key) => (
                        <label key={key}>
                          <input
                            type="checkbox"
                            disabled={!context.isAdmin}
                            checked={g[key]?.includes(stage.code) ?? false}
                            onChange={(e) =>
                              setGrants((current) =>
                                current.map((a) =>
                                  a.hubId === g.hubId
                                    ? {
                                        ...a,
                                        [key]: e.target.checked
                                          ? [...(a[key] ?? []), stage.code]
                                          : (a[key] ?? []).filter(
                                              (code) => code !== stage.code,
                                            ),
                                      }
                                    : a,
                                ),
                              )
                            }
                          />
                          {key === "stageCodes"
                            ? "Perform stage"
                            : "Verify stage"}
                        </label>
                      ),
                    )}
                  </div>
                ))}
                {(["canPrepare", "canReview"] as const).map((key) => (
                  <label key={key}>
                    <input
                      type="checkbox"
                      disabled={!context.isAdmin}
                      checked={g[key]}
                      onChange={(e) =>
                        setGrants((current) =>
                          current.map((a) =>
                            a.hubId === g.hubId
                              ? { ...a, [key]: e.target.checked }
                              : a,
                          ),
                        )
                      }
                    />
                    {key === "canPrepare"
                      ? "RFD / Preparation"
                      : "Quality Check"}
                  </label>
                ))}
              </div>
            ))}
          {context.isAdmin && (
            <button
              disabled={busy || !selectedUser}
              onClick={() =>
                void run(async () => {
                  await api(`fleet-readiness/staff/${selectedUser}`, "PUT", {
                    assignments: grants.map(
                      ({
                        hubId,
                        canPrepare,
                        canReview,
                        stageCodes,
                        reviewStageCodes,
                      }) => ({
                        stageCodes: stageCodes ?? [],
                        reviewStageCodes: reviewStageCodes ?? [],
                        hubId,
                        canPrepare,
                        canReview,
                      }),
                    ),
                  });
                  setEpoch((n) => n + 1);
                  setNotice("Staff permissions saved.");
                })
              }
            >
              Save permissions
            </button>
          )}
          {context.isAdmin && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void run(async () => {
                  await api("fleet-readiness/staff", "POST", newStaff);
                  setNewStaff({ name: "", mobile: "", role: "RFD_MANAGER" });
                  setEpoch((n) => n + 1);
                  setNotice(
                    "Staff created. Assign their hub permissions above.",
                  );
                });
              }}
            >
              <h3>Create staff account</h3>
              <label>
                Name
                <input
                  required
                  value={newStaff.name}
                  onChange={(e) =>
                    setNewStaff({ ...newStaff, name: e.target.value })
                  }
                />
              </label>
              <label>
                Mobile (+91)
                <input
                  required
                  placeholder="+919876543210"
                  value={newStaff.mobile}
                  onChange={(e) =>
                    setNewStaff({ ...newStaff, mobile: e.target.value })
                  }
                />
              </label>
              <label>
                Role
                <select
                  value={newStaff.role}
                  onChange={(e) =>
                    setNewStaff({ ...newStaff, role: e.target.value })
                  }
                >
                  <option value="RFD_MANAGER">Installation / RFD staff</option>
                  <option value="QC_MANAGER">QC Manager</option>
                </select>
              </label>
              <button disabled={busy}>Create staff</button>
            </form>
          )}
        </>
      )}
      {detail && (
        <ClientFormDialog
          title="Vehicle Preparation"
          wide
          busy={busy}
          error={error}
          onClose={() => {
            setDetail(null);
            setPreview(null);
            setError("");
          }}
          heading={<>
              {detail.fleet.vehicleNumber || detail.fleet.fleetCode} ·{" "}
              {label(detail.status)}
            </>}>

          <p>
            Revision {detail.currentRevision} ·{" "}
            {detail.hub?.name ?? detail.hubId}
          </p>
          {detail.invalidationReason && (
            <p className="error">{detail.invalidationReason}</p>
          )}
          {detail.current.rejectionReason && (
            <p className="error">
              QC feedback: {detail.current.rejectionReason} ·{" "}
              {detail.current.failedItems.join(", ")}
            </p>
          )}
          {Boolean(detail.stages?.length) && (
            <>
              <h3>Installation handoffs</h3>
              {detail.stages.map((s) => (
                <p key={s.id}>
                  {s.definition.name}: {label(s.status)}
                </p>
              ))}
              {detail.stages.some((s) => s.status !== "COMPLETED") && (
                <p className="error">
                  Complete required installation stages before submitting RFD
                  preparation to QC.
                </p>
              )}
            </>
          )}
          <h3>Installed components</h3>
          <ul>
            {detail.components.batteries.map((b) => (
              <li key={b.id}>
                Battery ({label(b.slot)}): {b.serial}
              </li>
            ))}
            {detail.components.controllers.map((c) => (
              <li key={c.id}>Controller: {c.serial}</li>
            ))}
            {detail.components.iot && (
              <li>IoT: {detail.components.iot.serial}</li>
            )}
          </ul>
          <h3>Preparation checklist</h3>
          <label>
            Odometer (km)
            <input
              type="number"
              min={0}
              step="0.1"
              value={odometer}
              disabled={
                busy ||
                !detail.permissions.canPrepare ||
                !editableStatuses.includes(detail.status)
              }
              onChange={(e) => setOdometer(e.target.value)}
            />
          </label>
          {detail.configuration.items.map((item) => (
            <div className="form-actions" key={item.code}>
              <label>
                {item.label}
                {item.required ? " *" : ""}
                <select
                  value={checks[item.code]?.result ?? ""}
                  disabled={
                    busy ||
                    !detail.permissions.canPrepare ||
                    !editableStatuses.includes(detail.status)
                  }
                  onChange={(e) =>
                    setChecks({
                      ...checks,
                      [item.code]: {
                        result: e.target.value as Check["result"],
                        notes: checks[item.code]?.notes ?? "",
                      },
                    })
                  }
                >
                  <option value="">Select result</option>
                  <option value="PASS">Pass</option>
                  <option value="FAIL">Fail</option>
                  {item.allowNA && <option value="NA">Not applicable</option>}
                </select>
              </label>
              <input
                aria-label={`${item.label} notes`}
                placeholder="Notes / reason"
                value={checks[item.code]?.notes ?? ""}
                disabled={
                  busy ||
                  !detail.permissions.canPrepare ||
                  !editableStatuses.includes(detail.status)
                }
                onChange={(e) =>
                  setChecks({
                    ...checks,
                    [item.code]: {
                      result: checks[item.code]?.result ?? "FAIL",
                      notes: e.target.value,
                    },
                  })
                }
              />
              {detail.permissions.canReview &&
                detail.status === "AWAITING_QC" && (
                  <label>
                    <input
                      type="checkbox"
                      checked={failed.includes(item.code)}
                      onChange={(e) =>
                        setFailed(
                          e.target.checked
                            ? [...failed, item.code]
                            : failed.filter((code) => code !== item.code),
                        )
                      }
                    />
                    QC failed item
                  </label>
                )}
            </div>
          ))}
          {detail.permissions.canPrepare &&
            editableStatuses.includes(detail.status) && (
              <button
                disabled={busy || odometer === ""}
                onClick={() =>
                  void mutate(
                    `fleet-preparations/${detail.id}`,
                    {
                      revision: detail.currentRevision,
                      checklist: checks,
                      odometerKm: Number(odometer),
                    },
                    "PATCH",
                  )
                }
              >
                Save draft
              </button>
            )}
          <h3>Preparation photos</h3>
          <div className="photo-slots">
            {detail.requiredPhotoTypes.map((slot) => {
              const photo = detail.photos.find(
                (p) => p.entityId === detail.current.id && p.photoType === slot,
              );
              return (
                <div
                  className={`photo-slot ${photo ? "complete" : ""}`}
                  key={slot}
                >
                  <strong>{slotLabel(slot)}</strong>
                  <span>{photo ? "Uploaded" : "Missing"}</span>
                  {photo && (
                    <button
                      className="secondary"
                      disabled={busy}
                      onClick={() =>
                        void run(async () => {
                          const p = await api<{ url: string }>(
                            `fleet-preparations/${detail.id}/photos/${photo.id}/download-url`,
                          );
                          setPreview({ url: p.url, name: slot });
                        })
                      }
                    >
                      View photo
                    </button>
                  )}
                  {detail.permissions.canPrepare &&
                    editableStatuses.includes(detail.status) && (
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        aria-label={`Upload ${slot}`}
                        disabled={busy}
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) void upload(slot, f);
                          e.target.value = "";
                        }}
                      />
                    )}
                </div>
              );
            })}
          </div>
          {detail.permissions.canAssign &&
            editableStatuses.includes(detail.status) && (
              <div className="form-actions">
                <label>
                  RFD staff
                  <select
                    value={assignee}
                    onChange={(e) => setAssignee(e.target.value)}
                  >
                    <option value="">Select staff</option>
                    {context?.preparers
                      .filter((p) => p.hubIds.includes(detail.hubId))
                      .map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                  </select>
                </label>
                <button
                  className="secondary"
                  disabled={busy}
                  onClick={() =>
                    void mutate(`fleet-preparations/${detail.id}/assign`, {
                      revision: detail.currentRevision,
                      userId: assignee,
                    })
                  }
                >
                  Assign RFD staff
                </button>
              </div>
            )}
          {(detail.permissions.canPrepare ||
            detail.permissions.canReview ||
            detail.permissions.canAssign) && (
            <label>
              QC rejection / maintenance reason
              <textarea
                maxLength={500}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </label>
          )}
          <div className="form-actions">
            {detail.permissions.canPrepare &&
              editableStatuses.includes(detail.status) && (
                <>
                  <button
                    disabled={busy}
                    onClick={() =>
                      void mutate(`fleet-preparations/${detail.id}/submit`, {
                        revision: detail.currentRevision,
                      })
                    }
                  >
                    Submit for QC
                  </button>
                  <button
                    className="danger"
                    disabled={busy || !reason.trim()}
                    onClick={() =>
                      void mutate(
                        `fleet-preparations/${detail.id}/maintenance`,
                        { revision: detail.currentRevision, reason },
                      )
                    }
                  >
                    Send to maintenance
                  </button>
                </>
              )}
            {detail.permissions.canReview &&
              detail.status === "AWAITING_QC" && (
                <>
                  <button
                    disabled={busy}
                    onClick={() =>
                      void mutate(
                        `fleet-preparations/${detail.id}/qc-approve`,
                        { revision: detail.currentRevision },
                      )
                    }
                  >
                    Approve QC
                  </button>
                  <button
                    className="danger"
                    disabled={busy || !reason.trim() || !failed.length}
                    onClick={() =>
                      void mutate(`fleet-preparations/${detail.id}/qc-reject`, {
                        revision: detail.currentRevision,
                        reason,
                        failedItems: failed,
                      })
                    }
                  >
                    Reject for rework
                  </button>
                </>
              )}
          </div>
          {detail.permissions.canAssign &&
            editableStatuses.concat("AWAITING_QC").includes(detail.status) && (
              <button
                className="danger"
                disabled={busy || !reason.trim()}
                onClick={() =>
                  void mutate(`fleet-preparations/${detail.id}/cancel`, {
                    revision: detail.currentRevision,
                    reason,
                  })
                }
              >
                Cancel preparation
              </button>
            )}
          <h3>Revision history</h3>
          {detail.revisions.map((r) => (
            <div key={r.id}>
              <strong>
                Revision {r.revision}:{" "}
                {r.decision ?? (r.submittedAt ? "Awaiting QC" : "Draft")}
              </strong>
              <p>{r.rejectionReason}</p>
              {detail.photos
                .filter((p) => p.entityId === r.id)
                .map((p) => (
                  <button
                    className="secondary table-action"
                    key={p.id}
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        const url = await api<{ url: string }>(
                          `fleet-preparations/${detail.id}/photos/${p.id}/download-url`,
                        );
                        setPreview({ url: url.url, name: p.photoType });
                      })
                    }
                  >
                    {slotLabel(p.photoType)}
                  </button>
                ))}
            </div>
          ))}
          <h3>Activity history</h3>
          <ul>
            {detail.events.map((event) => (
              <li key={event.id}>
                {new Date(event.createdAt).toLocaleString()} ·{" "}
                {label(event.action)}
              </li>
            ))}
          </ul>
        </ClientFormDialog>
      )}
          {preview && (
            <ClientFormDialog title={label(preview.name)} wide onClose={() => setPreview(null)}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={preview.url}
                alt={preview.name}
                style={{
                  maxWidth: "100%",
                  maxHeight: "65vh",
                  objectFit: "contain",
                }}
              />
              <div className="form-actions">
                <a className="button secondary" href={preview.url} download target="_blank" rel="noreferrer">
                  Download photo
                </a>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => setPreview(null)}
                >
                  Close preview
                </button>
              </div>
            </ClientFormDialog>
          )}

    </section>
  );
}

export function FleetReadinessStatus({ fleetId }: { fleetId: string }) {
  const [data, setData] = useState<{
      operatingMode: string;
      canAllocate: boolean;
      blockers: string[];
      preparation: { status: string } | null;
    } | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <>
      <button
        className="secondary table-action"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          setError("");
          void api<NonNullable<typeof data>>(`fleets/${fleetId}/readiness`)
            .then(setData)
            .catch((e) => setError(e.message))
            .finally(() => setBusy(false));
        }}
      >
        Readiness
      </button>
      {error && <span className="error">{error}</span>}
      {data && (
        <ClientFormDialog
          title="Scooter readiness"
          onClose={() => setData(null)}
          heading={<>Scooter readiness</>}>

          <p>Mode: {label(data.operatingMode)}</p>
          <p>
            {data.canAllocate ? "Ready for allocation" : "Allocation blocked"}
          </p>
          <ul>
            {data.blockers.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
          <p>
            Preparation:{" "}
            {data.preparation
              ? label(data.preparation.status)
              : "No preparation cycle"}
          </p>

        </ClientFormDialog>
      )}
    </>
  );
}
