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
  const [view, setView] = useState<"overview" | "create" | "detail">(
    "overview",
  );
  const [selectedId, setSelectedId] = useState("");
  const [versionId, setVersionId] = useState("");
  const [tab, setTab] = useState("Pricing");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
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
    let cancelled = false;
    request<Card[]>("")
      .then((data) => {
        if (!cancelled) setCards(data);
      })
      .catch((cause) => {
        if (!cancelled)
          setError(
            cause instanceof Error
              ? cause.message
              : "Unable to load rider rate cards.",
          );
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

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
      setSelectedId(card.id);
      setVersionId(version.id);
      setTab("Pricing");
      setView("detail");
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

  const selected = cards.find((card) => card.id === selectedId);
  const sortedVersions = (card: Card) =>
    [...card.versions].sort((a, b) => b.version - a.version);
  const currentVersion = (card: Card) =>
    sortedVersions(card).find((v) => v.status === "ACTIVE") ??
    sortedVersions(card)[0];
  const version =
    selected?.versions.find((v) => v.id === versionId) ??
    (selected ? currentVersion(selected) : undefined);
  const money = (amount: string, currency = "INR") =>
    new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(Number(amount));
  const visibleCards = cards.filter(
    (card) =>
      (!status || card.status === status) &&
      `${card.name} ${card.code}`.toLowerCase().includes(search.toLowerCase()),
  );
  function openCard(card: Card) {
    setSelectedId(card.id);
    setVersionId(currentVersion(card)?.id ?? "");
    setTab("Pricing");
    setView("detail");
    setMessage("");
  }
  return (
    <section
      aria-label="Rider rate cards"
      className="rate-cards-workspace autopay-workspace"
    >
      {view !== "overview" && (
        <button
          type="button"
          className="secondary autopay-back"
          disabled={busy}
          onClick={() => setView("overview")}
        >
          ← Back to rate cards
        </button>
      )}
      <div className="autopay-heading">
        <div>
          <h2>
            {view === "create"
              ? "Create rate card"
              : view === "detail"
                ? selected?.name
                : "Rate cards overview"}
          </h2>
          <p>
            {view === "create"
              ? "Set rental pricing, initial charges, and eligibility rules."
              : view === "detail"
                ? selected?.description ||
                  "Review pricing, fee rules, and previous versions."
                : "Manage rental plans and rider charges."}
          </p>
        </div>
        {view === "overview" && canManage && (
          <button
            type="button"
            onClick={() => {
              setView("create");
              setMessage("");
              setError("");
            }}
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
      {canManage && view === "create" && (
        <form
          id="rider-rate-card-form"
          className="form-grid kyc-config-panel rate-card-form"
          onSubmit={addPlan}
        >
          <h3 className="form-grid-full">Plan details</h3>
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
          <h3 className="form-grid-full">Rental pricing</h3>
          <label>
            Period
            <select
              value={form.period}
              onChange={(e) => setForm({ ...form, period: e.target.value })}
            >
              {["DAILY", "WEEKLY", "FORTNIGHTLY", "MONTHLY", "QUARTERLY"].map(
                (v) => (
                  <option key={v} value={v}>
                    {v.charAt(0) + v.slice(1).toLowerCase()}
                  </option>
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
          <h3 className="form-grid-full">Initial charges</h3>
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
          <label className="rate-card-checkbox">
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
          <details className="form-grid-full rate-card-advanced">
            <summary>
              Advanced rules <span className="muted">· Optional targeting</span>
            </summary>
            <fieldset className="kyc-rule-scope">
              <legend>Eligibility &amp; targeting</legend>
              <p>
                Leave all fields empty to create the default deposit and
                onboarding-fee rules.
              </p>
              <label>
                City
                <input
                  value={form.ruleCity}
                  onChange={(e) =>
                    setForm({ ...form, ruleCity: e.target.value })
                  }
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
          </details>
          <div className="form-grid-full form-actions">
            <button disabled={busy}>
              {busy ? "Creating…" : "Create draft"}
            </button>
            <button
              type="button"
              className="secondary"
              disabled={busy}
              onClick={() => setView("overview")}
            >
              Cancel
            </button>
          </div>
        </form>
      )}
      {view === "overview" && (
        <div className="sa-card autopay-card">
          <div className="autopay-heading">
            <div>
              <h2>Rate cards</h2>
              <p>Rental pricing available for rider agreements.</p>
            </div>
            <button
              type="button"
              className="secondary"
              disabled={busy}
              onClick={() => void load()}
            >
              Refresh
            </button>
          </div>
          <div className="form-grid rate-card-filters">
            <label>
              Search rate cards
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Name or code"
              />
            </label>
            <label>
              Status
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
              >
                <option value="">All statuses</option>
                {["ACTIVE", "DRAFT", "INACTIVE"].map((value) => (
                  <option key={value} value={value}>
                    {value.charAt(0) + value.slice(1).toLowerCase()}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {busy && !cards.length ? (
            <p role="status">Loading rate cards…</p>
          ) : !visibleCards.length ? (
            <div className="autopay-empty">
              <h3>
                {cards.length ? "No matching rate cards" : "No rate cards yet"}
              </h3>
              <p>
                {cards.length
                  ? "Try another name or status."
                  : "Create a rate card to configure rental pricing and rider charges."}
              </p>
            </div>
          ) : (
            <div className="autopay-history-table">
              <table>
                <thead>
                  <tr>
                    <th>Rate card</th>
                    <th>Daily</th>
                    <th>Weekly</th>
                    <th>Monthly</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleCards.map((card) => {
                    const current = currentVersion(card);
                    return (
                      <tr key={card.id}>
                        <td>
                          <strong>{card.name}</strong>{" "}
                          {card.isDefault && (
                            <span className="autopay-status">Default</span>
                          )}
                          <small className="record-secondary">
                            {card.code}
                            {current
                              ? ` · Version ${current.version}`
                              : " · No versions"}
                          </small>
                        </td>
                        {["DAILY", "WEEKLY", "MONTHLY"].map((period) => {
                          const rate = current?.rentalRates.find(
                            (rate) =>
                              rate.rentalPeriodType === period &&
                              rate.isActive !== false,
                          );
                          return (
                            <td key={period}>
                              {rate ? money(rate.amount, card.currency) : "—"}
                            </td>
                          );
                        })}
                        <td>
                          <span
                            className={`status status-${card.status.toLowerCase()}`}
                          >
                            {card.status}
                          </span>
                        </td>
                        <td>
                          <button
                            type="button"
                            className="secondary"
                            onClick={() => openCard(card)}
                          >
                            View details
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
      {view === "detail" && selected && (
        <div className="sa-card autopay-card rate-card-detail">
          <div className="autopay-heading">
            <div className="rate-card-badges">
              <strong>{selected.code}</strong>
              <span
                className={`status status-${selected.status.toLowerCase()}`}
              >
                {selected.status}
              </span>
              {selected.isDefault && (
                <span className="autopay-status">Default</span>
              )}
            </div>
            {canManage && selected.status === "ACTIVE" && (
              <details className="rate-card-actions">
                <summary>Actions</summary>
                <button
                  type="button"
                  className="danger"
                  disabled={busy}
                  onClick={() => void deactivate(selected.id)}
                >
                  Deactivate rate card
                </button>
              </details>
            )}
          </div>
          <div
            className="autopay-tabs"
            role="tablist"
            aria-label="Rate card details"
          >
            {["Pricing", "Fee rules", "Version history"].map(
              (name, index, tabs) => (
                <button
                  type="button"
                  role="tab"
                  id={`rate-tab-${index}`}
                  aria-controls="rate-detail-panel"
                  aria-selected={tab === name}
                  tabIndex={tab === name ? 0 : -1}
                  key={name}
                  onClick={() => setTab(name)}
                  onKeyDown={(event) => {
                    let next = index;
                    if (event.key === "ArrowRight")
                      next = (index + 1) % tabs.length;
                    else if (event.key === "ArrowLeft")
                      next = (index + tabs.length - 1) % tabs.length;
                    else if (event.key === "Home") next = 0;
                    else if (event.key === "End") next = tabs.length - 1;
                    else return;
                    event.preventDefault();
                    setTab(tabs[next]);
                    document.getElementById(`rate-tab-${next}`)?.focus();
                  }}
                >
                  {name}
                </button>
              ),
            )}
          </div>
          <div
            id="rate-detail-panel"
            role="tabpanel"
            aria-labelledby={`rate-tab-${["Pricing", "Fee rules", "Version history"].indexOf(tab)}`}
          >
            {tab !== "Version history" && version && (
              <div className="rate-card-version">
                <label>
                  Version
                  <select
                    value={version.id}
                    onChange={(e) => setVersionId(e.target.value)}
                  >
                    {sortedVersions(selected).map((v) => (
                      <option key={v.id} value={v.id}>
                        Version {v.version} · {v.status}
                      </option>
                    ))}
                  </select>
                </label>
                {canManage &&
                  version.status === "DRAFT" &&
                  version.rentalRates.length > 0 && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void activate(version.id)}
                    >
                      Activate version
                    </button>
                  )}
              </div>
            )}
            {tab === "Pricing" &&
              (version ? (
                <>
                  <div className="rate-card-prices">
                    {version.rentalRates
                      .filter((rate) => rate.isActive !== false)
                      .map((rate) => (
                        <div key={rate.id}>
                          <span>
                            {rate.rentalPeriodType.charAt(0) +
                              rate.rentalPeriodType.slice(1).toLowerCase()}
                          </span>
                          <strong>
                            {money(rate.amount, selected.currency)}
                          </strong>
                          <small>
                            {rate.includedKm != null
                              ? `${rate.includedKm} km included`
                              : "Included km not specified"}
                          </small>
                          {rate.extraKmRate != null && (
                            <small>
                              {money(rate.extraKmRate, selected.currency)} /
                              extra km
                            </small>
                          )}
                        </div>
                      ))}
                  </div>
                  {!version.rentalRates.length && (
                    <p>No rental rates configured for this version.</p>
                  )}
                  <div className="autopay-message">
                    First rental upfront:{" "}
                    <strong>
                      {selected.collectFirstRentalUpfront ? "Yes" : "No"}
                    </strong>{" "}
                    · Offer validity: {selected.offerValidityMinutes ?? "—"}{" "}
                    minutes
                  </div>
                  <RuleEditor
                    key={version.id}
                    version={version}
                    canManage={false}
                    busy={busy}
                    onSaved={() => void load()}
                  />
                </>
              ) : (
                <p>No versions configured.</p>
              ))}
            {tab === "Fee rules" &&
              (version ? (
                <>
                  <div className="autopay-history-table">
                    <table>
                      <thead>
                        <tr>
                          <th>Charge</th>
                          <th>Amount</th>
                          <th>Applies to</th>
                          <th>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {[
                          ...(version.deposits ?? []),
                          ...(version.fees ?? []),
                        ].map((rule) => (
                          <tr key={rule.id}>
                            <td>{rule.name}</td>
                            <td>{money(rule.amount, selected.currency)}</td>
                            <td>
                              {[
                                rule.city,
                                rule.hubId &&
                                  (ruleOptions.hubs.find(
                                    (hub) => hub.id === rule.hubId,
                                  )?.name ??
                                    "Specific hub"),
                                rule.oemId &&
                                  (ruleOptions.oems.find(
                                    (oem) => oem.id === rule.oemId,
                                  )?.displayName ??
                                    "Specific OEM"),
                                rule.clientWorkPartnerId &&
                                  (ruleOptions.workPartners.find(
                                    (partner) =>
                                      partner.id === rule.clientWorkPartnerId,
                                  )?.name ??
                                    "Specific work partner"),
                                rule.minVehicleAgeMonths != null &&
                                  `Vehicle age ≥ ${rule.minVehicleAgeMonths} months`,
                                rule.maxVehicleAgeMonths != null &&
                                  `Vehicle age ≤ ${rule.maxVehicleAgeMonths} months`,
                              ]
                                .filter(Boolean)
                                .join(" · ") || "All riders · No restrictions"}
                            </td>
                            <td>
                              {rule.isActive === false ? "Inactive" : "Active"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {!(version.deposits?.length || version.fees?.length) && (
                    <p>No fee or deposit rules configured.</p>
                  )}
                  <RuleEditor
                    key={version.id}
                    version={version}
                    canManage={canManage}
                    busy={busy}
                    onSaved={() => void load()}
                  />
                </>
              ) : (
                <p>No versions configured.</p>
              ))}
            {tab === "Version history" && (
              <div className="autopay-history-table">
                <table>
                  <thead>
                    <tr>
                      <th>Version</th>
                      <th>Effective from</th>
                      <th>Status</th>
                      <th>Rental rates</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedVersions(selected).map((v) => (
                      <tr key={v.id}>
                        <td>Version {v.version}</td>
                        <td>
                          {new Date(v.effectiveFrom).toLocaleDateString(
                            "en-IN",
                          )}
                        </td>
                        <td>
                          <span
                            className={`status status-${v.status.toLowerCase()}`}
                          >
                            {v.status}
                          </span>
                        </td>
                        <td>
                          {v.rentalRates
                            .filter((rate) => rate.isActive !== false)
                            .map(
                              (rate) =>
                                `${rate.rentalPeriodType}: ${money(rate.amount, selected.currency)}`,
                            )
                            .join(" · ") || "No rates"}
                        </td>
                        <td>
                          <button
                            type="button"
                            className="secondary"
                            onClick={() => {
                              setVersionId(v.id);
                              setTab("Pricing");
                            }}
                          >
                            View version
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
