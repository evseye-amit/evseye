"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */

import { FormEvent, useCallback, useEffect, useState } from "react";
import Link from "next/link";

const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000/api/v1";
const ACCESS_TOKEN_KEY = "evs-eye-access-token";
const REFRESH_TOKEN_KEY = "evs-eye-refresh-token";
type Tab =
  | "dashboard"
  | "clients"
  | "oems"
  | "vehicleCategories"
  | "vehicleTypes"
  | "features"
  | "packages"
  | "pricing";
type Item = Record<string, any>;
type PricingTierInput = {
  tierOrder: string;
  fromQuantity: string;
  toQuantity: string;
  unitPrice: string;
  costPrice: string;
};
type PackageFeaturePricingInput = {
  featurePricingId: string;
  pricingModel: string;
  includedQuantity: string;
  unitPrice: string;
  minimumCharge: string;
  maximumCharge: string;
  effectiveFrom: string;
  effectiveTo: string;
  isActive: boolean;
};
type PackageFeatureInput = {
  featureId: string;
  enabled: boolean;
  includedQuantity: string;
  usageLimit: string;
  unlimitedUsage: boolean;
  configuration: string;
  displayOrder: string;
  pricing: PackageFeaturePricingInput[];
};

const featureCategories = [
  ["RIDER_ONBOARDING", "Rider Onboarding"],
  ["RIDER_VERIFICATION", "Rider Verification / KYC"],
  ["RIDER_TRAINING", "Rider Training"],
  ["RIDER_MANAGEMENT", "Rider Management"],
  ["ATTENDANCE", "Attendance & Workforce"],
  ["FACE_RECOGNITION", "Face Recognition"],
  ["FLEET_MANAGEMENT", "Fleet Management"],
  ["VEHICLE_MANAGEMENT", "Vehicle Management"],
  ["IOT_TELEMATICS", "IoT & Telematics"],
  ["TRACKING_GEOFENCING", "Tracking & Geofencing"],
  ["BATTERY_MANAGEMENT", "Battery Management"],
  ["SERVICE_MAINTENANCE", "Service & Maintenance"],
  ["MECHANIC_MANAGEMENT", "Mechanic Management"],
  ["SAFETY_COMPLIANCE", "Safety & Compliance"],
  ["ANALYTICS", "Analytics"],
  ["REPORTING", "Reports"],
  ["NOTIFICATION", "Notifications"],
  ["INTEGRATION", "Integrations"],
  ["API_ACCESS", "API Access"],
  ["USER_ACCESS", "Users & Access"],
  ["DOCUMENT_MANAGEMENT", "Document Management"],
  ["SUPPORT", "Support"],
  ["AI_AUTOMATION", "AI & Automation"],
] as const;
const featureTypes = ["BOOLEAN", "QUANTITY", "USAGE_BASED", "CONFIGURATION"];
const featureBillingUnits = [
  "VERIFICATION",
  "RIDER",
  "VEHICLE",
  "FLEET",
  "USER",
  "API_CALL",
  "FACE_SCAN",
  "TRAINING",
  "DEVICE",
  "MONTH",
];
const pricingModels = [
  "FREE",
  "INCLUDED",
  "FLAT_FEE",
  "PER_UNIT",
  "TIERED",
  "VOLUME",
  "PER_USER",
  "PER_RIDER",
  "PER_VEHICLE",
  "PER_FLEET",
  "USAGE_BASED",
  "ONE_TIME",
  "CUSTOM",
];

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
  energyType: "ELECTRIC",
  usageType: "",
  status: "ACTIVE",
};
const emptyPackage = {
  code: "",
  name: "",
  packageType: "STANDARD",
  monthlyPrice: "",
  yearlyPrice: "",
  currency: "INR",
  description: "",
  maxFleets: "",
  maxVehicles: "",
  maxRiders: "",
  maxUsers: "",
  trialDays: "0",
  displayOrder: "0",
  isDefault: false,
  isActive: true,
};
const emptyFeature = {
  code: "",
  name: "",
  description: "",
  category: "RIDER_ONBOARDING",
  featureType: "BOOLEAN",
  billingUnit: "MONTH",
  displayOrder: "0",
  isActive: true,
};
const emptyPricing = {
  featureId: "",
  pricingName: "",
  pricingModel: "PER_UNIT",
  billingUnit: "VERIFICATION",
  currency: "INR",
  basePrice: "0",
  unitPrice: "",
  costPrice: "0",
  minimumCharge: "",
  maximumCharge: "",
  setupFee: "0",
  billingCycle: "MONTHLY",
  taxInclusive: false,
  effectiveFrom: new Date().toISOString().slice(0, 10),
  effectiveTo: "",
  isActive: true,
  metadata: "",
  tiers: [] as PricingTierInput[],
};

const emptyPackageFeaturePricing = (): PackageFeaturePricingInput => ({
  featurePricingId: "",
  pricingModel: "PER_UNIT",
  includedQuantity: "0",
  unitPrice: "",
  minimumCharge: "",
  maximumCharge: "",
  effectiveFrom: new Date().toISOString().slice(0, 10),
  effectiveTo: "",
  isActive: true,
});

const emptyPackageFeature = (
  featureId: string,
  displayOrder: number,
): PackageFeatureInput => ({
  featureId,
  enabled: true,
  includedQuantity: "",
  usageLimit: "",
  unlimitedUsage: true,
  configuration: "",
  displayOrder: String(displayOrder),
  pricing: [],
});

function Metric({
  label,
  value,
  tone,
}: {
  label: string;
  value: string | number;
  tone: string;
}) {
  return (
    <article className="sa-metric">
      <span className={`sa-icon ${tone}`}>◈</span>
      <strong>{value}</strong>
      <small>{label}</small>
      <em>Live</em>
    </article>
  );
}

