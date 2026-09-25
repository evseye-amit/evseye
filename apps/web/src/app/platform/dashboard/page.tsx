"use client";
import { sessionFetch as fetch } from "../../../lib/session-fetch";
import {
  allowanceResetPeriods,
  billingCycles,
  clientIndustries,
  energyTypes,
  featureBillingUnits,
  featureCategories,
  featureTypes,
  fleetBusinessModels,
  masterRecordStatuses,
  vehicleOwnerships,
  vehicleUsageTypes,
} from "../../../lib/domain-enums";
/* eslint-disable @typescript-eslint/no-explicit-any */

import {
  FormEvent,
  ReactNode,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import Link from "next/link";
import { ClientCommercialSettings, type ClientCommercialSection } from "../../components/client-commercial-settings";
import { ClientDomainSettings } from "../../components/client-domain-settings";
import { ClientLogoUpload } from "../../components/client-logo-upload";
import { LanguageSwitcher, useLocale } from "../../components/locale-provider";
import { UiIcon, type IconName } from "../../components/ui-icon";
import {
  filterRows,
  getColumnFilterOptions,
  getSelectOptions,
  hasInvalidNumberRange,
  type ColumnFilterSpec,
  type ColumnFilterState,
  type ColumnFilterStateMap,
} from "./data-table-filter";

const API_URL =
  "/api/v1";
const ACCESS_TOKEN_KEY = "evs-eye-session-present";
const REFRESH_TOKEN_KEY = "evs-eye-session-refreshable";
type Tab =
  | "dashboard"
  | "clients"
  | "oems"
  | "vehicleCategories"
  | "vehicleTypes"
  | "featureSteps"
  | "features"
  | "packages"
  | "pricing"
  | "featureAddOns"
  | "packageFeatures"
  | "packageAddOns"
  | "packageTierPricing"
  | "clientPricingAdjustments"
  | "clientAddOnPurchases"
  | "clientCreditLots"
  | "clientUsageLedger";
type Item = Record<string, any>;
type BulkImportEntity =
  | "oem"
  | "vehicle-category"
  | "vehicle-type"
  | "feature"
  | "package";
type BulkImportHistoryEntry = {
  id: string;
  entity: BulkImportEntity;
  fileName: string;
  status: "PASS" | "PARTIAL_PASS" | "FAIL";
  totalRows: number;
  passedRows: number;
  failedRows: number;
  createdAt: string;
  error?: string;
};
type DeleteConfirmation = {
  title: string;
  description: string;
  confirmLabel: string;
  onConfirm: () => Promise<void>;
};
const BULK_IMPORT_HISTORY_KEY = "evs-eye-platform-bulk-import-history";

function parseCsvLine(line: string) {
  const cells: string[] = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') quoted = !quoted;
    else if (char === "," && !quoted) {
      cells.push(current.trim());
      current = "";
    } else current += char;
  }
  cells.push(current.trim());
  return cells.map((cell) => cell.replace(/^"|"$/g, ""));
}

async function request(
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
  const body = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(body.error?.message ?? body.message ?? "Request failed.");
  return body.data;
}

const emptyOem = {
  code: "",
  name: "",
  displayName: "",
  status: "ACTIVE",
  website: "",
  description: "",
};
const emptyClient = {
  id: "",
  businessFleetName: "",
  companyCode: "",
  legalEntityName: "",
  clientType: "",
  businessType: "",
  industry: "",
  gstin: "",
  pan: "",
  cinOrLlpin: "",
  website: "",
  yearEstablished: "",
  estimatedFleetSize: "",
  estimatedRiderCount: "",
  estimatedUserCount: "",
  primaryContactName: "",
  primaryDesignation: "",
  primaryMobile: "",
  primaryEmail: "",
  alternateMobile: "",
  adminSameAsPrimary: true,
  adminName: "",
  adminEmail: "",
  adminMobile: "",
  adminDesignation: "",
  registeredAddressLine1: "",
  registeredAddressLine2: "",
  landmark: "",
  city: "",
  district: "",
  state: "",
  country: "India",
  pinCode: "",
  billingSameAsRegistered: true,
  billingAddressLine1: "",
  billingAddressLine2: "",
  billingLandmark: "",
  billingCity: "",
  billingDistrict: "",
  billingState: "",
  billingCountry: "India",
  billingPinCode: "",
  fleetBusinessModel: "",
  numberOfFleets: "",
  approximateRiderCount: "",
  vehicleOwnership: "",
  vehicleCategoryIds: [] as string[],
  operationalHubCount: "",
  packageId: "",
  billingCycle: "",
  startDate: new Date().toISOString().slice(0, 10),
  endDate: "",
  trialRequired: false,
  autoRenew: true,
  billingContactName: "",
  billingEmail: "",
  billingMobile: "",
  purchaseOrderRequired: false,
  poNumber: "",
  paymentTerms: "",
  authorizedSignatoryName: "",
  signatoryDesignation: "",
  termsAccepted: false,
  privacyAccepted: false,
  dataProcessingConsent: false,
  kycConsent: false,
  marketingConsent: false,
};
const clientStepLabels = [
  "Business Details",
  "Contacts & Address",
  "Fleet Operations",
  "Package Selection",
  "Billing & Documents",
  "Review & Submit",
] as const;
const emptyVehicleCategory = {
  code: "",
  name: "",
  description: "",
  status: "ACTIVE",
  displayOrder: "0",
};
const emptyVehicleType = {
  categoryId: "",
  code: "",
  name: "",
  subCategory: "",
  description: "",
  energyType: "",
  usageType: "",
  status: "ACTIVE",
};
const emptyPackage = {
  code: "",
  name: "",
  setupFee: "0",
  currency: "INR",
  description: "",
  maxFleets: "2147483647",
  maxRiders: "2147483647",
  maxAdmins: "2147483647",
  maxFleetManagers: "2147483647",
  maxHubs: "2147483647",
  maxTeamLeaders: "2147483647",
  maxClusterManagers: "2147483647",
  maxUsers: "2147483647",
  trialDays: "0",
  displayOrder: "0",
  isCustom: false,
  isActive: true,
};
const PACKAGE_UNLIMITED_LIMIT = 2_147_483_647;
const packageLimitFields = [
  ["maxFleets", "Maximum fleets"],
  ["maxRiders", "Maximum riders"],
  ["maxAdmins", "Maximum admins"],
  ["maxFleetManagers", "Maximum fleet managers"],
  ["maxHubs", "Maximum hubs"],
  ["maxTeamLeaders", "Maximum team leaders"],
  ["maxClusterManagers", "Maximum cluster managers"],
  ["maxUsers", "Maximum users"],
] as const;

function isUnlimitedPackageLimit(value: unknown) {
  return Number(value) === PACKAGE_UNLIMITED_LIMIT;
}

function displayPackageLimit(value: unknown) {
  return isUnlimitedPackageLimit(value) ? "Unlimited" : String(value ?? 0);
}
const emptyFeature = {
  code: "",
  name: "",
  description: "",
  category: "",
  featureType: "",
  billingUnit: "",
  configuration: "",
  featureStepId: "",
  displayOrder: "0",
  isActive: true,
  isAddOnEligible: false,
};
const emptyFeatureStep = {
  code: "",
  displayName: "",
  description: "",
  parentId: "",
  displayOrder: "0",
  isActive: true,
};
const emptyPricing = {
  featureId: "",
  billingUnit: "",
  currency: "INR",
  salePrice: "",
  costPrice: "",
  effectiveFrom: new Date().toISOString().slice(0, 10),
  effectiveTo: "",
  isActive: true,
  metadata: "",
};
const emptyFeatureAddOn = {
  code: "",
  name: "",
  description: "",
  featureId: "",
  quantity: "",
  discount: "0",
  validityDays: "",
  effectiveFrom: new Date().toISOString().slice(0, 10),
  effectiveTo: "",
  isActive: true,
};

function Metric({
  label,
  value,
  tone,
  detail,
}: {
  label: string;
  value: string | number;
  tone: string;
  detail?: string;
}) {
  const { t } = useLocale();
  return (
    <article className="sa-metric">
      <span className={`sa-icon ${tone}`}>◈</span>
      <strong>{value}</strong>
      <small>{t(label)}</small>
      <em>{t(detail ?? "Live")}</em>
    </article>
  );
}

type CatalogFormDialogProps = Readonly<{
  open: boolean;
  title: string;
  description: string;
  error: string;
  busy: boolean;
  size?: "default" | "wide";
  triggerRef: { current: HTMLButtonElement | null };
  onClose: () => void;
  onDialogClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void | Promise<void>;
  actions: ReactNode;
  children: ReactNode;
}>;

function CatalogFormDialog({
  open,
  title,
  description,
  error,
  busy,
  size = "default",
  triggerRef,
  onClose,
  onDialogClose,
  onSubmit,
  actions,
  children,
}: CatalogFormDialogProps) {
  const { t } = useLocale();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const dialogId = useId();
  const wasOpenRef = useRef(false);
  const titleId = `${dialogId}-title`;
  const descriptionId = `${dialogId}-description`;
  const errorId = `${dialogId}-error`;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    let frame = 0;
    if (open) {
      if (!dialog.open) dialog.showModal();
      frame = window.requestAnimationFrame(() => {
        dialog
          .querySelector<HTMLElement>(
            '[data-dialog-initial-focus], input:not([type="file"]):not([type="hidden"]), select, textarea',
          )
          ?.focus();
      });
    } else {
      if (dialog.open) dialog.close();
      if (wasOpenRef.current) {
        frame = window.requestAnimationFrame(() => {
          triggerRef.current?.focus();
        });
      }
    }
    wasOpenRef.current = open;

    return () => {
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [open, triggerRef]);

  return (
    <dialog
      ref={dialogRef}
      className={`sa-dialog sa-dialog-${size}`}
      aria-labelledby={titleId}
      aria-describedby={error ? `${descriptionId} ${errorId}` : descriptionId}
      aria-modal="true"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
      onClose={onDialogClose}
    >
      <form
        className="sa-form sa-dialog-surface"
        onSubmit={onSubmit}
        aria-busy={busy}
      >
        <header className="sa-dialog-head">
          <div>
            <h2 id={titleId}>{t(title)}</h2>
            <p id={descriptionId}>{t(description)}</p>
          </div>
        </header>
        {error && (
          <p id={errorId} className="error sa-dialog-error" role="alert">
            {error}
          </p>
        )}
        {children}
        <footer className="sa-dialog-actions">{actions}</footer>
      </form>
    </dialog>
  );
}

