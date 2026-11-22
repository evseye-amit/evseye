"use client";
import { useEffect, useState } from "react";
import { sessionFetch } from "../../lib/session-fetch";
import { formatMoney, formatDateTime } from "../../lib/presentation";
import { ledgerText } from "../../lib/ledger-presentation";
import { ClientDataTable } from "./client-data-table";
import { ClientFormDialog } from "./client-form-dialog";
type Row = {
  agreementId: string;
  agreementNumber: string;
  riderId: string;
  rider: { name: string; mobile: string } | null;
  currency: string;
  scheduleId: string | null;
  frequency: string;
  nextDueAt: string | null;
  lastSuccessAt: string | null;
  lastCollectionAt: string | null;
  outstandingAmount: string;
  availableBalance: string;
  deploymentCredit: string;
  blockers: string[];
};
type Audit = {
  items: Row[];
  page: number;
  hasMore: boolean;
  generationEnabled: boolean;
  collectionEnabled: boolean;
  lastRun: {
    status: string;
    startedAt: string;
    finishedAt: string | null;
  } | null;
};
type Preview = {
  rider: { name: string; mobile: string } | null;
  agreementNumber: string;
  scheduleId: string;
  fingerprint: string;
  periodStart: string;
  periodEnd: string;
  currency: string;
  totalAmount: string;
  paidAmount: string;
  outstandingAmount: string;
  lines: { kind: string; type: string; description: string; amount: string }[];
  payments: { method: string; amount: string }[];
};
async function api<T>(path: string, body?: unknown): Promise<T> {
  const response = await sessionFetch(
    `/api/v1/client/rental-billing${path}`,
    body === undefined
      ? undefined
      : {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
  );
  const result = await response.json();
  if (!response.ok)
    throw new Error(
      ledgerText(
        result.error?.message ??
          result.message ??
          "Unable to complete billing request.",
      ),
    );
  return result.data;
}
export function RentalBilling({ refreshKey }: { refreshKey: number }) {
  const [page, setPage] = useState(1),
    [reload, setReload] = useState(0),
    [data, setData] = useState<Audit | null>(null);
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [loadedKey, setLoadedKey] = useState("");
  const requestKey = `${page}:${reload}:${refreshKey}`;
  const loading = loadedKey !== requestKey;
  const [preview, setPreview] = useState<Preview | null>(null),
    [confirm, setConfirm] = useState<Row | null>(null);
  useEffect(() => {
    let active = true;
    void api<Audit>(`?page=${page}`)
      .then((value) => {
        if (active) {
          setData(value);
          setError("");
        }
      })
      .catch((e) => {
        if (active) {
          setData(null);
          setError(e.message);
        }
      })
      .finally(() => {
        if (active) setLoadedKey(requestKey);
      });
    return () => {
      active = false;
    };
  }, [page, requestKey]);
  async function action(path: string, body: unknown = {}) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await api(path, body);
      setPreview(null);
      setConfirm(null);
      setReload((v) => v + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed.");
    } finally {
      setBusy(false);
    }
  }
  async function showPreview(id: string) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      setPreview(
        await api<Preview>(`/schedules/${encodeURIComponent(id)}/preview`),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Preview failed.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="sa-form">
      <h2>Rent billing</h2>
      <p>
        Track rental charges, collection blockers, and missed billing periods.
        Security deposits are not used to pay rent. Restoring a missing schedule
        uses the saved handover date; historical charges still require a preview
        and approval.
      </p>
      <button
        className="secondary"
        disabled={busy || loading}
        onClick={() => setReload((v) => v + 1)}
      >
        Refresh billing health
      </button>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {loading && <p role="status">Loading billing health…</p>}
      {data && (
        <>
          <p>
            Generation: {data.generationEnabled ? "Enabled" : "Paused"} ·
            Collection: {data.collectionEnabled ? "Enabled" : "Paused"}
          </p>
          <p>
            Worker:{" "}
            {data.lastRun
              ? `${data.lastRun.status} · ${formatDateTime(data.lastRun.startedAt)}`
              : "No run recorded yet"}
          </p>
          <ClientDataTable
            rows={loading ? [] : data.items}
            getRowId={(row) => row.agreementId}
            loading={loading}
            columns={[
              {
                key: "rider",
                label: "Rider",
                value: (row) =>
                  row.rider
                    ? `${row.rider.name} (${row.rider.mobile})`
                    : "Rider unavailable",
              },
              {
                key: "agreement",
                label: "Agreement / plan",
                value: (row) => `${row.agreementNumber} · ${row.frequency}`,
              },
              {
                key: "due",
                label: "Next billing due",
                value: (row) => row.nextDueAt ?? "",
                render: (row) =>
                  row.nextDueAt ? formatDateTime(row.nextDueAt) : "No schedule",
              },
              {
                key: "last",
                label: "Last billed",
                value: (row) => row.lastSuccessAt ?? "",
                render: (row) =>
                  row.lastSuccessAt
                    ? formatDateTime(row.lastSuccessAt)
                    : "No successful run recorded",
              },
              {
                key: "amount",
                label: "Outstanding",
                value: (row) => row.outstandingAmount,
                render: (row) =>
                  formatMoney(row.outstandingAmount, row.currency),
              },
              {
                key: "funds",
                label: "Available funds",
                value: (row) => row.availableBalance,
                render: (row) =>
                  formatMoney(row.availableBalance, row.currency),
              },
              {
                key: "prepaid",
                label: "Deployment credit",
                value: (row) => row.deploymentCredit,
                render: (row) =>
                  formatMoney(row.deploymentCredit, row.currency),
              },
              {
                key: "blockers",
                label: "Checks / blockers",
                value: (row) => row.blockers.join(" · "),
                render: (row) =>
                  row.blockers.length
                    ? row.blockers.map((value) => (
                        <div key={value}>
                          {ledgerText(value).replaceAll("_", " ")}
                        </div>
                      ))
                    : "No blockers detected",
              },
              {
                key: "actions",
                label: "Actions",
                value: () => "",
                render: (row) => (
                  <div className="form-actions">
                    {!row.scheduleId && (
                      <button
                        disabled={busy}
                        className="secondary"
                        onClick={() =>
                          void action(
                            `/agreements/${row.agreementId}/repair-schedule`,
                          )
                        }
                      >
                        Restore handover schedule
                      </button>
                    )}
                    {row.scheduleId && (
                      <>
                        <button
                          disabled={busy}
                          className="secondary"
                          onClick={() => void showPreview(row.scheduleId!)}
                        >
                          Preview next period
                        </button>
                        <button
                          disabled={busy}
                          className="secondary"
                          onClick={() =>
                            void action(`/schedules/${row.scheduleId}/retry`)
                          }
                        >
                          Retry billing
                        </button>
                      </>
                    )}
                    {row.blockers.includes("LEDGER_COLLECTION_DISABLED") ? (
                      <button
                        disabled={busy}
                        className="secondary"
                        onClick={() => setConfirm(row)}
                      >
                        Enable ledger collection
                      </button>
                    ) : (
                      <button
                        disabled={busy}
                        className="secondary"
                        onClick={() =>
                          void action(`/riders/${row.riderId}/collect`)
                        }
                      >
                        Retry collection
                      </button>
                    )}
                  </div>
                ),
              },
            ]}
          />
          <div className="form-actions">
            <button
              disabled={page === 1 || busy || loading}
              onClick={() => setPage((p) => p - 1)}
            >
              Previous batch
            </button>
            <span>Batch {page}</span>
            <button
              disabled={!data.hasMore || busy || loading}
              onClick={() => setPage((p) => p + 1)}
            >
              Next batch
            </button>
          </div>
        </>
      )}
      {preview && (
        <ClientFormDialog
          title="Review rent recovery"
          onClose={() => {
            if (!busy) setPreview(null);
          }}
          wide
          formsOnly
        >
          <p>
            {preview.rider
              ? `${preview.rider.name} (${preview.rider.mobile})`
              : "Rider unavailable"}{" "}
            · {preview.agreementNumber}
          </p>
          <p>
            {formatDateTime(preview.periodStart)} –{" "}
            {formatDateTime(preview.periodEnd)}
          </p>
          <p>
            Charge: {formatMoney(preview.totalAmount, preview.currency)} ·
            Existing payments applied:{" "}
            {formatMoney(preview.paidAmount, preview.currency)} · Remaining due:{" "}
            {formatMoney(preview.outstandingAmount, preview.currency)}
          </p>
          <ul>
            {preview.lines.map((line, i) => (
              <li key={i}>
                {line.kind === "CREDIT"
                  ? "Credit"
                  : ledgerText(line.description)}
                : {line.kind === "CREDIT" ? "−" : ""}{" "}
                {formatMoney(line.amount, preview.currency)}
              </li>
            ))}
          </ul>
          <p>
            This preview has saved no charges. Approval posts this one period
            and applies existing deployment payments. Enabled ledger collection
            can then collect the remaining due. Later missed periods need their
            own review.
          </p>
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          <button
            disabled={busy}
            onClick={() =>
              void action(`/schedules/${preview.scheduleId}/approve-recovery`, {
                periodStart: preview.periodStart,
                fingerprint: preview.fingerprint,
              })
            }
          >
            Approve this period
          </button>
        </ClientFormDialog>
      )}
      {confirm && (
        <ClientFormDialog
          title="Enable rent collection"
          onClose={() => {
            if (!busy) setConfirm(null);
          }}
          formsOnly
        >
          <p>
            Enable collection from eligible available ledger funds for{" "}
            {confirm.rider?.name}? This can pay existing outstanding invoices.
            It does not enable bank AutoPay or use the security deposit. Pending
            external payments must be resolved first.
          </p>
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          <button
            disabled={busy}
            onClick={() =>
              void action(`/riders/${confirm.riderId}/enable-collection`)
            }
          >
            Enable collection
          </button>
        </ClientFormDialog>
      )}
    </section>
  );
}
