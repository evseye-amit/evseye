"use client";
import { UnsavedChangesScope, markFormsSaved, requestNavigation } from "./unsaved-changes";
import { usePanelLoading } from "./panel-loading";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { sessionFetch } from "../../lib/session-fetch";
import { ClientDataTable } from "./client-data-table";
import { ClientFormDialog } from "./client-form-dialog";
import { UiIcon } from "./ui-icon";
import {
  normalizeReadinessPlans,
  type ReadinessPlanOption,
} from "./readiness-workflow-picker";
import { policySaveBody, previewVehicleImpactMessage } from "./fleet-readiness-ui";

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
type Hub = { id: string; name: string; status?: string };
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
const preparationModes: Mode[] = ["PREPARATION_QC", "STAGED_PREPARATION_QC"];
const modeExplanation: Record<Mode, string> = {
  SIMPLE: "No web preparation or QC workflow. Use the Fleet Manager app for allocation checks.",
  ONBOARDING_EVIDENCE: "Activation uses onboarding photos and evidence; no web preparation or QC workflow is shown.",
  PREPARATION_QC: "Vehicles use a checklist and QC review before allocation.",
  STAGED_PREPARATION_QC: "Vehicles use a checklist and QC review, plus the configured installation stages before allocation.",
};
type VehicleImpact = {
  fleetId?: string;
  vehicleNumber?: string | null;
  fleetCode?: string | null;
  chassisNumber?: string | null;
  effects?: string[];
};
type PolicyImpact = {
  currentMode: string;
  proposedMode: string;
  vehicleImpact?: unknown;
  [key: string]: unknown;
};
const impactEffectLabel = (effect: string) => ({
  MOVE_TO_INSPECTION_PENDING: "Moves to inspection",
  CLEAR_READINESS_APPROVAL: "Clears readiness approval",
  INVALIDATE_APPROVED_PREPARATION: "Invalidates approved preparation",
  BLOCKED_BY_ALLOCATION_WORK: "Blocked by allocation work",
  BLOCKED_BY_OPEN_PREPARATION: "Blocked by open preparation",
  PRESERVE_ADMIN_ALLOCATION_BLOCK: "Keeps the admin allocation block",
  ACTIVE_ALLOCATION_UNCHANGED: "Vehicle stays with the current rider",
  AFFECTED: "Affected vehicles",
}[effect] ?? label(effect));
const vehicleImpactList = (impact: Record<string, unknown> | null): VehicleImpact[] => {
  if (!impact || !Array.isArray(impact.vehicleImpact)) return [];
  return impact.vehicleImpact.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const item = entry as Record<string, unknown>;
    return [{
      fleetId: typeof item.fleetId === "string" ? item.fleetId : undefined,
      vehicleNumber: typeof item.vehicleNumber === "string" ? item.vehicleNumber : null,
      fleetCode: typeof item.fleetCode === "string" ? item.fleetCode : null,
      chassisNumber: typeof item.chassisNumber === "string" ? item.chassisNumber : null,
      effects: Array.isArray(item.effects) ? item.effects.filter((effect): effect is string => typeof effect === "string") : [],
    }];
  });
};
const groupedVehicleImpact = (impact: Record<string, unknown> | null) => {
  const groups = new Map<string, VehicleImpact[]>();
  for (const vehicle of vehicleImpactList(impact)) {
    for (const effect of vehicle.effects?.length ? vehicle.effects : ["AFFECTED"]) {
      groups.set(effect, [...(groups.get(effect) ?? []), vehicle]);
    }
  }
  return [...groups.entries()];
};
async function api<T>(
  path: string,
  method = "GET",
  data?: unknown,
): Promise<T> {
  const endpoint = path.startsWith("/api/v1/") ? path : `/api/v1/client/${path}`;
  const res = await sessionFetch(endpoint, {
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

function FleetReadinessManager({
  view, refreshKey = 0,
}: {
  refreshKey?: number;
  view: "preparation" | "qc" | "settings" | "advisors" | "qc-managers";
}) {
  const staffView = view === "advisors" || view === "qc-managers";
  const staffRole = view === "qc-managers" ? "QC_MANAGER" : "ADVISOR";
  const staffTitle = view === "qc-managers" ? "QC Manager" : "Advisors";
  const staffLabel = (role: string) => ["ADVISOR"].includes(role) ? "Advisor" : role === "QC_MANAGER" ? "QC Manager" : label(role);
  const [showCreateStaff, setShowCreateStaff] = useState(false);
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
    }),
    [policyReason, setPolicyReason] = useState(""),
    [impact, setImpact] = useState<PolicyImpact | null>(null),
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
    if (!staffView || !policy || policy.operatingMode === "SIMPLE") return;
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
  }, [staffView, policy, epoch, refreshKey]);
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
  const preparationMode = preparationModes.includes(policy?.operatingMode ?? "SIMPLE");
  const stagedMode = policy?.operatingMode === "STAGED_PREPARATION_QC";
  const impactGroups = groupedVehicleImpact(impact);
  const impactEmptyMessage = previewVehicleImpactMessage(
    impact?.currentMode,
    impact?.proposedMode,
    impact?.vehicleImpact,
  );
  const setConfig = (patch: Partial<Configuration>) => {
    if (policy) {
      setPolicy({
        ...policy,
        configuration: { ...policy.configuration, ...patch },
      });
      setImpact(null);
    }
  };
  const staffUsers = staff?.users.filter((user) => view === "advisors" ? ["ADVISOR"].includes(user.role) : user.role === "QC_MANAGER") ?? [];
  const selectStaff = (id: string) => requestNavigation(() => {
    setSelectedUser(id);
    setGrants(staff?.hubs.map((h) => staff.assignments.find((a) => a.userId === id && a.hubId === h.id) ?? {
      hubId: h.id, userId: id, canPrepare: false, canReview: false, stageCodes: [], reviewStageCodes: [],
    }) ?? []);
  });
  if (staffView && policy?.operatingMode === "SIMPLE") return <section className="package-not-included-card">
    <p className="eyebrow">TEAM MANAGEMENT</p>
    <h2>Dedicated {staffTitle === "Advisors" ? "Advisors" : "QC Managers"} are not available in your package</h2>
    <p>In Simple mode, Client Admins and Fleet Managers perform these responsibilities.</p>
    <p className="muted">Allocation and submission photos remain mandatory.</p>
  </section>;
  return (
    <UnsavedChangesScope formsOnly resetKey={policy?.version}><section className="action-card readiness-workspace">
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
          <ClientDataTable toolbarActions={<button
              type="button"
              className="secondary"
              disabled={loading || busy}
              onClick={() => setEpoch((n) => n + 1)}
            >
              Refresh
            </button>} rows={rows} loading={loading} getRowId={(row) => row.id} emptyMessage="No preparations in this view."
            server={{ page, limit: 20, total, search, filterCount: [hub,status,owner].filter(Boolean).length, onReset: () => { setSearch(""); setHub(""); setStatus(""); setOwner(""); setPage(1); setCandidatePage(1); }, onSearch: value => { setSearch(value); setPage(1); setCandidatePage(1); }, onPage: setPage }}
            columns={[
              { key: "scooter", label: "Scooter", value: (row) => row.fleet?.vehicleNumber || row.fleet?.fleetCode, render: (row) => <span className="client-record-title"><strong>{row.fleet?.vehicleNumber || row.fleet?.fleetCode}</strong><small>{row.fleet?.chassisNumber}</small></span> },
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
              </select>), value: (row) => row.hub?.name ?? "—" },
              { key: "assignee", label: "Assigned to", serverFilter: (id) => <select id={id} aria-label="Filter by assignee" value={owner ? "mine" : ""} onChange={event => { setOwner(event.target.value ? (context?.userId ?? "") : ""); setPage(1); }}><option value="">All assignees</option><option value="mine">Assigned to me</option></select>, value: (row) => row.assignee?.name ?? "Unassigned" },
              { key: "status", label: "Status", serverFilter: (id) => (<select id={id} aria-label="Filter by Status"
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
              </select>), value: (row) => label(row.status), render: (row) => <span className={`status status-${row.status.toLowerCase()}`}>{label(row.status)}</span> },
              { key: "revision", label: "Revision", value: (row) => row.currentRevision },
              { key: "updated", label: "Updated", value: (row) => row.updatedAt, render: (row) => new Date(row.updatedAt).toLocaleString() },
            ]} actions={(row) => <button type="button" disabled={busy || loading} className="secondary table-action" onClick={() => void run(async () => { await loadDetail(row.id); })}>Open</button>} />
          {view === "preparation" && (
            <>
              <h3>Scooters awaiting preparation</h3>
              <p>Use the table search and Hub column filter above to browse scooters.</p>
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
              const p = await api<Policy>("fleet-readiness/policy", "PUT", policySaveBody(policy, policyReason));
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
            </select>
          </label>
          <p className="muted">{modeExplanation[policy.operatingMode]}</p>
          {!preparationMode && <p className="muted">Stored preparation and QC settings stay saved for later mode changes.</p>}
          {stagedMode && <InstallationStageSettings
            templates={policy.installationStageTemplates ?? []}
            value={config.stages ?? []}
            onChange={(stages) => {
              setConfig({ stages });
              setImpact(null);
            }}
            hubs={context?.hubs ?? []}
            vehicleTypes={context?.vehicleTypes ?? []}
          />}
          {preparationMode && <fieldset className="form-section">
            <legend>Preparation and QC settings</legend>
          <label>
            <input
              type="checkbox"
              checked={config.independentReview}
              onChange={(e) =>
                setConfig({ independentReview: e.target.checked })
              }
            />
            Different reviewer for QC
          </label>
          <label>
            Minimum batteries
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
            Controller needed
          </label>
          <label>
            <input
              type="checkbox"
              checked={config.iotRequired}
              onChange={(e) => setConfig({ iotRequired: e.target.checked })}
            />
            IoT device needed
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
            Required photos (comma separated; component photos are added
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
          </fieldset>}
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
                    await api<PolicyImpact>(
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
            <div role="status" className="readiness-impact-preview">
              <p>{typeof impact.message === "string" ? impact.message : "Preview loaded."}</p>
              <p>
                Unallocated scooters: {impact.unallocatedScooters === undefined ? "Unavailable" : String(impact.unallocatedScooters)} ·
                Active allocations: {impact.activeAllocations === undefined ? "Unavailable" : String(impact.activeAllocations)} ·
                In-progress allocations/submissions:{" "}
                {impact.inProgressAllocations === undefined ? "Unavailable" : String(impact.inProgressAllocations)} · Open preparations:{" "}
                {impact.openPreparations === undefined ? "Unavailable" : String(impact.openPreparations)}
              </p>
              {typeof impact.policyEffect === "string" && <p>{impact.policyEffect}</p>}
              {Boolean(impact.blocked) && (
                <p className="error">
                  Finish the in-progress work before changing operating mode.
                </p>
              )}
              {Array.isArray(impact.vehicleImpact) ? impactGroups.length > 0 ? <div className="readiness-impact-vehicles">
                <h4>Exact vehicle effects</h4>
                {impactGroups.map(([effect, vehicles]) => <details key={effect} open>
                  <summary>{impactEffectLabel(effect)} ({vehicles.length})</summary>
                  <ul>
                    {vehicles.map((vehicle) => <li key={`${effect}:${vehicle.fleetId ?? vehicle.fleetCode ?? vehicle.vehicleNumber ?? vehicle.chassisNumber}`}>
                      <strong>{vehicle.vehicleNumber || vehicle.fleetCode || vehicle.fleetId || "Unnamed vehicle"}</strong>
                      <span> · Chassis: {vehicle.chassisNumber || "Unavailable"}</span>
                    </li>)}
                  </ul>
                </details>)}
              </div> : <p className="muted">{impactEmptyMessage ?? "Exact vehicle impact is unavailable."}</p> : <p className="muted">Exact vehicle impact is unavailable.</p>}
            </div>
          )}
        </form>
      )}
      {staffView && staff && context?.canManage && (
        <>
          <div className="client-page-head">{context.isAdmin && <div className="sa-actions"><button type="button" onClick={() => requestNavigation(() => { setSelectedUser(""); setGrants([]); setShowCreateStaff(true); })}>+ Add {staffRole === "ADVISOR" ? "Advisor" : "QC Manager"}</button></div>}</div>
          <div className="readiness-staff-directory"><ClientDataTable stateKey={`readiness-staff:${context.userId}:${view}`} loading={staffLoading} rows={staffUsers} getRowId={(user) => user.id}
            columns={[
              { key: "name", label: "Name", value: (user) => user.name },
              { key: "mobile", label: "Mobile", value: (user) => user.mobile },
              { key: "role", label: "Role", value: (user) => staffLabel(user.role) },
              { key: "status", label: "Status", value: (user) => user.isActive ? "Active" : "Inactive" },
              { key: "hubs", label: "Assigned hubs", value: (user) => staff.assignments.filter((a) => a.userId === user.id).map((a) => staff.hubs.find((h) => h.id === a.hubId)?.name ?? a.hubId).join(", ") || "Unassigned" },
            ]} actions={(user) => <button type="button" className="secondary table-action" disabled={!user.isActive || busy} onClick={() => selectStaff(user.id)}>{context.isAdmin ? "Manage permissions" : "View permissions"}</button>}
            emptyMessage={`No ${staffTitle === "Advisors" ? "advisors" : "QC managers"} have been created.`} /></div>
          <h3>Hub and stage permissions</h3>
          <p>
            Permissions apply only to the selected hubs. Staff may have both
            responsibilities; independent QC still prevents reviewing their own
            work.
          </p>
          <label className="staff-operator-selector">
            Staff member or existing operator
            <select
              value={selectedUser}
              onChange={(e) => selectStaff(e.target.value)}
            >
              <option value="">Select staff</option>
              {staff.users.map((u) => (
                <option key={u.id} value={u.id} disabled={!u.isActive}>
                  {u.name} · {staffLabel(u.role)}
                  {!u.isActive ? " (inactive)" : ""}
                </option>
              ))}
            </select>
          </label>
          {selectedUser &&
            grants.map((g) => (
              <div data-unsaved-fields key={g.hubId} className="readiness-staff-hub">
                <strong>
                  {staff.hubs.find((h) => h.id === g.hubId)?.name}
                </strong>
                {policy?.configuration.stages?.map((stage) => (
                  <div key={stage.code} className="readiness-staff-stage">
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
                  markFormsSaved(); setNotice("Staff permissions saved.");
                })
              }
            >
              Save permissions
            </button>
          )}
          {context.isAdmin && showCreateStaff && (
            <ClientFormDialog title={`Add ${staffRole === "ADVISOR" ? "Advisor" : "QC Manager"}`} busy={busy} error={error} onClose={() => { setShowCreateStaff(false); setNewStaff({ name: "", mobile: "" }); setError(""); }}>
            <form className="form-stack"
              onSubmit={(e) => {
                e.preventDefault();
                void run(async () => {
                  await api("fleet-readiness/staff", "POST", { ...newStaff, role: staffRole });
                  setNewStaff({ name: "", mobile: "" });
                  setShowCreateStaff(false);
                  markFormsSaved();
                  setEpoch((n) => n + 1);
                  setNotice(
                    "Staff created. Assign their hub permissions above.",
                  );
                });
              }}
            >
              <p>Role: <strong>{staffRole === "ADVISOR" ? "Advisor" : "QC Manager"}</strong></p>
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
              <div className="form-actions"><button disabled={busy}>Create {staffRole === "ADVISOR" ? "Advisor" : "QC Manager"}</button><button type="button" className="secondary" disabled={busy} onClick={() => { setShowCreateStaff(false); setNewStaff({ name: "", mobile: "" }); }}>Cancel</button></div>
            </form>
            </ClientFormDialog>
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
                  Advisor
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
                  Assign Advisor
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

    </section></UnsavedChangesScope>
  );
}

type ReadinessOverviewData = {
  id?: string;
  name?: string;
  fleet?: Record<string, unknown> | null;
  workflow?: string;
  readinessWorkflow?: string;
  operatingMode?: string;
  plan?: unknown;
  stagePlanCode?: string | null;
  readinessStagePlanCode?: string | null;
  progress?: unknown;
  qc?: unknown;
  blockers?: unknown;
  preparation?: unknown;
  canAllocate?: boolean;
  canActivate?: boolean;
  nextStep?: string | null;
  selectablePlans?: unknown;
  readinessStagePlans?: unknown;
  stagePlans?: unknown;
};

const objectValue = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const stringValue = (value: unknown, fallback = "—") =>
  typeof value === "string" && value.trim() ? value : fallback;

const overviewStatus = (value: unknown) =>
  label(String(value ?? "PENDING")).replace(/^./, (character) => character.toUpperCase());

const overviewList = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return value.flatMap((entry) => {
      if (typeof entry === "string" && entry.trim()) return [entry];
      const record = objectValue(entry);
      const message = record?.message ?? record?.label ?? record?.reason ?? record?.code;
      return typeof message === "string" && message.trim() ? [message] : [];
    });
  }
  const record = objectValue(value);
  if (!record) return [];
  return Object.entries(record).flatMap(([key, entry]) =>
    typeof entry === "string" && entry.trim() ? [`${label(key)}: ${entry}`] : [],
  );
};

function readinessProgress(value: unknown) {
  const record = objectValue(value);
  if (record) {
    const completed = Number(record.completed ?? record.completedCount ?? 0);
    const total = Number(record.total ?? record.totalCount ?? 0);
    const percent = Number(record.percent ?? record.percentage ?? (total ? completed / total * 100 : 0));
    return {
      completed: Number.isFinite(completed) ? completed : 0,
      total: Number.isFinite(total) ? total : 0,
      percent: Number.isFinite(percent) ? Math.max(0, Math.min(100, Math.round(percent))) : 0,
      current: stringValue(record.currentStage ?? record.current ?? record.stage),
    };
  }
  if (Array.isArray(value)) {
    const completed = value.filter((entry) => objectValue(entry)?.status === "COMPLETED").length;
    return { completed, total: value.length, percent: value.length ? Math.round(completed / value.length * 100) : 0, current: "—" };
  }
  return { completed: 0, total: 0, percent: 0, current: "—" };
}

function FleetReadinessOverview({
  fleetId,
  onBack,
  onOpenPreparation,
}: Readonly<{
  fleetId: string;
  onBack?: () => void;
  onOpenPreparation?: (fleetId: string) => void;
}>) {
  const [data, setData] = useState<ReadinessOverviewData | null>(null);
  const [stagePlanCode, setStagePlanCode] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [availablePlans, setAvailablePlans] = useState<ReadinessPlanOption[]>([]);

  const load = useCallback(() => {
    setLoading(true);
    setError("");
    void api<ReadinessOverviewData>(`fleets/${fleetId}/readiness`)
      .then((next) => {
        setData(next);
        const plan = objectValue(next.plan);
        setStagePlanCode(String(next.stagePlanCode ?? next.readinessStagePlanCode ?? plan?.code ?? ""));
        void api<Record<string, unknown>>("fleets/onboarding-options")
          .then((options) => setAvailablePlans(normalizeReadinessPlans(options.readinessStagePlans ?? options.selectablePlans ?? options.stagePlans)))
          .catch(() => setAvailablePlans([]));
      })
      .catch((cause) => setError(cause instanceof Error ? cause.message : "Unable to load fleet readiness."))
      .finally(() => setLoading(false));
  }, [fleetId]);

  useEffect(() => {
    const timer = window.setTimeout(() => load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const savePlan = async (event: FormEvent) => {
    event.preventDefault();
    if (!stagePlanCode) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await api(`fleets/${fleetId}/readiness`, "PATCH", { stagePlanCode });
      setNotice("Stage plan saved.");
      load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to save the stage plan.");
    } finally {
      setBusy(false);
    }
  };

  const activate = async () => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await api(`fleets/${fleetId}/activate`, "POST");
      setNotice("Fleet activated.");
      load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to activate fleet.");
    } finally {
      setBusy(false);
    }
  };

  if (loading && !data) {
    return <section className="action-card readiness-detail-page"><p className="muted">Loading readiness…</p></section>;
  }

  const fleet = objectValue(data?.fleet);
  const workflow = String(data?.workflow ?? data?.readinessWorkflow ?? data?.operatingMode ?? "SIMPLE");
  const plan = objectValue(data?.plan);
  const planLabel = stringValue(plan?.name ?? plan?.label ?? data?.stagePlanCode ?? data?.readinessStagePlanCode, "No shared stage plan");
  const progress = readinessProgress(data?.progress);
  const qc = objectValue(data?.qc);
  const preparation = objectValue(data?.preparation);
  const blockers = overviewList(data?.blockers);
  const plans: ReadinessPlanOption[] = availablePlans.length
    ? availablePlans
    : normalizeReadinessPlans(data?.selectablePlans ?? data?.readinessStagePlans ?? data?.stagePlans);
  const displayName = stringValue(data?.name ?? fleet?.vehicleNumber ?? fleet?.fleetCode ?? fleet?.chassisNumber, "Fleet readiness");
  const direct = workflow === "SIMPLE" || workflow === "ONBOARDING_EVIDENCE";
  const preparationStatus = String(preparation?.status ?? "").toUpperCase();
  const qcDecision = String(qc?.decision ?? qc?.status ?? "").toUpperCase();
  const approvalReady = ["APPROVED", "QC_APPROVED"].includes(preparationStatus) || ["APPROVED", "QC_APPROVED"].includes(qcDecision);
  const approvalBlocker = blockers.some((blocker) => blocker.toLowerCase().includes("preparation and qc approval"));
  const showActivate = direct || data?.canActivate === true || (data?.canActivate === undefined && approvalReady && !approvalBlocker);
  const activationDisabled = data?.canActivate === false && !approvalReady;

  return (
    <section className="action-card readiness-detail-page" aria-labelledby="readiness-detail-title">
      <header className="readiness-detail-header">
        <div>
          <p className="eyebrow">FLEET READINESS</p>
          <h2 id="readiness-detail-title">{displayName}</h2>
          <p className="muted">{stringValue(fleet?.chassisNumber, "Review the saved workflow and the next operational handoff.")}</p>
        </div>
        <button type="button" className="secondary" onClick={onBack}>Back to fleets</button>
      </header>
      {error && <p className="error" role="alert">{error}</p>}
      {notice && <p className="notice" role="status">{notice}</p>}
      {!data ? (
        <div className="readiness-empty-state"><p>Readiness details are not available.</p><button type="button" className="secondary" onClick={load}>Try again</button></div>
      ) : (
        <>
          <div className="readiness-overview-grid">
            <article className="readiness-overview-card"><p className="eyebrow">WORKFLOW</p><h3>{overviewStatus(workflow)}</h3><p>{direct ? "Direct activation" : "Preparation and quality control"}</p></article>
            <article className="readiness-overview-card"><p className="eyebrow">PROGRESS</p><h3>{progress.percent}%</h3><p>{progress.completed} of {progress.total || "—"} stages complete</p><div className="readiness-progress-track" aria-label={`${progress.percent}% complete`}><span style={{ width: `${progress.percent}%` }} /></div>{progress.current !== "—" && <small>Current: {label(progress.current)}</small>}</article>
            <article className="readiness-overview-card"><p className="eyebrow">QUALITY CHECK</p><h3>{overviewStatus(qc?.status ?? qc?.decision ?? (direct ? "NOT_REQUIRED" : "PENDING"))}</h3><p>{stringValue(qc?.message ?? qc?.notes, direct ? "No QC gate for direct activation." : "Waiting for the quality check.")}</p></article>
          </div>
          <div className="readiness-detail-columns">
            <section className="readiness-detail-card"><p className="eyebrow">NEXT HANDOFF</p><h3>{preparation ? overviewStatus(preparation.status) : direct ? "Ready for activation" : "Preparation not started"}</h3>{blockers.length ? <ul className="readiness-blocker-list">{blockers.map((blocker) => <li key={blocker}>{blocker}</li>)}</ul> : <p className="muted">No blockers reported by the readiness service.</p>}<p><strong>Next step:</strong> {data.nextStep || "No next step was provided."}</p><div className="readiness-primary-action">{showActivate ? <button type="button" disabled={busy || activationDisabled} onClick={() => void activate()}>{busy ? "Activating…" : "Activate fleet"}</button> : <button type="button" onClick={() => onOpenPreparation?.(fleetId)}>Open preparation</button>}</div></section>
            <section className="readiness-detail-card"><p className="eyebrow">STAGE PLAN</p><h3>{planLabel}</h3>{workflow === "STAGED_PREPARATION_QC" && plans.length ? <form className="readiness-plan-form" onSubmit={(event) => void savePlan(event)}><label>Change plan<select value={stagePlanCode} onChange={(event) => setStagePlanCode(event.target.value)} disabled={busy}><option value="">Select a plan</option>{plans.map((option) => <option key={option.code} value={option.code}>{option.label}</option>)}</select></label><button type="submit" className="secondary" disabled={busy || !stagePlanCode}>Save stage plan</button></form> : <p className="muted">{workflow === "STAGED_PREPARATION_QC" ? "No alternate plans are available for this workflow." : "This workflow does not use a shared stage plan."}</p>}</section>
          </div>
        </>
      )}
    </section>
  );
}

export function FleetReadiness({
  fleetId,
  onBack,
  onOpenPreparation,
  ...managerProps
}: {
  refreshKey?: number;
  view: "preparation" | "qc" | "settings" | "advisors" | "qc-managers";
  fleetId?: string;
  onBack?: () => void;
  onOpenPreparation?: (fleetId: string) => void;
}) {
  if (fleetId) return <FleetReadinessOverview fleetId={fleetId} onBack={onBack} onOpenPreparation={onOpenPreparation} />;
  return <FleetReadinessManager {...managerProps} />;
}

export function FleetReadinessStatus({ fleetId, vehicleLabel, readinessState }: {
  fleetId: string;
  vehicleLabel: string;
  readinessState: "ready" | "blocked" | "unavailable";
}) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [data, setData] = useState<{
    workflow?: string;
    readinessWorkflow?: string;
    operatingMode?: string;
    plan?: { code?: string; name?: string; label?: string } | string | null;
    progress?: { percent?: number; completed?: number; total?: number } | null;
    qc?: { status?: string; decision?: string } | null;
    canAllocate?: boolean;
    blockers?: Array<string | { message?: string }>;
    nextStep?: string | null;
    preparation?: { status: string } | null;
  } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const workflow = data?.workflow ?? data?.readinessWorkflow ?? data?.operatingMode ?? "SIMPLE";
  const plan = typeof data?.plan === "string" ? data.plan : data?.plan?.name ?? data?.plan?.label ?? data?.plan?.code;
  const readinessLabel = readinessState === "ready" ? "Ready" : readinessState === "blocked" ? "Blocked" : "Unavailable";
  const blockers = data?.blockers?.flatMap((blocker) => typeof blocker === "string" ? [blocker] : blocker.message ? [blocker.message] : []) ?? [];
  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="readiness-info-button"
        aria-label={`Readiness details for ${vehicleLabel}: ${readinessLabel}`}
        title={`Readiness details for ${vehicleLabel}: ${readinessLabel}`}
        aria-disabled={busy}
        onClick={() => {
          if (busy) return;
          setBusy(true);
          setError("");
          void api<NonNullable<typeof data>>(`fleets/${fleetId}/readiness`)
            .then(setData)
            .catch((cause) => setError(cause instanceof Error ? cause.message : "Unable to load readiness."))
            .finally(() => setBusy(false));
        }}
      >
        <UiIcon name="info" />
      </button>
      {error && <span className="error" role="alert">{error}</span>}
      {data && (
        <ClientFormDialog
          title="Fleet readiness"
          onClose={() => {
            setData(null);
            requestAnimationFrame(() => triggerRef.current?.focus());
          }}
          heading={<>Fleet readiness</>}
          formsOnly
        >
          <p className="notice">{data.canAllocate ? "Ready to allocate" : "Blocked from allocation"}</p>
          {blockers.length > 0 && <><h3>Blockers</h3><ul>{blockers.map((reason) => <li key={reason}>{reason}</li>)}</ul></>}
          <p><strong>Next step:</strong> {data.nextStep || "No next step was provided."}</p>
          <div className="readiness-info-summary">
            <p><strong>Workflow</strong><span>{overviewStatus(workflow)}</span></p>
            <p><strong>Stage plan</strong><span>{stringValue(plan, "Not selected")}</span></p>
            {data.progress && <p><strong>Progress</strong><span>{data.progress.completed ?? 0} of {data.progress.total ?? 0} stages</span></p>}
            <p><strong>Preparation</strong><span>{data.preparation ? overviewStatus(data.preparation.status) : "Not started"}</span></p>
            {data.qc && <p><strong>QC</strong><span>{overviewStatus(data.qc.status ?? data.qc.decision)}</span></p>}
          </div>
        </ClientFormDialog>
      )}
    </>
  );
}

