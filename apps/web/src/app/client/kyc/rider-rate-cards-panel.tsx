"use client";

import { useCallback, useEffect, useState } from "react";
import { sessionFetch } from "../../../lib/session-fetch";

type Rate = {
  id: string;
  rentalPeriodType: string;
  amount: string;
  includedKm?: string | null;
  extraKmRate?: string | null;
  taxable: boolean;
  isActive: boolean;
};
type Rule = {
  id: string;
  code: string;
  name: string;
  amount: string;
  isActive?: boolean;
  city?: string | null;
  hubId?: string | null;
  oemId?: string | null;
  clientWorkPartnerId?: string | null;
  minVehicleAgeMonths?: number | null;
  maxVehicleAgeMonths?: number | null;
};
type Version = {
  id: string;
  version: number;
  effectiveFrom: string;
  status: string;
  rentalRates: Rate[];
  fees?: Rule[];
  deposits?: Rule[];
};
type Card = {
  id: string;
  code: string;
  name: string;
  description?: string | null;
  currency: string;
  status: string;
  isDefault: boolean;
  collectFirstRentalUpfront?: boolean;
  offerValidityMinutes?: number;
  versions: Version[];
};
type RuleOptions = {
  oems: { id: string; displayName: string; code: string }[];
  hubs: { id: string; name: string; city?: string }[];
  workPartners: { id: string; name: string; code: string }[];
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await sessionFetch(`/api/v1/rider-rate-cards${path}`, {
    cache: "no-store",
    ...init,
  });
  const body = (await response.json()) as {
    data?: T;
    message?: string;
    error?: { message?: string };
  };
  if (!response.ok)
    throw new Error(
      body.error?.message ??
        body.message ??
        "Unable to update rider rate cards.",
    );
  return (body.data ?? body) as T;
}

async function contextRequest<T>(path: string): Promise<T> {
  const response = await sessionFetch(`/api/v1${path}`, { cache: "no-store" });
  const body = (await response.json()) as {
    data?: T;
    message?: string;
    error?: { message?: string };
  };
  if (!response.ok)
    throw new Error(
      body.error?.message ?? body.message ?? "Unable to load pricing options.",
    );
  return (body.data ?? body) as T;
}

import { RuleEditor } from "./rider-rate-card-rules";

