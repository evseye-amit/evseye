"use client";
import { sessionFetch as fetch } from "../lib/session-fetch";
import {
  enumOptionLabel,
  fleetOwnershipTypes,
  insuranceTypes,
  kycTypes,
  riderStatuses,
  vehicleSpeedTypes,
} from "../lib/domain-enums";

import { Dispatch, FormEvent, SetStateAction, useEffect, useState } from "react";
import { OtpCodeInput } from "./components/otp-code-input";
import { UiIcon, type IconName } from "./components/ui-icon";
import { ClientDataTable, type ClientColumn } from "./components/client-data-table";
import { ClientUserManager, parseCsv } from "./components/client-user-manager";
import { ClientBulkImportWorkspace, type ClientImportHistoryEntry } from "./components/client-bulk-import-workspace";
import { ClientDeleteDialog, type ClientDeleteConfirmation } from "./components/client-delete-dialog";
import { ClientFormDialog } from "./components/client-form-dialog";
import { useClientAppearance } from "./components/client-provider";
import { LanguageSwitcher, useLocale } from "./components/locale-provider";
import { ClientBrandingSettings } from "./components/client-branding-settings";
import { ClientBrand } from "./components/client-brand";

const API_URL =
  "/api/v1";
const ACCESS_TOKEN_KEY = "evs-eye-session-present";
const REFRESH_TOKEN_KEY = "evs-eye-session-refreshable";
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
  | "fleet-evidence"
  | "allocation-evidence"
  | "deallocation-evidence"
  | "rider-evidence"
  | "fleet-managers"
  | "team-leads"
  | "cluster-managers"
  | "iot-devices"
  | "batteries"
  | "controllers"
  | "fleet-component-mapping"
  | "deallocations"
  | "wallet"
  | "rider-fleet-mapping"
  | "rider-vendor-mapping"
  | "rider-earnings"
  | "rider-document-review"
  | "zones"
  | "reports"
  | "feature-usage";
type PhotoRequirementEntityType =
  | "RIDER"
  | "FLEET"
  | "BATTERY"
  | "CONTROLLER"
  | "IOT_DEVICE"
  | "INSPECTION";
type RecordItem = Record<string, unknown>;
type RiderOnboardingField = { featureId: string; featureCode: string; fieldCode?: string; name: string; description?: string | null; billingUnit: string; sequence: number; configuration: { label: string; storageKey?: string; placeholder?: string; fieldType: string; required: boolean; readOnly: boolean; disabled: boolean; editable: boolean; importable: boolean; maxFiles?: number; allowedFileTypes?: string[]; allowedMimeTypes?: string[]; validation?: Record<string, unknown> } };
type RiderOnboardingConfiguration = { package: { code: string; name: string }; onboarding: { steps: Array<{ stepId: string; stepCode: string; stepName: string; description?: string; sequence: number; fields: RiderOnboardingField[] }> } };
type FleetOnboardingOptions = {
  oems: Array<{ id: string; code: string; displayName: string }>;
  vehicleCategories: Array<{ id: string; code: string; name: string }>;
  vehicleTypes: Array<{ id: string; categoryId: string; code: string; name: string; energyType: string }>;
};
type FleetForm = {
  fleetCode: string; vehicleNumber: string; chassisNumber: string; vinNumber: string;
  oemId: string; vehicleCategoryId: string; vehicleTypeId: string; speedType: string; homeHubId: string;
  modelName: string; variantName: string; colour: string; motorNumber: string;
  manufacturingYear: string; manufacturingMonth: string; ownershipType: string; odometerKm: string;
  registrationDate: string; registeringAuthority: string; rcExpiryDate: string;
  insuranceProviderName: string; insurancePolicyNumber: string; insuranceType: string;
  insuranceStartDate: string; insuranceEndDate: string; fitnessCertificateNumber: string; fitnessExpiryDate: string;
};
const emptyFleetForm = (): FleetForm => ({
  fleetCode: "", vehicleNumber: "", chassisNumber: "", vinNumber: "", oemId: "", vehicleCategoryId: "", vehicleTypeId: "", speedType: "", homeHubId: "",
  modelName: "", variantName: "", colour: "", motorNumber: "", manufacturingYear: "", manufacturingMonth: "", ownershipType: "", odometerKm: "",
  registrationDate: "", registeringAuthority: "", rcExpiryDate: "", insuranceProviderName: "", insurancePolicyNumber: "", insuranceType: "", insuranceStartDate: "", insuranceEndDate: "", fitnessCertificateNumber: "", fitnessExpiryDate: "",
});
const dateInputValue = (value: unknown) => value ? String(value).slice(0, 10) : "";
function FleetTextInput({ label, field, form, setForm, required, ...input }: {
  label: string; field: keyof FleetForm; form: FleetForm; setForm: Dispatch<SetStateAction<FleetForm>>; required?: boolean;
  type?: string; min?: string; max?: string; step?: string; placeholder?: string;
}) {
  return <label>{label}{required ? " *" : ""}<input {...input} required={required} value={form[field]} onChange={(event) => setForm({ ...form, [field]: event.target.value })} /></label>;
}
type ClientBulkTab = "fleet-managers" | "team-leads" | "locations" | "fleets" | "riders" | "batteries" | "controllers" | "iot-devices" | "fleet-component-mapping";
const emptyHubForm = () => ({ name: "", code: "", type: "OPERATIONS", status: "ACTIVE", addressLine1: "", addressLine2: "", landmark: "", city: "", district: "", state: "", country: "India", postalCode: "", latitude: "", longitude: "", parentHubId: "", vehicleCapacity: "", riderCapacity: "", batteryCapacity: "", parkingSlots: "", chargingPoints: "", swappingPoints: "", contactName: "", contactPhone: "", contactEmail: "", openingTime: "", closingTime: "", is24x7: false, supportsCharging: false, supportsBatterySwapping: false, supportsMaintenance: false, supportsAllocation: true, supportsDeallocation: true, supportsPdi: false });
const CLIENT_BULK_CONFIG: Record<ClientBulkTab, { title: string; requiredColumns: string; template: string; resource: string; entityType: string }> = {
  "fleet-managers": { title: "Fleet Managers", requiredColumns: "name, mobile, hubCodes, primaryHubCode", template: "name,mobile,hubCodes,primaryHubCode\n", resource: "/client/users/fleet-managers", entityType: "FLEET_MANAGER" },
  "team-leads": { title: "Team Leads", requiredColumns: "name, mobile", template: "name,mobile,employeeCode,designation\n", resource: "/client/users/team-leaders", entityType: "TEAM_LEADER" },
  locations: { title: "Hubs", requiredColumns: "name, code, city, state", template: "name,code,type,status,addressLine1,addressLine2,landmark,city,district,state,country,postalCode,latitude,longitude,parentHubId,vehicleCapacity,riderCapacity,batteryCapacity,parkingSlots,chargingPoints,swappingPoints,contactName,contactPhone,contactEmail,openingTime,closingTime,is24x7,supportsCharging,supportsBatterySwapping,supportsMaintenance,supportsAllocation,supportsDeallocation,supportsPdi\nCentral Operations Hub,HUB-001,OPERATIONS,ACTIVE,Warehouse Road,,Near Metro,Gurugram,Gurugram,Haryana,India,122001,,,,100,50,100,50,4,2,Operations Manager,+919876543210,hub@example.com,09:00,18:00,false,true,true,true,true,true,false\n", resource: "/hubs", entityType: "HUB" },
  fleets: { title: "Fleets", requiredColumns: "chassisNumber, oemCode, vehicleCategoryCode, vehicleTypeCode, speedType, ownershipType", template: "fleetCode,vehicleNumber,chassisNumber,vinNumber,oemCode,vehicleCategoryCode,vehicleTypeCode,speedType,homeHubCode,currentHubCode,modelName,variantName,colour,motorNumber,manufacturingYear,manufacturingMonth,ownershipType,odometerKm,registrationDate,registeringAuthority,rcExpiryDate,insuranceProviderName,insurancePolicyNumber,insuranceType,insuranceStartDate,insuranceEndDate,fitnessCertificateNumber,fitnessExpiryDate\nFLT-0001,DL01EV0001,ME4JF123456789001,,ZELIO,2W,E_SCOOTER_ELECTRIC,HIGH_SPEED,HUB-DEL-01,,Gracy,,White,,2025,6,CLIENT_OWNED,0,,,,,,,,,,\n", resource: "/fleets", entityType: "FLEET" },
  batteries: { title: "Batteries", requiredColumns: "serialNumber", template: "fleetId,chassisNumber,serialNumber,batteryCode,batteryType,batterySlot,manufacturer,model,chemistry,capacityKwh,voltage,ampHour,installedOdometerKm,manufacturingDate,warrantyStartDate,warrantyEndDate\n,,BAT-001,BAT-0001,FIXED_SINGLE,PRIMARY,,,,2.5,,,0,,,\n", resource: "/fleets/batteries", entityType: "BATTERY" },
  controllers: { title: "Controllers", requiredColumns: "controllerNumber", template: "fleetId,chassisNumber,controllerNumber,manufacturer,model,ratedVoltage,ratedCurrent\n,,CTRL-001,,,,\n", resource: "/fleets/controllers", entityType: "CONTROLLER" },
  "iot-devices": { title: "IoT Devices", requiredColumns: "deviceNumber", template: "fleetId,chassisNumber,deviceNumber,imei,simNumber,iccid,provider,model,installedAt\n,,IOT-001,,,,,,\n", resource: "/iot/devices", entityType: "IOT_DEVICE" },
  "fleet-component-mapping": { title: "Fleet Component Mapping", requiredColumns: "fleetId or chassisNumber", template: "fleetId,chassisNumber,iotDeviceNumber,battery1Serial,battery2Serial,controllerNumber\n,,,,,\n", resource: "/fleets/component-mappings", entityType: "FLEET_COMPONENT_MAPPING" },
  riders: { title: "Riders", requiredColumns: "Package-configured rider fields", template: "", resource: "/riders", entityType: "RIDER" },
};

