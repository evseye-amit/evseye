"use client";

import { useEffect, useRef, useState } from "react";
import { sessionFetch } from "../../lib/session-fetch";
import { UnsavedChangesScope } from "./unsaved-changes";

type Policy = { enabled: boolean; threshold: string; rechargeAmount: string; revision: number };
type History = { id: string; createdAt: string; actorId: string | null; actorName: string | null; previousData: Policy | null; newData: Policy | null };
const currency = (value: string) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(Number(value));
const timestamp = (value: string) => new Date(value).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
function changes(row: History) {
  if (!row.newData) return "Recorded settings unavailable";
  const next = row.newData, prev = row.previousData;
  if (!prev) return `Previous values unavailable. Saved: ${next.enabled ? "Enabled" : "Disabled"}; threshold ${currency(next.threshold)}; recharge ${currency(next.rechargeAmount)}.`;
  return [
    prev.enabled !== next.enabled ? `AutoPay: ${prev.enabled ? "Enabled" : "Disabled"} → ${next.enabled ? "Enabled" : "Disabled"}` : "",
    Number(prev.threshold) !== Number(next.threshold) ? `Threshold: ${currency(prev.threshold)} → ${currency(next.threshold)}` : "",
    Number(prev.rechargeAmount) !== Number(next.rechargeAmount) ? `Recharge: ${currency(prev.rechargeAmount)} → ${currency(next.rechargeAmount)}` : "",
  ].filter(Boolean).join(" · ") || "No setting values changed";
}
async function read<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await sessionFetch(`/api/v1/client/wallet-autopay-policy${path}`, init);
  const body = await response.json();
  if (!response.ok) throw new Error(body.error?.message ?? "Unable to load AutoPay settings.");
  return body.data;
}
export function WalletAutoPaySettings() {
  const [policy, setPolicy] = useState<Policy | null>(null), [saved, setSaved] = useState<Policy | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [history, setHistory] = useState<History[]>([]), [latest, setLatest] = useState<History | null>(null);
  const [page, setPage] = useState(1), [hasMore, setHasMore] = useState(false), [reload, setReload] = useState(0);
  const [historyLoading, setHistoryLoading] = useState(true), [historyError, setHistoryError] = useState("");
  const [reset, setReset] = useState(0);
  const saving = useRef(false), active = useRef(true);
  useEffect(() => {
    active.current = true;
    const controller = new AbortController();
    void read<Policy>("", { signal: controller.signal }).then(data => {
      if (!controller.signal.aborted) { setPolicy(data); setSaved(data); }
    }).catch(cause => { if (!controller.signal.aborted) setError(cause.message); });
    return () => { active.current = false; controller.abort(); };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    void read<{ items: History[]; hasMore: boolean }>(`/history?page=${page}`, { signal: controller.signal }).then(data => {
      if (!controller.signal.aborted) {
        setHistory(data.items); setHasMore(data.hasMore); setHistoryError("");
        if (page === 1) setLatest(data.items[0] ?? null);
      }
    }).catch(cause => { if (!controller.signal.aborted) setHistoryError(cause.message); })
      .finally(() => { if (!controller.signal.aborted) setHistoryLoading(false); });
    return () => controller.abort();
  }, [page, reload]);
  const dirty = !!policy && !!saved && (policy.enabled !== saved.enabled || Number(policy.threshold) !== Number(saved.threshold) || Number(policy.rechargeAmount) !== Number(saved.rechargeAmount));
  const valid = !!policy && /^\d+(\.\d{1,2})?$/.test(policy.threshold) && /^\d+(\.\d{1,2})?$/.test(policy.rechargeAmount) &&
    Number(policy.threshold) > 0 && Number(policy.threshold) <= 5000 && Number(policy.rechargeAmount) >= 500 && Number(policy.rechargeAmount) <= 5000;
  function refreshHistory(nextPage = page) { setHistoryLoading(true); setPage(nextPage); setReload(value => value + 1); }
  async function save() {
    if (!policy || !dirty || !valid || saving.current) return;
    saving.current = true; setBusy(true); setError(""); setNotice("");
    try {
      const data = await read<Policy>("", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...policy, threshold: Number(policy.threshold).toFixed(2), rechargeAmount: Number(policy.rechargeAmount).toFixed(2) }) });
      if (!active.current) return;
      setPolicy(data); setSaved(data); setReset(value => value + 1);
      setNotice("AutoPay settings saved."); refreshHistory(1);
    } catch (cause) { if (active.current) setError(cause instanceof Error ? cause.message : "Unable to save settings."); }
    finally { saving.current = false; if (active.current) setBusy(false); }
  }
  return <div className="autopay-settings">
    <UnsavedChangesScope resetKey={reset}>
      <form className="sa-form autopay-card" onSubmit={event => { event.preventDefault(); void save(); }}>
        <div className="autopay-heading"><div><h2>Wallet AutoPay</h2><p className="muted">Manage automatic wallet recharges for riders with an active scooter.</p></div>
          {saved && <span className={`autopay-status ${saved.enabled ? "is-enabled" : ""}`}>{saved.enabled ? "Enabled" : "Disabled"}</span>}</div>
        {error && <p role="alert" className="autopay-message is-error">{error}</p>}
        {notice && <p role="status" className="autopay-message">{notice}</p>}
        {!policy && !error && <p role="status">Loading settings…</p>}
        {policy && <fieldset disabled={busy} className="autopay-fields">
          <legend className="autopay-legend">Wallet AutoPay configuration</legend>
          <label className="autopay-enable"><input type="checkbox" role="switch" checked={policy.enabled} onChange={event => { setPolicy({ ...policy, enabled: event.target.checked }); setNotice(""); }} />
            <span>Enable wallet AutoPay<small>Applies only to riders who have authorized a mandate and accepted the recharge terms.</small></span></label>
          <div className="autopay-amounts">
            <label>Low-balance threshold (₹)<input name="threshold" inputMode="decimal" value={policy.threshold} onChange={event => { setPolicy({ ...policy, threshold: event.target.value }); setNotice(""); }} aria-describedby="autopay-threshold-help" /><small id="autopay-threshold-help">Initiate a recharge below this available cash balance. Rewards and deposits are excluded.</small></label>
            <label>Recharge amount (₹)<input name="rechargeAmount" inputMode="decimal" value={policy.rechargeAmount} onChange={event => { setPolicy({ ...policy, rechargeAmount: event.target.value }); setNotice(""); }} aria-describedby="autopay-amount-help" /><small id="autopay-amount-help">₹500–₹5,000 per recharge. Use up to two decimal places.</small></label>
          </div>
          {!valid && <p role="alert" className="error">Enter a threshold from ₹0.01–₹5,000 and a recharge amount from ₹500–₹5,000, with up to two decimal places.</p>}
          <div className="autopay-message"><strong>Rider consent</strong><p>Changing either amount requires riders to accept the updated terms before new recharges can start.</p></div>
          <details><summary>How automatic recharges work</summary><p>Only one automatic recharge can be pending per wallet. Debits are scheduled at least 25 hours ahead; wallet credit appears after confirmed payment. A successful recharge is followed by a 24-hour cooldown. Disabling AutoPay stops new requests; submitted debits may still complete.</p></details>
          <div className="form-actions"><button type="submit" disabled={!dirty || !valid || busy}>{busy ? "Saving…" : "Save changes"}</button><button type="button" className="secondary" disabled={!dirty || busy} onClick={() => { setPolicy(saved); setError(""); setNotice(""); setReset(value => value + 1); }}>Discard changes</button></div>
        </fieldset>}
        {latest && <p className="muted">Last updated by {latest.actorName ?? "Unknown administrator"} · {timestamp(latest.createdAt)}</p>}
      </form>
    </UnsavedChangesScope>
    <section className="sa-form autopay-card" aria-label="Settings history">
      <div className="autopay-heading"><div><h2>Settings history</h2><p className="muted">Changes to this client’s wallet AutoPay configuration. Times are shown in your local timezone.</p></div><button type="button" className="secondary" disabled={historyLoading || busy} onClick={() => refreshHistory(1)}>Refresh history</button></div>
      {historyError && <p role="alert" className="autopay-message is-error">{historyError}</p>}
      {historyLoading ? <p role="status">Loading history…</p> : !historyError && <><div className="autopay-history-table"><table><thead><tr><th>Updated at</th><th>Updated by</th><th>Change</th></tr></thead><tbody>{history.map(row => <tr key={row.id}><td>{timestamp(row.createdAt)}</td><td>{row.actorName ?? "Unknown administrator"}</td><td>{changes(row)}</td></tr>)}</tbody></table></div>{history.length === 0 && <p className="muted">No recorded settings changes.</p>}</>}
      <div className="form-actions"><button type="button" className="secondary" disabled={page === 1 || historyLoading} onClick={() => refreshHistory(page - 1)}>Previous</button><span>Page {page}</span><button type="button" className="secondary" disabled={!hasMore || historyLoading || !!historyError} onClick={() => refreshHistory(page + 1)}>Next</button></div>
    </section>
  </div>;
}
