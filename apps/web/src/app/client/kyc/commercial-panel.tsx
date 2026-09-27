"use client";

import { useCallback, useEffect, useState } from "react";
import { sessionFetch } from "../../../lib/session-fetch";

type Policy = { id: string; verificationType: string; isEnabled: boolean; workflowDefinitionId: string | null;
  routingPolicyId: string | null; validityDays: number | null; reverificationRequired: boolean;
  overagePolicy: "BLOCK" | "ALLOW_AND_CHARGE" | "ALLOW_WITH_WARNING" };
type Entitlement = { verificationType: string; enabled: boolean; featureCode: string | null; packageId: string | null;
  unlimited: boolean; policyId: string | null };
type Consumption = { id: string; verificationId: string; source: string; quantity: string; occurredAt: string;
  effectivePrice: string | null; currency: string | null; reversedAt: string | null;
  feature: { code: string; name: string } };
type Balance = { featureId: string; quantityAvailable: string; feature: { code: string; name: string } };
type AddOns = { available: { id: string; code: string; name: string; quantity: string; salePrice: string;
  currency: string; validityDays: number | null; feature: { code: string } }[];
  purchased: { id: string; status: string; quantityPurchased: string; quantityRemaining: string;
    purchasedAt: string; expiresAt: string | null; featureAddOn: { code: string; name: string } }[] };
type RoutingPolicy = { id: string; code: string; version: number; verificationType: string; status: string };
type WorkflowDefinition = { id: string; code: string; version: number; status: string;
  steps: { verificationType: string }[] };

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await sessionFetch(`/api/v1/kyc/admin/${path}`, { cache: "no-store", ...init });
  const body = await response.json() as { data?: T; message?: string; error?: { message?: string } };
  if (!response.ok || body.data === undefined) throw new Error(body.error?.message ?? body.message ?? "Unable to load KYC commercial data.");
  return body.data;
}