export default function SuperAdminDashboard() {
  const { t } = useLocale();
  const [token, setToken] = useState(() =>
    typeof window === "undefined"
      ? ""
      : (sessionStorage.getItem(ACCESS_TOKEN_KEY) ?? ""),
  );
  const [tab, setTab] = useState<Tab>("dashboard");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [deleteConfirmation, setDeleteConfirmation] =
    useState<DeleteConfirmation | null>(null);
  const [summary, setSummary] = useState<Item>({});
  const [clients, setClients] = useState<Item[]>([]);
  const [oems, setOems] = useState<Item[]>([]);
  const [vehicleCategories, setVehicleCategories] = useState<Item[]>([]);
  const [vehicleTypes, setVehicleTypes] = useState<Item[]>([]);
  const [packages, setPackages] = useState<Item[]>([]);
  const [featureSteps, setFeatureSteps] = useState<Item[]>([]);
  const [features, setFeatures] = useState<Item[]>([]);
  const [pricing, setPricing] = useState<Item[]>([]);
  const [featureAddOns, setFeatureAddOns] = useState<Item[]>([]);
  const [selectedClientId, setSelectedClientId] = useState("");
  const [oem, setOem] = useState(emptyOem);
  const [editingOemId, setEditingOemId] = useState<string | null>(null);
  const [showOemForm, setShowOemForm] = useState(false);
  const oemTriggerRef = useRef<HTMLButtonElement | null>(null);
  const [bulkImportEntity, setBulkImportEntity] =
    useState<BulkImportEntity | null>(null);
  const [bulkImportHistory, setBulkImportHistory] = useState<
    BulkImportHistoryEntry[]
  >(() => {
    if (typeof window === "undefined") return [];
    try {
      const saved = localStorage.getItem(BULK_IMPORT_HISTORY_KEY);
      return saved ? (JSON.parse(saved) as BulkImportHistoryEntry[]) : [];
    } catch {
      return [];
    }
  });
  const [oemLogoFile, setOemLogoFile] = useState<File | null>(null);
  const [oemLogoPreview, setOemLogoPreview] = useState("");
  const [vehicleCategory, setVehicleCategory] = useState(emptyVehicleCategory);
  const [editingVehicleCategoryId, setEditingVehicleCategoryId] = useState<
    string | null
  >(null);
  const [showVehicleCategoryForm, setShowVehicleCategoryForm] = useState(false);
  const vehicleCategoryTriggerRef = useRef<HTMLButtonElement | null>(null);
  const [vehicleType, setVehicleType] = useState(emptyVehicleType);
  const [editingVehicleTypeId, setEditingVehicleTypeId] = useState<
    string | null
  >(null);
  const [showVehicleTypeForm, setShowVehicleTypeForm] = useState(false);
  const vehicleTypeTriggerRef = useRef<HTMLButtonElement | null>(null);
  const [feature, setFeature] = useState(emptyFeature);
  const [editingFeatureId, setEditingFeatureId] = useState<string | null>(null);
  const [showFeatureForm, setShowFeatureForm] = useState(false);
  const featureTriggerRef = useRef<HTMLButtonElement | null>(null);
  const [featureStep, setFeatureStep] = useState(emptyFeatureStep);
  const [editingFeatureStepId, setEditingFeatureStepId] = useState<string | null>(null);
  const [showFeatureStepForm, setShowFeatureStepForm] = useState(false);
  const featureStepTriggerRef = useRef<HTMLButtonElement | null>(null);
  const [pack, setPack] = useState(emptyPackage);
  const [editingPackageId, setEditingPackageId] = useState<string | null>(null);
  const [showPackageForm, setShowPackageForm] = useState(false);
  const packageTriggerRef = useRef<HTMLButtonElement | null>(null);
  const [price, setPrice] = useState(emptyPricing);
  const [editingPricingId, setEditingPricingId] = useState<string | null>(null);
  const [showPricingForm, setShowPricingForm] = useState(false);
  const pricingTriggerRef = useRef<HTMLButtonElement | null>(null);
  const [featureAddOn, setFeatureAddOn] = useState(emptyFeatureAddOn);
  const [editingFeatureAddOnId, setEditingFeatureAddOnId] = useState<string | null>(null);
  const [showFeatureAddOnForm, setShowFeatureAddOnForm] = useState(false);
  const featureAddOnTriggerRef = useRef<HTMLButtonElement | null>(null);
  const [clientStep, setClientStep] = useState(1);
  const [showClientForm, setShowClientForm] = useState(false);
  const clientTriggerRef = useRef<HTMLButtonElement | null>(null);
  const [client, setClient] = useState<Item>(emptyClient);
  const [clientLogoFile, setClientLogoFile] = useState<File | null>(null);
  const [clientDocumentFiles, setClientDocumentFiles] = useState<
    Record<string, File | undefined>
  >({});
  const [activeClientEdit, setActiveClientEdit] = useState(false);
  const [approvalEmailReference, setApprovalEmailReference] = useState("");
  const [expandedNavGroups, setExpandedNavGroups] = useState<
    Record<string, boolean>
  >({});

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [
        dashboard,
        clientList,
        oemList,
        vehicleCategoryList,
        vehicleTypeList,
        packageList,
        featureStepList,
        featureList,
        priceList,
      ] = await Promise.all([
        request("/platform/dashboard", {}, token),
        request("/platform/clients", {}, token),
        request("/platform/oems", {}, token),
        request("/platform/vehicle-categories", {}, token),
        request("/platform/vehicle-types", {}, token),
        request("/platform/packages", {}, token),
        request("/platform/feature-steps", {}, token),
        request("/platform/features", {}, token),
        request("/platform/feature-pricing", {}, token),
      ]);
      setSummary(dashboard);
      setClients(clientList);
      setOems(oemList);
      setVehicleCategories(vehicleCategoryList);
      setVehicleTypes(vehicleTypeList);
      setPackages(packageList);
      setFeatureSteps(featureStepList);
      setFeatures(featureList);
      setPricing(priceList);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Unable to load platform data.",
      );
    } finally {
      setLoading(false);
    }
  }, [token]);
  useEffect(() => {
    // Data loading updates view state when the authenticated session changes.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (token) void load();
  }, [token, load]);
  function openOemModal(trigger: HTMLButtonElement, item?: Item) {
    oemTriggerRef.current = trigger;
    setError("");
    setNotice("");
    setBulkImportEntity(null);
    if (item) {
      setOem({
        code: item.code,
        name: item.name,
        displayName: item.displayName,
        status: item.status,
        website: item.website ?? "",
        description: item.description ?? "",
      });
      setEditingOemId(item.id);
    } else {
      setOem(emptyOem);
      setEditingOemId(null);
    }
    setOemLogoFile(null);
    setOemLogoPreview("");
    setShowOemForm(true);
  }
  function closeOemModal() {
    setError("");
    setShowOemForm(false);
  }
  function openVehicleCategoryModal(
    trigger: HTMLButtonElement,
    item?: Item,
    hideBulk = false,
  ) {
    vehicleCategoryTriggerRef.current = trigger;
    setError("");
    if (hideBulk) setBulkImportEntity(null);
    if (item) {
      setVehicleCategory({
        code: item.code,
        name: item.name,
        description: item.description ?? "",
        status: item.status,
        displayOrder: String(item.displayOrder ?? 0),
      });
      setEditingVehicleCategoryId(item.id);
    } else {
      setVehicleCategory(emptyVehicleCategory);
      setEditingVehicleCategoryId(null);
    }
    setShowVehicleCategoryForm(true);
  }
  function closeVehicleCategoryModal() {
    setError("");
    setShowVehicleCategoryForm(false);
  }
  function openVehicleTypeModal(
    trigger: HTMLButtonElement,
    item?: Item,
    hideBulk = false,
  ) {
    vehicleTypeTriggerRef.current = trigger;
    setError("");
    if (hideBulk) setBulkImportEntity(null);
    if (item) {
      setVehicleType({
        categoryId: item.categoryId,
        code: item.code,
        name: item.name,
        subCategory: item.subCategory ?? "",
        description: item.description ?? "",
        energyType: item.energyType,
        usageType: item.usageType ?? "",
        status: item.status,
      });
      setEditingVehicleTypeId(item.id);
    } else {
      setVehicleType(emptyVehicleType);
      setEditingVehicleTypeId(null);
    }
    setShowVehicleTypeForm(true);
  }
  function closeVehicleTypeModal() {
    setError("");
    setShowVehicleTypeForm(false);
  }
  function openFeatureModal(
    trigger: HTMLButtonElement,
    item?: Item,
    hideBulk = false,
  ) {
    featureTriggerRef.current = trigger;
    setError("");
    if (hideBulk) setBulkImportEntity(null);
    if (item) {
      setFeature({
        code: item.code,
        name: item.name,
        description: item.description ?? "",
        category: item.category,
        featureType: item.featureType,
        billingUnit: item.billingUnit,
        configuration: item.configuration
          ? JSON.stringify(item.configuration, null, 2)
          : "",
        featureStepId: item.featureStepId ?? "",
        displayOrder: String(item.displayOrder),
        isActive: item.isActive,
        isAddOnEligible: Boolean(item.isAddOnEligible),
      });
      setEditingFeatureId(item.id);
    } else {
      setFeature(emptyFeature);
      setEditingFeatureId(null);
    }
    setShowFeatureForm(true);
  }
  function closeFeatureModal() {
    setError("");
    setShowFeatureForm(false);
  }
  function openFeatureStepModal(trigger: HTMLButtonElement, item?: Item) {
    featureStepTriggerRef.current = trigger;
    setError("");
    if (item) {
      setFeatureStep({
        code: item.code,
        displayName: item.displayName,
        description: item.description ?? "",
        parentId: item.parentId ?? "",
        displayOrder: String(item.displayOrder ?? 0),
        isActive: item.isActive,
      });
      setEditingFeatureStepId(item.id);
    } else {
      setFeatureStep(emptyFeatureStep);
      setEditingFeatureStepId(null);
    }
    setShowFeatureStepForm(true);
  }
  function closeFeatureStepModal() {
    setError("");
    setShowFeatureStepForm(false);
  }
  function openPackageModal(trigger: HTMLButtonElement, item?: Item) {
    packageTriggerRef.current = trigger;
    setError("");
    setBulkImportEntity(null);
    if (item) {
      setPack({
        code: item.code,
        name: item.name,
        setupFee: String(item.setupFee ?? 0),
        currency: item.currency,
        description: item.description ?? "",
        maxFleets: String(item.maxFleets ?? 0),
        maxRiders: String(item.maxRiders ?? 0),
        maxAdmins: String(item.maxAdmins ?? 0),
        maxFleetManagers: String(item.maxFleetManagers ?? 0),
        maxHubs: String(item.maxHubs ?? 0),
        maxTeamLeaders: String(item.maxTeamLeaders ?? 0),
        maxClusterManagers: String(item.maxClusterManagers ?? 0),
        maxUsers: String(item.maxUsers ?? 0),
        trialDays: String(item.trialDays ?? 0),
        displayOrder: String(item.displayOrder ?? 0),
        isCustom: item.isCustom,
        isActive: item.isActive,
      });
      setEditingPackageId(item.id);
    } else {
      setPack(emptyPackage);
      setEditingPackageId(null);
    }
    setShowPackageForm(true);
  }
  function closePackageModal() {
    setError("");
    setShowPackageForm(false);
  }
  function openPricingModal(trigger: HTMLButtonElement, item?: Item) {
    pricingTriggerRef.current = trigger;
    setError("");
    if (item) {
      setPrice({
        featureId: item.featureId,
        billingUnit: item.billingUnit,
        salePrice: String(item.salePrice ?? ""),
        costPrice: item.costPrice === null ? "" : String(item.costPrice ?? ""),
        currency: item.currency,
        effectiveFrom: item.effectiveFrom.slice(0, 10),
        effectiveTo: item.effectiveTo ? item.effectiveTo.slice(0, 10) : "",
        isActive: item.isActive,
        metadata: item.metadata
          ? JSON.stringify(item.metadata, null, 2)
          : "",
      });
      setEditingPricingId(item.id);
    } else {
      setPrice(emptyPricing);
      setEditingPricingId(null);
    }
    setShowPricingForm(true);
  }
  function closePricingModal() {
    setError("");
    setShowPricingForm(false);
  }
  function openFeatureAddOnModal(trigger: HTMLButtonElement, item?: Item) {
    featureAddOnTriggerRef.current = trigger;
    setError("");
    if (item) {
      setFeatureAddOn({
        code: item.code,
        name: item.name,
        description: item.description ?? "",
        featureId: item.featureId,
        quantity: String(item.quantity ?? ""),
        discount: String(item.discount ?? 0),
        validityDays: item.validityDays === null ? "" : String(item.validityDays ?? ""),
        effectiveFrom: item.effectiveFrom.slice(0, 10),
        effectiveTo: item.effectiveTo ? item.effectiveTo.slice(0, 10) : "",
        isActive: item.isActive,
      });
      setEditingFeatureAddOnId(item.id);
    } else {
      setFeatureAddOn(emptyFeatureAddOn);
      setEditingFeatureAddOnId(null);
    }
    setShowFeatureAddOnForm(true);
  }
  function closeFeatureAddOnModal() {
    setError("");
    setShowFeatureAddOnForm(false);
  }
  function openClientModal(trigger: HTMLButtonElement) {
    clientTriggerRef.current = trigger;
    if (!client.id) {
      setClient(emptyClient);
      setClientLogoFile(null);
      setClientDocumentFiles({});
      setClientStep(1);
    }
    setActiveClientEdit(false);
    setApprovalEmailReference("");
    setError("");
    setNotice("");
    setShowClientForm(true);
  }
  function closeClientModal() {
    setError("");
    setActiveClientEdit(false);
    setApprovalEmailReference("");
    setShowClientForm(false);
  }
  async function submitOem(event: FormEvent) {
    event.preventDefault();
    await submit(
      async () => {
        const saved = await request(
          editingOemId ? `/platform/oems/${editingOemId}` : "/platform/oems",
          { method: editingOemId ? "PUT" : "POST", body: JSON.stringify(oem) },
          token,
        );
        if (!editingOemId) setEditingOemId(saved.id);
        if (oemLogoFile) await uploadOemLogo(saved.id, oemLogoFile);
      },
      editingOemId ? "OEM updated." : "OEM created.",
      () => {
        setOem(emptyOem);
        setEditingOemId(null);
        setShowOemForm(false);
        setOemLogoFile(null);
        setOemLogoPreview("");
      },
    );
  }
  async function selectOemLogo(file: File) {
    const allowedTypes = ["image/jpeg", "image/png", "image/webp"];
    if (!allowedTypes.includes(file.type)) {
      setError("Choose a PNG, JPEG, or WebP logo.");
      return;
    }
    if (file.size > 1024 * 1024) {
      setError("OEM logo must be 1 MB or smaller.");
      return;
    }
    const objectUrl = URL.createObjectURL(file);
    try {
      const dimensions = await new Promise<{ width: number; height: number }>(
        (resolve, reject) => {
          const image = new Image();
          image.onload = () =>
            resolve({ width: image.width, height: image.height });
          image.onerror = () =>
            reject(new Error("The selected logo could not be read."));
          image.src = objectUrl;
        },
      );
      if (dimensions.width > 200 || dimensions.height > 200) {
        throw new Error("OEM logo must be no larger than 200 × 200 pixels.");
      }
      setError("");
      setOemLogoFile(file);
      setOemLogoPreview(objectUrl);
    } catch (cause) {
      URL.revokeObjectURL(objectUrl);
      setError(cause instanceof Error ? cause.message : "Invalid OEM logo.");
    }
  }
  async function submitVehicleCategory(event: FormEvent) {
    event.preventDefault();
    await submit(
      () =>
        request(
          editingVehicleCategoryId
            ? `/platform/vehicle-categories/${editingVehicleCategoryId}`
            : "/platform/vehicle-categories",
          {
            method: editingVehicleCategoryId ? "PUT" : "POST",
            body: JSON.stringify({
              ...vehicleCategory,
              displayOrder: Number(vehicleCategory.displayOrder || 0),
            }),
          },
          token,
        ),
      editingVehicleCategoryId
        ? "Vehicle Category updated."
        : "Vehicle Category created.",
      () => {
        setVehicleCategory(emptyVehicleCategory);
        setEditingVehicleCategoryId(null);
        setShowVehicleCategoryForm(false);
      },
    );
  }
  async function submitVehicleType(event: FormEvent) {
    event.preventDefault();
    await submit(
      () =>
        request(
          editingVehicleTypeId
            ? `/platform/vehicle-types/${editingVehicleTypeId}`
            : "/platform/vehicle-types",
          {
            method: editingVehicleTypeId ? "PUT" : "POST",
            body: JSON.stringify({
              ...vehicleType,
              ...(vehicleType.usageType ? {} : { usageType: undefined }),
            }),
          },
          token,
        ),
      editingVehicleTypeId ? "Vehicle Type updated." : "Vehicle Type created.",
      () => {
        setVehicleType(emptyVehicleType);
        setEditingVehicleTypeId(null);
        setShowVehicleTypeForm(false);
      },
    );
  }
  async function uploadOemLogo(oemId: string, file: File) {
    const intent = await request(
      `/platform/oems/${oemId}/logo-upload-intents`,
      {
        method: "POST",
        body: JSON.stringify({ mimeType: file.type, sizeBytes: file.size }),
      },
      token,
    );
    const upload = await fetch(intent.uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": file.type },
      body: file,
    });
    if (!upload.ok) throw new Error("The OEM logo could not be uploaded.");
    await request(
      `/platform/oems/${oemId}/logo-upload-complete`,
      { method: "POST", body: JSON.stringify({ objectKey: intent.objectKey }) },
      token,
    );
  }
  function downloadOemTemplate() {
    const csv =
      "oem_code,oem_name,display_name,status,website,description\nZELIO,Zelio Auto Private Limited,Zelio,ACTIVE,,\n";
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "evseye-oem-template.csv";
    link.click();
    URL.revokeObjectURL(url);
  }
  function recordBulkImport(
    entity: BulkImportEntity,
    fileName: string,
    totalRows: number,
    result: { created?: number; failedRows?: number; status?: string } = {},
    error?: string,
  ) {
    const passedRows = result.created ?? 0;
    const failedRows = result.failedRows ?? (error ? totalRows : 0);
    const status = error
      ? "FAIL"
      : result.status === "PARTIAL_PASS" || failedRows > 0
        ? "PARTIAL_PASS"
        : "PASS";
    const entry: BulkImportHistoryEntry = {
      id: crypto.randomUUID(),
      entity,
      fileName,
      status,
      totalRows,
      passedRows,
      failedRows,
      createdAt: new Date().toISOString(),
      ...(error ? { error } : {}),
    };
    setBulkImportHistory((current) => {
      const next = [entry, ...current].slice(0, 50);
      localStorage.setItem(BULK_IMPORT_HISTORY_KEY, JSON.stringify(next));
      return next;
    });
  }
  async function uploadOemCsv(file: File) {
    setLoading(true);
    setError("");
    try {
      const text = await file.text();
      const lines = text.split(/\r?\n/).filter((line) => line.trim());
      const headers = lines
        .shift()
        ?.split(",")
        .map((header) => header.trim().toLowerCase());
      const expected = [
        "oem_code",
        "oem_name",
        "display_name",
        "status",
        "website",
        "description",
      ];
      if (
        !headers ||
        expected.some((header, index) => headers[index] !== header)
      )
        throw new Error(
          "Use the OEM template. Header names or their order do not match.",
        );
      const rows = lines.map((line) => {
        const [code, name, displayName, status, website, description] =
          parseCsvLine(line);
        return {
          code,
          name,
          displayName,
          status,
          ...(website ? { website } : {}),
          ...(description ? { description } : {}),
        };
      });
      if (!rows.length) throw new Error("The upload contains no OEM rows.");
      const result = (await request(
        "/platform/oems/bulk",
        { method: "POST", body: JSON.stringify({ rows }) },
        token,
      )) as { created: number };
      setNotice(
        `${result.created} OEM${result.created === 1 ? "" : "s"} imported successfully.`,
      );
      recordBulkImport("oem", file.name, rows.length, result);
      setBulkImportEntity(null);
      await load();
    } catch (cause) {
      const message =
        cause instanceof Error ? cause.message : "Unable to import OEMs.";
      recordBulkImport("oem", file.name, 0, {}, message);
      setError(message);
    } finally {
      setLoading(false);
    }
  }
  function downloadCsvTemplate(filename: string, csv: string) {
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  }
  async function uploadBulkCsv(
    file: File,
    entity: BulkImportEntity,
    expectedHeaders: string[],
    endpoint: string,
    label: string,
    toRow: (cells: string[]) => Item,
    complete: () => void,
  ) {
    setLoading(true);
    setError("");
    try {
      const lines = (await file.text())
        .split(/\r?\n/)
        .filter((line) => line.trim());
      const headers = lines
        .shift()
        ?.split(",")
        .map((header) => header.trim().toLowerCase());
      if (
        !headers ||
        headers.length !== expectedHeaders.length ||
        expectedHeaders.some((header, index) => headers[index] !== header)
      ) {
        throw new Error(
          "Use the downloaded template. Header names or their order do not match.",
        );
      }
      const rows = lines.map((line) => toRow(parseCsvLine(line)));
      if (!rows.length) throw new Error("The upload contains no rows.");
      const result = (await request(
        endpoint,
        { method: "POST", body: JSON.stringify({ rows }) },
        token,
      )) as { created: number };
      setNotice(
        `${result.created} ${label}${result.created === 1 ? "" : "s"} imported successfully.`,
      );
      recordBulkImport(entity, file.name, rows.length, result);
      complete();
      await load();
    } catch (cause) {
      const message =
        cause instanceof Error
          ? cause.message
          : `Unable to import ${label.toLowerCase()}s.`;
      recordBulkImport(entity, file.name, 0, {}, message);
      setError(message);
    } finally {
      setLoading(false);
    }
  }
  function downloadVehicleCategoryTemplate() {
    downloadCsvTemplate(
      "evseye-vehicle-category-template.csv",
      "code,name,description,status,display_order\n2W,Two Wheeler,Two-wheeled vehicles,ACTIVE,10\n",
    );
  }
  async function uploadVehicleCategoryCsv(file: File) {
    await uploadBulkCsv(
      file,
      "vehicle-category",
      ["code", "name", "description", "status", "display_order"],
      "/platform/vehicle-categories/bulk",
      "Vehicle Category",
      ([code, name, description, status, displayOrder]) => ({
        code,
        name,
        description,
        status,
        displayOrder,
      }),
      () => setBulkImportEntity(null),
    );
  }
  function downloadVehicleTypeTemplate() {
    downloadCsvTemplate(
      "evseye-vehicle-type-template.csv",
      "category_code,code,name,sub_category,description,energy_type,usage_type,status\n2W,SCOOTER_ELECTRIC,Electric Scooter,SCOOTER,Electric urban scooter,ELECTRIC,PRIVATE,ACTIVE\n",
    );
  }
  async function uploadVehicleTypeCsv(file: File) {
    await uploadBulkCsv(
      file,
      "vehicle-type",
      [
        "category_code",
        "code",
        "name",
        "sub_category",
        "description",
        "energy_type",
        "usage_type",
        "status",
      ],
      "/platform/vehicle-types/bulk",
      "Vehicle Type",
      ([
        categoryCode,
        code,
        name,
        subCategory,
        description,
        energyType,
        usageType,
        status,
      ]) => ({
        categoryCode,
        code,
        name,
        subCategory,
        description,
        energyType,
        usageType,
        status,
      }),
      () => setBulkImportEntity(null),
    );
  }
  function downloadPackageTemplate() {
    downloadCsvTemplate(
      "evseye-package-template.csv",
      "code,name,setup_fee,currency,max_fleets,max_riders,max_admins,max_fleet_managers,max_hubs,max_team_leaders,max_cluster_managers,max_users,trial_days,display_order,is_custom,is_active,description\nSTARTER,Starter,0,INR,1,100,2,5,2,10,2,15,0,10,false,true,Starter platform package\n",
    );
  }
  async function uploadPackageCsv(file: File) {
    await uploadBulkCsv(
      file,
      "package",
      [
        "code",
        "name",
        "setup_fee",
        "currency",
        "max_fleets",
        "max_riders",
        "max_admins",
        "max_fleet_managers",
        "max_hubs",
        "max_team_leaders",
        "max_cluster_managers",
        "max_users",
        "trial_days",
        "display_order",
        "is_custom",
        "is_active",
        "description",
      ],
      "/platform/packages/bulk",
      "Package",
      ([
        code,
        name,
        setupFee,
        currency,
        maxFleets,
        maxRiders,
        maxAdmins,
        maxFleetManagers,
        maxHubs,
        maxTeamLeaders,
        maxClusterManagers,
        maxUsers,
        trialDays,
        displayOrder,
        isCustom,
        isActive,
        description,
      ]) => ({
        code,
        name,
        setupFee,
        currency,
        maxFleets,
        maxRiders,
        maxAdmins,
        maxFleetManagers,
        maxHubs,
        maxTeamLeaders,
        maxClusterManagers,
        maxUsers,
        trialDays,
        displayOrder,
        isCustom,
        isActive,
        description,
      }),
      () => setBulkImportEntity(null),
    );
  }
  async function submitFeature(event: FormEvent) {
    event.preventDefault();
    let configuration: Record<string, unknown> | undefined;
    try {
      configuration = feature.configuration
        ? JSON.parse(feature.configuration)
        : undefined;
    } catch {
      setError("Feature configuration must be valid JSON.");
      return;
    }
    await submit(
      () =>
        request(
          editingFeatureId
            ? `/platform/features/${editingFeatureId}`
            : "/platform/features",
          {
            method: editingFeatureId ? "PUT" : "POST",
            body: JSON.stringify({
              ...feature,
              ...(configuration ? { configuration } : {}),
              displayOrder: Number(feature.displayOrder),
              isAddOnEligible: feature.isAddOnEligible,
            }),
          },
          token,
        ),
      editingFeatureId ? "Feature updated." : "Feature created.",
      () => {
        setFeature(emptyFeature);
        setEditingFeatureId(null);
        setShowFeatureForm(false);
      },
    );
  }
  async function submitFeatureStep(event: FormEvent) {
    event.preventDefault();
    await submit(
      () => request(
        editingFeatureStepId
          ? `/platform/feature-steps/${editingFeatureStepId}`
          : "/platform/feature-steps",
        {
          method: editingFeatureStepId ? "PUT" : "POST",
          body: JSON.stringify({
            ...featureStep,
            parentId: featureStep.parentId || undefined,
            displayOrder: Number(featureStep.displayOrder || 0),
          }),
        },
        token,
      ),
      editingFeatureStepId ? "Feature Step updated." : "Feature Step created.",
      () => {
        setFeatureStep(emptyFeatureStep);
        setEditingFeatureStepId(null);
        setShowFeatureStepForm(false);
      },
    );
  }
  function downloadFeatureTemplate() {
    const csv =
      "feature_code,feature_name,description,feature_category,feature_type,billing_unit,display_order,is_active\nAADHAAR_KYC,Aadhaar Verification,Verify rider Aadhaar,RIDER_VERIFICATION,USAGE_BASED,VERIFICATION,10,true\n";
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "evseye-feature-template.csv";
    link.click();
    URL.revokeObjectURL(url);
  }
  async function uploadFeatureCsv(file: File) {
    setLoading(true);
    setError("");
    try {
      const lines = (await file.text())
        .split(/\r?\n/)
        .filter((line) => line.trim());
      const headers = lines
        .shift()
        ?.split(",")
        .map((header) => header.trim().toLowerCase());
      const expected = [
        "feature_code",
        "feature_name",
        "description",
        "feature_category",
        "feature_type",
        "billing_unit",
        "display_order",
        "is_active",
      ];
      if (
        !headers ||
        expected.some((header, index) => headers[index] !== header)
      ) {
        throw new Error(
          "Use the Feature template. Header names or their order do not match.",
        );
      }
      const rows = lines.map((line) => {
        const [
          code,
          name,
          description,
          category,
          featureType,
          billingUnit,
          displayOrder,
          isActive,
        ] = parseCsvLine(line);
        return {
          code,
          name,
          ...(description ? { description } : {}),
          category,
          featureType,
          billingUnit,
          displayOrder: Number(displayOrder || 0),
          isActive: (isActive || "true").toLowerCase() === "true",
        };
      });
      if (!rows.length) throw new Error("The upload contains no Feature rows.");
      const result = (await request(
        "/platform/features/bulk",
        { method: "POST", body: JSON.stringify({ rows }) },
        token,
      )) as { created: number };
      setNotice(
        `${result.created} feature${result.created === 1 ? "" : "s"} imported successfully.`,
      );
      recordBulkImport("feature", file.name, rows.length, result);
      setBulkImportEntity(null);
      await load();
    } catch (cause) {
      const message =
        cause instanceof Error ? cause.message : "Unable to import Features.";
      recordBulkImport("feature", file.name, 0, {}, message);
      setError(message);
    } finally {
      setLoading(false);
    }
  }
  async function submitPackage(event: FormEvent) {
    event.preventDefault();
    await submit(
      () =>
        request(
          editingPackageId
            ? `/platform/packages/${editingPackageId}`
            : "/platform/packages",
          {
            method: editingPackageId ? "PUT" : "POST",
            body: JSON.stringify({
              ...pack,
              setupFee: Number(pack.setupFee),
              maxFleets: Number(pack.maxFleets),
              maxRiders: Number(pack.maxRiders),
              maxAdmins: Number(pack.maxAdmins),
              maxFleetManagers: Number(pack.maxFleetManagers),
              maxHubs: Number(pack.maxHubs),
              maxTeamLeaders: Number(pack.maxTeamLeaders),
              maxClusterManagers: Number(pack.maxClusterManagers),
              maxUsers: Number(pack.maxUsers),
              trialDays: Number(pack.trialDays || 0),
              displayOrder: Number(pack.displayOrder || 0),
            }),
          },
          token,
        ),
      editingPackageId ? "Package updated." : "Package created.",
      () => {
        setPack(emptyPackage);
        setEditingPackageId(null);
        setShowPackageForm(false);
      },
    );
  }
  async function submitPricing(event: FormEvent) {
    event.preventDefault();
    let metadata: Record<string, unknown> | undefined;
    try {
      metadata = price.metadata ? JSON.parse(price.metadata) : undefined;
    } catch {
      setError("Metadata must be valid JSON.");
      return;
    }
    await submit(
      () =>
        request(
          editingPricingId
            ? `/platform/feature-pricing/${editingPricingId}`
            : "/platform/feature-pricing",
          {
            method: editingPricingId ? "PUT" : "POST",
            body: JSON.stringify({
              featureId: price.featureId,
              billingUnit: price.billingUnit,
              currency: price.currency,
              salePrice: Number(price.salePrice),
              ...(price.costPrice ? { costPrice: Number(price.costPrice) } : {}),
              effectiveFrom: price.effectiveFrom,
              ...(price.effectiveTo ? {} : { effectiveTo: undefined }),
              ...(metadata ? { metadata } : { metadata: undefined }),
              isActive: price.isActive,
            }),
          },
          token,
        ),
      editingPricingId
        ? "Feature pricing updated."
        : "Feature pricing created.",
      () => {
        setPrice(emptyPricing);
        setEditingPricingId(null);
        setShowPricingForm(false);
      },
    );
  }
  async function submitFeatureAddOn(event: FormEvent) {
    event.preventDefault();
    await submit(
      () =>
        request(
          editingFeatureAddOnId
            ? `/platform/commercial/feature-addons/${editingFeatureAddOnId}`
            : "/platform/commercial/feature-addons",
          {
            method: editingFeatureAddOnId ? "PUT" : "POST",
            body: JSON.stringify({
              code: featureAddOn.code,
              name: featureAddOn.name,
              ...(featureAddOn.description
                ? { description: featureAddOn.description }
                : {}),
              featureId: featureAddOn.featureId,
              quantity: Number(featureAddOn.quantity),
              discount: Number(featureAddOn.discount || 0),
              ...(featureAddOn.validityDays
                ? { validityDays: Number(featureAddOn.validityDays) }
                : {}),
              effectiveFrom: featureAddOn.effectiveFrom,
              ...(featureAddOn.effectiveTo
                ? { effectiveTo: featureAddOn.effectiveTo }
                : {}),
              isActive: featureAddOn.isActive,
            }),
          },
          token,
        ),
      editingFeatureAddOnId
        ? "Feature add-on updated."
        : "Feature add-on created.",
      () => {
        setFeatureAddOn(emptyFeatureAddOn);
        setEditingFeatureAddOnId(null);
        setShowFeatureAddOnForm(false);
      },
    );
  }
  async function uploadClientLogo(clientId: string) {
    if (!clientLogoFile) return;
    const approval = activeClientEdit ? { approvalEmailReference: approvalEmailReference.trim() } : {};
    const intent = await request(`/platform/clients/${clientId}/logo-upload-intents`, {
      method: "POST", body: JSON.stringify({ mimeType: clientLogoFile.type, sizeBytes: clientLogoFile.size, ...approval }),
    }, token);
    const uploaded = await fetch(intent.uploadUrl, { method: "PUT", headers: { "Content-Type": clientLogoFile.type }, body: clientLogoFile });
    if (!uploaded.ok) throw new Error("The client logo could not be uploaded. Please retry.");
    const completed = await request(`/platform/clients/${clientId}/logo-upload-complete`, {
      method: "POST", body: JSON.stringify({ objectKey: intent.objectKey, ...approval }),
    }, token);
    setClient((current) => ({ ...current, logoUrl: completed.logoUrl }));
    setClientLogoFile(null);
  }

  async function submitClient(event: FormEvent) {
    event.preventDefault();
    await submit(
      async () => {
        const numberOrUndefined = (value: unknown) =>
          value === "" || value === undefined ? undefined : Number(value);
        const activeEditApproval = activeClientEdit
          ? { approvalEmailReference: approvalEmailReference.trim() }
          : {};
        if (activeClientEdit && !approvalEmailReference.trim()) {
          throw new Error(
            "Enter the approved email reference before saving an active Client.",
          );
        }
        if (clientStep === 1) {
          if (client.id) {
            await request(
              `/platform/clients/${client.id}/business-details`,
              {
                method: "PATCH",
                body: JSON.stringify({
                  businessFleetName: client.businessFleetName,
                  legalEntityName: client.legalEntityName,
                  businessType: client.businessType,
                  clientType: client.clientType,
                  industry: client.industry || undefined,
                  pan: client.pan,
                  gstin: client.gstin || undefined,
                  cinOrLlpin: client.cinOrLlpin || undefined,
                  website: client.website || undefined,
                  yearEstablished: numberOrUndefined(client.yearEstablished),
                  estimatedFleetSize: Number(client.estimatedFleetSize),
                  estimatedRiderCount: Number(client.estimatedRiderCount),
                  estimatedUserCount: numberOrUndefined(
                    client.estimatedUserCount,
                  ),
                  ...activeEditApproval,
                }),
              },
              token,
            );
            await uploadClientLogo(client.id);
            if (!activeClientEdit) setClientStep(2);
            return;
          }
          const created = await request(
            "/platform/clients/drafts",
            {
              method: "POST",
              body: JSON.stringify({
                businessFleetName: client.businessFleetName,
                companyCode: client.companyCode,
                legalEntityName: client.legalEntityName,
                businessType: client.businessType,
                clientType: client.clientType,
                industry: client.industry || undefined,
                pan: client.pan,
                gstin: client.gstin || undefined,
                cinOrLlpin: client.cinOrLlpin || undefined,
                website: client.website || undefined,
                yearEstablished: numberOrUndefined(client.yearEstablished),
                estimatedFleetSize: Number(client.estimatedFleetSize),
                estimatedRiderCount: Number(client.estimatedRiderCount),
                estimatedUserCount: numberOrUndefined(
                  client.estimatedUserCount,
                ),
              }),
            },
            token,
          );
          setClient((current) => ({ ...current, id: created.id }));
          await uploadClientLogo(created.id);
          setClientStep(2);
          return;
        }
        if (!client.id)
          throw new Error("Create Business Details before continuing.");
        if (clientStep === 2) {
          await request(
            `/platform/clients/${client.id}/contacts-addresses`,
            {
              method: "PATCH",
              // This endpoint has a step-specific DTO. Send only contact and
              // address fields so the API can keep its strict whitelist on.

              body: JSON.stringify({
                primaryContactName: client.primaryContactName,
                primaryDesignation: client.primaryDesignation,
                primaryMobile: client.primaryMobile,
                primaryEmail: client.primaryEmail,
                ...(client.alternateMobile
                  ? { alternateMobile: client.alternateMobile }
                  : {}),
                adminSameAsPrimary: client.adminSameAsPrimary,
                ...(client.adminSameAsPrimary
                  ? {}
                  : {
                      adminName: client.adminName,
                      adminMobile: client.adminMobile,
                      adminEmail: client.adminEmail,
                      ...(client.adminDesignation
                        ? { adminDesignation: client.adminDesignation }
                        : {}),
                    }),

                registeredAddressLine1: client.registeredAddressLine1,
                ...(client.registeredAddressLine2
                  ? { registeredAddressLine2: client.registeredAddressLine2 }
                  : {}),
                ...(client.landmark ? { landmark: client.landmark } : {}),
                city: client.city,
                ...(client.district ? { district: client.district } : {}),
                state: client.state,
                ...(client.country ? { country: client.country } : {}),
                pinCode: client.pinCode,
                billingSameAsRegistered: client.billingSameAsRegistered,
                ...activeEditApproval,
                ...(client.billingSameAsRegistered
                  ? {}
                  : {
                      billingAddressLine1: client.billingAddressLine1,
                      ...(client.billingAddressLine2
                        ? { billingAddressLine2: client.billingAddressLine2 }
                        : {}),
                      ...(client.billingLandmark
                        ? { billingLandmark: client.billingLandmark }
                        : {}),
                      billingCity: client.billingCity,
                      ...(client.billingDistrict
                        ? { billingDistrict: client.billingDistrict }
                        : {}),
                      billingState: client.billingState,
                      ...(client.billingCountry
                        ? { billingCountry: client.billingCountry }
                        : {}),
                      billingPinCode: client.billingPinCode,
                    }),
              }),
            },
            token,
          );
          setClientStep(3);
          return;
        }
        if (clientStep === 3) {
          await request(
            `/platform/clients/${client.id}/fleet-operations`,
            {
              method: "PATCH",
              body: JSON.stringify({
                fleetBusinessModel: client.fleetBusinessModel,
                numberOfFleets: Number(client.numberOfFleets),
                approximateRiderCount: Number(client.approximateRiderCount),
                vehicleOwnership: client.vehicleOwnership,
                vehicleCategoryIds: client.vehicleCategoryIds,
                operationalHubCount: numberOrUndefined(
                  client.operationalHubCount,
                ),
                ...activeEditApproval,
              }),
            },
            token,
          );
          setClientStep(4);
          return;
        }
        if (clientStep === 4) {
          await request(
            `/platform/clients/${client.id}/package-selection`,
            {
              method: "PATCH",
              body: JSON.stringify({
                packageId: client.packageId,
                billingCycle: client.billingCycle,
                startDate: client.startDate,
                endDate: client.endDate || undefined,
                trialRequired: client.trialRequired,
                autoRenew: client.autoRenew,
                ...activeEditApproval,
              }),
            },
            token,
          );
          setClientStep(5);
          return;
        }
        if (clientStep === 5) {
          await request(
            `/platform/clients/${client.id}/billing`,
            {
              method: "PATCH",
              body: JSON.stringify({
                billingContactName: client.billingContactName,
                billingEmail: client.billingEmail,
                billingMobile: client.billingMobile || undefined,
                purchaseOrderRequired: client.purchaseOrderRequired,
                poNumber: client.poNumber || undefined,
                paymentTerms: client.paymentTerms || undefined,
                ...activeEditApproval,
              }),
            },
            token,
          );
          for (const [documentType, file] of Object.entries(
            clientDocumentFiles,
          )) {
            if (!file) continue;
            const intent = await request(
              `/platform/clients/${client.id}/documents/upload-intents`,
              {
                method: "POST",
                body: JSON.stringify({
                  documentType,
                  fileName: file.name,
                  mimeType: file.type,
                  sizeBytes: file.size,
                  ...activeEditApproval,
                }),
              },
              token,
            );
            const upload = await fetch(intent.uploadUrl, {
              method: "PUT",
              headers: { "Content-Type": file.type },
              body: file,
            });
            if (!upload.ok)
              throw new Error(`Unable to upload ${documentType}.`);
            await request(
              `/platform/clients/${client.id}/documents/${intent.document.id}/complete`,
              { method: "POST" },
              token,
            );
          }
          setClientStep(6);
          return;
        }
        if (activeClientEdit) return;
        await request(
          `/platform/clients/${client.id}/agreement`,
          {
            method: "PATCH",
            body: JSON.stringify({
              authorizedSignatoryName: client.authorizedSignatoryName,
              designation: client.signatoryDesignation,
              termsAccepted: client.termsAccepted,
              privacyAccepted: client.privacyAccepted,
              dataProcessingConsent: client.dataProcessingConsent,
              kycConsent: client.kycConsent,
              marketingConsent: client.marketingConsent,
            }),
          },
          token,
        );
        return request(
          `/platform/clients/${client.id}/submit`,
          { method: "POST" },
          token,
        );
      },
      clientStep === 6
        ? activeClientEdit
          ? "Approved Client changes saved."
          : "Client workspace created. The Client Admin can now sign in."
        : "Draft saved.",
      () => {
        if (clientStep === 6) {
          setClient(emptyClient);
          setClientDocumentFiles({});
          setClientStep(1);
          setActiveClientEdit(false);
          setApprovalEmailReference("");
          setShowClientForm(false);
        }
      },
    );
  }
  async function remove(path: string, label: string) {
    setDeleteConfirmation({
      title: `Delete ${label}?`,
      description: `This permanently removes this ${label}. This action cannot be undone.`,
      confirmLabel: `Delete ${label}`,
      onConfirm: async () => {
        await submit(
          () => request(path, { method: "DELETE" }, token),
          `${label} deleted.`,
        );
      },
    });
  }
  async function approveClient(clientId: string) {
    await submit(
      () =>
        request(
          `/platform/clients/${clientId}/approve`,
          { method: "POST" },
          token,
        ),
      "Client approved and activated.",
    );
  }
  async function rejectClient(clientId: string) {
    const reason = window.prompt("Enter the reason for rejecting this Client.");
    if (reason === null) return;
    if (!reason.trim()) {
      setError("A rejection reason is required.");
      return;
    }
    await submit(
      () =>
        request(
          `/platform/clients/${clientId}/reject`,
          { method: "POST", body: JSON.stringify({ reason: reason.trim() }) },
          token,
        ),
      "Client rejected. The Client Admin will see the correction message.",
    );
  }
  async function submit(
    operation: () => Promise<unknown>,
    success: string,
    done?: () => void,
  ) {
    setLoading(true);
    setError("");
    try {
      const result = await operation() as { welcomeEmail?: { message: string } } | undefined;
      done?.();
      setNotice([success, result?.welcomeEmail?.message].filter(Boolean).join(" "));
      await load();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Unable to save changes.",
      );
    } finally {
      setLoading(false);
    }
  }
  function changeClient(key: string, value: unknown) {
    const normalizedValue =
      typeof value === "string" && (key === "pan" || key === "gstin")
        ? value.toUpperCase()
        : value;
    setClient((current) => ({ ...current, [key]: normalizedValue }));
  }
  async function editClientDraft(
    clientId: string,
    trigger?: HTMLButtonElement,
  ) {
    if (trigger) clientTriggerRef.current = trigger;
    await submit(async () => {
      const detail = (await request(
        `/platform/clients/${clientId}`,
        {},
        token,
      )) as Item;
      const profile = (detail.businessProfile ?? {}) as Item;
      const contacts = (detail.contacts ?? []) as Item[];
      const addresses = (detail.addresses ?? []) as Item[];
      const primary = contacts.find((item) => item.role === "PRIMARY") ?? {};
      const admin =
        contacts.find((item) => item.role === "ACCOUNT_ADMIN") ?? {};
      const registered =
        addresses.find((item) => item.type === "REGISTERED") ?? {};
      const billing = addresses.find((item) => item.type === "BILLING") ?? {};
      const operations = (detail.operationsProfile ?? {}) as Item;
      const subscription = ((detail.subscriptions ?? []) as Item[])[0] ?? {};
      const billingProfile = (detail.billingProfile ?? {}) as Item;
      const agreement = (detail.agreement ?? {}) as Item;
      const sameAdmin =
        !admin.id ||
        (admin.name === primary.name &&
          admin.mobile === primary.mobile &&
          admin.email === primary.email);
      const sameBilling =
        !billing.id ||
        (billing.line1 === registered.line1 &&
          billing.city === registered.city &&
          billing.state === registered.state &&
          billing.pinCode === registered.pinCode);
      const dateValue = (value: unknown) =>
        value ? String(value).slice(0, 10) : "";

      setClient((current) => ({
        ...current,
        id: detail.id,
        logoUrl: detail.logoUrl ?? "",
        businessFleetName: detail.name ?? "",
        companyCode: detail.companyCode ?? detail.slug ?? "",
        legalEntityName: profile.legalCompanyName ?? "",
        clientType: profile.clientType ?? "",
        businessType: profile.businessType ?? "",
        industry: profile.industry ?? "",
        gstin: profile.gstin ?? "",
        pan: profile.pan ?? "",
        cinOrLlpin: profile.cinOrLlpin ?? "",
        website: profile.website ?? "",
        yearEstablished: profile.yearEstablished ?? "",
        estimatedFleetSize: profile.estimatedFleetSize ?? "",
        estimatedRiderCount: profile.estimatedRiderCount ?? "",
        estimatedUserCount: profile.estimatedUserCount ?? "",
        primaryContactName: primary.name ?? "",
        primaryDesignation: primary.designation ?? "",
        primaryMobile: primary.mobile ?? "",
        primaryEmail: primary.email ?? "",
        alternateMobile: primary.alternateMobile ?? "",
        adminSameAsPrimary: sameAdmin,
        adminName: sameAdmin ? "" : (admin.name ?? ""),
        adminDesignation: sameAdmin ? "" : (admin.designation ?? ""),
        adminMobile: sameAdmin ? "" : (admin.mobile ?? ""),
        adminEmail: sameAdmin ? "" : (admin.email ?? ""),
        registeredAddressLine1: registered.line1 ?? "",
        registeredAddressLine2: registered.line2 ?? "",
        landmark: registered.landmark ?? "",
        city: registered.city ?? "",
        district: registered.district ?? "",
        state: registered.state ?? "",
        country: registered.country ?? "India",
        pinCode: registered.pinCode ?? "",
        billingSameAsRegistered: sameBilling,
        billingAddressLine1: sameBilling ? "" : (billing.line1 ?? ""),
        billingAddressLine2: sameBilling ? "" : (billing.line2 ?? ""),
        billingLandmark: sameBilling ? "" : (billing.landmark ?? ""),
        billingCity: sameBilling ? "" : (billing.city ?? ""),
        billingDistrict: sameBilling ? "" : (billing.district ?? ""),
        billingState: sameBilling ? "" : (billing.state ?? ""),
        billingCountry: sameBilling ? "India" : (billing.country ?? "India"),
        billingPinCode: sameBilling ? "" : (billing.pinCode ?? ""),
        fleetBusinessModel: operations.fleetBusinessModel ?? "",
        numberOfFleets: operations.numberOfFleets ?? "",
        approximateRiderCount: operations.approximateRiderCount ?? "",
        vehicleOwnership: operations.vehicleOwnership ?? "",
        vehicleCategoryIds: (operations.vehicleCategories ?? []).map(
          (item: Item) => item.vehicleCategoryId,
        ),
        operationalHubCount: operations.operationalHubCount ?? "",
        packageId: subscription.packageId ?? "",
        billingCycle: subscription.billingCycle ?? "",
        startDate: dateValue(subscription.startDate) || current.startDate,
        endDate: dateValue(subscription.endDate),
        autoRenew: subscription.autoRenew ?? true,
        billingContactName: billingProfile.billingContactName ?? "",
        billingEmail: billingProfile.billingEmail ?? "",
        billingMobile: billingProfile.billingMobile ?? "",
        purchaseOrderRequired: billingProfile.purchaseOrderRequired ?? false,
        poNumber: billingProfile.poNumber ?? "",
        paymentTerms: billingProfile.paymentTerms ?? "",
        authorizedSignatoryName: agreement.authorizedSignatoryName ?? "",
        signatoryDesignation: agreement.designation ?? "",
        termsAccepted: Boolean(agreement.termsAcceptedAt),
        privacyAccepted: Boolean(agreement.privacyAcceptedAt),
        dataProcessingConsent: Boolean(agreement.dataProcessingConsentAt),
        kycConsent: Boolean(agreement.kycConsentAt),
        marketingConsent: Boolean(agreement.marketingConsentAt),
        uploadedDocuments: detail.documents ?? [],
      }));
      setClientDocumentFiles({});
      const isActiveClient = detail.status === "ACTIVE";
      setClientLogoFile(null);
      setActiveClientEdit(isActiveClient);
      setApprovalEmailReference("");
      setShowClientForm(true);
      setClientStep(
        isActiveClient
          ? 1
          : !primary.id || !registered.id
          ? 2
          : !operations.id
            ? 3
            : !subscription.id
              ? 4
              : !billingProfile.id
                ? 5
                : 6,
      );
    }, "Client loaded.");
  }
  if (!token)
    return (
      <main className="platform-login">
        <section className="platform-login-card">
          <p className="eyebrow">EVS EYE · PLATFORM CONTROL</p>
          <h1>Session expired</h1>
          <p className="muted">Sign in again to access Super Admin.</p>
          <Link className="platform-back-link" href="/platform">
            Super Admin sign in
          </Link>
        </section>
      </main>
    );
  const navGroups: Array<{
    label?: string;
    items: Array<[Tab, string, IconName]>;
  }> = [
    { items: [["dashboard", "Dashboard", "dashboard"]] },
    {
      label: "Vehicle Management",
      items: [
        ["vehicleCategories", "Vehicle Category", "category"],
        ["vehicleTypes", "Vehicle Type", "vehicle"],
        ["oems", "OEM", "factory"],
      ],
    },
    {
      label: "Feature Management",
      items: [
        ["featureSteps", "Feature Step", "category"],
        ["features", "Feature", "feature"],
        ["pricing", "Pricing", "pricing"],
      ],
    },
    {
      label: "Package Management",
      items: [
        ["packages", "Package", "package"],
        ["packageFeatures", "Package Feature", "packageFeature"],
        ["packageTierPricing", "Package Tier Pricing", "pricing"],
      ],
    },
    {
      label: "Client Management",
      items: [
        ["clients", "Client", "users"],
      ],
    },
    {
      label: "Client Commercials",
      items: [
        ["clientPricingAdjustments", "Pricing Adjustments", "pricing"],
        ["clientAddOnPurchases", "Features & Pricing", "feature"],
        ["clientCreditLots", "Feature Credit Lots", "packageFeature"],
        ["clientUsageLedger", "Feature Usage Ledger", "dashboard"],
      ],
    },
  ];
  const pageSubtitles: Partial<Record<Tab, string>> = {
    oems: "Create and manage manufacturers visible across the platform.",
    vehicleCategories:
      "Define platform-wide vehicle classifications used in fleet onboarding and reporting.",
    vehicleTypes:
      "Define vehicle types by category, energy source, and usage.",
    features: "Manage the platform feature catalog and entitlement definitions.",
    featureSteps: "Organize the onboarding journey and align each Feature to its primary step.",
    pricing: "Configure catalog pricing for billable platform features.",
    packages: "Create packages and define the commercial limits available to clients.",
    packageFeatures: "Choose the features included with each platform package.",
    packageTierPricing: "Set the per-vehicle recurring price for each fleet-size range.",
    clients: "Manage onboarding drafts, approvals, subscriptions, and documents.",
    clientPricingAdjustments: "Apply negotiated commercial terms without changing master pricing.",
    clientAddOnPurchases: "Assign eligible catalog Features and client-specific pricing without changing package masters.",
    clientCreditLots: "Review active and expired client feature credits by source and expiry.",
    clientUsageLedger: "Review the immutable client feature credit and consumption history.",
  };
  const featureAddOnEffectiveDate = featureAddOn.effectiveFrom
    ? new Date(featureAddOn.effectiveFrom)
    : null;
  const featureAddOnUnitPrice = featureAddOnEffectiveDate
    ? pricing
        .filter(
          (item) =>
            item.featureId === featureAddOn.featureId &&
            item.isActive &&
            new Date(item.effectiveFrom) <= featureAddOnEffectiveDate &&
            (!item.effectiveTo ||
              new Date(item.effectiveTo) >= featureAddOnEffectiveDate),
        )
        .sort(
          (left, right) =>
            new Date(right.effectiveFrom).getTime() -
            new Date(left.effectiveFrom).getTime(),
        )[0]
    : undefined;
  const featureAddOnQuantity = Number(featureAddOn.quantity) || 0;
  const featureAddOnDiscount = Number(featureAddOn.discount) || 0;
  const featureAddOnBaseCost = featureAddOnUnitPrice?.costPrice === null ||
    featureAddOnUnitPrice?.costPrice === undefined
      ? null
      : Number(featureAddOnUnitPrice.costPrice) * featureAddOnQuantity;
  const featureAddOnBaseSale = featureAddOnUnitPrice
    ? Number(featureAddOnUnitPrice.salePrice) * featureAddOnQuantity
    : null;
  const featureAddOnSaleAfterDiscount = featureAddOnBaseSale === null
    ? null
    : featureAddOnBaseSale * (1 - featureAddOnDiscount / 100);
  const catalogDialogOpen =
    showOemForm ||
    showVehicleCategoryForm ||
    showVehicleTypeForm ||
    showFeatureStepForm ||
    showFeatureForm ||
    showPackageForm ||
    showPricingForm ||
    showFeatureAddOnForm ||
    showClientForm;
  const nav = navGroups.flatMap((group) => group.items);
  const bulkImportConfig = bulkImportEntity
    ? {
        oem: {
          title: "OEM",
          requiredColumns: "oem_code, oem_name, display_name, status",
          downloadTemplate: downloadOemTemplate,
          upload: uploadOemCsv,
        },
        "vehicle-category": {
          title: "Vehicle Category",
          requiredColumns: "code, name, status",
          downloadTemplate: downloadVehicleCategoryTemplate,
          upload: uploadVehicleCategoryCsv,
        },
        "vehicle-type": {
          title: "Vehicle Type",
          requiredColumns: "category_code, code, name, energy_type, status",
          downloadTemplate: downloadVehicleTypeTemplate,
          upload: uploadVehicleTypeCsv,
        },
        feature: {
          title: "Feature",
          requiredColumns:
            "feature_code, feature_name, feature_category, feature_type, billing_unit",
          downloadTemplate: downloadFeatureTemplate,
          upload: uploadFeatureCsv,
        },
        package: {
          title: "Package",
          requiredColumns: "code, name, currency, is_custom, is_active",
          downloadTemplate: downloadPackageTemplate,
          upload: uploadPackageCsv,
        },
      }[bulkImportEntity]
    : null;

  return (
    <main className="sa-shell">
      <aside className="sa-sidebar">
        <div className="sa-brand">
          <span><UiIcon name="eye" /></span>
          <div>
            <strong>Evs Eye</strong>
            <small>PRO</small>
          </div>
        </div>
        <nav>
          {navGroups.map((group, groupIndex) => (
            <div className="sa-nav-group" key={group.label ?? "root"}>
              {group.label ? (
                <button
                  type="button"
                  className="sa-nav-group-toggle"
                  aria-expanded={expandedNavGroups[group.label] ?? false}
                  onClick={() =>
                    setExpandedNavGroups((current) => ({
                      ...current,
                      [group.label!]: !(current[group.label!] ?? false),
                    }))
                  }
                >
                  <span>{t(group.label)}</span>
                  <UiIcon
                    name="chevron"
                    className={(expandedNavGroups[group.label] ?? false) ? "" : "is-collapsed"}
                  />
                </button>
              ) : null}
              {(!group.label || (expandedNavGroups[group.label] ?? false)) &&
                group.items.map(([key, label, icon]) => (
                <button
                  key={key}
                  className={`${tab === key ? "active" : ""} ${groupIndex ? "sa-nav-child" : ""}`}
                  onClick={() => {
                    setTab(key);
                    if (key === "dashboard") setExpandedNavGroups({});
                    setBulkImportEntity(null);
                    setShowClientForm(false);
                    setNotice("");
                  }}
                >
                  <UiIcon name={icon} />
                  {t(label)}
                </button>
              ))}
            </div>
          ))}
        </nav>
        <div className="sa-user">
          <span>S</span>
          <div>
            <strong>{t("Super Admin")}</strong>
            <small>admin@evseye.io</small>
          </div>
        </div>
      </aside>
      <section className="sa-main">
        <header className="sa-topbar">
          <div>
            <h1>
              {tab === "dashboard"
                ? t("Super Admin Dashboard")
                : t(nav.find(([key]) => key === tab)?.[1] ?? "")}
            </h1>
            <p>
              {tab === "dashboard"
                ? t("Complete platform overview · Updated just now")
                : t(pageSubtitles[tab] ??
                  "Platform-owned catalog and commercial controls")}
            </p>
          </div>
          <div className="header-actions">
            <LanguageSwitcher />
            <button className="secondary" onClick={() => void load()}>
              ↻ {t("Refresh")}
            </button>
            <button
              onClick={async () => {
                await fetch("/api/v1/auth/logout", { method: "POST" }).catch(() => undefined);
                sessionStorage.removeItem(ACCESS_TOKEN_KEY);
                sessionStorage.removeItem(REFRESH_TOKEN_KEY);
                setToken("");
              }}
            >
              {t("Sign out")}
            </button>
          </div>
        </header>
        {notice && <p className="notice">{notice}</p>}
        {error && !catalogDialogOpen && <p className="error">{error}</p>}
        {bulkImportEntity && bulkImportConfig ? (
          <BulkImportWorkspace
            entity={bulkImportEntity}
            title={bulkImportConfig.title}
            requiredColumns={bulkImportConfig.requiredColumns}
            history={bulkImportHistory.filter(
              (entry) => entry.entity === bulkImportEntity,
            )}
            busy={loading}
            onBack={() => {
              setBulkImportEntity(null);
              setError("");
            }}
            onDownloadTemplate={bulkImportConfig.downloadTemplate}
            onUpload={(file) => void bulkImportConfig.upload(file)}
          />
        ) : (
          <>
        {tab === "dashboard" && (
          <DashboardView
            summary={summary}
            clients={clients}
            oems={oems}
            setTab={setTab}
          />
        )}
        {tab === "clients" && (
          <ClientsView
            clients={clients}
            packages={packages}
            vehicleCategories={vehicleCategories}
            showForm={showClientForm}
            setShowForm={setShowClientForm}
            client={client}
            change={changeClient}
            step={clientStep}
            setStep={setClientStep}
            submit={submitClient}
            error={error}
            loading={loading}
            triggerRef={clientTriggerRef}
            openDialog={openClientModal}
            closeDialog={closeClientModal}
            documentFiles={clientDocumentFiles}
            setDocumentFiles={setClientDocumentFiles}
            logoFile={clientLogoFile}
            setLogoFile={setClientLogoFile}
            approveClient={approveClient}
            rejectClient={rejectClient}
            editClient={editClientDraft}
            activeClientEdit={activeClientEdit}
            approvalEmailReference={approvalEmailReference}
            setApprovalEmailReference={setApprovalEmailReference}
          />
        )}
        {tab === "clientPricingAdjustments" && (
          <ClientCommercialDirectory clients={clients} section="pricing" />
        )}
        {tab === "clientAddOnPurchases" && (
          <ClientCommercialDirectory clients={clients} section="addOns" />
        )}
        {tab === "clientCreditLots" && (
          <ClientCommercialDirectory clients={clients} section="creditLots" />
        )}
        {tab === "clientUsageLedger" && (
          <ClientCommercialDirectory clients={clients} section="ledger" />
        )}
        {tab === "oems" && (
          <>
            <section className="sa-page-head">
              <div>
                <h2>OEM</h2>
                <p>
                  Create and manage manufacturers visible across the platform.
                </p>
              </div>
              <div className="sa-actions">
                <button
                  className="secondary"
                  onClick={() => {
                    setBulkImportEntity("oem");
                    setShowOemForm(false);
                  }}
                >
                  Bulk upload
                </button>
                <button
                  onClick={(event) => openOemModal(event.currentTarget)}
                >
                  + Add OEM
                </button>
              </div>
            </section>
            <CatalogFormDialog
              open={showOemForm}
              title={editingOemId ? "Edit OEM" : "Add OEM"}
              description="Enter the manufacturer details shown across the platform."
              error={error}
              busy={loading}
              triggerRef={oemTriggerRef}
              onClose={closeOemModal}
              onDialogClose={() => setShowOemForm(false)}
              onSubmit={submitOem}
              actions={
                <>
                  <button
                    type="button"
                    className="secondary"
                    onClick={closeOemModal}
                    disabled={loading}
                  >
                    Cancel
                  </button>
                  <button type="submit" disabled={loading}>

                    {editingOemId ? "Update OEM" : "Save OEM"}
                  </button>
                </>
              }
            >
              <TextFields
                value={oem}
                change={(key, value) =>
                  setOem((current) => ({ ...current, [key]: value }))
                }
                fields={[
                  ["code", "OEM code"],
                  ["name", "Legal name"],
                  ["displayName", "Display name"],
                  ["website", "Website"],
                  ["description", "Description"],
                ]}
              />
              <Select
                label="Status"
                value={oem.status}
                change={(value) =>
                  setOem((current) => ({ ...current, status: value }))
                }
                options={masterRecordStatuses}
              />
              <label className="sa-logo-input">
                OEM logo{" "}
                <span>
                  PNG, JPEG, or WebP · max 1 MB · max 200 × 200 px
                </span>
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) void selectOemLogo(file);
                    event.currentTarget.value = "";
                  }}
                />
              </label>
              {oemLogoPreview && (
                <img
                  className="sa-logo-preview"
                  src={oemLogoPreview}
                  alt="OEM logo preview"
                />
              )}
            </CatalogFormDialog>
            <section className="sa-management oem-table-only">
              {oems.length ? (
                <DataTable
                  headings={[
                    "Logo",
                    "Code",
                    "OEM",
                    "Legal Name",
                    "Description",
                    "Status",
                    "",
                    "",
                  ]}
                  columnFilters={[
                    null,
                    { type: "text" },
                    { type: "text" },
                    { type: "text" },
                    { type: "text" },
                    {
                      type: "select",
                      options: masterRecordStatuses,
                    },
                    null,
                    null,
                  ]}
                  rows={oems.map((item) => [
                    item.logoUrl ? (
                      <img
                        key="logo"
                        className="sa-table-logo"
                        src={item.logoUrl}
                        alt={`${item.displayName ?? item.name} logo`}
                      />
                    ) : (
                      "—"
                    ),
                    item.code,
                    item.displayName,
                    item.name,
                    item.description ?? "—",
                    item.status,
                    <button
                      key="edit"
                      className="secondary"
                      onClick={(event) =>
                        openOemModal(event.currentTarget, item)
                      }
                    >
                      Edit
                    </button>,
                    <button
                      key="delete"
                      className="danger"
                      onClick={() =>
                        void remove(`/platform/oems/${item.id}`, "OEM")
                      }
                    >
                      Delete
                    </button>,
                  ])}
                />
              ) : (
                <section className="sa-empty-catalog">
                  <h3>No OEMs yet</h3>
                  <p>
                    Start by adding an OEM individually or importing a completed
                    template.
                  </p>
                  <div>
                    <button
                      onClick={(event) => openOemModal(event.currentTarget)}
                    >
                      Add OEM
                    </button>
                    <button
                      className="secondary"
                      onClick={() => setBulkImportEntity("oem")}
                    >
                      Bulk upload
                    </button>
                  </div>
                </section>
              )}
            </section>
          </>
        )}
        {tab === "vehicleCategories" && (
          <>
            <section className="sa-page-head">
              <div>
                <h2>Vehicle Category</h2>
                <p>
                  Define platform-wide vehicle classifications used in fleet
                  onboarding and reporting.
                </p>
              </div>
              <div className="sa-actions">
                <button
                  className="secondary"
                  onClick={() => {
                    setBulkImportEntity("vehicle-category");
                    setShowVehicleCategoryForm(false);
                  }}
                >
                  Bulk upload
                </button>
                <button
                  onClick={(event) =>
                    openVehicleCategoryModal(event.currentTarget, undefined, true)
                  }
                >
                  + Add Vehicle Category
                </button>
              </div>
            </section>
            <section className="sa-management oem-table-only">
              <CatalogFormDialog
                open={showVehicleCategoryForm}
                title={
                  editingVehicleCategoryId
                    ? "Edit Vehicle Category"
                    : "Add Vehicle Category"
                }
                description="Define a platform-wide vehicle classification used in fleet onboarding and reporting."
                error={error}
                busy={loading}
                triggerRef={vehicleCategoryTriggerRef}
                onClose={closeVehicleCategoryModal}
                onDialogClose={() => setShowVehicleCategoryForm(false)}
                onSubmit={submitVehicleCategory}
                actions={
                  <>
                    <button
                      type="button"
                      className="secondary"
                      onClick={closeVehicleCategoryModal}
                      disabled={loading}
                    >
                      Cancel
                    </button>
                    <button type="submit" disabled={loading}>
                      {editingVehicleCategoryId
                        ? "Update Vehicle Category"
                        : "Save Vehicle Category"}
                    </button>
                  </>
                }
              >
                <TextFields
                  value={vehicleCategory}
                  change={(key, value) =>
                    setVehicleCategory((current) => ({
                      ...current,
                      [key]: value,
                    }))
                  }
                  fields={[
                    ["code", "Category code"],
                    ["name", "Category name"],
                    ["description", "Description"],
                    ["displayOrder", "Display order"],
                  ]}
                />
                <Select
                  label="Status"
                  value={vehicleCategory.status}
                  change={(value) =>
                    setVehicleCategory((current) => ({
                      ...current,
                      status: value,
                    }))
                  }
                  options={masterRecordStatuses}
                />
              </CatalogFormDialog>
              {vehicleCategories.length ? (
                <DataTable
                  headings={[
                    "Code",
                    "Category",
                    "Description",
                    "Status",
                    "",
                    "",
                  ]}
                  columnFilters={[
                    { type: "text" },
                    { type: "text" },
                    { type: "text" },
                    {
                      type: "select",
                      options: masterRecordStatuses,
                    },
                    null,
                    null,
                  ]}
                  rows={vehicleCategories.map((item) => [
                    item.code,
                    item.name,
                    item.description ?? "—",
                    item.status,
                    <button
                      key="edit"
                      className="secondary"
                      onClick={(event) =>
                        openVehicleCategoryModal(event.currentTarget, item)
                      }
                    >
                      Edit
                    </button>,
                    <button
                      key="delete"
                      className="danger"
                      onClick={() =>
                        void remove(
                          `/platform/vehicle-categories/${item.id}`,
                          "Vehicle Category",
                        )
                      }
                    >
                      Delete
                    </button>,
                  ])}
                />
              ) : (
                <section className="sa-empty-catalog">
                  <h3>No Vehicle Categories yet</h3>
                  <p>Create your first platform-wide vehicle classification.</p>
                  <button
                    onClick={(event) =>
                      openVehicleCategoryModal(event.currentTarget)
                    }
                  >
                    Add Vehicle Category
                  </button>
                </section>
              )}
            </section>
          </>
        )}
        {tab === "vehicleTypes" && (
          <>
            <section className="sa-page-head">
              <div>
                <h2>Vehicle Type</h2>
                <p>
                  Define vehicle types by category, energy source, and usage.
                </p>
              </div>
              <div className="sa-actions">
                <button
                  className="secondary"
                  onClick={() => {
                    setBulkImportEntity("vehicle-type");
                    setShowVehicleTypeForm(false);
                  }}
                >
                  Bulk upload
                </button>
                <button
                  onClick={(event) =>
                    openVehicleTypeModal(event.currentTarget, undefined, true)
                  }
                >
                  + Add Vehicle Type
                </button>
              </div>
            </section>
            <section className="sa-management oem-table-only">
              <CatalogFormDialog
                open={showVehicleTypeForm}
                title={
                  editingVehicleTypeId
                    ? "Edit Vehicle Type"
                    : "Add Vehicle Type"
                }
                description="Define a vehicle type by category, energy source, and usage."
                error={error}
                busy={loading}
                triggerRef={vehicleTypeTriggerRef}
                onClose={closeVehicleTypeModal}
                onDialogClose={() => setShowVehicleTypeForm(false)}
                onSubmit={submitVehicleType}
                actions={
                  <>
                    <button
                      type="button"
                      className="secondary"
                      onClick={closeVehicleTypeModal}
                      disabled={loading}

                    >
                      Cancel
                    </button>
                    <button type="submit" disabled={loading}>
                      {editingVehicleTypeId
                        ? "Update Vehicle Type"
                        : "Save Vehicle Type"}
                    </button>
                  </>
                }
              >
                <label>
                  <span className="sa-label-text">
                    Vehicle Category <span className="sa-required-star">*</span>
                  </span>
                  <select
                    required
                    value={vehicleType.categoryId}
                    onChange={(event) =>
                      setVehicleType((current) => ({
                        ...current,
                        categoryId: event.target.value,
                      }))
                    }
                  >
                    <option value="">Select vehicle category</option>
                    {vehicleCategories
                      .filter((item) => item.status === "ACTIVE")
                      .map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.code} · {item.name}

                        </option>
                      ))}
                  </select>
                </label>
                <TextFields
                  value={vehicleType}
                  change={(key, value) =>
                    setVehicleType((current) => ({
                      ...current,
                      [key]: value,
                    }))
                  }
                  fields={[
                    ["code", "Type code"],
                    ["name", "Type name"],
                    ["subCategory", "Sub-category"],
                    ["description", "Description"],
                  ]}
                />
                <Select
                  label="Energy type"
                  value={vehicleType.energyType}
                  change={(value) =>
                    setVehicleType((current) => ({
                      ...current,
                      energyType: value,
                    }))
                  }
                  options={energyTypes}
                />
                <label>
                  Usage type
                  <select
                    value={vehicleType.usageType}
                    onChange={(event) =>
                      setVehicleType((current) => ({
                        ...current,
                        usageType: event.target.value,
                      }))
                    }
                  >
                    <option value="">Not specified</option>
                    {vehicleUsageTypes.map((option) => (
                      <option key={option}>{option}</option>
                    ))}
                  </select>
                </label>
                <Select
                  label="Status"
                  value={vehicleType.status}
                  change={(value) =>
                    setVehicleType((current) => ({
                      ...current,
                      status: value,
                    }))
                  }
                  options={masterRecordStatuses}
                />
              </CatalogFormDialog>
              <DataTable
                headings={[
                  "Code",
                  "Vehicle Type",
                  "Sub-category",
                  "Category",
                  "Description",
                  "Energy",
                  "Usage",
                  "Status",
                  "",
                  "",
                ]}
                columnFilters={[
                  { type: "text" },
                  { type: "text" },
                  { type: "text" },
                  { type: "text" },
                  { type: "text" },
                  { type: "select" },
                  { type: "select" },
                  { type: "select" },
                  null,
                  null,
                ]}
                rows={vehicleTypes.map((item) => [
                  item.code,
                  item.name,
                  item.subCategory ?? "—",
                  item.category?.name,
                  item.description ?? "—",
                  item.energyType,
                  item.usageType ?? "—",
                  item.status,
                  <button
                    key="edit"
                    className="secondary"
                    onClick={(event) =>
                      openVehicleTypeModal(event.currentTarget, item)
                    }
                  >
                    Edit
                  </button>,
                  <button
                    key="delete"
                    className="danger"
                    onClick={() =>
                      void remove(
                        `/platform/vehicle-types/${item.id}`,
                        "Vehicle Type",
                      )
                    }
                  >
                    Delete
                  </button>,
                ])}
              />
            </section>
          </>
        )}
        {tab === "featureSteps" && (
          <>
            <section className="sa-page-head">
              <div>
                <h2>Feature Step</h2>
                <p>Define the onboarding journey and assign Features to its steps.</p>
              </div>
              <div className="sa-actions">
                <button onClick={(event) => openFeatureStepModal(event.currentTarget)}>
                  + Add Feature Step
                </button>
              </div>
            </section>
            <section className="sa-management oem-table-only">
              <CatalogFormDialog
                open={showFeatureStepForm}
                title={editingFeatureStepId ? "Edit Feature Step" : "Add Feature Step"}
                description="Create a parent or child step for the configurable onboarding journey."
                error={error}
                busy={loading}
                triggerRef={featureStepTriggerRef}
                onClose={closeFeatureStepModal}
                onDialogClose={() => setShowFeatureStepForm(false)}
                onSubmit={submitFeatureStep}
                actions={<><button type="button" className="secondary" onClick={closeFeatureStepModal} disabled={loading}>Cancel</button><button type="submit" disabled={loading}>{editingFeatureStepId ? "Update Feature Step" : "Save Feature Step"}</button></>}
              >
                <TextFields
                  value={featureStep}
                  change={(key, value) => setFeatureStep((current) => ({ ...current, [key]: value }))}
                  fields={[["code", "Step code"], ["displayName", "Step name"], ["description", "Description"], ["displayOrder", "Display order"]]}
                  requiredKeys={["code", "displayName"]}
                />
                <label>
                  Parent step
                  <select value={featureStep.parentId} onChange={(event) => setFeatureStep((current) => ({ ...current, parentId: event.target.value }))}>
                    <option value="">No parent (top-level step)</option>
                    {featureSteps.filter((item) => item.id !== editingFeatureStepId && item.isActive).map((item) => (
                      <option key={item.id} value={item.id}>{item.parent ? `${item.parent.displayName} / ` : ""}{item.displayName}</option>
                    ))}
                  </select>
                </label>
                <label className="sa-toggle">
                  <input type="checkbox" checked={featureStep.isActive} onChange={(event) => setFeatureStep((current) => ({ ...current, isActive: event.target.checked }))} />
                  Active step
                </label>
              </CatalogFormDialog>
              {featureSteps.length ? (
                <DataTable
                  headings={["Code", "Feature Step", "Parent", "Features", "Status", "", ""]}
                  columnFilters={[{ type: "text" }, { type: "text" }, { type: "select" }, { type: "number" }, { type: "select" }, null, null]}
                  rows={featureSteps.map((item) => [
                    item.code,
                    item.displayName,
                    item.parent?.displayName ?? "—",
                    item._count?.features ?? 0,
                    item.isActive ? "ACTIVE" : "INACTIVE",
                    <button key="edit" className="secondary" onClick={(event) => openFeatureStepModal(event.currentTarget, item)}>Edit</button>,
                    <button key="delete" className="danger" onClick={() => void remove(`/platform/feature-steps/${item.id}`, "Feature Step")}>Delete</button>,
                  ])}
                />
              ) : (
                <section className="sa-empty-catalog"><h3>No Feature Steps yet</h3><p>Create the onboarding steps before assigning Features to them.</p></section>
              )}
            </section>
          </>
        )}
        {tab === "features" && (
          <>
            <section className="sa-page-head">
              <div>
                <h2>Feature</h2>
                <p>
                  Define platform capabilities that can be included in packages
                  and priced commercially.
                </p>
              </div>
              <div className="sa-actions">
                <button
                  className="secondary"
                  onClick={() => {
                    setBulkImportEntity("feature");
                    setShowFeatureForm(false);
                  }}
                >
                  Bulk upload
                </button>
                <button
                  onClick={(event) =>
                    openFeatureModal(event.currentTarget, undefined, true)
                  }
                >
                  + Add Feature
                </button>
              </div>
            </section>
            <section className="sa-management oem-table-only">
              <CatalogFormDialog
                open={showFeatureForm}
                title={editingFeatureId ? "Edit Feature" : "Add Feature"}
                description="Define platform capabilities that can be included in packages and priced commercially."
                error={error}
                busy={loading}
                triggerRef={featureTriggerRef}
                onClose={closeFeatureModal}
                onDialogClose={() => setShowFeatureForm(false)}
                onSubmit={submitFeature}
                actions={
                  <>
                    <button
                      type="button"
                      className="secondary"
                      onClick={closeFeatureModal}
                      disabled={loading}
                    >
                      Cancel
                    </button>
                    <button type="submit" disabled={loading}>
                      {editingFeatureId ? "Update Feature" : "Save Feature"}
                    </button>
                  </>
                }
              >
                <TextFields
                  value={feature}
                  change={(key, value) =>
                    setFeature((current) => ({ ...current, [key]: value }))
                  }
                  fields={[
                    ["code", "Feature code"],
                    ["name", "Feature name"],
                    ["description", "Description"],
                    ["displayOrder", "Display order"],
                  ]}
                />
                <label>
                  Feature configuration (optional JSON)
                  <textarea
                    value={feature.configuration}
                    placeholder={'{"provider":"msg91","delivery":"otp"}'}
                    onChange={(event) =>
                      setFeature((current) => ({
                        ...current,
                        configuration: event.target.value,
                      }))
                    }
                  />
                </label>
                <label>
                  Primary Feature Step
                  <select
                    value={feature.featureStepId}
                    onChange={(event) =>
                      setFeature((current) => ({
                        ...current,
                        featureStepId: event.target.value,
                      }))
                    }
                  >
                    <option value="">Not part of onboarding</option>
                    {featureSteps
                      .filter(
                        (step) => step.isActive || step.id === feature.featureStepId,
                      )
                      .map((step) => (
                        <option key={step.id} value={step.id}>
                          {step.parent ? `${step.parent.displayName} / ` : ""}
                          {step.displayName}
                        </option>
                      ))}
                  </select>
                </label>
                <label>
                  <span className="sa-label-text">
                    Feature category <span className="sa-required-star">*</span>
                  </span>
                  <select
                    required
                    value={feature.category}
                    onChange={(event) =>

                      setFeature((current) => ({
                        ...current,
                        category: event.target.value,
                      }))
                    }
                  >
                    <option value="">Select feature category</option>
                    {featureCategories.map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <Select
                  label="Feature type"
                  value={feature.featureType}
                  change={(value) =>
                    setFeature((current) => ({
                      ...current,
                      featureType: value,
                    }))
                  }
                  options={featureTypes}
                  required
                />
                <Select
                  label="Billing unit"
                  value={feature.billingUnit}
                  change={(value) =>
                    setFeature((current) => ({
                      ...current,
                      billingUnit: value,
                    }))
                  }
                  options={featureBillingUnits}
                  required
                />
                <label className="sa-toggle">
                  <input
                    type="checkbox"
                    checked={feature.isActive}
                    onChange={(event) =>

                      setFeature((current) => ({
                        ...current,
                        isActive: event.target.checked,
                      }))
                    }

                  />
                  Active feature
                </label>
                <label className="sa-toggle">
                  <input
                    type="checkbox"
                    checked={feature.isAddOnEligible}
                    onChange={(event) =>
                      setFeature((current) => ({
                        ...current,
                        isAddOnEligible: event.target.checked,
                      }))
                    }
                  />{" "}
                  Available as a client add-on
                </label>
              </CatalogFormDialog>
              {features.length ? (
                <DataTable
                  headings={[
                    "Code",
                    "Feature",
                    "Category",
                    "Feature Step",
                    "Type",
                    "Billing unit",
                    "Active",
                    "Add-on eligible",
                    "",
                    "",
                  ]}
                  columnFilters={[
                    { type: "text" },
                    { type: "text" },
                    { type: "select" },
                    { type: "select" },
                    { type: "select" },
                    { type: "select" },
                    { type: "select" },
                    { type: "select" },
                    null,
                    null,
                  ]}
                  rows={features.map((item) => [
                    item.code,
                    item.name,
                    featureCategories.find(
                      ([value]) => value === item.category,
                    )?.[1] ?? item.category,
                    item.featureStep?.displayName ?? "—",
                    item.featureType,
                    item.billingUnit,
                    item.isActive ? "YES" : "NO",
                    item.isAddOnEligible ? "YES" : "NO",
                    <button
                      key="edit"
                      className="secondary"
                      onClick={(event) =>
                        openFeatureModal(event.currentTarget, item, true)
                      }
                    >
                      Edit
                    </button>,
                    <button
                      key="delete"
                      className="danger"
                      onClick={() =>
                        void remove(`/platform/features/${item.id}`, "Feature")
                      }
                    >
                      Delete
                    </button>,
                  ])}
                />
              ) : (
                <section className="sa-empty-catalog">
                  <h3>No Features yet</h3>
                  <p>
                    Start by adding a Feature individually or importing a
                    completed template.
                  </p>
                  <div>
                    <button
                      onClick={(event) =>
                        openFeatureModal(event.currentTarget)
                      }
                    >
                      Add Feature
                    </button>
                    <button
                      className="secondary"
                      onClick={() => setBulkImportEntity("feature")}
                    >
                      Bulk upload
                    </button>
                  </div>
                </section>
              )}
            </section>
          </>
        )}
        {tab === "packages" && (
          <>
            <section className="sa-page-head">
              <div>
                <h2>Package</h2>
                <p>
                  Define commercial packages, limits, and trial settings.
                </p>
              </div>
              <div className="sa-actions">
                <button
                  className="secondary"
                  onClick={() => {
                    setBulkImportEntity("package");
                    setShowPackageForm(false);
                  }}
                >
                  Bulk upload
                </button>
                <button
                  onClick={(event) => openPackageModal(event.currentTarget)}
                >
                  + Add Package
                </button>
              </div>
            </section>
            <section className="sa-management oem-table-only">
              <CatalogFormDialog
                open={showPackageForm}
                title={editingPackageId ? "Edit Package" : "Add Package"}
                description="Define commercial package details. Assign Features separately from Package Feature."
                error={error}
                busy={loading}
                size="wide"
                triggerRef={packageTriggerRef}
                onClose={closePackageModal}
                onDialogClose={() => setShowPackageForm(false)}
                onSubmit={submitPackage}
                actions={
                  <>
                    <button
                      type="button"
                      className="secondary"
                      onClick={closePackageModal}
                      disabled={loading}
                    >
                      Cancel
                    </button>
                    <button type="submit" disabled={loading}>
                      {editingPackageId ? "Update Package" : "Save Package"}
                    </button>
                  </>
                }
              >
                <TextFields
                  value={pack}
                  change={(key, value) =>
                    setPack((current) => ({ ...current, [key]: value }))
                  }
                  fields={[
                    ["code", "Package code"],
                    ["name", "Package name"],
                    ["description", "Description"],
                    ["setupFee", "Setup fee"],
                    ["trialDays", "Trial days"],
                    ["displayOrder", "Display order"],
                  ]}
                />
                <PackageLimitFields
                  value={pack}
                  change={(key, value) =>
                    setPack((current) => ({ ...current, [key]: value }))
                  }
                />
                <label className="sa-toggle">
                  <input
                    type="checkbox"
                    checked={pack.isCustom}
                    onChange={(event) =>
                      setPack((current) => ({
                        ...current,
                        isCustom: event.target.checked,
                      }))
                    }
                  />
                  Custom package
                </label>
                <label className="sa-toggle">
                  <input
                    type="checkbox"
                    checked={pack.isActive}
                    onChange={(event) =>
                      setPack((current) => ({
                        ...current,
                        isActive: event.target.checked,
                      }))
                    }
                  />
                  Active package
                </label>
              </CatalogFormDialog>
              {packages.length ? (
                <DataTable
                  headings={[
                    "Code",
                    "Package",
                    "Setup fee",
                    "Limits",
                    "Status",
                    "Features",
                    "",
                    "",
                  ]}
                  columnFilters={[
                    { type: "text" },
                    { type: "text" },
                    { type: "text" },
                    { type: "text" },
                    { type: "select" },
                    { type: "number" },
                    null,
                    null,
                  ]}
                  rows={packages.map((item) => [
                    item.code,
                    item.name,
                    item.setupFee ? `₹${item.setupFee}` : "₹0",
                    `${displayPackageLimit(item.maxFleets)} fleets · ${displayPackageLimit(item.maxRiders)} riders`,
                    `${item.isActive ? "ACTIVE" : "INACTIVE"}${item.isCustom ? " · CUSTOM" : ""}`,
                    item.features?.length ?? 0,
                    <button
                      key="edit"
                      className="secondary"
                      onClick={(event) =>
                        openPackageModal(event.currentTarget, item)
                      }
                    >
                      Edit
                    </button>,
                    <button
                      key="delete"
                      className="danger"
                      onClick={() =>
                        void remove(`/platform/packages/${item.id}`, "package")
                      }
                    >
                      Delete
                    </button>,
                  ])}
                />
              ) : (
                <section className="sa-empty-catalog">
                  <h3>No Packages yet</h3>
                  <p>
                    Create a Package to group Features, commercial limits, and
                    pricing.
                  </p>
                  <div>
                    <button
                      onClick={(event) =>
                        openPackageModal(event.currentTarget)
                      }
                    >
                      Add Package
                    </button>
                  </div>
                </section>
              )}
            </section>
          </>
        )}
        {tab === "packageFeatures" && (
          <PackageFeaturesView
            packages={packages}
            features={features}
            token={token}
            onSaved={() => void load()}
            onDelete={(path, label) => void remove(path, label)}
          />
        )}
        {tab === "packageAddOns" && (
          <PackageAddOnsView
            packages={packages}
            featureAddOns={featureAddOns}
            token={token}
          />
        )}
        {tab === "packageTierPricing" && (
          <PackageTierPricingView packages={packages} token={token} />
        )}
        {tab === "pricing" && (
          <>
            <section className="sa-page-head">
              <div>
                <h2>Feature Pricing</h2>
                <p>
                  Define the platform-owned commercial terms for every feature.
                </p>
              </div>
              <div className="sa-actions">
                <button
                  onClick={(event) => openPricingModal(event.currentTarget)}
                >
                  + Add Feature Price
                </button>
              </div>
            </section>
            <section className="sa-management oem-table-only">
              <CatalogFormDialog
                open={showPricingForm}
                title={
                  editingPricingId
                    ? "Edit Feature Price"
                    : "Add Feature Price"
                }
                description="Define the platform-owned commercial terms for every feature."
                error={error}
                busy={loading}
                size="wide"
                triggerRef={pricingTriggerRef}
                onClose={closePricingModal}
                onDialogClose={() => setShowPricingForm(false)}
                onSubmit={submitPricing}
                actions={
                  <>
                    <button
                      type="button"
                      className="secondary"
                      onClick={closePricingModal}
                      disabled={loading}

                    >
                      Cancel
                    </button>
                    <button type="submit" disabled={loading}>
                      {editingPricingId
                        ? "Update Feature Price"
                        : "Save Feature Price"}
                    </button>
                  </>
                }
              >
                <label>
                  <span className="sa-label-text">
                    Feature <span className="sa-required-star">*</span>
                  </span>
                  <select
                    value={price.featureId}
                    onChange={(event) => {
                      const selectedFeature = features.find(
                        (feature) => feature.id === event.target.value,
                      );
                      setPrice((current) => ({
                        ...current,
                        featureId: event.target.value,
                        billingUnit:
                          selectedFeature?.billingUnit ?? current.billingUnit,
                      }));
                    }}
                    required
                  >
                    <option value="">Select feature</option>
                    {features
                      .filter(
                        (feature) =>
                          feature.isActive || feature.id === price.featureId,
                      )
                      .map((feature) => (
                        <option key={feature.id} value={feature.id}>
                          {feature.name}
                          {!feature.isActive ? " (inactive)" : ""}
                        </option>
                      ))}
                  </select>
                </label>
                <TextFields
                  value={price}
                  change={(key, value) =>
                    setPrice((current) => ({ ...current, [key]: value }))
                  }
                  fields={[
                    ["billingUnit", "Billing unit"],
                    ["salePrice", "Sale price"],
                    ["costPrice", "Cost price (internal)"],
                    ["effectiveFrom", "Effective from"],
                    ["effectiveTo", "Effective to"],
                  ]}
                  requiredKeys={["billingUnit", "salePrice", "effectiveFrom"]}
                />
                <label>
                  Currency
                  <select
                    value={price.currency}
                    onChange={(event) =>


                      setPrice((current) => ({
                        ...current,
                        currency: event.target.value,
                      }))
                    }
                  >
                    <option value="INR">INR</option>
                  </select>
                </label>
                <label>
                  Pricing metadata (optional JSON)
                  <textarea
                    value={price.metadata}
                    placeholder={'{"includedQuantity": 100}'}
                    onChange={(event) =>
                      setPrice((current) => ({
                        ...current,
                        metadata: event.target.value,
                      }))
                    }

                  />
                </label>
                <label className="sa-check">
                  <input
                    type="checkbox"
                    checked={price.isActive}
                    onChange={(event) =>
                      setPrice((current) => ({
                        ...current,
                        isActive: event.target.checked,
                      }))
                    }
                  />
                  Active
                </label>
              </CatalogFormDialog>


              {pricing.length ? (
                <DataTable
                  headings={[
                    "Feature",
                    "Billing unit",
                    "Sale price",
                    "Effective from",
                    "Status",
                    "",
                    "",
                  ]}
                  columnFilters={[
                    { type: "text" },
                    { type: "select" },
                    { type: "text" },
                    { type: "text" },
                    { type: "select" },
                    null,
                    null,
                  ]}
                  rows={pricing.map((item) => [
                    item.feature?.name,
                    item.billingUnit,
                    `${item.currency} ${item.salePrice}`,
                    new Date(item.effectiveFrom).toLocaleDateString(),
                    item.isActive ? "ACTIVE" : "INACTIVE",
                    <button
                      key="edit"
                      className="secondary"
                      onClick={(event) =>
                        openPricingModal(event.currentTarget, item)
                      }

                    >
                      Edit
                    </button>,
                    <button
                      key="delete"
                      className="danger"
                      onClick={() =>
                        void remove(
                          `/platform/feature-pricing/${item.id}`,
                          "price",
                        )
                      }
                    >
                      Delete
                    </button>,
                  ])}
                />
              ) : (
                <section className="sa-empty-catalog">
                  <h3>No Feature Prices yet</h3>
                  <p>
                    Create pricing terms for a Feature, including its model,
                    effective dates, and commercial amounts.
                  </p>
                  <div>
                    <button
                      onClick={(event) =>
                        openPricingModal(event.currentTarget)
                      }
                    >
                      Add Feature Price
                    </button>
                  </div>
                </section>
              )}
            </section>
          </>
        )}
        {tab === "featureAddOns" && (
          <>
            <section className="sa-page-head">
              <div>
                <h2>Feature Add-Ons</h2>
                <p>
                  Define additional feature allowances that clients can purchase.
                </p>
              </div>
              <div className="sa-actions">
                <button
                  onClick={(event) =>
                    openFeatureAddOnModal(event.currentTarget)
                  }
                >
                  + Add Feature Add-On
                </button>
              </div>
            </section>
            <section className="sa-management oem-table-only">
              <CatalogFormDialog
                open={showFeatureAddOnForm}
                title={
                  editingFeatureAddOnId
                    ? "Edit Feature Add-On"
                    : "Add Feature Add-On"
                }
                description="Set the purchasable quantity, commercial price, and validity period for a feature."
                error={error}
                busy={loading}
                size="wide"
                triggerRef={featureAddOnTriggerRef}
                onClose={closeFeatureAddOnModal}
                onDialogClose={() => setShowFeatureAddOnForm(false)}
                onSubmit={submitFeatureAddOn}
                actions={
                  <>
                    <button
                      type="button"
                      className="secondary"
                      onClick={closeFeatureAddOnModal}
                      disabled={loading}
                    >
                      Cancel
                    </button>
                    <button type="submit" disabled={loading}>
                      {editingFeatureAddOnId
                        ? "Update Feature Add-On"
                        : "Save Feature Add-On"}
                    </button>
                  </>
                }
              >
                <TextFields
                  value={featureAddOn}
                  change={(key, value) =>
                    setFeatureAddOn((current) => ({ ...current, [key]: value }))
                  }
                  fields={[
                    ["code", "Add-on code"],
                    ["name", "Add-on name"],
                    ["description", "Description"],
                    ["quantity", "Included quantity"],
                    ["discount", "Discount (%)"],
                    ["validityDays", "Validity days"],
                    ["effectiveFrom", "Effective from"],
                    ["effectiveTo", "Effective to"],
                  ]}
                  requiredKeys={[
                    "code",
                    "name",
                    "quantity",
                    "salePrice",
                    "effectiveFrom",
                  ]}
                />
                <label>
                  <span className="sa-label-text">
                    Feature <span className="sa-required-star">*</span>
                  </span>
                  <select
                    value={featureAddOn.featureId}
                    onChange={(event) =>
                      setFeatureAddOn((current) => ({
                        ...current,
                        featureId: event.target.value,
                      }))
                    }
                    required
                  >
                    <option value="">Select feature</option>
                    {features
                      .filter(
                        (feature) =>
                          feature.isActive ||
                          feature.id === featureAddOn.featureId,
                      )
                      .map((feature) => (
                        <option key={feature.id} value={feature.id}>
                          {feature.name}
                          {!feature.isActive ? " (inactive)" : ""}
                        </option>
                      ))}
                  </select>
                </label>
                <section className="sa-feature-addon-calculation" aria-live="polite">
                  {featureAddOnUnitPrice ? (
                    <>
                      <p>
                        Unit prices from Feature Pricing: {featureAddOnUnitPrice.currency}{" "}
                        {featureAddOnUnitPrice.salePrice} sale
                        {featureAddOnUnitPrice.costPrice === null
                          ? ""
                          : ` · ${featureAddOnUnitPrice.costPrice} cost`}
                      </p>
                      <p>
                        Calculated cost: {featureAddOnUnitPrice.currency}{" "}
                        {featureAddOnBaseCost === null
                          ? "Not configured"
                          : featureAddOnBaseCost.toFixed(2)}
                      </p>
                      <p>
                        Calculated sale price: {featureAddOnUnitPrice.currency}{" "}
                        {featureAddOnSaleAfterDiscount?.toFixed(2)}
                        {featureAddOnDiscount > 0
                          ? ` after ${featureAddOnDiscount}% discount`
                          : ""}
                      </p>
                    </>
                  ) : (
                    <p className="sa-field-warning">
                      Select a Feature with active pricing for the effective date to calculate this add-on.
                    </p>
                  )}
                </section>
                <label className="sa-check">
                  <input
                    type="checkbox"
                    checked={featureAddOn.isActive}
                    onChange={(event) =>
                      setFeatureAddOn((current) => ({
                        ...current,
                        isActive: event.target.checked,
                      }))
                    }
                  />
                  Active
                </label>
              </CatalogFormDialog>
              {featureAddOns.length ? (
                <DataTable
                  headings={[
                    "Code",
                    "Feature",
                    "Quantity",
                    "Sale price",
                    "Validity",
                    "Status",
                    "",
                    "",
                  ]}
                  columnFilters={[
                    { type: "text" },
                    { type: "select" },
                    { type: "text" },
                    { type: "text" },
                    { type: "text" },
                    { type: "select" },
                    null,
                    null,
                  ]}
                  rows={featureAddOns.map((item) => [
                    item.code,
                    item.feature?.name,
                    item.quantity,
                    `${item.currency} ${item.salePrice}`,
                    item.validityDays ? `${item.validityDays} days` : "No expiry",
                    item.isActive ? "ACTIVE" : "INACTIVE",
                    <button
                      key="edit"
                      className="secondary"
                      onClick={(event) =>
                        openFeatureAddOnModal(event.currentTarget, item)
                      }
                    >
                      Edit
                    </button>,
                    <button
                      key="status"
                      className={item.isActive ? "danger" : "secondary"}
                      onClick={() =>
                        void submit(
                          () =>
                            request(
                              `/platform/commercial/feature-addons/${item.id}/status`,
                              {
                                method: "PATCH",
                                body: JSON.stringify({
                                  isActive: !item.isActive,
                                }),
                              },
                              token,
                            ),
                          item.isActive
                            ? "Feature add-on deactivated."
                            : "Feature add-on activated.",
                        )
                      }
                    >
                      {item.isActive ? "Deactivate" : "Activate"}
                    </button>,
                  ])}
                />
              ) : (
                <section className="sa-empty-catalog">
                  <h3>No Feature Add-Ons yet</h3>
                  <p>
                    Create an add-on to sell additional feature usage or
                    allowance to clients.
                  </p>
                  <div>
                    <button
                      onClick={(event) =>
                        openFeatureAddOnModal(event.currentTarget)
                      }
                    >
                      Add Feature Add-On
                    </button>
                  </div>
                </section>
              )}
            </section>
          </>
        )}
        {loading && <p className="platform-loading">Working…</p>}
          </>
        )}
      </section>
      <DeleteConfirmationDialog
        confirmation={deleteConfirmation}
        busy={loading}
        onClose={() => setDeleteConfirmation(null)}
      />
    </main>
  );
}

