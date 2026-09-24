"use client";

import { sessionFetch as fetch } from "../../lib/session-fetch";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { ClientFormDialog } from "./client-form-dialog";

type Item = Record<string, unknown>;
export type ClientCommercialSection = "pricing" | "addOns" | "creditLots" | "ledger";

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
  const [adjustments, setAdjustments] = useState<Item[]>([]);
  const [clientFeatures, setClientFeatures] = useState<Item[]>([]);
  const [creditLots, setCreditLots] = useState<Item[]>([]);
  const [ledger, setLedger] = useState<Item[]>([]);
  const [eligibleFeatures, setEligibleFeatures] = useState<Item[]>([]);
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

  const load = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      const [loadedSubscriptions, loadedAdjustments, loadedClientFeatures, loadedLots, loadedLedger, catalogFeatures] =
        await Promise.all([
          request(`/subscriptions?clientId=${encodeURIComponent(clientId)}`),
          request(`/adjustments?clientId=${encodeURIComponent(clientId)}`),
          platformRequest(`/clients/${encodeURIComponent(clientId)}/features`),
          request(`/clients/${encodeURIComponent(clientId)}/credit-lots`),
          request(`/clients/${encodeURIComponent(clientId)}/feature-usage`),
          platformRequest("/features"),
        ]);
      const nextSubscriptions = loadedSubscriptions as Item[];
      setSubscriptions(nextSubscriptions);
      setAdjustments(loadedAdjustments as Item[]);
      setClientFeatures(loadedClientFeatures as Item[]);
      setCreditLots(loadedLots as Item[]);
      setLedger(loadedLedger as Item[]);
      const eligible = (catalogFeatures as Item[]).filter(
        (feature) => feature.isActive && feature.isAddOnEligible,
      );
      setEligibleFeatures(eligible);
      const active = nextSubscriptions.find((item) => item.status === "ACTIVE");
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

  const balances = useMemo(() => {
    const now = Date.now();
    const grouped = new Map<string, { feature: Item; available: number }>();
    creditLots.forEach((lot) => {
      const expiresAt = lot.expiresAt ? new Date(String(lot.expiresAt)).getTime() : null;
      if (expiresAt !== null && expiresAt <= now) return;
      const feature = (lot.feature as Item) ?? {};
      const code = String(feature.code ?? "UNKNOWN");
      const current = grouped.get(code) ?? { feature, available: 0 };
      current.available += Number(lot.quantityAvailable ?? 0);
      grouped.set(code, current);
    });
    return [...grouped.entries()];
  }, [creditLots]);
  const buttonLabel = section === "pricing"
    ? "Pricing adjustments"
    : section === "addOns"
      ? "Features & Pricing"
      : section === "creditLots"
        ? "Feature credit lots"
        : section === "ledger"
          ? "Feature usage ledger"
          : "Commercials";

  return (
    <>
      <button type="button" className="secondary" onClick={() => setOpen(true)}>
        {buttonLabel}
      </button>
      {open && (
        <ClientFormDialog
          title={`Commercials — ${clientName}`}
          wide
          busy={busy}
          error={error}
          onClose={() => setOpen(false)}
        >
          <header className="sa-commercial-head">
            <div>
              <h2>Commercials — {clientName}</h2>
              <p>Manage client-specific feature entitlements, negotiated pricing, credit balances, and usage history.</p>
            </div>
            <button type="button" className="secondary" onClick={() => void load()} disabled={busy}>Refresh</button>
          </header>
          {notice && <p className="notice" role="status">{notice}</p>}

          {(!section || section === "pricing") && <section className="sa-commercial-section">
            <div className="sa-commercial-section-head"><div><h3>Client pricing adjustments</h3><p>Changes apply only to this client and never alter master pricing.</p></div></div>
            <form className="sa-commercial-grid" onSubmit={saveAdjustment}>
              <label><span>Subscription</span><select value={adjustment.subscriptionId} onChange={(event) => setAdjustment((current) => ({ ...current, subscriptionId: event.target.value }))}><option value="">All client subscriptions</option>{subscriptions.map((item) => <option key={String(item.id)} value={String(item.id)}>{String((item.package as Item)?.name ?? item.packageId)} · {label(item.status)}</option>)}</select></label>
              <label><span>Adjustment scope <b className="sa-required-star">*</b></span><select value={adjustment.adjustmentScope} onChange={(event) => setAdjustment((current) => ({ ...current, adjustmentScope: event.target.value }))}>{adjustmentScopes.map((item) => <option key={item}>{label(item)}</option>)}</select></label>
              <label><span>Adjustment type <b className="sa-required-star">*</b></span><select value={adjustment.adjustmentType} onChange={(event) => setAdjustment((current) => ({ ...current, adjustmentType: event.target.value }))}>{adjustmentTypes.map((item) => <option key={item}>{label(item)}</option>)}</select></label>
              <label><span>Value <b className="sa-required-star">*</b></span><input required min="0" step="0.0001" type="number" value={adjustment.adjustmentValue} onChange={(event) => setAdjustment((current) => ({ ...current, adjustmentValue: event.target.value }))} /></label>
              <label><span>Reference ID</span><input value={adjustment.referenceId} placeholder="Feature, Add-On, or package ID" onChange={(event) => setAdjustment((current) => ({ ...current, referenceId: event.target.value }))} /><small>Leave blank to apply to every eligible item in the selected scope.</small></label>
              <label><span>Valid from <b className="sa-required-star">*</b></span><input required type="date" value={adjustment.validFrom} onChange={(event) => setAdjustment((current) => ({ ...current, validFrom: event.target.value }))} /></label>
              <label><span>Valid to</span><input type="date" value={adjustment.validTo} onChange={(event) => setAdjustment((current) => ({ ...current, validTo: event.target.value }))} /></label>
              <label><span>Reason <b className="sa-required-star">*</b></span><input required value={adjustment.reason} maxLength={500} onChange={(event) => setAdjustment((current) => ({ ...current, reason: event.target.value }))} /></label>
              <div className="sa-commercial-form-action"><button disabled={busy} type="submit">Save adjustment</button></div>
            </form>
            <CommercialTable headings={["Scope", "Type", "Value", "Reference", "Period", "Reason"]}>
              {adjustments.map((item) => <tr key={String(item.id)}><td>{label(item.adjustmentScope)}</td><td>{label(item.adjustmentType)}</td><td>{number(item.adjustmentValue)}</td><td>{String(item.referenceId ?? "All eligible")}</td><td>{date(item.validFrom)} — {date(item.validTo)}</td><td>{String(item.reason)}</td></tr>)}
            </CommercialTable>
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

          {(!section || section === "creditLots") && <section className="sa-commercial-section">
            <div className="sa-commercial-section-head"><div><h3>Feature credit lots</h3><p>Credits are consumed by earliest expiry first. Expired lots are excluded from available balances.</p></div></div>
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
