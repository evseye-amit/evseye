"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */

import { FormEvent, useCallback, useEffect, useState } from "react";
import Link from "next/link";

const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000/api/v1";
const ACCESS_TOKEN_KEY = "evs-eye-access-token";
const REFRESH_TOKEN_KEY = "evs-eye-refresh-token";
type Tab = "dashboard" | "clients" | "oems" | "packages" | "pricing";
type Item = Record<string, any>;

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
      () =>
        request(
          editingOemId ? `/platform/oems/${editingOemId}` : "/platform/oems",
          { method: editingOemId ? "PUT" : "POST", body: JSON.stringify(oem) },
          token,
        ),
      editingOemId ? "OEM updated." : "OEM created.",
      () => {
        setOem(emptyOem);
        setEditingOemId(null);
      },
    );
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
    ["oems", "OEM master", "▣"],
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
                <h2>OEM master</h2>
                <p>
                  Create and manage manufacturers visible across the platform.
                </p>
              </div>
            </section>
            <section className="sa-management">
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
                <button disabled={loading}>
                  {editingOemId ? "Update OEM" : "Save OEM"}
                </button>
              </form>
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
                  {features.map((feature) => (
                    <label key={feature.id}>
                      <input
                        type="checkbox"
                        checked={selectedFeatureIds.includes(feature.id)}
                        onChange={(event) =>
                          setSelectedFeatureIds((current) =>
                            event.target.checked
                              ? [...current, feature.id]
                              : current.filter((id) => id !== feature.id),
                          )
                        }
                      />
                      {feature.name}
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
                    {features.map((feature) => (
                      <option key={feature.id} value={feature.id}>
                        {feature.name}
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
