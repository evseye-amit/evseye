"use client";

import { useEffect, useRef, useState } from "react";
import { sessionFetch } from "../../lib/session-fetch";
import { requestNavigation, UnsavedChangesScope } from "./unsaved-changes";

type Policy = {
  enabled: boolean;
  revision: number;
  effectiveEnabled: boolean;
  canEnable: boolean;
  reasonMessage: string | null;
  provider: string | null;
  environment: string;
  terms: { maxAmount: string; validityDays: number } | null;
  updatedAt: string | null;
  updatedByName: string | null;
};
type History = {
  id: string;
  createdAt: string;
  actorName: string | null;
  previousData: { enabled: boolean } | null;
  newData: { enabled: boolean; source?: string } | null;
};
class SettingsError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}
async function read<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await sessionFetch(
    `/api/v1/client/deployment-autopay-policy${path}`,
    init,
  );
  const body = await response.json();
  if (!response.ok)
    throw new SettingsError(
      body.error?.message ?? "Unable to load onboarding AutoPay settings.",
      response.status,
    );
  return body.data;
}
const timestamp = (value: string) =>
  new Date(value).toLocaleString("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
  });
const currency = (value: string) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(
    Number(value),
  );

export function DeploymentAutoPaySettings() {
  const [saved, setSaved] = useState<Policy | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false);
  const [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [needsReload, setNeedsReload] = useState(false),
    [reload, setReload] = useState(0);
  const [reset, setReset] = useState(0);
  const [history, setHistory] = useState<History[]>([]),
    [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false),
    [historyVersion, setHistoryVersion] = useState(0);
  const [historyLoading, setHistoryLoading] = useState(true),
    [historyError, setHistoryError] = useState("");
  const saving = useRef(false),
    active = useRef(true);

  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    void read<Policy>("", { signal: controller.signal })
      .then((data) => {
        if (controller.signal.aborted) return;
        setSaved(data);
        setEnabled(data.enabled);
        setNeedsReload(false);
        setError("");
        setReset((value) => value + 1);
      })
      .catch((cause) => {
        if (!controller.signal.aborted)
          setError(
            cause instanceof Error ? cause.message : "Unable to load settings.",
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [reload]);
  useEffect(() => {
    const controller = new AbortController();
    void read<{ items: History[]; hasMore: boolean }>(`/history?page=${page}`, {
      signal: controller.signal,
    })
      .then((data) => {
        if (!controller.signal.aborted) {
          setHistory(data.items);
          setHasMore(data.hasMore);
          setHistoryError("");
        }
      })
      .catch((cause) => {
        if (!controller.signal.aborted)
          setHistoryError(
            cause instanceof Error ? cause.message : "Unable to load history.",
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) setHistoryLoading(false);
      });
    return () => controller.abort();
  }, [page, historyVersion]);

  function refreshHistory(nextPage = 1) {
    setHistoryLoading(true);
    setPage(nextPage);
    setHistoryVersion((value) => value + 1);
  }
  function reloadSettings() {
    requestNavigation(() => {
      setLoading(true);
      setNotice("");
      setReload((value) => value + 1);
    });
  }
  const dirty = saved !== null && saved.enabled !== enabled;
  async function save() {
    if (
      !saved ||
      !dirty ||
      saving.current ||
      needsReload ||
      (enabled && !saved.canEnable)
    )
      return;
    saving.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const data = await read<Policy>("", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled, revision: saved.revision }),
      });
      if (!active.current) return;
      setSaved(data);
      setEnabled(data.enabled);
      setReset((value) => value + 1);
      setNotice("Onboarding AutoPay settings saved.");
      refreshHistory();
    } catch (cause) {
      if (!active.current) return;
      setError(
        cause instanceof Error ? cause.message : "Unable to save settings.",
      );
      // A conflict, changed eligibility or uncertain response must be re-read.
      setNeedsReload(true);
    } finally {
      saving.current = false;
      if (active.current) setBusy(false);
    }
  }

  return (
    <section
      className="autopay-settings"
      aria-label="Onboarding AutoPay settings"
    >
      <UnsavedChangesScope resetKey={reset}>
        <form
          className="sa-form autopay-card"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <div className="autopay-heading">
            <div>
              <h2>Onboarding AutoPay</h2>
              <p className="muted">
                Offer payment and invoice AutoPay authorization in one checkout.
              </p>
            </div>
            {saved && (
              <span
                className={`autopay-status ${saved.effectiveEnabled ? "is-enabled" : ""}`}
              >
                {!saved.canEnable
                  ? "Unavailable"
                  : saved.effectiveEnabled
                    ? "Available"
                    : "Off"}
              </span>
            )}
          </div>
          {error && (
            <p role="alert" className="autopay-message is-error">
              {error}
            </p>
          )}
          {notice && (
            <p role="status" className="autopay-message">
              {notice}
            </p>
          )}
          {loading && <p role="status">Loading onboarding AutoPay settings…</p>}
          {saved && (
            <fieldset disabled={busy || loading} className="autopay-fields">
              <legend className="autopay-legend">
                Onboarding AutoPay configuration
              </legend>
              <label className="autopay-enable">
                <input
                  name="deploymentAutoPayEnabled"
                  type="checkbox"
                  role="switch"
                  checked={enabled}
                  disabled={
                    needsReload ||
                    (!saved.canEnable && !enabled && !saved.enabled)
                  }
                  aria-describedby="deployment-autopay-help deployment-autopay-availability"
                  onChange={(event) => {
                    setEnabled(event.target.checked);
                    setNotice("");
                  }}
                />
                <span>
                  Offer AutoPay during onboarding payment
                  <small id="deployment-autopay-help">
                    Let riders pay their onboarding amount and authorize future
                    invoice auto-debits in the same checkout. Riders must
                    explicitly agree.
                  </small>
                </span>
              </label>
              <p id="deployment-autopay-availability" className="muted">
                Saved preference:{" "}
                <strong>{saved.enabled ? "On" : "Off"}</strong>.
                {saved.reasonMessage
                  ? ` ${saved.reasonMessage}`
                  : saved.effectiveEnabled
                    ? " Available to eligible riders at checkout."
                    : " Turn on to offer combined checkout to eligible riders."}
              </p>
              <dl className="deployment-autopay-terms">
                <div>
                  <dt>Gateway</dt>
                  <dd>
                    {saved.provider === "RAZORPAY"
                      ? "Razorpay"
                      : "Not configured"}
                  </dd>
                </div>
                <div>
                  <dt>Environment</dt>
                  <dd>
                    {saved.environment === "TEST" ? "Test" : "Production"}
                  </dd>
                </div>
                <div>
                  <dt>Maximum per debit</dt>
                  <dd>
                    {saved.terms
                      ? currency(saved.terms.maxAmount)
                      : "Unavailable"}
                  </dd>
                </div>
                <div>
                  <dt>Mandate validity</dt>
                  <dd>
                    {saved.terms
                      ? `${saved.terms.validityDays} days`
                      : "Unavailable"}
                  </dd>
                </div>
              </dl>
              <p className="muted">
                Limits come from your active package. Contact your platform
                administrator to change the package or merchant configuration.
              </p>
              <div className="autopay-message">
                <strong>Applies to new checkouts</strong>
                <p>
                  Turning this off does not cancel existing mandates or stop
                  previously agreed invoice debits. Existing payment attempts
                  can still complete. Wallet AutoPay is managed separately
                  below.
                </p>
              </div>
              <div className="form-actions">
                <button
                  type="submit"
                  disabled={
                    !dirty || needsReload || (enabled && !saved.canEnable)
                  }
                >
                  {busy ? "Saving…" : "Save changes"}
                </button>
                <button
                  type="button"
                  className="secondary"
                  disabled={!dirty}
                  onClick={() => {
                    setEnabled(saved.enabled);
                    setNotice("");
                    setReset((value) => value + 1);
                  }}
                >
                  Discard changes
                </button>
              </div>
            </fieldset>
          )}
          {(needsReload || error) && (
            <button
              type="button"
              className="secondary"
              disabled={busy || loading}
              onClick={reloadSettings}
            >
              Reload latest settings
            </button>
          )}
          {saved?.updatedAt && (
            <p className="muted">
              Last updated by{" "}
              {saved.updatedByName ?? "System or former administrator"} ·{" "}
              {timestamp(saved.updatedAt)}
            </p>
          )}
        </form>
      </UnsavedChangesScope>
      <details className="sa-form autopay-card">
        <summary>Onboarding AutoPay change history</summary>
        <p className="muted">
          Changes for this client. Times are shown in your local timezone.
        </p>
        <button
          type="button"
          className="secondary"
          disabled={historyLoading || busy}
          onClick={() => refreshHistory()}
        >
          Refresh onboarding history
        </button>
        {historyError && (
          <p role="alert" className="autopay-message is-error">
            {historyError}
          </p>
        )}
        {historyLoading ? (
          <p role="status">Loading history…</p>
        ) : (
          !historyError && (
            <>
              <div className="autopay-history-table">
                <table>
                  <caption className="sr-only">
                    Onboarding AutoPay setting changes
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">Updated at</th>
                      <th scope="col">Updated by</th>
                      <th scope="col">Change</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.map((row) => (
                      <tr key={row.id}>
                        <td>{timestamp(row.createdAt)}</td>
                        <td>
                          {row.actorName ?? "System or former administrator"}
                        </td>
                        <td>
                          {row.newData?.source === "MIGRATION"
                            ? "Existing staging setting preserved"
                            : row.newData
                              ? `${row.previousData ? (row.previousData.enabled ? "On" : "Off") : "Unrecorded"} → ${row.newData.enabled ? "On" : "Off"}`
                              : "Recorded settings unavailable"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {!history.length && (
                <p className="muted">No recorded onboarding AutoPay changes.</p>
              )}
            </>
          )
        )}
        <div className="form-actions">
          <button
            type="button"
            className="secondary"
            disabled={page === 1 || historyLoading}
            onClick={() => refreshHistory(page - 1)}
          >
            Previous
          </button>
          <span>Page {page}</span>
          <button
            type="button"
            className="secondary"
            disabled={!hasMore || historyLoading || !!historyError}
            onClick={() => refreshHistory(page + 1)}
          >
            Next
          </button>
        </div>
      </details>
    </section>
  );
}
