"use client";

import { useEffect, useState } from "react";
import { ledgerText } from "../../lib/ledger-presentation";
import { sessionFetch } from "../../lib/session-fetch";

type Recharge = {
  id: string;
  riderId: string;
  amount: string;
  status: string;
  failureCode: string | null;
  scheduledAt: string;
  completedAt: string | null;
};
export function WalletAutoPayHistory() {
  const [requests, setRequests] = useState<Recharge[]>([]);
  const [page, setPage] = useState(1),
    [hasMore, setHasMore] = useState(false),
    [reload, setReload] = useState(0);
  const [loading, setLoading] = useState(true);
  const [historyError, setHistoryError] = useState("");
  const [checking, setChecking] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void sessionFetch(
      `/api/v1/client/autopay/recharges?page=${page}`,
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
      }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [page, reload]);
  async function verify(id: string) {
    if (checking) return;
    setChecking(id);
    setHistoryError("");
    try {
      const response = await sessionFetch(
        `/api/v1/client/autopay/recharges/${encodeURIComponent(id)}/verify`,
        { method: "POST" },
      );
      const body = await response.json();
      if (!response.ok)
        throw new Error(body.error?.message ?? "Verification unavailable.");
      setLoading(true); setReload((value) => value + 1);
    } catch (cause) {
      setHistoryError(
        cause instanceof Error ? cause.message : "Unable to verify.",
      );
    } finally {
      setChecking(null);
    }
  }

  return (
    <section className="sa-form autopay-card" aria-label="Automatic recharge requests">
      <div className="autopay-heading">
        <h2>Recharge history</h2>
        <button
          type="button" className="secondary"
          aria-label="Refresh recharge history"
          disabled={checking !== null || loading}
          onClick={() => { setLoading(true); setReload((value) => value + 1); }}
        >
          Refresh
        </button>
      </div>
      <p>
        Verification checks the existing payment. It does not submit another
        debit.
      </p>
      {historyError && <p role="alert">{ledgerText(historyError)}</p>}
      {loading ? <p role="status">Loading recharge history…</p> : historyError ? null : requests.length ? (
        <ul className="autopay-recharge-list">
          {requests.map((request) => (
            <li key={request.id}>
              Rider {request.riderId} · ₹{request.amount} · {request.status} ·
              Scheduled {new Date(request.scheduledAt).toLocaleString()}
              {request.failureCode && ` · ${ledgerText(request.failureCode)}`}
              {request.completedAt && " · Ledger credit recorded"}{" "}
              <button
                type="button" className="secondary"
                disabled={checking !== null || loading}
                onClick={() => void verify(request.id)}
              >
                {checking === request.id ? "Checking…" : "Verify payment"}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <div className="autopay-empty"><h3>No recharge requests</h3><p>Automatic ledger recharges will appear here when initiated.</p></div>
      )}
      {(page > 1 || hasMore) && <div className="form-actions">
      <button
        type="button" className="secondary"
        disabled={page === 1 || checking !== null || loading}
        onClick={() => { setLoading(true); setPage((value) => value - 1); }}
      >
        Previous
      </button>
      <span> Batch {page} </span>
      <button
        type="button" className="secondary"
        disabled={!hasMore || checking !== null || loading}
        onClick={() => { setLoading(true); setPage((value) => value + 1); }}
      >
        Next
      </button>
      </div>}
    </section>
  );
}
