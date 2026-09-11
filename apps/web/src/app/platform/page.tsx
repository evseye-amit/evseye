"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";

const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000/api/v1";
const ACCESS_TOKEN_KEY = "evs-eye-access-token";
const REFRESH_TOKEN_KEY = "evs-eye-refresh-token";

type Step = {
  stepKey: string;
  displayName: string;
  stage: number;
  category: string;
  isLockable: boolean;
};
type ConfigStep = Step & {
  enabled: boolean;
  mandatory: boolean;
  blocking: boolean;
  sequenceNo: number;
  verificationMode: string;
  slaHours?: number | null;
  dependsOn: string[];
};
type Config = {
  id: string;
  version: number;
  status: string;
  steps: Array<ConfigStep & { definition: Step }>;
};
type Tenant = {
  id: string;
  name: string;
  slug: string;
  isActive: boolean;
  _count: { users: number; riders: number; onboardingConfigs: number };
};

async function api(path: string, options: RequestInit = {}, token?: string) {
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });
  const body = (await response.json().catch(() => ({}))) as {
    data?: unknown;
    error?: { message?: string };
    message?: string;
  };
  if (!response.ok)
    throw new Error(body.error?.message ?? body.message ?? "Request failed.");
  return body.data;
}

export default function PlatformPage() {
  const router = useRouter();
  const [token, setToken] = useState(() =>
    typeof window === "undefined"
      ? ""
      : (sessionStorage.getItem(ACCESS_TOKEN_KEY) ?? ""),
  );
  const [phone, setPhone] = useState("");
  const [otpRequestId, setOtpRequestId] = useState("");
  const [code, setCode] = useState("");
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [selectedTenant, setSelectedTenant] = useState<Tenant | null>(null);
  const [configs, setConfigs] = useState<Config[]>([]);
  const [draftSteps, setDraftSteps] = useState<ConfigStep[]>([]);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [tenantForm, setTenantForm] = useState({
    name: "",
    slug: "",
    adminName: "",
    adminMobile: "",
  });

  useEffect(() => {
    if (token) void loadPlatform();
    // Initial platform data only needs to reload after a mutation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  async function loadPlatform() {
    setLoading(true);
    setError("");
    try {
      const tenantData = (await api(
        "/platform/clients",
        {},
        token,
      )) as Tenant[];
      setTenants(tenantData);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Unable to load platform data.",
      );
    } finally {
      setLoading(false);
    }
  }

  async function selectTenant(tenant: Tenant) {
    setLoading(true);
    setError("");
    try {
      const configData = (await api(
        `/platform/clients/${tenant.id}/onboarding-configs`,
        {},
        token,
      )) as Config[];
      setSelectedTenant(tenant);
      setConfigs(configData);
      const editable = configData.find((config) => config.status === "DRAFT");
      setDraftSteps(
        editable
          ? editable.steps.map((step) => ({
              ...step,
              ...step.definition,
              dependsOn: step.dependsOn ?? [],
            }))
          : [],
      );
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Unable to load configuration.",
      );
    } finally {
      setLoading(false);
    }
  }

  async function sendOtp(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      const data = (await api("/auth/otp/request", {
        method: "POST",
        body: JSON.stringify({ phone }),
      })) as { otpRequestId: string };
      setOtpRequestId(data.otpRequestId);
      setNotice("OTP sent. Enter the six-digit code to continue.");
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
      const data = (await api("/auth/otp/verify", {
        method: "POST",
        body: JSON.stringify({ otpRequestId, code }),
      })) as { accessToken: string; refreshToken: string };
      sessionStorage.setItem(ACCESS_TOKEN_KEY, data.accessToken);
      sessionStorage.setItem(REFRESH_TOKEN_KEY, data.refreshToken);
      router.push("/platform/dashboard");
      setNotice("");
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Unable to verify OTP.",
      );
    } finally {
      setLoading(false);
    }
  }

  async function createTenant(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      const created = (await api(
        "/platform/clients",
        { method: "POST", body: JSON.stringify(tenantForm) },
        token,
      )) as Tenant;
      setTenantForm({ name: "", slug: "", adminName: "", adminMobile: "" });
      setNotice(
        `${created.name} was created. Create and activate its onboarding configuration next.`,
      );
      await loadPlatform();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Unable to create client.",
      );
    } finally {
      setLoading(false);
    }
  }

  async function createConfiguration() {
    if (!selectedTenant) return;
    setLoading(true);
    setError("");
    try {
      await api(
        `/platform/clients/${selectedTenant.id}/onboarding-configs`,
        { method: "POST", body: JSON.stringify({}) },
        token,
      );
      await selectTenant(selectedTenant);
      setNotice(
        "Draft onboarding configuration created from the master catalog.",
      );
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Unable to create configuration.",
      );
    } finally {
      setLoading(false);
    }
  }

  async function saveDraft() {
    const draft = configs.find((config) => config.status === "DRAFT");
    if (!draft) return;
    setLoading(true);
    setError("");
    try {
      await api(
        `/platform/onboarding-configs/${draft.id}/steps`,
        {
          method: "PUT",
          body: JSON.stringify({
            steps: draftSteps.map((step, index) => ({
              stepKey: step.stepKey,
              enabled: step.enabled,
              mandatory: step.mandatory,
              blocking: step.blocking,
              sequenceNo: index + 1,
              verificationMode: step.verificationMode,
              ...(step.slaHours ? { slaHours: Number(step.slaHours) } : {}),
              dependsOn: step.dependsOn,
              params: {},
            })),
          }),
        },
        token,
      );
      if (selectedTenant) await selectTenant(selectedTenant);
      setNotice(
        "Draft saved. Activate it when the required workflow is confirmed.",
      );
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Unable to save configuration.",
      );
    } finally {
      setLoading(false);
    }
  }

  async function activateDraft() {
    const draft = configs.find((config) => config.status === "DRAFT");
    if (!draft || !selectedTenant) return;
    setLoading(true);
    setError("");
    try {
      await api(
        `/platform/onboarding-configs/${draft.id}/activate`,
        { method: "POST" },
        token,
      );
      await selectTenant(selectedTenant);
      setNotice(
        "The draft is now active. Any prior active version was archived.",
      );
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Unable to activate configuration.",
      );
    } finally {
      setLoading(false);
    }
  }

  if (!token) {
    return (
      <main className="platform-login">
        <section className="platform-login-card">
          <p className="eyebrow">EVS EYE · PLATFORM CONTROL</p>
          <h1>{otpRequestId ? "Verify your number" : "Super Admin"}</h1>
          <p className="muted">
            {otpRequestId
              ? `Enter the OTP sent to ${phone}.`
              : "Secure access for EVs Eye platform administrators."}
          </p>
          {!otpRequestId ? (
            <form className="auth-form" onSubmit={sendOtp}>
              <label>
                Mobile number
                <span className="auth-input">
                  <span>⌕</span>
                  <input
                    value={phone}
                    onChange={(event) => setPhone(event.target.value)}
                    placeholder="+91 91000 00000"
                    type="tel"
                    required
                  />
                </span>
              </label>
              <button className="auth-submit" disabled={loading}>
                {loading ? "Sending code…" : "Send OTP"}
              </button>
            </form>
          ) : (
            <form className="auth-form" onSubmit={verifyOtp}>
              <label>
                Six-digit OTP
                <span className="auth-input auth-otp-input">
                  <span>#</span>
                  <input
                    value={code}
                    onChange={(event) =>
                      setCode(event.target.value.replace(/\D/g, ""))
                    }
                    inputMode="numeric"
                    maxLength={6}
                    required
                    autoFocus
                  />
                </span>
              </label>
              <button className="auth-submit" disabled={loading}>
                {loading ? "Verifying…" : "Verify and enter"}
              </button>
            </form>
          )}
          {notice && <p className="notice auth-message">{notice}</p>}
          {error && <p className="error auth-message">{error}</p>}
          <Link className="platform-back-link" href="/">
            Client operations login
          </Link>
        </section>
      </main>
    );
  }

  const draft = configs.find((config) => config.status === "DRAFT");
  return (
    <main className="platform-shell">
      <header className="platform-header">
        <div>
          <p className="eyebrow">EVS EYE · PLATFORM CONTROL</p>
          <h1>Super Admin</h1>
        </div>
        <button
          className="secondary"
          onClick={() => {
            sessionStorage.removeItem(ACCESS_TOKEN_KEY);
            sessionStorage.removeItem(REFRESH_TOKEN_KEY);
            setToken("");
          }}
        >
          Sign out
        </button>
      </header>
      {notice && <p className="notice">{notice}</p>}
      {error && <p className="error">{error}</p>}
      <section className="platform-grid">
        <div className="panel">
          <div className="panel-heading">
            <h2>Clients</h2>
            <span>{tenants.length}</span>
          </div>
          <div className="platform-list">
            {tenants.map((tenant) => (
              <button
                key={tenant.id}
                className={
                  selectedTenant?.id === tenant.id
                    ? "platform-list-item selected"
                    : "platform-list-item"
                }
                onClick={() => void selectTenant(tenant)}
              >
                <strong>{tenant.name}</strong>
                <small>
                  {tenant.slug} · {tenant._count.riders} riders
                </small>
              </button>
            ))}
          </div>
          <form
            className="form-stack platform-create-form"
            onSubmit={createTenant}
          >
            <h3>Onboard client</h3>
            {(
              [
                ["name", "Client name"],
                ["slug", "Client workspace slug"],
                ["adminName", "Client admin name"],
                ["adminMobile", "Client admin mobile"],
              ] as const
            ).map(([field, label]) => (
              <label key={field}>
                {label}
                <input
                  value={tenantForm[field]}
                  onChange={(event) =>
                    setTenantForm((current) => ({
                      ...current,
                      [field]:
                        field === "slug"
                          ? event.target.value
                              .toLowerCase()
                              .replace(/[^a-z0-9-]/g, "")
                          : event.target.value,
                    }))
                  }
                  required
                />
              </label>
            ))}
            <button disabled={loading}>Create client</button>
          </form>
        </div>
        <div className="panel platform-config">
          <div className="panel-heading">
            <div>
              <h2>
                {selectedTenant
                  ? `${selectedTenant.name} onboarding`
                  : "Rider onboarding configuration"}
              </h2>
              <p className="muted">
                Master steps are platform-owned. Client workflows are versioned
                and activated explicitly.
              </p>
            </div>
            {selectedTenant && !draft && (
              <button
                onClick={() => void createConfiguration()}
                disabled={loading}
              >
                New version
              </button>
            )}
          </div>
          {selectedTenant ? (
            <>
              {draft ? (
                <>
                  <div className="config-actions">
                    <span className="status status-draft">
                      Draft v{draft.version}
                    </span>
                    <button
                      className="secondary"
                      onClick={() => void saveDraft()}
                      disabled={loading}
                    >
                      Save draft
                    </button>
                    <button
                      onClick={() => void activateDraft()}
                      disabled={loading}
                    >
                      Activate version
                    </button>
                  </div>
                  <div className="onboarding-steps">
                    {draftSteps.map((step) => (
                      <label className="onboarding-step" key={step.stepKey}>
                        <input
                          type="checkbox"
                          checked={step.enabled}
                          disabled={step.isLockable}
                          onChange={(event) =>
                            setDraftSteps((current) =>
                              current.map((item) =>
                                item.stepKey === step.stepKey
                                  ? { ...item, enabled: event.target.checked }
                                  : item,
                              ),
                            )
                          }
                        />
                        <span>
                          <strong>{step.displayName}</strong>
                          <small>
                            Stage {step.stage} · {step.category}
                            {step.isLockable ? " · Platform-locked" : ""}
                          </small>
                        </span>
                        <span className="step-options">
                          <input
                            type="checkbox"
                            checked={step.mandatory}
                            disabled={!step.enabled}
                            onChange={(event) =>
                              setDraftSteps((current) =>
                                current.map((item) =>
                                  item.stepKey === step.stepKey
                                    ? {
                                        ...item,
                                        mandatory: event.target.checked,
                                      }
                                    : item,
                                ),
                              )
                            }
                          />{" "}
                          Required
                        </span>
                      </label>
                    ))}
                  </div>
                </>
              ) : (
                <div className="empty-state">
                  <p>No draft configuration is open.</p>
                  <p>
                    The active version is retained until you create and activate
                    a new version.
                  </p>
                </div>
              )}
              <div className="config-history">
                <h3>Version history</h3>
                {configs.map((config) => (
                  <div key={config.id}>
                    <span
                      className={`status status-${config.status.toLowerCase()}`}
                    >
                      {config.status}
                    </span>{" "}
                    Version {config.version} ·{" "}
                    {config.steps.filter((step) => step.enabled).length} enabled
                    steps
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="empty-state">
              Select a client to configure its rider onboarding workflow.
            </div>
          )}
        </div>
      </section>
      {loading && <p className="platform-loading">Working…</p>}
    </main>
  );
}