function DeleteConfirmationDialog({
  confirmation,
  busy,
  onClose,
}: {
  confirmation: DeleteConfirmation | null;
  busy: boolean;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (confirmation && !dialog.open) {
      dialog.showModal();
      window.requestAnimationFrame(() => confirmRef.current?.focus());
    }
    if (!confirmation && dialog.open) dialog.close();
  }, [confirmation]);
  const confirm = async () => {
    if (!confirmation) return;
    await confirmation.onConfirm();
    onClose();
  };
  return (
    <dialog
      ref={dialogRef}
      className="sa-dialog sa-delete-dialog"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
      onClose={() => {
        if (confirmation) onClose();
      }}
    >
      <div className="sa-dialog-surface sa-delete-dialog-surface">
        <span className="sa-delete-dialog-icon" aria-hidden="true">!</span>
        <div>
          <p className="sa-eyebrow">CONFIRM DELETION</p>
          <h2>{confirmation?.title}</h2>
          <p>{confirmation?.description}</p>
        </div>
        <div className="sa-dialog-actions">
          <button type="button" className="secondary" onClick={onClose} disabled={busy}>
            Keep it
          </button>
          <button ref={confirmRef} type="button" className="danger" onClick={() => void confirm()} disabled={busy}>
            {busy ? "Deleting…" : confirmation?.confirmLabel ?? "Delete"}
          </button>
        </div>
      </div>
    </dialog>
  );
}

