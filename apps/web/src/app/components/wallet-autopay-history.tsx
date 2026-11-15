"use client";

import { useEffect, useState } from "react";
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

  return (
    <section aria-label="Automatic recharge requests">
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
