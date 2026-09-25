"use client";
import { sessionFetch as fetch } from "../../lib/session-fetch";
import {
  batterySlots,
  batteryTypes,
  enumOptionLabel,
  fleetOwnershipTypes,
  hubStatuses,
  hubTypes,
  insuranceTypes,
  vehicleSpeedTypes,
} from "../../lib/domain-enums";

import { ClientBrand } from "../components/client-brand";
import { LanguageSwitcher, useLocale } from "../components/locale-provider";
import Link from "next/link";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import * as XLSX from "xlsx";

const API_URL =
  "/api/v1";
const ACCESS_TOKEN_KEY = "evs-eye-session-present";
const REFRESH_TOKEN_KEY = "evs-eye-session-refreshable";

type Bootstrap = {
  client: {
    name: string;
    companyCode?: string;
    status: string;
    rejectionReason?: string | null;
    rejectedAt?: string | null;
  };
  route: "ONBOARDING" | "WAITING" | "SUSPENDED" | "DASHBOARD";
  progress: { currentStep: string; steps: { step: string; status: string }[] };
};

type ClientDashboard = {
  hubs: number;
  fleets: number;
  riders: number;
  fleetManagers: number;
  teamLeaders: number;
  activeAllocations: number;
  fleetByStatus: Record<string, number>;
  riderByStatus: Record<string, number>;
};

type FleetOnboardingOptions = {
  oems: { id: string; code: string; displayName: string }[];
  vehicleCategories: { id: string; code: string; name: string }[];
  vehicleTypes: {
    id: string;
    categoryId: string;
    code: string;
    name: string;
    energyType: string;
    usageType?: string | null;
  }[];
};
type FleetOnboardingWorkbookRows = {
  fleets: Record<string, string>[];
  batteries: Record<string, string>[];
  controllers: Record<string, string>[];
  iotDevices: Record<string, string>[];
};

type FleetEvidenceStatus = {
  ready: boolean;
  items: Array<{
    entityType: string;
    entityId: string;
    label: string | null;
    requiredPhotoTypes: string[];
    completedPhotoTypes: string[];
    missingPhotoTypes: string[];
    ready: boolean;
  }>;
};

export default function ClientHome() {
  const { t } = useLocale();
  const [brandingToken, setBrandingToken] = useState("");
  const [data, setData] = useState<Bootstrap | null>(null);
  const [dashboard, setDashboard] = useState<ClientDashboard | null>(null);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [selectedStep, setSelectedStep] = useState<string | null>(null);
  useEffect(() => {
    const token = sessionStorage.getItem(ACCESS_TOKEN_KEY);
    if (!token) {
      window.location.assign("/");
      return;
    }
    fetch(`${API_URL}/client/bootstrap`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok)
          throw new Error(
            body.error?.message ??
              body.message ??
              "Unable to load client workspace.",
          );
        setBrandingToken(token);
        setData(body.data);
        if (body.data.route === "DASHBOARD") {
          const dashboardResponse = await fetch(`${API_URL}/client/dashboard`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          const dashboardBody = await dashboardResponse.json();
          if (!dashboardResponse.ok) {
            throw new Error(
              dashboardBody.error?.message ??
                dashboardBody.message ??
                "Unable to load the operational dashboard.",
            );
          }
          setDashboard(dashboardBody.data);
        }
      })
      .catch((cause: unknown) =>
        setError(
          cause instanceof Error
            ? cause.message
            : "Unable to load client workspace.",
        ),
      );
  }, [refresh]);
  useEffect(() => {
    if (data?.route === "DASHBOARD") {
      window.location.replace("/?workspace=operations");
    }
  }, [data?.route]);
  if (error)
    return (
      <main className="client-gate">
        <section>
          <h1>{t("Unable to open workspace")}</h1>
          <p>{error}</p>
          <Link href="/">{t("Return to login")}</Link>
        </section>
      </main>
    );
  if (!data)
    return (
      <main className="client-gate">
        <section>
          <p>{t("Loading client workspace…")}</p>
        </section>
      </main>
    );
  const labels: Record<string, string> = {
    HUBS: "Hub creation",
    FLEET_MANAGERS: "Fleet Manager creation",
    TEAM_LEADERS: "Team Leader creation",
    FLEETS: "Fleet creation",
    RIDERS: "Rider creation",
    REVIEW: "Review & submit",
  };
  const activeStep = selectedStep ?? data.progress.currentStep;
  const activeStepNumber =
    data.progress.steps.findIndex((step) => step.step === activeStep) + 1;
  const refreshOnboarding = () => {
    setSelectedStep(null);
    setRefresh((value) => value + 1);
  };
  if (data.route === "WAITING")
    return (
      <Gate
        title={t("Onboarding under review")}
        text="Your onboarding submission is with EVs Eye for approval. We will notify your Client Admin once the workspace is activated."
      />
    );
  if (data.route === "SUSPENDED")
    return (
      <Gate
        title={t("Workspace access suspended")}
        text="This Client workspace is currently suspended. Please contact EVs Eye support."
      />
    );
  if (data.route === "DASHBOARD")
    return (
      <Gate
        title={t("Opening Operations workspace")}
        text="Your Client is active. Redirecting you to the live operations dashboard."
      />
    );
  return (
    <main className="client-workspace">
      <aside className="client-onboarding-sidebar">
        <LanguageSwitcher />
        <ClientBrand token={brandingToken} />
        <p className="eyebrow">{t("CLIENT ONBOARDING")}</p>
        <h1>{t("Set up")} {data.client.name}</h1>
        <p>
          {t("Save your progress at any time. You will resume from the latest incomplete step after login.")}
        </p>
        <ol className="client-steps">
          {data.progress.steps.map((step, index) => (
            <li
              key={step.step}
              className={
                step.step === activeStep ? "current" : step.status.toLowerCase()
              }
            >
              <button
                type="button"
                onClick={() => setSelectedStep(step.step)}
                aria-label={`Open ${labels[step.step]}`}
              >
                <b>{index + 1}</b>
                <strong>{t(labels[step.step])}</strong>
                <span>{t(step.status.replaceAll("_", " "))}</span>
              </button>
            </li>
          ))}
        </ol>
      </aside>
      <section className="client-onboarding-main">
        {data.client.status === "REJECTED" ? (
          <section className="client-rejection-note" role="status">
            <strong>{t("Changes requested by EVs Eye")}</strong>
            <p>
              {data.client.rejectionReason ||
                "Please review and correct the requested onboarding information, then resubmit it for approval."}
            </p>
            <div className="client-rejection-actions">
              <span>Open the relevant setup section to make corrections:</span>
              <button type="button" onClick={() => setSelectedStep("HUBS")}>
                {t("Hubs")}
              </button>
              <button
                type="button"
                onClick={() => setSelectedStep("FLEET_MANAGERS")}
              >
                {t("Fleet Managers")}
              </button>
              <button type="button" onClick={() => setSelectedStep("FLEETS")}>
                {t("Fleets")}
              </button>
              <button
                type="button"
                onClick={() => setSelectedStep("TEAM_LEADERS")}
              >
                {t("Team Leaders")}
              </button>
              <button type="button" onClick={() => setSelectedStep("RIDERS")}>
                {t("Riders")}
              </button>
            </div>
          </section>
        ) : null}
        <header className="client-onboarding-context">
          <span>
            Step {activeStepNumber} of {data.progress.steps.length}
          </span>
          <p>
            {labels[activeStep]} is open. Your saved records remain intact; you
            can return to any section to make corrections before resubmitting.
          </p>
        </header>
        {activeStep === "HUBS" ? (
          <HubSetup onSaved={refreshOnboarding} />
        ) : activeStep === "FLEET_MANAGERS" ? (
          <FleetManagerSetup onSaved={refreshOnboarding} />
        ) : activeStep === "TEAM_LEADERS" ? (
          <TeamLeaderSetup onSaved={refreshOnboarding} />
        ) : activeStep === "FLEETS" ? (
          <FleetSetup onSaved={refreshOnboarding} />
        ) : activeStep === "RIDERS" ? (
          <RiderSetup onSaved={refreshOnboarding} />
        ) : activeStep === "REVIEW" ? (
          <ReviewSubmit onSaved={refreshOnboarding} />
        ) : (
          <section className="client-next-step">
            <strong>{labels[activeStep]}</strong>
            <p>
              This step is ready to continue. The matching single-create and
              bulk import workspace is the next onboarding delivery.
            </p>
          </section>
        )}
      </section>
    </main>
  );
}

function RiderSetup({ onSaved }: { onSaved: () => void }) {
  const [existingRiders, setExistingRiders] = useState<
    Record<string, unknown>[]
  >([]);
  const [editingRiderId, setEditingRiderId] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: "",
    mobile: "",
    riderCode: "",
    city: "",
    state: "",
    emergencyContactName: "",
    emergencyContactMobile: "",
  });
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [filename, setFilename] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const token = () => sessionStorage.getItem(ACCESS_TOKEN_KEY) ?? "";
  useEffect(() => {
    fetch(`${API_URL}/riders?page=1&pageSize=50`, {
      headers: { Authorization: `Bearer ${token()}` },
    })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok)
          throw new Error(body.message ?? "Unable to load Riders.");
        setExistingRiders(body.data?.items ?? []);
      })
      .catch((cause: unknown) =>
        setMessage(
          cause instanceof Error ? cause.message : "Unable to load Riders.",
        ),
      );
  }, []);
  const request = async (path: string, body?: unknown, method = "POST") => {
    const response = await fetch(`${API_URL}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token()}`,
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const result = await response.json();
    if (!response.ok)
      throw new Error(
        result.error?.message ?? result.message ?? "Request failed.",
      );
    return result.data;
  };
  const create = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      await request(
        editingRiderId ? `/riders/${editingRiderId}` : "/riders",
        Object.fromEntries(
          Object.entries(form).map(([key, value]) => [key, value || undefined]),
        ),
        editingRiderId ? "PATCH" : "POST",
      );
      setMessage(
        editingRiderId
          ? "Rider updated successfully."
          : "Rider created. Your onboarding review is ready.",
      );
      setEditingRiderId(null);
      onSaved();
    } catch (cause) {
      setMessage(
        cause instanceof Error ? cause.message : "Unable to create Rider.",
      );
    } finally {
      setBusy(false);
    }
  };
  const skip = async () => {
    setBusy(true);
    setMessage("");
    try {
      await request("/client/onboarding/steps/skip", { step: "RIDERS" });
      setMessage("Rider creation skipped. You can add Riders later.");
      onSaved();
    } catch (cause) {
      setMessage(
        cause instanceof Error ? cause.message : "Unable to skip this step.",
      );
    } finally {
      setBusy(false);
    }
  };
  const parseCsv = (file: File) => {
    setFilename(file.name);
    const reader = new FileReader();
    reader.onload = () => {
      const lines = String(reader.result ?? "")
        .split(/\r?\n/)
        .filter(Boolean);
      const [header, ...body] = lines;
      const columns = header.split(",").map((value) => value.trim());
      setRows(
        body.map((line) =>
          Object.fromEntries(
            columns.map((column, index) => [
              column,
              line.split(",")[index]?.trim() ?? "",
            ]),
          ),
        ),
      );
    };
    reader.readAsText(file);
  };
  const bulkCreate = async () => {
    if (!rows.length) return;
    setBusy(true);
    setMessage("");
    try {
      const result = await request("/riders/bulk", {
        filename,
        rows: rows.map((row) => ({
          name: row.name,
          mobile: row.mobile,
          riderCode: row.riderCode || undefined,
          city: row.city || undefined,
          state: row.state || undefined,
          emergencyContactName: row.emergencyContactName || undefined,
          emergencyContactMobile: row.emergencyContactMobile || undefined,
        })),
      });
      setMessage(
        `Import ${result.status.replaceAll("_", " ")}: ${result.passedRows} passed, ${result.failedRows} failed.`,
      );
      if (result.failedRows && result.jobId) {
        const response = await fetch(
          `${API_URL}/riders/imports/${result.jobId}/failed-records`,
          { headers: { Authorization: `Bearer ${token()}` } },
        );
        const csv = await response.text();
        const anchor = document.createElement("a");
        anchor.href = URL.createObjectURL(
          new Blob([csv], { type: "text/csv" }),
        );
        anchor.download = "rider-import-failures.csv";
        anchor.click();
        URL.revokeObjectURL(anchor.href);
      }
      onSaved();
    } catch (cause) {
      setMessage(
        cause instanceof Error ? cause.message : "Unable to import Riders.",
      );
    } finally {
      setBusy(false);
    }
  };
  const downloadTemplate = () => {
    const csv =
      "name,mobile,riderCode,city,state,emergencyContactName,emergencyContactMobile\nRahul Verma,+919100000003,RID-001,New Delhi,Delhi,Anita Verma,+919100000004\n";
    const anchor = document.createElement("a");
    anchor.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    anchor.download = "evs-eye-riders-template.csv";
    anchor.click();
    URL.revokeObjectURL(anchor.href);
  };
  const editRider = (rider: Record<string, unknown>) => {
    setForm({
      name: String(rider.name ?? ""),
      mobile: String(rider.mobile ?? ""),
      riderCode: String(rider.riderCode ?? ""),
      city: String(rider.city ?? ""),
      state: String(rider.state ?? ""),
      emergencyContactName: String(rider.emergencyContactName ?? ""),
      emergencyContactMobile: String(rider.emergencyContactMobile ?? ""),
    });
    setEditingRiderId(String(rider.id));
    setMessage("");
  };
  return (
    <section className="client-onboarding-action">
      <div className="client-action-title-row">
        <div>
          <p className="eyebrow">STEP 5 · RIDERS · OPTIONAL</p>
          <h2>Create your Rider roster</h2>
          <p>
            Add riders now, or continue to review and create them later from
            operations.
          </p>
        </div>
        <button
          className="client-skip-button"
          type="button"
          disabled={busy}
          onClick={skip}
        >
          Skip for now
        </button>
      </div>
      {existingRiders.length ? (
        <section className="client-existing-records">
          <div>
            <strong>Saved Riders</strong>
            <span>Select a Rider to update their submitted details.</span>
          </div>
          {existingRiders.map((rider) => (
            <button
              key={String(rider.id)}
              type="button"
              onClick={() => editRider(rider)}
            >
              <b>{String(rider.name ?? "Rider")}</b>
              <span>
                {String(rider.mobile ?? "")} ·{" "}
                {String(rider.riderCode ?? "No rider code")}
              </span>
              <i>Edit</i>
            </button>
          ))}
        </section>
      ) : null}
      <div className="client-onboarding-options">
        <form onSubmit={create} className="client-hub-form">
          {editingRiderId ? (
            <div className="client-editing-banner client-form-wide">
              Editing an existing Rider.{" "}
              <button type="button" onClick={() => setEditingRiderId(null)}>
                Cancel edit
              </button>
            </div>
          ) : null}
          <label>
            Name *
            <input
              required
              value={form.name}
              onChange={(event) =>
                setForm({ ...form, name: event.target.value })
              }
              placeholder="Rider name"
            />
          </label>
          <label>
            Mobile *
            <input
              required
              value={form.mobile}
              onChange={(event) =>
                setForm({ ...form, mobile: event.target.value })
              }
              placeholder="+919100000003"
            />
          </label>
          <label>
            Rider code (optional)
            <input
              value={form.riderCode}
              onChange={(event) =>
                setForm({ ...form, riderCode: event.target.value })
              }
              placeholder="RID-001"
            />
          </label>
          <label>
            City (optional)
            <input
              value={form.city}
              onChange={(event) =>
                setForm({ ...form, city: event.target.value })
              }
              placeholder="New Delhi"
            />
          </label>
          <label>
            State (optional)
            <input
              value={form.state}
              onChange={(event) =>
                setForm({ ...form, state: event.target.value })
              }
              placeholder="Delhi"
            />
          </label>
          <label>
            Emergency contact name
            <input
              value={form.emergencyContactName}
              onChange={(event) =>
                setForm({ ...form, emergencyContactName: event.target.value })
              }
              placeholder="Contact name"
            />
          </label>
          <label className="client-form-wide">
            Emergency mobile
            <input
              value={form.emergencyContactMobile}
              onChange={(event) =>
                setForm({ ...form, emergencyContactMobile: event.target.value })
              }
              placeholder="+919100000004"
            />
          </label>
          <button disabled={busy} type="submit">
            {busy
              ? "Saving…"
              : editingRiderId
                ? "Update Rider"
                : "Create Rider"}
          </button>
        </form>
        <div className="client-bulk-card">
          <h3>Bulk upload</h3>
          <p>Import an initial Rider roster now; KYC can be completed later.</p>
          <button
            type="button"
            className="secondary-button"
            onClick={downloadTemplate}
          >
            Download template
          </button>
          <label className="client-file-input">
            Upload CSV
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={(event) =>
                event.target.files?.[0] && parseCsv(event.target.files[0])
              }
            />
          </label>
          {rows.length ? (
            <p>
              {rows.length} row{rows.length === 1 ? "" : "s"} ready from{" "}
              {filename}.
            </p>
          ) : null}
          <button
            disabled={busy || !rows.length}
            type="button"
            onClick={bulkCreate}
          >
            {busy ? "Importing…" : "Import Riders"}
          </button>
        </div>
      </div>
      {message ? <p className="client-action-message">{message}</p> : null}
    </section>
  );
}