const CLIENT_NAVIGATION: Array<{
  label: string;
  items: Array<{ id: Tab; label: string }>;
}> = [
  { label: "", items: [{ id: "dashboard", label: "Dashboard" }] },
  {
    label: "Team Management",
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
      { id: "controllers", label: "Controller" },
      { id: "fleet-component-mapping", label: "Fleet Component Mapping" },
    ],
  },
  {
    label: "Photo & Evidence",
    items: [
      { id: "fleet-evidence", label: "Fleet" },
      { id: "allocation-evidence", label: "Allocation" },
      { id: "deallocation-evidence", label: "De-allocation" },
      { id: "rider-evidence", label: "Rider" },
    ],
  },
  {
    label: "Rider Management",
    items: [
      { id: "wallet", label: "Wallet" },
      { id: "rider-fleet-mapping", label: "Rider Fleet Mapping" },
      { id: "rider-vendor-mapping", label: "Rider Vendor Mapping" },
      { id: "rider-earnings", label: "Rider Earnings" },
      { id: "rider-document-review", label: "Document Verification" },
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
  "fleet-evidence": "Fleet Photo & Evidence",
  "allocation-evidence": "Allocation Photo & Evidence",
  "deallocation-evidence": "De-allocation Photo & Evidence",
  "rider-evidence": "Rider Photo & Evidence",
  "fleet-managers": "Fleet Manager",
  "team-leads": "Team Lead",
  "cluster-managers": "Cluster Manager",
  "iot-devices": "IoT",
  batteries: "Battery",
  controllers: "Controller",
  "fleet-component-mapping": "Fleet Component Mapping",
  deallocations: "Deallocation",
  wallet: "Wallet",
  "rider-fleet-mapping": "Rider Fleet Mapping",
  "rider-vendor-mapping": "Rider Vendor Mapping",
  "rider-earnings": "Rider Earnings",
  "rider-document-review": "Rider Document Verification",
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
  "fleet-evidence": "camera",
  "allocation-evidence": "camera",
  "deallocation-evidence": "camera",
  "rider-evidence": "camera",
  "fleet-managers": "users",
  "team-leads": "teamLead",
  "cluster-managers": "clusterManager",
  "iot-devices": "iot",
  batteries: "battery",
  controllers: "factory",
  "fleet-component-mapping": "link",
  deallocations: "allocation",
  wallet: "wallet",
  "rider-fleet-mapping": "link",
  "rider-vendor-mapping": "link",
  "rider-earnings": "earnings",
  "rider-document-review": "shield",
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
  "controllers",
  "fleet-component-mapping",
  "fleet-evidence",
  "allocation-evidence",
  "deallocation-evidence",
  "rider-evidence",
  "rider-document-review",
]);

const PHOTO_EVIDENCE_TABS = new Set<Tab>([
  "evidence",
  "fleet-evidence",
  "allocation-evidence",
  "deallocation-evidence",
  "rider-evidence",
  "rider-document-review",
]);

function evidenceEntityType(tab: Tab): PhotoRequirementEntityType {
  if (tab === "fleet-evidence") return "FLEET";
  if (tab === "rider-evidence") return "RIDER";
  return "INSPECTION";
}

function evidenceContext(tab: Tab) {
  if (tab === "fleet-evidence") return { eyebrow: "FLEET EVIDENCE", title: "Fleet photo requirements", description: "Configure the photos required when a fleet vehicle is onboarded or updated." };
  if (tab === "rider-evidence") return { eyebrow: "RIDER EVIDENCE", title: "Rider photo requirements", description: "Configure profile, KYC, and onboarding photos required for riders." };
  if (tab === "deallocation-evidence") return { eyebrow: "DE-ALLOCATION EVIDENCE", title: "De-allocation inspection requirements", description: "Configure the photos required while returning a fleet vehicle from a rider." };
  return { eyebrow: "ALLOCATION EVIDENCE", title: "Allocation inspection requirements", description: "Configure the photos required while handing a fleet vehicle over to a rider." };
}

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
  authenticated: boolean;
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
    if (!response.ok || !tokens?.authenticated) {
      sessionStorage.removeItem(ACCESS_TOKEN_KEY);
      sessionStorage.removeItem(REFRESH_TOKEN_KEY);
      window.dispatchEvent(new Event(AUTH_CHANGED_EVENT));
      return null;
    }

    sessionStorage.setItem(ACCESS_TOKEN_KEY, "cookie-session");
    sessionStorage.setItem(REFRESH_TOKEN_KEY, "cookie-session");
    window.dispatchEvent(new Event(AUTH_CHANGED_EVENT));
    return "cookie-session";
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
  const { t } = useLocale();
  return (
    <article className="metric">
      <span>{t(label)}</span>
      <strong>{value}</strong>
    </article>
  );
}

function FleetHealthCard({ dashboard }: { dashboard: Dashboard }) {
  const { t } = useLocale();
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
          <p className="eyebrow">{t("FLEET HEALTH")}</p>
          <h2>{t("Fleet status distribution")}</h2>
        </div>
        <span>{Object.values(dashboard.fleet).reduce((sum, value) => sum + value, 0)} {t("total")}</span>
      </header>
      <div className="bar-chart-list">
        {fleetRows.map(([label, value, color]) => (
          <div className="bar-chart-row" key={label}>
            <span>{t(label)}</span>
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
  const { t } = useLocale();
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
            <p className="eyebrow">{t("WORKFORCE")}</p>
            <h2>{t("Rider readiness")}</h2>
          </div>
          <span>{riderTotal} {t("total")}</span>
        </header>
        <div className="donut-summary">
          <div
            className="donut"
            style={{
              background: `conic-gradient(#21865d ${activeRiderPercent}%, #e8efea 0)`,
            }}
          >
            <strong>{activeRiderPercent}%</strong>
            <span>{t("active")}</span>
          </div>
          <div>
            <p>
              <b>{activeRiders}</b> {t("active Riders")}
            </p>
            <p>
              <b>{dashboard.kyc.VERIFIED ?? 0}</b> {t("KYC verified")}
            </p>
            <p>
              <b>{dashboard.kyc.PENDING ?? 0}</b> {t("KYC pending")}
            </p>
          </div>
        </div>
      </article>
      <article className="operations-chart-card operations-activity-chart">
        <header>
          <div>
            <p className="eyebrow">{t("TODAY")}</p>
            <h2>{t("Allocation activity")}</h2>
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
              <small>{t(label)}</small>
            </div>
          ))}
        </div>
      </article>
      <article className="operations-chart-card operations-iot-chart">
        <header>
          <div>
            <p className="eyebrow">{t("TELEMATICS")}</p>
            <h2>{t("Device connectivity")}</h2>
          </div>
          <span>{telemetryTotal} {t("devices")}</span>
        </header>
        <div className="connectivity">
          <strong>{onlinePercent}%</strong>
          <span>{t("online now")}</span>
          <div>
            <i style={{ width: `${onlinePercent}%` }} />
          </div>
          <p>
            <b>{dashboard.iot.online}</b> {t("online")} ·{" "}
            <b>{dashboard.iot.offline}</b> {t("offline")}
          </p>
        </div>
      </article>
    </section>
  );
}

