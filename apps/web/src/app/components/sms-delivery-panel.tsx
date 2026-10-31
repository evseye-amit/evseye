"use client";
import { useEffect, useState } from "react";

type Delivery = { id: string; provider: string; status: string; attempt: number; errorCode?: string | null; createdAt: string; completedAt?: string | null; otpRequest: { phone: string; purpose: string; appCode?: string | null; clientId?: string | null } };

export function SmsDeliveryPanel({ token }: { token: string }) {
  const [rows, setRows] = useState<Delivery[]>([]);
  const [error, setError] = useState("");
  const load = async () => { const response = await fetch("/api/v1/auth/sms-deliveries?limit=100", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" }); const body = await response.json(); if (!response.ok) throw new Error(body.error?.message ?? body.message ?? "Unable to load SMS delivery history."); setRows(body.data ?? []); };
  useEffect(() => { void load().catch((cause) => setError(cause instanceof Error ? cause.message : "Unable to load SMS delivery history.")); }, []);
  return <section className="client-dashboard-section"><header><h2>SMS delivery history</h2><button type="button" onClick={() => void load().catch((cause) => setError(cause instanceof Error ? cause.message : "Unable to refresh SMS history."))}>Refresh</button></header>{error ? <p role="alert">{error}</p> : null}<div className="client-data-table"><table><thead><tr><th>Created</th><th>Phone</th><th>Purpose</th><th>Provider</th><th>Status</th><th>Attempt</th><th>Error</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td>{new Date(row.createdAt).toLocaleString()}</td><td>{row.otpRequest.phone}</td><td>{row.otpRequest.purpose}</td><td>{row.provider}</td><td>{row.status}</td><td>{row.attempt}</td><td>{row.errorCode ?? "—"}</td></tr>)}</tbody></table></div></section>;
}
