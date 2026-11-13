"use client";
import { useEffect, useRef, useState } from "react";
import { sessionFetch } from "../../lib/session-fetch";
import type { Operation } from "./payment-operations-model";
type Version = {
  id: string;
  provider: string;
  environment: string;
  version: number;
  merchantAccountId: string | null;
};
type Alert = {
  id: string;
  kind: string;
  referenceId: string;
  routedRole: string;
  assigneeId: string | null;
  acknowledgedAt: string | null;
};
type Settlement = {
  id: string;
  providerSettlementId: string;
  netAmount: string;
  currency: string;
  bankConfirmedAt?: string | null;
};
async function api<T>(path: string, body?: unknown): Promise<T> {
  const response = await sessionFetch(
    `/api/v1/client/finance/${path}`,
    body === undefined
      ? undefined
      : {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
  );
  const value = await response.json();
  if (!response.ok)
    throw new Error(
      value.error?.message ?? value.message ?? "Operation failed.",
    );
  return value.data ?? value;
}
export function PaymentOperationsTools({
  settlements,
  payments,
  onChanged,
}: {
  settlements: Settlement[];
  payments: Operation[];
  onChanged: () => void;
}) {
  const [versions, setVersions] = useState<Version[]>([]),
    [alerts, setAlerts] = useState<Alert[]>([]),
    [page, setPage] = useState(1);
  const [assignees, setAssignees] = useState<{ id: string; name: string }[]>(
    [],
  );
  const [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  const submitting = useRef(false),
    active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  useEffect(() => {
    let cancelled = false;
    Promise.all([
      api<Version[]>("provider-settlements/merchant-versions"),
      api<Alert[]>(`payment-alerts?page=${page}`),
      api<{ id: string; name: string }[]>("payment-alerts/assignees"),
    ])
      .then(([v, a, staff]) => {
        if (!cancelled) {
          setVersions(v);
          setAlerts(a);
          setAssignees(staff);
        }
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [page]);
  async function run(work: () => Promise<unknown>, message: string) {
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await work();
      if (active.current) {
        setNotice(message);
        onChanged();
        setAlerts(await api<Alert[]>(`payment-alerts?page=${page}`));
      }
    } catch (e) {
      if (active.current)
        setError(e instanceof Error ? e.message : "Operation failed.");
    } finally {
      submitting.current = false;
      if (active.current) setBusy(false);
    }
  }
  const eligible = payments.filter(
    (p) =>
      p.provider === "RAZORPAY" &&
      p.paymentId &&
      p.riderId &&
      p.refundSupported === true,
  );
  return (
    <details>
      <summary>
        Settlement ingestion, bank evidence and operational alerts
      </summary>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      <form
        className="form-stack"
        onSubmit={(e) => {
          e.preventDefault();
          const data = new FormData(e.currentTarget),
            version = versions.find((v) => v.id === data.get("version"));
          if (version)
            void run(
              () =>
                api("provider-settlements/fetch", {
                  provider: version.provider,
                  configurationVersionId: version.id,
                  settlementId: data.get("settlementId"),
                  date: data.get("date"),
                }),
              "Gateway statement fetched and matched. Bank receipt still needs confirmation.",
            );
        }}
      >
        <fieldset disabled={busy || !versions.length}>
          <legend>Fetch gateway settlement</legend>
          <label>
            Merchant
            <select name="version" required>
              {versions.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.provider} · {v.environment} ·{" "}
                  {v.merchantAccountId ?? "Merchant"} · version {v.version}
                </option>
              ))}
            </select>
          </label>
          <label>
            Gateway settlement reference
            <input name="settlementId" required maxLength={120} />
          </label>
          <label>
            Settlement date
            <input name="date" type="date" required />
          </label>
          <button>Fetch and match</button>
        </fieldset>
        {!versions.length && (
          <p>
            No merchant configured for direct ingestion. Existing payment
            operations remain available.
          </p>
        )}
      </form>
      <form
        className="form-stack"
        onSubmit={(e) => {
          e.preventDefault();
          const data = new FormData(e.currentTarget),
            settlement = settlements.find(
              (s) => s.id === data.get("settlement"),
            );
          if (settlement)
            void run(
              () =>
                api(
                  `provider-settlements/${encodeURIComponent(settlement.id)}/bank-confirmation`,
                  {
                    amount: data.get("amount"),
                    currency: settlement.currency,
                    utr: data.get("utr"),
                    creditedAt: data.get("creditedAt"),
                    accountLast4: data.get("accountLast4"),
                    evidenceReference: data.get("evidence"),
                  },
                ),
              "Bank evidence recorded. Statement matching remains independent.",
            );
        }}
      >
        <fieldset disabled={busy || !settlements.length}>
          <legend>Confirm bank receipt</legend>
          <label>
            Settlement
            <select name="settlement" required>
              {settlements.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.providerSettlementId} · {s.currency} {s.netAmount} ·{" "}
                  {s.bankConfirmedAt ? "Confirmed" : "Awaiting evidence"}
                </option>
              ))}
            </select>
          </label>
          <label>
            Amount credited
            <input
              name="amount"
              required
              inputMode="decimal"
              pattern="[0-9]+(\.[0-9]{1,2})?"
            />
          </label>
          <label>
            Bank UTR
            <input name="utr" required minLength={6} maxLength={160} />
          </label>
          <label>
            Credit date
            <input name="creditedAt" type="date" required />
          </label>
          <label>
            Account last four digits
            <input name="accountLast4" required pattern="[0-9]{4}" />
          </label>
          <label>
            Bank statement evidence reference
            <input name="evidence" required minLength={8} maxLength={300} />
          </label>
          <label>
            <input type="checkbox" required />I checked this credit against the
            bank statement.
          </label>
          <button>Confirm receipt</button>
        </fieldset>
      </form>
      <form
        className="form-stack"
        onSubmit={(e) => {
          e.preventDefault();
          const data = new FormData(e.currentTarget),
            payment = eligible.find((p) => p.id === data.get("payment"));
          if (payment)
            void run(async () => {
              const response = await sessionFetch(
                `/api/v1/client/riders/${encodeURIComponent(payment.riderId!)}/payments/${encodeURIComponent(payment.paymentId!)}/refunds/adopt-external`,
                {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    reference: data.get("reference"),
                    reason: data.get("reason"),
                    treatment: data.get("treatment"),
                  }),
                },
              );
              const result = await response.json();
              if (!response.ok)
                throw new Error(
                  result.error?.message ??
                    result.message ??
                    "Refund adoption failed.",
                );
            }, "Existing gateway refund verified and recorded. No new refund was issued.");
        }}
      >
        <fieldset disabled={busy || !eligible.length}>
          <legend>Adopt an existing Razorpay refund</legend>
          <label>
            Original payment
            <select name="payment" required>
              {eligible.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.riderName ?? p.riderId} · {p.paymentId}
                </option>
              ))}
            </select>
          </label>
          <label>
            Gateway refund reference
            <input name="reference" required pattern="rfnd_[A-Za-z0-9]+" />
          </label>
          <label>
            Reason
            <input name="reason" required minLength={3} maxLength={500} />
          </label>
          <label>
            Accounting treatment
            <select name="treatment" required defaultValue="">
              <option value="" disabled>
                Select treatment
              </option>
              <option value="UNALLOCATED_RETURN">
                Return unallocated funds
              </option>
              <option value="PAYMENT_REVERSAL">Reverse full payment</option>
            </select>
          </label>
          <button>Verify and adopt existing refund</button>
        </fieldset>
      </form>
      <h3>Payment alerts</h3>
      <button
        disabled={busy}
        onClick={() => void run(async () => undefined, "Alerts refreshed.")}
      >
        Refresh alerts
      </button>
      <p>
        Alerts are routed to workspace admins. Acknowledgement records
        ownership; it does not resolve the financial issue.
      </p>
      <button
        disabled={busy || page === 1}
        onClick={() => setPage((p) => p - 1)}
      >
        Previous alerts
      </button>
      <span>Batch {page}</span>
      <button
        disabled={busy || alerts.length < 100}
        onClick={() => setPage((p) => p + 1)}
      >
        Next alerts
      </button>
      {alerts.map((alert) => (
        <form
          className="form-stack"
          key={alert.id}
          onSubmit={(e) => {
            e.preventDefault();
            const data = new FormData(e.currentTarget);
            void run(
              () =>
                api(`payment-alerts/${encodeURIComponent(alert.id)}/route`, {
                  assigneeId:
                    String(data.get("assigneeId") ?? "").trim() || undefined,
                  acknowledge: data.get("acknowledge") === "on",
                }),
              "Alert routing updated.",
            );
          }}
        >
          <p>
            {alert.kind} · {alert.referenceId} ·{" "}
            {alert.acknowledgedAt ? "Acknowledged" : "Needs attention"}
          </p>
          <label>
            Assigned admin
            <select name="assigneeId" defaultValue={alert.assigneeId ?? ""}>
              <option value="">Workspace admin queue</option>
              {assignees.map((staff) => (
                <option key={staff.id} value={staff.id}>
                  {staff.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <input name="acknowledge" type="checkbox" />
            Acknowledge
          </label>
          <button disabled={busy}>Save routing</button>
        </form>
      ))}
    </details>
  );
}