function Status({ value }: { value: string }) {
  const { t } = useLocale();
  return (
    <span
      className={`status status-${value.toLowerCase().replaceAll("_", "-")}`}
    >
      {t(value.replaceAll("_", " "))}
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
      text("joiningDate", "Joining date", (row) => row.joiningDate ? String(row.joiningDate).slice(0, 10) : "—"),
      status("status", "Status", (row) => (row.user as RecordItem | undefined)?.isActive === false ? "INACTIVE" : "ACTIVE"),
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
    case "controllers": return [
      text("controller", "Controller", (row) => row.controllerNumber),
      text("manufacturer", "Manufacturer", (row) => row.manufacturer),
      text("fleet", "Fleet", (row) => {
        const assignment = ((row.fleetHistory as RecordItem[]) ?? [])[0];
        const fleet = assignment?.fleet as RecordItem | undefined;
        return fleet?.fleetCode ?? fleet?.vehicleNumber ?? "Unassigned";
      }),
      status("status", "Status", (row) => row.status),
    ];
    case "fleet-component-mapping": return [
      text("fleet", "Fleet", (row) => row.fleetCode ?? row.vehicleNumber),
      text("chassis", "Chassis number", (row) => row.chassisNumber),
      text("iot", "IoT device", (row) => (row.iotDevice as RecordItem | undefined)?.deviceNumber ?? "Unassigned"),
      text("batteries", "Batteries (max 2)", (row) => ((row.batteryHistory as RecordItem[]) ?? []).slice(0, 2).map((item) => { const battery = item.battery as RecordItem | undefined; return battery?.batteryCode ?? battery?.serialNumber; }).filter(Boolean).join(", ") || "Unassigned"),
      text("controllers", "Controllers", (row) => ((row.controllerHistory as RecordItem[]) ?? []).map((item) => (item.controller as RecordItem | undefined)?.controllerNumber).filter(Boolean).join(", ") || "Unassigned"),
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
    case "rider-document-review": return [
      text("rider", "Rider", (row) => (row.rider as RecordItem | undefined)?.name ?? (row.user as RecordItem | undefined)?.name),
      text("mobile", "Mobile", (row) => (row.rider as RecordItem | undefined)?.mobile ?? (row.user as RecordItem | undefined)?.mobile),
      text("document", "Document", (row) => (row.feature as RecordItem | undefined)?.name ?? row.fieldCode),
      text("file", "File", (row) => (row.photo as RecordItem | undefined)?.fileName),
      text("uploaded", "Uploaded", (row) => row.createdAt ? new Date(String(row.createdAt)).toLocaleString() : "—"),
      status("status", "Review status", (row) => row.status),
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
  const { appearance, hostClient } = useClientAppearance();
  const { t } = useLocale();
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
  const [riderOnboardingConfiguration, setRiderOnboardingConfiguration] = useState<RiderOnboardingConfiguration | null>(null);
  const [riderValues, setRiderValues] = useState<Record<string, string>>({});
  const [riderUploads, setRiderUploads] = useState<Record<string, File[]>>({});
  const [showFleetForm, setShowFleetForm] = useState(false);
  const [hubs, setHubs] = useState<RecordItem[]>([]);
  const [newHub, setNewHub] = useState(emptyHubForm);
  const [editingHubId, setEditingHubId] = useState("");
  const [showHubForm, setShowHubForm] = useState(false);
  const [bulkImportTab, setBulkImportTab] = useState<ClientBulkTab | null>(null);
  const [bulkHistory, setBulkHistory] = useState<Array<ClientImportHistoryEntry & { tab: ClientBulkTab }>>([]);
  const [bulkHistoryLoading, setBulkHistoryLoading] = useState(false);
  const [riderBulkFields, setRiderBulkFields] = useState<RiderOnboardingField[]>([]);
  const [deleteConfirmation, setDeleteConfirmation] = useState<ClientDeleteConfirmation | null>(null);
  const [newFleet, setNewFleet] = useState<FleetForm>(emptyFleetForm);
  const [editingFleetId, setEditingFleetId] = useState("");
  const [fleetOptions, setFleetOptions] = useState<FleetOnboardingOptions>({
    oems: [], vehicleCategories: [], vehicleTypes: [],
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
  const [riderDraft, setRiderDraft] = useState<Record<string, string>>({});
  const [fleetDetail, setFleetDetail] = useState<RecordItem | null>(null);
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
  const [iotDetails, setIotDetails] = useState({ imei: "", simNumber: "", iccid: "", provider: "", model: "", installedAt: "" });
  const [editingIotDeviceId, setEditingIotDeviceId] = useState("");
  const [iotFleetId, setIotFleetId] = useState("");
  const [iotFleetOptions, setIotFleetOptions] = useState<RecordItem[]>([]);
  const [showIotForm, setShowIotForm] = useState(false);
  const [componentForm, setComponentForm] = useState<"batteries" | "controllers" | null>(null);
  const [componentFleetId, setComponentFleetId] = useState("");
  const [editingComponentId, setEditingComponentId] = useState("");
  const [componentSerial, setComponentSerial] = useState("");
  const [componentDetails, setComponentDetails] = useState({ batteryCode: "", batteryType: "FIXED_SINGLE", batterySlot: "PRIMARY", manufacturer: "", model: "", chemistry: "", capacityKwh: "", voltage: "", ampHour: "", installedOdometerKm: "", manufacturingDate: "", warrantyStartDate: "", warrantyEndDate: "", ratedVoltage: "", ratedCurrent: "" });
  const [showMappingForm, setShowMappingForm] = useState(false);
  const [mappingFleetId, setMappingFleetId] = useState("");
  const [mappingIotId, setMappingIotId] = useState("");
  const [mappingBatteryIds, setMappingBatteryIds] = useState<string[]>([]);
  const [mappingControllerId, setMappingControllerId] = useState("");
  const [mappingOptions, setMappingOptions] = useState({ fleets: [] as RecordItem[], devices: [] as RecordItem[], batteries: [] as RecordItem[], controllers: [] as RecordItem[] });
  const [showDetailIotForm, setShowDetailIotForm] = useState(false);
  const [showPhotoTypeForm, setShowPhotoTypeForm] = useState(false);
  const [rejectingDocument, setRejectingDocument] = useState<RecordItem | null>(null);
  const [documentRejectionReason, setDocumentRejectionReason] = useState("");
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
      } else if (nextTab === "controllers") {
        const controllers = (await request(
          "/fleets/controllers",
          {},
          token,
        )) as RecordItem[];
        setItems(controllers);
      } else if (nextTab === "fleet-component-mapping") {
        setItems((await request("/fleets/component-mappings", {}, token)) as RecordItem[]);
      } else if (nextTab === "rider-document-review") {
        setItems((await request("/rider-documents", {}, token)) as RecordItem[]);
      } else if (nextTab === "locations") {
        setHubs((await request("/hubs", {}, token)) as RecordItem[]);
      } else if (PHOTO_EVIDENCE_TABS.has(nextTab)) {
        await loadPhotoRequirements(evidenceEntityType(nextTab));
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
    if (PHOTO_EVIDENCE_TABS.has(nextTab)) {
      setPhotoRequirementEntityType(evidenceEntityType(nextTab));
    }
    setTab(nextTab);
  }

  async function sendOtp(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      const data = (await request("/auth/otp/request", {
        method: "POST",
        body: JSON.stringify({ phone, ...(hostClient ? {} : { companyCode }) }),
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
      if (!data.authenticated) throw new Error("Sign-in failed.");
      sessionStorage.removeItem("evs-eye-access-token");
      sessionStorage.removeItem("evs-eye-refresh-token");
      sessionStorage.setItem(ACCESS_TOKEN_KEY, "cookie-session");
      sessionStorage.setItem(REFRESH_TOKEN_KEY, "cookie-session");
      const identity = (await request("/auth/me", {}, "cookie-session")) as {
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
      setToken("cookie-session");
      setNotice("");
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Unable to verify OTP.",
      );
    } finally {
      setLoading(false);
    }
  }

  async function approveRiderDocument(id: string) {
    setLoading(true);
    setError("");
    try {
      await request(`/rider-documents/${id}/approve`, { method: "POST" }, token);
      setNotice("Document approved.");
      await loadView("rider-document-review");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to approve document.");
    } finally {
      setLoading(false);
    }
  }

  async function rejectRiderDocument(event: FormEvent) {
    event.preventDefault();
    if (!rejectingDocument) return;
    setLoading(true);
    setError("");
    try {
      await request(`/rider-documents/${String(rejectingDocument.id)}/reject`, {
        method: "POST",
        body: JSON.stringify({ rejectionReason: documentRejectionReason }),
      }, token);
      setRejectingDocument(null);
      setDocumentRejectionReason("");
      setNotice("Document rejected. The Rider will be asked to upload a replacement.");
      await loadView("rider-document-review");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to reject document.");
    } finally {
      setLoading(false);
    }
  }

  async function downloadRiderDocument(item: RecordItem) {
    const photo = item.photo as RecordItem | undefined;
    if (!photo?.id) return;
    setError("");
    try {
      const result = await request(`/media/${String(photo.id)}/download-url`, {}, token) as { url?: string };
      if (!result.url) throw new Error("Document download is unavailable.");
      window.open(result.url, "_blank", "noopener,noreferrer");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to open document.");
    }
  }

  async function openAllocationForm(fleetId?: string) {
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
      if (fleetId && !fleets.items.some((fleet) => String(fleet.id) === fleetId)) {
        throw new Error("This fleet is no longer available for allocation.");
      }
      setAllocationFleetId(fleetId ?? "");
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
      const rider = await request(
        "/riders",
        {
          method: "POST",
          body: JSON.stringify({ values: riderValues }),
        },
        token,
      );
      for (const [fieldCode, files] of Object.entries(riderUploads)) {
        for (const file of files) await uploadRiderOnboardingFile(String((rider as RecordItem).id), fieldCode, file);
      }
      setShowRiderForm(false);
      setRiderValues({});
      setRiderUploads({});
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

  async function openRiderForm() {
    setLoading(true);
    setError("");
    try {
      const configuration = await request("/riders/onboarding-configuration", {}, token) as RiderOnboardingConfiguration;
      setRiderOnboardingConfiguration(configuration);
      setRiderValues({});
      setRiderUploads({});
      setShowRiderForm(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to load Rider Onboarding configuration.");
    } finally {
      setLoading(false);
    }
  }

  function fleetFormFromRecord(fleet: RecordItem): FleetForm {
    const registration = (fleet.registration as RecordItem | undefined) ?? {};
    const insurance = (fleet.insurance as RecordItem | undefined) ?? {};
    const fitness = (fleet.fitness as RecordItem | undefined) ?? {};
    const text = (value: unknown) => value === null || value === undefined ? "" : String(value);
    return {
      fleetCode: text(fleet.fleetCode), vehicleNumber: text(fleet.vehicleNumber), chassisNumber: text(fleet.chassisNumber), vinNumber: text(fleet.vinNumber),
      oemId: text(fleet.oemId), vehicleCategoryId: text(fleet.vehicleCategoryId), vehicleTypeId: text(fleet.vehicleTypeId), speedType: text(fleet.speedType), homeHubId: text(fleet.homeHubId),
      modelName: text(fleet.modelName), variantName: text(fleet.variantName), colour: text(fleet.colour), motorNumber: text(fleet.motorNumber),
      manufacturingYear: text(fleet.manufacturingYear), manufacturingMonth: text(fleet.manufacturingMonth), ownershipType: text(fleet.ownershipType), odometerKm: text(fleet.odometerKm),
      registrationDate: dateInputValue(registration.registrationDate), registeringAuthority: text(registration.registeringAuthority), rcExpiryDate: dateInputValue(registration.rcExpiryDate),
      insuranceProviderName: text(insurance.providerName), insurancePolicyNumber: text(insurance.policyNumber), insuranceType: text(insurance.insuranceType), insuranceStartDate: dateInputValue(insurance.startDate), insuranceEndDate: dateInputValue(insurance.endDate),
      fitnessCertificateNumber: text(fitness.certificateNumber), fitnessExpiryDate: dateInputValue(fitness.expiryDate),
    };
  }

  async function saveFleetForm(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      const payload = Object.fromEntries(Object.entries(newFleet).filter(([, value]) => value !== "")) as Record<string, string | number>;
      for (const field of ["manufacturingYear", "manufacturingMonth", "odometerKm"]) {
        if (payload[field] !== undefined) payload[field] = Number(payload[field]);
      }
      await request(
        editingFleetId ? `/fleets/${editingFleetId}` : "/fleets",
        {
          method: editingFleetId ? "PATCH" : "POST",
          body: JSON.stringify(payload),
        },
        token,
      );
      setShowFleetForm(false);
      setNewFleet(emptyFleetForm());
      const updatedFleetId = editingFleetId;
      setEditingFleetId("");
      setNotice(updatedFleetId ? "Fleet updated." : "Fleet created.");
      await loadView("fleets");
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Unable to create fleet.",
      );
    } finally {
      setLoading(false);
    }
  }

  async function openFleetForm(fleetId?: string) {
    setLoading(true);
    setError("");
    try {
      const [options, hubRows, fleet] = await Promise.all([
        request("/fleets/onboarding-options", {}, token) as Promise<FleetOnboardingOptions>,
        request("/hubs", {}, token) as Promise<RecordItem[]>,
        fleetId ? request(`/fleets/${fleetId}`, {}, token) as Promise<RecordItem> : Promise.resolve(null),
      ]);
      setFleetOptions(options);
      setHubs(hubRows);
      setEditingFleetId(fleetId ?? "");
      setNewFleet(fleet ? fleetFormFromRecord(fleet) : emptyFleetForm());
      setShowFleetForm(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to load hubs.");
    } finally {
      setLoading(false);
    }
  }

  async function openComponentForm(component: "batteries" | "controllers") {
    setLoading(true); setError("");
    try {
      const result = await request("/fleets?page=1&pageSize=100", {}, token) as { items: RecordItem[] };
      setIotFleetOptions(result.items);
      setComponentFleetId(""); setComponentSerial(""); setComponentDetails({ batteryCode: "", batteryType: "FIXED_SINGLE", batterySlot: "PRIMARY", manufacturer: "", model: "", chemistry: "", capacityKwh: "", voltage: "", ampHour: "", installedOdometerKm: "", manufacturingDate: "", warrantyStartDate: "", warrantyEndDate: "", ratedVoltage: "", ratedCurrent: "" }); setEditingComponentId(""); setComponentForm(component);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to load Fleets."); }
    finally { setLoading(false); }
  }

  async function openIotForm(device?: RecordItem) {
    setLoading(true);
    setError("");
    try {
      const result = await request("/fleets?page=1&pageSize=100", {}, token) as { items: RecordItem[] };
      setIotFleetOptions(result.items);
      setEditingIotDeviceId(String(device?.id ?? ""));
      setIotFleetId(String((device?.currentFleet as RecordItem | undefined)?.id ?? ""));
      setIotDeviceNumber(String(device?.deviceNumber ?? ""));
      setIotDetails({
        imei: String(device?.imei ?? ""), simNumber: String(device?.simNumber ?? ""),
        iccid: String(device?.iccid ?? ""), provider: String(device?.provider ?? ""),
        model: String(device?.model ?? ""), installedAt: String(device?.installedAt ?? "").slice(0, 10),
      });
      setShowIotForm(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to load Fleets.");
    } finally { setLoading(false); }
  }

  async function openMappingForm(mapping?: RecordItem) {
    setLoading(true); setError("");
    try {
      const [fleetResult, devices, batteries, controllers] = await Promise.all([
        request("/fleets?page=1&pageSize=100", {}, token) as Promise<{ items: RecordItem[] }>,
        request("/iot/devices", {}, token) as Promise<RecordItem[]>,
        request("/fleets/batteries", {}, token) as Promise<RecordItem[]>,
        request("/fleets/controllers", {}, token) as Promise<RecordItem[]>,
      ]);
      setMappingOptions({ fleets: fleetResult.items, devices, batteries, controllers });
      setMappingFleetId(String(mapping?.id ?? ""));
      setMappingIotId(String((mapping?.iotDevice as RecordItem | undefined)?.id ?? ""));
      setMappingBatteryIds(((mapping?.batteryHistory as RecordItem[]) ?? []).map((item) => String((item.battery as RecordItem | undefined)?.id ?? "")).filter(Boolean).slice(0, 2));
      setMappingControllerId(String(((mapping?.controllerHistory as RecordItem[]) ?? [])[0]?.controller ? ((mapping?.controllerHistory as RecordItem[])[0].controller as RecordItem).id : ""));
      setShowMappingForm(true);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to load component options."); }
    finally { setLoading(false); }
  }

  async function saveMapping(event: FormEvent) {
    event.preventDefault();
    if (!mappingFleetId) return;
    setLoading(true); setError("");
    try {
      await request(`/fleets/component-mappings/${mappingFleetId}`, { method: "PATCH", body: JSON.stringify({ iotDeviceId: mappingIotId || null, batteryIds: mappingBatteryIds, controllerId: mappingControllerId || null }) }, token);
      setShowMappingForm(false); setNotice("Fleet component mapping saved."); await loadView("fleet-component-mapping");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to save component mapping."); }
    finally { setLoading(false); }
  }

  async function openExistingComponentForm(component: "batteries" | "controllers", item: RecordItem) {
    await openComponentForm(component);
    const assignment = ((item.fleetHistory as RecordItem[]) ?? [])[0];
    setComponentFleetId(String((assignment?.fleet as RecordItem | undefined)?.id ?? ""));
    setComponentSerial(String(component === "batteries" ? item.serialNumber ?? "" : item.controllerNumber ?? ""));
    setComponentDetails({ batteryCode: String(item.batteryCode ?? ""), batteryType: String(item.batteryType ?? "FIXED_SINGLE"), batterySlot: String(assignment?.batterySlot ?? "PRIMARY"), manufacturer: String(item.manufacturer ?? ""), model: String(item.model ?? ""), chemistry: String(item.chemistry ?? ""), capacityKwh: String(item.capacityKwh ?? ""), voltage: String(item.voltage ?? ""), ampHour: String(item.ampHour ?? ""), installedOdometerKm: "", manufacturingDate: String(item.manufacturingDate ?? "").slice(0, 10), warrantyStartDate: String(item.warrantyStartDate ?? "").slice(0, 10), warrantyEndDate: String(item.warrantyEndDate ?? "").slice(0, 10), ratedVoltage: String(item.ratedVoltage ?? ""), ratedCurrent: String(item.ratedCurrent ?? "") });
    setEditingComponentId(String(item.id));
  }

  async function createHub(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      await request(
        editingHubId ? `/hubs/${editingHubId}` : "/hubs",
        {
          method: editingHubId ? "PATCH" : "POST",
          body: JSON.stringify(Object.fromEntries(
            Object.entries(newHub).filter(([, value]) =>
              typeof value === "boolean" || String(value).trim() !== "",
            ),
          )),
        },
        token,
      );
      setNewHub(emptyHubForm());
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
    if (kind === "riders") {
      void request("/riders/onboarding-configuration", {}, token)
        .then((configuration) => setRiderBulkFields((configuration as RiderOnboardingConfiguration).onboarding.steps.flatMap((step) => step.fields.filter((field) => field.configuration.importable && field.fieldCode))))
        .catch((cause) => setError(cause instanceof Error ? cause.message : "Unable to load Rider import configuration."));
    }
  }

  async function uploadBulkRecords(kind: ClientBulkTab, file: File) {
    setLoading(true); setError("");
    try {
      if (file.size > 5 * 1024 * 1024) throw new Error("CSV must be 5 MB or smaller.");
      const csv = parseCsv(await file.text());
      const headers = csv.shift()?.map((field) => field.trim()) ?? [];
      const required = kind === "riders" ? riderBulkFields.filter((field) => field.configuration.required).map((field) => field.fieldCode!) : CLIENT_BULK_CONFIG[kind].requiredColumns.split(", ");
      const componentImport = false;
      const requiredHeaders = componentImport
        ? required.filter((field) => field !== "fleetCode or chassisNumber")
        : required.filter((field) => field !== "fleetId or chassisNumber");
      if (!requiredHeaders.every((field) => headers.includes(field)) || (kind === "fleet-component-mapping" && !headers.includes("fleetId") && !headers.includes("chassisNumber")) || (componentImport && !headers.includes("fleetCode") && !headers.includes("chassisNumber"))) throw new Error(`CSV requires columns: ${required.join(", ")}.`);
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
      if (kind === "riders") {
        rows = rows.map((row) => ({ values: row }));
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

  async function saveComponent(fleetId: string, component: "batteries" | "controllers") {
    if (!componentSerial.trim()) return;
    setLoading(true); setError("");
    try {
      const batteryDetails = { batteryCode: componentDetails.batteryCode, batteryType: componentDetails.batteryType, batterySlot: componentDetails.batterySlot, manufacturer: componentDetails.manufacturer, model: componentDetails.model, chemistry: componentDetails.chemistry, capacityKwh: componentDetails.capacityKwh, voltage: componentDetails.voltage, ampHour: componentDetails.ampHour, installedOdometerKm: componentDetails.installedOdometerKm, manufacturingDate: componentDetails.manufacturingDate, warrantyStartDate: componentDetails.warrantyStartDate, warrantyEndDate: componentDetails.warrantyEndDate };
      const controllerDetails = { manufacturer: componentDetails.manufacturer, model: componentDetails.model, ratedVoltage: componentDetails.ratedVoltage, ratedCurrent: componentDetails.ratedCurrent };
      const optionalDetails = Object.fromEntries(Object.entries(component === "batteries" ? batteryDetails : controllerDetails).filter(([, value]) => value.trim() !== ""));
      const body = component === "batteries" ? { ...optionalDetails, serialNumber: componentSerial.trim(), fleetId: fleetId || undefined } : { ...optionalDetails, controllerNumber: componentSerial.trim(), fleetId: fleetId || undefined };
      const endpoint = editingComponentId
        ? fleetId ? `/fleets/${fleetId}/${component}/${editingComponentId}` : `/fleets/${component}/${editingComponentId}`
        : `/fleets/${component}`;
      await request(endpoint, { method: editingComponentId ? "PATCH" : "POST", body: JSON.stringify(body) }, token);
      setNotice(editingComponentId ? `${component === "batteries" ? "Battery" : "Controller"} updated.` : `${component === "batteries" ? "Battery" : "Controller"} added.`);
      setComponentForm(null); setComponentSerial(""); setEditingComponentId("");
      await loadView(component);
      if (fleetDetail && String(fleetDetail.id) === fleetId) await openFleetDetail(fleetId);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to save component."); }
    finally { setLoading(false); }
  }

  async function registerIotDevice(fleetId: string) {
    setLoading(true);
    setError("");
    try {
      const optionalDetails = Object.fromEntries(
        Object.entries(iotDetails).filter(([, value]) => value.trim() !== ""),
      );
      const data = (await request(
        editingIotDeviceId ? `/iot/devices/${editingIotDeviceId}` : "/iot/devices",
        {
          method: editingIotDeviceId ? "PATCH" : "POST",
          body: JSON.stringify({
            fleetId: fleetId || null,
            deviceNumber: iotDeviceNumber,
            ...optionalDetails,
          }),
        },
        token,
      )) as { ingestSecret?: string };
      if (data.ingestSecret) setIngestSecret(data.ingestSecret);
      setIotDeviceNumber("");
      setIotDetails({ imei: "", simNumber: "", iccid: "", provider: "", model: "", installedAt: "" });
      setEditingIotDeviceId("");
      setNotice(
        data.ingestSecret ? "IoT device registered. Save the ingestion secret now; it is shown only once." : "IoT device updated.",
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
      setNotice(
        `Allocation ${allocation.id.slice(0, 8)} created. Complete its pre-allocation inspection before activation.`,
      );
      await loadView("fleets");
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
      const [rider, configuration] = await Promise.all([
        request(`/riders/${riderId}`, {}, token) as Promise<RecordItem>,
        request("/riders/onboarding-configuration", {}, token) as Promise<RiderOnboardingConfiguration>,
      ]);
      setRiderDetail(rider);
      setRiderOnboardingConfiguration(configuration);
      setRiderDraft(Object.fromEntries(configuration.onboarding.steps.flatMap((step) => step.fields.filter((field) => field.fieldCode && field.configuration.storageKey).map((field) => {
        const metadata = (rider.metadata as RecordItem | undefined) ?? {};
        const value = (field.configuration.storageKey ?? "").startsWith("metadata.") ? metadata[(field.configuration.storageKey ?? "").slice("metadata.".length)] : rider[field.configuration.storageKey ?? ""];
        return [field.fieldCode!, value ? String(value).slice(0, field.configuration.fieldType === "DATE" ? 10 : undefined) : ""];
      }))));
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
          body: JSON.stringify({ values: riderDraft }),
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

  async function uploadRiderOnboardingFile(riderId: string, featureCode: string, file: File) {
    if (!['image/jpeg', 'image/png', 'image/webp', 'application/pdf'].includes(file.type)) {
      throw new Error('Choose a JPEG, PNG, WebP, or PDF file.');
    }
    if (file.size > 5 * 1024 * 1024) throw new Error('Each onboarding file must be 5 MB or smaller.');
    const intent = await request('/media/upload-intents', { method: 'POST', body: JSON.stringify({ entityType: 'RIDER', entityId: riderId, photoType: featureCode, mimeType: file.type, fileName: file.name, sizeBytes: file.size }) }, token) as { photo: { id: string }; uploadUrl: string };
    const result = await fetch(intent.uploadUrl, { method: 'PUT', headers: { 'Content-Type': file.type }, body: file });
    if (!result.ok) throw new Error(`Object storage rejected ${file.name}.`);
    await request(`/media/${intent.photo.id}/complete`, { method: 'POST' }, token);
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
      await loadView("fleets");
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

  async function deallocateFleet(fleet: RecordItem) {
    const fleetId = String(fleet.id);
    setLoading(true);
    setError("");
    try {
      const result = (await request(
        `/allocations?fleetId=${encodeURIComponent(fleetId)}&status=ACTIVE&page=1&pageSize=1`,
        {},
        token,
      )) as { items: RecordItem[] };
      const allocation = result.items[0];
      if (!allocation) {
        throw new Error("No active allocation was found for this fleet.");
      }
      await initiateDeallocation(allocation);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Unable to start de-allocation.",
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
        <section className="auth-hero" aria-label={appearance.client ? `${appearance.client.displayName} operations workspace` : "EVs Eye fleet operations platform"}>
          {appearance.client && <ClientBrand hero />}
        </section>
        <section className="auth-panel">
          <div className="auth-card platform-login-card">
            <div className="language-login-row"><LanguageSwitcher /></div>
            <ClientBrand companyCode={companyCode} landing />
            <p className="eyebrow">{t("SECURE OPERATIONS ACCESS")}</p>
            <h2>{otpRequestId ? t("Verify your number") : t(appearance.branding.loginTitle)}</h2>
            <p className="muted">
              {otpRequestId
                ? `${t("Enter the six-digit code sent to")} ${phone}.`
                : t(appearance.branding.loginSubtitle)}
            </p>
            {appearance.branding.supportEmail && <p><a href={`mailto:${appearance.branding.supportEmail}`}>{t("Contact support")}</a></p>}
            {appearance.branding.supportPhone && <p>{t("Support")}: {appearance.branding.supportPhone}</p>}
            {!otpRequestId ? (
              <form onSubmit={sendOtp} className="auth-form">
                {!hostClient && <label>
                  {t("Company code")} *
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
                </label>}
                <label>
                  {t("Mobile number")} *
                 <span className="auth-input">
                    <UiIcon name="phone" />
                    <input
                      value={phone}
                      onChange={(e) => setPhone(indianMobileInput(e.target.value))}
                      placeholder={t("10-digit mobile number")}
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
                  {t(loading ? "Sending code…" : "Send OTP")}
                  <UiIcon name="arrowRight" />
                </button>
              </form>
            ) : (
              <form onSubmit={verifyOtp} className="auth-form">
                <label className="otp-code-label">
                  <span>{t("Six-digit OTP")} <span className="sa-required-star" aria-hidden="true">*</span></span>
                  <span className="otp-code-hint">{t("One digit per box. You can type, paste, or use SMS auto-fill.")}</span>
                  <OtpCodeInput value={code} onChange={setCode} disabled={loading} />
                </label>
                <button className="auth-submit" disabled={loading || code.length !== 6}>
                  {t(loading ? "Verifying…" : "Verify OTP")}
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
                  {t("Change mobile number")}
                </button>
              </form>
            )}
            {notice && <p className="notice auth-message">{notice}</p>}
            {error && <p className="error auth-message">{error}</p>}
            <p className="auth-security-note">
              <UiIcon name="shield" /> {t("Protected by OTP verification")}
            </p>
            <p className="client-powered-by">{t("Powered by EV Spares India Pvt Ltd")}</p>
          </div>
        </section>
      </main>
    );

  const title = CLIENT_TAB_TITLES[tab];
  const isNotIncluded = !ACTIVE_CLIENT_TABS.has(tab);
  return (
    <main className="sa-shell client-operations-shell">
      <aside className="sa-sidebar">
        <ClientBrand token={token} />
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
                  <span>{t(section.label)}</span>
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
                    {t(item.label)}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </nav>
        <ClientBrandingSettings token={token} />
        <div className="sa-user client-sidebar-footer">
          <span aria-hidden="true">C</span>
          <div><strong>{t("Client Operations")}</strong><small>{t("EVs Eye workspace")}</small></div>
        </div>
      </aside>
      <section className="sa-main workspace client-operations-main">
        <header className="sa-topbar">
          <div>
            <h1>{t(title)}</h1>
            <p>{t("Client operations workspace")}</p>
          </div>
          <div className="header-actions">
            <LanguageSwitcher />
            <button className="secondary" onClick={() => void loadView(tab)}>
              ↻ {t("Refresh")}
            </button>
            <button onClick={signOut}>{t("Sign out")}</button>
          </div>
        </header>
        {bulkImportTab === tab && bulkImportTab ? <>
          {notice && <p className="notice">{notice}</p>}
          {error && <p className="error">{error}</p>}
          <ClientBulkImportWorkspace key={bulkImportTab} title={CLIENT_BULK_CONFIG[bulkImportTab].title} requiredColumns={bulkImportTab === "riders" ? riderBulkFields.filter((field) => field.configuration.required).map((field) => field.fieldCode!).join(", ") : CLIENT_BULK_CONFIG[bulkImportTab].requiredColumns} template={bulkImportTab === "riders" ? `${riderBulkFields.map((field) => field.fieldCode!).join(",")}\n` : CLIENT_BULK_CONFIG[bulkImportTab].template} history={bulkHistory.filter((entry) => entry.tab === bulkImportTab)} historyLoading={bulkHistoryLoading} busy={loading} onBack={() => { setBulkImportTab(null); setError(""); setNotice(""); }} onUpload={(file) => uploadBulkRecords(bulkImportTab, file)} onDownloadFailures={(jobId) => downloadBulkFailures(bulkImportTab, jobId)} help={bulkImportTab === "fleet-managers" ? <><p className="sa-bulk-help">Use hub codes separated by semicolons. Primary hub code must match one of them.</p><p className="sa-bulk-help">Available hubs: {hubs.map((hub) => `${String(hub.code)} (${String(hub.name)})`).join(", ") || "Create a hub first."}</p></> : undefined} />
        </> : <>
        {notice && <p className="notice">{notice}</p>}
        {error && <p className="error">{error}</p>}
        {loading && <p className="muted">Loading current data…</p>}
        {!loading && (tab === "fleets" || tab === "riders" || tab === "batteries" || tab === "controllers" || tab === "iot-devices" || tab === "fleet-component-mapping") && <section className="sa-page-head client-page-head"><div className="sa-actions"><button className="secondary" onClick={() => openBulkImport(tab as ClientBulkTab)}>Bulk upload</button>{tab === "fleets" ? <button onClick={() => void openFleetForm()}>+ Add Fleet</button> : tab === "riders" ? <button onClick={() => void openRiderForm()}>+ Add Rider</button> : tab === "iot-devices" ? <button onClick={() => void openIotForm()}>+ Add IoT device</button> : tab === "fleet-component-mapping" ? <button onClick={() => void openMappingForm()}>+ Add mapping</button> : <button onClick={() => void openComponentForm(tab)}>+ Add {tab === "batteries" ? "Battery" : "Controller"}</button>}</div></section>}
        {tab === "iot-devices" && showIotForm && <ClientFormDialog title={editingIotDeviceId ? "Edit IoT device" : "Register IoT device"} busy={loading} error={error} onClose={() => setShowIotForm(false)}><form className="form-stack" onSubmit={(event) => { event.preventDefault(); void registerIotDevice(iotFleetId); }}>
          <h2>{editingIotDeviceId ? "Edit IoT device" : "Register IoT device"}</h2>
          <label>Fleet (optional)<select value={iotFleetId} onChange={(event) => setIotFleetId(event.target.value)}><option value="">Leave unassigned</option>{iotFleetOptions.map((fleet) => <option key={String(fleet.id)} value={String(fleet.id)}>{String(fleet.vehicleNumber ?? fleet.fleetCode ?? fleet.id)}</option>)}</select></label>
          <label>Device number *<input required value={iotDeviceNumber} onChange={(event) => setIotDeviceNumber(event.target.value)} /></label>
          <div className="form-grid"><label>IMEI<input value={iotDetails.imei} onChange={(event) => setIotDetails((current) => ({ ...current, imei: event.target.value }))} /></label><label>SIM number<input value={iotDetails.simNumber} onChange={(event) => setIotDetails((current) => ({ ...current, simNumber: event.target.value }))} /></label><label>ICCID<input value={iotDetails.iccid} onChange={(event) => setIotDetails((current) => ({ ...current, iccid: event.target.value }))} /></label><label>IoT provider<input value={iotDetails.provider} onChange={(event) => setIotDetails((current) => ({ ...current, provider: event.target.value }))} /></label><label>Device model<input value={iotDetails.model} onChange={(event) => setIotDetails((current) => ({ ...current, model: event.target.value }))} /></label><label>Installation date<input type="date" value={iotDetails.installedAt} onChange={(event) => setIotDetails((current) => ({ ...current, installedAt: event.target.value }))} /></label></div>
          <div className="form-actions"><button>{editingIotDeviceId ? "Save device" : "Register device"}</button><button type="button" className="secondary" onClick={() => setShowIotForm(false)}>Cancel</button></div>
        </form></ClientFormDialog>}
        {!loading && tab === "iot-devices" && ingestSecret && <section className="action-card"><strong>Ingestion secret (shown once)</strong><p><code>{ingestSecret}</code></p></section>}
        {!loading && tab === "locations" && (
          <>
            <section className="sa-page-head client-page-head"><div className="sa-actions"><button className="secondary" onClick={() => openBulkImport("locations")}>Bulk upload</button><button onClick={() => { setError(""); setEditingHubId(""); setNewHub(emptyHubForm()); setShowHubForm(true); }}>+ Add Hub</button></div></section>
            <ClientDataTable key="hubs" rows={hubs} getRowId={(hub) => String(hub.id)}
              columns={[
                { key: "name", label: "Hub", value: (hub) => String(hub.name ?? "—") },
                { key: "code", label: "Code", value: (hub) => String(hub.code ?? "—") },
                { key: "city", label: "City", value: (hub) => String(hub.city ?? "—") },
                { key: "state", label: "State", value: (hub) => String(hub.state ?? "—") },
              ]} emptyMessage="No hubs yet." actions={(hub) => <><button className="secondary table-action" onClick={() => { setEditingHubId(String(hub.id)); setNewHub({ ...emptyHubForm(), ...Object.fromEntries(Object.entries(hub).filter(([, value]) => typeof value === "string" || typeof value === "boolean")), latitude: String(hub.latitude ?? ""), longitude: String(hub.longitude ?? ""), vehicleCapacity: String(hub.vehicleCapacity ?? ""), riderCapacity: String(hub.riderCapacity ?? ""), batteryCapacity: String(hub.batteryCapacity ?? ""), parkingSlots: String(hub.parkingSlots ?? ""), chargingPoints: String(hub.chargingPoints ?? ""), swappingPoints: String(hub.swappingPoints ?? "") }); setShowHubForm(true); }}>Edit</button><button className="danger table-action" onClick={() => setDeleteConfirmation({ title: "Delete Hub?", description: "The hub will be removed from the active list if it has no assigned managers, fleets, or child hubs. Existing history is retained.", confirmLabel: "Delete Hub", onConfirm: () => deleteHub(String(hub.id)) })}>Delete</button></>} />
          </>
        )}
        {!loading && PHOTO_EVIDENCE_TABS.has(tab) && (
          <>
            <section className="action-card">
              <p className="eyebrow">{evidenceContext(tab).eyebrow}</p>
              <h2>{evidenceContext(tab).title}</h2>
              <p className="muted">{evidenceContext(tab).description}</p>
              {(tab === "allocation-evidence" || tab === "deallocation-evidence") && <p className="sa-bulk-help">Evidence is captured against the relevant inspection, so each allocation and de-allocation retains its own photos and audit history.</p>}
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
                Available fleet *
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
                Active rider *
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
            <p className="muted">Fields are configured by the active {riderOnboardingConfiguration?.package.name ?? ""} package.</p>
            <form className="form-stack" onSubmit={createRider}>
              {riderOnboardingConfiguration?.onboarding.steps.map((step) => <fieldset key={step.stepId} className="form-stack"><legend>{step.stepName}</legend>{step.description && <p className="muted">{step.description}</p>}{step.fields.map((field) => field.billingUnit === "UPLOAD" ? <label key={field.fieldCode ?? field.featureCode}>{field.configuration.label}{field.configuration.required ? " *" : ""}<input type="file" accept={field.configuration.allowedMimeTypes?.join(",") || field.configuration.allowedFileTypes?.map((type) => ({ PDF: "application/pdf", JPG: "image/jpeg", JPEG: "image/jpeg", PNG: "image/png", WEBP: "image/webp" } as Record<string, string>)[type.toUpperCase()] ?? "").filter(Boolean).join(",") || "image/jpeg,image/png,image/webp,application/pdf"} multiple={Number(field.configuration.maxFiles ?? 1) > 1} required={field.configuration.required} onChange={(event) => setRiderUploads((current) => ({ ...current, [field.fieldCode ?? field.featureCode]: Array.from(event.target.files ?? []) }))} /></label> : field.fieldCode ? <label key={field.fieldCode}>{field.configuration.label}{field.configuration.required ? " *" : ""}{field.configuration.fieldType === "TEXTAREA" ? <textarea value={riderValues[field.fieldCode!] ?? ""} placeholder={field.configuration.placeholder} required={field.configuration.required} disabled={field.configuration.disabled || field.configuration.readOnly} onChange={(event) => setRiderValues((current) => ({ ...current, [field.fieldCode!]: event.target.value }))} /> : <input type={field.configuration.fieldType === "DATE" ? "date" : field.configuration.fieldType === "MOBILE" ? "tel" : "text"} value={riderValues[field.fieldCode!] ?? ""} placeholder={field.configuration.placeholder} required={field.configuration.required} disabled={field.configuration.disabled || field.configuration.readOnly} onChange={(event) => setRiderValues((current) => ({ ...current, [field.fieldCode!]: event.target.value }))} />}</label> : <p key={field.configuration.label} className="muted">{field.configuration.label} is enabled for this package.</p>)}</fieldset>)}
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
          <ClientFormDialog title={editingFleetId ? "Edit fleet" : "Add fleet"} busy={loading} error={error} wide onClose={() => setShowFleetForm(false)}>
            <p className="eyebrow">FLEET ONBOARDING</p>
            <h2>{editingFleetId ? "Edit fleet" : "Create fleet"}</h2>
            <p className="muted">Use the same vehicle information and master data controls used during fleet onboarding.</p>
            <form className="client-hub-form" onSubmit={saveFleetForm}>
              <h3 className="client-form-section-title">Vehicle identity</h3>
              <FleetTextInput label="Fleet code" field="fleetCode" form={newFleet} setForm={setNewFleet} placeholder="FLT-0001" />
              <FleetTextInput label="Vehicle number" field="vehicleNumber" form={newFleet} setForm={setNewFleet} placeholder="DL01EV0001" />
              <FleetTextInput label="Chassis number" field="chassisNumber" form={newFleet} setForm={setNewFleet} required placeholder="ME4JF123456789001" />
              <FleetTextInput label="VIN number" field="vinNumber" form={newFleet} setForm={setNewFleet} placeholder="Vehicle identification number" />
              <label>OEM *<select required value={newFleet.oemId} onChange={(event) => setNewFleet({ ...newFleet, oemId: event.target.value })}><option value="">Select OEM</option>{fleetOptions.oems.map((oem) => <option key={oem.id} value={oem.id}>{oem.displayName} ({oem.code})</option>)}</select></label>
              <label>Vehicle category *<select required value={newFleet.vehicleCategoryId} onChange={(event) => setNewFleet({ ...newFleet, vehicleCategoryId: event.target.value, vehicleTypeId: "" })}><option value="">Select vehicle category</option>{fleetOptions.vehicleCategories.map((category) => <option key={category.id} value={category.id}>{category.name} ({category.code})</option>)}</select></label>
              <label>Vehicle type *<select required disabled={!newFleet.vehicleCategoryId} value={newFleet.vehicleTypeId} onChange={(event) => setNewFleet({ ...newFleet, vehicleTypeId: event.target.value })}><option value="">Select vehicle type</option>{fleetOptions.vehicleTypes.filter((type) => type.categoryId === newFleet.vehicleCategoryId).map((type) => <option key={type.id} value={type.id}>{type.name} ({type.energyType})</option>)}</select></label>
              <label>Speed type *<select required value={newFleet.speedType} onChange={(event) => setNewFleet({ ...newFleet, speedType: event.target.value })}><option value="">Select speed type</option>{vehicleSpeedTypes.map((type) => <option key={type} value={type}>{enumOptionLabel(type)}</option>)}</select></label>
              <label>Home Hub<select value={newFleet.homeHubId} onChange={(event) => setNewFleet({ ...newFleet, homeHubId: event.target.value })}><option value="">Select home Hub</option>{hubs.map((hub) => <option key={String(hub.id)} value={String(hub.id)}>{String(hub.code)} · {String(hub.name)}</option>)}</select></label>
              <h3 className="client-form-section-title">Vehicle details</h3>
              <FleetTextInput label="Model name" field="modelName" form={newFleet} setForm={setNewFleet} placeholder="Gracy" />
              <FleetTextInput label="Variant name" field="variantName" form={newFleet} setForm={setNewFleet} placeholder="Standard" />
              <FleetTextInput label="Colour" field="colour" form={newFleet} setForm={setNewFleet} placeholder="White" />
              <FleetTextInput label="Motor number" field="motorNumber" form={newFleet} setForm={setNewFleet} placeholder="Motor serial number" />
              <FleetTextInput label="Manufacturing year" field="manufacturingYear" form={newFleet} setForm={setNewFleet} type="number" min="1900" max="2100" placeholder="2025" />
              <FleetTextInput label="Manufacturing month" field="manufacturingMonth" form={newFleet} setForm={setNewFleet} type="number" min="1" max="12" placeholder="6" />
              <label>Ownership type *<select required value={newFleet.ownershipType} onChange={(event) => setNewFleet({ ...newFleet, ownershipType: event.target.value })}><option value="">Select ownership type</option>{fleetOwnershipTypes.map((type) => <option key={type} value={type}>{enumOptionLabel(type)}</option>)}</select></label>
              <FleetTextInput label="Odometer (km)" field="odometerKm" form={newFleet} setForm={setNewFleet} type="number" min="0" step="0.01" placeholder="0" />
              <h3 className="client-form-section-title">Registration & compliance</h3>
              <FleetTextInput label="Registration date" field="registrationDate" form={newFleet} setForm={setNewFleet} type="date" />
              <FleetTextInput label="Registering authority" field="registeringAuthority" form={newFleet} setForm={setNewFleet} placeholder="RTO Delhi" />
              <FleetTextInput label="RC expiry date" field="rcExpiryDate" form={newFleet} setForm={setNewFleet} type="date" />
              <FleetTextInput label="Insurance provider" field="insuranceProviderName" form={newFleet} setForm={setNewFleet} placeholder="Insurance provider" />
              <FleetTextInput label="Insurance policy number" field="insurancePolicyNumber" form={newFleet} setForm={setNewFleet} placeholder="Policy number" />
              <label>Insurance type<select value={newFleet.insuranceType} onChange={(event) => setNewFleet({ ...newFleet, insuranceType: event.target.value })}><option value="">Select insurance type</option>{insuranceTypes.map((type) => <option key={type} value={type}>{enumOptionLabel(type)}</option>)}</select></label>
              <FleetTextInput label="Insurance start date" field="insuranceStartDate" form={newFleet} setForm={setNewFleet} type="date" />
              <FleetTextInput label="Insurance end date" field="insuranceEndDate" form={newFleet} setForm={setNewFleet} type="date" />
              <FleetTextInput label="Fitness certificate number" field="fitnessCertificateNumber" form={newFleet} setForm={setNewFleet} placeholder="Fitness certificate number" />
              <FleetTextInput label="Fitness expiry date" field="fitnessExpiryDate" form={newFleet} setForm={setNewFleet} type="date" />
              <div className="client-form-wide form-actions"><button disabled={loading}>{editingFleetId ? "Save fleet" : "Create fleet"}</button><button type="button" className="secondary" onClick={() => setShowFleetForm(false)}>Cancel</button></div>
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
                {riderOnboardingConfiguration?.onboarding.steps.map((step) => <fieldset key={step.stepId} className="form-stack"><legend>{step.stepName}</legend>{step.fields.filter((field) => field.fieldCode && field.configuration.storageKey && field.billingUnit !== "UPLOAD").map((field) => <label key={field.fieldCode}>{field.configuration.label}{field.configuration.required ? " *" : ""}{field.configuration.fieldType === "TEXTAREA" ? <textarea value={riderDraft[field.fieldCode!] ?? ""} required={field.configuration.required} disabled={!field.configuration.editable || field.configuration.readOnly || field.configuration.disabled} onChange={(event) => setRiderDraft((current) => ({ ...current, [field.fieldCode!]: event.target.value }))} /> : <input type={field.configuration.fieldType === "DATE" ? "date" : field.configuration.fieldType === "MOBILE" ? "tel" : "text"} value={riderDraft[field.fieldCode!] ?? ""} required={field.configuration.required} disabled={!field.configuration.editable || field.configuration.readOnly || field.configuration.disabled} onChange={(event) => setRiderDraft((current) => ({ ...current, [field.fieldCode!]: event.target.value }))} />}</label>)}</fieldset>)}
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
              {kycTypes.map((type) => (
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
                actions={tab === "fleets" ? (item) => <><button className="secondary table-action" onClick={() => void openFleetForm(String(item.id))}>Edit</button>{item.status === "AVAILABLE" && <button className="table-action" disabled title="Allocation is temporarily unavailable">Allocate</button>}{item.status === "ALLOCATED" && <button className="danger table-action" disabled title="De-allocation is temporarily unavailable">De-Allocate</button>}<button className="danger table-action" onClick={() => setDeleteConfirmation({ title: "Delete Fleet?", description: "This fleet will be removed from the active list. Active allocations prevent deletion; existing history is retained.", confirmLabel: "Delete Fleet", onConfirm: () => deleteFleet(String(item.id)) })}>Delete</button></>
                  : tab === "riders" ? (item) => <><button className="secondary table-action" onClick={() => void openRiderDetail(String(item.id))}>View / Edit</button><button className="danger table-action" onClick={() => setDeleteConfirmation({ title: "Delete Rider?", description: "This rider will be removed from the active list. Active allocations prevent deletion; existing history is retained.", confirmLabel: "Delete Rider", onConfirm: () => deleteRider(String(item.id)) })}>Delete</button></>
                  : tab === "iot-devices" ? (item) => <button className="secondary table-action" onClick={() => void openIotForm(item)}>Edit</button>
                  : tab === "batteries" || tab === "controllers" ? (item) => <button className="secondary table-action" onClick={() => void openExistingComponentForm(tab, item)}>Edit</button>
                  : tab === "fleet-component-mapping" ? (item) => <button className="secondary table-action" onClick={() => void openMappingForm(item)}>Edit</button>
                  : tab === "rider-document-review" ? (item) => <><button className="secondary table-action" onClick={() => void downloadRiderDocument(item)}>View</button>{item.status === "PENDING" && <><button className="table-action" onClick={() => void approveRiderDocument(String(item.id))}>Approve</button><button className="danger table-action" onClick={() => { setDocumentRejectionReason(""); setRejectingDocument(item); }}>Reject</button></>}</>
                  : tab === "allocations" ? (item) => <>
                    <button className="secondary table-action" onClick={() => void openAllocationDetail(String(item.id))}>View</button>
                    <button className="secondary table-action" onClick={() => void openInspection(item)}>Inspect</button>
                    {item.status === "OTP_PENDING" && <button className="table-action" onClick={() => void activateAllocation(String(item.id))}>Activate</button>}
                    {item.status === "ACTIVE" && <button className="table-action" onClick={() => void initiateDeallocation(item)}>Deallocate</button>}
                  </> : undefined} />}
            </>
          )}
        </>}
        {tab === "locations" && showHubForm && <ClientFormDialog title={editingHubId ? "Edit hub" : "Add hub"} busy={loading} error={error} wide onClose={() => setShowHubForm(false)}>
                <p className="eyebrow">LOCATION SETUP</p>
                <h2>{editingHubId ? "Edit hub" : "Create hub"}</h2>
                <form className="form-stack" onSubmit={createHub}>
                  <section className="form-section">
                    <h3>Hub identity</h3>
                    <div className="form-grid">
                      <label>Hub name{" *"}<input required value={newHub.name} onChange={(event) => setNewHub((current) => ({ ...current, name: event.target.value }))} /></label>
                      <label>Hub code{" *"}<input required pattern="[A-Z0-9_-]+" value={newHub.code} onChange={(event) => setNewHub((current) => ({ ...current, code: event.target.value.toUpperCase() }))} /></label>
                      <label>Hub type<select value={newHub.type} onChange={(event) => setNewHub((current) => ({ ...current, type: event.target.value }))}><option value="OPERATIONS">Operations</option><option value="PARKING">Parking</option><option value="CHARGING">Charging</option><option value="BATTERY_SWAP">Battery swap</option><option value="MAINTENANCE">Maintenance</option><option value="WAREHOUSE">Warehouse</option><option value="DELIVERY">Delivery</option><option value="MIXED">Mixed</option></select></label>
                      <label>Status<select value={newHub.status} onChange={(event) => setNewHub((current) => ({ ...current, status: event.target.value }))}><option value="ACTIVE">Active</option><option value="INACTIVE">Inactive</option><option value="TEMPORARILY_CLOSED">Temporarily closed</option><option value="UNDER_MAINTENANCE">Under maintenance</option><option value="FULL">Full</option></select></label>
                      <label>Parent hub<select value={newHub.parentHubId} onChange={(event) => setNewHub((current) => ({ ...current, parentHubId: event.target.value }))}><option value="">No parent hub</option>{hubs.filter((hub) => String(hub.id) !== editingHubId).map((hub) => <option key={String(hub.id)} value={String(hub.id)}>{String(hub.code)} · {String(hub.name)}</option>)}</select></label>
                    </div>
                  </section>
                  <section className="form-section">
                    <h3>Location and address</h3>
                    <div className="form-grid">
                      <label className="form-grid-full">Address line 1<input value={newHub.addressLine1} onChange={(event) => setNewHub((current) => ({ ...current, addressLine1: event.target.value }))} /></label>
                      <label>Address line 2<input value={newHub.addressLine2} onChange={(event) => setNewHub((current) => ({ ...current, addressLine2: event.target.value }))} /></label>
                      <label>Landmark<input value={newHub.landmark} onChange={(event) => setNewHub((current) => ({ ...current, landmark: event.target.value }))} /></label>
                      <label>City{" *"}<input required value={newHub.city} onChange={(event) => setNewHub((current) => ({ ...current, city: event.target.value }))} /></label>
                      <label>District<input value={newHub.district} onChange={(event) => setNewHub((current) => ({ ...current, district: event.target.value }))} /></label>
                      <label>State{" *"}<input required value={newHub.state} onChange={(event) => setNewHub((current) => ({ ...current, state: event.target.value }))} /></label>
                      <label>Country<input value={newHub.country} onChange={(event) => setNewHub((current) => ({ ...current, country: event.target.value }))} /></label>
                      <label>PIN / postal code<input value={newHub.postalCode} maxLength={10} onChange={(event) => setNewHub((current) => ({ ...current, postalCode: event.target.value }))} /></label>
                      <label>Latitude<input type="number" step="any" value={newHub.latitude} onChange={(event) => setNewHub((current) => ({ ...current, latitude: event.target.value }))} /></label>
                      <label>Longitude<input type="number" step="any" value={newHub.longitude} onChange={(event) => setNewHub((current) => ({ ...current, longitude: event.target.value }))} /></label>
                    </div>
                  </section>
                  <section className="form-section">
                    <h3>Capacity and facilities</h3>
                    <div className="form-grid">
                      <label>Vehicle capacity<input type="number" min="0" step="1" value={newHub.vehicleCapacity} onChange={(event) => setNewHub((current) => ({ ...current, vehicleCapacity: event.target.value }))} /></label>
                      <label>Rider capacity<input type="number" min="0" step="1" value={newHub.riderCapacity} onChange={(event) => setNewHub((current) => ({ ...current, riderCapacity: event.target.value }))} /></label>
                      <label>Battery capacity<input type="number" min="0" step="1" value={newHub.batteryCapacity} onChange={(event) => setNewHub((current) => ({ ...current, batteryCapacity: event.target.value }))} /></label>
                      <label>Parking slots<input type="number" min="0" step="1" value={newHub.parkingSlots} onChange={(event) => setNewHub((current) => ({ ...current, parkingSlots: event.target.value }))} /></label>
                      <label>Charging points<input type="number" min="0" step="1" value={newHub.chargingPoints} onChange={(event) => setNewHub((current) => ({ ...current, chargingPoints: event.target.value }))} /></label>
                      <label>Battery swapping points<input type="number" min="0" step="1" value={newHub.swappingPoints} onChange={(event) => setNewHub((current) => ({ ...current, swappingPoints: event.target.value }))} /></label>
                    </div>
                  </section>
                  <section className="form-section">
                    <h3>Contact, hours, and services</h3>
                    <div className="form-grid">
                      <label>Contact name<input value={newHub.contactName} onChange={(event) => setNewHub((current) => ({ ...current, contactName: event.target.value }))} /></label>
                      <label>Contact phone<input type="tel" value={newHub.contactPhone} onChange={(event) => setNewHub((current) => ({ ...current, contactPhone: event.target.value }))} placeholder="+919876543210" /></label>
                      <label>Contact email<input type="email" value={newHub.contactEmail} onChange={(event) => setNewHub((current) => ({ ...current, contactEmail: event.target.value }))} /></label>
                      <label>Opening time<input type="time" value={newHub.openingTime} onChange={(event) => setNewHub((current) => ({ ...current, openingTime: event.target.value }))} /></label>
                      <label>Closing time<input type="time" value={newHub.closingTime} onChange={(event) => setNewHub((current) => ({ ...current, closingTime: event.target.value }))} /></label>
                    </div>
                    <div className="checkbox-grid">
                      <label><input type="checkbox" checked={newHub.is24x7} onChange={(event) => setNewHub((current) => ({ ...current, is24x7: event.target.checked }))} /> Open 24×7</label>
                      <label><input type="checkbox" checked={newHub.supportsCharging} onChange={(event) => setNewHub((current) => ({ ...current, supportsCharging: event.target.checked }))} /> Supports charging</label>
                      <label><input type="checkbox" checked={newHub.supportsBatterySwapping} onChange={(event) => setNewHub((current) => ({ ...current, supportsBatterySwapping: event.target.checked }))} /> Supports battery swapping</label>
                      <label><input type="checkbox" checked={newHub.supportsMaintenance} onChange={(event) => setNewHub((current) => ({ ...current, supportsMaintenance: event.target.checked }))} /> Supports maintenance</label>
                      <label><input type="checkbox" checked={newHub.supportsAllocation} onChange={(event) => setNewHub((current) => ({ ...current, supportsAllocation: event.target.checked }))} /> Supports allocation</label>
                      <label><input type="checkbox" checked={newHub.supportsDeallocation} onChange={(event) => setNewHub((current) => ({ ...current, supportsDeallocation: event.target.checked }))} /> Supports de-allocation</label>
                      <label><input type="checkbox" checked={newHub.supportsPdi} onChange={(event) => setNewHub((current) => ({ ...current, supportsPdi: event.target.checked }))} /> Supports PDI</label>
                    </div>
                  </section>
                  <div className="form-actions"><button>{editingHubId ? "Save hub" : "Create hub"}</button><button type="button" className="secondary" onClick={() => { setEditingHubId(""); setNewHub(emptyHubForm()); setShowHubForm(false); }}>Cancel</button></div>
                </form>
        </ClientFormDialog>}
        {tab === "evidence" && showPhotoTypeForm && <ClientFormDialog title="Add photo type" busy={loading} error={error} onClose={() => setShowPhotoTypeForm(false)}><h2>Add photo type</h2>
              <form className="form-stack" onSubmit={addPhotoRequirement}>
                <label>
                  New photo type *
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
        {fleetDetail && showDetailIotForm && <ClientFormDialog title="Register IoT device" busy={loading} error={error} onClose={() => setShowDetailIotForm(false)}><h2>Register IoT device</h2><form className="form-stack" onSubmit={(event) => { event.preventDefault(); void registerIotDevice(String(fleetDetail.id)); }}><label>Device number *<input required value={iotDeviceNumber} onChange={(event) => setIotDeviceNumber(event.target.value)} /></label><div className="form-actions"><button disabled={loading}>Register device</button><button type="button" className="secondary" onClick={() => setShowDetailIotForm(false)}>Cancel</button></div></form></ClientFormDialog>}
        {componentForm && <ClientFormDialog title={`${editingComponentId ? "Edit" : "Add"} ${componentForm === "batteries" ? "battery" : "controller"}`} busy={loading} error={error} onClose={() => setComponentForm(null)}><h2>{editingComponentId ? "Edit" : "Add"} {componentForm === "batteries" ? "battery" : "controller"}</h2><form className="form-stack" onSubmit={(event) => { event.preventDefault(); void saveComponent(componentFleetId, componentForm); }}><label>Fleet (optional)<select disabled={Boolean(editingComponentId)} value={componentFleetId} onChange={(event) => setComponentFleetId(event.target.value)}><option value="">Leave unassigned</option>{iotFleetOptions.map((fleet) => <option key={String(fleet.id)} value={String(fleet.id)}>{String(fleet.fleetCode ?? fleet.vehicleNumber ?? fleet.chassisNumber)}</option>)}</select></label><label>{componentForm === "batteries" ? "Battery serial number" : "Controller number"} *<input required value={componentSerial} onChange={(event) => setComponentSerial(event.target.value)} /></label><div className="form-grid"><label>Manufacturer<input value={componentDetails.manufacturer} onChange={(event) => setComponentDetails((current) => ({ ...current, manufacturer: event.target.value }))} /></label><label>Model<input value={componentDetails.model} onChange={(event) => setComponentDetails((current) => ({ ...current, model: event.target.value }))} /></label>{componentForm === "batteries" ? <><label>Battery code<input value={componentDetails.batteryCode} onChange={(event) => setComponentDetails((current) => ({ ...current, batteryCode: event.target.value }))} /></label><label>Battery type<select value={componentDetails.batteryType} onChange={(event) => setComponentDetails((current) => ({ ...current, batteryType: event.target.value }))}><option value="FIXED_SINGLE">Fixed single</option><option value="FIXED_DOUBLE">Fixed double</option><option value="SWAP_IF">Swap IF</option><option value="SWAP_BS">Swap BS</option><option value="SWAP_MOVING">Swap moving</option><option value="SWAP_OTHER">Swap other</option></select></label><label>Battery slot<select value={componentDetails.batterySlot} onChange={(event) => setComponentDetails((current) => ({ ...current, batterySlot: event.target.value }))}><option value="PRIMARY">Primary</option><option value="SECONDARY">Secondary</option></select></label><label>Chemistry<input value={componentDetails.chemistry} onChange={(event) => setComponentDetails((current) => ({ ...current, chemistry: event.target.value }))} placeholder="LFP, NMC, LTO…" /></label><label>Capacity (kWh)<input type="number" min="0" step="0.001" value={componentDetails.capacityKwh} onChange={(event) => setComponentDetails((current) => ({ ...current, capacityKwh: event.target.value }))} /></label><label>Voltage<input type="number" min="0" step="0.01" value={componentDetails.voltage} onChange={(event) => setComponentDetails((current) => ({ ...current, voltage: event.target.value }))} /></label><label>Amp hour<input type="number" min="0" step="0.01" value={componentDetails.ampHour} onChange={(event) => setComponentDetails((current) => ({ ...current, ampHour: event.target.value }))} /></label><label>Installed odometer (km)<input type="number" min="0" step="0.01" value={componentDetails.installedOdometerKm} onChange={(event) => setComponentDetails((current) => ({ ...current, installedOdometerKm: event.target.value }))} /></label><label>Manufacturing date<input type="date" value={componentDetails.manufacturingDate} onChange={(event) => setComponentDetails((current) => ({ ...current, manufacturingDate: event.target.value }))} /></label><label>Warranty start date<input type="date" value={componentDetails.warrantyStartDate} onChange={(event) => setComponentDetails((current) => ({ ...current, warrantyStartDate: event.target.value }))} /></label><label>Warranty end date<input type="date" value={componentDetails.warrantyEndDate} onChange={(event) => setComponentDetails((current) => ({ ...current, warrantyEndDate: event.target.value }))} /></label></> : <><label>Rated voltage<input type="number" min="0" step="0.01" value={componentDetails.ratedVoltage} onChange={(event) => setComponentDetails((current) => ({ ...current, ratedVoltage: event.target.value }))} /></label><label>Rated current<input type="number" min="0" step="0.01" value={componentDetails.ratedCurrent} onChange={(event) => setComponentDetails((current) => ({ ...current, ratedCurrent: event.target.value }))} /></label></>}</div><div className="form-actions"><button disabled={loading || !componentSerial.trim()}>{editingComponentId ? "Save" : "Add"} {componentForm === "batteries" ? "battery" : "controller"}</button><button type="button" className="secondary" onClick={() => setComponentForm(null)}>Cancel</button></div></form></ClientFormDialog>}
        {rejectingDocument && <ClientFormDialog title="Reject rider document" busy={loading} error={error} onClose={() => setRejectingDocument(null)}><form className="form-stack" onSubmit={rejectRiderDocument}><p className="muted">Provide a clear reason so the Rider knows what to correct before uploading a replacement.</p><label>Rejection reason *<textarea required minLength={3} maxLength={1000} value={documentRejectionReason} onChange={(event) => setDocumentRejectionReason(event.target.value)} placeholder="For example, document is blurred or does not match the submitted details." /></label><div className="form-actions"><button className="danger" disabled={loading || !documentRejectionReason.trim()}>Reject document</button><button type="button" className="secondary" onClick={() => setRejectingDocument(null)}>Cancel</button></div></form></ClientFormDialog>}
        {showMappingForm && <ClientFormDialog title="Fleet Component Mapping" busy={loading} error={error} onClose={() => setShowMappingForm(false)}><form className="form-stack" onSubmit={saveMapping}><h2>Map Fleet components</h2><label>Fleet *<select required value={mappingFleetId} onChange={(event) => setMappingFleetId(event.target.value)}><option value="">Select Fleet</option>{mappingOptions.fleets.map((fleet) => <option key={String(fleet.id)} value={String(fleet.id)}>{String(fleet.fleetCode ?? fleet.vehicleNumber)}</option>)}</select></label><div className="form-grid"><label>IoT device<select value={mappingIotId} onChange={(event) => setMappingIotId(event.target.value)}><option value="">Unassigned</option>{mappingOptions.devices.map((device) => <option key={String(device.id)} value={String(device.id)}>{String(device.deviceNumber)}</option>)}</select></label><label>Controller<select value={mappingControllerId} onChange={(event) => setMappingControllerId(event.target.value)}><option value="">Unassigned</option>{mappingOptions.controllers.map((controller) => <option key={String(controller.id)} value={String(controller.id)}>{String(controller.controllerNumber)}</option>)}</select></label><label>Primary battery<select value={mappingBatteryIds[0] ?? ""} onChange={(event) => setMappingBatteryIds((current) => [event.target.value, current[1]].filter(Boolean))}><option value="">Unassigned</option>{mappingOptions.batteries.map((battery) => <option key={String(battery.id)} value={String(battery.id)}>{String(battery.batteryCode ?? battery.serialNumber)}</option>)}</select></label><label>Secondary battery<select value={mappingBatteryIds[1] ?? ""} onChange={(event) => setMappingBatteryIds((current) => [current[0], event.target.value].filter(Boolean))}><option value="">Unassigned</option>{mappingOptions.batteries.map((battery) => <option key={String(battery.id)} value={String(battery.id)}>{String(battery.batteryCode ?? battery.serialNumber)}</option>)}</select></label></div><div className="form-actions"><button disabled={loading || !mappingFleetId}>Save mapping</button><button type="button" className="secondary" onClick={() => setShowMappingForm(false)}>Cancel</button></div></form></ClientFormDialog>}
        <ClientDeleteDialog confirmation={deleteConfirmation} busy={loading} onClose={() => setDeleteConfirmation(null)} />
        <footer className="client-operations-footer">Powered by EV Spares India Pvt Ltd</footer>
      </section>
    </main>
  );
}
