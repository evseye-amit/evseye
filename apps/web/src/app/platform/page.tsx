"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import { OtpCodeInput } from "../components/otp-code-input";
import { UiIcon } from "../components/ui-icon";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000/api/v1";
const ACCESS_TOKEN_KEY = "evs-eye-access-token";
const REFRESH_TOKEN_KEY = "evs-eye-refresh-token";
const indianMobileInput = (value: string) =>
  value.replace(/\D/g, "").slice(-10);

async function api(path: string, options: RequestInit = {}) {
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
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
  const [token] = useState(() =>
    typeof window === "undefined" ? "" : (sessionStorage.getItem(ACCESS_TOKEN_KEY) ?? ""),
  );
  const [phone, setPhone] = useState("");
  const [otpRequestId, setOtpRequestId] = useState("");
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (token) router.replace("/platform/dashboard");
  }, [router, token]);

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
      setNotice("OTP sent successfully. Enter the six-digit code below to continue.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to request OTP.");
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
      router.replace("/platform/dashboard");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to verify OTP.");
    } finally {
      setLoading(false);
    }
  }

  if (token) return <main className="platform-login" />;

  return (
    <main className="platform-login">
      <section className="platform-login-card">
        <p className="eyebrow">EVS EYE · PLATFORM CONTROL</p>
        <h1>{otpRequestId ? "Verify your number" : "Super Admin"}</h1>
        <p className="muted">
          {otpRequestId
            ? `Enter the six-digit code sent to ${phone}. Your browser may fill it automatically from your SMS.`
            : "Secure access for EVs Eye platform administrators."}
        </p>
        {!otpRequestId ? (
          <form className="auth-form" onSubmit={sendOtp}>
            <label>
              Mobile number *
             <span className="auth-input">
                <UiIcon name="phone" />
                <input value={phone} onChange={(event) => setPhone(indianMobileInput(event.target.value))} placeholder="10-digit mobile number" type="tel" inputMode="numeric" autoComplete="tel" maxLength={10} pattern="[6-9][0-9]{9}" required />
              </span>
            </label>
            <button className="auth-submit" disabled={loading}>
              {loading ? "Sending code…" : "Send OTP"}
              <UiIcon name="arrowRight" />
            </button>
          </form>
        ) : (
          <form className="auth-form" onSubmit={verifyOtp}>
            <label className="otp-code-label">
              <span>Six-digit OTP <span className="sa-required-star" aria-hidden="true">*</span></span>
              <span className="otp-code-hint">One digit per box. You can type, paste, or use SMS auto-fill.</span>
              <OtpCodeInput value={code} onChange={setCode} disabled={loading} />
            </label>
            <button className="auth-submit" disabled={loading || code.length !== 6}>
              {loading ? "Verifying…" : "Verify OTP"}
              <UiIcon name="arrowRight" />
            </button>
          </form>
        )}
        {notice && <p className="notice auth-message">{notice}</p>}
        {error && <p className="error auth-message">{error}</p>}
        <Link className="platform-back-link" href="/">Client Operations Panel Login</Link>
      </section>
    </main>
  );
}