function DashboardView({
  summary,
  clients,
  oems,
  setTab,
}: {
  summary: Item;
  clients: Item[];
  oems: Item[];
  setTab: (tab: Tab) => void;
}) {
  const { t } = useLocale();
  const fleetStatus = summary.fleetsByStatus ?? {};
  const riderStatus = summary.ridersByStatus ?? {};
  const clientStatus = summary.clientsByStatus ?? {};
  const clientSlices = [
    ["Created", Number(clientStatus.CREATED ?? 0), "#367eb5"],
    ["Active", Number(clientStatus.ACTIVE ?? 0), "#2d8662"],
    ["Pending", Number(clientStatus.PENDING_APPROVAL ?? 0), "#d5913a"],
    ["Draft", Number(clientStatus.DRAFT ?? 0), "#8092a2"],
    ["Rejected", Number(clientStatus.REJECTED ?? 0), "#c15e5e"],
    ["Suspended", Number(clientStatus.SUSPENDED ?? 0), "#d26551"],
  ] as const;
  const clientTotal = clientSlices.reduce(
    (total, [, count]) => total + count,
    0,
  );
  let cursor = 0;
  const clientGradient = clientSlices
    .filter(([, count]) => count > 0)
    .map(([, count, color]) => {
      const start = (cursor / Math.max(clientTotal, 1)) * 100;
      cursor += count;
      const end = (cursor / Math.max(clientTotal, 1)) * 100;
      return `${color} ${start}% ${end}%`;
    })
    .join(", ");
  const fleetBars = [
    ["Available", Number(fleetStatus.AVAILABLE ?? 0), "#2d8662"],
    [
      "Allocated",
      Number(fleetStatus.ALLOCATED ?? 0) + Number(fleetStatus.IN_USE ?? 0),
      "#367eb5",
    ],
    ["Maintenance", Number(fleetStatus.MAINTENANCE ?? 0), "#d5913a"],
    [
      "Offline",
      Number(fleetStatus.OFFLINE ?? 0) +
        Number(fleetStatus.OUT_OF_SERVICE ?? 0),
      "#d26551",
    ],
  ] as const;
  const maxFleetBar = Math.max(...fleetBars.map(([, count]) => count), 1);
  const catalogItems = [
    [
      "Vehicle categories",
      Number(summary.vehicleCategories ?? 0),
      "vehicleCategories",
    ],
    ["Vehicle types", Number(summary.vehicleTypes ?? 0), "vehicleTypes"],
    ["OEMs", Number(summary.oems ?? oems.length), "oems"],
    ["Features", Number(summary.features ?? 0), "features"],
    ["Price rules", Number(summary.pricing ?? 0), "pricing"],
  ] as const;

  return (
    <>
      <section className="sa-metrics">
        <Metric
          label="Active clients"
          value={summary.activeClients ?? 0}
          detail={`${summary.pendingClients ?? 0} pending`}
          tone="green"
        />
        <Metric
          label="Total fleet"
          value={summary.fleets ?? 0}
          detail={`${fleetStatus.AVAILABLE ?? 0} available`}
          tone="blue"
        />
        <Metric
          label="Active riders"
          value={riderStatus.ACTIVE ?? 0}
          detail={`${summary.riders ?? 0} total`}
          tone="gold"
        />
        <Metric
          label="Live subscriptions"
          value={summary.subscriptions ?? 0}
          detail={`${summary.packages ?? 0} packages`}
          tone="purple"
        />
      </section>
      <section className="sa-metrics sa-metrics-secondary">
        <Metric
          label="Approval pending"
          value={summary.pendingClients ?? 0}
          detail="Clients awaiting decision"
          tone="gold"
        />
        <Metric
          label="Client pipeline"
          value={summary.clients ?? 0}
          detail={`${summary.pendingClients ?? 0} awaiting review`}
          tone="coral"
        />
        <Metric
          label="Platform OEMs"
          value={summary.oems ?? oems.length}
          detail="Master controlled"
          tone="blue"
        />
        <Metric
          label="Billable features"
          value={summary.pricing ?? 0}
          detail={`${summary.features ?? 0} catalog features`}
          tone="gold"
        />
        <Metric
          label="Riders awaiting activation"
          value={riderStatus.PENDING ?? 0}
          detail={`${riderStatus.BLOCKED ?? 0} blocked`}
          tone="coral"
        />
      </section>
      <section className="sa-dashboard-grid">
        <article className="sa-card sa-fleet-chart">
          <div className="sa-card-head">
            <div>
              <h3>{t("Fleet operational health")}</h3>
              <p>{t("Current fleet availability across all clients")}</p>
            </div>
            <button className="secondary" onClick={() => setTab("clients")}>
              {t("View clients")}
            </button>
          </div>
          <div className="sa-health-bars">
            {fleetBars.map(([label, count, color]) => (
              <div key={label}>
                <div className="sa-health-label">
                  <span>{t(label)}</span>
                  <strong>{count}</strong>
                </div>
                <span className="sa-health-track">
                  <i
                    style={{
                      width: `${(count / maxFleetBar) * 100}%`,
                      background: color,
                    }}
                  />
                </span>
              </div>
            ))}
          </div>
          <p className="sa-footnote">
            {summary.fleets ?? 0} {t("active fleet records are monitored from one platform view.")}
          </p>
        </article>
        <article className="sa-card">
          <div className="sa-card-head">
            <div>
              <h3>{t("Client performance")}</h3>
              <p>{t("Top clients by fleet size")}</p>
            </div>
            <button className="secondary" onClick={() => setTab("clients")}>
              {t("View all")}
            </button>
          </div>
          <div className="sa-ranked-list">
            {clients.slice(0, 6).map((client, index) => (
              <div key={client.id}>
                <span>{index + 1}</span>
                <section>
                  <strong>{client.name}</strong>
                  <small>
                    {client._count?.riders ?? 0} {t("riders")} ·{" "}
                    {client._count?.users ?? 0} {t("users")}
                  </small>
                </section>
                <b>{t(client.isActive ? "Active" : "Inactive")}</b>
              </div>
            ))}
            {!clients.length && (
              <p className="muted">{t("No clients have been onboarded yet.")}</p>
            )}
          </div>
        </article>
        <article className="sa-card">
          <div className="sa-card-head">
            <div>
              <h3>{t("Client lifecycle")}</h3>
              <p>{t("Onboarding and account-status distribution")}</p>
            </div>
          </div>
          <div className="sa-lifecycle">
            <div
              className="sa-donut"
              style={{
                background: clientGradient
                  ? `conic-gradient(${clientGradient})`
                  : "#edf1ee",
              }}
            >
              <div>
                <strong>{clientTotal}</strong>
                <small>{t("clients")}</small>
              </div>
            </div>
            <div className="sa-legend">
              {clientSlices.map(([label, count, color]) => (
                <div key={label}>
                  <i style={{ background: color }} />
                  <span>{t(label)}</span>
                  <strong>{count}</strong>
                </div>
              ))}
            </div>
          </div>
        </article>
        <article className="sa-card sa-catalog-card">
          <div className="sa-card-head">
            <div>
              <h3>{t("Platform catalogue")}</h3>
              <p>{t("Master records ready for client configuration")}</p>
            </div>
            <button className="secondary" onClick={() => setTab("features")}>
              {t("Manage")}
            </button>
          </div>
          <div className="sa-catalog-coverage">
            {catalogItems.map(([label, count, target]) => (
              <button key={label} onClick={() => setTab(target as Tab)}>
                <span>
                  <strong>{count}</strong>
                  <small>{t(label)}</small>
                </span>
                <i
                  style={{ width: `${Math.min(100, Math.max(8, count * 8))}%` }}
                />
              </button>
            ))}
          </div>
        </article>
        <article className="sa-card">
          <div className="sa-card-head">
            <div>
              <h3>{t("Recent activity")}</h3>
              <p>{t("Platform-wide events")}</p>
            </div>
            <span className="sa-live">● {t("Live")}</span>
          </div>
          <ul className="sa-activity">
            <li>
              {summary.pendingClients ?? 0} client application
              {Number(summary.pendingClients ?? 0) === 1 ? " is" : "s are"}{" "}
              awaiting review
            </li>
            <li>
              {summary.subscriptions ?? 0} active subscription
              {Number(summary.subscriptions ?? 0) === 1 ? " is" : "s are"} using
              platform pricing
            </li>
            <li>
              {summary.pricing ?? 0} feature price rule
              {Number(summary.pricing ?? 0) === 1 ? " is" : "s are"} available
              for commercial configuration
            </li>
          </ul>
        </article>
      </section>
    </>
  );
}

