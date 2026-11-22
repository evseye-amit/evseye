import type { IconName } from "./ui-icon";

export type Tab =
  | "rental-billing"
  | "autopay-settings"
  | "payment-transactions"
  | "payment-reconciliation"
  | "payment-settlements"
  | "spares-penalties"
  | "installation-board" | "vehicle-preparation" | "quality-check" | "readiness-settings" | "advisors" | "qc-managers"
  | "dashboard"
  | "legal-documents"
  | "refer-and-earn"
  | "work-partners"
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
  | "rider-document-review"
  | "rider-reference-review"
  | "support-tickets"
  | "rider-rate-cards"
  | "notifications"
  | "zones"
  | "reports"
  | "feature-usage";

export const CLIENT_NAVIGATION: Array<{
  label: string;
  kyc?: boolean;
  branding?: boolean;
  items: Array<{ id: Tab; label: string; group?: string }>;
}> = [
  { label: "", items: [{ id: "dashboard", label: "Dashboard" }] },
  {
    label: "Team Management",
    items: [
      { id: "fleet-managers", label: "Fleet Manager" },
      { id: "team-leads", label: "Team Lead" },
      { id: "cluster-managers", label: "Cluster Manager" },
      { id: "advisors", label: "Advisors" },
      { id: "qc-managers", label: "QC Manager" },
    ],
  },
  {
    label: "Vehicle Management",
    items: [
      { id: "fleets", label: "Fleet", group: "Fleet & Components" },
      { id: "batteries", label: "Battery", group: "Fleet & Components" },
      { id: "controllers", label: "Controller", group: "Fleet & Components" },
      { id: "iot-devices", label: "IoT", group: "Fleet & Components" },
      { id: "fleet-component-mapping", label: "Fleet Component Mapping", group: "Fleet & Components" },
      { id: "installation-board", label: "Installation Board", group: "Preparation & Quality" },
      { id: "vehicle-preparation", label: "Vehicle Preparation", group: "Preparation & Quality" },
      { id: "quality-check", label: "Quality Check", group: "Preparation & Quality" },
      { id: "spares-penalties", label: "Spares & Penalties", group: "Spares & Penalties" },
      { id: "readiness-settings", label: "Fleet Readiness Settings", group: "Settings" },
    ],
  },
  {
    label: "Rider Management",
    items: [
      { id: "riders", label: "Riders" },
      { id: "work-partners", label: "Work Partners" },
      { id: "rider-document-review", label: "Document Verification" },
      { id: "rider-reference-review", label: "Reference Verification" },
    ],
  },
  {
    label: "Payments",
    items: [
      { id: "payment-transactions", label: "Transactions" },
      { id: "payment-reconciliation", label: "Refunds & Reconciliation" },
      { id: "payment-settlements", label: "Settlements" },
      { id: "autopay-settings", label: "AutoPay" },
      { id: "rental-billing", label: "Rent billing" },
      { id: "rider-rate-cards", label: "Rider Rate Cards" },
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
    label: "Engagement & Support",
    items: [{ id: "refer-and-earn", label: "Refer & Earn" }, { id: "support-tickets", label: "Support Tickets" }, { id: "notifications", label: "Notification" }],
  },
  {
    label: "Monitoring & Compliance",
    kyc: true,
    items: [
      { id: "reports", label: "Reports" },
      { id: "audit", label: "Audit Log" },
      { id: "feature-usage", label: "Feature Usage" },
    ],
  },
  {
    label: "Workspace Settings",
    branding: true,
    items: [{ id: "legal-documents", label: "Legal Documents" }],
  },
];

export const CLIENT_TAB_ICONS: Record<Tab, IconName> = {
  "autopay-settings": "pricing",
  "rental-billing": "pricing",
  "payment-transactions": "pricing",
  "payment-reconciliation": "pricing",
  "payment-settlements": "pricing",
  "spares-penalties": "factory",
  "installation-board": "vehicle",
  "vehicle-preparation": "vehicle", "quality-check": "shield", "readiness-settings": "factory", "advisors": "user", "qc-managers": "shield",
  dashboard: "dashboard",
  "legal-documents": "audit",
  "refer-and-earn": "earnings",
  "work-partners": "link",
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
  "rider-document-review": "shield",
  "rider-reference-review": "shield",
  "support-tickets": "support",
  "rider-rate-cards": "pricing",
  notifications: "notification",
  zones: "zone",
  reports: "reports",
  "feature-usage": "usage",
};

export function canAccessTab(id: Tab, userRoles: string[]) {
    if (userRoles.some(role => ["ADVISOR","QC_MANAGER"].includes(role))) return ["installation-board","vehicle-preparation","quality-check"].includes(id);
    if (["audit","rental-billing","autopay-settings","payment-transactions","payment-reconciliation","payment-settlements","spares-penalties","legal-documents","refer-and-earn","readiness-settings","work-partners"].includes(id)) return userRoles.includes("CLIENT_ADMIN");
    if (["notifications","advisors","qc-managers"].includes(id)) return userRoles.some(role => ["CLIENT_ADMIN","FLEET_MANAGER"].includes(role));
    return true;
}