type ActiveTransfer = Record<string, unknown> | null | undefined;

export function FleetMoreMenu({
  fleetId,
  fleetName,
  status,
  currentHubId,
  activeTransfer,
  onEdit,
  onEvidence,
  onDelete,
  onTransferDone,
  canManageEvidence,
}: Readonly<{
  fleetId: string;
  fleetName: string;
  status: string;
  currentHubId: string;
  activeTransfer?: ActiveTransfer;
  onEdit: () => void;
  onEvidence?: () => void;
  onDelete: () => void;
  onTransferDone: () => void;
  canManageEvidence: boolean;
}>) {
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const summaryRef = useRef<HTMLElement>(null);
  const [open, setOpen] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const [hubs, setHubs] = useState<Hub[]>([]);
  const [hubsLoading, setHubsLoading] = useState(false);
  const [destinationHubId, setDestinationHubId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const transferId = String(activeTransfer?.id ?? activeTransfer?.transferId ?? "");
  const destinationHub = objectValue(activeTransfer?.destinationHub);
  const destinationName = String(activeTransfer?.destinationHubName ?? destinationHub?.name ?? activeTransfer?.toHubId ?? "");
  const canStartTransfer = status === "AVAILABLE" && !transferId;
  const canReceiveTransfer = Boolean(transferId) || (status === "IN_TRANSIT" && !transferId);
  const destinationHubs = hubs.filter((hub) => hub.id !== currentHubId && hub.status === "ACTIVE");

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        detailsRef.current?.removeAttribute("open");
        summaryRef.current?.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  const loadHubs = useCallback(async () => {
    setHubsLoading(true);
    setError("");
    try {
      const result = await api<Hub[] | { items: Hub[] }>("/api/v1/hubs");
      setHubs(Array.isArray(result) ? result : result.items);
    } catch (cause) {
      setHubs([]);
      setError(cause instanceof Error ? cause.message : "Unable to load hubs.");
    } finally {
      setHubsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!transferOpen || hubs.length) return;
    const timer = window.setTimeout(() => void loadHubs(), 0);
    return () => window.clearTimeout(timer);
  }, [transferOpen, hubs.length, loadHubs]);

  const closeMenu = () => {
    setOpen(false);
    detailsRef.current?.removeAttribute("open");
  };
  const startTransfer = async (event: FormEvent) => {
    event.preventDefault();
    if (!destinationHubId) return;
    setBusy(true);
    setError("");
    try {
      await api(`/api/v1/fleets/${fleetId}/transfers`, "POST", { destinationHubId });
      setTransferOpen(false);
      setDestinationHubId("");
      onTransferDone();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to start transfer.");
    } finally {
      setBusy(false);
    }
  };
  const receiveTransfer = async () => {
    setBusy(true);
    setError("");
    try {
      if (transferId) await api(`/api/v1/fleet-transfers/${transferId}/receipt`, "POST");
      else await api(`/api/v1/fleets/${fleetId}/status`, "PATCH", { status: "PENDING_ACTIVATION", reason: "Fleet received." });
      closeMenu();
      onTransferDone();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to record receipt.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <details ref={detailsRef} className="fleet-more-menu" open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
        <summary ref={summaryRef} className="fleet-more-summary">More</summary>
        <div className="fleet-more-popover" role="menu" aria-label={`More actions for ${fleetName}`}>
          {error && !transferOpen && <p className="error" role="alert">{error}</p>}
          {canStartTransfer && <button type="button" role="menuitem" onClick={() => { closeMenu(); setError(""); setDestinationHubId(""); setTransferOpen(true); }}>Transfer to hub</button>}
          {canReceiveTransfer && <button type="button" role="menuitem" disabled={busy} onClick={() => void receiveTransfer()}>Mark received{destinationName ? ` · ${destinationName}` : ""}</button>}
          {canManageEvidence && onEvidence && <button type="button" role="menuitem" onClick={() => { closeMenu(); onEvidence(); }}>Photos &amp; evidence</button>}
          {status === "AVAILABLE" && <button type="button" role="menuitem" disabled title="Use the Fleet Manager app to complete allocation and its required checks.">Allocate</button>}
          {status === "ALLOCATED" && <button type="button" role="menuitem" className="danger" disabled title="Use the submission workflow in the Fleet Manager app to return this vehicle.">De-allocate</button>}
          <button type="button" role="menuitem" onClick={() => { closeMenu(); onEdit(); }}>Edit fleet</button>
          <button type="button" role="menuitem" className="danger" onClick={() => { closeMenu(); onDelete(); }}>Delete fleet</button>
        </div>
      </details>
      {transferOpen && <ClientFormDialog title={`Transfer ${fleetName}`} busy={busy} error={error} onClose={() => setTransferOpen(false)} heading={<>Transfer fleet</>}>
        <p className="muted">Choose the destination hub. The fleet remains unavailable until the destination records receipt.</p>
        {hubsLoading && <p className="muted" role="status">Loading destination hubs…</p>}
        {!hubsLoading && !error && !destinationHubs.length && <p className="muted" role="status">No active destination hubs are available.</p>}
        {!hubsLoading && error && !hubs.length && <button type="button" className="secondary" onClick={() => void loadHubs()}>Retry loading hubs</button>}
        <form className="form-stack" onSubmit={(event) => void startTransfer(event)}>
          <label>Destination hub *<select required disabled={hubsLoading || (!hubs.length && Boolean(error)) || !destinationHubs.length} value={destinationHubId} onChange={(event) => setDestinationHubId(event.target.value)}><option value="">Select destination</option>{destinationHubs.map((hub) => <option key={hub.id} value={hub.id}>{hub.name}</option>)}</select></label>
          <div className="form-actions"><button disabled={busy || hubsLoading || (!hubs.length && Boolean(error)) || !destinationHubId}>{busy ? "Starting…" : "Start transfer"}</button><button type="button" className="secondary" disabled={busy} onClick={() => setTransferOpen(false)}>Cancel</button></div>
        </form>
      </ClientFormDialog>}
    </>
  );
}
