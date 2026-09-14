"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000/api/v1";
const ACCESS_TOKEN_KEY = "evs-eye-access-token";
const REFRESH_TOKEN_KEY = "evs-eye-refresh-token";

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
      setNotice("OTP sent. Enter the six-digit code to continue.");
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
            ? `Enter the OTP sent to ${phone}.`
            : "Secure access for EVs Eye platform administrators."}
        </p>
        {!otpRequestId ? (
          <form className="auth-form" onSubmit={sendOtp}>
            <label>
              Mobile number
              <span className="auth-input">
                <span>⌕</span>
                <input value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="+91 91000 00000" type="tel" required />
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
                <input value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))} inputMode="numeric" maxLength={6} required autoFocus />
              </span>
            </label>
            <button className="auth-submit" disabled={loading}>
              {loading ? "Verifying…" : "Verify and enter"}
            </button>
          </form>
        )}
        {notice && <p className="notice auth-message">{notice}</p>}
        {error && <p className="error auth-message">{error}</p>}
        <Link className="platform-back-link" href="/">Client operations login</Link>
      </section>
    </main>
  );
}