function ClientCommercialDirectory({
  clients,
  section,
}: {
  clients: Item[];
  section: ClientCommercialSection;
}) {
  const details: Record<ClientCommercialSection, { title: string; description: string }> = {
    pricing: {
      title: "Client Pricing Adjustments",
      description: "Create and review client-specific commercial adjustments without changing package or Feature master prices.",
    },
    addOns: {
      title: "Client Feature Add-On Purchases",
      description: "Purchase configured Feature Add-Ons against each client’s active package subscription.",
    },
    creditLots: {
      title: "Client Feature Credit Lots",
      description: "Inspect package allowances, purchased credits, available balances, and expiry dates.",
    },
    ledger: {
      title: "Client Feature Usage Ledger",
      description: "Review the auditable record of feature credit grants, consumption, adjustments, and expiry.",
    },
  };
  const activeClients = clients.filter((client) => client.status === "ACTIVE");
  const action = section === "pricing"
    ? "Manage pricing"
    : section === "addOns"
      ? "Manage Add-Ons"
      : section === "creditLots"
        ? "View credit lots"
        : "View ledger";

  return (
    <>
      <section className="sa-page-head">
        <div>
          <h2>{details[section].title}</h2>
          <p>{details[section].description}</p>
        </div>
      </section>
      {activeClients.length ? (
        <DataTable
          headings={["Client", "Company code", "Status", "Action"]}
          columnFilters={[{ type: "text" }, { type: "text" }, null, null]}
          rows={activeClients.map((client) => [
            client.name,
            client.companyCode ?? client.slug,
            client.status,
            <ClientCommercialSettings
              key={`${client.id}-${section}`}
              clientId={client.id}
              clientName={client.name}
              section={section}
            />,
          ])}
        />
      ) : (
        <section className="sa-empty-catalog">
          <h3>No active clients</h3>
          <p>Activate a client and create its subscription before managing commercial records.</p>
        </section>
      )}
    </>
  );
}

