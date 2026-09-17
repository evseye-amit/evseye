"use client";

import { FormEvent, useEffect, useState } from "react";
import { OtpCodeInput } from "./components/otp-code-input";
import { UiIcon, type IconName } from "./components/ui-icon";
import { ClientDataTable, type ClientColumn } from "./components/client-data-table";
import { ClientUserManager, parseCsv } from "./components/client-user-manager";
import { ClientBulkImportWorkspace, type ClientImportHistoryEntry } from "./components/client-bulk-import-workspace";
import { ClientDeleteDialog, type ClientDeleteConfirmation } from "./components/client-delete-dialog";
import { ClientFormDialog } from "./components/client-form-dialog";

const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000/api/v1";
const ACCESS_TOKEN_KEY = "evs-eye-access-token";
const REFRESH_TOKEN_KEY = "evs-eye-refresh-token";
const AUTH_CHANGED_EVENT = "evs-eye-auth-changed";
const indianMobileInput = (value: string) =>
  value.replace(/\D/g, "").slice(-10);
type Tab =
  | "dashboard"
  | "fleets"
  | "riders"
  | "allocations"
  | "audit"
  | "locations"
  | "evidence"
  | "fleet-managers"
  | "team-leads"
  | "cluster-managers"
  | "iot-devices"
  | "batteries"
  | "fleet-iot-mapping"
  | "fleet-battery-mapping"
  | "deallocations"
  | "wallet"
  | "rider-fleet-mapping"
  | "rider-vendor-mapping"
  | "rider-earnings"
  | "zones"
  | "reports"
  | "feature-usage";
type PhotoRequirementEntityType =
  | "RIDER"
  | "FLEET"
  | "BATTERY"
  | "CONTROLLER"
  | "INSPECTION";
type RecordItem = Record<string, unknown>;
type ClientBulkTab = "fleet-managers" | "team-leads" | "locations" | "fleets" | "riders";
const CLIENT_BULK_CONFIG: Record<ClientBulkTab, { title: string; requiredColumns: string; template: string; resource: string; entityType: string }> = {
  "fleet-managers": { title: "Fleet Managers", requiredColumns: "name, mobile, hubCodes, primaryHubCode", template: "name,mobile,hubCodes,primaryHubCode\n", resource: "/client/users/fleet-managers", entityType: "FLEET_MANAGER" },
  "team-leads": { title: "Team Leads", requiredColumns: "name, mobile", template: "name,mobile,employeeCode,designation\n", resource: "/client/users/team-leaders", entityType: "TEAM_LEADER" },
  locations: { title: "Hubs", requiredColumns: "name, code, city, state", template: "name,code,city,state\n", resource: "/hubs", entityType: "HUB" },
  fleets: { title: "Fleets", requiredColumns: "chassisNumber, oemId, vehicleCategoryId, vehicleTypeId, speedType", template: "chassisNumber,oemId,vehicleCategoryId,vehicleTypeId,speedType,vehicleNumber\n", resource: "/fleets", entityType: "FLEET" },
  riders: { title: "Riders", requiredColumns: "name, mobile", template: "name,mobile,address\n", resource: "/riders", entityType: "RIDER" },
};

const CLIENT_NAVIGATION: Array<{
  label: string;
  items: Array<{ id: Tab; label: string }>;
}> = [
  { label: "", items: [{ id: "dashboard", label: "Dashboard" }] },
  {
    label: "User Management",
    items: [
      { id: "fleet-managers", label: "Fleet Manager" },
      { id: "team-leads", label: "Team Lead" },
      { id: "cluster-managers", label: "Cluster Manager" },
    ],
  },
  {
    label: "Vehicle Management",
    items: [
      { id: "fleets", label: "Fleet" },
      { id: "iot-devices", label: "IoT" },
      { id: "batteries", label: "Battery" },
      { id: "fleet-iot-mapping", label: "Fleet IoT Mapping" },
      { id: "fleet-battery-mapping", label: "Fleet Battery Mapping" },
      { id: "allocations", label: "Allocation" },
      { id: "deallocations", label: "Deallocation" },
      { id: "evidence", label: "Photos & Evidence" },
    ],
  },
  {
    label: "Rider Management",
    items: [
      { id: "riders", label: "Rider" },
      { id: "wallet", label: "Wallet" },
      { id: "rider-fleet-mapping", label: "Rider Fleet Mapping" },
      { id: "rider-vendor-mapping", label: "Rider Vendor Mapping" },
      { id: "rider-earnings", label: "Rider Earnings" },
    ],
  },
  {
    label: "Location",
    items: [
      { id: "locations", label: "Hub" },
      { id: "zones", label: "Zone" },
    ],
  },
  {
    label: "",
    items: [
      { id: "reports", label: "Reports" },
      { id: "audit", label: "Audit Log" },
      { id: "feature-usage", label: "Feature Usage" },
    ],
  },
];

const CLIENT_TAB_TITLES: Record<Tab, string> = {
  dashboard: "Dashboard",
  fleets: "Fleet",
  riders: "Rider",
  allocations: "Allocation",
  audit: "Audit Log",
  locations: "Hub",
  evidence: "Photos & Evidence",
  "fleet-managers": "Fleet Manager",
  "team-leads": "Team Lead",
  "cluster-managers": "Cluster Manager",
  "iot-devices": "IoT",
  batteries: "Battery",
  "fleet-iot-mapping": "Fleet IoT Mapping",
  "fleet-battery-mapping": "Fleet Battery Mapping",
  deallocations: "Deallocation",
  wallet: "Wallet",
  "rider-fleet-mapping": "Rider Fleet Mapping",
  "rider-vendor-mapping": "Rider Vendor Mapping",
  "rider-earnings": "Rider Earnings",
  zones: "Zone",
  reports: "Reports",
  "feature-usage": "Feature Usage",
};

const CLIENT_TAB_ICONS: Record<Tab, IconName> = {
  dashboard: "dashboard",
  fleets: "vehicle",
  riders: "user",
  allocations: "allocation",
  audit: "audit",
  locations: "location",
  evidence: "camera",
  "fleet-managers": "users",
  "team-leads": "teamLead",
  "cluster-managers": "clusterManager",
  "iot-devices": "iot",
  batteries: "battery",
  "fleet-iot-mapping": "link",
  "fleet-battery-mapping": "link",
  deallocations: "allocation",
  wallet: "wallet",
  "rider-fleet-mapping": "link",
  "rider-vendor-mapping": "link",
  "rider-earnings": "earnings",
  zones: "zone",
  reports: "reports",
  "feature-usage": "usage",
};

const ACTIVE_CLIENT_TABS = new Set<Tab>([
  "dashboard",
  "fleets",
  "riders",
  "allocations",
  "audit",
  "locations",
  "evidence",
  "fleet-managers",
  "team-leads",
  "iot-devices",
  "batteries",
]);

function oemLabel(value: unknown, fallback = "—") {
  if (typeof value === "string") return value || fallback;
  if (value && typeof value === "object") {
    const oem = value as RecordItem;
    const displayName = oem.displayName ?? oem.name ?? oem.code;
    if (typeof displayName === "string" && displayName.trim()) {
      return displayName;
    }
  }
  return fallback;
}

interface Dashboard {
  fleet: Record<string, number>;
  riders: Record<string, number>;
  kyc: Record<string, number>;
  operations: {
    allocationsToday: number;
    deallocationsToday: number;
    activeAllocations: number;
  };
  iot: { online: number; offline: number };
}

interface ApiBody {
  data?: unknown;
  message?: string;
  error?: {
    code?: string;
    message?: string;
  };
}

interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

let refreshInFlight: Promise<string | null> | null = null;

function normalizeDashboard(value: unknown): Dashboard {
  const data = value as Partial<Dashboard> | null;
  return {
    fleet: data?.fleet ?? {},
    riders: data?.riders ?? {},
    kyc: data?.kyc ?? {},
    operations: {
      allocationsToday: data?.operations?.allocationsToday ?? 0,
      deallocationsToday: data?.operations?.deallocationsToday ?? 0,
      activeAllocations: data?.operations?.activeAllocations ?? 0,
    },
    iot: {
      online: data?.iot?.online ?? 0,
      offline: data?.iot?.offline ?? 0,
    },
  };
}

async function sendRequest(
  path: string,
  options: RequestInit = {},
  token?: string,
) {
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      ...(options.body !== undefined
        ? { "Content-Type": "application/json" }
        : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });
  const body = (await response.json().catch(() => ({}))) as ApiBody;
  return { response, body };
}

async function refreshAccessToken(): Promise<string | null> {
  if (typeof window === "undefined") return null;
  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = (async () => {
    const refreshToken = sessionStorage.getItem(REFRESH_TOKEN_KEY);
    if (!refreshToken) return null;

    const { response, body } = await sendRequest("/auth/refresh", {
      method: "POST",
      body: JSON.stringify({ refreshToken }),
    });
    const tokens = body.data as Partial<TokenPair> | undefined;
    if (!response.ok || !tokens?.accessToken || !tokens.refreshToken) {
      sessionStorage.removeItem(ACCESS_TOKEN_KEY);
      sessionStorage.removeItem(REFRESH_TOKEN_KEY);
      window.dispatchEvent(new Event(AUTH_CHANGED_EVENT));
      return null;
    }

    sessionStorage.setItem(ACCESS_TOKEN_KEY, tokens.accessToken);
    sessionStorage.setItem(REFRESH_TOKEN_KEY, tokens.refreshToken);
    window.dispatchEvent(new Event(AUTH_CHANGED_EVENT));
    return tokens.accessToken;
  })().finally(() => {
    refreshInFlight = null;
  });

  return refreshInFlight;
}

