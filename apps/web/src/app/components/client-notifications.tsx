"use client";
import { usePanelLoading } from "./panel-loading";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { sessionFetch } from "../../lib/session-fetch";
import { ClientDataTable } from "./client-data-table";
import {
  NotificationComposerFields,
  emptyComposerFields,
  type ComposerOptions,
} from "./notification-composer-fields";
import { NotificationTestSend } from "./notification-test-send";
import { ClientNotificationTopics } from "./client-notification-topics";
import { ClientFormDialog } from "./client-form-dialog";

const audiences = {
  ALL_USERS: "All Users",
  ALL_RIDERS: "All Riders",
  ALL_EMPLOYEES: "All Employees",
  ALL_TEAM_LEADERS: "All Team Leaders",
  FILTERED: "Filtered Users",
  ALL_FLEET_MANAGERS: "All Fleet Managers",
  PHONE_NUMBERS: "Phone Numbers",
  USER_IDS: "Selected Users",
};
type Audience = Exclude<keyof typeof audiences, "USER_IDS">;
type Preview = {
  users: number;
  devices: number;
  usersWithoutDevices: number;
  invalidPhoneNumbers: string[];
  duplicatePhoneNumbers: string[];
  unmatchedPhoneNumbers: string[];
  pushConfigured: boolean;
};
type Broadcast = {
  id: string;
  title: string;
  body: string;
  audience: keyof typeof audiences;
  audiencePhones: string[];
  source: string;
  status: string;
  createdAt: string;
  completedAt: string | null;
  scheduledFor?: string | null;
  withdrawnAt?: string | null;
  application?: string | null;
  categoryCode?: string | null;
  category?: { name: string } | null;
  visibilityExpiresAt?: string | null;
  totalUsers: number;
  sender?: { name: string } | null;
  deliveryCounts: Record<string, number>;
  pendingExpansion: number;
  usersWithoutDevices: number;
  readUsers: number;
  usersAcceptedByFirebase: number;
  pushConfigured: boolean;
  failures?: Array<{
    id: string;
    status: string;
    attempts: number;
    errorCode: string;
    userNotification: { user: { name: string; mobile: string } };
  }>;
};
const statusLabel = (status: string) =>
  ({
    SCHEDULED: "Scheduled",
    CANCELLED: "Cancelled",
    EXPIRED: "Push expired",
    QUEUED: "Queued",
    PROCESSING: "Processing",
    WAITING_FOR_CONFIGURATION: "Awaiting Firebase setup",
    COMPLETED: "Completed",
    PARTIAL: "Partially accepted",
    FAILED: "Push failed",
  })[status] ?? status;
const pending = (row: Broadcast) =>
  ["PENDING", "PROCESSING", "RETRY"].reduce(
    (sum, status) => sum + (row.deliveryCounts[status] ?? 0),
    0,
  );