export default function RiderRateCardsPanel({
  canManage,
}: {
  canManage: boolean;
}) {
  const [cards, setCards] = useState<Card[]>([]);
  const [ruleOptions, setRuleOptions] = useState<RuleOptions>({
    oems: [],
    hubs: [],
    workPartners: [],
  });
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [form, setForm] = useState({
    code: "",
    name: "",
    description: "",
    amount: "",
    period: "MONTHLY",
    includedKm: "",
    extraKmRate: "",
    deposit: "500.00",
    onboardingFee: "1939.00",
    offerValidityMinutes: "60",
    collectFirstRentalUpfront: true,
    ruleCity: "",
    ruleHubId: "",
    ruleOemId: "",
    ruleWorkPartnerId: "",
    minVehicleAgeMonths: "",
    maxVehicleAgeMonths: "",
  });

  useEffect(() => {
    void Promise.all([
      contextRequest<{ oems: RuleOptions["oems"] }>(
        "/fleets/onboarding-options",
      ),
      contextRequest<RuleOptions["hubs"]>("/hubs"),
      contextRequest<RuleOptions["workPartners"]>(
        "/client/work-partners/active",
      ),
    ])
      .then(([fleet, hubs, workPartners]) =>
        setRuleOptions({ oems: fleet.oems, hubs, workPartners }),
      )
      .catch(() => undefined);
  }, []);

  const load = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      setCards(await request<Card[]>(""));
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Unable to load rider rate cards.",
      );
    } finally {
      setBusy(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function addPlan(event: React.FormEvent) {
    event.preventDefault();
    if (!canManage || busy) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const card = await request<Card>("", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: form.code.trim(),
          name: form.name.trim(),
          description: form.description.trim() || undefined,
          currency: "INR",
          isDefault: cards.length === 0,
          offerValidityMinutes: Number(form.offerValidityMinutes),
          collectFirstRentalUpfront: form.collectFirstRentalUpfront,
        }),
      });
      const version = await request<Version>(`/${card.id}/versions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          effectiveFrom: new Date().toISOString().slice(0, 10),
        }),
      });
      await request(`/versions/${version.id}/rental-rates`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rentalPeriodType: form.period,
          amount: form.amount,
          includedKm: form.includedKm || undefined,
          extraKmRate: form.extraKmRate || undefined,
        }),
      });
      const created = (await request<Card>(`/${card.id}`)).versions.find(
        (item) => item.id === version.id,
      );
      const deposit = created?.deposits?.find(
        (item) => item.code === "VEHICLE-SECURITY",
      );
      const fee = created?.fees?.find((item) => item.code === "ONBOARDING_FEE");
      const scope = {
        city: form.ruleCity || undefined,
        hubId: form.ruleHubId || undefined,
        oemId: form.ruleOemId || undefined,
        clientWorkPartnerId: form.ruleWorkPartnerId || undefined,
        minVehicleAgeMonths: form.minVehicleAgeMonths
          ? Number(form.minVehicleAgeMonths)
          : undefined,
        maxVehicleAgeMonths: form.maxVehicleAgeMonths
          ? Number(form.maxVehicleAgeMonths)
          : undefined,
      };
      if (deposit)
        await request(`/versions/${version.id}/deposits/${deposit.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            code: "VEHICLE-SECURITY",
            name: "Vehicle security deposit",
            depositType: "VEHICLE_SECURITY",
            amount: form.deposit || "500.00",
            waiverAmount: "0.00",
            ...scope,
          }),
        });
      if (fee)
        await request(`/versions/${version.id}/fees/${fee.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            code: "ONBOARDING_FEE",
            name: "Onboarding fee",
            chargeType: "ONBOARDING_FEE",
            nature: "ONE_TIME",
            eligibility: "ONCE_PER_CLIENT_RIDER_RELATIONSHIP",
            amount: form.onboardingFee || "1939.00",
            taxable: false,
            priceIncludesTax: false,
            ...scope,
          }),
        });
      setForm({
        code: "",
        name: "",
        description: "",
        amount: "",
        period: "MONTHLY",
        includedKm: "",
        extraKmRate: "",
        deposit: "500.00",
        onboardingFee: "1939.00",
        offerValidityMinutes: "60",
        collectFirstRentalUpfront: true,
        ruleCity: "",
        ruleHubId: "",
        ruleOemId: "",
        ruleWorkPartnerId: "",
        minVehicleAgeMonths: "",
        maxVehicleAgeMonths: "",
      });
      setMessage(
        "Draft rate card created with rental, deposit, onboarding-fee, and targeting configuration. Review before activation.",
      );
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to create rate card.");
    } finally {
      setBusy(false);
    }
  }

  async function activate(versionId: string) {
    setBusy(true);
    setError("");
    try {
      await request(`/versions/${versionId}/activate`, { method: "POST" });
      setMessage("Rate-card version activated.");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to activate version.");
    } finally {
      setBusy(false);
    }
  }
  async function deactivate(cardId: string) {
    setBusy(true);
    setError("");
    try {
      await request(`/${cardId}/deactivate`, { method: "POST" });
      setMessage("Rate card deactivated.");
      await load();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Unable to deactivate rate card.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-label="Rider rate cards">
      <div className="sa-card-head">
        <div>
          <p className="eyebrow">ENGAGEMENT &amp; SUPPORT</p>
          <h2>Rider Rate Cards</h2>
          <p>
            Manage rental pricing, deposits, onboarding fees, and offer rules
            used when creating rider agreements.
          </p>
        </div>
        {canManage && (
          <button
            type="button"
            onClick={() =>
              document
                .getElementById("rider-rate-card-form")
                ?.scrollIntoView({ behavior: "smooth", block: "start" })
            }
          >
            + Create rate card
          </button>
        )}
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {message && <p role="status">{message}</p>}
      {canManage && (
        <form
          id="rider-rate-card-form"
          className="form-grid kyc-config-panel"
          onSubmit={addPlan}
        >
          <label>
            Code *
            <input
              required
              value={form.code}
              onChange={(e) => setForm({ ...form, code: e.target.value })}
              placeholder="STANDARD-2026"
            />
          </label>
          <label>
            Name *
            <input
              required
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Standard Rider Plan"
            />
          </label>
          <label className="form-grid-full">
            Description
            <textarea
              rows={2}
              value={form.description}
              onChange={(e) =>
                setForm({ ...form, description: e.target.value })
              }
            />
          </label>
          <label>
            Period
            <select
              value={form.period}
              onChange={(e) => setForm({ ...form, period: e.target.value })}
            >
              {["DAILY", "WEEKLY", "FORTNIGHTLY", "MONTHLY", "QUARTERLY"].map(
                (v) => (
                  <option key={v}>{v}</option>
                ),
              )}
            </select>
          </label>
          <label>
            Rental amount (INR) *
            <input
              required
              inputMode="decimal"
              value={form.amount}
              onChange={(e) => setForm({ ...form, amount: e.target.value })}
            />
          </label>
          <label>
            Included km
            <input
              inputMode="decimal"
              value={form.includedKm}
              onChange={(e) => setForm({ ...form, includedKm: e.target.value })}
            />
          </label>
          <label>
            Extra km rate (INR)
            <input
              inputMode="decimal"
              value={form.extraKmRate}
              onChange={(e) =>
                setForm({ ...form, extraKmRate: e.target.value })
              }
            />
          </label>
          <label>
            Vehicle security deposit (INR)
            <input
              required
              inputMode="decimal"
              value={form.deposit}
              onChange={(e) => setForm({ ...form, deposit: e.target.value })}
            />
            <small>Default: ₹500. Enter 0.00 when waived.</small>
          </label>
          <label>
            Onboarding fee (INR)
            <input
              required
              inputMode="decimal"
              value={form.onboardingFee}
              onChange={(e) =>
                setForm({ ...form, onboardingFee: e.target.value })
              }
            />
            <small>Default: ₹1,939.</small>
          </label>
          <label>
            Offer validity (minutes)
            <input
              required
              type="number"
              min="1"
              max="10080"
              value={form.offerValidityMinutes}
              onChange={(e) =>
                setForm({ ...form, offerValidityMinutes: e.target.value })
              }
            />
          </label>
          <label className="checkbox-grid">
            <span>Collect first rental upfront</span>
            <input
              type="checkbox"
              checked={form.collectFirstRentalUpfront}
              onChange={(e) =>
                setForm({
                  ...form,
                  collectFirstRentalUpfront: e.target.checked,
                })
              }
            />
          </label>
          <fieldset className="form-grid-full kyc-rule-scope">
            <legend>Optional rule targeting</legend>
            <p>
              Leave all fields empty to create the default deposit and
              onboarding-fee rules.
            </p>
            <label>
              City
              <input
                value={form.ruleCity}
                onChange={(e) => setForm({ ...form, ruleCity: e.target.value })}
                placeholder="Hyderabad"
              />
            </label>
            <label>
              Hub
              <select
                value={form.ruleHubId}
                onChange={(e) =>
                  setForm({ ...form, ruleHubId: e.target.value })
                }
              >
                <option value="">Any hub</option>
                {ruleOptions.hubs.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              OEM
              <select
                value={form.ruleOemId}
                onChange={(e) =>
                  setForm({ ...form, ruleOemId: e.target.value })
                }
              >
                <option value="">Any OEM</option>
                {ruleOptions.oems.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.displayName} ({item.code})
                  </option>
                ))}
              </select>
            </label>
            <label>
              Work partner
              <select
                value={form.ruleWorkPartnerId}
                onChange={(e) =>
                  setForm({ ...form, ruleWorkPartnerId: e.target.value })
                }
              >
                <option value="">Any work partner</option>
                {ruleOptions.workPartners.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name} ({item.code})
                  </option>
                ))}
              </select>
            </label>
            <label>
              Minimum vehicle age (months)
              <input
                type="number"
                min="0"
                value={form.minVehicleAgeMonths}
                onChange={(e) =>
                  setForm({ ...form, minVehicleAgeMonths: e.target.value })
                }
              />
            </label>
            <label>
              Maximum vehicle age (months)
              <input
                type="number"
                min="0"
                value={form.maxVehicleAgeMonths}
                onChange={(e) =>
                  setForm({ ...form, maxVehicleAgeMonths: e.target.value })
                }
              />
            </label>
          </fieldset>
          <div className="form-grid-full">
            <button disabled={busy}>Create draft plan</button>
          </div>
        </form>
      )}
      {busy && !cards.length ? (
        <p>Loading rate cards…</p>
      ) : cards.length === 0 ? (
        <p>No rider rate cards configured.</p>
      ) : (
        <div className="sa-commercial-table-wrap">
          <table className="sa-commercial-table">
            <thead>
              <tr>
                <th>Code</th>
                <th>Name</th>
                <th>Status</th>
                <th>Versions / rental rates</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {cards.map((card) => (
                <tr key={card.id}>
                  <td>{card.code}</td>
                  <td>
                    {card.name}
                    {card.isDefault ? " (default)" : ""}
                    <small className="record-secondary">
                      {card.description || "No description"}
                    </small>
                  </td>
                  <td>
                    <span
                      className={`status status-${card.status.toLowerCase()}`}
                    >
                      {card.status}
                    </span>
                  </td>
                  <td>
                    {card.versions.map((version) => (
                      <div key={version.id}>
                        v{version.version} ·{" "}
                        <span
                          className={`status status-${version.status.toLowerCase()}`}
                        >
                          {version.status}
                        </span>{" "}
                        ·{" "}
                        {version.rentalRates
                          .map(
                            (rate) =>
                              `${rate.rentalPeriodType} INR ${rate.amount}`,
                          )
                          .join(", ")}{" "}
                        {canManage &&
                          version.status === "DRAFT" &&
                          version.rentalRates.length > 0 && (
                            <button
                              type="button"
                              className="secondary table-action"
                              disabled={busy}
                              onClick={() => void activate(version.id)}
                            >
                              Activate
                            </button>
                          )}
                        <RuleEditor
                          version={version}
                          canManage={canManage}
                          busy={busy}
                          onSaved={() => void load()}
                        />
                      </div>
                    ))}
                  </td>
                  <td>
                    {canManage && card.status === "ACTIVE" && (
                      <button
                        type="button"
                        className="danger table-action"
                        disabled={busy}
                        onClick={() => void deactivate(card.id)}
                      >
                        Deactivate
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