export default function CommercialPanel({ canManage }: { canManage: boolean }) {
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [entitlements, setEntitlements] = useState<Entitlement[]>([]);
  const [balances, setBalances] = useState<Balance[]>([]);
  const [ledger, setLedger] = useState<Consumption[]>([]);
  const [addOns, setAddOns] = useState<AddOns>({ available: [], purchased: [] });
  const [routes, setRoutes] = useState<RoutingPolicy[]>([]);
  const [workflows, setWorkflows] = useState<WorkflowDefinition[]>([]);
  const [offset, setOffset] = useState(0);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(true);
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    setBusy(true); setError("");
    try {
      const [newPolicies, newEntitlements, usage, newLedger, newAddOns, newRoutes, newWorkflows] = await Promise.all([
        api<Policy[]>("client-policies"), api<Entitlement[]>("entitlements"),
        api<{ balances: Balance[] }>("usage"), api<Consumption[]>(`usage/ledger?skip=${offset}`), api<AddOns>("add-ons"),
        api<RoutingPolicy[]>("routing-policies"), api<WorkflowDefinition[]>("workflow-definitions"),
      ]);
      setPolicies(newPolicies); setEntitlements(newEntitlements); setBalances(usage.balances); setLedger(newLedger);
      setAddOns(newAddOns); setRoutes(newRoutes); setWorkflows(newWorkflows);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to load KYC commercial data."); }
    finally { setBusy(false); }
  }, [offset]);
  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);

  async function updatePolicy(type: string, changes: Record<string, string | number | boolean | null>) {
    setMessage(""); setError("");
    try {
      await api(`client-policies/${type}`, { method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(changes) });
      setMessage(`${type.replaceAll("_", " ")} policy updated.`);
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to update the policy."); }
  }

  return <section aria-label="KYC commercial controls">
    <h2>Client KYC policy and usage</h2>
    <p>Entitlements come from the active EVsEye package and client feature configuration. A policy can disable an entitlement; enabling a policy does not grant a missing package feature. Usage counts business verifications once, even when routing starts several provider attempts.</p>
    {busy && <p role="status">Loading policy and usage…</p>}
    {error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}
    {!busy && <><h3>Effective entitlements</h3>
      <table><thead><tr><th>Verification</th><th>Entitled</th><th>Feature</th><th>Package</th><th>Unlimited</th><th>Client policy</th></tr></thead>
        <tbody>{entitlements.map((item) => <tr key={item.verificationType}><td>{item.verificationType.replaceAll("_", " ")}</td>
          <td>{item.enabled ? "Yes" : "No"}</td><td>{item.featureCode ?? "Operational lookup"}</td>
          <td>{item.packageId ?? "—"}</td><td>{item.unlimited ? "Yes" : "No"}</td>
          <td>{canManage ? <button type="button" onClick={() => void updatePolicy(item.verificationType, { isEnabled: !item.enabled })}>
            {item.enabled ? "Disable policy" : "Enable policy"}</button> : "Read only"}</td></tr>)}</tbody></table>
      <h3>Client policy assignments</h3>
      {policies.length ? <table><thead><tr><th>Verification</th><th>Enabled</th><th>Workflow</th><th>Routing</th><th>Validity</th><th>Overage</th></tr></thead>
        <tbody>{policies.map((policy) => <tr key={policy.id}><td>{policy.verificationType}</td><td>{policy.isEnabled ? "Yes" : "No"}</td>
          <td>{canManage ? <select aria-label={`${policy.verificationType} workflow`} value={policy.workflowDefinitionId ?? ""}
            onChange={(event) => void updatePolicy(policy.verificationType, { workflowDefinitionId: event.target.value || null })}>
            <option value="">Default</option>{workflows.filter((item) => item.status === "ACTIVE" && item.steps.some((step) => step.verificationType === policy.verificationType))
              .map((item) => <option key={item.id} value={item.id}>{item.code} v{item.version}</option>)}</select>
            : policy.workflowDefinitionId ?? "Default"}</td>
          <td>{canManage ? <select aria-label={`${policy.verificationType} routing`} value={policy.routingPolicyId ?? ""}
            onChange={(event) => void updatePolicy(policy.verificationType, { routingPolicyId: event.target.value || null })}>
            <option value="">Default</option>{routes.filter((item) => item.status === "ACTIVE" && item.verificationType === policy.verificationType)
              .map((item) => <option key={item.id} value={item.id}>{item.code} v{item.version}</option>)}</select>
            : policy.routingPolicyId ?? "Default"}</td>
          <td>{policy.validityDays == null ? "Default" : `${policy.validityDays} days`}</td>
          <td>{canManage ? <select aria-label={`${policy.verificationType} overage`} value={policy.overagePolicy}
            onChange={(event) => void updatePolicy(policy.verificationType, { overagePolicy: event.target.value })}>
            <option value="BLOCK">Block</option><option value="ALLOW_WITH_WARNING">Allow with warning</option>
            <option value="ALLOW_AND_CHARGE">Allow and charge</option></select> : policy.overagePolicy}</td></tr>)}</tbody></table>
        : <p>No client-specific KYC policies. Package entitlement and global defaults apply.</p>}
      <h3>Available feature credits</h3>
      {balances.length ? <ul>{balances.map((item) => <li key={item.featureId}>{item.feature.name}: {item.quantityAvailable}</li>)}</ul>
        : <p>No available credit lots.</p>}
      <h3>Available add-ons</h3>
      {addOns.available.length ? <ul>{addOns.available.map((item) => <li key={item.id}>
        {item.name} · {item.quantity} {item.feature.code.replaceAll("_", " ")} · Catalog {item.currency} {item.salePrice}
        {item.validityDays ? ` · ${item.validityDays} days` : ""}</li>)}</ul> : <p>No KYC add-ons available for this package.</p>}
      <h3>Purchased add-ons</h3>
      {addOns.purchased.length ? <ul>{addOns.purchased.map((item) => <li key={item.id}>
        {item.featureAddOn.name} · {item.status} · {item.quantityRemaining} of {item.quantityPurchased} remaining
        {item.expiresAt ? ` · Expires ${new Date(item.expiresAt).toLocaleDateString()}` : ""}</li>)}</ul>
        : <p>No add-on purchases.</p>}
      <h3>Business verification usage</h3>
      {ledger.length ? <table><thead><tr><th>When</th><th>Feature</th><th>Source</th><th>Quantity</th><th>Client price</th><th>Verification</th></tr></thead>
        <tbody>{ledger.map((item) => <tr key={item.id}><td>{new Date(item.occurredAt).toLocaleString()}</td>
          <td>{item.feature.name}</td><td>{item.reversedAt ? "REVERSED" : item.source}</td><td>{item.quantity}</td>
          <td>{item.effectivePrice == null ? "Included" : `${item.currency ?? ""} ${item.effectivePrice}`}</td>
          <td>{item.verificationId.slice(0, 8)}</td></tr>)}</tbody></table> : <p>No KYC usage recorded.</p>}
      <div style={{ display: "flex", gap: "1rem", marginTop: "1rem" }}>
        <button type="button" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 50))}>Previous</button>
        <span>Page {Math.floor(offset / 50) + 1}</span>
        <button type="button" disabled={ledger.length < 50} onClick={() => setOffset(offset + 50)}>Next</button>
      </div></>}
  </section>;
}