async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await sessionFetch(
    `/api/v1/client/notifications${path}`,
    options,
  );
  const body = await response.json();
  if (!response.ok)
    throw new Error(body.error?.message ?? "Unable to process notifications.");
  return body.data as T;
}
export function ClientNotifications({
  refreshKey = 0,
  canManageTopics = false,
}: {
  refreshKey?: number;
  canManageTopics?: boolean;
}) {
  const [options, setOptions] = useState<ComposerOptions | null>(null);
  const [fields, setFields] = useState(emptyComposerFields);
  const [topicsOpen, setTopicsOpen] = useState(false);
  const [withdrawConfirm, setWithdrawConfirm] = useState(false);
  const reviewed = useRef<Record<string, unknown> | null>(null);
  const [rows, setRows] = useState<Broadcast[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [previous, setPrevious] = useState<Array<string | null>>([]);
  const [next, setNext] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [compose, setCompose] = useState(false);
  const [audience, setAudience] = useState<Audience>("ALL_RIDERS");
  const [phones, setPhones] = useState("");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [dialogError, setDialogError] = useState("");
  const [busy, setBusy] = useState(false);
  const [details, setDetails] = useState<Broadcast | null>(null);
  usePanelLoading(loading || busy);
  const key = useRef<string | null>(null);
  const sequence = useRef(0);
  const load = useCallback(
    async (quiet = false) => {
      const current = ++sequence.current;
      if (!quiet) setLoading(true);
      try {
        const page = await request<{
          items: Broadcast[];
          nextCursor: string | null;
        }>(`?limit=20${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
        if (sequence.current === current) {
          setRows(page.items);
          setNext(page.nextCursor);
          setError("");
        }
      } catch (cause) {
        if (sequence.current === current)
          setError(
            cause instanceof Error
              ? cause.message
              : "Unable to load notifications.",
          );
      } finally {
        if (sequence.current === current) setLoading(false);
      }
    },
    [cursor],
  );
  const invalidateRequests = useCallback(() => {
    sequence.current += 1;
  }, []);
  useEffect(() => {
    const initial = window.setTimeout(() => {
      void load();
    }, 0);
    const timer = window.setInterval(() => {
      void load(true);
    }, 10000);
    return () => {
      invalidateRequests();
      window.clearTimeout(initial);
      window.clearInterval(timer);
    };
  }, [load, invalidateRequests, refreshKey]);
  const contentBytes = new TextEncoder().encode(
    JSON.stringify({
      notification: { title: title.trim(), body: body.trim() },
      data: {},
    }),
  ).length;
  function resetPreview() {
    setPreview(null);
    setDialogError("");
    key.current = null;
    reviewed.current = null;
  }
  async function openCompose() {
    setBusy(true);
    setError("");
    try {
      setOptions(await request<ComposerOptions>("/options"));
      setFields(emptyComposerFields());
      setTitle("");
      setBody("");
      setPhones("");
      setAudience("ALL_RIDERS");
      resetPreview();
      setCompose(true);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Unable to load notification options.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function openTopics() {
    setBusy(true);
    setError("");
    try {
      setOptions(await request<ComposerOptions>("/options"));
      setTopicsOpen(true);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Unable to load notification groups.",
      );
    } finally {
      setBusy(false);
    }
  }
  function audiencePayload() {
    const cities = [
      ...new Set(
        fields.cities
          .split(/[,\n]/)
          .map((c) => c.trim())
          .filter(Boolean),
      ),
    ];
    return {
      audience,
      application: fields.application,
      ...(audience === "PHONE_NUMBERS" ? { phoneNumbers: phones } : {}),
      ...(fields.hubIds.length ? { hubIds: fields.hubIds } : {}),
      ...(fields.vehicleTypeIds.length
        ? { vehicleTypeIds: fields.vehicleTypeIds }
        : {}),
      ...(fields.oemIds.length ? { oemIds: fields.oemIds } : {}),
      ...(cities.length ? { cities } : {}),
    };
  }
  async function review(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setDialogError("");
    try {
      if (!fields.categoryCode)
        throw new Error("Choose a notification category.");
      const scheduled = fields.scheduledFor
        ? new Date(fields.scheduledFor)
        : null;
      if (
        scheduled &&
        (!Number.isFinite(scheduled.getTime()) ||
          scheduled.getTime() < Date.now() + 60000 ||
          scheduled.getTime() > Date.now() + 90 * 86400000)
      )
        throw new Error(
          "Choose a send time between one minute and 90 days ahead.",
        );
      const expiry = fields.visibilityExpiresAt
        ? new Date(fields.visibilityExpiresAt)
        : null;
      if (
        expiry &&
        (!Number.isFinite(expiry.getTime()) || expiry.getTime() <= Date.now())
      )
        throw new Error("Visible-until time must be in the future.");
      if (scheduled && expiry && expiry <= scheduled)
        throw new Error("Visible-until time must be after the scheduled time.");
      const targeting = audiencePayload();
      const payload = {
        ...targeting,
        title,
        body,
        categoryCode: fields.categoryCode,
        visibilityPolicy: "OPERATIONAL",
        ...(scheduled ? { scheduledFor: scheduled.toISOString() } : {}),
        ...(expiry ? { visibilityExpiresAt: expiry.toISOString() } : {}),
      };
      const result = await request<Preview>("/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(targeting),
      });
      reviewed.current = payload;
      setPreview(result);
      key.current ??= crypto.randomUUID();
    } catch (cause) {
      setDialogError(
        cause instanceof Error
          ? cause.message
          : "Unable to preview recipients.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function send() {
    if (!preview || !key.current || !reviewed.current) return;
    setBusy(true);
    setDialogError("");
    try {
      const result = await request<Broadcast>("", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": key.current,
        },
        body: JSON.stringify(reviewed.current),
      });
      setNotice(
        result.scheduledFor
          ? `Notification scheduled for ${new Date(result.scheduledFor).toLocaleString()} for ${result.totalUsers} users.`
          : `Notification queued for ${result.totalUsers} users. Each user can find it in their app inbox.`,
      );
      setCompose(false);
      resetPreview();
      setPrevious([]);
      if (cursor) setCursor(null);
      else void load();
    } catch (cause) {
      setDialogError(
        cause instanceof Error
          ? cause.message
          : "Unable to send. Retry uses the same request key.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function openDetails(id: string) {
    setBusy(true);
    setError("");
    setWithdrawConfirm(false);
    try {
      setDetails(await request<Broadcast>(`/${id}`));
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Unable to load notification details.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function withdraw() {
    if (!details) return;
    setBusy(true);
    setError("");
    try {
      await request(`/${details.id}/withdraw`, { method: "POST" });
      setDetails(await request<Broadcast>(`/${details.id}`));
      setWithdrawConfirm(false);
      setNotice(
        "Notification withdrawn. It is hidden from inboxes; pushes already sent cannot be recalled.",
      );
      void load(true);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Unable to withdraw notification.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <section className="client-page-intro notification-header">
        <div>
          <p className="muted">
            Send a message to your users and track push acceptance and inbox
            reads.
          </p>
        </div>
        <div className="form-actions">
          <button
            className="secondary"
            disabled={loading}
            onClick={() => void load()}
          >
            Refresh
          </button>
          {canManageTopics && (
            <button
              className="secondary"
              disabled={busy}
              onClick={() => void openTopics()}
            >
              Notification groups
            </button>
          )}
          <button disabled={busy} onClick={() => void openCompose()}>
            + Send notification
          </button>
        </div>
      </section>
      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <section className="client-operational-list" aria-label="Sending history">
        <p className="muted">
          Firebase acceptance confirms submission to Firebase. App inbox reads
          are tracked separately.
        </p>
        <ClientDataTable
          rows={rows}
          loading={loading}
          resultCountSuffix="on this page"
          pagination={false}
          searchable={false}
          sortable={false}
          filterable={false}
          getRowId={(row) => row.id}
          emptyMessage="No notifications have been sent yet."
          columns={[
            {
              key: "created",
              label: "Created",
              value: (row) => row.createdAt,
              render: (row) => new Date(row.createdAt).toLocaleString(),
            },
            {
              key: "title",
              label: "Title",
              value: (row) => row.title,
            },
            {
              key: "audience",
              label: "Audience",
              value: (row) => audiences[row.audience] ?? row.source,
            },
            {
              key: "status",
              label: "Status",
              value: (row) =>
                row.withdrawnAt ? "Withdrawn" : statusLabel(row.status),
              render: (row) => (
                <span className={`status status-${row.status.toLowerCase()}`}>
                  {row.withdrawnAt ? "Withdrawn" : statusLabel(row.status)}
                </span>
              ),
            },
            { key: "users", label: "Users", value: (row) => row.totalUsers },
            {
              key: "accepted",
              label: "Accepted devices",
              value: (row) => row.deliveryCounts.ACCEPTED ?? 0,
            },
            { key: "pending", label: "Pending devices", value: pending },
            {
              key: "failed",
              label: "Failed devices",
              value: (row) => row.deliveryCounts.FAILED ?? 0,
            },
          ]}
          actions={(row) => (
            <button
              type="button"
              className="secondary table-action"
              disabled={busy}
              onClick={() => void openDetails(row.id)}
            >
              View
            </button>
          )}
        />
        <p className="muted">
          Showing {rows.length} notifications on this page, newest first.
        </p>
        <div
          className="sa-pagination"
          aria-label="Notification history pagination"
        >
          <span>Page {previous.length + 1}</span>
          <div>
            <button
              className="secondary"
              disabled={!previous.length || loading}
              onClick={() => {
                setCursor(previous.at(-1) ?? null);
                setPrevious(previous.slice(0, -1));
              }}
            >
              Previous
            </button>
            <button
              className="secondary"
              disabled={!next || loading}
              onClick={() => {
                setPrevious([...previous, cursor]);
                setCursor(next);
              }}
            >
              Next
            </button>
          </div>
        </div>
      </section>
      {topicsOpen && options && (
        <ClientNotificationTopics
          options={options}
          onClose={() => setTopicsOpen(false)}
        />
      )}
      {compose && options && (
        <ClientFormDialog
          title="Send notification"
          busy={busy}
          error={dialogError}
          onClose={() => setCompose(false)}
          wide
          heading={<>Send notification</>}
        >
          <form
            className="form-stack"
            onSubmit={(event) => {
              if (preview) {
                event.preventDefault();
                void send();
              } else void review(event);
            }}
          >
            <NotificationComposerFields
              options={options}
              value={fields}
              disabled={busy || Boolean(preview)}
              onChange={(value) => {
                if (value.application !== fields.application)
                  setAudience(
                    value.application === "RIDER"
                      ? "ALL_RIDERS"
                      : value.application === "FLEET_MANAGER"
                        ? "ALL_FLEET_MANAGERS"
                        : value.application === "TEAM_LEADER"
                          ? "ALL_TEAM_LEADERS"
                          : "ALL_EMPLOYEES",
                  );
                setFields(value);
                resetPreview();
              }}
            />
            <label>
              Audience
              <select
                value={audience}
                disabled={busy || Boolean(preview)}
                onChange={(event) => {
                  setAudience(event.target.value as Audience);
                  resetPreview();
                }}
              >
                {Object.entries(audiences)
                  .filter(([value]) => value !== "USER_IDS")
                  .map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
              </select>
            </label>
            {audience === "PHONE_NUMBERS" && (
              <label>
                Comma-separated phone numbers
                <textarea
                  required
                  maxLength={50000}
                  rows={3}
                  value={phones}
                  readOnly={Boolean(preview)}
                  disabled={busy}
                  placeholder="9876543210, +919876543211"
                  onChange={(event) => {
                    setPhones(event.target.value);
                    resetPreview();
                  }}
                />
                <span className="muted">
                  Up to 2,000 entries. Only active users in your client can
                  receive messages.
                </span>
              </label>
            )}
            <label>
              Message title
              <input
                required
                maxLength={150}
                value={title}
                readOnly={Boolean(preview)}
                disabled={busy}
                onChange={(event) => {
                  setTitle(event.target.value);
                  resetPreview();
                }}
              />
            </label>
            <label>
              Message body
              <textarea
                required
                maxLength={2000}
                rows={5}
                value={body}
                readOnly={Boolean(preview)}
                disabled={busy}
                onChange={(event) => {
                  setBody(event.target.value);
                  resetPreview();
                }}
              />
            </label>
            <p className={contentBytes > 3500 ? "error" : "muted"}>
              {contentBytes.toLocaleString()} / 3,500 content bytes ·{" "}
              {title.length}/150 title characters · {body.length}/2,000 body
              characters
            </p>
            {canManageTopics && fields.application !== "ADMIN" && (
              <NotificationTestSend
                key={fields.application}
                application={fields.application}
                categoryCode={fields.categoryCode}
                title={title}
                body={body}
                disabled={busy}
                onBusy={setBusy}
              />
            )}
            {preview && (
              <section className="notification-preview">
                <h3>Review recipients</h3>
                <div className="notification-metrics">
                  <span>
                    <strong>{preview.users}</strong> matched users
                  </span>
                  <span>
                    <strong>{preview.devices}</strong> registered devices
                  </span>
                  <span>
                    <strong>{preview.usersWithoutDevices}</strong> inbox only
                  </span>
                </div>
                {!preview.pushConfigured && (
                  <p className="notice">
                    Firebase setup is incomplete for this client. Users will
                    receive inbox entries; push delivery will wait for Firebase
                    setup until the push expires.
                  </p>
                )}
                {preview.invalidPhoneNumbers.length > 0 && (
                  <p className="error">
                    Invalid numbers: {preview.invalidPhoneNumbers.join(", ")}
                  </p>
                )}
                {preview.unmatchedPhoneNumbers.length > 0 && (
                  <p className="error">
                    No active client user found for:{" "}
                    {preview.unmatchedPhoneNumbers.join(", ")}
                  </p>
                )}
                {preview.duplicatePhoneNumbers.length > 0 && (
                  <p className="muted">
                    Duplicates removed:{" "}
                    {preview.duplicatePhoneNumbers.join(", ")}
                  </p>
                )}
                {!preview.users && (
                  <p className="error">No active users match this audience.</p>
                )}
                <p className="muted">
                  These are audience counts, not guaranteed push deliveries.
                  Consent, preferences and current access are checked before
                  dispatch. Recipient counts are checked again when you send.
                  The recipient list is then saved for this notification.
                </p>
              </section>
            )}
            <div className="form-actions">
              {preview ? (
                <>
                  <button
                    type="submit"
                    disabled={
                      busy ||
                      !preview.users ||
                      contentBytes > 3500 ||
                      !!preview.invalidPhoneNumbers.length ||
                      !!preview.unmatchedPhoneNumbers.length
                    }
                  >
                    {busy
                      ? "Queuing…"
                      : `${fields.scheduledFor ? "Schedule for" : "Send to"} ${preview.users} users`}
                  </button>
                  <button
                    className="secondary"
                    type="button"
                    disabled={busy}
                    onClick={resetPreview}
                  >
                    Edit message
                  </button>
                </>
              ) : (
                <button
                  type="submit"
                  disabled={
                    busy ||
                    contentBytes > 3500 ||
                    !title.trim() ||
                    !body.trim() ||
                    !fields.categoryCode
                  }
                >
                  {busy ? "Checking recipients…" : "Preview recipients"}
                </button>
              )}
              <button
                className="secondary"
                type="button"
                disabled={busy}
                onClick={() => setCompose(false)}
              >
                Cancel
              </button>
            </div>
          </form>
        </ClientFormDialog>
      )}
      {details && (
        <ClientFormDialog
          title="Notification details"
          error={error}
          busy={busy}
          onClose={() => setDetails(null)}
          wide
          heading={<>{details.title}</>}
        >
          <div className="form-stack">
            <p className="eyebrow">
              {audiences[details.audience] ?? details.source}
            </p>

            <p className="notification-body">{details.body}</p>
            {details.categoryCode && (
              <p>
                Category: {details.category?.name ?? "Uncategorized"} ·
                Application:{" "}
                {(
                  {
                    RIDER: "Rider App",
                    FLEET_MANAGER: "Fleet Manager App",
                    TEAM_LEADER: "Team Leader App",
                    ADMIN: "Admin",
                  } as Record<string, string>
                )[details.application ?? ""] ?? "All applications"}
              </p>
            )}
            {details.visibilityExpiresAt && (
              <p>
                Visible until:{" "}
                {new Date(details.visibilityExpiresAt).toLocaleString()}
              </p>
            )}
            {details.scheduledFor && (
              <p>
                Scheduled for {new Date(details.scheduledFor).toLocaleString()}.
                Withdraw to cancel unsent delivery.
              </p>
            )}
            {details.withdrawnAt && (
              <p className="notice">
                Withdrawn {new Date(details.withdrawnAt).toLocaleString()}
              </p>
            )}
            {withdrawConfirm && (
              <section className="notice">
                <p>
                  Withdraw this notification? It will be hidden from recipients.
                  This cannot be undone; pushes already sent cannot be recalled.
                </p>
                <button disabled={busy} onClick={() => void withdraw()}>
                  Confirm withdrawal
                </button>
                <button
                  className="secondary"
                  disabled={busy}
                  onClick={() => setWithdrawConfirm(false)}
                >
                  Cancel
                </button>
              </section>
            )}

            <p className="muted">
              {new Date(details.createdAt).toLocaleString()} ·{" "}
              {details.sender?.name ?? "System"} · {statusLabel(details.status)}
            </p>
            <div className="notification-metrics">
              <span>
                <strong>{details.totalUsers}</strong> inbox recipients
              </span>
              <span>
                <strong>{details.usersAcceptedByFirebase}</strong> users
                accepted by Firebase
              </span>
              <span>
                <strong>{details.deliveryCounts.ACCEPTED ?? 0}</strong> accepted
                devices
              </span>
              <span>
                <strong>{pending(details)}</strong> pending devices
              </span>
              <span>
                <strong>{details.deliveryCounts.FAILED ?? 0}</strong> failed
                devices
              </span>
              <span>
                <strong>{details.deliveryCounts.SKIPPED ?? 0}</strong> skipped
                devices
              </span>
              <span>
                <strong>{details.usersWithoutDevices}</strong> users without
                active devices
              </span>
              <span>
                <strong>{details.readUsers}</strong> inbox reads
              </span>
            </div>
            {!!details.audiencePhones.length && (
              <p>Phone numbers: {details.audiencePhones.join(", ")}</p>
            )}
            {!!details.failures?.length && (
              <>
                <h3>Recent failed, retrying or skipped attempts</h3>
                <ClientDataTable
                  rows={details.failures}
                  getRowId={(failure) => failure.id}
                  emptyMessage="No unsuccessful attempts."
                  columns={[
                    {
                      key: "user",
                      label: "User",
                      value: (failure) => failure.userNotification.user.name,
                    },
                    {
                      key: "mobile",
                      label: "Mobile",
                      value: (failure) => failure.userNotification.user.mobile,
                    },
                    {
                      key: "status",
                      label: "Status",
                      value: (failure) => failure.status.replaceAll("_", " "),
                      render: (failure) => (
                        <span
                          className={`status status-${failure.status.toLowerCase()}`}
                        >
                          {failure.status.replaceAll("_", " ")}
                        </span>
                      ),
                    },
                    {
                      key: "attempts",
                      label: "Attempts",
                      value: (failure) => failure.attempts,
                    },
                    {
                      key: "reason",
                      label: "Reason",
                      value: (failure) => failure.errorCode,
                    },
                  ]}
                />
                <p className="muted">
                  Showing up to 100 recent unsuccessful attempts.
                </p>
              </>
            )}
            <div className="form-actions">
              <button
                className="secondary"
                disabled={busy}
                onClick={() => void openDetails(details.id)}
              >
                Refresh details
              </button>
              {!details.withdrawnAt &&
                (details.source === "MANUAL" || canManageTopics) && (
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={() => setWithdrawConfirm(true)}
                  >
                    Withdraw notification
                  </button>
                )}
              <button onClick={() => setDetails(null)} disabled={busy}>
                Close
              </button>
            </div>
          </div>
        </ClientFormDialog>
      )}
    </>
  );
}
