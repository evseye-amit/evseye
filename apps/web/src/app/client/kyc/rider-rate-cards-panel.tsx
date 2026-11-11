"use client";

import { useCallback, useEffect, useState } from "react";
import { sessionFetch } from "../../../lib/session-fetch";

type Rate = { id: string; rentalPeriodType: string; amount: string; includedKm?: string | null; extraKmRate?: string | null; taxable: boolean; isActive: boolean };
type Version = { id: string; version: number; effectiveFrom: string; status: string; rentalRates: Rate[] };
type Card = { id: string; code: string; name: string; currency: string; status: string; isDefault: boolean; versions: Version[] };

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await sessionFetch(`/api/v1/rider-rate-cards${path}`, { cache: "no-store", ...init });
  const body = await response.json() as { data?: T; message?: string; error?: { message?: string } };
  if (!response.ok) throw new Error(body.error?.message ?? body.message ?? "Unable to update rider rate cards.");
  return (body.data ?? body) as T;
}

export default function RiderRateCardsPanel({ canManage }: { canManage: boolean }) {
  const [cards, setCards] = useState<Card[]>([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [form, setForm] = useState({ code: "", name: "", amount: "", period: "MONTHLY", includedKm: "", extraKmRate: "", deposit: "0.00", onboardingFee: "0.00" });

  const load = useCallback(async () => { setBusy(true); setError(""); try { setCards(await request<Card[]>("")); } catch (e) { setError(e instanceof Error ? e.message : "Unable to load rider rate cards."); } finally { setBusy(false); } }, []);
  useEffect(() => { void load(); }, [load]);

  async function addPlan(event: React.FormEvent) {
    event.preventDefault(); if (!canManage || busy) return; setBusy(true); setError(""); setMessage("");
    try {
      const card = await request<Card>("", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: form.code.trim(), name: form.name.trim(), currency: "INR", isDefault: cards.length === 0 }) });
      const version = await request<Version>(`/${card.id}/versions`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ effectiveFrom: new Date().toISOString().slice(0, 10) }) });
      await request(`/versions/${version.id}/rental-rates`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rentalPeriodType: form.period, amount: form.amount, includedKm: form.includedKm || undefined, extraKmRate: form.extraKmRate || undefined }) });
      await request(`/versions/${version.id}/deposits`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: "VEHICLE-SECURITY", name: "Vehicle security deposit", depositType: "VEHICLE_SECURITY", amount: form.deposit || "0.00", waiverAmount: "0.00" }) });
      await request(`/versions/${version.id}/fees`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: "ONBOARDING_FEE", name: "Onboarding fee", chargeType: "ONBOARDING_FEE", nature: "ONE_TIME", eligibility: "ONCE_PER_CLIENT_RIDER_RELATIONSHIP", amount: form.onboardingFee || "0.00", taxable: false, priceIncludesTax: false }) });
      setForm({ code: "", name: "", amount: "", period: "MONTHLY", includedKm: "", extraKmRate: "", deposit: "0.00", onboardingFee: "0.00" }); setMessage("Draft rate card created with rental, deposit, and onboarding-fee configuration. Review before activation."); await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to create rate card."); } finally { setBusy(false); }
  }

  async function activate(versionId: string) { setBusy(true); setError(""); try { await request(`/versions/${versionId}/activate`, { method: "POST" }); setMessage("Rate-card version activated."); await load(); } catch (e) { setError(e instanceof Error ? e.message : "Unable to activate version."); } finally { setBusy(false); } }

  return <section aria-label="Rider rate cards"><h2>Rider Rate Cards</h2><p>Configure rental pricing used when creating rider offers. Existing agreements keep their original pricing snapshot.</p>
    {error && <p className="error" role="alert">{error}</p>}{message && <p role="status">{message}</p>}
    {canManage && <form className="form-grid" onSubmit={addPlan}><label>Code *<input required value={form.code} onChange={e => setForm({ ...form, code: e.target.value })} placeholder="STANDARD-2026" /></label><label>Name *<input required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Standard Rider Plan" /></label><label>Period<select value={form.period} onChange={e => setForm({ ...form, period: e.target.value })}>{["DAILY", "WEEKLY", "FORTNIGHTLY", "MONTHLY", "QUARTERLY"].map(v => <option key={v}>{v}</option>)}</select></label><label>Rental amount (INR) *<input required inputMode="decimal" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} /></label><label>Included km<input inputMode="decimal" value={form.includedKm} onChange={e => setForm({ ...form, includedKm: e.target.value })} /></label><label>Extra km rate<input inputMode="decimal" value={form.extraKmRate} onChange={e => setForm({ ...form, extraKmRate: e.target.value })} /></label><label>Vehicle security deposit (INR)<input required inputMode="decimal" value={form.deposit} onChange={e => setForm({ ...form, deposit: e.target.value })} /><small>Enter 0.00 when waived.</small></label><label>Onboarding fee (INR)<input required inputMode="decimal" value={form.onboardingFee} onChange={e => setForm({ ...form, onboardingFee: e.target.value })} /><small>Enter 0.00 when not applicable.</small></label><div><button disabled={busy}>Create draft plan</button></div></form>}
    {busy && !cards.length ? <p>Loading rate cards…</p> : cards.length === 0 ? <p>No rider rate cards configured.</p> : <div className="sa-commercial-table-wrap"><table className="sa-commercial-table"><thead><tr><th>Code</th><th>Name</th><th>Status</th><th>Versions / rental rates</th></tr></thead><tbody>{cards.map(card => <tr key={card.id}><td>{card.code}</td><td>{card.name}{card.isDefault ? " (default)" : ""}</td><td>{card.status}</td><td>{card.versions.map(version => <div key={version.id}>v{version.version} · {version.status} · {version.rentalRates.map(rate => `${rate.rentalPeriodType} INR ${rate.amount}`).join(", ")} {canManage && version.status === "DRAFT" && version.rentalRates.length > 0 && <button type="button" className="secondary table-action" disabled={busy} onClick={() => void activate(version.id)}>Activate</button>}</div>)}</td></tr>)}</tbody></table></div>}
  </section>;
}