function ReviewSubmit({ onSaved }: { onSaved: () => void }) {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    setMessage("");
    try {
      const token = sessionStorage.getItem(ACCESS_TOKEN_KEY) ?? "";
      const response = await fetch(`${API_URL}/client/onboarding/submit`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = await response.json();
      if (!response.ok)
        throw new Error(
          body.error?.message ?? body.message ?? "Unable to submit onboarding.",
        );
      setMessage("Onboarding submitted for EVs Eye approval.");
      onSaved();
    } catch (cause) {
      setMessage(
        cause instanceof Error ? cause.message : "Unable to submit onboarding.",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="client-onboarding-action client-review">
      <p className="eyebrow">STEP 6 · REVIEW</p>
      <h2>Ready to submit for approval</h2>
      <p>
        Confirm that your Hub, Fleet Manager, and Fleet setup is complete.
        Optional Team Leader and Rider records can be added later.
      </p>
      <button type="button" disabled={busy} onClick={submit}>
        {busy ? "Submitting…" : "Submit for onboarding approval"}
      </button>
      {message ? <p className="client-action-message">{message}</p> : null}
    </section>
  );
}

function FleetSetup({ onSaved }: { onSaved: () => void }) {
  const [hubs, setHubs] = useState<HubOption[]>([]);
  const [existingFleets, setExistingFleets] = useState<
    Record<string, unknown>[]
  >([]);
  const [editingFleetId, setEditingFleetId] = useState<string | null>(null);
  const [options, setOptions] = useState<FleetOnboardingOptions>({
    oems: [],
    vehicleCategories: [],
    vehicleTypes: [],
  });
  const [form, setForm] = useState({
    fleetCode: "",
    vehicleNumber: "",
    chassisNumber: "",
    vinNumber: "",
    oemId: "",
    vehicleCategoryId: "",
    vehicleTypeId: "",
    speedType: "",
    homeHubId: "",
    modelName: "",
    variantName: "",
    colour: "",
    motorNumber: "",
    manufacturingYear: "",
    manufacturingMonth: "",
    ownershipType: "",
    odometerKm: "",
    registrationDate: "",
    registeringAuthority: "",
    rcExpiryDate: "",
    insuranceProviderName: "",
    insurancePolicyNumber: "",
    insuranceType: "",
    insuranceStartDate: "",
    insuranceEndDate: "",
    fitnessCertificateNumber: "",
    fitnessExpiryDate: "",
  });
  const [workbookRows, setWorkbookRows] = useState<FleetOnboardingWorkbookRows>({
    fleets: [], batteries: [], controllers: [], iotDevices: [],
  });
  const [filename, setFilename] = useState("");
  const [importResult, setImportResult] = useState<{
    status: string;
    passedRows: number;
    failedRows: number;
  } | null>(null);
  const [importedIotCredentials, setImportedIotCredentials] = useState<Array<{ deviceNumber: string; ingestSecret: string }>>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [createdFleet, setCreatedFleet] = useState<{
    id: string;
    vehicleNumber?: string | null;
    chassisNumber: string;
  } | null>(null);
  const [componentsReady, setComponentsReady] = useState(false);
  const [editingComponents, setEditingComponents] = useState(false);
  const token = () => sessionStorage.getItem(ACCESS_TOKEN_KEY) ?? "";
  useEffect(() => {
    Promise.all([
      fetch(`${API_URL}/hubs`, {
        headers: { Authorization: `Bearer ${token()}` },
      }),
      fetch(`${API_URL}/fleets/onboarding-options`, {
        headers: { Authorization: `Bearer ${token()}` },
      }),
      fetch(`${API_URL}/fleets?page=1&pageSize=50`, {
        headers: { Authorization: `Bearer ${token()}` },
      }),
    ])
      .then(async ([hubsResponse, optionsResponse, fleetsResponse]) => {
        const [hubsBody, optionsBody, fleetsBody] = await Promise.all([
          hubsResponse.json(),
          optionsResponse.json(),
          fleetsResponse.json(),
        ]);
        if (!hubsResponse.ok)
          throw new Error(hubsBody.message ?? "Unable to load Hubs.");
        if (!optionsResponse.ok)
          throw new Error(
            optionsBody.message ?? "Unable to load Fleet master data.",
          );
        if (!fleetsResponse.ok)
          throw new Error(fleetsBody.message ?? "Unable to load saved Fleets.");
        setHubs(hubsBody.data);
        setOptions(optionsBody.data);
        setExistingFleets(fleetsBody.data?.items ?? []);
      })
      .catch((cause: unknown) =>
        setMessage(
          cause instanceof Error ? cause.message : "Unable to load Hubs.",
        ),
      );
  }, []);
  const request = async (path: string, body: unknown, method = "POST") => {
    const response = await fetch(`${API_URL}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    const result = await response.json();
    if (!response.ok)
      throw new Error(
        result.error?.message ?? result.message ?? "Request failed.",
      );
    return result.data;
  };
  const create = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const payload = {
        ...form,
        fleetCode: form.fleetCode.trim() || undefined,
        vehicleNumber: form.vehicleNumber.trim().toUpperCase() || undefined,
        chassisNumber: form.chassisNumber.trim().toUpperCase(),
        vinNumber: form.vinNumber.trim().toUpperCase() || undefined,
        homeHubId: form.homeHubId || undefined,
        currentHubId: form.homeHubId || undefined,
        modelName: form.modelName || undefined,
        variantName: form.variantName || undefined,
        colour: form.colour || undefined,
        motorNumber: form.motorNumber || undefined,
        manufacturingYear: form.manufacturingYear
          ? Number(form.manufacturingYear)
          : undefined,
        manufacturingMonth: form.manufacturingMonth
          ? Number(form.manufacturingMonth)
          : undefined,
        odometerKm: form.odometerKm ? Number(form.odometerKm) : undefined,
        registrationDate: form.registrationDate || undefined,
        registeringAuthority: form.registeringAuthority || undefined,
        rcExpiryDate: form.rcExpiryDate || undefined,
        insuranceProviderName: form.insuranceProviderName || undefined,
        insurancePolicyNumber: form.insurancePolicyNumber || undefined,
        insuranceType: form.insuranceType || undefined,
        insuranceStartDate: form.insuranceStartDate || undefined,
        insuranceEndDate: form.insuranceEndDate || undefined,
        fitnessCertificateNumber: form.fitnessCertificateNumber || undefined,
        fitnessExpiryDate: form.fitnessExpiryDate || undefined,
      };
      const fleet = await request(
        editingFleetId ? `/fleets/${editingFleetId}` : "/fleets",
        payload,
        editingFleetId ? "PATCH" : "POST",
      );
      if (editingFleetId) {
        setEditingFleetId(null);
        setEditingComponents(true);
        setComponentsReady(false);
        setCreatedFleet(fleet);
      } else {
        setEditingComponents(false);
        setCreatedFleet(fleet);
        setMessage(
          "Fleet created. Complete its required evidence before activation.",
        );
      }
    } catch (cause) {
      setMessage(
        cause instanceof Error ? cause.message : "Unable to create Fleet.",
      );
    } finally {
      setBusy(false);
    }
  };
  const parseWorkbook = async (file: File) => {
    setMessage("");
    setFilename(file.name);
    try {
      const workbook = XLSX.read(await file.arrayBuffer(), { type: "array" });
      const sheetRows = (name: string) => {
        const sheet = workbook.Sheets[name];
        return sheet
          ? XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" }).map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) => [key.trim(), String(value ?? "").trim()])))
          : [];
      };
      const next = {
        fleets: sheetRows("Fleets"), batteries: sheetRows("Batteries"),
        controllers: sheetRows("Controllers"), iotDevices: sheetRows("IoT Devices"),
      };
      if (!next.fleets.length) throw new Error("The workbook must include at least one row on the Fleets sheet.");
      setWorkbookRows(next);
    } catch (cause) {
      setWorkbookRows({ fleets: [], batteries: [], controllers: [], iotDevices: [] });
      setFilename("");
      setMessage(cause instanceof Error ? cause.message : "Unable to read the onboarding workbook.");
    }
  };
  const bulkCreate = async () => {
    if (!workbookRows.fleets.length) return;
    setBusy(true);
    setMessage("");
    try {
      const oemByCode = new Map(options.oems.map((item) => [item.code.toUpperCase(), item.id]));
      const categoryByCode = new Map(options.vehicleCategories.map((item) => [item.code.toUpperCase(), item.id]));
      const typeByCode = new Map(options.vehicleTypes.map((item) => [item.code.toUpperCase(), item.id]));
      const hubByCode = new Map(hubs.map((item) => [String(item.code).toUpperCase(), item.id]));
      const fleetByReference = new Map<string, string>();
      existingFleets.forEach((fleet) => {
        if (fleet.fleetCode) fleetByReference.set(String(fleet.fleetCode).toUpperCase(), String(fleet.id));
        if (fleet.chassisNumber) fleetByReference.set(String(fleet.chassisNumber).toUpperCase(), String(fleet.id));
      });
      const failures: string[] = [];
      const iotCredentials: Array<{ deviceNumber: string; ingestSecret: string }> = [];
      let passedRows = 0;
      const number = (value: string) => value ? Number(value) : undefined;
      for (const [index, row] of workbookRows.fleets.entries()) {
        try {
          const oemId = oemByCode.get((row.oemCode ?? "").toUpperCase());
          const vehicleCategoryId = categoryByCode.get((row.vehicleCategoryCode ?? "").toUpperCase());
          const vehicleTypeId = typeByCode.get((row.vehicleTypeCode ?? "").toUpperCase());
          const homeHubId = row.homeHubCode ? hubByCode.get(row.homeHubCode.toUpperCase()) : undefined;
          const currentHubId = row.currentHubCode ? hubByCode.get(row.currentHubCode.toUpperCase()) : homeHubId;
          if (!row.chassisNumber || !oemId || !vehicleCategoryId || !vehicleTypeId || !row.speedType || !row.ownershipType) throw new Error("chassisNumber, OEM, vehicle category, vehicle type, speed type, and ownership type are required");
          if ((row.homeHubCode && !homeHubId) || (row.currentHubCode && !currentHubId)) throw new Error("homeHubCode or currentHubCode does not match a Hub");
          const fleet = await request("/fleets", {
            ...row, oemId, vehicleCategoryId, vehicleTypeId,
            homeHubId, currentHubId,
            manufacturingYear: number(row.manufacturingYear), manufacturingMonth: number(row.manufacturingMonth), odometerKm: number(row.odometerKm),
          });
          fleetByReference.set(String(fleet.chassisNumber).toUpperCase(), String(fleet.id));
          if (fleet.fleetCode) fleetByReference.set(String(fleet.fleetCode).toUpperCase(), String(fleet.id));
          passedRows += 1;
        } catch (cause) { failures.push(`Fleets row ${index + 2}: ${cause instanceof Error ? cause.message : "invalid row"}`); }
      }
      const fleetIdFor = (row: Record<string, string>) => {
        const reference = (row.fleetCode || row.chassisNumber || "").toUpperCase();
        const fleetId = fleetByReference.get(reference);
        if (!fleetId) throw new Error("fleetCode or chassisNumber does not match an imported or existing Fleet");
        return fleetId;
      };
      for (const [index, row] of workbookRows.batteries.entries()) try {
        if (!row.serialNumber) throw new Error("serialNumber is required");
        await request(`/fleets/${fleetIdFor(row)}/batteries`, { ...row, capacityKwh: number(row.capacityKwh), voltage: number(row.voltage), ampHour: number(row.ampHour), installedOdometerKm: number(row.installedOdometerKm) }); passedRows += 1;
      } catch (cause) { failures.push(`Batteries row ${index + 2}: ${cause instanceof Error ? cause.message : "invalid row"}`); }
      for (const [index, row] of workbookRows.controllers.entries()) try {
        if (!row.controllerNumber) throw new Error("controllerNumber is required");
        await request(`/fleets/${fleetIdFor(row)}/controllers`, { ...row, ratedVoltage: number(row.ratedVoltage), ratedCurrent: number(row.ratedCurrent) }); passedRows += 1;
      } catch (cause) { failures.push(`Controllers row ${index + 2}: ${cause instanceof Error ? cause.message : "invalid row"}`); }
      for (const [index, row] of workbookRows.iotDevices.entries()) try {
        if (!row.deviceNumber) throw new Error("deviceNumber is required");
        const registration = await request("/iot/devices", { ...row, fleetId: fleetIdFor(row) });
        iotCredentials.push({ deviceNumber: String(registration.device.deviceNumber), ingestSecret: String(registration.ingestSecret) });
        passedRows += 1;
      } catch (cause) { failures.push(`IoT Devices row ${index + 2}: ${cause instanceof Error ? cause.message : "invalid row"}`); }
      setImportedIotCredentials(iotCredentials);
      setImportResult({ status: failures.length ? (passedRows ? "PARTIAL_PASS" : "FAIL") : "PASS", passedRows, failedRows: failures.length });
      setMessage(failures.length ? `Imported ${passedRows} records. ${failures.length} failed: ${failures.slice(0, 3).join("; ")}` : `Imported ${passedRows} Fleet onboarding records successfully.`);
    } catch (cause) {
      setMessage(
        cause instanceof Error ? cause.message : "Unable to import Fleets.",
      );
    } finally {
      setBusy(false);
    }
  };
  const downloadTemplate = () => {
    const workbook = XLSX.utils.book_new();
    const sheets: Array<[string, Record<string, string>[]]> = [
      ["Fleets", [{ fleetCode: "FLT-0001", vehicleNumber: "DL01EV0001", chassisNumber: "ME4JF123456789001", vinNumber: "", oemCode: "ZELIO", vehicleCategoryCode: "2W", vehicleTypeCode: "E_SCOOTER_ELECTRIC", speedType: "HIGH_SPEED", homeHubCode: "HUB-DEL-01", currentHubCode: "", modelName: "Gracy", variantName: "", colour: "White", motorNumber: "", manufacturingYear: "2025", manufacturingMonth: "6", ownershipType: "CLIENT_OWNED", odometerKm: "0", registrationDate: "", registeringAuthority: "", rcExpiryDate: "", insuranceProviderName: "", insurancePolicyNumber: "", insuranceType: "", insuranceStartDate: "", insuranceEndDate: "", fitnessCertificateNumber: "", fitnessExpiryDate: "" }]],
      ["Batteries", [{ fleetCode: "FLT-0001", chassisNumber: "", serialNumber: "BAT-001", batteryCode: "BAT-0001", batteryType: "FIXED_SINGLE", batterySlot: "PRIMARY", manufacturer: "", model: "", chemistry: "", capacityKwh: "2.5", voltage: "", ampHour: "", installedOdometerKm: "0", manufacturingDate: "", warrantyStartDate: "", warrantyEndDate: "" }]],
      ["Controllers", [{ fleetCode: "FLT-0001", chassisNumber: "", controllerNumber: "CTRL-001", manufacturer: "", model: "", ratedVoltage: "", ratedCurrent: "" }]],
      ["IoT Devices", [{ fleetCode: "FLT-0001", chassisNumber: "", deviceNumber: "IOT-001", imei: "", simNumber: "", iccid: "", provider: "", model: "", installedAt: "" }]],
    ];
    sheets.forEach(([name, rows]) => XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows), name));
    XLSX.writeFile(workbook, "evs-eye-fleet-onboarding-template.xlsx");
  };
  const downloadIotCredentials = () => {
    const csv = ["deviceNumber,ingestSecret", ...importedIotCredentials.map((credential) => `${credential.deviceNumber},${credential.ingestSecret}`)].join("\n");
    const anchor = document.createElement("a");
    anchor.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    anchor.download = "evs-eye-iot-ingestion-credentials.csv";
    anchor.click();
    URL.revokeObjectURL(anchor.href);
  };
  const editFleet = async (fleetId: string) => {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`${API_URL}/fleets/${fleetId}`, {
        headers: { Authorization: `Bearer ${token()}` },
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(
          result.error?.message ?? result.message ?? "Unable to load Fleet.",
        );
      const fleet = result.data as Record<string, unknown>;
      const registration = (fleet.registration ?? {}) as Record<
        string,
        unknown
      >;
      const insurance = (fleet.insurance ?? {}) as Record<string, unknown>;
      const fitness = (fleet.fitness ?? {}) as Record<string, unknown>;
      const text = (value: unknown) =>
        value === null || value === undefined ? "" : String(value);
      const date = (value: unknown) => text(value).slice(0, 10);
      setForm({
        fleetCode: text(fleet.fleetCode),
        vehicleNumber: text(fleet.vehicleNumber),
        chassisNumber: text(fleet.chassisNumber),
        vinNumber: text(fleet.vinNumber),
        oemId: text(fleet.oemId),
        vehicleCategoryId: text(fleet.vehicleCategoryId),
        vehicleTypeId: text(fleet.vehicleTypeId),
        speedType: text(fleet.speedType),
        homeHubId: text(fleet.homeHubId),
        modelName: text(fleet.modelName),
        variantName: text(fleet.variantName),
        colour: text(fleet.colour),
        motorNumber: text(fleet.motorNumber),
        manufacturingYear: text(fleet.manufacturingYear),
        manufacturingMonth: text(fleet.manufacturingMonth),
        ownershipType: text(fleet.ownershipType),
        odometerKm: text(fleet.odometerKm),
        registrationDate: date(registration.registrationDate),
        registeringAuthority: text(registration.registeringAuthority),
        rcExpiryDate: date(registration.rcExpiryDate),
        insuranceProviderName: text(insurance.providerName),
        insurancePolicyNumber: text(insurance.policyNumber),
        insuranceType: text(insurance.insuranceType),
        insuranceStartDate: date(insurance.startDate),
        insuranceEndDate: date(insurance.endDate),
        fitnessCertificateNumber: text(fitness.certificateNumber),
        fitnessExpiryDate: date(fitness.expiryDate),
      });
      setEditingFleetId(fleetId);
    } catch (cause) {
      setMessage(
        cause instanceof Error ? cause.message : "Unable to load Fleet.",
      );
    } finally {
      setBusy(false);
    }
  };
  if (createdFleet) {
    if (!componentsReady) {
      return (
        <FleetComponentsSetup
          fleet={createdFleet}
          isEditing={editingComponents}
          onContinue={() => setComponentsReady(true)}
        />
      );
    }
    return <FleetEvidenceSetup fleet={createdFleet} onActivated={onSaved} />;
  }
  return (
    <section className="client-onboarding-action">
      <div>
        <p className="eyebrow">STEP 4 · FLEETS</p>
        <h2>Onboard your fleet</h2>
        <p>
          Create a complete vehicle record using Evs Eye master data. The
          current Hub is initialized from the selected home Hub.
        </p>
      </div>
      {existingFleets.length ? (
        <section className="client-existing-records">
          <div>
            <strong>Saved Fleets</strong>
            <span>Select a submitted Fleet to update its details.</span>
          </div>
          {existingFleets.map((fleet) => (
            <button
              key={String(fleet.id)}
              type="button"
              onClick={() => editFleet(String(fleet.id))}
            >
              <b>
                {String(
                  fleet.fleetCode ?? fleet.vehicleNumber ?? fleet.chassisNumber,
                )}
              </b>
              <span>
                {String(fleet.vehicleNumber ?? "Unregistered")} ·{" "}
                {String(
                  (fleet.oem as Record<string, unknown> | undefined)
                    ?.displayName ?? "",
                )}
              </span>
              <i>Edit</i>
            </button>
          ))}
        </section>
      ) : null}
      <div className="client-onboarding-options">
        <form onSubmit={create} className="client-hub-form">
          {editingFleetId ? (
            <div className="client-editing-banner client-form-wide">
              Editing an existing Fleet.{" "}
              <button type="button" onClick={() => setEditingFleetId(null)}>
                Cancel edit
              </button>
              <button
                type="button"
                onClick={() => {
                  setCreatedFleet({
                    id: editingFleetId,
                    vehicleNumber: form.vehicleNumber || null,
                    chassisNumber: form.chassisNumber,
                  });
                  setEditingFleetId(null);
                  setEditingComponents(true);
                  setComponentsReady(false);
                }}
              >
                Edit battery, controller & IoT
              </button>
            </div>
          ) : null}
          <h3 className="client-form-section-title">Vehicle identity</h3>
          <label>
            Fleet code
            <input
              value={form.fleetCode}
              onChange={(event) =>
                setForm({ ...form, fleetCode: event.target.value })
              }
              placeholder="FLT-0001"
            />
          </label>
          <label>
            Vehicle number
            <input
              value={form.vehicleNumber}
              onChange={(event) =>
                setForm({ ...form, vehicleNumber: event.target.value })
              }
              placeholder="DL01EV0001"
            />
          </label>
          <label>
            Chassis number *
           <input
              required
              value={form.chassisNumber}
              onChange={(event) =>
                setForm({ ...form, chassisNumber: event.target.value })
              }
              placeholder="ME4JF123456789001"
            />
          </label>
          <label>
            VIN number
            <input
              value={form.vinNumber}
              onChange={(event) =>
                setForm({ ...form, vinNumber: event.target.value })
              }
              placeholder="Vehicle identification number"
            />
          </label>
          <label>
            OEM *
           <select
              required
              value={form.oemId}
              onChange={(event) =>
                setForm({ ...form, oemId: event.target.value })
              }
            >
              <option value="">Select OEM</option>
              {options.oems.map((oem) => (
                <option key={oem.id} value={oem.id}>
                  {oem.displayName} ({oem.code})
                </option>
              ))}
            </select>
          </label>
          <label>
            Vehicle category *
           <select
              required
              value={form.vehicleCategoryId}
              onChange={(event) =>
                setForm({
                  ...form,
                  vehicleCategoryId: event.target.value,
                  vehicleTypeId: "",
                })
              }
            >
              <option value="">Select vehicle category</option>
              {options.vehicleCategories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name} ({category.code})
                </option>
              ))}
            </select>
          </label>
          <label>
            Vehicle type *
           <select
              required
              value={form.vehicleTypeId}
              disabled={!form.vehicleCategoryId}
              onChange={(event) =>
                setForm({ ...form, vehicleTypeId: event.target.value })
              }
            >
              <option value="">Select vehicle type</option>
              {options.vehicleTypes
                .filter((type) => type.categoryId === form.vehicleCategoryId)
                .map((type) => (
                  <option key={type.id} value={type.id}>
                    {type.name} ({type.energyType})
                  </option>
                ))}
            </select>
          </label>
          <label>
            Speed type *
           <select
              required
              value={form.speedType}
              onChange={(event) =>
                setForm({ ...form, speedType: event.target.value })
              }
            >
              <option value="">Select speed type</option>
              {vehicleSpeedTypes.map((type) => <option key={type} value={type}>{enumOptionLabel(type)}</option>)}
            </select>
          </label>
          <label>
            Home Hub
            <select
              value={form.homeHubId}
              onChange={(event) =>
                setForm({ ...form, homeHubId: event.target.value })
              }
            >
              <option value="">Select home Hub</option>
              {hubs.map((hub) => (
                <option key={hub.id} value={hub.id}>
                  {hub.code} · {hub.name}
                </option>
              ))}
            </select>
          </label>
          <h3 className="client-form-section-title">Vehicle details</h3>
          <label>
            Model name
            <input
              value={form.modelName}
              onChange={(event) =>
                setForm({ ...form, modelName: event.target.value })
              }
              placeholder="Gracy"
            />
          </label>
          <label>
            Variant name
            <input
              value={form.variantName}
              onChange={(event) =>
                setForm({ ...form, variantName: event.target.value })
              }
              placeholder="Standard"
            />
          </label>
          <label>
            Colour
            <input
              value={form.colour}
              onChange={(event) =>
                setForm({ ...form, colour: event.target.value })
              }
              placeholder="White"
            />
          </label>
          <label>
            Motor number
            <input
              value={form.motorNumber}
              onChange={(event) =>
                setForm({ ...form, motorNumber: event.target.value })
              }
              placeholder="Motor serial number"
            />
          </label>
          <label>
            Manufacturing year
            <input
              type="number"
              min="1900"
              max="2100"
              value={form.manufacturingYear}
              onChange={(event) =>
                setForm({ ...form, manufacturingYear: event.target.value })
              }
              placeholder="2025"
            />
          </label>
          <label>
            Manufacturing month
            <input
              type="number"
              min="1"
              max="12"
              value={form.manufacturingMonth}
              onChange={(event) =>
                setForm({ ...form, manufacturingMonth: event.target.value })
              }
              placeholder="6"
            />
          </label>
          <label>
            Ownership type *
           <select
              required
              value={form.ownershipType}
              onChange={(event) =>
                setForm({ ...form, ownershipType: event.target.value })
              }
            >
              <option value="">Select ownership type</option>
              {fleetOwnershipTypes.map((type) => <option key={type} value={type}>{enumOptionLabel(type)}</option>)}
            </select>
          </label>
          <label>
            Odometer (km)
            <input
              type="number"
              min="0"
              step="0.01"
              value={form.odometerKm}
              onChange={(event) =>
                setForm({ ...form, odometerKm: event.target.value })
              }
              placeholder="0"
            />
          </label>
          <h3 className="client-form-section-title">
            Registration & compliance
          </h3>
          <label>
            Registration date
            <input
              type="date"
              value={form.registrationDate}
              onChange={(event) =>
                setForm({ ...form, registrationDate: event.target.value })
              }
            />
          </label>
          <label>
            Registering authority
            <input
              value={form.registeringAuthority}
              onChange={(event) =>
                setForm({ ...form, registeringAuthority: event.target.value })
              }
              placeholder="RTO Delhi"
            />
          </label>
          <label>
            RC expiry date
            <input
              type="date"
              value={form.rcExpiryDate}
              onChange={(event) =>
                setForm({ ...form, rcExpiryDate: event.target.value })
              }
            />
          </label>
          <label>
            Insurance provider
            <input
              value={form.insuranceProviderName}
              onChange={(event) =>
                setForm({ ...form, insuranceProviderName: event.target.value })
              }
              placeholder="Insurance provider"
            />
          </label>
          <label>
            Insurance policy number
            <input
              value={form.insurancePolicyNumber}
              onChange={(event) =>
                setForm({ ...form, insurancePolicyNumber: event.target.value })
              }
              placeholder="Policy number"
            />
          </label>
          <label>
            Insurance type
            <select
              value={form.insuranceType}
              onChange={(event) =>
                setForm({ ...form, insuranceType: event.target.value })
              }
            >
              <option value="">Select insurance type</option>
              {insuranceTypes.map((type) => <option key={type} value={type}>{enumOptionLabel(type)}</option>)}
            </select>
          </label>
          <label>
            Insurance start date
            <input
              type="date"
              value={form.insuranceStartDate}
              onChange={(event) =>
                setForm({ ...form, insuranceStartDate: event.target.value })
              }
            />
          </label>
          <label>
            Insurance end date
            <input
              type="date"
              value={form.insuranceEndDate}
              onChange={(event) =>
                setForm({ ...form, insuranceEndDate: event.target.value })
              }
            />
          </label>
          <label>
            Fitness certificate number
            <input
              value={form.fitnessCertificateNumber}
              onChange={(event) =>
                setForm({
                  ...form,
                  fitnessCertificateNumber: event.target.value,
                })
              }
              placeholder="Fitness certificate number"
            />
          </label>
          <label>
            Fitness expiry date
            <input
              type="date"
              value={form.fitnessExpiryDate}
              onChange={(event) =>
                setForm({ ...form, fitnessExpiryDate: event.target.value })
              }
            />
          </label>
          <button disabled={busy} type="submit">
            {busy
              ? "Saving…"
              : editingFleetId
                ? "Update Fleet"
                : "Create Fleet"}
          </button>
        </form>
        <div className="client-bulk-card">
          <h3>Bulk onboarding import</h3>
          <p>
            Use one workbook with Fleets, Batteries, Controllers, and IoT Devices
            sheets. Component sheets link to a Fleet using <code>fleetCode</code>{" "}
            or <code>chassisNumber</code>.
          </p>
          <button
            type="button"
            className="secondary-button"
            onClick={downloadTemplate}
          >
            Download template
          </button>
          <label className="client-file-input">
            Upload onboarding workbook
            <input
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              onChange={(event) =>
                event.target.files?.[0] && void parseWorkbook(event.target.files[0])
              }
            />
          </label>
          {workbookRows.fleets.length ? (
            <p>
              {workbookRows.fleets.length} Fleet, {workbookRows.batteries.length} Battery, {workbookRows.controllers.length} Controller, and {workbookRows.iotDevices.length} IoT Device row{workbookRows.iotDevices.length === 1 ? "" : "s"} ready from {filename}.
            </p>
          ) : null}
          <button
            disabled={busy || !workbookRows.fleets.length}
            type="button"
            onClick={bulkCreate}
          >
            {busy ? "Importing…" : "Import Fleet onboarding"}
          </button>
          {importResult ? (
            <div className="client-import-result">
              <strong>{importResult.status.replaceAll("_", " ")}</strong>
              <span>
                {importResult.passedRows} passed · {importResult.failedRows}{" "}
                failed
              </span>
              {importedIotCredentials.length ? (
                <button type="button" onClick={downloadIotCredentials}>
                  Download IoT credentials
                </button>
              ) : null}
              <button type="button" onClick={onSaved}>
                Continue to Rider creation
              </button>
            </div>
          ) : null}
        </div>
      </div>
      {message ? <p className="client-action-message">{message}</p> : null}
    </section>
  );
}

function FleetComponentsSetup({
  fleet,
  isEditing = false,
  onContinue,
}: {
  fleet: { id: string; vehicleNumber?: string | null; chassisNumber: string };
  isEditing?: boolean;
  onContinue: () => void;
}) {
  const [battery, setBattery] = useState({
    serialNumber: "",
    batteryCode: "",
    batteryType: "",
    batterySlot: "PRIMARY",
    manufacturer: "",
    model: "",
    capacityKwh: "",
  });
  const [controller, setController] = useState({
    controllerNumber: "",
    manufacturer: "",
    model: "",
  });
  const [batteryId, setBatteryId] = useState("");
  const [controllerId, setControllerId] = useState("");
  const [iotDeviceId, setIotDeviceId] = useState("");
  const [ingestSecret, setIngestSecret] = useState("");
  const [iotDevice, setIotDevice] = useState({
    deviceNumber: "",
    imei: "",
    simNumber: "",
    iccid: "",
    provider: "",
    model: "",
    installedAt: "",
  });
  const [installed, setInstalled] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const token = () => sessionStorage.getItem(ACCESS_TOKEN_KEY) ?? "";
  const request = async (path: string, body: unknown, method = "POST") => {
    const response = await fetch(`${API_URL}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    const result = await response.json();
    if (!response.ok) {
      throw new Error(
        result.error?.message ?? result.message ?? "Unable to save component.",
      );
    }
    return result.data;
  };
  useEffect(() => {
    fetch(`${API_URL}/fleets/${fleet.id}`, {
      headers: { Authorization: `Bearer ${token()}` },
    })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok)
          throw new Error(body.message ?? "Unable to load IoT information.");
        const fleetData = body.data as Record<string, unknown>;
        const text = (value: unknown) =>
          value === null || value === undefined ? "" : String(value);
        const batteryHistory = (fleetData.batteryHistory ?? []) as Array<
          Record<string, unknown>
        >;
        const installedBattery = batteryHistory[0];
        const batteryData = (installedBattery?.battery ?? {}) as Record<
          string,
          unknown
        >;
        if (batteryData.id) {
          setBatteryId(text(batteryData.id));
          setBattery({
            serialNumber: text(batteryData.serialNumber),
            batteryCode: text(batteryData.batteryCode),
            batteryType: text(batteryData.batteryType),
            batterySlot: text(installedBattery.batterySlot) || "PRIMARY",
            manufacturer: text(batteryData.manufacturer),
            model: text(batteryData.model),
            capacityKwh: text(batteryData.capacityKwh),
          });
        }
        const controllerHistory = (fleetData.controllerHistory ?? []) as Array<
          Record<string, unknown>
        >;
        const installedController = controllerHistory[0];
        const controllerData = (installedController?.controller ?? {}) as Record<
          string,
          unknown
        >;
        if (controllerData.id) {
          setControllerId(text(controllerData.id));
          setController({
            controllerNumber: text(controllerData.controllerNumber),
            manufacturer: text(controllerData.manufacturer),
            model: text(controllerData.model),
          });
        }
        const device = (fleetData.iotDevice ?? {}) as Record<string, unknown>;
        if (!device.id) return;
        setIotDeviceId(text(device.id));
        setIotDevice({
          deviceNumber: text(device.deviceNumber),
          imei: text(device.imei),
          simNumber: text(device.simNumber),
          iccid: text(device.iccid),
          provider: text(device.provider),
          model: text(device.model),
          installedAt: text(device.installedAt).slice(0, 10),
        });
      })
      .catch((cause: unknown) =>
        setMessage(
          cause instanceof Error
            ? cause.message
            : "Unable to load IoT information.",
        ),
      );
  }, [fleet.id]);
  const addBattery = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const asset = await request(
        batteryId
          ? `/fleets/${fleet.id}/batteries/${batteryId}`
          : `/fleets/${fleet.id}/batteries`,
        {
        ...battery,
        batteryCode: battery.batteryCode || undefined,
        batteryType: battery.batteryType || undefined,
        manufacturer: battery.manufacturer || undefined,
        model: battery.model || undefined,
        capacityKwh: battery.capacityKwh
          ? Number(battery.capacityKwh)
          : undefined,
        },
        batteryId ? "PATCH" : "POST",
      );
      setBatteryId(String(asset.id));
      setInstalled((items) => [
        ...items,
        batteryId
          ? `Battery ${asset.serialNumber} updated.`
          : `Battery ${asset.serialNumber} installed in ${battery.batterySlot.toLowerCase()} slot.`,
      ]);
    } catch (cause) {
      setMessage(
        cause instanceof Error ? cause.message : "Unable to add battery.",
      );
    } finally {
      setBusy(false);
    }
  };
  const addController = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const asset = await request(
        controllerId
          ? `/fleets/${fleet.id}/controllers/${controllerId}`
          : `/fleets/${fleet.id}/controllers`,
        {
        ...controller,
        manufacturer: controller.manufacturer || undefined,
        model: controller.model || undefined,
        },
        controllerId ? "PATCH" : "POST",
      );
      setControllerId(String(asset.id));
      setInstalled((items) => [
        ...items,
        controllerId
          ? `Controller ${asset.controllerNumber} updated.`
          : `Controller ${asset.controllerNumber} installed.`,
      ]);
    } catch (cause) {
      setMessage(
        cause instanceof Error ? cause.message : "Unable to add controller.",
      );
    } finally {
      setBusy(false);
    }
  };
  const saveIotDevice = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const payload = {
        deviceNumber: iotDevice.deviceNumber.trim(),
        imei: iotDevice.imei.trim() || undefined,
        simNumber: iotDevice.simNumber.trim() || undefined,
        iccid: iotDevice.iccid.trim() || undefined,
        provider: iotDevice.provider.trim() || undefined,
        model: iotDevice.model.trim() || undefined,
        installedAt: iotDevice.installedAt || undefined,
      };
      if (iotDeviceId) {
        await request(`/iot/devices/${iotDeviceId}`, payload, "PATCH");
        setMessage("IoT device updated.");
      } else {
        const registration = await request("/iot/devices", {
          fleetId: fleet.id,
          ...payload,
        });
        setIotDeviceId(String(registration.device.id));
        setIngestSecret(String(registration.ingestSecret));
        setMessage(
          "IoT device registered. Save the ingestion secret now; it is shown only once.",
        );
      }
    } catch (cause) {
      setMessage(
        cause instanceof Error ? cause.message : "Unable to save IoT device.",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="client-onboarding-action">
      <div>
        <p className="eyebrow">STEP 4 · COMPONENTS</p>
        <h2>{isEditing ? "Update Fleet components" : "Install Fleet components"}</h2>
        <p>
          Add or update the battery, controller, and IoT device fitted to{" "}
          {fleet.vehicleNumber || fleet.chassisNumber}. Component evidence will
          be required before Fleet activation.
        </p>
      </div>
      {ingestSecret ? (
        <div className="client-iot-credential">
          <strong>IoT ingestion secret</strong>
          <p>
            Save this secret in the tracker configuration. It is shown only
            once and cannot be recovered later.
          </p>
          <code>{ingestSecret}</code>
        </div>
      ) : null}
      <div className="fleet-components-stack">
        <form onSubmit={addBattery} className="client-hub-form">
          <h3 className="client-form-section-title">Battery</h3>
          <label>
            Battery serial number *
           <input
              required
              value={battery.serialNumber}
              onChange={(event) =>
                setBattery({ ...battery, serialNumber: event.target.value })
              }
              placeholder="BAT-001"
            />
          </label>
          <label>
            Battery slot *
           <select
              value={battery.batterySlot}
              onChange={(event) =>
                setBattery({ ...battery, batterySlot: event.target.value })
              }
            >
              {batterySlots.map((slot) => <option key={slot} value={slot}>{enumOptionLabel(slot)}</option>)}
            </select>
          </label>
          <label>
            Battery code
            <input
              value={battery.batteryCode}
              onChange={(event) =>
                setBattery({ ...battery, batteryCode: event.target.value })
              }
              placeholder="BAT-0001"
            />
          </label>
          <label>
            Battery type
            <select
              value={battery.batteryType}
              onChange={(event) =>
                setBattery({ ...battery, batteryType: event.target.value })
              }
            >
              <option value="">Select battery type</option>
              {batteryTypes.map((type) => <option key={type} value={type}>{enumOptionLabel(type)}</option>)}
            </select>
          </label>
          <label>
            Manufacturer
            <input
              value={battery.manufacturer}
              onChange={(event) =>
                setBattery({ ...battery, manufacturer: event.target.value })
              }
              placeholder="Battery manufacturer"
            />
          </label>
          <label>
            Model
            <input
              value={battery.model}
              onChange={(event) =>
                setBattery({ ...battery, model: event.target.value })
              }
              placeholder="Battery model"
            />
          </label>
          <label className="client-form-wide">
            Capacity (kWh)
            <input
              type="number"
              min="0"
              step="0.001"
              value={battery.capacityKwh}
              onChange={(event) =>
                setBattery({ ...battery, capacityKwh: event.target.value })
              }
              placeholder="2.500"
            />
          </label>
          <button disabled={busy} type="submit">
            {busy ? "Saving…" : batteryId ? "Update battery" : "Install battery"}
          </button>
        </form>
        <form onSubmit={addController} className="client-hub-form">
          <h3 className="client-form-section-title">Controller</h3>
          <label className="client-form-wide">
            Controller number *
           <input
              required
              value={controller.controllerNumber}
              onChange={(event) =>
                setController({
                  ...controller,
                  controllerNumber: event.target.value,
                })
              }
              placeholder="CTRL-001"
            />
          </label>
          <label>
            Manufacturer
            <input
              value={controller.manufacturer}
              onChange={(event) =>
                setController({
                  ...controller,
                  manufacturer: event.target.value,
                })
              }
              placeholder="Controller manufacturer"
            />
          </label>
          <label>
            Model
            <input
              value={controller.model}
              onChange={(event) =>
                setController({ ...controller, model: event.target.value })
              }
              placeholder="Controller model"
            />
          </label>
          <button disabled={busy} type="submit">
            {busy
              ? "Saving…"
              : controllerId
                ? "Update controller"
                : "Install controller"}
          </button>
        </form>
        <form onSubmit={saveIotDevice} className="client-hub-form">
          <h3 className="client-form-section-title">IoT device</h3>
          <p className="client-form-hint client-form-wide">
            The device installation and serial-label photos are required in the
            next step when a tracker is assigned.
          </p>
          <label>
            Device number *
            <input
              required
              value={iotDevice.deviceNumber}
              onChange={(event) =>
                setIotDevice({ ...iotDevice, deviceNumber: event.target.value })
              }
              placeholder="IOT-0001"
            />
          </label>
          <label>
            IMEI
            <input
              value={iotDevice.imei}
              onChange={(event) =>
                setIotDevice({ ...iotDevice, imei: event.target.value })
              }
              placeholder="15-digit IMEI"
            />
          </label>
          <label>
            SIM number
            <input
              value={iotDevice.simNumber}
              onChange={(event) =>
                setIotDevice({ ...iotDevice, simNumber: event.target.value })
              }
              placeholder="SIM mobile number"
            />
          </label>
          <label>
            ICCID
            <input
              value={iotDevice.iccid}
              onChange={(event) =>
                setIotDevice({ ...iotDevice, iccid: event.target.value })
              }
              placeholder="SIM card ICCID"
            />
          </label>
          <label>
            IoT provider
            <input
              value={iotDevice.provider}
              onChange={(event) =>
                setIotDevice({ ...iotDevice, provider: event.target.value })
              }
              placeholder="Provider name"
            />
          </label>
          <label>
            Device model
            <input
              value={iotDevice.model}
              onChange={(event) =>
                setIotDevice({ ...iotDevice, model: event.target.value })
              }
              placeholder="Tracker model"
            />
          </label>
          <label className="client-form-wide">
            Installation date
            <input
              type="date"
              value={iotDevice.installedAt}
              onChange={(event) =>
                setIotDevice({ ...iotDevice, installedAt: event.target.value })
              }
            />
          </label>
          <button disabled={busy} type="submit">
            {busy
              ? "Saving…"
              : iotDeviceId
                ? "Update IoT device"
                : "Register IoT device"}
          </button>
        </form>
      </div>
      {installed.length ? (
        <ul className="client-component-list">
          {installed.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      ) : null}
      <div className="fleet-evidence-actions">
        <button
          className="secondary-button"
          disabled={busy}
          type="button"
          onClick={onContinue}
        >
          Skip components for now
        </button>
        <button disabled={busy} type="button" onClick={onContinue}>
          Continue to Fleet evidence
        </button>
      </div>
      {message ? <p className="client-action-message">{message}</p> : null}
    </section>
  );
}

function FleetEvidenceSetup({
  fleet,
  onActivated,
}: {
  fleet: { id: string; vehicleNumber?: string | null; chassisNumber: string };
  onActivated: () => void;
}) {
  const [evidence, setEvidence] = useState<FleetEvidenceStatus | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const token = () => sessionStorage.getItem(ACCESS_TOKEN_KEY) ?? "";
  const fetchEvidence = useCallback(async () => {
    const response = await fetch(
      `${API_URL}/fleets/${fleet.id}/onboarding-status`,
      { headers: { Authorization: `Bearer ${sessionStorage.getItem(ACCESS_TOKEN_KEY) ?? ""}` } },
    );
    const body = await response.json();
    if (!response.ok) {
      throw new Error(
        body.error?.message ?? body.message ?? "Unable to load Fleet evidence.",
      );
    }
    return body.data as FleetEvidenceStatus;
  }, [fleet.id]);
  const reload = async () => setEvidence(await fetchEvidence());
  useEffect(() => {
    fetchEvidence().then(setEvidence).catch((cause: unknown) =>
      setMessage(
        cause instanceof Error
          ? cause.message
          : "Unable to load Fleet evidence.",
      ),
    );
  }, [fetchEvidence]);
  const upload = async (
    entityType: string,
    entityId: string,
    photoType: string,
    file: File,
  ) => {
    if (file.size > 5 * 1024 * 1024) {
      setMessage("Each photo must be 5 MB or smaller.");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const intentResponse = await fetch(`${API_URL}/media/upload-intents`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token()}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          entityType,
          entityId,
          photoType,
          mimeType: file.type,
          fileName: file.name,
          sizeBytes: file.size,
        }),
      });
      const intentBody = await intentResponse.json();
      if (!intentResponse.ok) {
        throw new Error(
          intentBody.error?.message ??
            intentBody.message ??
            "Unable to prepare photo upload.",
        );
      }
      const uploadResponse = await fetch(intentBody.data.uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": file.type },
        body: file,
      });
      if (!uploadResponse.ok) {
        throw new Error("The photo could not be uploaded to secure storage.");
      }
      const completeResponse = await fetch(
        `${API_URL}/media/${intentBody.data.photo.id}/complete`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${token()}` },
        },
      );
      const completeBody = await completeResponse.json();
      if (!completeResponse.ok) {
        throw new Error(
          completeBody.error?.message ??
            completeBody.message ??
            "Unable to confirm photo upload.",
        );
      }
      await reload();
      setMessage(`${photoType.replaceAll("_", " ")} photo uploaded.`);
    } catch (cause) {
      setMessage(
        cause instanceof Error ? cause.message : "Unable to upload photo.",
      );
    } finally {
      setBusy(false);
    }
  };
  const activate = async () => {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`${API_URL}/fleets/${fleet.id}/activate`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token()}` },
      });
      const body = await response.json();
      if (!response.ok) {
        throw new Error(
          body.error?.message ??
            body.message ??
            "Unable to activate the Fleet.",
        );
      }
      onActivated();
    } catch (cause) {
      setMessage(
        cause instanceof Error
          ? cause.message
          : "Unable to activate the Fleet.",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="client-onboarding-action">
      <div>
        <p className="eyebrow">STEP 4 · FLEET EVIDENCE</p>
        <h2>Activate {fleet.vehicleNumber || fleet.chassisNumber}</h2>
        <p>
          Upload every required photo. Your Fleet becomes available only after
          its operational evidence has been verified.
        </p>
      </div>
      {!evidence ? (
        <p className="client-action-message">Loading required photo slots…</p>
      ) : (
        <div className="fleet-evidence-list">
          {evidence.items.map((item) => (
            <section className="fleet-evidence-card" key={item.entityId}>
              <div>
                <strong>{item.label || item.entityType}</strong>
                <span>
                  {item.ready
                    ? "Evidence complete"
                    : `${item.missingPhotoTypes.length} photo slot(s) remaining`}
                </span>
              </div>
              <div className="fleet-photo-slots">
                {item.requiredPhotoTypes.map((photoType) => {
                  const complete = item.completedPhotoTypes.includes(photoType);
                  return (
                    <label
                      className={complete ? "complete" : ""}
                      key={photoType}
                    >
                      <span>
                        {complete ? "✓" : "○"} {photoType.replaceAll("_", " ")}
                        {complete ? " · Replace photo" : ""}
                      </span>
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        disabled={busy}
                        onChange={(event) => {
                          const file = event.target.files?.[0];
                          if (file)
                            void upload(
                              item.entityType,
                              item.entityId,
                              photoType,
                              file,
                            );
                        }}
                      />
                    </label>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}
      <div className="fleet-evidence-actions">
        <button
          className="secondary-button"
          disabled={busy}
          type="button"
          onClick={() => void reload()}
        >
          Refresh evidence
        </button>
        <button
          disabled={busy || !evidence?.ready}
          type="button"
          onClick={() => void activate()}
        >
          {busy ? "Working…" : "Activate Fleet"}
        </button>
      </div>
      {message ? <p className="client-action-message">{message}</p> : null}
    </section>
  );
}

function TeamLeaderSetup({ onSaved }: { onSaved: () => void }) {
  const [existingLeaders, setExistingLeaders] = useState<
    Record<string, unknown>[]
  >([]);
  const [editingLeaderId, setEditingLeaderId] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: "",
    mobile: "",
    employeeCode: "",
    designation: "",
    joiningDate: "",
    isActive: true,
  });
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [filename, setFilename] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const token = () => sessionStorage.getItem(ACCESS_TOKEN_KEY) ?? "";
  useEffect(() => {
    fetch(`${API_URL}/client/users/team-leaders`, {
      headers: { Authorization: `Bearer ${token()}` },
    })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok)
          throw new Error(body.message ?? "Unable to load Team Leaders.");
        setExistingLeaders(body.data ?? []);
      })
      .catch((cause: unknown) =>
        setMessage(
          cause instanceof Error
            ? cause.message
            : "Unable to load Team Leaders.",
        ),
      );
  }, []);
  const request = async (path: string, body?: unknown, method = "POST") => {
    const response = await fetch(`${API_URL}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token()}`,
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const result = await response.json();
    if (!response.ok)
      throw new Error(
        result.error?.message ?? result.message ?? "Request failed.",
      );
    return result.data;
  };
  const create = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      await request(
        editingLeaderId
          ? `/client/users/team-leaders/${editingLeaderId}`
          : "/client/users/team-leaders",
        {
          ...form,
          employeeCode: form.employeeCode || undefined,
          designation: form.designation || undefined,
          joiningDate: form.joiningDate || undefined,
          isActive: form.isActive,
        },
        editingLeaderId ? "PATCH" : "POST",
      );
      setMessage(
        editingLeaderId
          ? "Team Leader updated successfully."
          : "Team Leader created. Fleet creation is available next.",
      );
      setEditingLeaderId(null);
      onSaved();
    } catch (cause) {
      setMessage(
        cause instanceof Error
          ? cause.message
          : "Unable to create Team Leader.",
      );
    } finally {
      setBusy(false);
    }
  };
  const skip = async () => {
    setBusy(true);
    setMessage("");
    try {
      await request("/client/onboarding/steps/skip", { step: "TEAM_LEADERS" });
      setMessage(
        "Team Leader creation skipped. You can add Team Leaders later.",
      );
      onSaved();
    } catch (cause) {
      setMessage(
        cause instanceof Error ? cause.message : "Unable to skip this step.",
      );
    } finally {
      setBusy(false);
    }
  };
  const parseCsv = (file: File) => {
    setFilename(file.name);
    const reader = new FileReader();
    reader.onload = () => {
      const lines = String(reader.result ?? "")
        .split(/\r?\n/)
        .filter(Boolean);
      const [header, ...body] = lines;
      const columns = header.split(",").map((value) => value.trim());
      setRows(
        body.map((line) =>
          Object.fromEntries(
            columns.map((column, index) => [
              column,
              line.split(",")[index]?.trim() ?? "",
            ]),
          ),
        ),
      );
    };
    reader.readAsText(file);
  };
  const bulkCreate = async () => {
    if (!rows.length) return;
    setBusy(true);
    setMessage("");
    try {
      const result = await request("/client/users/team-leaders/bulk", {
        filename,
        rows: rows.map((row) => ({
          name: row.name,
          mobile: row.mobile,
          email: row.email || undefined,
          employeeCode: row.employeeCode || undefined,
          designation: row.designation || undefined,
        })),
      });
      setMessage(
        `Import ${result.status.replaceAll("_", " ")}: ${result.passedRows} passed, ${result.failedRows} failed.`,
      );
      if (result.failedRows && result.jobId) {
        const response = await fetch(
          `${API_URL}/client/users/team-leaders/imports/${result.jobId}/failed-records`,
          { headers: { Authorization: `Bearer ${token()}` } },
        );
        const csv = await response.text();
        const anchor = document.createElement("a");
        anchor.href = URL.createObjectURL(
          new Blob([csv], { type: "text/csv" }),
        );
        anchor.download = "team-leader-import-failures.csv";
        anchor.click();
        URL.revokeObjectURL(anchor.href);
      }
      onSaved();
    } catch (cause) {
      setMessage(
        cause instanceof Error
          ? cause.message
          : "Unable to import Team Leaders.",
      );
    } finally {
      setBusy(false);
    }
  };
  const downloadTemplate = () => {
    const csv =
      "name,mobile,email,employeeCode,designation\nPriya Singh,+919100000002,priya@example.com,TL-001,Delivery Lead\n";
    const anchor = document.createElement("a");
    anchor.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    anchor.download = "evs-eye-team-leaders-template.csv";
    anchor.click();
    URL.revokeObjectURL(anchor.href);
  };
  const editLeader = (leader: Record<string, unknown>) => {
    const user = (leader.user ?? {}) as Record<string, unknown>;
    setForm({
      name: String(user.name ?? ""),
      mobile: String(user.mobile ?? ""),
      employeeCode: String(leader.employeeCode ?? ""),
      designation: String(leader.designation ?? ""),
      joiningDate: leader.joiningDate ? String(leader.joiningDate).slice(0, 10) : "",
      isActive: user.isActive !== false,
    });
    setEditingLeaderId(String(leader.id));
  };
  const editingLeaderRiderCount = Number(
    ((existingLeaders.find((leader) => String(leader.id) === editingLeaderId)?._count as Record<string, unknown> | undefined)?.riders) ?? 0,
  );
  return (
    <section className="client-onboarding-action">
      <div className="client-action-title-row">
        <div>
          <p className="eyebrow">STEP 3 · TEAM LEADERS · OPTIONAL</p>
          <h2>Create Rider Team Leaders</h2>
          <p>
            Team Leaders manage groups of Riders and can be assigned once Riders
            have been created.
          </p>
        </div>
        <button
          className="client-skip-button"
          type="button"
          disabled={busy}
          onClick={skip}
        >
          Skip for now
        </button>
      </div>
      {existingLeaders.length ? (
        <section className="client-existing-records">
          <div>
            <strong>Saved Team Leaders</strong>
            <span>Select a Team Leader to update their submitted details.</span>
          </div>
          {existingLeaders.map((leader) => {
            const user = (leader.user ?? {}) as Record<string, unknown>;
            return (
              <button
                key={String(leader.id)}
                type="button"
                onClick={() => editLeader(leader)}
              >
                <b>{String(user.name ?? "Team Leader")}</b>
                <span>
                  {String(user.mobile ?? "")} ·{" "}
                  {String(leader.designation ?? "")}
                </span>
                <i>Edit</i>
              </button>
            );
          })}
        </section>
      ) : null}
      <div className="client-onboarding-options">
        <form onSubmit={create} className="client-hub-form">
          {editingLeaderId ? (
            <div className="client-editing-banner client-form-wide">
              Editing an existing Team Leader.{" "}
              <button type="button" onClick={() => setEditingLeaderId(null)}>
                Cancel edit
              </button>
            </div>
          ) : null}
          <label>
            Name *
            <input
              required
              value={form.name}
              onChange={(event) =>
                setForm({ ...form, name: event.target.value })
              }
              placeholder="Team Leader name"
            />
          </label>
          <label>
            Mobile *
            <input
              required
              value={form.mobile}
              onChange={(event) =>
                setForm({ ...form, mobile: event.target.value })
              }
              placeholder="+919100000002"
            />
          </label>
          <label>
            Employee code (optional)
            <input
              value={form.employeeCode}
              onChange={(event) =>
                setForm({ ...form, employeeCode: event.target.value })
              }
              placeholder="TL-001"
            />
          </label>
          <label className="client-form-wide">
            Designation (optional)
            <input
              value={form.designation}
              onChange={(event) =>
                setForm({ ...form, designation: event.target.value })
              }
              placeholder="Delivery Lead"
            />
          </label>
          <label>
            Joining date (optional)
            <input type="date" value={form.joiningDate} onChange={(event) => setForm({ ...form, joiningDate: event.target.value })} />
          </label>
          <label>
            Status *
            <select required value={form.isActive ? "ACTIVE" : "INACTIVE"} onChange={(event) => setForm({ ...form, isActive: event.target.value === "ACTIVE" })}>
              <option value="ACTIVE">Active</option>
              <option value="INACTIVE" disabled={editingLeaderRiderCount > 0}>Inactive</option>
            </select>
          </label>
          {editingLeaderRiderCount > 0 && <p className="muted">Reassign this Team Leader’s riders in the operations panel before deactivating the account.</p>}
          <button disabled={busy} type="submit">
            {busy
              ? "Saving…"
              : editingLeaderId
                ? "Update Team Leader"
                : "Create Team Leader"}
          </button>
        </form>
        <div className="client-bulk-card">
          <h3>Bulk upload</h3>
          <p>Import your current Team Leader roster at once.</p>
          <button
            type="button"
            className="secondary-button"
            onClick={downloadTemplate}
          >
            Download template
          </button>
          <label className="client-file-input">
            Upload CSV
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={(event) =>
                event.target.files?.[0] && parseCsv(event.target.files[0])
              }
            />
          </label>
          {rows.length ? (
            <p>
              {rows.length} row{rows.length === 1 ? "" : "s"} ready from{" "}
              {filename}.
            </p>
          ) : null}
          <button
            disabled={busy || !rows.length}
            type="button"
            onClick={bulkCreate}
          >
            {busy ? "Importing…" : "Import Team Leaders"}
          </button>
        </div>
      </div>
      {message ? <p className="client-action-message">{message}</p> : null}
    </section>
  );
}

type HubOption = { id: string; code: string; name: string };

function FleetManagerSetup({ onSaved }: { onSaved: () => void }) {
  const [hubs, setHubs] = useState<HubOption[]>([]);
  const [existingManagers, setExistingManagers] = useState<
    Record<string, unknown>[]
  >([]);
  const [editingManagerId, setEditingManagerId] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: "",
    mobile: "",
    email: "",
    primaryHubId: "",
  });
  const [selectedHubIds, setSelectedHubIds] = useState<string[]>([]);
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [filename, setFilename] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const token = () => sessionStorage.getItem(ACCESS_TOKEN_KEY) ?? "";
  useEffect(() => {
    Promise.all([
      fetch(`${API_URL}/hubs`, {
        headers: { Authorization: `Bearer ${token()}` },
      }),
      fetch(`${API_URL}/client/users/fleet-managers`, {
        headers: { Authorization: `Bearer ${token()}` },
      }),
    ])
      .then(async ([hubsResponse, managersResponse]) => {
        const [hubsBody, managersBody] = await Promise.all([
          hubsResponse.json(),
          managersResponse.json(),
        ]);
        if (!hubsResponse.ok)
          throw new Error(hubsBody.message ?? "Unable to load Hubs.");
        if (!managersResponse.ok)
          throw new Error(
            managersBody.message ?? "Unable to load Fleet Managers.",
          );
        setHubs(hubsBody.data);
        setExistingManagers(managersBody.data ?? []);
      })
      .catch((cause: unknown) =>
        setMessage(
          cause instanceof Error ? cause.message : "Unable to load Hubs.",
        ),
      );
  }, []);
  const request = async (path: string, body: unknown, method = "POST") => {
    const response = await fetch(`${API_URL}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    const result = await response.json();
    if (!response.ok)
      throw new Error(
        result.error?.message ?? result.message ?? "Request failed.",
      );
    return result.data;
  };
  const create = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      await request(
        editingManagerId
          ? `/client/users/fleet-managers/${editingManagerId}`
          : "/client/users/fleet-managers",
        {
          ...form,
          email: form.email || undefined,
          hubIds: selectedHubIds,
        },
        editingManagerId ? "PATCH" : "POST",
      );
      setMessage(
        editingManagerId
          ? "Fleet Manager updated successfully."
          : "Fleet Manager created. Team Leader creation is available next.",
      );
      setEditingManagerId(null);
      onSaved();
    } catch (cause) {
      setMessage(
        cause instanceof Error
          ? cause.message
          : "Unable to create Fleet Manager.",
      );
    } finally {
      setBusy(false);
    }
  };
  const parseCsv = (file: File) => {
    setFilename(file.name);
    const reader = new FileReader();
    reader.onload = () => {
      const lines = String(reader.result ?? "")
        .split(/\r?\n/)
        .filter(Boolean);
      const [header, ...body] = lines;
      const columns = header.split(",").map((value) => value.trim());
      setRows(
        body.map((line) =>
          Object.fromEntries(
            columns.map((column, index) => [
              column,
              line.split(",")[index]?.trim() ?? "",
            ]),
          ),
        ),
      );
    };
    reader.readAsText(file);
  };
  const bulkCreate = async () => {
    if (!rows.length) return;
    setBusy(true);
    setMessage("");
    try {
      const byCode = new Map(
        hubs.map((hub) => [hub.code.toUpperCase(), hub.id]),
      );
      const preparedRows = rows.map((row) => {
        const hubIds = (row.hubCodes ?? "")
          .split("|")
          .map((code) => byCode.get(code.trim().toUpperCase()))
          .filter((id): id is string => Boolean(id));
        const primaryHubId =
          byCode.get((row.primaryHubCode ?? "").trim().toUpperCase()) ?? "";
        return {
          name: row.name,
          mobile: row.mobile,
          email: row.email || undefined,
          hubIds,
          primaryHubId,
        };
      });
      const result = await request("/client/users/fleet-managers/bulk", {
        filename,
        rows: preparedRows,
      });
      setMessage(
        `Import ${result.status.replaceAll("_", " ")}: ${result.passedRows} passed, ${result.failedRows} failed.`,
      );
      if (result.failedRows && result.jobId) {
        const response = await fetch(
          `${API_URL}/client/users/fleet-managers/imports/${result.jobId}/failed-records`,
          { headers: { Authorization: `Bearer ${token()}` } },
        );
        const csv = await response.text();
        const anchor = document.createElement("a");
        anchor.href = URL.createObjectURL(
          new Blob([csv], { type: "text/csv" }),
        );
        anchor.download = "fleet-manager-import-failures.csv";
        anchor.click();
        URL.revokeObjectURL(anchor.href);
      }
      onSaved();
    } catch (cause) {
      setMessage(
        cause instanceof Error
          ? cause.message
          : "Unable to import Fleet Managers.",
      );
    } finally {
      setBusy(false);
    }
  };
  const downloadTemplate = () => {
    const csv =
      "name,mobile,email,hubCodes,primaryHubCode\nAmit Kumar,+919100000001,amit@example.com,HUB-DEL-01,HUB-DEL-01\n";
    const anchor = document.createElement("a");
    anchor.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    anchor.download = "evs-eye-fleet-managers-template.csv";
    anchor.click();
    URL.revokeObjectURL(anchor.href);
  };
  const toggleHub = (hubId: string) => {
    setSelectedHubIds((current) =>
      current.includes(hubId)
        ? current.filter((id) => id !== hubId)
        : [...current, hubId],
    );
    if (form.primaryHubId === hubId) setForm({ ...form, primaryHubId: "" });
  };
  const selectPrimaryHub = (hubId: string) => {
    setForm({ ...form, primaryHubId: hubId });
    if (hubId && !selectedHubIds.includes(hubId)) {
      setSelectedHubIds((current) => [...current, hubId]);
    }
  };
  const editManager = (manager: Record<string, unknown>) => {
    const assignments = (manager.hubAssignments ?? []) as Array<
      Record<string, unknown>
    >;
    const hubIds = assignments.map((assignment) => String(assignment.hubId));
    const primaryHubId = String(
      assignments.find((assignment) => assignment.isPrimary)?.hubId ??
        hubIds[0] ??
        "",
    );
    setForm({
      name: String(manager.name ?? ""),
      mobile: String(manager.mobile ?? ""),
      email: "",
      primaryHubId,
    });
    setSelectedHubIds(hubIds);
    setEditingManagerId(String(manager.id));
  };
  return (
    <section className="client-onboarding-action">
      <div>
        <p className="eyebrow">STEP 2 · FLEET MANAGERS</p>
        <h2>Add your operational owners</h2>
        <p>
          Each Fleet Manager can manage one or more Hubs. Select a primary Hub
          for each manager.
        </p>
      </div>
      {existingManagers.length ? (
        <section className="client-existing-records">
          <div>
            <strong>Saved Fleet Managers</strong>
            <span>
              Select a manager to update their details and Hub assignments.
            </span>
          </div>
          {existingManagers.map((manager) => {
            const assignments = (manager.hubAssignments ?? []) as Array<
              Record<string, unknown>
            >;
            return (
              <button
                key={String(manager.id)}
                type="button"
                onClick={() => editManager(manager)}
              >
                <b>{String(manager.name)}</b>
                <span>
                  {String(manager.mobile)} ·{" "}
                  {assignments
                    .map((assignment) =>
                      String(
                        (assignment.hub as Record<string, unknown> | undefined)
                          ?.code ?? "",
                      ),
                    )
                    .filter(Boolean)
                    .join(", ") || "No Hub"}
                </span>
                <i>Edit</i>
              </button>
            );
          })}
        </section>
      ) : null}
      <div className="client-onboarding-options">
        <form onSubmit={create} className="client-hub-form">
          {editingManagerId ? (
            <div className="client-editing-banner client-form-wide">
              Editing an existing Fleet Manager.{" "}
              <button
                type="button"
                onClick={() => {
                  setEditingManagerId(null);
                  setForm({
                    name: "",
                    mobile: "",
                    email: "",
                    primaryHubId: "",
                  });
                  setSelectedHubIds([]);
                }}
              >
                Create a new Fleet Manager instead
              </button>
            </div>
          ) : null}
          <label>
            Name *
            <input
              required
              value={form.name}
              onChange={(event) =>
                setForm({ ...form, name: event.target.value })
              }
              placeholder="Manager name"
            />
          </label>
          <label>
            Mobile *
            <input
              required
              value={form.mobile}
              onChange={(event) =>
                setForm({ ...form, mobile: event.target.value })
              }
              placeholder="+919100000001"
            />
          </label>
          <label className="client-form-wide">
            Email (optional)
            <input
              type="email"
              value={form.email}
              onChange={(event) =>
                setForm({ ...form, email: event.target.value })
              }
              placeholder="manager@company.com"
            />
          </label>
          <fieldset className="client-hub-picker client-form-wide">
            <legend>Managed Hubs</legend>
            {hubs.length ? (
              hubs.map((hub) => (
                <label key={hub.id}>
                  <input
                    type="checkbox"
                    checked={selectedHubIds.includes(hub.id)}
                    onChange={() => toggleHub(hub.id)}
                  />{" "}
                  {hub.code} · {hub.name}
                </label>
              ))
            ) : (
              <p>Create at least one Hub before adding a Fleet Manager.</p>
            )}
          </fieldset>
          <label className="client-form-wide">
            Primary Hub *
            <select
              required
              value={form.primaryHubId}
              disabled={!hubs.length}
              onChange={(event) => selectPrimaryHub(event.target.value)}
            >
              <option value="">Select primary Hub</option>
              {hubs.map((hub) => (
                <option key={hub.id} value={hub.id}>
                  {hub.code} · {hub.name}
                </option>
              ))}
            </select>
          </label>
          <button disabled={busy || !selectedHubIds.length} type="submit">
            {busy
              ? "Saving…"
              : editingManagerId
                ? "Update Fleet Manager"
                : "Create Fleet Manager"}
          </button>
        </form>
        <div className="client-bulk-card">
          <h3>Bulk upload</h3>
          <p>
            For multiple Hubs, separate their codes with a <code>|</code>.
          </p>
          <button
            type="button"
            className="secondary-button"
            onClick={downloadTemplate}
          >
            Download template
          </button>
          <label className="client-file-input">
            Upload CSV
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={(event) =>
                event.target.files?.[0] && parseCsv(event.target.files[0])
              }
            />
          </label>
          {rows.length ? (
            <p>
              {rows.length} row{rows.length === 1 ? "" : "s"} ready from{" "}
              {filename}.
            </p>
          ) : null}
          <button
            disabled={busy || !rows.length || !hubs.length}
            type="button"
            onClick={bulkCreate}
          >
            {busy ? "Importing…" : "Import Fleet Managers"}
          </button>
        </div>
      </div>
      {message ? <p className="client-action-message">{message}</p> : null}
    </section>
  );
}

function HubSetup({ onSaved }: { onSaved: () => void }) {
  const emptyForm = {
    code: "",
    name: "",
    type: "OPERATIONS",
    status: "ACTIVE",
    addressLine1: "",
    addressLine2: "",
    landmark: "",
    city: "",
    district: "",
    state: "",
    country: "India",
    postalCode: "",
    latitude: "",
    longitude: "",
    vehicleCapacity: "",
    riderCapacity: "",
    batteryCapacity: "",
    parkingSlots: "",
    chargingPoints: "",
    swappingPoints: "",
    contactName: "",
    contactPhone: "",
    contactEmail: "",
    openingTime: "",
    closingTime: "",
    is24x7: false,
    supportsCharging: false,
    supportsBatterySwapping: false,
    supportsMaintenance: false,
    supportsAllocation: true,
    supportsDeallocation: true,
    supportsPdi: false,
  };
  const [form, setForm] = useState(emptyForm);
  const [existingHubs, setExistingHubs] = useState<Record<string, unknown>[]>(
    [],
  );
  const [editingHubId, setEditingHubId] = useState<string | null>(null);
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [filename, setFilename] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const token = () => sessionStorage.getItem(ACCESS_TOKEN_KEY) ?? "";
  const fetchHubs = useCallback(async () => {
    const response = await fetch(`${API_URL}/hubs`, {
      headers: { Authorization: `Bearer ${sessionStorage.getItem(ACCESS_TOKEN_KEY) ?? ""}` },
    });
    const result = await response.json();
    if (!response.ok)
      throw new Error(
        result.error?.message ?? result.message ?? "Unable to load Hubs.",
      );
    return result.data ?? [];
  }, []);
  const loadHubs = async () => setExistingHubs(await fetchHubs());
  useEffect(() => {
    fetchHubs().then(setExistingHubs).catch((cause: unknown) =>
      setMessage(
        cause instanceof Error ? cause.message : "Unable to load Hubs.",
      ),
    );
  }, [fetchHubs]);
  const request = async (path: string, body: unknown, method = "POST") => {
    const response = await fetch(`${API_URL}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    const result = await response.json();
    if (!response.ok)
      throw new Error(
        result.error?.message ?? result.message ?? "Request failed.",
      );
    return result.data;
  };
  const create = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      await request(editingHubId ? `/hubs/${editingHubId}` : "/hubs", {
        ...form,
        code: form.code.trim().toUpperCase(),
        latitude: form.latitude ? Number(form.latitude) : undefined,
        longitude: form.longitude ? Number(form.longitude) : undefined,
        vehicleCapacity: form.vehicleCapacity
          ? Number(form.vehicleCapacity)
          : undefined,
        riderCapacity: form.riderCapacity
          ? Number(form.riderCapacity)
          : undefined,
        batteryCapacity: form.batteryCapacity
          ? Number(form.batteryCapacity)
          : undefined,
        parkingSlots: form.parkingSlots ? Number(form.parkingSlots) : undefined,
        chargingPoints: form.chargingPoints
          ? Number(form.chargingPoints)
          : undefined,
        swappingPoints: form.swappingPoints
          ? Number(form.swappingPoints)
          : undefined,
      });
      setMessage(
        editingHubId
          ? "Hub updated successfully."
          : "Hub created. You can now continue to Fleet Manager creation.",
      );
      setForm(emptyForm);
      setEditingHubId(null);
      await loadHubs();
      onSaved();
    } catch (cause) {
      setMessage(
        cause instanceof Error ? cause.message : "Unable to create Hub.",
      );
    } finally {
      setBusy(false);
    }
  };
  const readCsv = (file: File) => {
    setFilename(file.name);
    const reader = new FileReader();
    reader.onload = () => {
      const lines = String(reader.result ?? "")
        .split(/\r?\n/)
        .filter(Boolean);
      const [header, ...body] = lines;
      const columns = header.split(",").map((value) => value.trim());
      setRows(
        body.map((line) =>
          Object.fromEntries(
            columns.map((column, index) => [
              column,
              line.split(",")[index]?.trim() ?? "",
            ]),
          ),
        ),
      );
    };
    reader.readAsText(file);
  };
  const bulkCreate = async () => {
    if (!rows.length) return;
    setBusy(true);
    setMessage("");
    try {
      const result = await request("/hubs/bulk", { filename, rows });
      setMessage(
        `Import ${result.status.replaceAll("_", " ")}: ${result.passedRows} passed, ${result.failedRows} failed.`,
      );
      if (result.failedRows && result.jobId) {
        const response = await fetch(
          `${API_URL}/hubs/imports/${result.jobId}/failed-records`,
          { headers: { Authorization: `Bearer ${token()}` } },
        );
        const csv = await response.text();
        const anchor = document.createElement("a");
        anchor.href = URL.createObjectURL(
          new Blob([csv], { type: "text/csv" }),
        );
        anchor.download = "hub-import-failures.csv";
        anchor.click();
        URL.revokeObjectURL(anchor.href);
      }
      onSaved();
    } catch (cause) {
      setMessage(
        cause instanceof Error ? cause.message : "Unable to import Hubs.",
      );
    } finally {
      setBusy(false);
    }
  };
  const downloadTemplate = () => {
    const csv = [
      "code,name,type,status,addressLine1,addressLine2,landmark,city,district,state,country,postalCode,latitude,longitude,vehicleCapacity,riderCapacity,batteryCapacity,parkingSlots,chargingPoints,swappingPoints,contactName,contactPhone,contactEmail,openingTime,closingTime,is24x7,supportsCharging,supportsBatterySwapping,supportsMaintenance,supportsAllocation,supportsDeallocation,supportsPdi",
      "HUB-DEL-01,Delhi Central,OPERATIONS,ACTIVE,Connaught Place,,,New Delhi,New Delhi,Delhi,India,110001,28.6315,77.2167,120,250,40,80,12,4,Rahul Sharma,+919876543210,rahul@example.com,08:00,20:00,false,true,false,false,true,true,false",
    ].join("\n");
    const anchor = document.createElement("a");
    anchor.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    anchor.download = "evs-eye-hubs-template.csv";
    anchor.click();
    URL.revokeObjectURL(anchor.href);
  };
  const editHub = (hub: Record<string, unknown>) => {
    const text = (value: unknown) =>
      value === null || value === undefined ? "" : String(value);
    setEditingHubId(String(hub.id));
    setForm({
      ...emptyForm,
      ...hub,
      latitude: text(hub.latitude),
      longitude: text(hub.longitude),
      vehicleCapacity: text(hub.vehicleCapacity),
      riderCapacity: text(hub.riderCapacity),
      batteryCapacity: text(hub.batteryCapacity),
      parkingSlots: text(hub.parkingSlots),
      chargingPoints: text(hub.chargingPoints),
      swappingPoints: text(hub.swappingPoints),
      is24x7: Boolean(hub.is24x7),
      supportsCharging: Boolean(hub.supportsCharging),
      supportsBatterySwapping: Boolean(hub.supportsBatterySwapping),
      supportsMaintenance: Boolean(hub.supportsMaintenance),
      supportsAllocation: Boolean(hub.supportsAllocation),
      supportsDeallocation: Boolean(hub.supportsDeallocation),
      supportsPdi: Boolean(hub.supportsPdi),
    });
  };
  return (
    <section className="client-onboarding-action">
      <div>
        <p className="eyebrow">STEP 1 · HUBS</p>
        <h2>Create your operational Hubs</h2>
        <p>
          Set up the location, capacity, contact details, hours, and services
          available at each Hub. Fields marked <strong>*</strong> are required.
        </p>
      </div>
      {existingHubs.length ? (
        <section className="client-existing-records">
          <div>
            <strong>Saved Hubs</strong>
            <span>Select an existing Hub to update its submitted details.</span>
          </div>
          {existingHubs.map((hub) => (
            <button
              key={String(hub.id)}
              type="button"
              onClick={() => editHub(hub)}
            >
              <b>{String(hub.code)}</b>
              <span>
                {String(hub.name)} · {String(hub.city)}, {String(hub.state)}
              </span>
              <i>Edit</i>
            </button>
          ))}
        </section>
      ) : null}
      <div className="client-onboarding-options">
        <form onSubmit={create} className="client-hub-form">
          {editingHubId ? (
            <div className="client-editing-banner client-form-wide">
              Editing an existing Hub.{" "}
              <button
                type="button"
                onClick={() => {
                  setEditingHubId(null);
                  setForm(emptyForm);
                }}
              >
                Create a new Hub instead
              </button>
            </div>
          ) : null}
          <h3 className="client-form-section-title">Hub identity</h3>
          <label>
            <span className="client-label-text">
              Hub code <span className="client-required-star">*</span>
            </span>
            <input
              required
              value={form.code}
              onChange={(event) =>
                setForm({ ...form, code: event.target.value })
              }
              placeholder="HUB-DEL-01"
            />
          </label>
          <label>
            <span className="client-label-text">
              Hub name <span className="client-required-star">*</span>
            </span>
            <input
              required
              value={form.name}
              onChange={(event) =>
                setForm({ ...form, name: event.target.value })
              }
              placeholder="Delhi Central"
            />
          </label>
          <label>
            Hub type
            <select
              value={form.type}
              onChange={(event) =>
                setForm({ ...form, type: event.target.value })
              }
            >
              {hubTypes.map((type) => <option key={type} value={type}>{enumOptionLabel(type)}</option>)}
            </select>
          </label>
          <label>
            Status
            <select
              value={form.status}
              onChange={(event) =>
                setForm({ ...form, status: event.target.value })
              }
            >
              {hubStatuses.map((status) => <option key={status} value={status}>{enumOptionLabel(status)}</option>)}
            </select>
          </label>

          <h3 className="client-form-section-title">Location & address</h3>
          <label className="client-form-wide">
            Address line 1
            <input
              value={form.addressLine1}
              onChange={(event) =>
                setForm({ ...form, addressLine1: event.target.value })
              }
              placeholder="Building, street, locality"
            />
          </label>
          <label>
            Address line 2
            <input
              value={form.addressLine2}
              onChange={(event) =>
                setForm({ ...form, addressLine2: event.target.value })
              }
              placeholder="Floor, area, etc."
            />
          </label>
          <label>
            Landmark
            <input
              value={form.landmark}
              onChange={(event) =>
                setForm({ ...form, landmark: event.target.value })
              }
              placeholder="Nearby landmark"
            />
          </label>
          <label>
            <span className="client-label-text">
              City <span className="client-required-star">*</span>
            </span>
            <input
              required
              value={form.city}
              onChange={(event) =>
                setForm({ ...form, city: event.target.value })
              }
              placeholder="New Delhi"
            />
          </label>
          <label>
            District
            <input
              value={form.district}
              onChange={(event) =>
                setForm({ ...form, district: event.target.value })
              }
              placeholder="District"
            />
          </label>
          <label>
            <span className="client-label-text">
              State <span className="client-required-star">*</span>
            </span>
            <input
              required
              value={form.state}
              onChange={(event) =>
                setForm({ ...form, state: event.target.value })
              }
              placeholder="Delhi"
            />
          </label>
          <label>
            Country
            <input
              value={form.country}
              onChange={(event) =>
                setForm({ ...form, country: event.target.value })
              }
              placeholder="India"
            />
          </label>
          <label>
            PIN / postal code
            <input
              value={form.postalCode}
              onChange={(event) =>
                setForm({ ...form, postalCode: event.target.value })
              }
              placeholder="110001"
            />
          </label>
          <label>
            Latitude
            <input
              type="number"
              step="0.0000001"
              value={form.latitude}
              onChange={(event) =>
                setForm({ ...form, latitude: event.target.value })
              }
              placeholder="28.6315"
            />
          </label>
          <label>
            Longitude
            <input
              type="number"
              step="0.0000001"
              value={form.longitude}
              onChange={(event) =>
                setForm({ ...form, longitude: event.target.value })
              }
              placeholder="77.2167"
            />
          </label>

          <h3 className="client-form-section-title">Capacity & facilities</h3>
          <label>
            Vehicle capacity
            <input
              type="number"
              min="0"
              value={form.vehicleCapacity}
              onChange={(event) =>
                setForm({ ...form, vehicleCapacity: event.target.value })
              }
              placeholder="120"
            />
          </label>
          <label>
            Rider capacity
            <input
              type="number"
              min="0"
              value={form.riderCapacity}
              onChange={(event) =>
                setForm({ ...form, riderCapacity: event.target.value })
              }
              placeholder="250"
            />
          </label>
          <label>
            Battery capacity
            <input
              type="number"
              min="0"
              value={form.batteryCapacity}
              onChange={(event) =>
                setForm({ ...form, batteryCapacity: event.target.value })
              }
              placeholder="40"
            />
          </label>
          <label>
            Parking slots
            <input
              type="number"
              min="0"
              value={form.parkingSlots}
              onChange={(event) =>
                setForm({ ...form, parkingSlots: event.target.value })
              }
              placeholder="80"
            />
          </label>
          <label>
            Charging points
            <input
              type="number"
              min="0"
              value={form.chargingPoints}
              onChange={(event) =>
                setForm({ ...form, chargingPoints: event.target.value })
              }
              placeholder="12"
            />
          </label>
          <label>
            Swapping points
            <input
              type="number"
              min="0"
              value={form.swappingPoints}
              onChange={(event) =>
                setForm({ ...form, swappingPoints: event.target.value })
              }
              placeholder="4"
            />
          </label>

          <h3 className="client-form-section-title">Hub contact & hours</h3>
          <label>
            Contact name
            <input
              value={form.contactName}
              onChange={(event) =>
                setForm({ ...form, contactName: event.target.value })
              }
              placeholder="Hub contact"
            />
          </label>
          <label>
            Contact mobile
            <input
              value={form.contactPhone}
              onChange={(event) =>
                setForm({ ...form, contactPhone: event.target.value })
              }
              placeholder="+919876543210"
            />
          </label>
          <label className="client-form-wide">
            Contact email
            <input
              type="email"
              value={form.contactEmail}
              onChange={(event) =>
                setForm({ ...form, contactEmail: event.target.value })
              }
              placeholder="hub@example.com"
            />
          </label>
          <label>
            Opening time
            <input
              type="time"
              value={form.openingTime}
              disabled={form.is24x7}
              onChange={(event) =>
                setForm({ ...form, openingTime: event.target.value })
              }
            />
          </label>
          <label>
            Closing time
            <input
              type="time"
              value={form.closingTime}
              disabled={form.is24x7}
              onChange={(event) =>
                setForm({ ...form, closingTime: event.target.value })
              }
            />
          </label>

          <fieldset className="client-hub-picker client-form-wide">
            <legend>Operational capabilities</legend>
            <p>Select the services this Hub can support.</p>
            {[
              ["is24x7", "Open 24 × 7"],
              ["supportsCharging", "Charging"],
              ["supportsBatterySwapping", "Battery swapping"],
              ["supportsMaintenance", "Maintenance"],
              ["supportsAllocation", "Allocation"],
              ["supportsDeallocation", "Deallocation"],
              ["supportsPdi", "PDI inspection"],
            ].map(([key, label]) => (
              <label key={key}>
                <input
                  type="checkbox"
                  checked={form[key as keyof typeof form] as boolean}
                  onChange={(event) =>
                    setForm({ ...form, [key]: event.target.checked })
                  }
                />{" "}
                {label}
              </label>
            ))}
          </fieldset>
          <button disabled={busy} type="submit">
            {busy ? "Saving…" : editingHubId ? "Update Hub" : "Create Hub"}
          </button>
        </form>
        <div className="client-bulk-card">
          <h3>Bulk upload</h3>
          <p>
            Download the full template, complete only the columns you need, then
            upload it. Required columns: code, name, city, and state.
          </p>
          <button
            type="button"
            className="secondary-button"
            onClick={downloadTemplate}
          >
            Download template
          </button>
          <label className="client-file-input">
            Upload CSV
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={(event) =>
                event.target.files?.[0] && readCsv(event.target.files[0])
              }
            />
          </label>
          {rows.length ? (
            <p>
              {rows.length} row{rows.length === 1 ? "" : "s"} ready from{" "}
              {filename}.
            </p>
          ) : null}
          <button
            disabled={busy || !rows.length}
            type="button"
            onClick={bulkCreate}
          >
            {busy ? "Importing…" : "Import Hubs"}
          </button>
        </div>
      </div>
      {message ? <p className="client-action-message">{message}</p> : null}
    </section>
  );
}