async function request(
  path: string,
  options: RequestInit = {},
  token?: string,
) {
  let { response, body } = await sendRequest(path, options, token);
  if (response.status === 401 && token && path !== "/auth/refresh") {
    const refreshedToken = await refreshAccessToken();
    if (refreshedToken)
      ({ response, body } = await sendRequest(path, options, refreshedToken));
  }
  if (!response.ok) {
    const retryAfter = response.headers.get("retry-after");
    if (response.status === 429) {
      const waitMessage = retryAfter
        ? ` Please wait ${retryAfter} second${retryAfter === "1" ? "" : "s"} and try again.`
        : " Please wait a moment and try again.";
      throw new Error(`Too many requests.${waitMessage}`);
    }

    throw new Error(
      body.error?.message ??
        body.message ??
        "Request failed. Please try again.",
    );
  }
  return body.data;
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <article className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

function FleetHealthCard({ dashboard }: { dashboard: Dashboard }) {
  const fleetRows = [
    ["Available", dashboard.fleet.AVAILABLE ?? 0, "#21865d"],
    ["Allocated", dashboard.fleet.ALLOCATED ?? 0, "#2f80ed"],
    ["In use", dashboard.fleet.IN_USE ?? 0, "#7456d8"],
    ["Maintenance", dashboard.fleet.MAINTENANCE ?? 0, "#dd9b2a"],
    ["Offline", dashboard.fleet.OFFLINE ?? 0, "#bd5560"],
    ["Out of service", dashboard.fleet.OUT_OF_SERVICE ?? 0, "#6b7280"],
  ] as const;
  const maxFleet = Math.max(1, ...fleetRows.map(([, value]) => value));

  return (
    <article className="operations-chart-card operations-fleet-chart operations-fleet-overview">
      <header>
        <div>
          <p className="eyebrow">FLEET HEALTH</p>
          <h2>Fleet status distribution</h2>
        </div>
        <span>{Object.values(dashboard.fleet).reduce((sum, value) => sum + value, 0)} total</span>
      </header>
      <div className="bar-chart-list">
        {fleetRows.map(([label, value, color]) => (
          <div className="bar-chart-row" key={label}>
            <span>{label}</span>
            <div>
              <i style={{ width: `${(value / maxFleet) * 100}%`, background: color }} />
            </div>
            <b>{value}</b>
          </div>
        ))}
      </div>
    </article>
  );
}

function OperationsDashboardVisuals({ dashboard }: { dashboard: Dashboard }) {
  const riderTotal = Object.values(dashboard.riders).reduce(
    (sum, value) => sum + value,
    0,
  );
  const activeRiders = dashboard.riders.ACTIVE ?? 0;
  const activeRiderPercent = riderTotal
    ? Math.round((activeRiders / riderTotal) * 100)
    : 0;
  const telemetryTotal = dashboard.iot.online + dashboard.iot.offline;
  const onlinePercent = telemetryTotal
    ? Math.round((dashboard.iot.online / telemetryTotal) * 100)
    : 0;
  const operationRows = [
    ["Allocated today", dashboard.operations.allocationsToday, "#21865d"],
    ["Deallocated today", dashboard.operations.deallocationsToday, "#2f80ed"],
    ["Active now", dashboard.operations.activeAllocations, "#7456d8"],
  ] as const;
  const maxOperation = Math.max(1, ...operationRows.map(([, value]) => value));

  return (
    <section
      className="operations-visual-grid"
      aria-label="Operations visual summary"
    >
      <article className="operations-chart-card operations-readiness-chart">
        <header>
          <div>
            <p className="eyebrow">WORKFORCE</p>
            <h2>Rider readiness</h2>
          </div>
          <span>{riderTotal} total</span>
        </header>
        <div className="donut-summary">
          <div
            className="donut"
            style={{
              background: `conic-gradient(#21865d ${activeRiderPercent}%, #e8efea 0)`,
            }}
          >
            <strong>{activeRiderPercent}%</strong>
            <span>active</span>
          </div>
          <div>
            <p>
              <b>{activeRiders}</b> active Riders
            </p>
            <p>
              <b>{dashboard.kyc.VERIFIED ?? 0}</b> KYC verified
            </p>
            <p>
              <b>{dashboard.kyc.PENDING ?? 0}</b> KYC pending
            </p>
          </div>
        </div>
      </article>
      <article className="operations-chart-card operations-activity-chart">
        <header>
          <div>
            <p className="eyebrow">TODAY</p>
            <h2>Allocation activity</h2>
          </div>
        </header>
        <div className="activity-bars">
          {operationRows.map(([label, value, color]) => (
            <div key={label}>
              <span
                style={{
                  height: `${Math.max(value ? 14 : 4, (value / maxOperation) * 100)}%`,
                  background: color,
                }}
              />
              <b>{value}</b>
              <small>{label}</small>
            </div>
          ))}
        </div>
      </article>
      <article className="operations-chart-card operations-iot-chart">
        <header>
          <div>
            <p className="eyebrow">TELEMATICS</p>
            <h2>Device connectivity</h2>
          </div>
          <span>{telemetryTotal} devices</span>
        </header>
        <div className="connectivity">
          <strong>{onlinePercent}%</strong>
          <span>online now</span>
          <div>
            <i style={{ width: `${onlinePercent}%` }} />
          </div>
          <p>
            <b>{dashboard.iot.online}</b> online ·{" "}
            <b>{dashboard.iot.offline}</b> offline
          </p>
        </div>
      </article>
    </section>
  );
}

function Status({ value }: { value: string }) {
  return (
    <span
      className={`status status-${value.toLowerCase().replaceAll("_", "-")}`}
    >
      {value.replaceAll("_", " ")}
    </span>
  );
}

function clientColumns(tab: Tab): ClientColumn<RecordItem>[] {
  const text = (key: string, label: string, value: (row: RecordItem) => unknown): ClientColumn<RecordItem> => ({
    key, label, value: (row) => String(value(row) ?? "—"),
  });
  const status = (key: string, label: string, value: (row: RecordItem) => unknown): ClientColumn<RecordItem> => ({
    key, label, value: (row) => String(value(row) ?? "—"),
    render: (row) => <Status value={String(value(row) ?? "—")} />,
  });
  switch (tab) {
    case "audit": return [
      text("action", "Action", (row) => row.action),
      text("entity", "Entity", (row) => `${row.entityType ?? "—"}${row.entityId ? ` · ${row.entityId}` : ""}`),
      text("actor", "Actor", (row) => row.actorId ?? "System"),
      text("when", "When", (row) => new Date(String(row.createdAt)).toLocaleString()),
    ];
    case "fleet-managers": return [
      text("name", "Fleet Manager", (row) => row.name),
      text("mobile", "Mobile", (row) => row.mobile),
      text("hubs", "Assigned Hubs", (row) => ((row.hubAssignments as RecordItem[]) ?? []).map((assignment) => (assignment.hub as RecordItem | undefined)?.name).filter(Boolean).join(", ") || "—"),
      status("status", "Status", (row) => row.isActive === false ? "INACTIVE" : "ACTIVE"),
    ];
    case "team-leads": return [
      text("name", "Team Lead", (row) => (row.user as RecordItem | undefined)?.name),
      text("mobile", "Mobile", (row) => (row.user as RecordItem | undefined)?.mobile),
      text("employeeCode", "Employee code", (row) => row.employeeCode),
      text("designation", "Designation", (row) => row.designation),
    ];
    case "iot-devices": return [
      text("device", "Device", (row) => row.deviceNumber),
      text("fleet", "Fleet", (row) => (row.currentFleet as RecordItem | undefined)?.fleetCode ?? (row.currentFleet as RecordItem | undefined)?.vehicleNumber ?? "Unassigned"),
      status("status", "Status", (row) => row.status),
      text("heartbeat", "Last heartbeat", (row) => {
        const state = row.currentState as RecordItem | undefined;
        const heartbeat = state?.lastHeartbeatAt ?? row.lastHeartbeatAt;
        return heartbeat ? new Date(String(heartbeat)).toLocaleString() : "Not received";
      }),
    ];
    case "batteries": return [
      text("battery", "Battery", (row) => row.batteryCode ?? row.serialNumber),
      text("type", "Type", (row) => String(row.batteryType ?? "—").replaceAll("_", " ")),
      text("fleet", "Fleet", (row) => {
        const assignment = ((row.fleetHistory as RecordItem[]) ?? [])[0];
        const fleet = assignment?.fleet as RecordItem | undefined;
        return fleet?.fleetCode ?? fleet?.vehicleNumber ?? "Unassigned";
      }),
      status("status", "Status", (row) => row.status),
    ];
    case "fleets": return [
      text("vehicle", "Vehicle", (row) => row.vehicleNumber),
      text("oem", "OEM", (row) => oemLabel(row.oem)),
      status("status", "Status", (row) => row.status),
      text("hub", "Hub", (row) => (row.hub as RecordItem | undefined)?.name),
    ];
    case "riders": return [
      text("name", "Rider", (row) => row.name),
      text("mobile", "Mobile", (row) => row.mobile),
      status("status", "Status", (row) => row.status),
    ];
    default: return [
      text("fleet", "Fleet", (row) => (row.fleet as RecordItem | undefined)?.vehicleNumber),
      text("rider", "Rider", (row) => (row.rider as RecordItem | undefined)?.name),
      status("status", "Status", (row) => row.status),
      text("created", "Created", (row) => new Date(String(row.createdAt)).toLocaleDateString()),
    ];
  }
}

export default function Home() {
  const [phone, setPhone] = useState("");
  const [companyCode, setCompanyCode] = useState("");
  const [otpRequestId, setOtpRequestId] = useState("");
  const [code, setCode] = useState("");
  const [token, setToken] = useState("");
  const [tab, setTab] = useState<Tab>("dashboard");
  const [expandedClientNavGroups, setExpandedClientNavGroups] = useState<Record<string, boolean>>({});
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [items, setItems] = useState<RecordItem[]>([]);
  const [availableFleets, setAvailableFleets] = useState<RecordItem[]>([]);
  const [activeRiders, setActiveRiders] = useState<RecordItem[]>([]);
  const [allocationFleetId, setAllocationFleetId] = useState("");
  const [allocationRiderId, setAllocationRiderId] = useState("");
  const [showAllocationForm, setShowAllocationForm] = useState(false);
  const [showRiderForm, setShowRiderForm] = useState(false);
  const [newRiderName, setNewRiderName] = useState("");
  const [newRiderMobile, setNewRiderMobile] = useState("");
  const [newRiderAddress, setNewRiderAddress] = useState("");
  const [showFleetForm, setShowFleetForm] = useState(false);
  const [hubs, setHubs] = useState<RecordItem[]>([]);
  const [newHub, setNewHub] = useState({ name: "", code: "", city: "", state: "" });
  const [editingHubId, setEditingHubId] = useState("");
  const [showHubForm, setShowHubForm] = useState(false);
  const [bulkImportTab, setBulkImportTab] = useState<ClientBulkTab | null>(null);
  const [bulkHistory, setBulkHistory] = useState<Array<ClientImportHistoryEntry & { tab: ClientBulkTab }>>([]);
  const [bulkHistoryLoading, setBulkHistoryLoading] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState<ClientDeleteConfirmation | null>(null);
  const [newFleet, setNewFleet] = useState({
    vehicleNumber: "",
    chassisNumber: "",
    hubId: "",
    oem: "",
    model: "",
    colour: "",
    vehicleType: "",
    motorNumber: "",
    registrationDate: "",
    insuranceStartDate: "",
    insuranceEndDate: "",
    fitnessRenewalDate: "",
  });
  const [inspectionId, setInspectionId] = useState("");
  const [inspectionType, setInspectionType] = useState("PRE_ALLOCATION");
  const [requirements, setRequirements] = useState<RecordItem[]>([]);
  const [configuredRequirements, setConfiguredRequirements] = useState<
    RecordItem[]
  >([]);
  const [photoRequirementEntityType, setPhotoRequirementEntityType] =
    useState<PhotoRequirementEntityType>("INSPECTION");
  const [newRequirementType, setNewRequirementType] = useState("");
  const [newRequirementRequired, setNewRequirementRequired] = useState(true);
  const [uploadedPhotoTypes, setUploadedPhotoTypes] = useState<string[]>([]);
  const [inspectionPhotoProgress, setInspectionPhotoProgress] = useState<
    Record<string, number>
  >({});
  const [requiredInspectionPhotos, setRequiredInspectionPhotos] = useState(0);
  const [deallocationId, setDeallocationId] = useState("");
  const [riderPhone, setRiderPhone] = useState("");
  const [operatorPhone, setOperatorPhone] = useState("");
  const [otpRequests, setOtpRequests] = useState<Record<string, string>>({});
  const [otpCodes, setOtpCodes] = useState<Record<string, string>>({});
  const [verifiedParties, setVerifiedParties] = useState<string[]>([]);
  const [allocationDetail, setAllocationDetail] = useState<RecordItem | null>(
    null,
  );
  const [vehicleState, setVehicleState] = useState<RecordItem | null>(null);
  const [riderDetail, setRiderDetail] = useState<RecordItem | null>(null);
  const [editingRider, setEditingRider] = useState(false);
  const [riderDraft, setRiderDraft] = useState({
    name: "",
    mobile: "",
    address: "",
    status: "PENDING",
  });
  const [fleetDetail, setFleetDetail] = useState<RecordItem | null>(null);
  const [editingFleet, setEditingFleet] = useState(false);
  const [fleetDraft, setFleetDraft] = useState({ vehicleNumber: "", chassisNumber: "", modelName: "", colour: "", motorNumber: "" });
  const [fleetOnboardingStatus, setFleetOnboardingStatus] =
    useState<RecordItem | null>(null);
  const [fleetPhotoRequirements, setFleetPhotoRequirements] = useState<
    RecordItem[]
  >([]);
  const [uploadedFleetPhotoTypes, setUploadedFleetPhotoTypes] = useState<
    string[]
  >([]);
  const [componentPhotoRequirements, setComponentPhotoRequirements] = useState<
    Record<string, RecordItem[]>
  >({});
  const [uploadedComponentPhotoTypes, setUploadedComponentPhotoTypes] =
    useState<Record<string, string[]>>({});
  const [iotDeviceNumber, setIotDeviceNumber] = useState("");
  const [iotFleetId, setIotFleetId] = useState("");
  const [iotFleetOptions, setIotFleetOptions] = useState<RecordItem[]>([]);
  const [showIotForm, setShowIotForm] = useState(false);
  const [componentForm, setComponentForm] = useState<"batteries" | "controllers" | null>(null);
  const [componentSerial, setComponentSerial] = useState("");
  const [showDetailIotForm, setShowDetailIotForm] = useState(false);
  const [showPhotoTypeForm, setShowPhotoTypeForm] = useState(false);
  const [ingestSecret, setIngestSecret] = useState("");
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    const syncToken = () => {
      const saved = sessionStorage.getItem(ACCESS_TOKEN_KEY) ?? "";
      setToken(saved);
    };
    const timer = window.setTimeout(syncToken, 0);
    window.addEventListener(AUTH_CHANGED_EVENT, syncToken);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener(AUTH_CHANGED_EVENT, syncToken);
    };
  }, []);

  useEffect(() => {
    if (!token) return;
    void request("/auth/me", {}, token)
      .then(async (identity) => {
        const roles = (identity as { roles?: string[] }).roles ?? [];
        // Incomplete Client onboarding stays guided; active Clients use this
        // single full operations console as their dashboard.
        const openOperations =
          new URLSearchParams(window.location.search).get("workspace") ===
          "operations";
        if (roles.includes("CLIENT_ADMIN") && !openOperations) {
          const bootstrap = (await request("/client/bootstrap", {}, token)) as {
            route?: string;
          };
          if (bootstrap.route !== "DASHBOARD") {
            window.location.replace("/client");
          }
        }
      })
      .catch(() => undefined);
  }, [token]);

  useEffect(() => {
    if (!token) return;
    void loadView(tab);
    // Loading belongs to the selected view and intentionally runs after sign-in/tab change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, tab]);

  async function loadView(nextTab: Tab) {
    if (!ACTIVE_CLIENT_TABS.has(nextTab)) {
      setItems([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    try {
      if (nextTab === "dashboard")
        setDashboard(
          normalizeDashboard(await request("/dashboard", {}, token)),
        );
      else if (nextTab === "fleet-managers") {
        const [fleetManagers, hubList] = await Promise.all([
          request("/client/users/fleet-managers", {}, token),
          request("/hubs", {}, token),
        ]) as [RecordItem[], RecordItem[]];
        setItems(fleetManagers);
        setHubs(hubList);
      } else if (nextTab === "team-leads") {
        const teamLeaders = (await request(
          "/client/users/team-leaders",
          {},
          token,
        )) as RecordItem[];
        setItems(teamLeaders);
      } else if (nextTab === "iot-devices") {
        const [devices, firstFleets] = await Promise.all([
          request("/iot/devices", {}, token),
          request("/fleets?page=1&pageSize=100", {}, token),
        ]) as [RecordItem[], { items: RecordItem[]; meta: { total: number } }];
        const fleets = [...firstFleets.items];
        for (let fleetPage = 2; fleets.length < firstFleets.meta.total; fleetPage += 1) {
          const result = await request(`/fleets?page=${fleetPage}&pageSize=100`, {}, token) as { items: RecordItem[] };
          if (!result.items.length) break;
          fleets.push(...result.items);
        }
        setItems(devices);
        setIotFleetOptions(fleets);
      } else if (nextTab === "batteries") {
        const batteries = (await request(
          "/fleets/batteries",
          {},
          token,
        )) as RecordItem[];
        setItems(batteries);
      } else if (nextTab === "locations") {
        setHubs((await request("/hubs", {}, token)) as RecordItem[]);
      } else if (nextTab === "evidence") {
        await loadPhotoRequirements(photoRequirementEntityType);
      } else {
        const resource = nextTab === "audit" ? "/audit-logs" : `/${nextTab}`;
        const first = (await request(`${resource}?page=1&pageSize=100`, {}, token)) as { items: RecordItem[]; meta: { total: number } };
        const all = [...first.items];
        const pageCount = Math.ceil(first.meta.total / 100);
        for (let start = 2; start <= pageCount; start += 5) {
          const pages = await Promise.all(Array.from({ length: Math.min(5, pageCount - start + 1) }, (_, index) =>
            request(`${resource}?page=${start + index}&pageSize=100`, {}, token) as Promise<{ items: RecordItem[] }>));
          pages.forEach((result) => all.push(...result.items));
        }
        setItems(all);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to load data.");
    } finally {
      setLoading(false);
    }
  }

  function navigateTo(nextTab: Tab) {
    if (nextTab === "dashboard") setExpandedClientNavGroups({});
    setShowAllocationForm(false);
    setShowRiderForm(false);
    setShowFleetForm(false);
    setShowIotForm(false);
    setComponentForm(null);
    setShowDetailIotForm(false);
    setShowPhotoTypeForm(false);
    setShowHubForm(false);
    setBulkImportTab(null);
    setInspectionId("");
    setDeallocationId("");
    setRiderDetail(null);
    setFleetDetail(null);
    setFleetOnboardingStatus(null);
    setEditingRider(false);
    setIngestSecret("");
    setNotice("");
    setError("");
    setTab(nextTab);
  }

  async function sendOtp(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      const data = (await request("/auth/otp/request", {
        method: "POST",
        body: JSON.stringify({ phone, companyCode }),
      })) as { otpRequestId: string };
      setOtpRequestId(data.otpRequestId);
      setNotice("OTP sent successfully. Enter the six-digit code below to continue.");
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Unable to request OTP.",
      );
    } finally {
      setLoading(false);
    }
  }

  async function verifyOtp(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      const data = (await request("/auth/otp/verify", {
        method: "POST",
        body: JSON.stringify({ otpRequestId, code }),
      })) as TokenPair;
      sessionStorage.setItem(ACCESS_TOKEN_KEY, data.accessToken);
      sessionStorage.setItem(REFRESH_TOKEN_KEY, data.refreshToken);
      const identity = (await request("/auth/me", {}, data.accessToken)) as {
        clientId: string | null;
        roles: string[];
      };
      if (identity.roles.includes("SUPER_ADMIN")) {
        window.location.replace("/platform/dashboard");
        return;
      }
      if (identity.roles.includes("CLIENT_ADMIN")) {
        window.location.replace("/client");
        return;
      }
      setToken(data.accessToken);
      setNotice("");
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Unable to verify OTP.",
      );
    } finally {
      setLoading(false);
    }
  }

  async function openAllocationForm() {
    setLoading(true);
    setError("");
    try {
      const [fleets, riders] = await Promise.all([
        request(
          "/fleets?status=AVAILABLE&page=1&pageSize=100",
          {},
          token,
        ) as Promise<{ items: RecordItem[] }>,
        request(
          "/riders?status=ACTIVE&page=1&pageSize=100",
          {},
          token,
        ) as Promise<{ items: RecordItem[] }>,
      ]);
      setAvailableFleets(fleets.items);
      setActiveRiders(riders.items);
      setShowAllocationForm(true);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Unable to load allocation options.",
      );
    } finally {
      setLoading(false);
    }
  }

  async function createRider(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      await request(
        "/riders",
        {
          method: "POST",
          body: JSON.stringify({
            name: newRiderName,
            mobile: newRiderMobile,
            ...(newRiderAddress ? { address: newRiderAddress } : {}),
          }),
        },
        token,
      );
      setShowRiderForm(false);
      setNewRiderName("");
      setNewRiderMobile("");
      setNewRiderAddress("");
      setNotice(
        "Rider created. Add a profile photo and start KYC from rider detail.",
      );
      await loadView("riders");
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Unable to create rider.",
      );
    } finally {
      setLoading(false);
    }
  }

  async function createFleet(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      await request(
        "/fleets",
        {
          method: "POST",
          body: JSON.stringify(
            Object.fromEntries(
              Object.entries(newFleet).filter(([, value]) => value !== ""),
            ),
          ),
        },
        token,
      );
      setShowFleetForm(false);
      setNewFleet({
        vehicleNumber: "",
        chassisNumber: "",
        hubId: "",
        oem: "",
        model: "",
        colour: "",
        vehicleType: "",
        motorNumber: "",
        registrationDate: "",
        insuranceStartDate: "",
        insuranceEndDate: "",
        fitnessRenewalDate: "",
      });
      setNotice(
        "Fleet created. Add components, photos, and IoT device from fleet detail.",
      );
      await loadView("fleets");
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Unable to create fleet.",
      );
    } finally {
      setLoading(false);
    }
  }

  async function openFleetForm() {
    setLoading(true);
    setError("");
    try {
      setHubs((await request("/hubs", {}, token)) as RecordItem[]);
      setShowFleetForm(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to load hubs.");
    } finally {
      setLoading(false);
    }
  }

  async function createHub(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      await request(
        editingHubId ? `/hubs/${editingHubId}` : "/hubs",
        { method: editingHubId ? "PATCH" : "POST", body: JSON.stringify(newHub) },
        token,
      );
      setNewHub({ name: "", code: "", city: "", state: "" });
      setEditingHubId("");
      setShowHubForm(false);
      setNotice(editingHubId ? "Hub updated." : "Hub created.");
      await loadView("locations");
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Unable to create hub.",
      );
    } finally {
      setLoading(false);
    }
  }

  async function loadBulkHistory(kind: ClientBulkTab) {
    setBulkHistoryLoading(true);
    try {
      const jobs = await request(`/client/users/import-history?entityType=${CLIENT_BULK_CONFIG[kind].entityType}`, {}, token) as Array<{ id: string; originalFilename: string; createdAt: string; status: string; totalRows: number; passedRows: number; failedRows: number }>;
      setBulkHistory((current) => [...current.filter((entry) => entry.tab !== kind), ...jobs.map((job) => ({ id: job.id, tab: kind, jobId: job.id, fileName: job.originalFilename, createdAt: job.createdAt, status: job.status, totalRows: job.totalRows, passedRows: job.passedRows, failedRows: job.failedRows }))]);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to load import history."); }
    finally { setBulkHistoryLoading(false); }
  }

  function openBulkImport(kind: ClientBulkTab) {
    setError(""); setNotice(""); setBulkImportTab(kind);
    void loadBulkHistory(kind);
  }

  async function uploadBulkRecords(kind: ClientBulkTab, file: File) {
    setLoading(true); setError("");
    try {
      if (file.size > 5 * 1024 * 1024) throw new Error("CSV must be 5 MB or smaller.");
      const csv = parseCsv(await file.text());
      const headers = csv.shift()?.map((field) => field.trim()) ?? [];
      const required = CLIENT_BULK_CONFIG[kind].requiredColumns.split(", ");
      if (!required.every((field) => headers.includes(field))) throw new Error(`CSV requires columns: ${required.join(", ")}.`);
      let rows = csv.map((values) => Object.fromEntries(headers.map((field, index) => [field, values[index]?.trim() ?? ""]).filter(([, value]) => value !== "")));
      if (!rows.length) throw new Error("CSV contains no records.");
      if (rows.length > 1000) throw new Error("Import up to 1,000 rows at a time.");
      if (kind === "fleet-managers") {
        const byCode = new Map(hubs.map((hub) => [String(hub.code).trim().toUpperCase(), String(hub.id)]));
        rows = rows.map((row, index) => {
          const codes = String(row.hubCodes ?? "").split(";").map((code) => code.trim().toUpperCase()).filter(Boolean);
          const primaryCode = String(row.primaryHubCode ?? "").trim().toUpperCase();
          const unknown = codes.filter((code) => !byCode.has(code));
          if (unknown.length) throw new Error(`Row ${index + 2}: Unknown hub code ${unknown.join(", ")}.`);
          if (!codes.includes(primaryCode)) throw new Error(`Row ${index + 2}: Primary hub code must be one of the assigned hub codes.`);
          return { name: row.name, mobile: row.mobile, hubIds: codes.map((code) => byCode.get(code)), primaryHubId: byCode.get(primaryCode) };
        });
      }
      const result = await request(`${CLIENT_BULK_CONFIG[kind].resource}/bulk`, { method: "POST", body: JSON.stringify({ filename: file.name, rows }) }, token) as RecordItem;
      const passedRows = Number(result.passedRows ?? result.createdRows ?? 0);
      const failedRows = Number(result.failedRows ?? 0);
      await Promise.all([loadView(kind), loadBulkHistory(kind)]);
      setNotice(`Bulk upload complete: ${passedRows} passed, ${failedRows} failed.`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to import CSV."); }
    finally { setLoading(false); }
  }

  async function downloadBulkFailures(kind: ClientBulkTab, jobId: string) {
    setError("");
    try {
      const path = `${CLIENT_BULK_CONFIG[kind].resource}/imports/${jobId}/failed-records`;
      let response = await fetch(`${API_URL}${path}`, { headers: { Authorization: `Bearer ${token}` } });
      if (response.status === 401) {
        const refreshed = await refreshAccessToken();
        if (refreshed) response = await fetch(`${API_URL}${path}`, { headers: { Authorization: `Bearer ${refreshed}` } });
      }
      if (!response.ok) throw new Error("Unable to download failed records.");
      const url = URL.createObjectURL(new Blob([await response.text()], { type: "text/csv" }));
      const link = document.createElement("a"); link.href = url; link.download = `${kind}-failed-records.csv`; link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to download failed records."); }
  }

  async function deleteHub(id: string) {
    setLoading(true); setError("");
    try { await request(`/hubs/${id}`, { method: "DELETE" }, token); await loadView("locations"); setNotice("Hub deleted."); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to delete hub."); }
    finally { setLoading(false); }
  }

  async function savePhotoRequirement(
    photoType: string,
    isRequired: boolean,
    sortOrder: number,
  ) {
    setLoading(true);
    setError("");
    try {
      const requirement = (await request(
        `/media/photo-requirements/${photoRequirementEntityType}/${photoType}`,
        {
          method: "PUT",
          body: JSON.stringify({ isRequired, sortOrder }),
        },
        token,
      )) as RecordItem;
      setConfiguredRequirements((current) => {
        const existingIndex = current.findIndex(
          (item) => String(item.photoType) === photoType,
        );
        if (existingIndex === -1) return [...current, requirement];
        return current.map((item) =>
          String(item.photoType) === photoType ? requirement : item,
        );
      });
      return true;
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Unable to save photo requirement.",
      );
      return false;
    } finally {
      setLoading(false);
    }
  }

  async function addPhotoRequirement(event: FormEvent) {
    event.preventDefault();
    const photoType = newRequirementType.trim().toUpperCase();
    if (!photoType) return;
    const saved = await savePhotoRequirement(
      photoType,
      newRequirementRequired,
      configuredRequirements.length,
    );
    if (saved) {
      setNewRequirementType("");
      setNewRequirementRequired(true);
      setShowPhotoTypeForm(false);
    }
  }

  async function loadPhotoRequirements(entityType: PhotoRequirementEntityType) {
    setLoading(true);
    setError("");
    try {
      setConfiguredRequirements(
        (await request(
          `/media/photo-requirements?entityType=${entityType}`,
          {},
          token,
        )) as RecordItem[],
      );
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Unable to load photo requirements.",
      );
    } finally {
      setLoading(false);
    }
  }

  async function addFleetComponent(
    fleetId: string,
    component: "batteries" | "controllers",
    serialNumber: string,
  ) {
    if (!serialNumber) return;
    setLoading(true);
    setError("");
    try {
      await request(
        `/fleets/${fleetId}/${component}`,
        { method: "POST", body: JSON.stringify({ serialNumber }) },
        token,
      );
      setNotice(
        `${component === "batteries" ? "Battery" : "Controller"} added.`,
      );
      await openFleetDetail(fleetId);
      setComponentForm(null);
      setComponentSerial("");
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Unable to add component.",
      );
    } finally {
      setLoading(false);
    }
  }

  async function registerIotDevice(fleetId: string) {
    setLoading(true);
    setError("");
    try {
      const data = (await request(
        "/iot/devices",
        {
          method: "POST",
          body: JSON.stringify({ fleetId, deviceNumber: iotDeviceNumber }),
        },
        token,
      )) as { ingestSecret: string };
      setIngestSecret(data.ingestSecret);
      setIotDeviceNumber("");
      setNotice(
        "IoT device registered. Save the ingestion secret now; it is shown only once.",
      );
      if (tab === "iot-devices") { setShowIotForm(false); await loadView("iot-devices"); }
      setShowDetailIotForm(false);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Unable to register IoT device.",
      );
    } finally {
      setLoading(false);
    }
  }

  async function createAllocation(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      const allocation = (await request(
        "/allocations",
        {
          method: "POST",
          headers: { "Idempotency-Key": crypto.randomUUID() },
          body: JSON.stringify({
            fleetId: allocationFleetId,
            riderId: allocationRiderId,
          }),
        },
        token,
      )) as { id: string };
      setShowAllocationForm(false);
      setAllocationFleetId("");
      setAllocationRiderId("");
      setTab("allocations");
      setNotice(
        `Allocation ${allocation.id.slice(0, 8)} created. Complete its pre-allocation inspection before activation.`,
      );
      await loadView("allocations");
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Unable to create allocation.",
      );
    } finally {
      setLoading(false);
    }
  }

  async function openInspection(allocation: RecordItem) {
    const targetType =
      allocation.status === "DEALLOCATION_INITIATED"
        ? "POST_DEALLOCATION"
        : "PRE_ALLOCATION";
    const inspection = (
      (allocation.inspections as RecordItem[] | undefined) ?? []
    ).find((item) => item.type === targetType);
    if (!inspection?.id)
      return setError(
        `This allocation has no ${targetType.toLowerCase().replaceAll("_", " ")} inspection.`,
      );
    setLoading(true);
    setError("");
    try {
      const [details, photoRequirements] = await Promise.all([
        request(`/inspections/${String(inspection.id)}`, {}, token) as Promise<{
          photos: RecordItem[];
        }>,
        request(
          "/media/photo-requirements?entityType=INSPECTION",
          {},
          token,
        ) as Promise<RecordItem[]>,
      ]);
      setInspectionId(String(inspection.id));
      setInspectionType(targetType);
      setRequirements(photoRequirements);
      setUploadedPhotoTypes(
        details.photos
          .filter((photo) => photo.status === "COMPLETE")
          .map((photo) => String(photo.photoType)),
      );
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Unable to open inspection.",
      );
    } finally {
      setLoading(false);
    }
  }

  async function uploadInspectionPhoto(
    photoType: string,
    file: File | undefined,
  ) {
    if (!file) return;
    if (
      !["image/jpeg", "image/png", "image/webp"].includes(file.type) ||
      file.size > 5 * 1024 * 1024
    ) {
      setError("Use a JPG, PNG, or WebP image no larger than 5 MB.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const intent = (await request(
        "/media/upload-intents",
        {
          method: "POST",
          body: JSON.stringify({
            entityType: "INSPECTION",
            entityId: inspectionId,
            photoType,
            mimeType: file.type,
            fileName: file.name,
            sizeBytes: file.size,
          }),
        },
        token,
      )) as { photo: { id: string }; uploadUrl: string };
      const upload = await fetch(intent.uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": file.type },
        body: file,
      });
      if (!upload.ok)
        throw new Error("Object storage rejected the file upload.");
      await request(
        `/media/${intent.photo.id}/complete`,
        { method: "POST" },
        token,
      );
      setUploadedPhotoTypes((current) => [...new Set([...current, photoType])]);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Unable to upload inspection photo.",
      );
    } finally {
      setLoading(false);
    }
  }

  async function completeInspection() {
    setLoading(true);
    setError("");
    try {
      await request(
        `/inspections/${inspectionId}/complete`,
        { method: "POST" },
        token,
      );
      setNotice(
        inspectionType === "POST_DEALLOCATION"
          ? "Post-deallocation inspection completed. Verify both OTPs to finish."
          : "Inspection completed. The allocation is ready for activation.",
      );
      setInspectionId("");
      await loadView("allocations");
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Inspection cannot be completed yet.",
      );
    } finally {
      setLoading(false);
    }
  }

  async function activateAllocation(allocationId: string) {
    setLoading(true);
    setError("");
    try {
      await request(
        `/allocations/${allocationId}/activate`,
        { method: "POST" },
        token,
      );
      setNotice("Allocation activated and fleet marked as allocated.");
      await loadView("allocations");
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Allocation cannot be activated.",
      );
    } finally {
      setLoading(false);
    }
  }

  async function openAllocationDetail(allocationId: string) {
    setLoading(true);
    setError("");
    try {
      const detail = (await request(
        `/allocations/${allocationId}`,
        {},
        token,
      )) as RecordItem;
      setAllocationDetail(detail);
      const fleet = detail.fleet as RecordItem;
      const inspections =
        (detail.inspections as RecordItem[] | undefined) ?? [];
      const [currentState, photoRequirements, inspectionDetails] =
        await Promise.all([
          request(
            `/fleets/${String(fleet.id)}/current-state`,
            {},
            token,
          ) as Promise<RecordItem | null>,
          request(
            "/media/photo-requirements?entityType=INSPECTION",
            {},
            token,
          ) as Promise<RecordItem[]>,
          Promise.all(
            inspections.map(async (inspection) => {
              const details = (await request(
                `/inspections/${String(inspection.id)}`,
                {},
                token,
              )) as { photos: RecordItem[] };
              return [
                String(inspection.id),
                details.photos.filter((photo) => photo.status === "COMPLETE")
                  .length,
              ] as const;
            }),
          ),
        ]);
      setVehicleState(currentState);
      setRequiredInspectionPhotos(
        photoRequirements.filter((requirement) => requirement.isRequired)
          .length,
      );
      setInspectionPhotoProgress(Object.fromEntries(inspectionDetails));
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Unable to load allocation details.",
      );
    } finally {
      setLoading(false);
    }
  }

  async function openRiderDetail(riderId: string) {
    setLoading(true);
    setError("");
    try {
      const rider = (await request(
        `/riders/${riderId}`,
        {},
        token,
      )) as RecordItem;
      setRiderDetail(rider);
      setRiderDraft({
        name: String(rider.name ?? ""),
        mobile: String(rider.mobile ?? ""),
        address: String(rider.address ?? ""),
        status: String(rider.status ?? "PENDING"),
      });
      setEditingRider(false);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Unable to load rider details.",
      );
    } finally {
      setLoading(false);
    }
  }

  async function updateRider(event: FormEvent) {
    event.preventDefault();
    if (!riderDetail) return;
    setLoading(true);
    setError("");
    try {
      await request(
        `/riders/${String(riderDetail.id)}`,
        {
          method: "PATCH",
          body: JSON.stringify(riderDraft),
        },
        token,
      );
      setNotice("Rider updated.");
      await openRiderDetail(String(riderDetail.id));
      await loadView("riders");
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Unable to update rider.",
      );
    } finally {
      setLoading(false);
    }
  }

  async function openFleetDetail(fleetId: string) {
    setLoading(true);
    setError("");
    try {
      const [fleet, currentState, onboardingStatus, photoRequirements, photos] =
        await Promise.all([
          request(`/fleets/${fleetId}`, {}, token) as Promise<RecordItem>,
          request(
            `/fleets/${fleetId}/current-state`,
            {},
            token,
          ) as Promise<RecordItem | null>,
          request(
            `/fleets/${fleetId}/onboarding-status`,
            {},
            token,
          ) as Promise<RecordItem>,
          request(
            "/media/photo-requirements?entityType=FLEET",
            {},
            token,
          ) as Promise<RecordItem[]>,
          request(
            `/media/photos?entityType=FLEET&entityId=${fleetId}`,
            {},
            token,
          ) as Promise<RecordItem[]>,
        ]);
      setFleetDraft({ vehicleNumber: String(fleet.vehicleNumber ?? ""), chassisNumber: String(fleet.chassisNumber ?? ""), modelName: String(fleet.modelName ?? ""), colour: String(fleet.colour ?? ""), motorNumber: String(fleet.motorNumber ?? "") });
      setEditingFleet(false);
      setFleetDetail(fleet);
      setVehicleState(currentState);
      setFleetOnboardingStatus(onboardingStatus);
      setFleetPhotoRequirements(photoRequirements);
      setUploadedFleetPhotoTypes(
        photos
          .filter((photo) => photo.status === "COMPLETE")
          .map((photo) => String(photo.photoType)),
      );
      const [batteryRequirements, controllerRequirements] = await Promise.all([
        request(
          "/media/photo-requirements?entityType=BATTERY",
          {},
          token,
        ) as Promise<RecordItem[]>,
        request(
          "/media/photo-requirements?entityType=CONTROLLER",
          {},
          token,
        ) as Promise<RecordItem[]>,
      ]);
      setComponentPhotoRequirements({
        BATTERY: batteryRequirements,
        CONTROLLER: controllerRequirements,
      });
      const components = [
        ...((fleet.batteries as RecordItem[]) ?? []).map((component) => ({
          entityType: "BATTERY" as const,
          id: String(component.id),
        })),
        ...((fleet.controllers as RecordItem[]) ?? []).map((component) => ({
          entityType: "CONTROLLER" as const,
          id: String(component.id),
        })),
      ];
      const componentPhotos = await Promise.all(
        components.map(async (component) => ({
          key: `${component.entityType}:${component.id}`,
          photos: (await request(
            `/media/photos?entityType=${component.entityType}&entityId=${component.id}`,
            {},
            token,
          )) as RecordItem[],
        })),
      );
      setUploadedComponentPhotoTypes(
        Object.fromEntries(
          componentPhotos.map(({ key, photos: componentPhotoItems }) => [
            key,
            componentPhotoItems
              .filter((photo) => photo.status === "COMPLETE")
              .map((photo) => String(photo.photoType)),
          ]),
        ),
      );
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Unable to load fleet details.",
      );
    } finally {
      setLoading(false);
    }
  }

  async function refreshFleetOnboardingStatus(fleetId: string) {
    setFleetOnboardingStatus(
      (await request(
        `/fleets/${fleetId}/onboarding-status`,
        {},
        token,
      )) as RecordItem,
    );
  }

  async function saveFleet(event: FormEvent) {
    event.preventDefault();
    if (!fleetDetail) return;
    setLoading(true); setError("");
    try {
      await request(`/fleets/${String(fleetDetail.id)}`, { method: "PATCH", body: JSON.stringify(fleetDraft) }, token);
      await openFleetDetail(String(fleetDetail.id)); await loadView("fleets");
      setNotice("Fleet updated.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to update fleet."); }
    finally { setLoading(false); }
  }

  async function deleteFleet(id: string) {
    setLoading(true); setError("");
    try { await request(`/fleets/${id}`, { method: "DELETE" }, token); setFleetDetail(null); await loadView("fleets"); setNotice("Fleet deleted."); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to delete fleet."); }
    finally { setLoading(false); }
  }
  async function deleteRider(id: string) {
    setLoading(true); setError("");
    try { await request(`/riders/${id}`, { method: "DELETE" }, token); setRiderDetail(null); await loadView("riders"); setNotice("Rider deleted."); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to delete rider."); }
    finally { setLoading(false); }
  }

  async function startKyc(
    riderId: string,
    type: "AADHAAR" | "PAN" | "BANK_ACCOUNT",
  ) {
    setLoading(true);
    setError("");
    try {
      await request(
        `/riders/${riderId}/kyc`,
        { method: "POST", body: JSON.stringify({ type }) },
        token,
      );
      setNotice(`${type.replaceAll("_", " ")} verification started.`);
      await openRiderDetail(riderId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to start KYC.");
    } finally {
      setLoading(false);
    }
  }

  async function uploadRiderPhoto(riderId: string, file: File | undefined) {
    if (!file) return;
    setLoading(true);
    setError("");
    try {
      const intent = (await request(
        "/media/upload-intents",
        {
          method: "POST",
          body: JSON.stringify({
            entityType: "RIDER",
            entityId: riderId,
            photoType: "PROFILE",
            mimeType: file.type,
            fileName: file.name,
            sizeBytes: file.size,
          }),
        },
        token,
      )) as { photo: { id: string }; uploadUrl: string };
      const result = await fetch(intent.uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": file.type },
        body: file,
      });
      if (!result.ok)
        throw new Error("Object storage rejected the file upload.");
      await request(
        `/media/${intent.photo.id}/complete`,
        { method: "POST" },
        token,
      );
      setNotice("Rider profile photo uploaded.");
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Unable to upload rider photo.",
      );
    } finally {
      setLoading(false);
    }
  }

  async function uploadFleetPhoto(
    fleetId: string,
    file: File | undefined,
    photoType: string,
  ) {
    if (!file) return;
    if (
      !["image/jpeg", "image/png", "image/webp"].includes(file.type) ||
      file.size > 5 * 1024 * 1024
    ) {
      setError("Choose a JPEG, PNG, or WebP image smaller than 5 MB.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const intent = (await request(
        "/media/upload-intents",
        {
          method: "POST",
          body: JSON.stringify({
            entityType: "FLEET",
            entityId: fleetId,
            photoType,
            mimeType: file.type,
            fileName: file.name,
            sizeBytes: file.size,
          }),
        },
        token,
      )) as { photo: { id: string }; uploadUrl: string };
      const result = await fetch(intent.uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": file.type },
        body: file,
      });
      if (!result.ok)
        throw new Error("Object storage rejected the file upload.");
      await request(
        `/media/${intent.photo.id}/complete`,
        { method: "POST" },
        token,
      );
      setUploadedFleetPhotoTypes((current) =>
        current.includes(photoType) ? current : [...current, photoType],
      );
      await refreshFleetOnboardingStatus(fleetId);
      setNotice(`${photoType.replaceAll("_", " ")} photo uploaded.`);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Unable to upload fleet photo.",
      );
    } finally {
      setLoading(false);
    }
  }

  async function uploadComponentPhoto(
    entityType: "BATTERY" | "CONTROLLER",
    componentId: string,
    file: File | undefined,
    photoType: string,
  ) {
    if (!file) return;
    if (
      !["image/jpeg", "image/png", "image/webp"].includes(file.type) ||
      file.size > 5 * 1024 * 1024
    ) {
      setError("Choose a JPEG, PNG, or WebP image smaller than 5 MB.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const intent = (await request(
        "/media/upload-intents",
        {
          method: "POST",
          body: JSON.stringify({
            entityType,
            entityId: componentId,
            photoType,
            mimeType: file.type,
            fileName: file.name,
            sizeBytes: file.size,
          }),
        },
        token,
      )) as { photo: { id: string }; uploadUrl: string };
      const result = await fetch(intent.uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": file.type },
        body: file,
      });
      if (!result.ok)
        throw new Error("Object storage rejected the file upload.");
      await request(
        `/media/${intent.photo.id}/complete`,
        { method: "POST" },
        token,
      );
      const key = `${entityType}:${componentId}`;
      setUploadedComponentPhotoTypes((current) => ({
        ...current,
        [key]: current[key]?.includes(photoType)
          ? current[key]
          : [...(current[key] ?? []), photoType],
      }));
      if (fleetDetail) {
        await refreshFleetOnboardingStatus(String(fleetDetail.id));
      }
      setNotice(`${photoType.replaceAll("_", " ")} photo uploaded.`);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Unable to upload component photo.",
      );
    } finally {
      setLoading(false);
    }
  }

  async function initiateDeallocation(allocation: RecordItem) {
    const allocationId = String(allocation.id);
    setLoading(true);
    setError("");
    try {
      await request(
        `/allocations/${allocationId}/deallocation/initiate`,
        { method: "POST" },
        token,
      );
      setDeallocationId(allocationId);
      setRiderPhone(String((allocation.rider as RecordItem)?.mobile ?? ""));
      setOtpRequests({});
      setOtpCodes({});
      setVerifiedParties([]);
      setNotice(
        "Deallocation started. Capture post-deallocation inspection evidence, then verify both OTPs.",
      );
      await loadView("allocations");
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Unable to start deallocation.",
      );
    } finally {
      setLoading(false);
    }
  }

  async function requestDeallocationOtp(party: "RIDER" | "OPERATOR") {
    const phone = party === "RIDER" ? riderPhone : operatorPhone;
    setLoading(true);
    setError("");
    try {
      const data = (await request(
        `/allocations/${deallocationId}/deallocation/otp/request`,
        { method: "POST", body: JSON.stringify({ party, phone }) },
        token,
      )) as { otpRequestId: string };
      setOtpRequests((current) => ({ ...current, [party]: data.otpRequestId }));
      setNotice(`${party === "RIDER" ? "Rider" : "Operator"} OTP sent.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to send OTP.");
    } finally {
      setLoading(false);
    }
  }

  async function verifyDeallocationOtp(party: "RIDER" | "OPERATOR") {
    setLoading(true);
    setError("");
    try {
      await request(
        `/allocations/${deallocationId}/deallocation/otp/verify`,
        {
          method: "POST",
          body: JSON.stringify({
            otpRequestId: otpRequests[party],
            code: otpCodes[party],
          }),
        },
        token,
      );
      setVerifiedParties((current) => [...new Set([...current, party])]);
      setNotice(`${party === "RIDER" ? "Rider" : "Operator"} OTP verified.`);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "OTP verification failed.",
      );
    } finally {
      setLoading(false);
    }
  }

  async function completeDeallocation() {
    setLoading(true);
    setError("");
    try {
      await request(
        `/allocations/${deallocationId}/deallocation/complete`,
        { method: "POST" },
        token,
      );
      setNotice("Deallocation completed and fleet returned to available.");
      setDeallocationId("");
      await loadView("allocations");
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Deallocation cannot be completed yet.",
      );
    } finally {
      setLoading(false);
    }
  }

  async function signOut() {
    const refreshToken = sessionStorage.getItem(REFRESH_TOKEN_KEY);
    sessionStorage.removeItem(ACCESS_TOKEN_KEY);
    sessionStorage.removeItem(REFRESH_TOKEN_KEY);
    setToken("");
    setOtpRequestId("");
    setCode("");
    setDashboard(null);
    setItems([]);
    if (!refreshToken || !token) return;
    try {
      await request(
        "/auth/logout",
        { method: "POST", body: JSON.stringify({ refreshToken }) },
        token,
      );
    } catch {
      // Local sign-out is still correct when the network is unavailable.
    }
  }

  if (!token)
    return (
      <main className="auth-shell client-login">
        <section className="auth-hero" aria-label="EVs Eye fleet operations platform" />
        <section className="auth-panel">
          <div className="auth-card platform-login-card">
            <p className="eyebrow">SECURE OPERATIONS ACCESS</p>
            <h2>{otpRequestId ? "Verify your number" : "Welcome back"}</h2>
            <p className="muted">
              {otpRequestId
                ? `Enter the six-digit code sent to ${phone}.`
                : "Sign in to your EV fleet workspace."}
            </p>
            {!otpRequestId ? (
              <form onSubmit={sendOtp} className="auth-form">
                <label>
                  Company code
                  <span className="auth-input">
                    <UiIcon name="building" />
                    <input
                      value={companyCode}
                      onChange={(e) => setCompanyCode(e.target.value)}
                      placeholder="e.g. acme-fleet"
                      autoComplete="organization"
                      required
                    />
                  </span>
                </label>
                <label>
                  Mobile number
                  <span className="auth-input">
                    <UiIcon name="phone" />
                    <input
                      value={phone}
                      onChange={(e) => setPhone(indianMobileInput(e.target.value))}
                      placeholder="10-digit mobile number"
                      type="tel"
                      inputMode="numeric"
                      autoComplete="tel"
                      maxLength={10}
                      pattern="[6-9][0-9]{9}"
                      required
                    />
                  </span>
                </label>
                <button className="auth-submit" disabled={loading}>
                  {loading ? "Sending code…" : "Send OTP"}
                  <UiIcon name="arrowRight" />
                </button>
              </form>
            ) : (
              <form onSubmit={verifyOtp} className="auth-form">
                <label className="otp-code-label">
                  <span>Six-digit OTP</span>
                  <span className="otp-code-hint">One digit per box. You can type, paste, or use SMS auto-fill.</span>
                  <OtpCodeInput value={code} onChange={setCode} disabled={loading} />
                </label>
                <button className="auth-submit" disabled={loading || code.length !== 6}>
                  {loading ? "Verifying…" : "Verify OTP"}
                  <UiIcon name="arrowRight" />
                </button>
                <button
                  type="button"
                  className="auth-text-button"
                  onClick={() => {
                    setOtpRequestId("");
                    setCode("");
                    setNotice("");
                    setError("");
                  }}
                >
                  Change mobile number
                </button>
              </form>
            )}
            {notice && <p className="notice auth-message">{notice}</p>}
            {error && <p className="error auth-message">{error}</p>}
            <p className="auth-security-note">
              <UiIcon name="shield" /> Protected by OTP verification
            </p>
            <p className="client-powered-by">Powered by EV Spares India Pvt Ltd</p>
          </div>
        </section>
      </main>
    );

  const title = CLIENT_TAB_TITLES[tab];
  const isNotIncluded = !ACTIVE_CLIENT_TABS.has(tab);
  return (
    <main className="sa-shell client-operations-shell">
      <aside className="sa-sidebar">
        <div className="sa-brand">
          <span><UiIcon name="eye" /></span>
          <div>
            <strong>Evs Eye</strong>
            <small>OPERATIONS</small>
          </div>
        </div>
        <nav className="client-navigation" aria-label="Client operations">
          {CLIENT_NAVIGATION.map((section, index) => (
            <div
              className="sa-nav-group client-nav-section"
              key={`${section.label}-${index}`}
            >
              {section.label && (
                <button
                  type="button"
                  className="sa-nav-group-toggle"
                  aria-expanded={expandedClientNavGroups[section.label] ?? false}
                  aria-controls={`client-nav-group-${index}`}
                  onClick={() => setExpandedClientNavGroups((current) => ({
                    ...current,
                    [section.label]: !(current[section.label] ?? false),
                  }))}
                >
                  <span>{section.label}</span>
                  <UiIcon
                    name="chevron"
                    className={(expandedClientNavGroups[section.label] ?? false) ? "" : "is-collapsed"}
                  />
                </button>
              )}
              <div
                id={`client-nav-group-${index}`}
                className="client-nav-items"
                hidden={Boolean(section.label) && !(expandedClientNavGroups[section.label] ?? false)}
              >
                {section.items.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={`${tab === item.id ? "active" : ""} ${section.label ? "sa-nav-child" : ""}`}
                    onClick={() => navigateTo(item.id)}
                  >
                    {item.id === "cluster-managers" || item.id === "team-leads" || item.id === "fleet-managers"
                      ? <span aria-hidden="true" className={`client-role-art client-role-art-${item.id}`} />
                      : <UiIcon name={CLIENT_TAB_ICONS[item.id]} />}
                    {item.label}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </nav>
        <div className="sa-user client-sidebar-footer">
          <span aria-hidden="true">C</span>
          <div><strong>Client Operations</strong><small>EVs Eye workspace</small></div>
        </div>
      </aside>
      <section className="sa-main workspace client-operations-main">
        <header className="sa-topbar">
          <div>
            <h1>{title}</h1>
            <p>Client operations workspace</p>
          </div>
          <div className="header-actions">
            {tab === "allocations" && (
              <button onClick={() => void openAllocationForm()}>
                New allocation
              </button>
            )}
            {tab === "iot-devices" && <button onClick={() => { setError(""); setShowIotForm(true); }}>Register device</button>}
            <button className="secondary" onClick={() => void loadView(tab)}>
              ↻ Refresh
            </button>
            <button onClick={signOut}>Sign out</button>
          </div>
        </header>
        {bulkImportTab === tab && bulkImportTab ? <>
          {notice && <p className="notice">{notice}</p>}
          {error && <p className="error">{error}</p>}
          <ClientBulkImportWorkspace key={bulkImportTab} title={CLIENT_BULK_CONFIG[bulkImportTab].title} requiredColumns={CLIENT_BULK_CONFIG[bulkImportTab].requiredColumns} template={CLIENT_BULK_CONFIG[bulkImportTab].template} history={bulkHistory.filter((entry) => entry.tab === bulkImportTab)} historyLoading={bulkHistoryLoading} busy={loading} onBack={() => { setBulkImportTab(null); setError(""); setNotice(""); }} onUpload={(file) => uploadBulkRecords(bulkImportTab, file)} onDownloadFailures={(jobId) => downloadBulkFailures(bulkImportTab, jobId)} help={bulkImportTab === "fleet-managers" ? <><p className="sa-bulk-help">Use hub codes separated by semicolons. Primary hub code must match one of them.</p><p className="sa-bulk-help">Available hubs: {hubs.map((hub) => `${String(hub.code)} (${String(hub.name)})`).join(", ") || "Create a hub first."}</p></> : undefined} />
        </> : <>
        {notice && <p className="notice">{notice}</p>}
        {error && <p className="error">{error}</p>}
        {loading && <p className="muted">Loading current data…</p>}
        {!loading && (tab === "fleets" || tab === "riders") && <section className="sa-page-head client-page-head"><div className="sa-actions"><button className="secondary" onClick={() => openBulkImport(tab)}>Bulk upload</button><button onClick={() => tab === "fleets" ? void openFleetForm() : (setError(""), setShowRiderForm(true))}>+ Add {tab === "fleets" ? "Fleet" : "Rider"}</button></div></section>}
        {tab === "iot-devices" && showIotForm && <ClientFormDialog title="Register IoT device" busy={loading} error={error} onClose={() => setShowIotForm(false)}><form className="form-stack" onSubmit={(event) => { event.preventDefault(); void registerIotDevice(iotFleetId); }}>
          <h2>Register IoT device</h2>
          <label>Fleet<select required value={iotFleetId} onChange={(event) => setIotFleetId(event.target.value)}><option value="">Select fleet</option>{iotFleetOptions.map((fleet) => <option key={String(fleet.id)} value={String(fleet.id)}>{String(fleet.vehicleNumber ?? fleet.fleetCode ?? fleet.id)}</option>)}</select></label>
          <label>Device number<input required value={iotDeviceNumber} onChange={(event) => setIotDeviceNumber(event.target.value)} /></label>
          <div className="form-actions"><button>Register device</button><button type="button" className="secondary" onClick={() => setShowIotForm(false)}>Cancel</button></div>
        </form></ClientFormDialog>}
        {!loading && tab === "iot-devices" && ingestSecret && <section className="action-card"><strong>Ingestion secret (shown once)</strong><p><code>{ingestSecret}</code></p></section>}
        {!loading && tab === "locations" && (
          <>
            <section className="sa-page-head client-page-head"><div className="sa-actions"><button className="secondary" onClick={() => openBulkImport("locations")}>Bulk upload</button><button onClick={() => { setError(""); setEditingHubId(""); setNewHub({ name: "", code: "", city: "", state: "" }); setShowHubForm(true); }}>+ Add Hub</button></div></section>
            <ClientDataTable key="hubs" rows={hubs} getRowId={(hub) => String(hub.id)}
              columns={[
                { key: "name", label: "Hub", value: (hub) => String(hub.name ?? "—") },
                { key: "code", label: "Code", value: (hub) => String(hub.code ?? "—") },
                { key: "city", label: "City", value: (hub) => String(hub.city ?? "—") },
                { key: "state", label: "State", value: (hub) => String(hub.state ?? "—") },
              ]} emptyMessage="No hubs yet." actions={(hub) => <><button className="secondary table-action" onClick={() => { setEditingHubId(String(hub.id)); setNewHub({ name: String(hub.name ?? ""), code: String(hub.code ?? ""), city: String(hub.city ?? ""), state: String(hub.state ?? "") }); setShowHubForm(true); }}>Edit</button><button className="danger table-action" onClick={() => setDeleteConfirmation({ title: "Delete Hub?", description: "The hub will be removed from the active list if it has no assigned managers, fleets, or child hubs. Existing history is retained.", confirmLabel: "Delete Hub", onConfirm: () => deleteHub(String(hub.id)) })}>Delete</button></>} />
          </>
        )}
        {!loading && tab === "evidence" && (
          <>
            <section className="action-card">
              <p className="eyebrow">PHOTO EVIDENCE SETTINGS</p>
              <h2>Required photo slots</h2>
              <p className="muted">
                Manage client-specific onboarding and inspection evidence. Turn
                a slot off when it is optional.
              </p>
              <label>
                Evidence type
                <select
                  value={photoRequirementEntityType}
                  disabled={loading}
                  onChange={(event) => {
                    const entityType = event.target
                      .value as PhotoRequirementEntityType;
                    setPhotoRequirementEntityType(entityType);
                    void loadPhotoRequirements(entityType);
                  }}
                >
                  <option value="RIDER">Rider profile</option>
                  <option value="FLEET">Fleet onboarding</option>
                  <option value="BATTERY">Battery</option>
                  <option value="CONTROLLER">Controller</option>
                  <option value="INSPECTION">Allocation inspection</option>
                </select>
              </label>
              <button type="button" onClick={() => { setError(""); setShowPhotoTypeForm(true); }}>+ Add photo type</button>
            </section>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Photo type</th>
                    <th>Required</th>
                    <th>Order</th>
                  </tr>
                </thead>
                <tbody>
                  {configuredRequirements.map((requirement) => {
                    const photoType = String(requirement.photoType);
                    const required = Boolean(requirement.isRequired);
                    return (
                      <tr key={String(requirement.id)}>
                        <td>{photoType.replaceAll("_", " ")}</td>
                        <td>
                          <input
                            type="checkbox"
                            checked={required}
                            disabled={loading}
                            onChange={(event) =>
                              void savePhotoRequirement(
                                photoType,
                                event.target.checked,
                                Number(requirement.sortOrder ?? 0),
                              )
                            }
                          />
                        </td>
                        <td>{String(requirement.sortOrder ?? 0)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {configuredRequirements.length === 0 && (
                <p className="empty">No photo types configured.</p>
              )}
            </div>
          </>
        )}
        {showAllocationForm && (
          <ClientFormDialog title="Create allocation" busy={loading} error={error} onClose={() => setShowAllocationForm(false)}>
            <div>
              <p className="eyebrow">ALLOCATION</p>
              <h2>Assign an available vehicle</h2>
              <p className="muted">
                This reserves the fleet and creates its pre-allocation
                inspection.
              </p>
            </div>
            <form className="form-stack" onSubmit={createAllocation}>
              <label>
                Available fleet
                <select
                  value={allocationFleetId}
                  onChange={(e) => setAllocationFleetId(e.target.value)}
                  required
                >
                  <option value="">Select fleet</option>
                  {availableFleets.map((fleet) => (
                    <option key={String(fleet.id)} value={String(fleet.id)}>
                      {String(fleet.vehicleNumber)} ·{" "}
                      {oemLabel(fleet.oem, "Vehicle")}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Active rider
                <select
                  value={allocationRiderId}
                  onChange={(e) => setAllocationRiderId(e.target.value)}
                  required
                >
                  <option value="">Select rider</option>
                  {activeRiders.map((rider) => (
                    <option key={String(rider.id)} value={String(rider.id)}>
                      {String(rider.name)} · {String(rider.mobile)}
                    </option>
                  ))}
                </select>
              </label>
              <div className="form-actions">
                <button type="submit" disabled={loading}>
                  Create allocation
                </button>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => setShowAllocationForm(false)}
                >
                  Cancel
                </button>
              </div>
            </form>
          </ClientFormDialog>
        )}
        {showRiderForm && (
          <ClientFormDialog title="Create rider" busy={loading} error={error} onClose={() => setShowRiderForm(false)}>
            <p className="eyebrow">RIDER ONBOARDING</p>
            <h2>Create rider</h2>
            <form className="form-stack" onSubmit={createRider}>
              <label>
                Name
                <input
                  value={newRiderName}
                  onChange={(event) => setNewRiderName(event.target.value)}
                  required
                />
              </label>
              <label>
                Mobile
                <input
                  value={newRiderMobile}
                  onChange={(event) => setNewRiderMobile(event.target.value)}
                  placeholder="+919999999999"
                  required
                />
              </label>
              <label>
                Address
                <textarea
                  value={newRiderAddress}
                  onChange={(event) => setNewRiderAddress(event.target.value)}
                  maxLength={500}
                  rows={3}
                />
              </label>
              <div className="form-actions">
                <button disabled={loading}>Create rider</button>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => setShowRiderForm(false)}
                >
                  Cancel
                </button>
              </div>
            </form>
          </ClientFormDialog>
        )}
        {showFleetForm && (
          <ClientFormDialog title="Create fleet" busy={loading} error={error} wide onClose={() => setShowFleetForm(false)}>
            <p className="eyebrow">FLEET ONBOARDING</p>
            <h2>Create fleet</h2>
            <form className="form-stack" onSubmit={createFleet}>
              {(
                ["vehicleNumber", "chassisNumber", "oem", "model"] as const
              ).map((field) => (
                <label key={field}>
                  {field.replace(/([A-Z])/g, " $1")}
                  <input
                    value={newFleet[field]}
                    onChange={(event) =>
                      setNewFleet((current) => ({
                        ...current,
                        [field]: event.target.value,
                      }))
                    }
                    required={
                      field === "vehicleNumber" || field === "chassisNumber"
                    }
                  />
                </label>
              ))}
              <label>
                Hub
                <select
                  value={newFleet.hubId}
                  onChange={(event) =>
                    setNewFleet((current) => ({
                      ...current,
                      hubId: event.target.value,
                    }))
                  }
                >
                  <option value="">No hub assigned</option>
                  {hubs.map((hub) => (
                    <option key={String(hub.id)} value={String(hub.id)}>
                      {String(hub.name)} · {String(hub.code)}
                    </option>
                  ))}
                </select>
              </label>
              {(["colour", "vehicleType", "motorNumber"] as const).map(
                (field) => (
                  <label key={field}>
                    {field.replace(/([A-Z])/g, " $1")}
                    <input
                      value={newFleet[field]}
                      onChange={(event) =>
                        setNewFleet((current) => ({
                          ...current,
                          [field]: event.target.value,
                        }))
                      }
                    />
                  </label>
                ),
              )}
              {(
                [
                  "registrationDate",
                  "insuranceStartDate",
                  "insuranceEndDate",
                  "fitnessRenewalDate",
                ] as const
              ).map((field) => (
                <label key={field}>
                  {field.replace(/([A-Z])/g, " $1")}
                  <input
                    type="date"
                    value={newFleet[field]}
                    onChange={(event) =>
                      setNewFleet((current) => ({
                        ...current,
                        [field]: event.target.value,
                      }))
                    }
                  />
                </label>
              ))}
              <div className="form-actions">
                <button disabled={loading}>Create fleet</button>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => setShowFleetForm(false)}
                >
                  Cancel
                </button>
              </div>
            </form>
          </ClientFormDialog>
        )}
        {inspectionId && (
          <section className="action-card">
            <div>
              <p className="eyebrow">
                {inspectionType.replaceAll("_", " ")} INSPECTION
              </p>
              <h2>Required photo evidence</h2>
              <p className="muted">
                Each required slot must be complete before this workflow can
                proceed.
              </p>
            </div>
            <div className="photo-slots">
              {requirements.map((requirement) => {
                const photoType = String(requirement.photoType);
                const complete = uploadedPhotoTypes.includes(photoType);
                return (
                  <label
                    key={photoType}
                    className={complete ? "photo-slot complete" : "photo-slot"}
                  >
                    <span>
                      {complete ? "✓" : "○"} {photoType.replaceAll("_", " ")}
                      {requirement.isRequired ? " · required" : " · optional"}
                    </span>
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      disabled={loading}
                      onChange={(event) =>
                        void uploadInspectionPhoto(
                          photoType,
                          event.target.files?.[0],
                        )
                      }
                    />
                  </label>
                );
              })}
            </div>
            <div className="form-actions">
              <button
                disabled={loading}
                onClick={() => void completeInspection()}
              >
                Complete inspection
              </button>
              <button className="secondary" onClick={() => setInspectionId("")}>
                Close
              </button>
            </div>
          </section>
        )}
        {deallocationId && (
          <section className="action-card">
            <div>
              <p className="eyebrow">DEALLOCATION SECURITY</p>
              <h2>Verify rider and operator</h2>
              <p className="muted">
                Both separately delivered OTPs are required before completion.
              </p>
            </div>
            {(["RIDER", "OPERATOR"] as const).map((party) => (
              <div className="otp-row" key={party}>
                <label>
                  {party === "RIDER" ? "Rider mobile" : "Operator mobile"}
                  <input
                    value={party === "RIDER" ? riderPhone : operatorPhone}
                    onChange={(event) =>
                      party === "RIDER"
                        ? setRiderPhone(event.target.value)
                        : setOperatorPhone(event.target.value)
                    }
                  />
                </label>
                {!otpRequests[party] ? (
                  <button
                    disabled={loading}
                    onClick={() => void requestDeallocationOtp(party)}
                  >
                    Send OTP
                  </button>
                ) : verifiedParties.includes(party) ? (
                  <span className="status">Verified</span>
                ) : (
                  <>
                    <input
                      className="otp-code"
                      value={otpCodes[party] ?? ""}
                      onChange={(event) =>
                        setOtpCodes((current) => ({
                          ...current,
                          [party]: event.target.value,
                        }))
                      }
                      placeholder="6-digit OTP"
                      maxLength={6}
                    />
                    <button
                      disabled={loading}
                      onClick={() => void verifyDeallocationOtp(party)}
                    >
                      Verify
                    </button>
                  </>
                )}
              </div>
            ))}
            <div className="form-actions">
              <button
                disabled={loading || verifiedParties.length !== 2}
                onClick={() => void completeDeallocation()}
              >
                Complete deallocation
              </button>
              <button
                className="secondary"
                onClick={() => setDeallocationId("")}
              >
                Close
              </button>
            </div>
          </section>
        )}
        {allocationDetail && (
          <section className="action-card detail-card">
            <div>
              <p className="eyebrow">ALLOCATION DETAIL</p>
              <h2>
                {String((allocationDetail.fleet as RecordItem)?.vehicleNumber)}{" "}
                · {String((allocationDetail.rider as RecordItem)?.name)}
              </h2>
              <p>
                <Status value={String(allocationDetail.status)} />
              </p>
            </div>
            <div className="detail-grid">
              <div>
                <strong>Rider</strong>
                <span>
                  {String(
                    (allocationDetail.rider as RecordItem)?.mobile ?? "—",
                  )}
                </span>
              </div>
              <div>
                <strong>Fleet</strong>
                <span>
                  {oemLabel((allocationDetail.fleet as RecordItem)?.oem)}
                </span>
              </div>
              <div>
                <strong>Location</strong>
                <span>
                  {vehicleState?.latitude && vehicleState?.longitude
                    ? `${String(vehicleState.latitude)}, ${String(vehicleState.longitude)}`
                    : "No location received"}
                </span>
              </div>
              <div>
                <strong>Last heartbeat</strong>
                <span>
                  {vehicleState?.lastHeartbeat
                    ? new Date(
                        String(vehicleState.lastHeartbeat),
                      ).toLocaleString()
                    : "Not received"}
                </span>
              </div>
            </div>
            <h3>Inspections</h3>
            <div className="inspection-summary">
              {((allocationDetail.inspections as RecordItem[]) ?? []).map(
                (inspection) => (
                  <span key={String(inspection.id)}>
                    <b>{String(inspection.type).replaceAll("_", " ")}</b>{" "}
                    <Status value={String(inspection.status)} /> ·{" "}
                    {inspectionPhotoProgress[String(inspection.id)] ?? 0}/
                    {requiredInspectionPhotos} required photos
                  </span>
                ),
              )}
            </div>
            <button
              className="secondary"
              onClick={() => setAllocationDetail(null)}
            >
              Close detail
            </button>
          </section>
        )}
        {fleetDetail && (
          <section className="action-card detail-card">
            <p className="eyebrow">FLEET DETAIL</p>
            <h2>{String(fleetDetail.vehicleNumber)}</h2>
            <div className="form-actions"><button type="button" className="secondary" onClick={() => setEditingFleet((value) => !value)}>{editingFleet ? "Cancel edit" : "Edit fleet"}</button><button type="button" className="danger" onClick={() => setDeleteConfirmation({ title: "Delete Fleet?", description: "This fleet will be removed from the active list. Active allocations prevent deletion; existing history is retained.", confirmLabel: "Delete Fleet", onConfirm: () => deleteFleet(String(fleetDetail.id)) })}>Delete fleet</button></div>
            {editingFleet && <form className="form-stack" onSubmit={(event) => void saveFleet(event)}>
              <label>Vehicle number<input value={fleetDraft.vehicleNumber} onChange={(event) => setFleetDraft({ ...fleetDraft, vehicleNumber: event.target.value })} /></label>
              <label>Chassis number<input required value={fleetDraft.chassisNumber} onChange={(event) => setFleetDraft({ ...fleetDraft, chassisNumber: event.target.value })} /></label>
              <label>Model<input value={fleetDraft.modelName} onChange={(event) => setFleetDraft({ ...fleetDraft, modelName: event.target.value })} /></label>
              <label>Colour<input value={fleetDraft.colour} onChange={(event) => setFleetDraft({ ...fleetDraft, colour: event.target.value })} /></label>
              <label>Motor number<input value={fleetDraft.motorNumber} onChange={(event) => setFleetDraft({ ...fleetDraft, motorNumber: event.target.value })} /></label>
              <button>Save fleet</button>
            </form>}
            {fleetOnboardingStatus && (
              <div
                className={
                  fleetOnboardingStatus.ready
                    ? "onboarding-status ready"
                    : "onboarding-status incomplete"
                }
              >
                <strong>
                  {fleetOnboardingStatus.ready
                    ? "✓ Onboarding evidence complete"
                    : "! Onboarding evidence incomplete"}
                </strong>
                {!fleetOnboardingStatus.ready && (
                  <span>
                    {((fleetOnboardingStatus.items as RecordItem[]) ?? [])
                      .filter(
                        (item) =>
                          (item.missingPhotoTypes as string[]).length > 0,
                      )
                      .map(
                        (item) =>
                          `${String(item.label)}: ${(
                            item.missingPhotoTypes as string[]
                          )
                            .map((photoType) => photoType.replaceAll("_", " "))
                            .join(", ")}`,
                      )
                      .join(" · ")}
                  </span>
                )}
              </div>
            )}
            <h3>Fleet onboarding photos</h3>
            {fleetPhotoRequirements.length > 0 ? (
              <div className="photo-slots">
                {fleetPhotoRequirements.map((requirement) => {
                  const photoType = String(requirement.photoType);
                  const complete = uploadedFleetPhotoTypes.includes(photoType);
                  return (
                    <label
                      key={String(requirement.id)}
                      className={
                        complete ? "photo-slot complete" : "photo-slot"
                      }
                    >
                      <span>
                        {complete ? "✓" : "○"} {photoType.replaceAll("_", " ")}
                        {requirement.isRequired ? " · Required" : " · Optional"}
                      </span>
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        disabled={loading}
                        onChange={(event) =>
                          void uploadFleetPhoto(
                            String(fleetDetail.id),
                            event.target.files?.[0],
                            photoType,
                          )
                        }
                      />
                    </label>
                  );
                })}
              </div>
            ) : (
              <p className="muted">
                No fleet photo slots have been configured.
              </p>
            )}
            <div className="detail-grid">
              <div>
                <strong>OEM / model</strong>
                <span>
                  {oemLabel(fleetDetail.oem)}{" "}
                  {String(fleetDetail.modelName ?? "")}
                </span>
              </div>
              <div>
                <strong>Status</strong>
                <Status value={String(fleetDetail.status)} />
              </div>
              <div>
                <strong>Hub</strong>
                <span>
                  {String((fleetDetail.hub as RecordItem)?.name ?? "—")}
                </span>
              </div>
              <div>
                <strong>Last heartbeat</strong>
                <span>
                  {vehicleState?.lastHeartbeat
                    ? new Date(
                        String(vehicleState.lastHeartbeat),
                      ).toLocaleString()
                    : "Not received"}
                </span>
              </div>
            </div>
            <h3>Components</h3>
            <div className="inspection-summary">
              <span>
                <b>Batteries</b>{" "}
                {((fleetDetail.batteries as RecordItem[]) ?? []).length}
              </span>
              <span>
                <b>Controllers</b>{" "}
                {((fleetDetail.controllers as RecordItem[]) ?? []).length}
              </span>
            </div>
            {(
              [
                {
                  entityType: "BATTERY" as const,
                  label: "Battery",
                  components: (fleetDetail.batteries as RecordItem[]) ?? [],
                },
                {
                  entityType: "CONTROLLER" as const,
                  label: "Controller",
                  components: (fleetDetail.controllers as RecordItem[]) ?? [],
                },
              ] as const
            ).map(({ entityType, label, components }) =>
              components.map((component) => {
                const componentId = String(component.id);
                const uploaded =
                  uploadedComponentPhotoTypes[`${entityType}:${componentId}`] ??
                  [];
                const requirements =
                  componentPhotoRequirements[entityType] ?? [];
                return (
                  <section className="component-evidence" key={componentId}>
                    <h4>
                      {label}: {String(component.serialNumber)}
                    </h4>
                    <div className="photo-slots">
                      {requirements.map((requirement) => {
                        const photoType = String(requirement.photoType);
                        const complete = uploaded.includes(photoType);
                        return (
                          <label
                            key={String(requirement.id)}
                            className={
                              complete ? "photo-slot complete" : "photo-slot"
                            }
                          >
                            <span>
                              {complete ? "✓" : "○"}{" "}
                              {photoType.replaceAll("_", " ")}
                              {requirement.isRequired
                                ? " · Required"
                                : " · Optional"}
                            </span>
                            <input
                              type="file"
                              accept="image/jpeg,image/png,image/webp"
                              disabled={loading}
                              onChange={(event) =>
                                void uploadComponentPhoto(
                                  entityType,
                                  componentId,
                                  event.target.files?.[0],
                                  photoType,
                                )
                              }
                            />
                          </label>
                        );
                      })}
                    </div>
                  </section>
                );
              }),
            )}
            <h3>IoT device</h3>
            <button type="button" onClick={() => { setError(""); setShowDetailIotForm(true); }}>Register device</button>
            {ingestSecret && (
              <p className="notice">
                Save this ingestion secret now: <code>{ingestSecret}</code>{" "}
                <button
                  className="secondary table-action"
                  onClick={() =>
                    void navigator.clipboard.writeText(ingestSecret)
                  }
                >
                  Copy
                </button>
              </p>
            )}
            <div className="form-actions">
              <button type="button" onClick={() => { setError(""); setComponentSerial(""); setComponentForm("batteries"); }}>Add battery</button>
              <button type="button" onClick={() => { setError(""); setComponentSerial(""); setComponentForm("controllers"); }}>Add controller</button>
            </div>
            <button
              className="secondary"
              onClick={() => {
                setFleetDetail(null);
                setFleetOnboardingStatus(null);
                setIngestSecret("");
              }}
            >
              Close detail
            </button>
          </section>
        )}
        {riderDetail && (
          <section className="action-card detail-card">
            <p className="eyebrow">RIDER DETAIL</p>
            <h2>{String(riderDetail.name)}</h2>
            <label className="photo-slot">
              <span>Profile photo</span>
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                disabled={loading}
                onChange={(event) =>
                  void uploadRiderPhoto(
                    String(riderDetail.id),
                    event.target.files?.[0],
                  )
                }
              />
            </label>
            <div className="detail-grid">
              <div>
                <strong>Mobile</strong>
                <span>{String(riderDetail.mobile)}</span>
              </div>
              <div>
                <strong>Status</strong>
                <Status value={String(riderDetail.status)} />
              </div>
              <div>
                <strong>Address</strong>
                <span>{String(riderDetail.address ?? "—")}</span>
              </div>
            </div>
            <button
              className="secondary"
              onClick={() => setEditingRider((current) => !current)}
            >
              {editingRider ? "Cancel edit" : "Edit rider"}
            </button>
            {editingRider && (
              <form className="form-stack" onSubmit={updateRider}>
                <label>
                  Name
                  <input
                    value={riderDraft.name}
                    onChange={(event) =>
                      setRiderDraft((current) => ({
                        ...current,
                        name: event.target.value,
                      }))
                    }
                    required
                  />
                </label>
                <label>
                  Mobile
                  <input
                    value={riderDraft.mobile}
                    onChange={(event) =>
                      setRiderDraft((current) => ({
                        ...current,
                        mobile: event.target.value,
                      }))
                    }
                    required
                  />
                </label>
                <label>
                  Address
                  <textarea
                    value={riderDraft.address}
                    onChange={(event) =>
                      setRiderDraft((current) => ({
                        ...current,
                        address: event.target.value,
                      }))
                    }
                    maxLength={500}
                    rows={3}
                  />
                </label>
                <label>
                  Rider status
                  <select
                    value={riderDraft.status}
                    onChange={(event) =>
                      setRiderDraft((current) => ({
                        ...current,
                        status: event.target.value,
                      }))
                    }
                  >
                    {["PENDING", "ACTIVE", "INACTIVE", "BLOCKED"].map(
                      (status) => (
                        <option key={status} value={status}>
                          {status}
                        </option>
                      ),
                    )}
                  </select>
                </label>
                <div className="form-actions">
                  <button disabled={loading}>Save rider</button>
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => setEditingRider(false)}
                  >
                    Cancel
                  </button>
                </div>
              </form>
            )}
            <h3>KYC</h3>
            <div className="inspection-summary">
              {((riderDetail.kycs as RecordItem[]) ?? []).map((kyc) => (
                <span key={String(kyc.id)}>
                  <b>{String(kyc.type)}</b>{" "}
                  <Status value={String(kyc.status)} />
                </span>
              ))}
            </div>
            <div className="form-actions">
              {(["AADHAAR", "PAN", "BANK_ACCOUNT"] as const).map((type) => (
                <button
                  key={type}
                  className="secondary table-action"
                  disabled={loading}
                  onClick={() => void startKyc(String(riderDetail.id), type)}
                >
                  Start {type.replaceAll("_", " ")}
                </button>
              ))}
            </div>
            <h3>Open allocations</h3>
            <div className="inspection-summary">
              {((riderDetail.allocations as RecordItem[]) ?? []).map(
                (allocation) => (
                  <span key={String(allocation.id)}>
                    {String((allocation.fleet as RecordItem)?.vehicleNumber)}{" "}
                    <Status value={String(allocation.status)} />
                  </span>
                ),
              )}
            </div>
            <button className="secondary" onClick={() => setRiderDetail(null)}>
              Close detail
            </button>
          </section>
        )}
        {!loading && isNotIncluded && (
          <section className="package-not-included-card">
            <p className="eyebrow">CLIENT OPERATIONS</p>
            <h2>{title} is not included in your package</h2>
            <p>
              This feature is not included in your package. Please contact your
              administrator for more information.
            </p>
          </section>
        )}
        {!loading && tab === "dashboard" && dashboard && (
          <>
            <FleetHealthCard dashboard={dashboard} />
            <div className="dashboard-grid">
              <Metric
                label="Total riders"
                value={Object.values(dashboard.riders).reduce(
                  (sum, value) => sum + value,
                  0,
                )}
              />
              <Metric
                label="Active riders"
                value={dashboard.riders.ACTIVE ?? 0}
              />
              <Metric label="KYC pending" value={dashboard.kyc.PENDING ?? 0} />
              <Metric
                label="KYC verified"
                value={dashboard.kyc.VERIFIED ?? 0}
              />
              <Metric label="KYC failed" value={dashboard.kyc.FAILED ?? 0} />
              <Metric
                label="Active allocations"
                value={dashboard.operations.activeAllocations}
              />
              <Metric
                label="Allocations today"
                value={dashboard.operations.allocationsToday}
              />
              <Metric
                label="Deallocations today"
                value={dashboard.operations.deallocationsToday}
              />
              <Metric label="IoT online" value={dashboard.iot.online} />
              <Metric label="IoT offline" value={dashboard.iot.offline} />
            </div>
            <OperationsDashboardVisuals dashboard={dashboard} />
          </>
        )}
        {!loading &&
          !isNotIncluded &&
          tab !== "dashboard" &&
          tab !== "locations" &&
          tab !== "evidence" && (
            <>
              {(tab === "fleet-managers" || tab === "team-leads") ? <ClientUserManager key={tab} kind={tab} rows={items} hubs={hubs} columns={clientColumns(tab)}
                request={(path, options) => request(path, options ?? {}, token)}
                refresh={() => loadView(tab)}
                report={(message, failed) => { if (failed) setError(message); else { setError(""); setNotice(message); } }} onBulk={() => openBulkImport(tab)} /> :
              <ClientDataTable key={tab} rows={items} columns={clientColumns(tab)}
                getRowId={(item) => String(item.id)}
                actions={tab === "fleets" ? (item) => <><button className="secondary table-action" onClick={() => void openFleetDetail(String(item.id))}>View / Edit</button><button className="danger table-action" onClick={() => setDeleteConfirmation({ title: "Delete Fleet?", description: "This fleet will be removed from the active list. Active allocations prevent deletion; existing history is retained.", confirmLabel: "Delete Fleet", onConfirm: () => deleteFleet(String(item.id)) })}>Delete</button></>
                  : tab === "riders" ? (item) => <><button className="secondary table-action" onClick={() => void openRiderDetail(String(item.id))}>View / Edit</button><button className="danger table-action" onClick={() => setDeleteConfirmation({ title: "Delete Rider?", description: "This rider will be removed from the active list. Active allocations prevent deletion; existing history is retained.", confirmLabel: "Delete Rider", onConfirm: () => deleteRider(String(item.id)) })}>Delete</button></>
                  : tab === "allocations" ? (item) => <>
                    <button className="secondary table-action" onClick={() => void openAllocationDetail(String(item.id))}>View</button>
                    <button className="secondary table-action" onClick={() => void openInspection(item)}>Inspect</button>
                    {item.status === "OTP_PENDING" && <button className="table-action" onClick={() => void activateAllocation(String(item.id))}>Activate</button>}
                    {item.status === "ACTIVE" && <button className="table-action" onClick={() => void initiateDeallocation(item)}>Deallocate</button>}
                  </> : undefined} />}
            </>
          )}
        </>}
        {tab === "locations" && showHubForm && <ClientFormDialog title={editingHubId ? "Edit hub" : "Add hub"} busy={loading} error={error} onClose={() => setShowHubForm(false)}>
                <p className="eyebrow">LOCATION SETUP</p>
                <h2>{editingHubId ? "Edit hub" : "Create hub"}</h2>
                <form className="form-stack" onSubmit={createHub}>
                  <label>
                    Hub name
                    <input
                      value={newHub.name}
                      onChange={(event) =>
                        setNewHub((current) => ({
                          ...current,
                          name: event.target.value,
                        }))
                      }
                      required
                    />
                  </label>
                  <label>
                    Hub code
                    <input
                      value={newHub.code}
                      onChange={(event) =>
                        setNewHub((current) => ({
                          ...current,
                          code: event.target.value.toUpperCase(),
                        }))
                      }
                      pattern="[A-Z0-9_-]+"
                      required
                    />
                  </label>
                  <label>City<input required value={newHub.city} onChange={(event) => setNewHub((current) => ({ ...current, city: event.target.value }))} /></label>
                  <label>State<input required value={newHub.state} onChange={(event) => setNewHub((current) => ({ ...current, state: event.target.value }))} /></label>
                  <div className="form-actions"><button>{editingHubId ? "Save hub" : "Create hub"}</button><button type="button" className="secondary" onClick={() => { setEditingHubId(""); setNewHub({ name: "", code: "", city: "", state: "" }); setShowHubForm(false); }}>Cancel</button></div>
                </form>
        </ClientFormDialog>}
        {tab === "evidence" && showPhotoTypeForm && <ClientFormDialog title="Add photo type" busy={loading} error={error} onClose={() => setShowPhotoTypeForm(false)}><h2>Add photo type</h2>
              <form className="form-stack" onSubmit={addPhotoRequirement}>
                <label>
                  New photo type
                  <input
                    value={newRequirementType}
                    onChange={(event) =>
                      setNewRequirementType(event.target.value.toUpperCase())
                    }
                    placeholder="e.g. DAMAGE_CLOSEUP"
                    pattern="[A-Z0-9_-]{1,80}"
                    maxLength={80}
                    required
                  />
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={newRequirementRequired}
                    onChange={(event) =>
                      setNewRequirementRequired(event.target.checked)
                    }
                  />{" "}
                  Required for completion
                </label>
                <div className="form-actions"><button disabled={loading}>Add photo type</button><button type="button" className="secondary" onClick={() => setShowPhotoTypeForm(false)}>Cancel</button></div>
              </form></ClientFormDialog>}
        {fleetDetail && showDetailIotForm && <ClientFormDialog title="Register IoT device" busy={loading} error={error} onClose={() => setShowDetailIotForm(false)}><h2>Register IoT device</h2><form className="form-stack" onSubmit={(event) => { event.preventDefault(); void registerIotDevice(String(fleetDetail.id)); }}><label>Device number<input required value={iotDeviceNumber} onChange={(event) => setIotDeviceNumber(event.target.value)} /></label><div className="form-actions"><button disabled={loading}>Register device</button><button type="button" className="secondary" onClick={() => setShowDetailIotForm(false)}>Cancel</button></div></form></ClientFormDialog>}
        {fleetDetail && componentForm && <ClientFormDialog title={`Add ${componentForm === "batteries" ? "battery" : "controller"}`} busy={loading} error={error} onClose={() => setComponentForm(null)}><h2>Add {componentForm === "batteries" ? "battery" : "controller"}</h2><form className="form-stack" onSubmit={(event) => { event.preventDefault(); void addFleetComponent(String(fleetDetail.id), componentForm, componentSerial.trim()); }}><label>Serial number<input required value={componentSerial} onChange={(event) => setComponentSerial(event.target.value)} /></label><div className="form-actions"><button disabled={loading || !componentSerial.trim()}>Add {componentForm === "batteries" ? "battery" : "controller"}</button><button type="button" className="secondary" onClick={() => setComponentForm(null)}>Cancel</button></div></form></ClientFormDialog>}
        <ClientDeleteDialog confirmation={deleteConfirmation} busy={loading} onClose={() => setDeleteConfirmation(null)} />
        <footer className="client-operations-footer">Powered by EV Spares India Pvt Ltd</footer>
      </section>
    </main>
  );
}
