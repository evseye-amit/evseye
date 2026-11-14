"use client";

import { useEffect, useRef, useState } from "react";
import { sessionFetch } from "../../lib/session-fetch";

type Policy = {
  enabled: boolean;
  threshold: string;
  rechargeAmount: string;
  revision: number;
};
type Recharge = {
  id: string;
  riderId: string;
  amount: string;
  status: string;
  failureCode: string | null;
  scheduledAt: string;
  completedAt: string | null;
};
export function WalletAutoPaySettings() {
  const [requests, setRequests] = useState<Recharge[]>([]);
  const [page, setPage] = useState(1),
    [hasMore, setHasMore] = useState(false),
    [reload, setReload] = useState(0);
  const [historyError, setHistoryError] = useState("");
  const [checking, setChecking] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void sessionFetch(
      `/api/v1/client/wallet-autopay-policy/requests?page=${page}`,
      { signal: controller.signal },
    )
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok)
          throw new Error(
            body.error?.message ?? "Unable to load recharge history.",
          );
        if (!controller.signal.aborted) {
          setHistoryError("");
          setRequests(body.data.items);
          setHasMore(body.data.hasMore);
        }
      })
      .catch((cause) => {
        if (!controller.signal.aborted)
          setHistoryError(
            cause instanceof Error ? cause.message : "Unable to load history.",
          );
      });
    return () => controller.abort();
  }, [page, reload]);
  async function verify(id: string) {
    if (checking) return;
    setChecking(id);
    setHistoryError("");
    try {
      const response = await sessionFetch(
        `/api/v1/client/wallet-autopay-policy/requests/${encodeURIComponent(id)}/verify`,
        { method: "POST" },
      );
      const body = await response.json();
      if (!response.ok)
        throw new Error(body.error?.message ?? "Verification unavailable.");
      setReload((value) => value + 1);
    } catch (cause) {
      setHistoryError(
        cause instanceof Error ? cause.message : "Unable to verify.",
      );
    } finally {
      setChecking(null);
    }
  }

  const [policy, setPolicy] = useState<Policy | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const saving = useRef(false);
  useEffect(() => {
    const controller = new AbortController();
    void sessionFetch("/api/v1/client/wallet-autopay-policy", {
      signal: controller.signal,
    })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok)
          throw new Error(
            body.error?.message ?? "Unable to load wallet AutoPay settings.",
          );
        if (!controller.signal.aborted) setPolicy(body.data);
      })
      .catch((cause) => {
        if (!controller.signal.aborted)
          setError(
            cause instanceof Error ? cause.message : "Unable to load settings.",
          );
      });
    return () => controller.abort();
  }, []);
  async function save() {
    if (!policy || saving.current) return;
    saving.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await sessionFetch(
        "/api/v1/client/wallet-autopay-policy",
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(policy),
        },
      );
      const body = await response.json();
      if (!response.ok)
        throw new Error(
          body.error?.message ??
            "Could not save settings. Reload before retrying.",
        );
      setPolicy(body.data);
      setNotice(
        "Wallet AutoPay policy saved. Riders must accept any changed amounts before new recharges start.",
      );
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Unable to save settings.",
      );
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }
  return (
    <section aria-label="Wallet AutoPay settings">
      <h3>Wallet AutoPay</h3>
      <p>
        Automatically recharge opted-in riders with an active scooter. The
        threshold uses available cash, excluding rewards and security deposits.
        Debits require at least 25 hours; credit appears only after payment
        confirmation.
      </p>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {policy && (
        <fieldset disabled={busy}>
          <label>
            <input
              type="checkbox"
              checked={policy.enabled}
              onChange={(e) =>
                setPolicy({ ...policy, enabled: e.target.checked })
              }
            />{" "}
            Enable wallet AutoPay for this client
          </label>
          <label>
            Recharge when cash is below (₹)
            <input
              inputMode="decimal"
              value={policy.threshold}
              onChange={(e) =>
                setPolicy({ ...policy, threshold: e.target.value })
              }
            />
          </label>
          <label>
            Recharge amount (₹)
            <input
              inputMode="decimal"
              value={policy.rechargeAmount}
              onChange={(e) =>
                setPolicy({ ...policy, rechargeAmount: e.target.value })
              }
            />
          </label>
          <p>
            Use two decimal places. Recharge: ₹500–₹5,000, greater than the
            threshold. One pending automatic recharge per wallet; at least 24
            hours between a successful recharge and the next request. Disabling
            stops new requests; submitted debits may still complete.
          </p>
          <button type="button" onClick={() => void save()}>
            {busy ? "Saving…" : "Save wallet AutoPay settings"}
          </button>
        </fieldset>
      )}
      <h4>Automatic recharge requests</h4>
      <p>
        Verification checks the existing payment. It does not submit another
        debit.
      </p>
      {historyError && <p role="alert">{historyError}</p>}
      <button
        type="button"
        disabled={checking !== null}
        onClick={() => setReload((value) => value + 1)}
      >
        Refresh recharge history
      </button>
      {requests.length ? (
        <ul>
          {requests.map((request) => (
            <li key={request.id}>
              Rider {request.riderId} · ₹{request.amount} · {request.status} ·
              Scheduled {new Date(request.scheduledAt).toLocaleString()}
              {request.failureCode && ` · ${request.failureCode}`}
              {request.completedAt && " · Wallet credit recorded"}{" "}
              <button
                type="button"
                disabled={checking !== null}
                onClick={() => void verify(request.id)}
              >
                {checking === request.id ? "Checking…" : "Verify payment"}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p>No requests in this batch.</p>
      )}
      <button
        type="button"
        disabled={page === 1 || checking !== null}
        onClick={() => setPage((value) => value - 1)}
      >
        Previous
      </button>
      <span> Batch {page} </span>
      <button
        type="button"
        disabled={!hasMore || checking !== null}
        onClick={() => setPage((value) => value + 1)}
      >
        Next
      </button>
    </section>
  );
}
