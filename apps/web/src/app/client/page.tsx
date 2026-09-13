"use client";

import { useEffect, useState, type FormEvent } from "react";

const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000/api/v1";
const ACCESS_TOKEN_KEY = "evs-eye-access-token";

type Bootstrap = {
  client: { name: string; companyCode?: string; status: string };
  route: "ONBOARDING" | "WAITING" | "REJECTED" | "SUSPENDED" | "DASHBOARD";
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

export default function ClientHome() {
  const [data, setData] = useState<Bootstrap | null>(null);
  const [dashboard, setDashboard] = useState<ClientDashboard | null>(null);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const token = sessionStorage.getItem(ACCESS_TOKEN_KEY);
    if (!token) {
      window.location.assign("/");
      return;
    }
    fetch(`${API_URL}/client/bootstrap`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok)
          throw new Error(
            body.error?.message ??
              body.message ??
              "Unable to load client workspace.",
          );
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
  if (error)
    return (
      <main className="client-gate">
        <section>
          <h1>Unable to open workspace</h1>
          <p>{error}</p>
          <a href="/">Return to login</a>
        </section>
      </main>
    );
  if (!data)
    return (
      <main className="client-gate">
        <section>
          <p>Loading client workspace…</p>
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
  const currentStepNumber =
    data.progress.steps.findIndex(
      (step) => step.step === data.progress.currentStep,
    ) + 1;
  if (data.route === "WAITING")
    return (
      <Gate
        title="Onboarding under review"
        text="Your onboarding submission is with EVs Eye for approval. We will notify your Client Admin once the workspace is activated."
      />
    );
  if (data.route === "REJECTED")
    return (
      <Gate
        title="Onboarding needs attention"
        text="Your submission was returned for correction. Please contact EVs Eye support to have the Client workspace reopened."
      />
    );
  if (data.route === "SUSPENDED")
    return (
      <Gate
        title="Workspace access suspended"
        text="This Client workspace is currently suspended. Please contact EVs Eye support."
      />
    );
  if (data.route === "DASHBOARD")
    return <ClientDashboardView client={data.client} dashboard={dashboard} />;
  return (
    <main className="client-workspace">
      <aside className="client-onboarding-sidebar">
        <p className="eyebrow">CLIENT ONBOARDING</p>
        <h1>Set up {data.client.name}</h1>
        <p>
          Save your progress at any time. You will resume from the latest
          incomplete step after login.
        </p>
        <ol className="client-steps">
          {data.progress.steps.map((step, index) => (
            <li
              key={step.step}
              className={
                step.step === data.progress.currentStep
                  ? "current"
                  : step.status.toLowerCase()
              }
            >
              <b>{index + 1}</b>
              <strong>{labels[step.step]}</strong>
              <span>{step.status.replaceAll("_", " ")}</span>
            </li>
          ))}
        </ol>
      </aside>
      <section className="client-onboarding-main">
        <header className="client-onboarding-context">
          <span>
            Step {currentStepNumber} of {data.progress.steps.length}
          </span>
          <p>
            {labels[data.progress.currentStep]} is in progress. Your creation
            and bulk-import results are safely saved to this workflow.
          </p>
        </header>
        {data.progress.currentStep === "HUBS" ? (
          <HubSetup onSaved={() => setRefresh((value) => value + 1)} />
        ) : data.progress.currentStep === "FLEET_MANAGERS" ? (
          <FleetManagerSetup onSaved={() => setRefresh((value) => value + 1)} />
        ) : data.progress.currentStep === "TEAM_LEADERS" ? (
          <TeamLeaderSetup onSaved={() => setRefresh((value) => value + 1)} />
        ) : data.progress.currentStep === "FLEETS" ? (
          <FleetSetup onSaved={() => setRefresh((value) => value + 1)} />
        ) : data.progress.currentStep === "RIDERS" ? (
          <RiderSetup onSaved={() => setRefresh((value) => value + 1)} />
        ) : data.progress.currentStep === "REVIEW" ? (
          <ReviewSubmit onSaved={() => setRefresh((value) => value + 1)} />
        ) : (
          <section className="client-next-step">
            <strong>{labels[data.progress.currentStep]}</strong>
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
  const request = async (path: string, body?: unknown) => {
    const response = await fetch(`${API_URL}${path}`, {
      method: "POST",
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
        "/riders",
        Object.fromEntries(
          Object.entries(form).map(([key, value]) => [key, value || undefined]),
        ),
      );
      setMessage("Rider created. Your onboarding review is ready.");
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
      <div className="client-onboarding-options">
        <form onSubmit={create} className="client-hub-form">
          <label>
            Name
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
            Mobile
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
            {busy ? "Saving…" : "Create Rider"}
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
  const [form, setForm] = useState({
    vehicleNumber: "",
    chassisNumber: "",
    homeHubId: "",
    oem: "",
    model: "",
    vehicleType: "",
    colour: "",
  });
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [filename, setFilename] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const token = () => sessionStorage.getItem(ACCESS_TOKEN_KEY) ?? "";
  useEffect(() => {
    fetch(`${API_URL}/hubs`, {
      headers: { Authorization: `Bearer ${token()}` },
    })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok)
          throw new Error(body.message ?? "Unable to load Hubs.");
        setHubs(body.data);
      })
      .catch((cause: unknown) =>
        setMessage(
          cause instanceof Error ? cause.message : "Unable to load Hubs.",
        ),
      );
  }, []);
  const request = async (path: string, body: unknown) => {
    const response = await fetch(`${API_URL}${path}`, {
      method: "POST",
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
      await request("/fleets", {
        ...form,
        vehicleNumber: form.vehicleNumber.trim().toUpperCase(),
        chassisNumber: form.chassisNumber.trim().toUpperCase(),
        homeHubId: form.homeHubId || undefined,
        currentHubId: form.homeHubId || undefined,
        oem: form.oem || undefined,
        model: form.model || undefined,
        vehicleType: form.vehicleType || undefined,
        colour: form.colour || undefined,
      });
      setMessage("Fleet created. Rider creation is available next.");
      onSaved();
    } catch (cause) {
      setMessage(
        cause instanceof Error ? cause.message : "Unable to create Fleet.",
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
      const result = await request("/fleets/bulk", {
        filename,
        rows: rows.map((row) => {
          const hubId = byCode.get(
            (row.homeHubCode ?? "").trim().toUpperCase(),
          );
          return {
            vehicleNumber: row.vehicleNumber,
            chassisNumber: row.chassisNumber,
            homeHubId: hubId,
            currentHubId: hubId,
            oem: row.oem || undefined,
            model: row.model || undefined,
            vehicleType: row.vehicleType || undefined,
            colour: row.colour || undefined,
          };
        }),
      });
      setMessage(
        `Import ${result.status.replaceAll("_", " ")}: ${result.passedRows} passed, ${result.failedRows} failed.`,
      );
      if (result.failedRows && result.jobId) {
        const response = await fetch(
          `${API_URL}/fleets/imports/${result.jobId}/failed-records`,
          { headers: { Authorization: `Bearer ${token()}` } },
        );
        const csv = await response.text();
        const anchor = document.createElement("a");
        anchor.href = URL.createObjectURL(
          new Blob([csv], { type: "text/csv" }),
        );
        anchor.download = "fleet-import-failures.csv";
        anchor.click();
        URL.revokeObjectURL(anchor.href);
      }
      onSaved();
    } catch (cause) {
      setMessage(
        cause instanceof Error ? cause.message : "Unable to import Fleets.",
      );
    } finally {
      setBusy(false);
    }
  };
  const downloadTemplate = () => {
    const csv =
      "vehicleNumber,chassisNumber,homeHubCode,oem,model,vehicleType,colour\nDL01EV0001,ME4JF123456789001,HUB-DEL-01,Zelio,Gracy,2W,White\n";
    const anchor = document.createElement("a");
    anchor.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    anchor.download = "evs-eye-fleets-template.csv";
    anchor.click();
    URL.revokeObjectURL(anchor.href);
  };
  return (
    <section className="client-onboarding-action">
      <div>
        <p className="eyebrow">STEP 4 · FLEETS</p>
        <h2>Onboard your fleet</h2>
        <p>
          Choose the home Hub for every vehicle. The current Hub is initialized
          from that operational base.
        </p>
      </div>
      <div className="client-onboarding-options">
        <form onSubmit={create} className="client-hub-form">
          <label>
            Vehicle number
            <input
              required
              value={form.vehicleNumber}
              onChange={(event) =>
                setForm({ ...form, vehicleNumber: event.target.value })
              }
              placeholder="DL01EV0001"
            />
          </label>
          <label>
            Chassis / VIN
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
            Home Hub
            <select
              value={form.homeHubId}
              onChange={(event) =>
                setForm({ ...form, homeHubId: event.target.value })
              }
            >
              <option value="">No Hub assigned</option>
              {hubs.map((hub) => (
                <option key={hub.id} value={hub.id}>
                  {hub.code} · {hub.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            OEM
            <input
              value={form.oem}
              onChange={(event) =>
                setForm({ ...form, oem: event.target.value })
              }
              placeholder="Zelio"
            />
          </label>
          <label>
            Model
            <input
              value={form.model}
              onChange={(event) =>
                setForm({ ...form, model: event.target.value })
              }
              placeholder="Gracy"
            />
          </label>
          <label>
            Vehicle type
            <input
              value={form.vehicleType}
              onChange={(event) =>
                setForm({ ...form, vehicleType: event.target.value })
              }
              placeholder="2W"
            />
          </label>
          <label className="client-form-wide">
            Colour
            <input
              value={form.colour}
              onChange={(event) =>
                setForm({ ...form, colour: event.target.value })
              }
              placeholder="White"
            />
          </label>
          <button disabled={busy} type="submit">
            {busy ? "Saving…" : "Create Fleet"}
          </button>
        </form>
        <div className="client-bulk-card">
          <h3>Bulk upload</h3>
          <p>
            Use Hub codes in the <code>homeHubCode</code> column.
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
            disabled={busy || !rows.length}
            type="button"
            onClick={bulkCreate}
          >
            {busy ? "Importing…" : "Import Fleets"}
          </button>
        </div>
      </div>
      {message ? <p className="client-action-message">{message}</p> : null}
    </section>
  );
}

function TeamLeaderSetup({ onSaved }: { onSaved: () => void }) {
  const [form, setForm] = useState({
    name: "",
    mobile: "",
    email: "",
    employeeCode: "",
    designation: "",
  });
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [filename, setFilename] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const token = () => sessionStorage.getItem(ACCESS_TOKEN_KEY) ?? "";
  const request = async (path: string, body?: unknown) => {
    const response = await fetch(`${API_URL}${path}`, {
      method: "POST",
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
      await request("/client/users/team-leaders", {
        ...form,
        email: form.email || undefined,
        employeeCode: form.employeeCode || undefined,
        designation: form.designation || undefined,
      });
      setMessage("Team Leader created. Fleet creation is available next.");
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
      <div className="client-onboarding-options">
        <form onSubmit={create} className="client-hub-form">
          <label>
            Name
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
            Mobile
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
            Email (optional)
            <input
              type="email"
              value={form.email}
              onChange={(event) =>
                setForm({ ...form, email: event.target.value })
              }
              placeholder="leader@company.com"
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
          <button disabled={busy} type="submit">
            {busy ? "Saving…" : "Create Team Leader"}
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
    fetch(`${API_URL}/hubs`, {
      headers: { Authorization: `Bearer ${token()}` },
    })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok)
          throw new Error(body.message ?? "Unable to load Hubs.");
        setHubs(body.data);
      })
      .catch((cause: unknown) =>
        setMessage(
          cause instanceof Error ? cause.message : "Unable to load Hubs.",
        ),
      );
  }, []);
  const request = async (path: string, body: unknown) => {
    const response = await fetch(`${API_URL}${path}`, {
      method: "POST",
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
      await request("/client/users/fleet-managers", {
        ...form,
        email: form.email || undefined,
        hubIds: selectedHubIds,
      });
      setMessage(
        "Fleet Manager created. Team Leader creation is available next.",
      );
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
      <div className="client-onboarding-options">
        <form onSubmit={create} className="client-hub-form">
          <label>
            Name
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
            Mobile
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
            Primary Hub
            <select
              required
              value={form.primaryHubId}
              onChange={(event) =>
                setForm({ ...form, primaryHubId: event.target.value })
              }
            >
              <option value="">Select primary Hub</option>
              {hubs
                .filter((hub) => selectedHubIds.includes(hub.id))
                .map((hub) => (
                  <option key={hub.id} value={hub.id}>
                    {hub.code} · {hub.name}
                  </option>
                ))}
            </select>
          </label>
          <button disabled={busy || !selectedHubIds.length} type="submit">
            {busy ? "Saving…" : "Create Fleet Manager"}
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
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [filename, setFilename] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const token = () => sessionStorage.getItem(ACCESS_TOKEN_KEY) ?? "";
  const request = async (path: string, body: unknown) => {
    const response = await fetch(`${API_URL}${path}`, {
      method: "POST",
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
      await request("/hubs", {
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
        "Hub created. You can now continue to Fleet Manager creation.",
      );
      setForm(emptyForm);
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
      <div className="client-onboarding-options">
        <form onSubmit={create} className="client-hub-form">
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
              <option value="OPERATIONS">Operations</option>
              <option value="PARKING">Parking</option>
              <option value="CHARGING">Charging</option>
              <option value="BATTERY_SWAP">Battery swap</option>
              <option value="MAINTENANCE">Maintenance</option>
              <option value="WAREHOUSE">Warehouse</option>
              <option value="DELIVERY">Delivery</option>
              <option value="MIXED">Mixed</option>
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
              <option value="ACTIVE">Active</option>
              <option value="INACTIVE">Inactive</option>
              <option value="TEMPORARILY_CLOSED">Temporarily closed</option>
              <option value="UNDER_MAINTENANCE">Under maintenance</option>
              <option value="FULL">Full</option>
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
            {busy ? "Saving…" : "Create Hub"}
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
        <a href="/">Operations workspace</a>
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
  return (
    <main className="client-gate">
      <section>
        <p className="eyebrow">EVS EYE · CLIENT WORKSPACE</p>
        <h1>{title}</h1>
        <p>{text}</p>
        <a href="/">Return to login</a>
      </section>
    </main>
  );
}
