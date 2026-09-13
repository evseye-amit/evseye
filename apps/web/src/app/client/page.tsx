"use client";

import { useEffect, useState } from "react";

const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000/api/v1";
const ACCESS_TOKEN_KEY = "evs-eye-access-token";

type Bootstrap = {
  client: { name: string; companyCode?: string; status: string };
  route: "ONBOARDING" | "WAITING" | "REJECTED" | "SUSPENDED" | "DASHBOARD";
  progress: { currentStep: string; steps: { step: string; status: string }[] };
};

export default function ClientHome() {
  const [data, setData] = useState<Bootstrap | null>(null);
  const [error, setError] = useState("");
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
      })
      .catch((cause: unknown) =>
        setError(
          cause instanceof Error
            ? cause.message
            : "Unable to load client workspace.",
        ),
      );
  }, []);
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
    return (
      <main className="client-workspace">
        <p className="eyebrow">
          {data.client.companyCode ?? "CLIENT WORKSPACE"}
        </p>
        <h1>{data.client.name}</h1>
        <p>
          Your operational dashboard is ready. Fleet, Rider, allocation and Hub
          reporting will appear here.
        </p>
        <a href="/">Open operations workspace</a>
      </main>
    );
  return (
    <main className="client-workspace">
      <p className="eyebrow">CLIENT ONBOARDING</p>
      <h1>Set up {data.client.name}</h1>
      <p>
        Save progress at any time. You will resume from your latest incomplete
        step after login.
      </p>
      <ol className="client-steps">
        {data.progress.steps.map((step) => (
          <li
            key={step.step}
            className={
              step.step === data.progress.currentStep
                ? "current"
                : step.status.toLowerCase()
            }
          >
            <strong>{labels[step.step]}</strong>
            <span>{step.status.replaceAll("_", " ")}</span>
          </li>
        ))}
      </ol>
      <p className="notice">
        Current step: {labels[data.progress.currentStep]}. Creation and
        bulk-upload forms are being connected to this persisted workflow.
      </p>
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