function ClientDashboardView({
  client,
  dashboard,
}: {
  client: Bootstrap["client"];
  dashboard: ClientDashboard | null;
}) {
  const fleetStatuses = [
    ["Available", "AVAILABLE"],
    ["Allocated", "ALLOCATED"],
    ["In use", "IN_USE"],
    ["Maintenance", "MAINTENANCE"],
    ["Offline", "OFFLINE"],
    ["Out of service", "OUT_OF_SERVICE"],
  ] as const;
  const riderStatuses = [
    ["Onboarding", "ONBOARDING"],
    ["Active", "ACTIVE"],
    ["Inactive", "INACTIVE"],
    ["Blocked", "BLOCKED"],
  ] as const;
  const metrics = dashboard
    ? [
        ["Operational hubs", dashboard.hubs],
        ["Fleet", dashboard.fleets],
        ["Riders", dashboard.riders],
        ["Active allocations", dashboard.activeAllocations],
        ["Fleet Managers", dashboard.fleetManagers],
        ["Team Leaders", dashboard.teamLeaders],
      ]
    : [];
  const maxFleetCount = Math.max(
    1,
    ...fleetStatuses.map(([, status]) => dashboard?.fleetByStatus[status] ?? 0),
  );

  return (
    <main className="client-dashboard">
      <header className="client-dashboard-header">
        <div>
          <p className="eyebrow">{client.companyCode ?? "CLIENT WORKSPACE"}</p>
          <h1>{client.name}</h1>
          <p>Live operational overview for your fleet workspace.</p>
        </div>
        <Link href="/?workspace=operations">Operations workspace</Link>
      </header>

      {!dashboard ? (
        <section className="client-dashboard-loading">
          Loading dashboard…
        </section>
      ) : (
        <>
          <section className="client-metrics" aria-label="Operations metrics">
            {metrics.map(([label, value]) => (
              <article key={label} className="client-metric-card">
                <span>{label}</span>
                <strong>{value}</strong>
              </article>
            ))}
          </section>

          <section className="client-dashboard-panels">
            <article className="client-dashboard-panel">
              <div className="client-panel-heading">
                <div>
                  <p className="eyebrow">FLEET HEALTH</p>
                  <h2>Fleet status</h2>
                </div>
                <strong>{dashboard.fleets} total</strong>
              </div>
              <div className="client-status-bars">
                {fleetStatuses.map(([label, status]) => {
                  const value = dashboard.fleetByStatus[status] ?? 0;
                  return (
                    <div key={status} className="client-status-bar">
                      <div>
                        <span>{label}</span>
                        <strong>{value}</strong>
                      </div>
                      <i>
                        <b
                          style={{ width: `${(value / maxFleetCount) * 100}%` }}
                        />
                      </i>
                    </div>
                  );
                })}
              </div>
            </article>

            <article className="client-dashboard-panel">
              <div className="client-panel-heading">
                <div>
                  <p className="eyebrow">WORKFORCE</p>
                  <h2>Rider readiness</h2>
                </div>
                <strong>{dashboard.riders} total</strong>
              </div>
              <div className="client-rider-statuses">
                {riderStatuses.map(([label, status]) => (
                  <div key={status}>
                    <span>{label}</span>
                    <strong>{dashboard.riderByStatus[status] ?? 0}</strong>
                  </div>
                ))}
              </div>
              <div className="client-allocation-callout">
                <span>Current operations</span>
                <strong>
                  {dashboard.activeAllocations} active allocations
                </strong>
              </div>
            </article>
          </section>
        </>
      )}
    </main>
  );
}

function Gate({ title, text }: { title: string; text: string }) {
  const { t } = useLocale();
  const returnToLogin = async () => {
    await fetch("/api/v1/auth/logout", { method: "POST" }).catch(() => undefined);
    sessionStorage.removeItem(ACCESS_TOKEN_KEY);
    sessionStorage.removeItem(REFRESH_TOKEN_KEY);
    window.location.assign("/");
  };
  return (
    <main className="client-gate">
      <section>
        <div className="language-login-row"><LanguageSwitcher /></div>
        <p className="eyebrow">{t("EVS EYE · CLIENT WORKSPACE")}</p>
        <h1>{title}</h1>
        <p>{t(text)}</p>
        <button
          className="client-return-login"
          type="button"
          onClick={returnToLogin}
        >
          {t("Return to login")}
        </button>
      </section>
    </main>
  );
}