export default function SuperAdminDashboard() {
  const [token, setToken] = useState(() =>
    typeof window === "undefined"
      ? ""
      : (sessionStorage.getItem(ACCESS_TOKEN_KEY) ?? ""),
  );
  const [tab, setTab] = useState<Tab>("dashboard");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [summary, setSummary] = useState<Item>({});
  const [clients, setClients] = useState<Item[]>([]);
  const [oems, setOems] = useState<Item[]>([]);
  const [vehicleCategories, setVehicleCategories] = useState<Item[]>([]);
  const [vehicleTypes, setVehicleTypes] = useState<Item[]>([]);
  const [packages, setPackages] = useState<Item[]>([]);
  const [features, setFeatures] = useState<Item[]>([]);
  const [pricing, setPricing] = useState<Item[]>([]);
  const [oem, setOem] = useState(emptyOem);
  const [editingOemId, setEditingOemId] = useState<string | null>(null);
  const [showOemForm, setShowOemForm] = useState(false);
  const [showOemBulk, setShowOemBulk] = useState(false);
  const [oemLogoFile, setOemLogoFile] = useState<File | null>(null);
  const [oemLogoPreview, setOemLogoPreview] = useState("");
  const [vehicleCategory, setVehicleCategory] = useState(emptyVehicleCategory);
  const [editingVehicleCategoryId, setEditingVehicleCategoryId] = useState<
    string | null
  >(null);
  const [showVehicleCategoryForm, setShowVehicleCategoryForm] = useState(false);
  const [vehicleType, setVehicleType] = useState(emptyVehicleType);
  const [editingVehicleTypeId, setEditingVehicleTypeId] = useState<
    string | null
  >(null);
  const [showVehicleTypeForm, setShowVehicleTypeForm] = useState(false);
  const [feature, setFeature] = useState(emptyFeature);
  const [editingFeatureId, setEditingFeatureId] = useState<string | null>(null);
  const [showFeatureForm, setShowFeatureForm] = useState(false);
  const [showFeatureBulk, setShowFeatureBulk] = useState(false);
  const [pack, setPack] = useState(emptyPackage);
  const [editingPackageId, setEditingPackageId] = useState<string | null>(null);
  const [showPackageForm, setShowPackageForm] = useState(false);
  const [packageFeatures, setPackageFeatures] = useState<PackageFeatureInput[]>(
    [],
  );
  const [price, setPrice] = useState(emptyPricing);
  const [editingPricingId, setEditingPricingId] = useState<string | null>(null);
  const [showPricingForm, setShowPricingForm] = useState(false);
  const [clientStep, setClientStep] = useState(1);
  const [showClientForm, setShowClientForm] = useState(false);
  const [client, setClient] = useState<Item>({
    name: "",
    slug: "",
    legalCompanyName: "",
    clientType: "FLEET_OPERATOR",
    businessType: "PVT_LTD",
    industry: "",
    gstin: "",
    pan: "",
    website: "",
    primaryContactName: "",
    primaryContactTitle: "",
    primaryContactMobile: "",
    primaryContactEmail: "",
    alternateMobile: "",
    adminName: "",
    adminEmail: "",
    adminMobile: "",
    registeredAddressLine1: "",
    registeredAddressLine2: "",
    landmark: "",
    city: "",
    district: "",
    state: "",
    country: "India",
    pinCode: "",
    packageId: "",
    billingCycle: "MONTHLY",
    packageStartDate: new Date().toISOString().slice(0, 10),
    trialApplicable: false,
    trialDays: "",
    billingFrequency: "MONTHLY",
    discountType: "",
    discount: "",
    taxRate: "18",
    autoRenewal: true,
    paymentTerms: "",
    poNumber: "",
  });

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
        featureList,
        priceList,
      ] = await Promise.all([
        request("/platform/dashboard", {}, token),
        request("/platform/clients", {}, token),
        request("/platform/oems", {}, token),
        request("/platform/vehicle-categories", {}, token),
        request("/platform/vehicle-types", {}, token),
        request("/platform/packages", {}, token),
        request("/platform/features", {}, token),
        request("/platform/feature-pricing", {}, token),
      ]);
      setSummary(dashboard);
      setClients(clientList);
      setOems(oemList);
      setVehicleCategories(vehicleCategoryList);
      setVehicleTypes(vehicleTypeList);
      setPackages(packageList);
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
  async function submitOem(event: FormEvent) {
    event.preventDefault();
    await submit(
      async () => {
        const saved = await request(
          editingOemId ? `/platform/oems/${editingOemId}` : "/platform/oems",
          { method: editingOemId ? "PUT" : "POST", body: JSON.stringify(oem) },
          token,
        );
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
      "oem_code,oem_name,display_name,status,logo_url,website,description\nZELIO,Zelio Auto Private Limited,Zelio,ACTIVE,,,\n";
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "evseye-oem-template.csv";
    link.click();
    URL.revokeObjectURL(url);
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
        "logo_url",
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
        const [
          code,
          name,
          displayName,
          status,
          logoUrl,
          website,
          description,
        ] = parseCsvLine(line);
        return {
          code,
          name,
          displayName,
          status,
          ...(logoUrl ? { logoUrl } : {}),
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
      setShowOemBulk(false);
      await load();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Unable to import OEMs.",
      );
    } finally {
      setLoading(false);
    }
  }
  async function submitFeature(event: FormEvent) {
    event.preventDefault();
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
              displayOrder: Number(feature.displayOrder),
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
      setShowFeatureBulk(false);
      await load();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Unable to import Features.",
      );
    } finally {
      setLoading(false);
    }
  }
  async function submitPackage(event: FormEvent) {
    event.preventDefault();
    let configuredFeatures: Item[];
    try {
      configuredFeatures = packageFeatures.map((feature) => ({
        featureId: feature.featureId,
        enabled: feature.enabled,
        unlimitedUsage: feature.unlimitedUsage,
        displayOrder: Number(feature.displayOrder || 0),
        ...(feature.includedQuantity
          ? { includedQuantity: Number(feature.includedQuantity) }
          : {}),
        ...(feature.usageLimit
          ? { usageLimit: Number(feature.usageLimit) }
          : {}),
        ...(feature.configuration
          ? { configuration: JSON.parse(feature.configuration) }
          : {}),
        pricing: feature.pricing.map((priceOverride) => ({
          ...(priceOverride.featurePricingId
            ? { featurePricingId: priceOverride.featurePricingId }
            : {}),
          pricingModel: priceOverride.pricingModel,
          includedQuantity: Number(priceOverride.includedQuantity || 0),
          ...(priceOverride.unitPrice
            ? { unitPrice: Number(priceOverride.unitPrice) }
            : {}),
          ...(priceOverride.minimumCharge
            ? { minimumCharge: Number(priceOverride.minimumCharge) }
            : {}),
          ...(priceOverride.maximumCharge
            ? { maximumCharge: Number(priceOverride.maximumCharge) }
            : {}),
          effectiveFrom: priceOverride.effectiveFrom,
          ...(priceOverride.effectiveTo
            ? { effectiveTo: priceOverride.effectiveTo }
            : {}),
          isActive: priceOverride.isActive,
        })),
      }));
    } catch {
      setError("Package Feature configuration must be valid JSON.");
      return;
    }
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
              ...(pack.monthlyPrice
                ? { monthlyPrice: Number(pack.monthlyPrice) }
                : {}),
              ...(pack.yearlyPrice
                ? { yearlyPrice: Number(pack.yearlyPrice) }
                : {}),
              ...(pack.maxFleets ? { maxFleets: Number(pack.maxFleets) } : {}),
              ...(pack.maxVehicles
                ? { maxVehicles: Number(pack.maxVehicles) }
                : {}),
              ...(pack.maxRiders ? { maxRiders: Number(pack.maxRiders) } : {}),
              ...(pack.maxUsers ? { maxUsers: Number(pack.maxUsers) } : {}),
              trialDays: Number(pack.trialDays || 0),
              displayOrder: Number(pack.displayOrder || 0),
              packageFeatures: configuredFeatures,
            }),
          },
          token,
        ),
      editingPackageId ? "Package updated." : "Package created.",
      () => {
        setPack(emptyPackage);
        setPackageFeatures([]);
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
              ...price,
              basePrice: Number(price.basePrice || 0),
              unitPrice: Number(price.unitPrice),
              costPrice: Number(price.costPrice || 0),
              ...(price.minimumCharge
                ? { minimumCharge: Number(price.minimumCharge) }
                : {}),
              ...(price.maximumCharge
                ? { maximumCharge: Number(price.maximumCharge) }
                : {}),
              setupFee: Number(price.setupFee || 0),
              ...(price.effectiveTo ? {} : { effectiveTo: undefined }),
              ...(metadata ? { metadata } : { metadata: undefined }),
              tiers: price.tiers.map((tier) => ({
                tierOrder: Number(tier.tierOrder),
                fromQuantity: Number(tier.fromQuantity),
                ...(tier.toQuantity
                  ? { toQuantity: Number(tier.toQuantity) }
                  : {}),
                unitPrice: Number(tier.unitPrice),
                ...(tier.costPrice
                  ? { costPrice: Number(tier.costPrice) }
                  : {}),
              })),
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
  async function submitClient(event: FormEvent) {
    event.preventDefault();
    if (clientStep < 4) {
      setClientStep(clientStep + 1);
      return;
    }
    await submit(
      () =>
        request(
          "/platform/clients/onboarding",
          {
            method: "POST",
            body: JSON.stringify({
              ...client,
              trialDays: client.trialDays
                ? Number(client.trialDays)
                : undefined,
              discount: client.discount ? Number(client.discount) : undefined,
              taxRate: Number(client.taxRate),
            }),
          },
          token,
        ),
      "Client onboarded successfully.",
      () => setShowClientForm(false),
    );
  }
  async function remove(path: string, label: string) {
    if (!window.confirm(`Delete this ${label}?`)) return;
    await submit(
      () => request(path, { method: "DELETE" }, token),
      `${label} deleted.`,
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
      await operation();
      done?.();
      setNotice(success);
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
    setClient((current) => ({ ...current, [key]: value }));
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
  const nav: Array<[Tab, string, string]> = [
    ["dashboard", "Dashboard", "▦"],
    ["oems", "OEM", "▣"],
    ["vehicleCategories", "Vehicle Category", "▤"],
    ["vehicleTypes", "Vehicle Type", "▧"],
    ["features", "Feature", "◇"],
    ["pricing", "Feature pricing", "₹"],
    ["packages", "Package", "◫"],
    ["clients", "Client", "♙"],
  ];
  return (
    <main className="sa-shell">
      <aside className="sa-sidebar">
        <div className="sa-brand">
          <span>◉</span>
          <div>
            <strong>Evs Eye</strong>
            <small>PRO</small>
          </div>
        </div>
        <p className="sa-nav-label">PLATFORM</p>
        <nav>
          {nav.map(([key, label, icon]) => (
            <button
              key={key}
              className={tab === key ? "active" : ""}
              onClick={() => {
                setTab(key);
                setShowClientForm(false);
                setNotice("");
              }}
            >
              <span>{icon}</span>
              {label}
            </button>
          ))}
        </nav>
        <div className="sa-user">
          <span>S</span>
          <div>
            <strong>Super Admin</strong>
            <small>admin@evseye.io</small>
          </div>
        </div>
      </aside>
      <section className="sa-main">
        <header className="sa-topbar">
          <div>
            <h1>
              {tab === "dashboard"
                ? "Super Admin Dashboard"
                : nav.find(([key]) => key === tab)?.[1]}
            </h1>
            <p>
              {tab === "dashboard"
                ? "Complete platform overview · Updated just now"
                : "Platform-owned catalog and commercial controls"}
            </p>
          </div>
          <div>
            <button className="secondary" onClick={() => void load()}>
              ↻ Refresh
            </button>
            <button
              onClick={() => {
                sessionStorage.removeItem(ACCESS_TOKEN_KEY);
                sessionStorage.removeItem(REFRESH_TOKEN_KEY);
                setToken("");
              }}
            >
              Sign out
            </button>
          </div>
        </header>
        {notice && <p className="notice">{notice}</p>}
        {error && <p className="error">{error}</p>}
        {tab === "dashboard" && (
          <DashboardView
            summary={summary}
            clients={clients}
            packages={packages}
            oems={oems}
            setTab={setTab}
          />
        )}
        {tab === "clients" && (
          <ClientsView
            clients={clients}
            packages={packages}
            showForm={showClientForm}
            setShowForm={setShowClientForm}
            client={client}
            change={changeClient}
            step={clientStep}
            setStep={setClientStep}
            submit={submitClient}
          />
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
                <button className="secondary" onClick={downloadOemTemplate}>
                  Download template
                </button>
                <button
                  className="secondary"
                  onClick={() => {
                    setShowOemBulk(!showOemBulk);
                    setShowOemForm(false);
                  }}
                >
                  Bulk upload
                </button>
                <button
                  onClick={() => {
                    setShowOemForm(!showOemForm);
                    setShowOemBulk(false);
                  }}
                >
                  + Add OEM
                </button>
              </div>
            </section>
            {showOemBulk && (
              <section className="sa-oem-bulk">
                <div>
                  <h3>Bulk upload OEMs</h3>
                  <p>
                    Download the CSV template, complete one OEM per row, and
                    upload it. The entire file is rejected if any row is invalid
                    or duplicates an existing code.
                  </p>
                </div>
                <label className="sa-file-input">
                  Choose completed CSV
                  <input
                    type="file"
                    accept=".csv,text/csv"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file) void uploadOemCsv(file);
                      event.currentTarget.value = "";
                    }}
                  />
                </label>
              </section>
            )}
            <section
              className={`sa-management ${showOemForm ? "" : "oem-table-only"}`}
            >
              {showOemForm && (
                <form className="sa-form" onSubmit={submitOem}>
                  <h3>Add OEM</h3>
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
                    value={oem.status}
                    change={(value) =>
                      setOem((current) => ({ ...current, status: value }))
                    }
                    options={["ACTIVE", "INACTIVE", "SUSPENDED"]}
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
                  <button disabled={loading}>
                    {editingOemId ? "Update OEM" : "Save OEM"}
                  </button>
                </form>
              )}
              {oems.length ? (
                <DataTable
                  headings={["Code", "OEM", "Status", ""]}
                  rows={oems.map((item) => [
                    item.code,
                    item.displayName,
                    item.status,
                    <button
                      key="edit"
                      className="secondary"
                      onClick={() => {
                        setOem({
                          code: item.code,
                          name: item.name,
                          displayName: item.displayName,
                          status: item.status,
                          website: item.website ?? "",
                          description: item.description ?? "",
                        });
                        setEditingOemId(item.id);
                        setShowOemForm(true);
                        setOemLogoFile(null);
                        setOemLogoPreview("");
                      }}
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
                    <button onClick={() => setShowOemForm(true)}>
                      Add OEM
                    </button>
                    <button
                      className="secondary"
                      onClick={() => setShowOemBulk(true)}
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
                  onClick={() => {
                    setVehicleCategory(emptyVehicleCategory);
                    setEditingVehicleCategoryId(null);
                    setShowVehicleCategoryForm(!showVehicleCategoryForm);
                  }}
                >
                  + Add Vehicle Category
                </button>
              </div>
            </section>
            <section
              className={`sa-management ${showVehicleCategoryForm ? "" : "oem-table-only"}`}
            >
              {showVehicleCategoryForm && (
                <form className="sa-form" onSubmit={submitVehicleCategory}>
                  <h3>
                    {editingVehicleCategoryId
                      ? "Edit Vehicle Category"
                      : "Add Vehicle Category"}
                  </h3>
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
                    options={["ACTIVE", "INACTIVE", "SUSPENDED"]}
                  />
                  <button disabled={loading}>
                    {editingVehicleCategoryId
                      ? "Update Vehicle Category"
                      : "Save Vehicle Category"}
                  </button>
                </form>
              )}
              {vehicleCategories.length ? (
                <DataTable
                  headings={[
                    "Code",
                    "Category",
                    "Description",
                    "Status",
                    "Order",
                    "",
                    "",
                  ]}
                  rows={vehicleCategories.map((item) => [
                    item.code,
                    item.name,
                    item.description ?? "—",
                    item.status,
                    item.displayOrder,
                    <button
                      key="edit"
                      className="secondary"
                      onClick={() => {
                        setVehicleCategory({
                          code: item.code,
                          name: item.name,
                          description: item.description ?? "",
                          status: item.status,
                          displayOrder: String(item.displayOrder ?? 0),
                        });
                        setEditingVehicleCategoryId(item.id);
                        setShowVehicleCategoryForm(true);
                      }}
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
                  <button onClick={() => setShowVehicleCategoryForm(true)}>
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
                  onClick={() => {
                    setVehicleType(emptyVehicleType);
                    setEditingVehicleTypeId(null);
                    setShowVehicleTypeForm(!showVehicleTypeForm);
                  }}
                >
                  + Add Vehicle Type
                </button>
              </div>
            </section>
            <section
              className={`sa-management ${showVehicleTypeForm ? "" : "oem-table-only"}`}
            >
              {showVehicleTypeForm && (
                <form className="sa-form" onSubmit={submitVehicleType}>
                  <h3>
                    {editingVehicleTypeId
                      ? "Edit Vehicle Type"
                      : "Add Vehicle Type"}
                  </h3>
                  <label>
                    Vehicle Category
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
                    options={[
                      "ELECTRIC",
                      "HYBRID",
                      "PETROL",
                      "DIESEL",
                      "CNG",
                      "HYDROGEN",
                      "OTHER",
                      "LPG",
                    ]}
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
                      {[
                        "PRIVATE",
                        "PASSENGER",
                        "GOODS",
                        "DELIVERY",
                        "SHARED_MOBILITY",
                        "PUBLIC_TRANSPORT",
                        "STAFF_TRANSPORT",
                        "SCHOOL_TRANSPORT",
                        "EMERGENCY",
                        "AGRICULTURAL",
                        "CONSTRUCTION",
                        "INDUSTRIAL",
                        "RENTAL",
                        "GOVERNMENT",
                        "SPECIAL_PURPOSE",
                      ].map((option) => (
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
                    options={["ACTIVE", "INACTIVE", "SUSPENDED"]}
                  />
                  <button disabled={loading}>
                    {editingVehicleTypeId
                      ? "Update Vehicle Type"
                      : "Save Vehicle Type"}
                  </button>
                </form>
              )}
              <DataTable
                headings={[
                  "Code",
                  "Vehicle Type",
                  "Category",
                  "Energy",
                  "Usage",
                  "Status",
                  "",
                  "",
                ]}
                rows={vehicleTypes.map((item) => [
                  item.code,
                  item.name,
                  item.category?.name,
                  item.energyType,
                  item.usageType ?? "—",
                  item.status,
                  <button
                    key="edit"
                    className="secondary"
                    onClick={() => {
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
                      setShowVehicleTypeForm(true);
                    }}
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
                <button className="secondary" onClick={downloadFeatureTemplate}>
                  Download template
                </button>
                <button
                  className="secondary"
                  onClick={() => {
                    setShowFeatureBulk(!showFeatureBulk);
                    setShowFeatureForm(false);
                  }}
                >
                  Bulk upload
                </button>
                <button
                  onClick={() => {
                    setFeature(emptyFeature);
                    setEditingFeatureId(null);
                    setShowFeatureForm(!showFeatureForm);
                    setShowFeatureBulk(false);
                  }}
                >
                  + Add Feature
                </button>
              </div>
            </section>
            {showFeatureBulk && (
              <section className="sa-oem-bulk">
                <div>
                  <h3>Bulk upload Features</h3>
                  <p>
                    Download the CSV template, complete one Feature per row, and
                    upload it. The entire file is rejected if any row has an
                    invalid controlled value or duplicate code.
                  </p>
                </div>
                <label className="sa-file-input">
                  Choose completed CSV
                  <input
                    type="file"
                    accept=".csv,text/csv"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file) void uploadFeatureCsv(file);
                      event.currentTarget.value = "";
                    }}
                  />
                </label>
              </section>
            )}
            <section
              className={`sa-management ${showFeatureForm ? "" : "oem-table-only"}`}
            >
              {showFeatureForm && (
                <form className="sa-form" onSubmit={submitFeature}>
                  <h3>{editingFeatureId ? "Edit Feature" : "Add Feature"}</h3>
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
                    Feature category
                    <select
                      value={feature.category}
                      onChange={(event) =>
                        setFeature((current) => ({
                          ...current,
                          category: event.target.value,
                        }))
                      }
                    >
                      {featureCategories.map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <Select
                    value={feature.featureType}
                    change={(value) =>
                      setFeature((current) => ({
                        ...current,
                        featureType: value,
                      }))
                    }
                    options={featureTypes}
                  />
                  <Select
                    value={feature.billingUnit}
                    change={(value) =>
                      setFeature((current) => ({
                        ...current,
                        billingUnit: value,
                      }))
                    }
                    options={featureBillingUnits}
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
                  <button disabled={loading}>
                    {editingFeatureId ? "Update Feature" : "Save Feature"}
                  </button>
                </form>
              )}
              {features.length ? (
                <DataTable
                  headings={[
                    "Code",
                    "Feature",
                    "Category",
                    "Type",
                    "Billing unit",
                    "Active",
                    "Order",
                    "",
                  ]}
                  rows={features.map((item) => [
                    item.code,
                    item.name,
                    featureCategories.find(
                      ([value]) => value === item.category,
                    )?.[1] ?? item.category,
                    item.featureType,
                    item.billingUnit,
                    item.isActive ? "YES" : "NO",
                    item.displayOrder,
                    <button
                      key="edit"
                      className="secondary"
                      onClick={() => {
                        setFeature({
                          code: item.code,
                          name: item.name,
                          description: item.description ?? "",
                          category: item.category,
                          featureType: item.featureType,
                          billingUnit: item.billingUnit,
                          displayOrder: String(item.displayOrder),
                          isActive: item.isActive,
                        });
                        setEditingFeatureId(item.id);
                        setShowFeatureForm(true);
                        setShowFeatureBulk(false);
                      }}
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
                    <button onClick={() => setShowFeatureForm(true)}>
                      Add Feature
                    </button>
                    <button
                      className="secondary"
                      onClick={() => setShowFeatureBulk(true)}
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
                  Define commercial packages, limits, trial settings, and their
                  enabled platform features.
                </p>
              </div>
              <div className="sa-actions">
                <button
                  onClick={() => {
                    setPack(emptyPackage);
                    setPackageFeatures([]);
                    setEditingPackageId(null);
                    setShowPackageForm(!showPackageForm);
                  }}
                >
                  + Add Package
                </button>
              </div>
            </section>
            <section
              className={`sa-management ${showPackageForm ? "" : "oem-table-only"}`}
            >
              {showPackageForm && (
                <form className="sa-form" onSubmit={submitPackage}>
                  <h3>{editingPackageId ? "Edit Package" : "Add Package"}</h3>
                  <TextFields
                    value={pack}
                    change={(key, value) =>
                      setPack((current) => ({ ...current, [key]: value }))
                    }
                    fields={[
                      ["code", "Package code"],
                      ["name", "Package name"],
                      ["description", "Description"],
                      ["monthlyPrice", "Monthly price"],
                      ["yearlyPrice", "Yearly price"],
                      ["maxFleets", "Maximum fleets"],
                      ["maxVehicles", "Maximum vehicles"],
                      ["maxRiders", "Maximum riders"],
                      ["maxUsers", "Maximum users"],
                      ["trialDays", "Trial days"],
                      ["displayOrder", "Display order"],
                    ]}
                  />
                  <Select
                    value={pack.packageType}
                    change={(value) =>
                      setPack((current) => ({ ...current, packageType: value }))
                    }
                    options={[
                      "STANDARD",
                      "CUSTOM",
                      "TRIAL",
                      "ADD_ON",
                      "ENTERPRISE",
                      "INTERNAL",
                    ]}
                  />
                  <label className="sa-toggle">
                    <input
                      type="checkbox"
                      checked={pack.isDefault}
                      onChange={(event) =>
                        setPack((current) => ({
                          ...current,
                          isDefault: event.target.checked,
                        }))
                      }
                    />
                    Default package
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
                  <div className="sa-checkbox-list">
                    {features
                      .filter(
                        (feature) =>
                          feature.isActive ||
                          packageFeatures.some(
                            (item) => item.featureId === feature.id,
                          ),
                      )
                      .map((feature) => (
                        <label key={feature.id}>
                          <input
                            type="checkbox"
                            checked={packageFeatures.some(
                              (item) => item.featureId === feature.id,
                            )}
                            disabled={!feature.isActive}
                            onChange={(event) =>
                              setPackageFeatures((current) =>
                                event.target.checked
                                  ? [
                                      ...current,
                                      emptyPackageFeature(
                                        feature.id,
                                        current.length,
                                      ),
                                    ]
                                  : current.filter(
                                      (item) => item.featureId !== feature.id,
                                    ),
                              )
                            }
                          />
                          {feature.name}
                          {!feature.isActive ? " (inactive)" : ""}
                        </label>
                      ))}
                  </div>
                  {packageFeatures.map((packageFeature, featureIndex) => {
                    const linkedFeature = features.find(
                      (item) => item.id === packageFeature.featureId,
                    );
                    const eligiblePrices = pricing.filter(
                      (item) => item.featureId === packageFeature.featureId,
                    );
                    const updatePackageFeature = (
                      field: keyof PackageFeatureInput,
                      value: string | boolean | PackageFeaturePricingInput[],
                    ) =>
                      setPackageFeatures((current) =>
                        current.map((item, index) =>
                          index === featureIndex
                            ? { ...item, [field]: value }
                            : item,
                        ),
                      );
                    return (
                      <div
                        className="sa-package-feature"
                        key={packageFeature.featureId}
                      >
                        <strong>{linkedFeature?.name ?? "Feature"}</strong>
                        <div className="sa-feature-fields">
                          <label className="sa-toggle">
                            <input
                              type="checkbox"
                              checked={packageFeature.enabled}
                              onChange={(event) =>
                                updatePackageFeature(
                                  "enabled",
                                  event.target.checked,
                                )
                              }
                            />
                            Enabled
                          </label>
                          <label className="sa-toggle">
                            <input
                              type="checkbox"
                              checked={packageFeature.unlimitedUsage}
                              onChange={(event) =>
                                updatePackageFeature(
                                  "unlimitedUsage",
                                  event.target.checked,
                                )
                              }
                            />
                            Unlimited usage
                          </label>
                          <label>
                            Included quantity
                            <input
                              type="number"
                              min="0"
                              step="1"
                              value={packageFeature.includedQuantity}
                              onChange={(event) =>
                                updatePackageFeature(
                                  "includedQuantity",
                                  event.target.value,
                                )
                              }
                            />
                          </label>
                          <label>
                            Usage limit
                            <input
                              type="number"
                              min="0"
                              step="1"
                              disabled={packageFeature.unlimitedUsage}
                              value={packageFeature.usageLimit}
                              onChange={(event) =>
                                updatePackageFeature(
                                  "usageLimit",
                                  event.target.value,
                                )
                              }
                            />
                          </label>
                          <label>
                            Display order
                            <input
                              type="number"
                              min="0"
                              step="1"
                              value={packageFeature.displayOrder}
                              onChange={(event) =>
                                updatePackageFeature(
                                  "displayOrder",
                                  event.target.value,
                                )
                              }
                            />
                          </label>
                        </div>
                        <label>
                          Feature configuration (optional JSON)
                          <textarea
                            value={packageFeature.configuration}
                            placeholder={'{"workflow": "standard"}'}
                            onChange={(event) =>
                              updatePackageFeature(
                                "configuration",
                                event.target.value,
                              )
                            }
                          />
                        </label>
                        <div className="sa-package-feature-pricing">
                          <div>
                            <strong>Package-specific price overrides</strong>
                            <button
                              type="button"
                              className="secondary"
                              onClick={() =>
                                updatePackageFeature("pricing", [
                                  ...packageFeature.pricing,
                                  emptyPackageFeaturePricing(),
                                ])
                              }
                            >
                              + Add override
                            </button>
                          </div>
                          {packageFeature.pricing.map(
                            (priceOverride, pricingIndex) => {
                              const updateOverride = (
                                field: keyof PackageFeaturePricingInput,
                                value: string | boolean,
                              ) =>
                                updatePackageFeature(
                                  "pricing",
                                  packageFeature.pricing.map((item, index) =>
                                    index === pricingIndex
                                      ? { ...item, [field]: value }
                                      : item,
                                  ),
                                );
                              return (
                                <div
                                  className="sa-price-override"
                                  key={pricingIndex}
                                >
                                  <label>
                                    Feature price reference
                                    <select
                                      value={priceOverride.featurePricingId}
                                      onChange={(event) =>
                                        updateOverride(
                                          "featurePricingId",
                                          event.target.value,
                                        )
                                      }
                                    >
                                      <option value="">Custom override</option>
                                      {eligiblePrices.map((item) => (
                                        <option key={item.id} value={item.id}>
                                          {item.pricingName ??
                                            item.pricingModel}{" "}
                                          · {item.currency} {item.unitPrice}
                                        </option>
                                      ))}
                                    </select>
                                  </label>
                                  <Select
                                    label="Pricing model"
                                    value={priceOverride.pricingModel}
                                    change={(value) =>
                                      updateOverride("pricingModel", value)
                                    }
                                    options={pricingModels}
                                  />
                                  <TextFields
                                    value={priceOverride}
                                    change={(key, value) =>
                                      updateOverride(
                                        key as keyof PackageFeaturePricingInput,
                                        value,
                                      )
                                    }
                                    fields={[
                                      ["includedQuantity", "Included quantity"],
                                      ["unitPrice", "Unit price"],
                                      ["minimumCharge", "Minimum charge"],
                                      ["maximumCharge", "Maximum charge"],
                                      ["effectiveFrom", "Effective from"],
                                      ["effectiveTo", "Effective to"],
                                    ]}
                                  />
                                  <label className="sa-toggle">
                                    <input
                                      type="checkbox"
                                      checked={priceOverride.isActive}
                                      onChange={(event) =>
                                        updateOverride(
                                          "isActive",
                                          event.target.checked,
                                        )
                                      }
                                    />
                                    Active override
                                  </label>
                                  <button
                                    type="button"
                                    className="danger"
                                    onClick={() =>
                                      updatePackageFeature(
                                        "pricing",
                                        packageFeature.pricing.filter(
                                          (_, index) => index !== pricingIndex,
                                        ),
                                      )
                                    }
                                  >
                                    Remove override
                                  </button>
                                </div>
                              );
                            },
                          )}
                        </div>
                      </div>
                    );
                  })}
                  <button disabled={loading}>
                    {editingPackageId ? "Update Package" : "Save Package"}
                  </button>
                </form>
              )}
              {packages.length ? (
                <DataTable
                  headings={[
                    "Code",
                    "Package",
                    "Type",
                    "Monthly",
                    "Limits",
                    "Status",
                    "Features",
                    "",
                  ]}
                  rows={packages.map((item) => [
                    item.code,
                    item.name,
                    item.packageType,
                    item.monthlyPrice ? `₹${item.monthlyPrice}` : "—",
                    `${item.maxVehicles ?? "∞"} vehicles · ${item.maxRiders ?? "∞"} riders`,
                    `${item.isActive ? "ACTIVE" : "INACTIVE"}${item.isDefault ? " · DEFAULT" : ""}`,
                    item.features?.length ?? 0,
                    <button
                      key="edit"
                      className="secondary"
                      onClick={() => {
                        setPack({
                          code: item.code,
                          name: item.name,
                          packageType: item.packageType,
                          monthlyPrice: item.monthlyPrice
                            ? String(item.monthlyPrice)
                            : "",
                          yearlyPrice: item.yearlyPrice
                            ? String(item.yearlyPrice)
                            : "",
                          currency: item.currency,
                          description: item.description ?? "",
                          maxFleets: item.maxFleets
                            ? String(item.maxFleets)
                            : "",
                          maxVehicles: item.maxVehicles
                            ? String(item.maxVehicles)
                            : "",
                          maxRiders: item.maxRiders
                            ? String(item.maxRiders)
                            : "",
                          maxUsers: item.maxUsers ? String(item.maxUsers) : "",
                          trialDays: String(item.trialDays ?? 0),
                          displayOrder: String(item.displayOrder ?? 0),
                          isDefault: item.isDefault,
                          isActive: item.isActive,
                        });
                        setPackageFeatures(
                          (item.features ?? []).map(
                            (link: Item, index: number) => ({
                              featureId: link.featureId,
                              enabled: link.enabled,
                              includedQuantity: link.includedQuantity
                                ? String(link.includedQuantity)
                                : "",
                              usageLimit: link.usageLimit
                                ? String(link.usageLimit)
                                : "",
                              unlimitedUsage: link.unlimitedUsage,
                              configuration: link.configuration
                                ? JSON.stringify(link.configuration, null, 2)
                                : "",
                              displayOrder: String(link.displayOrder ?? index),
                              pricing: (link.pricing ?? []).map(
                                (priceOverride: Item) => ({
                                  featurePricingId:
                                    priceOverride.featurePricingId ?? "",
                                  pricingModel:
                                    priceOverride.pricingModel ?? "PER_UNIT",
                                  includedQuantity: String(
                                    priceOverride.includedQuantity ?? 0,
                                  ),
                                  unitPrice: priceOverride.unitPrice
                                    ? String(priceOverride.unitPrice)
                                    : "",
                                  minimumCharge: priceOverride.minimumCharge
                                    ? String(priceOverride.minimumCharge)
                                    : "",
                                  maximumCharge: priceOverride.maximumCharge
                                    ? String(priceOverride.maximumCharge)
                                    : "",
                                  effectiveFrom:
                                    priceOverride.effectiveFrom.slice(0, 10),
                                  effectiveTo: priceOverride.effectiveTo
                                    ? priceOverride.effectiveTo.slice(0, 10)
                                    : "",
                                  isActive: priceOverride.isActive,
                                }),
                              ),
                            }),
                          ),
                        );
                        setEditingPackageId(item.id);
                        setShowPackageForm(true);
                      }}
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
                    <button onClick={() => setShowPackageForm(true)}>
                      Add Package
                    </button>
                  </div>
                </section>
              )}
            </section>
          </>
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
                  onClick={() => {
                    setPrice(emptyPricing);
                    setEditingPricingId(null);
                    setShowPricingForm(!showPricingForm);
                  }}
                >
                  + Add Feature Price
                </button>
              </div>
            </section>
            <section
              className={`sa-management ${showPricingForm ? "" : "oem-table-only"}`}
            >
              {showPricingForm && (
                <form className="sa-form" onSubmit={submitPricing}>
                  <h3>
                    {editingPricingId
                      ? "Edit Feature Price"
                      : "Add Feature Price"}
                  </h3>
                  <label>
                    Feature
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
                  <Select
                    label="Pricing model"
                    value={price.pricingModel}
                    change={(value) =>
                      setPrice((current) => ({
                        ...current,
                        pricingModel: value,
                      }))
                    }
                    options={pricingModels}
                  />
                  <TextFields
                    value={price}
                    change={(key, value) =>
                      setPrice((current) => ({ ...current, [key]: value }))
                    }
                    fields={[
                      ["pricingName", "Pricing name"],
                      ["billingUnit", "Billing unit"],
                      ["basePrice", "Base price"],
                      ["unitPrice", "Unit price"],
                      ["costPrice", "Cost price"],
                      ["minimumCharge", "Minimum charge"],
                      ["maximumCharge", "Maximum charge"],
                      ["setupFee", "Setup fee"],
                      ["effectiveFrom", "Effective from"],
                      ["effectiveTo", "Effective to"],
                    ]}
                  />
                  <Select
                    label="Billing cycle"
                    value={price.billingCycle}
                    change={(value) =>
                      setPrice((current) => ({
                        ...current,
                        billingCycle: value,
                      }))
                    }
                    options={["MONTHLY", "QUARTERLY", "HALF_YEARLY", "YEARLY"]}
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
                      checked={price.taxInclusive}
                      onChange={(event) =>
                        setPrice((current) => ({
                          ...current,
                          taxInclusive: event.target.checked,
                        }))
                      }
                    />
                    Tax inclusive
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
                  {(price.pricingModel === "TIERED" ||
                    price.pricingModel === "VOLUME") && (
                    <div className="sa-package-feature-pricing">
                      <div>
                        <strong>Pricing tiers</strong>
                        <button
                          type="button"
                          className="secondary"
                          onClick={() =>
                            setPrice((current) => ({
                              ...current,
                              tiers: [
                                ...current.tiers,
                                {
                                  tierOrder: String(current.tiers.length + 1),
                                  fromQuantity: "0",
                                  toQuantity: "",
                                  unitPrice: "",
                                  costPrice: "",
                                },
                              ],
                            }))
                          }
                        >
                          + Add tier
                        </button>
                      </div>
                      {price.tiers.map((tier, tierIndex) => (
                        <div className="sa-price-override" key={tierIndex}>
                          <TextFields
                            value={tier}
                            change={(key, value) =>
                              setPrice((current) => ({
                                ...current,
                                tiers: current.tiers.map((item, index) =>
                                  index === tierIndex
                                    ? { ...item, [key]: value }
                                    : item,
                                ),
                              }))
                            }
                            fields={[
                              ["tierOrder", "Tier order"],
                              ["fromQuantity", "From quantity"],
                              ["toQuantity", "To quantity"],
                              ["unitPrice", "Unit price"],
                              ["costPrice", "Cost price"],
                            ]}
                          />
                          <button
                            type="button"
                            className="danger"
                            onClick={() =>
                              setPrice((current) => ({
                                ...current,
                                tiers: current.tiers.filter(
                                  (_, index) => index !== tierIndex,
                                ),
                              }))
                            }
                          >
                            Remove tier
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  <button disabled={loading}>
                    {editingPricingId
                      ? "Update Feature Price"
                      : "Save Feature Price"}
                  </button>
                </form>
              )}
              {pricing.length ? (
                <DataTable
                  headings={[
                    "Feature",
                    "Price name",
                    "Model",
                    "Price",
                    "Effective from",
                    "Status",
                    "",
                  ]}
                  rows={pricing.map((item) => [
                    item.feature?.name,
                    item.pricingName ?? "—",
                    item.pricingModel,
                    `${item.currency} ${item.unitPrice}`,
                    new Date(item.effectiveFrom).toLocaleDateString(),
                    item.isActive ? "ACTIVE" : "INACTIVE",
                    <button
                      key="edit"
                      className="secondary"
                      onClick={() => {
                        setPrice({
                          featureId: item.featureId,
                          pricingName: item.pricingName ?? "",
                          pricingModel: item.pricingModel,
                          billingUnit: item.billingUnit,
                          basePrice: String(item.basePrice ?? 0),
                          unitPrice: String(item.unitPrice),
                          costPrice: String(item.costPrice ?? 0),
                          minimumCharge: item.minimumCharge
                            ? String(item.minimumCharge)
                            : "",
                          maximumCharge: item.maximumCharge
                            ? String(item.maximumCharge)
                            : "",
                          setupFee: String(item.setupFee ?? 0),
                          currency: item.currency,
                          billingCycle: item.billingCycle ?? "MONTHLY",
                          taxInclusive: item.taxInclusive ?? false,
                          effectiveFrom: item.effectiveFrom.slice(0, 10),
                          effectiveTo: item.effectiveTo
                            ? item.effectiveTo.slice(0, 10)
                            : "",
                          isActive: item.isActive,
                          metadata: item.metadata
                            ? JSON.stringify(item.metadata, null, 2)
                            : "",
                          tiers: (item.tiers ?? []).map((tier: Item) => ({
                            tierOrder: String(tier.tierOrder),
                            fromQuantity: String(tier.fromQuantity),
                            toQuantity: tier.toQuantity
                              ? String(tier.toQuantity)
                              : "",
                            unitPrice: String(tier.unitPrice),
                            costPrice: tier.costPrice
                              ? String(tier.costPrice)
                              : "",
                          })),
                        });
                        setEditingPricingId(item.id);
                        setShowPricingForm(true);
                      }}
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
                    <button onClick={() => setShowPricingForm(true)}>
                      Add Feature Price
                    </button>
                  </div>
                </section>
              )}
            </section>
          </>
        )}
        {loading && <p className="platform-loading">Working…</p>}
      </section>
    </main>
  );
}

function DashboardView({
  summary,
  clients,
  packages,
  oems,
  setTab,
}: {
  summary: Item;
  clients: Item[];
  packages: Item[];
  oems: Item[];
  setTab: (tab: Tab) => void;
}) {
  return (
    <>
      <section className="sa-metrics">
        <Metric
          label="Total clients"
          value={summary.clients ?? 0}
          tone="green"
        />
        <Metric
          label="Active vehicles"
          value={summary.fleets ?? 0}
          tone="coral"
        />
        <Metric label="Active riders" value={summary.riders ?? 0} tone="gold" />
        <Metric
          label="Active packages"
          value={summary.packages ?? 0}
          tone="green"
        />
      </section>
      <section className="sa-dashboard-grid">
        <article className="sa-card sa-revenue">
          <div className="sa-card-head">
            <div>
              <h3>Platform revenue</h3>
              <p>Commercial catalogue health</p>
            </div>
            <button className="secondary" onClick={() => setTab("packages")}>
              Manage packages
            </button>
          </div>
          <div className="sa-revenue-bars">
            {["Jan", "Feb", "Mar", "Apr", "May", "Jun"].map((month, index) => (
              <div key={month}>
                <span style={{ height: `${35 + index * 9}%` }}></span>
                <small>{month}</small>
              </div>
            ))}
          </div>
          <p className="sa-footnote">
            Pricing and usage reporting begins as clients activate
            subscriptions.
          </p>
        </article>
        <article className="sa-card">
          <div className="sa-card-head">
            <div>
              <h3>Client performance</h3>
              <p>Top clients by fleet size</p>
            </div>
            <button className="secondary" onClick={() => setTab("clients")}>
              View all
            </button>
          </div>
          <div className="sa-ranked-list">
            {clients.slice(0, 6).map((client, index) => (
              <div key={client.id}>
                <span>{index + 1}</span>
                <section>
                  <strong>{client.name}</strong>
                  <small>
                    {client._count?.riders ?? 0} riders ·{" "}
                    {client._count?.users ?? 0} users
                  </small>
                </section>
                <b>{client.isActive ? "Active" : "Inactive"}</b>
              </div>
            ))}
            {!clients.length && (
              <p className="muted">No clients have been onboarded yet.</p>
            )}
          </div>
        </article>
        <article className="sa-card">
          <div className="sa-card-head">
            <div>
              <h3>Platform catalogue</h3>
              <p>Master data available to all clients</p>
            </div>
          </div>
          <div className="sa-summary-list">
            <button onClick={() => setTab("oems")}>
              <strong>{summary.oems ?? oems.length}</strong>
              <span>OEMs</span>
            </button>
            <button onClick={() => setTab("packages")}>
              <strong>{packages.length}</strong>
              <span>Packages</span>
            </button>
            <button onClick={() => setTab("pricing")}>
              <strong>₹</strong>
              <span>Feature pricing</span>
            </button>
          </div>
        </article>
        <article className="sa-card">
          <div className="sa-card-head">
            <div>
              <h3>Recent activity</h3>
              <p>Platform-wide events</p>
            </div>
            <span className="sa-live">● Live</span>
          </div>
          <ul className="sa-activity">
            <li>Client catalogue is ready for commercial onboarding</li>
            <li>Rider onboarding master workflow is active</li>
            <li>Package and feature pricing are platform controlled</li>
          </ul>
        </article>
      </section>
    </>
  );
}

function ClientsView({
  clients,
  packages,
  showForm,
  setShowForm,
  client,
  change,
  step,
  setStep,
  submit,
}: any) {
  const fields =
    step === 1
      ? [
          ["name", "Client / company name"],
          ["slug", "Client workspace slug"],
          ["legalCompanyName", "Legal company name"],
          ["clientType", "Client type"],
          ["businessType", "Business type"],
          ["industry", "Industry"],
          ["gstin", "GSTIN"],
          ["pan", "PAN"],
          ["website", "Website"],
        ]
      : step === 2
        ? [
            ["primaryContactName", "Primary contact name"],
            ["primaryContactTitle", "Designation"],
            ["primaryContactMobile", "Primary mobile"],
            ["primaryContactEmail", "Primary email"],
            ["alternateMobile", "Alternate mobile"],
            ["adminName", "Admin name"],
            ["adminEmail", "Admin email"],
            ["adminMobile", "Admin mobile"],
          ]
        : step === 3
          ? [
              ["registeredAddressLine1", "Address line 1"],
              ["registeredAddressLine2", "Address line 2"],
              ["landmark", "Landmark"],
              ["city", "City"],
              ["district", "District"],
              ["state", "State"],
              ["country", "Country"],
              ["pinCode", "PIN code"],
            ]
          : [
              ["packageStartDate", "Package start date"],
              ["billingFrequency", "Billing frequency"],
              ["discountType", "Discount type"],
              ["discount", "Discount"],
              ["taxRate", "Tax / GST"],
              ["paymentTerms", "Payment terms"],
              ["poNumber", "PO number"],
            ];
  return (
    <>
      <section className="sa-page-head">
        <div>
          <h2>Clients</h2>
          <p>
            Onboard a client with contacts, address, package, and commercial
            terms.
          </p>
        </div>
        <button
          onClick={() => {
            setShowForm(!showForm);
            setStep(1);
          }}
        >
          + Onboard client
        </button>
      </section>
      {showForm && (
        <form className="sa-wizard" onSubmit={submit}>
          <header>
            <span>Client onboarding</span>
            <strong>Step {step} of 4</strong>
          </header>
          <div className="sa-wizard-progress">
            <span style={{ width: `${step * 25}%` }} />
          </div>
          <section>
            <h3>
              {
                [
                  "Company information",
                  "Contact information",
                  "Registered & billing address",
                  "Package & commercials",
                ][step - 1]
              }
            </h3>
            <div className="sa-field-grid">
              <TextFields value={client} change={change} fields={fields} />
              {step === 4 && (
                <>
                  <label>
                    Package
                    <select
                      value={client.packageId}
                      onChange={(event) =>
                        change("packageId", event.target.value)
                      }
                      required
                    >
                      <option value="">Select package</option>
                      {packages.map((item: Item) => (
                        <option key={item.id} value={item.id}>
                          {item.name} · ₹{item.monthlyPrice}/month
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
                      <option>MONTHLY</option>
                      <option>QUARTERLY</option>
                      <option>HALF_YEARLY</option>
                      <option>YEARLY</option>
                    </select>
                  </label>
                  <label className="sa-toggle">
                    <input
                      type="checkbox"
                      checked={client.trialApplicable}
                      onChange={(event) =>
                        change("trialApplicable", event.target.checked)
                      }
                    />{" "}
                    Trial applicable
                  </label>
                  <label className="sa-toggle">
                    <input
                      type="checkbox"
                      checked={client.autoRenewal}
                      onChange={(event) =>
                        change("autoRenewal", event.target.checked)
                      }
                    />{" "}
                    Auto renewal
                  </label>
                </>
              )}
            </div>
          </section>
          <footer>
            {step > 1 && (
              <button
                type="button"
                className="secondary"
                onClick={() => setStep(step - 1)}
              >
                Back
              </button>
            )}
            <button>{step === 4 ? "Create client" : "Continue"}</button>
          </footer>
        </form>
      )}
      <DataTable
        headings={[
          "Client",
          "Workspace",
          "Riders",
          "Workflow versions",
          "Status",
        ]}
        rows={clients.map((item: Item) => [
          item.name,
          item.slug,
          item._count?.riders ?? 0,
          item._count?.onboardingConfigs ?? 0,
          item.isActive ? "ACTIVE" : "INACTIVE",
        ])}
      />
    </>
  );
}
function TextFields({
  value,
  change,
  fields,
}: {
  value: Item;
  change: (key: string, value: string) => void;
  fields: string[][];
}) {
  return (
    <>
      {fields.map(([key, label]) => {
        const normalizedKey = key.toLowerCase();
        return (
          <label key={key}>
            {label}
            <input
              value={value[key] ?? ""}
              type={
                normalizedKey.includes("date") ||
                normalizedKey.includes("effective")
                  ? "date"
                  : normalizedKey.includes("price") ||
                      normalizedKey.includes("charge") ||
                      normalizedKey.includes("fee") ||
                      key === "discount" ||
                      key === "taxRate"
                    ? "number"
                    : "text"
              }
              step={
                normalizedKey.includes("price") ||
                normalizedKey.includes("charge") ||
                normalizedKey.includes("fee")
                  ? "0.0001"
                  : undefined
              }
              min={
                normalizedKey.includes("price") ||
                normalizedKey.includes("charge") ||
                normalizedKey.includes("fee")
                  ? 0
                  : undefined
              }
              onChange={(event) => change(key, event.target.value)}
              required={[
                "code",
                "name",
                "displayName",
                "monthlyPrice",
                "legalCompanyName",
                "pan",
                "primaryContactName",
                "primaryContactMobile",
                "primaryContactEmail",
                "adminName",
                "adminEmail",
                "adminMobile",
                "registeredAddressLine1",
                "city",
                "district",
                "state",
                "pinCode",
                "packageStartDate",
                "effectiveFrom",
              ].includes(key)}
            />
          </label>
        );
      })}
    </>
  );
}
function Select({
  label = "Selection",
  value,
  change,
  options,
}: {
  label?: string;
  value: string;
  change: (value: string) => void;
  options: string[];
}) {
  return (
    <label>
      {label}
      <select value={value} onChange={(event) => change(event.target.value)}>
        {options.map((option) => (
          <option key={option}>{option}</option>
        ))}
      </select>
    </label>
  );
}
function DataTable({ headings, rows }: { headings: string[]; rows: any[][] }) {
  return (
    <div className="sa-table-wrap">
      <table>
        <thead>
          <tr>
            {headings.map((heading) => (
              <th key={heading}>{heading}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length ? (
            rows.map((row, index) => (
              <tr key={index}>
                {row.map((cell, cellIndex) => (
                  <td key={cellIndex}>{cell}</td>
                ))}
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={headings.length}>No records yet.</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
