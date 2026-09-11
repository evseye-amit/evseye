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
  | "features"
  | "packages"
  | "pricing";
type Item = Record<string, any>;

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
      "Content-Type": "application/json",
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
  type: "VEHICLE",
  status: "ACTIVE",
  website: "",
  description: "",
};
const emptyPackage = {
  code: "",
  name: "",
  monthlyPrice: "",
  yearlyPrice: "",
  currency: "INR",
  status: "ACTIVE",
  description: "",
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
  pricingModel: "PER_UNIT",
  billingUnit: "verification",
  unitPrice: "",
  costPrice: "",
  currency: "INR",
};

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
  const [packages, setPackages] = useState<Item[]>([]);
  const [features, setFeatures] = useState<Item[]>([]);
  const [pricing, setPricing] = useState<Item[]>([]);
  const [oem, setOem] = useState(emptyOem);
  const [editingOemId, setEditingOemId] = useState<string | null>(null);
  const [showOemForm, setShowOemForm] = useState(false);
  const [showOemBulk, setShowOemBulk] = useState(false);
  const [oemLogoFile, setOemLogoFile] = useState<File | null>(null);
  const [oemLogoPreview, setOemLogoPreview] = useState("");
  const [feature, setFeature] = useState(emptyFeature);
  const [editingFeatureId, setEditingFeatureId] = useState<string | null>(null);
  const [showFeatureForm, setShowFeatureForm] = useState(false);
  const [showFeatureBulk, setShowFeatureBulk] = useState(false);
  const [pack, setPack] = useState(emptyPackage);
  const [editingPackageId, setEditingPackageId] = useState<string | null>(null);
  const [selectedFeatureIds, setSelectedFeatureIds] = useState<string[]>([]);
  const [price, setPrice] = useState(emptyPricing);
  const [editingPricingId, setEditingPricingId] = useState<string | null>(null);
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
        packageList,
        featureList,
        priceList,
      ] = await Promise.all([
        request("/platform/dashboard", {}, token),
        request("/platform/clients", {}, token),
        request("/platform/oems", {}, token),
        request("/platform/packages", {}, token),
        request("/platform/features", {}, token),
        request("/platform/feature-pricing", {}, token),
      ]);
      setSummary(dashboard);
      setClients(clientList);
      setOems(oemList);
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
      "oem_code,oem_name,display_name,oem_type,status,logo_url,website,description\nZELIO,Zelio Auto Private Limited,Zelio,VEHICLE,ACTIVE,,,\n";
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
        "oem_type",
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
          type,
          status,
          logoUrl,
          website,
          description,
        ] = parseCsvLine(line);
        return {
          code,
          name,
          displayName,
          type,
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
              monthlyPrice: Number(pack.monthlyPrice),
              ...(pack.yearlyPrice
                ? { yearlyPrice: Number(pack.yearlyPrice) }
                : {}),
              featureIds: selectedFeatureIds,
            }),
          },
          token,
        ),
      editingPackageId ? "Package updated." : "Package created.",
      () => {
        setPack(emptyPackage);
        setSelectedFeatureIds([]);
        setEditingPackageId(null);
      },
    );
  }
  async function submitPricing(event: FormEvent) {
    event.preventDefault();
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
              unitPrice: Number(price.unitPrice),
              ...(price.costPrice
                ? { costPrice: Number(price.costPrice) }
                : {}),
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
    ["clients", "Clients", "♙"],
    ["oems", "OEM", "▣"],
    ["features", "Feature", "◇"],
    ["packages", "Packages", "◫"],
    ["pricing", "Feature pricing", "₹"],
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
                    value={oem.type}
                    change={(value) =>
                      setOem((current) => ({ ...current, type: value }))
                    }
                    options={[
                      "VEHICLE",
                      "BATTERY",
                      "IOT",
                      "CHARGER",
                      "MULTI_PRODUCT",
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
                  headings={["Code", "OEM", "Type", "Status", ""]}
                  rows={oems.map((item) => [
                    item.code,
                    item.displayName,
                    item.type,
                    item.status,
                    <button
                      key="edit"
                      className="secondary"
                      onClick={() => {
                        setOem({
                          code: item.code,
                          name: item.name,
                          displayName: item.displayName,
                          type: item.type,
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
                <h2>Package catalogue</h2>
                <p>
                  Define the commercial package and its enabled platform
                  features.
                </p>
              </div>
            </section>
            <section className="sa-management">
              <form className="sa-form" onSubmit={submitPackage}>
                <h3>Create package</h3>
                <TextFields
                  value={pack}
                  change={(key, value) =>
                    setPack((current) => ({ ...current, [key]: value }))
                  }
                  fields={[
                    ["code", "Package code"],
                    ["name", "Package name"],
                    ["monthlyPrice", "Monthly price"],
                    ["yearlyPrice", "Yearly price"],
                    ["description", "Description"],
                  ]}
                />
                <Select
                  value={pack.status}
                  change={(value) =>
                    setPack((current) => ({ ...current, status: value }))
                  }
                  options={["ACTIVE", "INACTIVE", "SUSPENDED"]}
                />
                <div className="sa-checkbox-list">
                  {features
                    .filter(
                      (feature) =>
                        feature.isActive ||
                        selectedFeatureIds.includes(feature.id),
                    )
                    .map((feature) => (
                      <label key={feature.id}>
                        <input
                          type="checkbox"
                          checked={selectedFeatureIds.includes(feature.id)}
                          disabled={!feature.isActive}
                          onChange={(event) =>
                            setSelectedFeatureIds((current) =>
                              event.target.checked
                                ? [...current, feature.id]
                                : current.filter((id) => id !== feature.id),
                            )
                          }
                        />
                        {feature.name}
                        {!feature.isActive ? " (inactive)" : ""}
                      </label>
                    ))}
                </div>
                <button disabled={loading}>
                  {editingPackageId ? "Update package" : "Save package"}
                </button>
              </form>
              <DataTable
                headings={["Code", "Package", "Monthly", "Features", ""]}
                rows={packages.map((item) => [
                  item.code,
                  item.name,
                  `₹${item.monthlyPrice}`,
                  item.features?.length ?? 0,
                  <button
                    key="edit"
                    className="secondary"
                    onClick={() => {
                      setPack({
                        code: item.code,
                        name: item.name,
                        monthlyPrice: String(item.monthlyPrice),
                        yearlyPrice: item.yearlyPrice
                          ? String(item.yearlyPrice)
                          : "",
                        currency: item.currency,
                        status: item.status,
                        description: item.description ?? "",
                      });
                      setSelectedFeatureIds(
                        (item.features ?? []).map(
                          (link: Item) => link.featureId,
                        ),
                      );
                      setEditingPackageId(item.id);
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
            </section>
          </>
        )}
        {tab === "pricing" && (
          <>
            <section className="sa-page-head">
              <div>
                <h2>Feature pricing</h2>
                <p>
                  Price KYC, onboarding, telematics, and other metered
                  capabilities.
                </p>
              </div>
            </section>
            <section className="sa-management">
              <form className="sa-form" onSubmit={submitPricing}>
                <h3>Add feature price</h3>
                <label>
                  Feature
                  <select
                    value={price.featureId}
                    onChange={(event) =>
                      setPrice((current) => ({
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
                  value={price.pricingModel}
                  change={(value) =>
                    setPrice((current) => ({ ...current, pricingModel: value }))
                  }
                  options={[
                    "INCLUDED",
                    "PER_UNIT",
                    "PER_RIDER",
                    "PER_VEHICLE_DEVICE",
                    "TIERED_VOLUME",
                    "FLAT_FEE",
                    "CUSTOM",
                  ]}
                />
                <TextFields
                  value={price}
                  change={(key, value) =>
                    setPrice((current) => ({ ...current, [key]: value }))
                  }
                  fields={[
                    ["billingUnit", "Billing unit"],
                    ["unitPrice", "Unit price"],
                    ["costPrice", "Vendor cost"],
                  ]}
                />
                <button disabled={loading}>
                  {editingPricingId ? "Update pricing" : "Save pricing"}
                </button>
              </form>
              <DataTable
                headings={["Feature", "Model", "Unit price", "Status", ""]}
                rows={pricing.map((item) => [
                  item.feature?.name,
                  item.pricingModel,
                  `₹${item.unitPrice}`,
                  item.isActive ? "ACTIVE" : "INACTIVE",
                  <button
                    key="edit"
                    className="secondary"
                    onClick={() => {
                      setPrice({
                        featureId: item.featureId,
                        pricingModel: item.pricingModel,
                        billingUnit: item.billingUnit,
                        unitPrice: String(item.unitPrice),
                        costPrice: item.costPrice ? String(item.costPrice) : "",
                        currency: item.currency,
                      });
                      setEditingPricingId(item.id);
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
      {fields.map(([key, label]) => (
        <label key={key}>
          {label}
          <input
            value={value[key] ?? ""}
            type={
              key.toLowerCase().includes("date")
                ? "date"
                : key.includes("Price") ||
                    key === "discount" ||
                    key === "taxRate"
                  ? "number"
                  : key.includes("description")
                    ? "text"
                    : "text"
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
            ].includes(key)}
          />
        </label>
      ))}
    </>
  );
}
function Select({
  value,
  change,
  options,
}: {
  value: string;
  change: (value: string) => void;
  options: string[];
}) {
  return (
    <label>
      Selection
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
