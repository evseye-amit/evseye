"use client";

import { sessionFetch as fetch } from "../../lib/session-fetch";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { ClientFormDialog } from "./client-form-dialog";

type Item = Record<string, unknown>;
export type ClientCommercialSection = "pricing" | "addOns" | "quotaPacks" | "creditLots" | "ledger";

const adjustmentScopes = [
  "SETUP_FEE",
  "PACKAGE",
  "FEATURE",
  "FEATURE_ADDON",
  "TOTAL_INVOICE",
];
const adjustmentTypes = ["PERCENTAGE", "FIXED_AMOUNT", "OVERRIDE_PRICE"];

function label(value: unknown) {
  return String(value ?? "—").replaceAll("_", " ");
}

function date(value: unknown, withTime = false) {
  if (!value) return "—";
  const parsed = new Date(String(value));
  if (Number.isNaN(parsed.getTime())) return "—";
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}),
  }).format(parsed);
}

function number(value: unknown) {
  const parsed = Number(value ?? 0);
  return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 4 }).format(
    Number.isFinite(parsed) ? parsed : 0,
  );
}

export function ClientCommercialSettings({
  clientId,
  clientName,
  section,
}: {
  clientId: string;
  clientName: string;
  section?: ClientCommercialSection;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [subscriptions, setSubscriptions] = useState<Item[]>([]);
  const [packageRevisions, setPackageRevisions] = useState<Item[]>([]);
  const [selectedPackageRevision, setSelectedPackageRevision] = useState("");
  const [upgradePreview, setUpgradePreview] = useState<{
    previewToken: string; fromVersion: number; toVersion: number; preservedOverrides: number;
    addedFeatures: { featureId: string; name: string; code: string }[];
    changedFeatures: { featureId: string; name: string; code: string; previous: unknown; next: unknown }[];
  } | null>(null);
  const [upgradeReason, setUpgradeReason] = useState("");
  const [adjustments, setAdjustments] = useState<Item[]>([]);
  const [clientFeatures, setClientFeatures] = useState<Item[]>([]);
  const [effectiveEntitlements, setEffectiveEntitlements] = useState<Item[]>([]);
  const [creditLots, setCreditLots] = useState<Item[]>([]);
  const [ledger, setLedger] = useState<Item[]>([]);
  const [eligibleFeatures, setEligibleFeatures] = useState<Item[]>([]);
  const [quotaOffers, setQuotaOffers] = useState<Item[]>([]);
  const [quotaPurchases, setQuotaPurchases] = useState<Item[]>([]);
  const [vehicleTiers, setVehicleTiers] = useState<Item[]>([]);
  const [setupDiscount, setSetupDiscount] = useState("0");
  const [vehicleDiscount, setVehicleDiscount] = useState("0");
  const [setupDiscountType, setSetupDiscountType] = useState<"PERCENTAGE" | "FIXED_AMOUNT">("PERCENTAGE");
  const [vehicleDiscountType, setVehicleDiscountType] = useState<"PERCENTAGE" | "FIXED_AMOUNT">("PERCENTAGE");
  const [pricingDraft, setPricingDraft] = useState<Item | null>(null);
  const [selectedQuotaOffer, setSelectedQuotaOffer] = useState("");
  const [activationReference, setActivationReference] = useState("");
  const [adjustment, setAdjustment] = useState({
    subscriptionId: "",
    adjustmentScope: "PACKAGE",
    adjustmentType: "PERCENTAGE",
    adjustmentValue: "",
    referenceId: "",
    validFrom: new Date().toISOString().slice(0, 10),
    validTo: "",
    reason: "",
  });
  const [clientAddOn, setClientAddOn] = useState({
    featureId: "",
    includedQuantity: "0",
    unlimitedUsage: false,
    effectiveFrom: new Date().toISOString().slice(0, 10),
    effectiveTo: "",
  });

  async function request(path: string, method = "GET", body?: object) {
    const response = await fetch(`/api/v1/platform/commercial${path}`, {
      method,
      headers: body ? { "Content-Type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.error?.message || payload.message || "Commercial action failed.");
    }
    return payload.data;
  }

  async function platformRequest(path: string, method = "GET", body?: object) {
    const response = await fetch(`/api/v1/platform${path}`, {
      method,
      headers: body ? { "Content-Type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.error?.message || payload.message || "Client commercial action failed.");
    }
    return payload.data;
  }

  const activeSubscription = useMemo(
    () => subscriptions.find((item) => item.status === "ACTIVE") ?? null,
    [subscriptions],
  );
  const pendingSubscription = useMemo(
    () => subscriptions.find((item) => item.status === "PENDING") ?? null,
    [subscriptions],
  );

  const load = useCallback(async () => {
    setUpgradePreview(null);
    setBusy(true);
    setError("");
    try {
      const [loadedSubscriptions, loadedAdjustments, loadedClientFeatures, loadedLots, loadedLedger, catalogFeatures, loadedEffective] =
        await Promise.all([
          request(`/subscriptions?clientId=${encodeURIComponent(clientId)}`),
          request(`/adjustments?clientId=${encodeURIComponent(clientId)}`),
          platformRequest(`/clients/${encodeURIComponent(clientId)}/features`),
          request(`/clients/${encodeURIComponent(clientId)}/credit-lots`),
          request(`/clients/${encodeURIComponent(clientId)}/feature-usage`),
          platformRequest("/features"),
          platformRequest(`/clients/${encodeURIComponent(clientId)}/effective-entitlements`),
        ]);
      const nextSubscriptions = loadedSubscriptions as Item[];
      setSubscriptions(nextSubscriptions);
      setAdjustments(loadedAdjustments as Item[]);
      const savedAdjustments = loadedAdjustments as Item[];
      const setupAdjustment = savedAdjustments.find((item) => item.adjustmentScope === "SETUP_FEE" && item.isActive);
      const vehicleAdjustment = savedAdjustments.find((item) => item.adjustmentScope === "PACKAGE" && item.isActive);
      setSetupDiscount(String(setupAdjustment?.adjustmentValue ?? "0"));
      setVehicleDiscount(String(vehicleAdjustment?.adjustmentValue ?? "0"));
      const clientConfiguration = await platformRequest(`/clients/${encodeURIComponent(clientId)}/configuration`);
      const revisions = (clientConfiguration?.commercials?.pricingRevisions ?? []) as Item[];
      setPricingDraft(revisions.find((item) => !item.publishedAt) ?? null);
      setClientFeatures(loadedClientFeatures as Item[]);
      setEffectiveEntitlements(((loadedEffective as Item)?.entitlements ?? []) as Item[]);
      setCreditLots(loadedLots as Item[]);
      setLedger(loadedLedger as Item[]);
      const eligible = (catalogFeatures as Item[]).filter(
        (feature) => feature.isActive && feature.isAddOnEligible,
      );
      setEligibleFeatures(eligible);
      const active = nextSubscriptions.find((item) => item.status === "ACTIVE");
      const tiers = active ? await request(`/packages/${encodeURIComponent(String(active.packageId))}/vehicle-tiers`) : [];
      setVehicleTiers((tiers as Item[]) ?? []);
      const availableRevisions = active
        ? await platformRequest(`/packages/${encodeURIComponent(String(active.packageId))}/revisions`)
        : [];
      setPackageRevisions((availableRevisions as Item[]).filter((item) => item.publishedAt));
      setSelectedPackageRevision(String((active?.packageRevision as Item)?.id ?? ""));
      const [offers, purchases] = await Promise.all([
        active ? request('/feature-addons') : Promise.resolve([]),
        request(`/clients/${encodeURIComponent(clientId)}/addon-purchases`),
      ]);
      const now = Date.now();
      setQuotaOffers((offers as Item[]).filter((item) => item.isActive && (item.feature as Item)?.isActive
        && new Date(String(item.effectiveFrom)).getTime() <= now
        && (!item.effectiveTo || new Date(String(item.effectiveTo)).getTime() > now)));
      setQuotaPurchases(purchases as Item[]);
      setAdjustment((current) => ({
        ...current,
        subscriptionId: active ? String(active.id) : "",
      }));
      setClientAddOn((current) => ({
        ...current,
        featureId: eligible.some((feature) => feature.id === current.featureId)
          ? current.featureId
          : String(eligible[0]?.id ?? ""),
      }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to load client commercial data.");
    } finally {
      setBusy(false);
    }
  }, [clientId]);

  async function upgradePackageVersion(apply = false) {
    if (!activeSubscription || !selectedPackageRevision) return;
    setBusy(true);
    setError("");
    try {
      const path = `/subscriptions/${activeSubscription.id}/package-upgrades/${selectedPackageRevision}`;
      if (!apply) {
        setUpgradePreview(await platformRequest(`${path}/preview`));
      } else if (upgradePreview) {
        await platformRequest(path, "POST", { previewToken: upgradePreview.previewToken, reason: upgradeReason });
        setUpgradePreview(null);
        setUpgradeReason("");
        setNotice("Package upgraded. Pricing, usage history and client settings preserved.");
        await load();
      }
    } catch (cause) {
      setUpgradePreview(null);
      setError(cause instanceof Error ? cause.message : "Could not upgrade the Package version.");
    } finally {
      setBusy(false);
    }
  }

  async function savePricing() {
    if (!activeSubscription) return;
    setBusy(true); setError("");
    try {
      const draft = await platformRequest(`/clients/${encodeURIComponent(clientId)}/pricing-revisions/draft`, "POST", {
        setupDiscountPercent: Number(setupDiscount),
        vehicleDiscountPercent: Number(vehicleDiscount),
        setupDiscountType,
        setupDiscountValue: Number(setupDiscount),
        vehicleDiscountType,
        vehicleDiscountValue: Number(vehicleDiscount),
      });
      setPricingDraft(draft as Item);
      setNotice("Pricing saved.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to save pricing."); }
    finally { setBusy(false); }
  }

  async function publishPricingDraft() {
    setBusy(true); setError("");
    try { const published = await platformRequest(`/clients/${encodeURIComponent(clientId)}/pricing-revisions/publish`, "POST"); setPricingDraft(null); setNotice(`Pricing v${published.version} published.`); await load(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to publish pricing."); }
    finally { setBusy(false); }
  }

  async function discardPricingDraft() {
    setBusy(true); setError("");
    try { await platformRequest(`/clients/${encodeURIComponent(clientId)}/pricing-revisions/draft`, "DELETE"); setPricingDraft(null); setNotice("Pricing draft discarded."); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to discard pricing draft."); }
    finally { setBusy(false); }
  }

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  async function saveAdjustment(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await request("/adjustments", "POST", {
        clientId,
        subscriptionId: adjustment.subscriptionId || undefined,
        adjustmentScope: adjustment.adjustmentScope,
        adjustmentType: adjustment.adjustmentType,
        adjustmentValue: Number(adjustment.adjustmentValue),
        referenceId: adjustment.referenceId.trim() || undefined,
        validFrom: adjustment.validFrom,
        validTo: adjustment.validTo || undefined,
        reason: adjustment.reason.trim(),
      });
      setNotice("Pricing adjustment saved.");
      setAdjustment((current) => ({ ...current, adjustmentValue: "", referenceId: "", validTo: "", reason: "" }));
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to save the pricing adjustment.");
      setBusy(false);
    }
  }

  async function saveClientAddOn() {
    if (!activeSubscription || !clientAddOn.featureId) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await platformRequest(`/clients/${encodeURIComponent(clientId)}/features`, "POST", {
        subscriptionId: activeSubscription.id,
        featureId: clientAddOn.featureId,
        source: "ADD_ON",
        includedQuantity: Number(clientAddOn.includedQuantity || 0),
        unlimitedUsage: clientAddOn.unlimitedUsage,
        effectiveFrom: clientAddOn.effectiveFrom,
        effectiveTo: clientAddOn.effectiveTo || undefined,
      });
      setNotice("Client add-on assigned. Its pricing can now be managed independently.");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to assign the client add-on.");
      setBusy(false);
    }
  }

  async function activateQuotaPack(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!activeSubscription || !selectedQuotaOffer || !activationReference.trim()) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await request(`/clients/${encodeURIComponent(clientId)}/addon-purchases`, "POST", {
        subscriptionId: activeSubscription.id,
        featureAddOnId: selectedQuotaOffer,
        activationReference: activationReference.trim(),
      });
      setActivationReference("");
      setNotice("Quota pack activated.");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to activate quota pack.");
      setBusy(false);
    }
  }

  async function setClientFeatureEnabled(featureId: string, enabled: boolean) {
    setBusy(true);
    setError("");
    try {
      await platformRequest(`/clients/${encodeURIComponent(clientId)}/features/${encodeURIComponent(featureId)}`, "PATCH", { enabled });
      setNotice(enabled ? "Client Feature enabled." : "Client Feature disabled.");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to update the Client Feature.");
      setBusy(false);
    }
  }

  async function removeClientFeature(featureId: string) {
    setBusy(true);
    setError("");
    try {
      await platformRequest(`/clients/${encodeURIComponent(clientId)}/features/${encodeURIComponent(featureId)}`, "DELETE");
      setNotice("Client Feature removed.");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to remove the Client Feature.");
      setBusy(false);
    }
  }

  const [referenceTime] = useState(() => Date.now());
  const balances = useMemo(() => {
    const grouped = new Map<string, { feature: Item; available: number }>();
    creditLots.forEach((lot) => {
      const expiresAt = lot.expiresAt ? new Date(String(lot.expiresAt)).getTime() : null;
      if (expiresAt !== null && expiresAt <= referenceTime) return;
      const feature = (lot.feature as Item) ?? {};
      const code = String(feature.code ?? "UNKNOWN");
      const current = grouped.get(code) ?? { feature, available: 0 };
      current.available += Number(lot.quantityAvailable ?? 0);
      grouped.set(code, current);
    });
    return [...grouped.entries()];
  }, [creditLots, referenceTime]);
  const buttonLabel = section === "pricing"
    ? "Pricing"
    : section === "addOns"
      ? "Details"
      : section === "quotaPacks"
        ? "Quota add-ons"
      : section === "creditLots"
        ? "Feature credit lots"
        : section === "ledger"
          ? "Feature usage ledger"
          : "Pricing";

  return (
    <>
      <button type="button" className="secondary" onClick={() => setOpen(true)}>
        {buttonLabel}
      </button>
      {open && (
        <ClientFormDialog
          title={`Pricing — ${clientName}`}
          wide
          busy={busy}
          error={error}
          onClose={() => setOpen(false)}
          heading={<>Pricing — {clientName}</>}>
          <header className="sa-commercial-head">
            <div>

              <p>Manage client-specific feature entitlements, negotiated pricing, credit balances, and usage history.</p>
            </div>
            <button type="button" className="secondary" onClick={() => void load()} disabled={busy}>Refresh</button>
          </header>
          {notice && <p className="notice" role="status">{notice}</p>}

          <p className="muted">Effective entitlements: {effectiveEntitlements.length}</p>
          {pendingSubscription && !activeSubscription && <p className="notice">Package selected and pending client approval. Commercial actions become available after approval.</p>}

          {String(section) === "packageUpgrade" && activeSubscription && <section className="sa-commercial-section">
            <div className="sa-commercial-section-head"><div><h3>Published Package version</h3><p>Review a newer published version before upgrading. Existing pricing, allowances, usage history and client settings are preserved.</p></div></div>
            <div className="sa-commercial-grid">
              <label><span>Package version</span><select disabled={busy} value={selectedPackageRevision} onChange={(event) => { setSelectedPackageRevision(event.target.value); setUpgradePreview(null); }}>{packageRevisions.map((revision) => <option key={String(revision.id)} value={String(revision.id)} disabled={Number(revision.version) < Number((activeSubscription.packageRevision as Item)?.version ?? 0)}>v{String(revision.version)}{revision.id === (activeSubscription.packageRevision as Item)?.id ? " · current" : ""}</option>)}</select></label>
              <div className="sa-commercial-form-action"><button type="button" disabled={busy || !selectedPackageRevision || selectedPackageRevision === (activeSubscription.packageRevision as Item)?.id} onClick={() => void upgradePackageVersion()}>Review upgrade</button></div>
            </div>
            {upgradePreview && <div className="sa-commercial-section">
              <h4>Review upgrade: v{upgradePreview.fromVersion} → v{upgradePreview.toVersion}</h4>
              <p>Existing pricing and usage history stay unchanged. {upgradePreview.preservedOverrides} saved workflow settings will be carried forward.</p>
              <p>New features: {upgradePreview.addedFeatures.map((item) => item.name).join(", ") || "None"}</p>
              <p>Updated features: {upgradePreview.changedFeatures.map((item) => item.name).join(", ") || "None"}</p>
              {upgradePreview.changedFeatures.map((item) => <details key={item.featureId}><summary>{item.name}: review configuration changes</summary><pre style={{ maxHeight: 240, overflow: "auto", whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{JSON.stringify({ previous: item.previous, next: item.next }, null, 2)}</pre></details>)}
              <p>Reload the Rider onboarding configuration after upgrading. Existing Rider data is retained.</p>
              <label><span>Upgrade reason (required)</span><textarea value={upgradeReason} maxLength={1000} onChange={(event) => setUpgradeReason(event.target.value)} /></label>
              <button type="button" disabled={busy || !upgradeReason.trim()} onClick={() => void upgradePackageVersion(true)}>Confirm Package upgrade</button>
            </div>}
          </section>}

          {(!section || section === "pricing") && <section className="sa-commercial-section">
            <div className="sa-commercial-section-head"><div><h3>Setup and vehicle pricing</h3><p>Review package pricing and calculate the negotiated client charge.</p></div><div className="sa-feature-card-summary">{pricingDraft && <span className="sa-feature-draft-status">Draft v{String(pricingDraft.version)}</span>} {pricingDraft && <><button type="button" disabled={busy} onClick={() => void publishPricingDraft()}>Publish</button><button type="button" className="danger" disabled={busy} onClick={() => void discardPricingDraft()}>Discard</button></>}</div></div>
            <div className="sa-commercial-grid">
              <label><span>Setup cost</span><input readOnly value={number(activeSubscription?.setupFee)} /></label>
              <label><span>Setup discount type</span><select value={setupDiscountType} onChange={(event) => setSetupDiscountType(event.target.value as typeof setupDiscountType)}><option value="PERCENTAGE">Percentage</option><option value="FIXED_AMOUNT">Fixed value</option></select></label>
              <label><span>Setup discount {setupDiscountType === "PERCENTAGE" ? "(%)" : "(amount)"}</span><input min="0" max={setupDiscountType === "PERCENTAGE" ? "100" : undefined} step="0.01" type="number" value={setupDiscount} onChange={(event) => setSetupDiscount(event.target.value)} /></label>
              <label><span>Final setup cost</span><input readOnly value={number(Math.max(0, Number(activeSubscription?.setupFee ?? 0) - (setupDiscountType === "PERCENTAGE" ? Number(activeSubscription?.setupFee ?? 0) * Number(setupDiscount) / 100 : Number(setupDiscount)) ))} /></label>
            </div>
            <CommercialTable headings={["Vehicle tier", "Base vehicle cost", "Discount type", "Discount", "Final vehicle cost"]}>
              {vehicleTiers.map((tier) => { const base = Number(tier.pricePerVehicle ?? tier.unitPrice ?? tier.amount ?? 0); const discount = Number(vehicleDiscount); const amount = vehicleDiscountType === "PERCENTAGE" ? base * discount / 100 : discount; return <tr key={String(tier.id)}><td>{String(tier.minVehicles ?? tier.min ?? 0)} – {String(tier.maxVehicles ?? tier.max ?? "+")}</td><td>{number(base)}</td><td><select value={vehicleDiscountType} onChange={(event) => setVehicleDiscountType(event.target.value as typeof vehicleDiscountType)}><option value="PERCENTAGE">Percentage</option><option value="FIXED_AMOUNT">Fixed value</option></select></td><td><input className="sa-inline-number" min="0" max={vehicleDiscountType === "PERCENTAGE" ? "100" : undefined} step="0.01" type="number" value={vehicleDiscount} onChange={(event) => setVehicleDiscount(event.target.value)} /></td><td>{number(Math.max(0, base - amount))}</td></tr>; })}
            </CommercialTable>
            {!vehicleTiers.length && <p className="sa-commercial-empty">No vehicle tiers are configured for the selected package.</p>}
            <div className="sa-commercial-form-action"><button type="button" disabled={busy || !activeSubscription} onClick={() => void savePricing()}>{pricingDraft ? "Update pricing draft" : "Save pricing draft"}</button></div>
          </section>}

          {(!section || section === "addOns") && <section className="sa-commercial-section">
            <div className="sa-commercial-section-head"><div><h3>Client Features & Pricing</h3><p>Assign catalog Features marked as add-on eligible. This never changes the Feature or Package master.</p></div></div>
            {activeSubscription ? <div className="sa-commercial-grid">
              <label><span>Eligible Feature <b className="sa-required-star">*</b></span><select value={clientAddOn.featureId} onChange={(event) => setClientAddOn((current) => ({ ...current, featureId: event.target.value }))} disabled={!eligibleFeatures.length}>{eligibleFeatures.length ? eligibleFeatures.map((item) => <option key={String(item.id)} value={String(item.id)}>{String(item.name)} · {label(item.billingUnit)}</option>) : <option value="">No add-on eligible Features</option>}</select></label>
              <label><span>Included quantity</span><input min="0" step="0.001" type="number" value={clientAddOn.includedQuantity} disabled={clientAddOn.unlimitedUsage} onChange={(event) => setClientAddOn((current) => ({ ...current, includedQuantity: event.target.value }))} /></label>
              <label><span>Effective from <b className="sa-required-star">*</b></span><input required type="date" value={clientAddOn.effectiveFrom} onChange={(event) => setClientAddOn((current) => ({ ...current, effectiveFrom: event.target.value }))} /></label>
              <label><span>Effective to</span><input type="date" value={clientAddOn.effectiveTo} onChange={(event) => setClientAddOn((current) => ({ ...current, effectiveTo: event.target.value }))} /></label>
              <label className="sa-toggle"><input type="checkbox" checked={clientAddOn.unlimitedUsage} onChange={(event) => setClientAddOn((current) => ({ ...current, unlimitedUsage: event.target.checked }))} /> Unlimited usage</label>
              <div className="sa-commercial-form-action"><button type="button" disabled={busy || !clientAddOn.featureId} onClick={() => void saveClientAddOn()}>Add client Feature</button></div>
            </div> : <p className="muted">Create an active subscription before assigning client Features.</p>}
            <CommercialTable headings={["Feature", "Source", "Included", "Usage limit", "Effective period", "Status", "Actions"]}>
              {clientFeatures.filter((item) => item.source === "ADD_ON").map((item) => <tr key={String(item.id)}><td>{String((item.feature as Item)?.name ?? "—")}</td><td>{label(item.source)}</td><td>{item.unlimitedUsage ? "Unlimited" : number(item.includedQuantity)}</td><td>{item.usageLimit === null || item.usageLimit === undefined ? "—" : number(item.usageLimit)}</td><td>{date(item.effectiveFrom)} — {date(item.effectiveTo)}</td><td>{item.enabled ? "Enabled" : "Disabled"}</td><td><span className="sa-client-actions"><button type="button" className="secondary" disabled={busy} onClick={() => void setClientFeatureEnabled(String(item.id), !item.enabled)}>{item.enabled ? "Disable" : "Enable"}</button><button type="button" className="danger" disabled={busy} onClick={() => void removeClientFeature(String(item.id))}>Remove</button></span></td></tr>)}
            </CommercialTable>
          </section>}

          {(!section || section === "quotaPacks" || section === "addOns") && <section className="sa-commercial-section">
            <div className="sa-commercial-section-head"><div><h3>Quota add-ons</h3><p>Activate a purchased pack using the approved payment or grant reference. Package credits are used before add-on credits.</p></div></div>
            {activeSubscription ? <form className="sa-commercial-grid" onSubmit={activateQuotaPack}>
              <label><span>Available pack <b className="sa-required-star">*</b></span><select required value={selectedQuotaOffer} onChange={(event) => setSelectedQuotaOffer(event.target.value)}><option value="">Select a pack</option>{quotaOffers.map((offer) => <option key={String(offer.id)} value={String(offer.id)}>{String(offer.name)} · {number(offer.quantity)} credits · {String(offer.currency)} {number(offer.salePrice)} · {offer.validityMonths ? `${offer.validityMonths} months` : `${offer.validityDays} days`}</option>)}</select></label>
              <label><span>Payment or grant reference <b className="sa-required-star">*</b></span><input required maxLength={120} value={activationReference} onChange={(event) => setActivationReference(event.target.value)} placeholder="Approved transaction or grant ID" /><small>A reference can activate only one pack for this client.</small></label>
              <div className="sa-commercial-form-action"><button type="submit" disabled={busy || !selectedQuotaOffer}>Activate pack</button></div>
            </form> : <p className="muted">Create an active subscription before activating quota packs.</p>}
            <CommercialTable headings={["Pack", "Reference", "Purchased", "Remaining", "Price", "Expires", "Status"]}>
              {quotaPurchases.map((item) => <tr key={String(item.id)}><td>{String((item.featureAddOn as Item)?.name ?? "—")}</td><td>{String(item.activationReference ?? "—")}</td><td>{number(item.quantityPurchased)}</td><td>{number(item.quantityRemaining)}</td><td>{String(item.currency)} {number(item.totalAmount)}</td><td>{date(item.expiresAt, true)}</td><td>{label(item.status)}</td></tr>)}
            </CommercialTable>
          </section>}

          {(!section || section === "creditLots") && <section className="sa-commercial-section">
            <div className="sa-commercial-section-head"><div><h3>Feature credit lots</h3><p>Package allowance is used first, followed by purchased packs in expiry order. Expired lots are excluded from available balances.</p></div></div>
            <div className="sa-credit-balances">{balances.length ? balances.map(([code, item]) => <article key={code}><span>{String(item.feature.name ?? code)}</span><strong>{number(item.available)} {String(item.feature.billingUnit ?? "credits")}</strong></article>) : <p className="muted">No active feature credits are available.</p>}</div>
            <CommercialTable headings={["Feature", "Source", "Original", "Available", "Period", "Expires"]}>
              {creditLots.map((item) => <tr key={String(item.id)}><td>{String((item.feature as Item)?.name ?? "—")}</td><td>{label(item.sourceType)}</td><td>{number(item.quantityOriginal)}</td><td>{number(item.quantityAvailable)}</td><td>{date(item.periodStart)}</td><td>{date(item.expiresAt)}</td></tr>)}
            </CommercialTable>
          </section>}

          {(!section || section === "ledger") && <section className="sa-commercial-section">
            <div className="sa-commercial-section-head"><div><h3>Feature usage ledger</h3><p>Every credit and debit is retained for audit and reconciliation.</p></div></div>
            <CommercialTable headings={["When", "Feature", "Transaction", "Source", "Quantity", "Balance after", "Reference"]}>
              {ledger.map((item) => <tr key={String(item.id)}><td>{date(item.occurredAt, true)}</td><td>{String((item.feature as Item)?.name ?? "—")}</td><td>{label(item.transactionType)}</td><td>{label(item.sourceType)}</td><td>{number(item.quantity)}</td><td>{item.balanceAfter === null || item.balanceAfter === undefined ? "—" : number(item.balanceAfter)}</td><td>{String(item.referenceType ?? "—")}{item.referenceId ? ` · ${String(item.referenceId)}` : ""}</td></tr>)}
            </CommercialTable>
          </section>}
          <div className="form-actions"><button type="button" className="secondary" onClick={() => setOpen(false)} disabled={busy}>Close</button></div>
        </ClientFormDialog>
      )}
    </>
  );
}

function CommercialTable({ headings, children }: { headings: string[]; children: ReactNode }) {
  const hasRows = Array.isArray(children) && children.length > 0;
  return <div className="sa-commercial-table-wrap"><table className="sa-commercial-table"><thead><tr>{headings.map((heading) => <th key={heading}>{heading}</th>)}</tr></thead><tbody>{hasRows ? children : <tr><td colSpan={headings.length} className="sa-commercial-empty">No records yet.</td></tr>}</tbody></table></div>;
}