function ClientsView({
  clients,
  packages,
  vehicleCategories,
  showForm,
  setShowForm,
  client,
  change,
  step,
  setStep,
  submit,
  error,
  loading,
  triggerRef,
  openDialog,
  closeDialog,
  documentFiles,
  setDocumentFiles,
  logoFile,
  setLogoFile,
  approveClient,
  rejectClient,
  editClient,
  activeClientEdit,
  approvalEmailReference,
  setApprovalEmailReference,
}: any) {
  const stepHeadingRef = useRef<HTMLHeadingElement>(null);
  const stepHeadingId = useId();
  const wasOpenRef = useRef(showForm);
  const previousStepRef = useRef(step);
  useEffect(() => {
    if (showForm && wasOpenRef.current && previousStepRef.current !== step) {
      stepHeadingRef.current?.focus();
    }
    previousStepRef.current = step;
    wasOpenRef.current = showForm;
  }, [showForm, step]);


  const fields =
    step === 1
      ? [
          ["businessFleetName", "Business / fleet name"],
          ["companyCode", "Company code (client login)"],
          ["legalEntityName", "Legal entity name"],
          ["pan", "PAN"],
          ["gstin", "GSTIN"],
          ["cinOrLlpin", "CIN / LLPIN"],
          ["website", "Website"],
          ["yearEstablished", "Year of establishment"],
          ["estimatedFleetSize", "Approx. fleet size"],
          ["estimatedRiderCount", "Approx. rider count"],
          ["estimatedUserCount", "Approx. employee / user count"],
        ]
      : step === 2
        ? [
            ["primaryContactName", "Primary contact name"],
            ["primaryDesignation", "Primary designation"],
            ["primaryMobile", "Primary mobile"],
            ["primaryEmail", "Primary email"],
            ["alternateMobile", "Alternate mobile"],
            ["registeredAddressLine1", "Registered address line 1"],
            ["registeredAddressLine2", "Registered address line 2"],
            ["landmark", "Landmark"],
            ["city", "City"],
            ["district", "District"],
            ["state", "State"],
            ["country", "Country"],
            ["pinCode", "PIN code"],
          ]
        : step === 3
          ? [
              ["numberOfFleets", "Number of fleets"],
              ["approximateRiderCount", "Approx. riders"],
              ["operationalHubCount", "Number of operational hubs"],
            ]
          : step === 4
            ? [
                ["startDate", "Package start date"],
                ["endDate", "Package end date"],
              ]
            : step === 5
              ? [
                  ["billingContactName", "Billing contact name"],
                  ["billingEmail", "Billing email"],
                  ["billingMobile", "Billing mobile"],
                  ["poNumber", "PO number"],
                  ["paymentTerms", "Payment terms"],
                ]
              : [
                  ["authorizedSignatoryName", "Authorized signatory name"],
                  ["signatoryDesignation", "Signatory designation"],
                ];
  const requiredFields = [
    "businessFleetName",
    "companyCode",
    "legalEntityName",
    "businessType",
    "clientType",
    "pan",
    "estimatedFleetSize",
    "estimatedRiderCount",
    "primaryContactName",
    "primaryDesignation",
    "primaryMobile",
    "primaryEmail",
    "registeredAddressLine1",
    "city",
    "state",
    "pinCode",
    "numberOfFleets",
    "approximateRiderCount",
    "packageId",
    "startDate",
    "billingContactName",
    "billingEmail",
    "authorizedSignatoryName",
    "signatoryDesignation",
  ];
  const inputTypes = {
    website: "url",
    primaryMobile: "tel",
    primaryEmail: "email",
    alternateMobile: "tel",
    adminEmail: "email",
    adminMobile: "tel",
    billingEmail: "email",
    billingMobile: "tel",
  } as const;
  const panPattern = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
  const gstinPattern = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
  const softWarnings = {
    ...(client.pan && !panPattern.test(String(client.pan).trim().toUpperCase())
      ? { pan: "PAN format looks unusual. Expected: ABCDE1234F." }
      : {}),
    ...(client.gstin &&
    !gstinPattern.test(String(client.gstin).trim().toUpperCase())
      ? { gstin: "GSTIN format looks unusual. Expected: 22ABCDE1234F1Z5." }
      : {}),
  };
  const uploadedDocumentTypes = new Set(
    ((client.uploadedDocuments ?? []) as Item[]).map(
      (document) => document.documentType,
    ),
  );
  const progress = Math.round((step / clientStepLabels.length) * 100);
  const eligiblePackages = packages.filter(
    (item: Item) =>
      item.isActive &&
      item.setupFee !== null &&
      item.setupFee !== undefined,
  );

  return (
    <>
      <section className="sa-page-head">
        <div>
          <h2>Clients</h2>
          <p>
            Manage onboarding drafts, approvals, subscriptions, and documents.
          </p>
        </div>
        <button onClick={(event) => openDialog(event.currentTarget)}>
          + Onboard client
        </button>
      </section>
      <CatalogFormDialog
        open={showForm}
        title={activeClientEdit ? "Edit active Client" : "Client onboarding"}
        description={
          activeClientEdit
            ? "Save only changes covered by the approved email reference. Every update is recorded in the audit log."
            : "Onboard a client through six saved steps, then create its workspace."
        }
        error={error}
        busy={loading}
        size="wide"
        triggerRef={triggerRef}
        onClose={closeDialog}
        onDialogClose={() => setShowForm(false)}
        onSubmit={submit}
        actions={
          <>
            <button
              type="button"
              className="secondary"
              onClick={closeDialog}
              disabled={loading}
            >
              Cancel
            </button>
            {step > 2 && (
              <button
                type="button"
                className="secondary"
                onClick={() => setStep(step - 1)}
                disabled={loading}
              >
                Back
              </button>
            )}
            <button type="submit" disabled={loading}>
              {step === 6
                ? activeClientEdit
                  ? "Finish"
                  : "Create client workspace"
                : activeClientEdit
                  ? "Save approved changes"
                  : "Save & continue"}
            </button>
          </>
        }
      >
        <>
          {activeClientEdit && (
            <label className="sa-active-client-approval">
              <span className="sa-label-text">
                Approved email reference
                <span className="sa-required-star">*</span>
              </span>
              <input
                value={approvalEmailReference}
                onChange={(event) =>
                  setApprovalEmailReference(event.target.value)
                }
                placeholder="Email subject, ticket ID, or approval date"
                required
                maxLength={500}
              />
              <small>
                Keep the approval email in your records. This reference is stored
                with each Client change in the audit log.
              </small>
            </label>
          )}
          <div className="sa-client-wizard">
          <nav className="sa-client-stepper" aria-label="Client onboarding steps">
            <ol>
              {clientStepLabels.map((label, index) => {
                const stepNumber = index + 1;
                const state =
                  stepNumber < step
                    ? "completed"
                    : stepNumber === step
                      ? "current"
                      : "future";
                return (
                  <li
                    key={label}
                    className={`sa-client-step ${state}`}
                    aria-current={stepNumber === step ? "step" : undefined}
                  >
                    <span className="sa-client-step-number" aria-hidden="true">
                      {stepNumber}
                    </span>
                    {activeClientEdit ? (
                      <button
                        type="button"
                        className="sa-client-step-jump"
                        onClick={() => setStep(stepNumber)}
                      >
                        {label}
                      </button>
                    ) : (
                      <span>{label}</span>
                    )}
                  </li>
                );
              })}
            </ol>
            <div className="sa-client-progress">
              <div className="sa-client-progress-label">
                <span>
                  Step {step} of {clientStepLabels.length}
                </span>
                <strong>{progress}%</strong>
              </div>
              <div
                className="sa-client-progress-track"
                role="progressbar"
                aria-label="Client onboarding progress"
                aria-valuemin={1}
                aria-valuemax={clientStepLabels.length}
                aria-valuenow={step}
                aria-valuetext={`Step ${step} of ${clientStepLabels.length}, ${progress}% complete`}
              >
                <span style={{ width: `${progress}%` }} />
              </div>
            </div>
          </nav>
          <section
            className="sa-client-step-content"
            aria-labelledby={stepHeadingId}
          >
            <h3 id={stepHeadingId} ref={stepHeadingRef} tabIndex={-1}>
              {clientStepLabels[step - 1]}
            </h3>
            <div className="sa-field-grid">
              <TextFields
                value={client}
                change={change}
                fields={fields}
                requiredKeys={requiredFields}
                inputTypes={inputTypes}
                softWarnings={step === 1 ? softWarnings : undefined}
                disabledKeys={
                  activeClientEdit && step === 1 ? ["companyCode"] : undefined
                }
              />
              {step === 1 && (
                <>
                  <ClientLogoUpload file={logoFile} savedUrl={client.logoUrl} onChange={setLogoFile} />
                  <Select
                    label="Industry"
                    value={client.industry}
                    change={(value) => change("industry", value)}
                    allowEmpty
                    options={clientIndustries}
                  />
                  <Select
                    label="Client type"
                    value={client.clientType}
                    change={(value) => change("clientType", value)}
                    options={[
                      "FLEET_OWNER",
                      "FLEET_OPERATOR",
                      "LOGISTICS_COMPANY",
                      "DELIVERY_PARTNER",
                      "LEASING_COMPANY",
                      "VEHICLE_AGGREGATOR",
                      "ENTERPRISE",
                      "OTHER",
                    ]}
                    required
                  />
                  <Select
                    label="Business type"
                    value={client.businessType}
                    change={(value) => change("businessType", value)}
                    options={[
                      "PVT_LTD",
                      "LLP",
                      "PARTNERSHIP",
                      "PROPRIETORSHIP",
                      "HUF",
                      "INDIVIDUAL",
                      "OTHER",
                    ]}
                    required
                  />
                </>
              )}
              {step === 2 && (
                <>
                  <label className="sa-toggle">
                    <input
                      type="checkbox"
                      checked={client.adminSameAsPrimary}
                      onChange={(event) =>
                        change("adminSameAsPrimary", event.target.checked)
                      }
                    />{" "}
                    Admin is same as Primary Contact
                  </label>
                  {!client.adminSameAsPrimary && (
                    <TextFields
                      value={client}
                      change={change}
                      fields={[
                        ["adminName", "Admin name"],
                        ["adminDesignation", "Admin designation"],
                        ["adminMobile", "Admin mobile"],
                        ["adminEmail", "Admin email"],
                      ]}
                      requiredKeys={[
                        "adminName",
                        "adminMobile",
                        "adminEmail",
                      ]}
                      inputTypes={inputTypes}
                    />
                  )}
                  <label className="sa-toggle">
                    <input
                      type="checkbox"
                      checked={client.billingSameAsRegistered}
                      onChange={(event) =>
                        change("billingSameAsRegistered", event.target.checked)
                      }
                    />{" "}
                    Billing address is same as registered
                  </label>
                  {!client.billingSameAsRegistered && (
                    <TextFields
                      value={client}
                      change={change}
                      fields={[
                        ["billingAddressLine1", "Billing address line 1"],
                        ["billingAddressLine2", "Billing address line 2"],
                        ["billingLandmark", "Billing landmark"],
                        ["billingCity", "Billing city"],
                        ["billingDistrict", "Billing district"],
                        ["billingState", "Billing state"],
                        ["billingCountry", "Billing country"],
                        ["billingPinCode", "Billing PIN code"],
                      ]}
                      requiredKeys={[
                        "billingAddressLine1",
                        "billingCity",
                        "billingState",
                        "billingPinCode",
                      ]}
                    />
                  )}
                </>
              )}
              {step === 3 && (
                <>
                  <Select
                    label="Fleet business model"
                    value={client.fleetBusinessModel}
                    change={(value) => change("fleetBusinessModel", value)}
                    options={fleetBusinessModels}
                    required
                  />
                  <Select
                    label="Vehicle ownership"
                    value={client.vehicleOwnership}
                    change={(value) => change("vehicleOwnership", value)}
                    options={vehicleOwnerships}
                    required
                  />
                  <label>
                    <span className="sa-label-text">
                      Vehicle categories{" "}
                      <span className="sa-required-star">*</span>
                    </span>
                    <select
                      required
                      multiple
                      value={client.vehicleCategoryIds ?? []}
                      onChange={(event) =>
                        change(
                          "vehicleCategoryIds",
                          Array.from(
                            event.target.selectedOptions,
                            (option) => option.value,
                          ),
                        )
                      }
                    >
                      {vehicleCategories
                        .filter((item: Item) => item.status === "ACTIVE")
                        .map((item: Item) => (
                          <option key={item.id} value={item.id}>
                            {item.code} · {item.name}
                          </option>
                        ))}
                    </select>
                    <small>Select one or more vehicle categories.</small>
                  </label>
                </>
              )}
              {step === 4 && (
                <>
                  <label>
                    <span className="sa-label-text">
                      Package <span className="sa-required-star">*</span>
                    </span>
                    <select
                      value={client.packageId}
                      onChange={(event) =>
                        change("packageId", event.target.value)
                      }
                      required
                    >
                      <option value="">
                        {eligiblePackages.length
                          ? "Select package"
                          : "No eligible packages available"}
                      </option>
                      {eligiblePackages.map((item: Item) => (
                        <option key={item.id} value={item.id}>
                          {item.name} · ₹{item.setupFee ?? 0} setup fee
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Billing cycle
                    <select
                      value={client.billingCycle}
                      onChange={(event) =>
                        change("billingCycle", event.target.value)
                      }
                    >
                      <option value="">Select billing cycle</option>
                      {billingCycles.map((cycle) => (
                        <option key={cycle} value={cycle}>{enumLabel(cycle)}</option>
                      ))}
                    </select>
                  </label>
                  <label className="sa-toggle">
                    <input
                      type="checkbox"
                      checked={client.autoRenew}
                      onChange={(event) =>
                        change("autoRenew", event.target.checked)
                      }
                    />{" "}
                    Auto renew
                  </label>
                  <label className="sa-toggle">
                    <input
                      type="checkbox"
                      checked={client.trialRequired}
                      onChange={(event) =>
                        change("trialRequired", event.target.checked)
                      }
                    />{" "}
                    Trial required
                  </label>
                </>
              )}
              {step === 5 && (
                <>
                  <label className="sa-toggle">
                    <input
                      type="checkbox"
                      checked={client.purchaseOrderRequired}
                      onChange={(event) =>
                        change("purchaseOrderRequired", event.target.checked)
                      }
                    />{" "}
                    Purchase order required
                  </label>
                  {[
                    ["PAN_CARD", "PAN Card · required"],
                    ["GST_CERTIFICATE", "GST Certificate"],
                    ["INCORPORATION_CERTIFICATE", "Incorporation Certificate"],
                    ["FLEET_AGREEMENT", "Fleet / Business Agreement"],
                  ].map(([type, label]) => (
                    <label key={type} className="sa-logo-input">
                      {label}
                      <input
                        type="file"
                        accept="application/pdf,image/jpeg,image/png"
                        onChange={(event) =>
                          setDocumentFiles((current: any) => ({
                            ...current,
                            [type]: event.target.files?.[0],
                          }))
                        }
                      />
                      {documentFiles[type] && (
                        <small>{documentFiles[type]?.name}</small>
                      )}
                      {!documentFiles[type] &&
                        uploadedDocumentTypes.has(type) && (
                          <small>Previously uploaded</small>
                        )}
                    </label>
                  ))}
                </>
              )}
              {step === 6 && (
                activeClientEdit ? (
                  <p className="muted">
                    Review the approved updates, then select Finish. The Client
                    remains active and every saved change is linked to the email
                    reference above.
                  </p>
                ) : (
                  <>
                  <p className="muted">
                    Review the saved Client profile, contacts, operations,
                    package, billing, and uploaded documents. Creating the
                    workspace makes it available to the Client Admin.
                  </p>
                  <label className="sa-toggle">
                    <input
                      type="checkbox"
                      checked={client.termsAccepted}
                      onChange={(event) =>
                        change("termsAccepted", event.target.checked)
                      }
                    />{" "}
                    I accept the Terms
                  </label>
                  <label className="sa-toggle">
                    <input
                      type="checkbox"
                      checked={client.privacyAccepted}
                      onChange={(event) =>
                        change("privacyAccepted", event.target.checked)
                      }
                    />{" "}
                    I accept the Privacy Policy
                  </label>
                  <label className="sa-toggle">
                    <input
                      type="checkbox"
                      checked={client.dataProcessingConsent}
                      onChange={(event) =>
                        change("dataProcessingConsent", event.target.checked)
                      }
                    />{" "}
                    I give Data Processing Consent
                  </label>
                  <label className="sa-toggle">
                    <input
                      type="checkbox"
                      checked={client.kycConsent}
                      onChange={(event) =>
                        change("kycConsent", event.target.checked)
                      }
                    />{" "}
                    KYC consent
                  </label>
                  <label className="sa-toggle">
                    <input
                      type="checkbox"
                      checked={client.marketingConsent}
                      onChange={(event) =>
                        change("marketingConsent", event.target.checked)
                      }
                    />{" "}
                    Marketing consent
                  </label>
                  </>
                )
              )}
            </div>
          </section>
          </div>
        </>
      </CatalogFormDialog>

      <DataTable
        headings={["Client", "Workspace", "Riders", "Status", "Actions"]}
        columnFilters={[
          { type: "text" },
          { type: "text" },
          { type: "number" },
          { type: "select" },
          null,
        ]}
        rows={clients.map((item: Item) => [
          item.name,
          item.companyCode ?? item.slug,
          item._count?.riders ?? 0,
          item.status ?? (item.isActive ? "ACTIVE" : "INACTIVE"),
          item.status === "DRAFT" ? (
            <span className="sa-client-actions" key={item.id}>
              <button type="button" onClick={(event) => void editClient(item.id, event.currentTarget)}>
                Edit & resume
              </button>
            </span>
          ) : item.status === "PENDING_APPROVAL" ? (
            <span className="sa-client-actions" key={item.id}>
              <button type="button" onClick={() => void approveClient(item.id)}>
                Approve
              </button>
              <button
                type="button"
                className="danger"
                onClick={() => void rejectClient(item.id)}
              >
                Reject
              </button>
            </span>
          ) : item.status === "ACTIVE" ? (
            <span className="sa-client-actions" key={item.id}>
              <button
                type="button"
                onClick={(event) =>
                  void editClient(item.id, event.currentTarget)
                }
              >
                Edit client
              </button>
              <ClientCommercialSettings clientId={item.id} clientName={item.name} />
              <ClientDomainSettings clientId={item.id} clientName={item.name} />
            </span>
          ) : (
            "—"
          ),
        ])}
      />
    </>
  );
}
function TextFields({
  value,
  change,
  fields,
  requiredKeys,
  inputTypes,
  softWarnings,
  disabledKeys,
}: {
  value: Item;
  change: (key: string, value: string) => void;
  fields: string[][];
  requiredKeys?: string[];
  inputTypes?: Record<string, "email" | "tel" | "url">;
  softWarnings?: Record<string, string>;
  disabledKeys?: string[];
}) {
  const defaultRequiredFields = [
    "code",
    "name",
    "displayName",
    "businessFleetName",
    "companyCode",
    "legalCompanyName",
    "legalEntityName",
    "setupFee",
    "maxFleets",
    "maxRiders",
    "maxAdmins",
    "maxFleetManagers",
    "maxHubs",
    "maxTeamLeaders",
    "maxClusterManagers",
    "maxUsers",
    "pan",
    "estimatedFleetSize",
    "estimatedRiderCount",
    "numberOfFleets",
    "approximateRiderCount",
    "primaryContactName",
    "primaryDesignation",
    "primaryContactMobile",
    "primaryContactEmail",
    "primaryMobile",
    "primaryEmail",
    "adminName",
    "adminEmail",
    "adminMobile",
    "registeredAddressLine1",
    "city",
    "district",
    "state",
    "pinCode",
    "startDate",
    "effectiveFrom",
    "billingUnit",
    "billingContactName",
    "billingEmail",
    "authorizedSignatoryName",
    "signatoryDesignation",
  ];
  const required = new Set(requiredKeys ?? defaultRequiredFields);
  return (
    <>
      {fields.map(([key, label]) => {
        const normalizedKey = key.toLowerCase();
        const isRequired = required.has(key);
        return (
          <label key={key}>
            <span className="sa-label-text">
              {label}
              {isRequired && <span className="sa-required-star">*</span>}
            </span>
            <input
              value={value[key] ?? ""}
              type={
                inputTypes?.[key] ??
                (normalizedKey.includes("date") ||
                normalizedKey.includes("effective")
                  ? "date"
                  : normalizedKey.includes("price") ||
                      normalizedKey.includes("charge") ||
                      normalizedKey.includes("fee") ||
                      normalizedKey.startsWith("max") ||
                      key === "discountValue"
                    ? "number"
                    : "text")
              }
              step={
                normalizedKey.includes("price") ||
                normalizedKey.includes("charge") ||
                normalizedKey.includes("fee")
                  ? "0.0001"
                  : normalizedKey.startsWith("max")
                    ? "1"
                    : undefined
              }
              min={
                normalizedKey.includes("price") ||
                normalizedKey.includes("charge") ||
                normalizedKey.includes("fee") ||
                normalizedKey.startsWith("max")
                  ? 0
                  : undefined
              }
              onChange={(event) => change(key, event.target.value)}
              required={isRequired}
              disabled={disabledKeys?.includes(key)}
            />
            {softWarnings?.[key] && (
              <small className="sa-field-warning">{softWarnings[key]}</small>
            )}
          </label>
        );
      })}
    </>
  );
}
function PackageLimitFields({
  value,
  change,
}: {
  value: Item;
  change: (key: string, value: string) => void;
}) {
  return (
    <section className="sa-package-limits" aria-label="Package limits">
      <p>Package limits</p>
      <div>
        {packageLimitFields.map(([key, label]) => {
          const unlimited = isUnlimitedPackageLimit(value[key]);
          return (
            <label key={key}>
              <span className="sa-label-text">
                {label} <span className="sa-required-star">*</span>
              </span>
              <span className="sa-package-limit-control">
                {unlimited ? (
                  <output className="sa-package-limit-unlimited">Unlimited</output>
                ) : (
                  <input
                    aria-label={`${label} limit`}
                    min="0"
                    required
                    step="1"
                    type="number"
                    value={value[key] ?? ""}
                    onChange={(event) => change(key, event.target.value)}
                  />
                )}
                <span className="sa-toggle">
                  <input
                    aria-label={`${label} is unlimited`}
                    checked={unlimited}
                    type="checkbox"
                    onChange={(event) =>
                      change(
                        key,
                        event.target.checked
                          ? String(PACKAGE_UNLIMITED_LIMIT)
                          : "0",
                      )
                    }
                  />
                  Unlimited
                </span>
              </span>
            </label>
          );
        })}
      </div>
    </section>
  );
}

function Select({
  label = "Selection",
  value,
  change,
  options,
  allowEmpty = false,
  required = false,
}: {
  label?: string;
  value: string;
  change: (value: string) => void;
  options: string[];
  allowEmpty?: boolean;
  required?: boolean;
}) {
  return (
    <label>
      <span className="sa-label-text">
        {label}
        {required && <span className="sa-required-star">*</span>}
      </span>
      <select
        required={required}
        value={value}
        onChange={(event) => change(event.target.value)}
      >
        {(allowEmpty || label.toLowerCase() !== "status") && (
          <option value="">Select {label.toLowerCase()}</option>
        )}
        {options.map((option) => (
          <option key={option} value={option}>
            {enumLabel(option)}
          </option>
        ))}
      </select>
    </label>
  );
}

function enumLabel(value: string) {
  const labels: Record<string, string> = {
    LOGISTICS: "Logistics",
    LAST_MILE: "Last-mile",
    DELIVERY: "Delivery",
    MOBILITY: "Mobility",
    RENTAL: "Rental",
    OTHER: "Other",
    PVT_LTD: "Pvt Ltd",
    DRIVER_OWNED: "Driver Owned",
    FLEET_OWNER: "Fleet Owner",
    FLEET_OPERATOR: "Fleet Operator",
    LOGISTICS_COMPANY: "Logistics Company",
    DELIVERY_PARTNER: "Delivery Partner",
    LEASING_COMPANY: "Leasing Company",
    VEHICLE_AGGREGATOR: "Vehicle Aggregator",
  };
  return (
    labels[value] ??
    value
      .toLowerCase()
      .split("_")
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ")
  );
}
function BulkImportWorkspace({
  entity,
  title,
  requiredColumns,
  history,
  busy,
  onBack,
  onDownloadTemplate,
  onUpload,
}: {
  entity: BulkImportEntity;
  title: string;
  requiredColumns: string;
  history: BulkImportHistoryEntry[];
  busy: boolean;
  onBack: () => void;
  onDownloadTemplate: () => void;
  onUpload: (file: File) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const downloadFailureReport = (entry: BulkImportHistoryEntry) => {
    const csv = [
      "file_name,outcome,failure_reason",
      [entry.fileName, entry.status, entry.error ?? "Row-level validation failed."]
        .map((value) => `"${value.replaceAll('"', '""')}"`)
        .join(","),
    ].join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `${entity}-failed-records.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };
  return (
    <section className="sa-bulk-workspace">
      <div className="sa-bulk-workspace-head">
        <button className="secondary" type="button" onClick={onBack}>
          ← Back to {title}
        </button>
        <div>
          <p className="sa-eyebrow">PLATFORM DATA IMPORT</p>
          <h2>Bulk import {title}</h2>
          <p>Use the template to add master data safely and consistently.</p>
        </div>
        <button className="secondary" type="button" onClick={onDownloadTemplate}>
          Download template
        </button>
      </div>

      <div className="sa-bulk-workspace-body has-history">
      <section className="sa-bulk-upload-card">
        <div>
          <p className="sa-eyebrow">{history.length ? "IMPORT ANOTHER FILE" : "GET STARTED"}</p>
          <h3>Upload a CSV</h3>
          <p>Required columns: {requiredColumns}.</p>
          <p className="sa-bulk-help">CSV only · Maximum 5 MB · Files are validated before records are saved.</p>
        </div>
        <label className="sa-bulk-file-picker">
          <span>{file ? file.name : "Choose CSV file"}</span>
          <input
            type="file"
            accept=".csv,text/csv"
            onChange={(event) => setFile(event.currentTarget.files?.[0] ?? null)}
          />
        </label>
        <div className="sa-bulk-upload-actions">
          <button className="secondary" type="button" onClick={onDownloadTemplate}>
            Download template
          </button>
          <button
            type="button"
            disabled={!file || busy}
            onClick={() => file && onUpload(file)}
          >
            {busy ? "Importing…" : `Import ${title}`}
          </button>
        </div>
      </section>
      <section className="sa-bulk-history">
          <div className="sa-bulk-section-head">
            <div>
              <h3>Import history</h3>
              <p>Previous uploads for {title}.</p>
            </div>
            <span>{history.length} upload{history.length === 1 ? "" : "s"}</span>
          </div>
          <DataTable
            headings={["Imported on", "File name", "Outcome", "Records", ""]}
            rows={history.map((entry) => [
              new Date(entry.createdAt).toLocaleString(),
              entry.fileName,
              <span key="status" className={`sa-import-status ${entry.status.toLowerCase()}`}>
                {entry.status === "PARTIAL_PASS" ? "Partial pass" : entry.status === "PASS" ? "Passed" : "Failed"}
              </span>,
              `${entry.passedRows} / ${entry.totalRows}`,
              entry.status !== "PASS" ? (
                <button key="failures" type="button" className="secondary" onClick={() => downloadFailureReport(entry)}>
                  Download failures
                </button>
              ) : "—",
            ])}
          />
        </section>
      </div>
    </section>
  );
}

function PackageAddOnsView({
  packages,
  featureAddOns,
  token,
}: {
  packages: Item[];
  featureAddOns: Item[];
  token: string;
}) {
  const activePackages = packages.filter((item) => item.isActive);
  const [packageId, setPackageId] = useState("");
  const [availableAddOnIds, setAvailableAddOnIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!packageId && activePackages[0]?.id) setPackageId(activePackages[0].id);
  }, [activePackages, packageId]);

  const loadAvailability = useCallback(async () => {
    if (!packageId) {
      setAvailableAddOnIds([]);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const available = await request(
        `/platform/commercial/feature-addons?packageId=${encodeURIComponent(packageId)}`,
        {},
        token,
      );
      setAvailableAddOnIds(
        available.map((item: Item) => item.featureAddOn?.id ?? item.featureAddOnId),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to load Package Add-Ons.");
    } finally {
      setLoading(false);
    }
  }, [packageId, token]);

  useEffect(() => {
    if (packageId) void loadAvailability();
  }, [packageId, loadAvailability]);

  const setAvailability = async (addOnId: string, isAvailable: boolean) => {
    if (!packageId) return;
    setLoading(true);
    setError("");
    try {
      await request(
        `/platform/commercial/packages/${packageId}/feature-addons/${addOnId}`,
        { method: "PUT", body: JSON.stringify({ isAvailable }) },
        token,
      );
      setAvailableAddOnIds((current) =>
        isAvailable
          ? [...new Set([...current, addOnId])]
          : current.filter((id) => id !== addOnId),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to update Package Add-On availability.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <section className="sa-page-head">
        <div>
          <h2>Package Add-Ons</h2>
          <p>Control which active Feature Add-Ons clients can purchase with each Package.</p>
        </div>
      </section>
      <section className="sa-management oem-table-only">
        <label className="sa-client-picker">
          Package
          <select value={packageId} onChange={(event) => setPackageId(event.target.value)}>
            <option value="">Select Package</option>
            {activePackages.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </label>
        {error && <p className="error" role="alert">{error}</p>}
        {packageId && featureAddOns.length ? (
          <DataTable
            headings={["Code", "Feature", "Quantity", "Sale price", "Validity", "Available"]}
            columnFilters={[{ type: "text" }, { type: "select" }, { type: "number" }, { type: "text" }, { type: "text" }, null]}
            nonSortableColumns={[5]}
            rows={featureAddOns.map((item) => {
              const available = availableAddOnIds.includes(item.id);
              return [
                item.code,
                item.feature?.name ?? "—",
                item.quantity,
                `${item.currency} ${item.salePrice}`,
                item.validityDays ? `${item.validityDays} days` : "No expiry",
                <label className="sa-toggle" key={`availability-${item.id}`}>
                  <input
                    type="checkbox"
                    checked={available}
                    disabled={loading || !item.isActive}
                    onChange={(event) => void setAvailability(item.id, event.target.checked)}
                  />
                  {available ? "Available" : "Unavailable"}
                </label>,
              ];
            })}
          />
        ) : packageId && !loading ? (
          <section className="sa-empty-catalog"><h3>No Feature Add-Ons yet</h3><p>Create a Feature Add-On before making it available to a Package.</p></section>
        ) : null}
      </section>
    </>
  );
}

function PackageTierPricingView({
  packages,
  token,
}: {
  packages: Item[];
  token: string;
}) {
  const activePackages = packages.filter((item) => item.isActive);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const [packageId, setPackageId] = useState("");
  const [tiers, setTiers] = useState<Item[]>([]);
  const [editing, setEditing] = useState<Item | null>(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState<Item>({
    minVehicles: "1",
    maxVehicles: "",
    pricePerVehicle: "",
    currency: "INR",
    billingPeriod: "MONTHLY",
    tierMode: "VOLUME",
    effectiveFrom: new Date().toISOString().slice(0, 10),
    effectiveTo: "",
    isActive: true,
  });

  useEffect(() => {
    if (!packageId && activePackages[0]?.id) setPackageId(activePackages[0].id);
  }, [activePackages, packageId]);

  const loadTiers = useCallback(async () => {
    if (!packageId) {
      setTiers([]);
      return;
    }
    setLoading(true);
    setError("");
    try {
      setTiers(await request(`/platform/commercial/packages/${packageId}/vehicle-tiers`, {}, token));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to load Package Tier Pricing.");
    } finally {
      setLoading(false);
    }
  }, [packageId, token]);

  useEffect(() => {
    if (packageId) void loadTiers();
  }, [packageId, loadTiers]);

  const openForm = (trigger: HTMLButtonElement, item?: Item) => {
    triggerRef.current = trigger;
    setError("");
    setEditing(item ?? null);
    setForm(item ? {
      minVehicles: String(item.minVehicles),
      maxVehicles: item.maxVehicles === null ? "" : String(item.maxVehicles),
      pricePerVehicle: String(item.pricePerVehicle),
      currency: item.currency,
      billingPeriod: item.billingPeriod,
      tierMode: item.tierMode,
      effectiveFrom: item.effectiveFrom.slice(0, 10),
      effectiveTo: item.effectiveTo ? item.effectiveTo.slice(0, 10) : "",
      isActive: item.isActive,
    } : {
      minVehicles: "1", maxVehicles: "", pricePerVehicle: "", currency: "INR", billingPeriod: "MONTHLY", tierMode: "VOLUME", effectiveFrom: new Date().toISOString().slice(0, 10), effectiveTo: "", isActive: true,
    });
    setOpen(true);
  };

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!packageId) return;
    setLoading(true);
    setError("");
    try {
      const payload = {
        minVehicles: Number(form.minVehicles),
        ...(form.maxVehicles ? { maxVehicles: Number(form.maxVehicles) } : {}),
        pricePerVehicle: Number(form.pricePerVehicle),
        currency: form.currency,
        billingPeriod: form.billingPeriod,
        tierMode: form.tierMode,
        effectiveFrom: form.effectiveFrom,
        ...(form.effectiveTo ? { effectiveTo: form.effectiveTo } : {}),
        isActive: Boolean(form.isActive),
      };
      await request(
        editing ? `/platform/commercial/vehicle-tiers/${editing.id}` : `/platform/commercial/packages/${packageId}/vehicle-tiers`,
        { method: editing ? "PUT" : "POST", body: JSON.stringify(payload) },
        token,
      );
      setOpen(false);
      await loadTiers();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to save Package Tier Pricing.");
    } finally {
      setLoading(false);
    }
  };

  const deactivate = async (tier: Item) => {
    setLoading(true);
    setError("");
    try {
      await request(`/platform/commercial/vehicle-tiers/${tier.id}`, { method: "DELETE" }, token);
      await loadTiers();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to deactivate Package Tier Pricing.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <section className="sa-page-head">
        <div><h2>Package Tier Pricing</h2><p>Set the recurring per-vehicle price for each Package fleet-size range.</p></div>
        <div className="sa-actions"><button disabled={!packageId} onClick={(event) => openForm(event.currentTarget)}>+ Add Vehicle Tier</button></div>
      </section>
      <section className="sa-management oem-table-only">
        <label className="sa-client-picker">Package<select value={packageId} onChange={(event) => setPackageId(event.target.value)}><option value="">Select Package</option>{activePackages.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        {error && <p className="error" role="alert">{error}</p>}
        <CatalogFormDialog
          open={open}
          title={editing ? "Edit Vehicle Tier" : "Add Vehicle Tier"}
          description="Define one effective per-vehicle price for a fleet-size range. Leave the maximum empty for an open-ended range."
          error={error}
          busy={loading}
          triggerRef={triggerRef}
          onClose={() => { setError(""); setOpen(false); }}
          onDialogClose={() => setOpen(false)}
          onSubmit={save}
          actions={<><button type="button" className="secondary" disabled={loading} onClick={() => setOpen(false)}>Cancel</button><button type="submit" disabled={loading}>{editing ? "Save changes" : "Add Vehicle Tier"}</button></>}
        >
          <TextFields
            value={form}
            change={(key, value) => setForm((current) => ({ ...current, [key]: value }))}
            fields={[["minVehicles", "Minimum vehicles"], ["maxVehicles", "Maximum vehicles (optional)"], ["pricePerVehicle", "Price per vehicle"], ["effectiveFrom", "Effective from"], ["effectiveTo", "Effective to"]]}
            requiredKeys={["minVehicles", "pricePerVehicle", "effectiveFrom"]}
          />
          <label>Currency<select value={form.currency} onChange={(event) => setForm((current) => ({ ...current, currency: event.target.value }))}><option value="INR">INR</option></select></label>
          <label>Billing period<select value={form.billingPeriod} onChange={(event) => setForm((current) => ({ ...current, billingPeriod: event.target.value }))}>{billingCycles.map((cycle) => <option key={cycle} value={cycle}>{enumLabel(cycle)}</option>)}</select></label>
          <label>Pricing mode<select value={form.tierMode} onChange={(event) => setForm((current) => ({ ...current, tierMode: event.target.value }))}><option value="VOLUME">Volume</option></select></label>
          <label className="sa-toggle"><input type="checkbox" checked={form.isActive} onChange={(event) => setForm((current) => ({ ...current, isActive: event.target.checked }))} /> Active tier</label>
        </CatalogFormDialog>
        {packageId && tiers.length ? (
          <DataTable
            headings={["Minimum vehicles", "Maximum vehicles", "Price per vehicle", "Billing period", "Effective period", "Status", "", ""]}
            columnFilters={[{ type: "number" }, { type: "number" }, { type: "text" }, { type: "select" }, { type: "text" }, { type: "select" }, null, null]}
            rows={tiers.map((tier) => [tier.minVehicles, tier.maxVehicles ?? "Unlimited", `${tier.currency} ${tier.pricePerVehicle}`, enumLabel(tier.billingPeriod), `${new Date(tier.effectiveFrom).toLocaleDateString()}${tier.effectiveTo ? ` – ${new Date(tier.effectiveTo).toLocaleDateString()}` : " onward"}`, tier.isActive ? "ACTIVE" : "INACTIVE", <button key="edit" className="secondary" onClick={(event) => openForm(event.currentTarget, tier)}>Edit</button>, tier.isActive ? <button key="deactivate" className="danger" disabled={loading} onClick={() => void deactivate(tier)}>Deactivate</button> : "—"])}
          />
        ) : packageId && !loading ? <section className="sa-empty-catalog"><h3>No vehicle tiers yet</h3><p>Add a tier before offering this Package to clients.</p></section> : null}
      </section>
    </>
  );
}

function PackageFeaturesView({
  packages,
  features,
  token,
  onSaved,
  onDelete,
}: {
  packages: Item[];
  features: Item[];
  token: string;
  onSaved: () => void;
  onDelete: (path: string, label: string) => void;
}) {
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const [editing, setEditing] = useState<Item | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState<Item>({
    packageId: "",
    featureId: "",
    isIncluded: true,
    isUnlimited: false,
    includedQuantity: "",
    resetPeriod: "NONE",
    rolloverAllowed: false,
    displayOrder: "0",
    configuration: "",
  });
  const links = packages.flatMap((pack) =>
    (pack.features ?? []).map((link: Item) => ({ ...link, package: pack })),
  );
  const openForm = (trigger: HTMLButtonElement, item?: Item) => {
    triggerRef.current = trigger;
    setError("");
    setEditing(item ?? null);
    setForm(
      item
        ? {
            packageId: item.packageId,
            featureId: item.featureId,
            isIncluded: item.isIncluded,
            isUnlimited: item.isUnlimited,
            includedQuantity: item.includedQuantity ?? "",
            resetPeriod: item.resetPeriod ?? "NONE",
            rolloverAllowed: item.rolloverAllowed ?? false,
            displayOrder: String(item.displayOrder ?? 0),
            configuration: item.configuration
              ? JSON.stringify(item.configuration, null, 2)
              : "",
          }
        : {
            packageId: "",
            featureId: "",
            isIncluded: true,
            isUnlimited: false,
            includedQuantity: "",
            resetPeriod: "NONE",
            rolloverAllowed: false,
            displayOrder: String(links.length),
            configuration: "",
          },
    );
    setOpen(true);
  };
  const close = () => {
    setError("");
    setOpen(false);
  };
  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    let configuration: Record<string, unknown> | undefined;
    try {
      configuration = form.configuration ? JSON.parse(form.configuration) : undefined;
    } catch {
      setError("Feature configuration must be valid JSON.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const payload = {
        ...(!editing ? { packageId: form.packageId, featureId: form.featureId } : {}),
        isIncluded: Boolean(form.isIncluded),
        isUnlimited: Boolean(form.isUnlimited),
        resetPeriod: form.resetPeriod,
        rolloverAllowed: Boolean(form.rolloverAllowed),
        displayOrder: Number(form.displayOrder || 0),
        ...(form.includedQuantity !== ""
          ? { includedQuantity: Number(form.includedQuantity) }
          : {}),
        ...(configuration ? { configuration } : {}),
      };
      await request(
        editing
          ? `/platform/package-features/${editing.id}`
          : "/platform/package-features",
        { method: editing ? "PUT" : "POST", body: JSON.stringify(payload) },
        token,
      );
      close();
      onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to save Package Feature.");
    } finally {
      setBusy(false);
    }
  };
  const removeLink = (item: Item) =>
    onDelete(
      `/platform/package-features/${item.id}`,
      `${item.feature?.name ?? "Feature"} from ${item.package?.name ?? "Package"}`,
    );
  const assignedToSelectedPackage = new Set(
    links.filter((link) => link.packageId === form.packageId).map((link) => link.featureId),
  );
  return (
    <>
      <section className="sa-page-head">
        <div>
          <h2>Package Feature</h2>
          <p>
            Add and manage the Features supplied by each Package.
          </p>
        </div>
        <div className="sa-actions">
          <button onClick={(event) => openForm(event.currentTarget)}>
            + Add Package Feature
          </button>
        </div>
      </section>
      <CatalogFormDialog
        open={open}
        title={editing ? "Edit Package Feature" : "Add Package Feature"}
        description="Feature assignment is managed independently from Package details."
        error={error}
        busy={busy}
        triggerRef={triggerRef}
        onClose={close}
        onDialogClose={() => setOpen(false)}
        onSubmit={save}
        actions={<><button type="button" className="secondary" onClick={close} disabled={busy}>Cancel</button><button type="submit" disabled={busy}>{editing ? "Save changes" : "Add Feature"}</button></>}
      >
        <label>
          <span className="sa-label-text">
            Package <span className="sa-required-star">*</span>
          </span>
          <select disabled={Boolean(editing)} value={form.packageId} onChange={(event) => setForm((current) => ({ ...current, packageId: event.target.value, featureId: "" }))} required>
            <option value="">Select Package</option>
            {packages.filter((item) => item.isActive).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </label>
        <label>
          <span className="sa-label-text">
            Feature <span className="sa-required-star">*</span>
          </span>
          <select disabled={Boolean(editing) || !form.packageId} value={form.featureId} onChange={(event) => setForm((current) => ({ ...current, featureId: event.target.value }))} required>
            <option value="">Select Feature</option>
            {features.filter((item) => item.isActive && (editing?.featureId === item.id || !assignedToSelectedPackage.has(item.id))).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </label>
        <div className="sa-feature-fields">
          <label className="sa-toggle"><input type="checkbox" checked={form.isIncluded} onChange={(event) => setForm((current) => ({ ...current, isIncluded: event.target.checked }))} /> Included in package</label>
          <label className="sa-toggle"><input type="checkbox" checked={form.isUnlimited} onChange={(event) => setForm((current) => ({ ...current, isUnlimited: event.target.checked }))} /> Unlimited usage</label>
          <label>Included quantity<input type="number" min="0" step="1" value={form.includedQuantity} onChange={(event) => setForm((current) => ({ ...current, includedQuantity: event.target.value }))} /></label>
          <label>Allowance reset<select value={form.resetPeriod} onChange={(event) => setForm((current) => ({ ...current, resetPeriod: event.target.value }))}>{allowanceResetPeriods.map((period) => <option key={period} value={period}>{period === "NONE" ? "No reset" : enumLabel(period)}</option>)}</select></label>
          <label className="sa-toggle"><input type="checkbox" checked={form.rolloverAllowed} onChange={(event) => setForm((current) => ({ ...current, rolloverAllowed: event.target.checked }))} /> Allow unused credits to roll over</label>
          <label>Display order<input type="number" min="0" step="1" value={form.displayOrder} onChange={(event) => setForm((current) => ({ ...current, displayOrder: event.target.value }))} /></label>
        </div>
        <label>Feature configuration (optional JSON)<textarea value={form.configuration} placeholder={'{"workflow":"standard"}'} onChange={(event) => setForm((current) => ({ ...current, configuration: event.target.value }))} /></label>
      </CatalogFormDialog>
      {error && !open ? <p className="error">{error}</p> : null}
      <section className="sa-management oem-table-only">
        {links.length ? (
          <DataTable
            headings={[
              "Package",
              "Feature",
              "Included",
              "Allowance reset",
              "Status",
              "",
              "",
            ]}
            columnFilters={[
              { type: "text" },
              { type: "text" },
              null,
              { type: "text" },
              { type: "select" },
              null,
              null,
            ]}
            nonSortableColumns={[2]}
            rows={links.map((link) => [
                link.package?.name ?? "—",
                link.feature?.name ?? "—",
                link.isUnlimited
                  ? "Unlimited"
                  : (link.includedQuantity ?? "0"),
                link.resetPeriod ?? "NONE",
                link.isIncluded ? "INCLUDED" : "NOT INCLUDED",
                <button key="edit" className="secondary" onClick={(event) => openForm(event.currentTarget, link)}>Edit</button>,
                <button key="delete" className="danger" onClick={() => void removeLink(link)}>Delete</button>,
              ])}
          />
        ) : (
          <section className="sa-empty-catalog">
            <h3>No Package Features yet</h3>
            <p>
            Add Features to a Package to configure its entitlements.
            </p>
          </section>
        )}
      </section>
    </>
  );
}

const TABLE_CELL_LINE_LIMIT = 80;

function renderTableCellContent(cell: ReactNode) {
  if (typeof cell !== "string" || cell.length <= TABLE_CELL_LINE_LIMIT) {
    return cell;
  }

  const lines: string[] = [];
  let currentLine = "";

  for (const word of cell.trim().split(/\s+/)) {
    if (
      currentLine.length > 0 &&
      currentLine.length + word.length + 1 > TABLE_CELL_LINE_LIMIT
    ) {
      lines.push(currentLine);
      currentLine = word;
    } else {
      currentLine = currentLine ? `${currentLine} ${word}` : word;
    }
  }

  if (currentLine) {
    lines.push(currentLine);
  }

  return lines.map((line, index) => (
    <span key={`${index}-${line}`}>
      {line}
      {index < lines.length - 1 && <br />}
    </span>
  ));
}

function DataTable({
  headings,
  rows,
  columnFilters = [],
  nonSortableColumns = [],
  columnFiltersMinimumRows = 10,
  disablePageSizeAtOrBelow = 10,
}: {
  headings: string[];
  rows: any[][];
  columnFilters?: readonly ColumnFilterSpec[];
  nonSortableColumns?: readonly number[];
  columnFiltersMinimumRows?: number;
  disablePageSizeAtOrBelow?: number;
}) {
  const { t } = useLocale();
  const [pageSize, setPageSize] = useState(10);
  const searchId = useId();
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [columnFilterStates, setColumnFilterStates] =
    useState<ColumnFilterStateMap>({});
  const [columnFilterSearches, setColumnFilterSearches] = useState<
    Record<number, string>
  >({});
  const [openColumnFilter, setOpenColumnFilter] = useState<number | null>(
    null,
  );
  const [sort, setSort] = useState<{
    columnIndex: number;
    direction: "ascending" | "descending";
  } | null>(null);
  const normalizedQuery = query.trim().toLowerCase();
  const filteredRows = normalizedQuery
    ? rows.filter((row) =>
        row.some(
          (cell) =>
            (typeof cell === "string" || typeof cell === "number") &&
            String(cell).toLowerCase().includes(normalizedQuery),
        ),
      )
    : rows;
  const effectiveColumnFilters =
    rows.length > columnFiltersMinimumRows
      ? columnFilters.map((filter, columnIndex) =>
          headings[columnIndex]?.trim().toLowerCase() === "description"
            ? null
            : filter,
        )
      : [];
  const columnFilterResult = filterRows(
    filteredRows,
    effectiveColumnFilters,
    columnFilterStates,
  );
  const filteredColumnRows = columnFilterResult.rows;
  const activeFilterCount = columnFilterResult.activeCount;
  const sortedRows = sort
    ? filteredColumnRows
        .map((row, index) => ({ row, index }))
        .sort((left, right) => {
          const leftValue = left.row[sort.columnIndex];
          const rightValue = right.row[sort.columnIndex];
          const leftMissing =
            leftValue === null ||
            leftValue === undefined ||
            (typeof leftValue === "string" &&
              (leftValue.trim().length === 0 || leftValue === "—")) ||
            (typeof leftValue !== "string" && typeof leftValue !== "number") ||
            (typeof leftValue === "number" && Number.isNaN(leftValue));
          const rightMissing =
            rightValue === null ||
            rightValue === undefined ||
            (typeof rightValue === "string" &&
              (rightValue.trim().length === 0 || rightValue === "—")) ||
            (typeof rightValue !== "string" && typeof rightValue !== "number") ||
            (typeof rightValue === "number" && Number.isNaN(rightValue));
          let comparison = 0;
          if (leftMissing !== rightMissing) {
            comparison = leftMissing ? 1 : -1;
          } else if (!leftMissing && !rightMissing) {
            comparison =
              typeof leftValue === "number" &&
              typeof rightValue === "number"
                ? leftValue - rightValue
                : String(leftValue).localeCompare(String(rightValue), undefined, {
                    numeric: true,
                    sensitivity: "base",
                  });
          }
          if (comparison === 0) return left.index - right.index;
          return sort.direction === "ascending" ? comparison : -comparison;
        })
        .map(({ row }) => row)
    : filteredColumnRows;
  const pageCount = Math.max(1, Math.ceil(sortedRows.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const pageRows = sortedRows.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize,
  );
  const hasColumnFilters = effectiveColumnFilters.some(Boolean);
  const updateColumnFilter = (
    columnIndex: number,
    state: ColumnFilterState,
  ) => {
    setColumnFilterStates((current) => ({
      ...current,
      [columnIndex]: state,
    }));
    setPage(1);
  };
  const clearColumnFilter = (columnIndex: number) => {
    updateColumnFilter(columnIndex, {});
    setColumnFilterSearches((current) => ({ ...current, [columnIndex]: "" }));
    setOpenColumnFilter(null);
  };
  const renderColumnFilter = (columnIndex: number, mobile: boolean) => {
    const spec = effectiveColumnFilters[columnIndex];
    if (!spec) return null;
    const heading = headings[columnIndex] || `Column ${columnIndex + 1}`;
    const state = columnFilterStates[columnIndex] ?? {};
    const id = `${searchId}-filter-${columnIndex}-${mobile ? "mobile" : "desktop"}`;
    if (spec.type === "text" || spec.type === "select") {
      const selectedValues = state.values ??
        (state.text ? [state.text] : state.value ? [state.value] : []);
      const filterQuery = columnFilterSearches[columnIndex] ?? "";
      const allOptions =
        spec.type === "select"
          ? getSelectOptions(rows, columnIndex, spec)
          : getColumnFilterOptions(rows, columnIndex);
      const options = allOptions.filter((option) =>
        String(option).toLowerCase().includes(filterQuery.trim().toLowerCase()),
      );
      const toggleValue = (value: string) => {
        const nextValues = selectedValues.includes(value)
          ? selectedValues.filter((selected) => selected !== value)
          : [...selectedValues, value];
        updateColumnFilter(columnIndex, { values: nextValues });
      };
      return (
        <div className="sa-table-filter-field sa-table-multiselect">
          <span>Filter by {heading}</span>
          <div className="sa-table-multiselect-control">
            <input
              id={id}
              type="search"
              value={filterQuery}
              placeholder={`Select ${heading}`}
              aria-label={`Search ${heading} filter options`}
              aria-expanded={openColumnFilter === columnIndex}
              onFocus={() => setOpenColumnFilter(columnIndex)}
              onChange={(event) => {
                const value = event.currentTarget.value;
                setColumnFilterSearches((current) => ({
                  ...current,
                  [columnIndex]: value,
                }));
                setOpenColumnFilter(columnIndex);
              }}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.currentTarget.blur();
                  setOpenColumnFilter(null);
                }
              }}
            />
            <button
              type="button"
              className="sa-table-filter-toggle"
              aria-label={`${openColumnFilter === columnIndex ? "Hide" : "Show"} ${heading} filter options`}
              aria-expanded={openColumnFilter === columnIndex}
              onClick={() =>
                setOpenColumnFilter((current) =>
                  current === columnIndex ? null : columnIndex,
                )
              }
            >
              {openColumnFilter === columnIndex ? "⌃" : "⌄"}
            </button>
            {selectedValues.length > 0 && (
              <button
                type="button"
                className="sa-table-filter-clear-one"
                aria-label={`Clear ${heading} filter`}
                onClick={() => clearColumnFilter(columnIndex)}
              >
                ×
              </button>
            )}
          </div>
          {selectedValues.length > 0 && (
            <div className="sa-table-filter-values">
              {selectedValues.map((value) => (
                <button
                  type="button"
                  key={value}
                  aria-label={`Remove ${value} from ${heading} filter`}
                  onClick={() => toggleValue(value)}
                >
                  {value} ×
                </button>
              ))}
            </div>
          )}
          {openColumnFilter === columnIndex && (
            <div className="sa-table-filter-options" role="listbox" aria-label={`${heading} options`}>
              {options.length ? (
                options.map((option) => {
                  const value = String(option);
                  const selected = selectedValues.includes(value);
                  return (
                    <button
                      key={value}
                      type="button"
                      role="option"
                      aria-selected={selected}
                      className={selected ? "selected" : ""}
                      onClick={() => toggleValue(value)}
                    >
                      <span>{selected ? "✓" : ""}</span>
                      {value}
                    </button>
                  );
                })
              ) : (
                <span className="sa-table-filter-empty">No matches</span>
              )}
            </div>
          )}
        </div>
      );
    }
    const invalidRange = hasInvalidNumberRange(state);
    const minId = `${id}-min`;
    const maxId = `${id}-max`;
    return (
      <fieldset
        className="sa-table-filter-field sa-table-filter-number"
        aria-label={`Filter by ${heading}`}
      >
        <legend>Filter by {heading}</legend>
        <div className="sa-table-filter-range">
          <label htmlFor={minId}>
            <span>Minimum {heading}</span>
            <input
              id={minId}
              type="number"
              step="any"
              placeholder="Min"
              value={state.min ?? ""}
              aria-label={`Minimum ${heading}`}
              aria-invalid={invalidRange || undefined}
              onChange={(event) =>
                updateColumnFilter(columnIndex, {
                  ...state,
                  min: event.currentTarget.value,
                })
              }
            />
          </label>
          <label htmlFor={maxId}>
            <span>Maximum {heading}</span>
            <input
              id={maxId}
              type="number"
              step="any"
              placeholder="Max"
              value={state.max ?? ""}
              aria-label={`Maximum ${heading}`}
              aria-invalid={invalidRange || undefined}
              onChange={(event) =>
                updateColumnFilter(columnIndex, {
                  ...state,
                  max: event.currentTarget.value,
                })
              }
            />
          </label>
        </div>
        {invalidRange && (
          <span className="sa-table-filter-error" role="alert">
            Minimum must not exceed maximum.
          </span>
        )}
      </fieldset>
    );
  };

  return (
    <div>
      <div className="sa-table-toolbar">
        <div className="sa-table-search">
          <label htmlFor={searchId}>{t("Search this table")}</label>
          <div className="sa-table-search-control">
            <input
              id={searchId}
              ref={searchInputRef}
              type="search"
              value={query}
              placeholder={t("Search this table")}
              onChange={(event) => {
                setQuery(event.currentTarget.value);
                setPage(1);
              }}
            />
            {normalizedQuery && (
              <button
                type="button"
                className="secondary sa-table-search-clear"
                aria-label="Clear table search"
                onClick={() => {
                  setQuery("");
                  setPage(1);
                  searchInputRef.current?.focus();
                }}
              >
                {t("Clear")}
              </button>
            )}
          </div>
        </div>
        <div className="sa-table-toolbar-meta">
          <span
            className="sa-table-result-count"
            role="status"
            aria-live="polite"
          >
            {filteredColumnRows.length}{" "}
            {t(filteredColumnRows.length === 1 ? "result" : "results")}
          </span>
          <label className="sa-table-page-size">
            {t("Rows per page")}
            <select
              value={pageSize}
              disabled={
                disablePageSizeAtOrBelow !== undefined &&
                rows.length <= disablePageSizeAtOrBelow
              }
              onChange={(event) => {
                setPageSize(Number(event.currentTarget.value));
                setPage(1);
              }}
            >
              {[10, 25, 50, 100].map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
          </label>
          {activeFilterCount > 0 && (
            <button
              type="button"
              className="secondary sa-table-filter-clear"
              onClick={() => {
                setColumnFilterStates({});
                setPage(1);
              }}
            >
              {t("Clear all")} ({activeFilterCount})
            </button>
          )}
        </div>
      </div>
      {hasColumnFilters && (
        <details className="sa-table-filter-panel">
          <summary>
            {t("Filters")}{activeFilterCount ? ` (${activeFilterCount})` : ""}
          </summary>
          <div className="sa-table-filter-panel-fields">
            {headings.map((heading, columnIndex) => (
              <div key={`${heading}-${columnIndex}`}>
                {renderColumnFilter(columnIndex, true)}
              </div>
            ))}
            {activeFilterCount > 0 && (
              <button
                type="button"
                className="secondary sa-table-filter-clear"
                onClick={() => {
                  setColumnFilterStates({});
                  setPage(1);
                }}
              >
                {t("Clear all")} ({activeFilterCount})
              </button>
            )}
          </div>
        </details>
      )}
      <div className="sa-table-wrap">
        <table>
          <thead>
            <tr>
              {headings.map((heading, headingIndex) => {
                const normalizedHeading = heading.trim().toLowerCase();
                const isActionColumn =
                  normalizedHeading.length === 0 || normalizedHeading === "actions";
                const sortable =
                  normalizedHeading.length > 0 &&
                  normalizedHeading !== "description" &&
                  normalizedHeading !== "order" &&
                  normalizedHeading !== "display order" &&
                  !nonSortableColumns.includes(headingIndex);
                const active = sort?.columnIndex === headingIndex;
                const direction = active ? sort.direction : "none";
                const nextDirection =
                  active && sort.direction === "ascending"
                    ? "descending"
                    : "ascending";
                return (
                  <th
                    key={`${heading}-${headingIndex}`}
                    className={
                      isActionColumn ? "sa-table-action-cell" : undefined
                    }
                    aria-sort={sortable ? direction : undefined}
                  >
                    {sortable ? (
                      <button
                        type="button"
                        className="sa-table-sort"
                        aria-label={`Sort by ${heading} ${nextDirection}`}
                        title={`Sort by ${heading} ${nextDirection}`}
                        onClick={() => {
                          setSort((current) => ({
                            columnIndex: headingIndex,
                            direction:
                              current?.columnIndex === headingIndex &&
                              current.direction === "ascending"
                                ? "descending"
                                : "ascending",
                          }));
                          setPage(1);
                        }}
                      >
                        <span>{t(heading)}</span>
                        <span className="sa-table-sort-indicator" aria-hidden="true">
                          {active
                            ? sort.direction === "ascending"
                              ? "↑"
                              : "↓"
                            : "↕"}
                        </span>
                      </button>
                    ) : (
                      <span>{t(heading)}</span>
                    )}
                  </th>
                );
              })}
            </tr>
            {hasColumnFilters && (
              <tr className="sa-table-filter-row">
                {headings.map((heading, columnIndex) => (
                  <th key={`${heading}-${columnIndex}`}>
                    {renderColumnFilter(columnIndex, false)}
                  </th>
                ))}
              </tr>
            )}
          </thead>
          <tbody>
            {pageRows.length ? (
              pageRows.map((row, index) => (
                <tr key={(currentPage - 1) * pageSize + index}>
                  {row.map((cell, cellIndex) => (
                    <td
                      key={cellIndex}
                      className={
                        headings[cellIndex]?.trim().length === 0 ||
                        headings[cellIndex]?.trim().toLowerCase() === "actions"
                          ? "sa-table-action-cell"
                          : undefined
                      }
                    >
                      <div className="sa-table-cell-content">
                        {renderTableCellContent(cell)}
                      </div>
                    </td>
                  ))}
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={headings.length}>
                  {t(rows.length ? "No matching records." : "No records yet.")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {filteredColumnRows.length > pageSize && (
        <div className="sa-pagination" aria-label="Table pagination">
          <span>
            {t("Showing")} {(currentPage - 1) * pageSize + 1}–
            {Math.min(currentPage * pageSize, filteredColumnRows.length)} {t("of")}{" "}
            {filteredColumnRows.length}
          </span>
          <div>
            <button
              className="secondary"
              disabled={currentPage === 1}
              onClick={() => setPage((value) => Math.max(1, value - 1))}
            >
              {t("Previous")}
            </button>
            <span>
              {t("Page")} {currentPage} {t("of")} {pageCount}
            </span>
            <button
              className="secondary"
              disabled={currentPage === pageCount}
              onClick={() => setPage((value) => Math.min(pageCount, value + 1))}
            >
              {t("Next")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
