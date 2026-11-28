"use client";
import { useEffect, useRef, useState } from "react";
import type { ComposerOptions } from "./notification-composer-fields";
import { sessionFetch } from "../../lib/session-fetch";
import { ClientDataTable } from "./client-data-table";
import { ClientFormDialog } from "./client-form-dialog";
type Topic = {
  id: string;
  bindingId: string;
  binding?: { appCode: string; platform: string; applicationId: string };
  logicalKey: string;
  isActive: boolean;
};
async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await sessionFetch(
    `/api/v1/client/notification-topics${path}`,
    options,
  );
  const body = await response.json();
  if (!response.ok)
    throw new Error(
      body.error?.message ?? "Unable to manage notification groups.",
    );
  return body.data;
}
export function ClientNotificationTopics({
  onClose,
  options,
}: {
  onClose: () => void;
  options: ComposerOptions;
}) {
  const [rows, setRows] = useState<Topic[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirm, setConfirm] = useState<Topic | null>(null);
  const alive = useRef(true);
  async function load(after?: string) {
    setBusy(true);
    setError("");
    try {
      const result = await request<{
        items: Topic[];
        nextCursor: string | null;
      }>(after ? `?after=${encodeURIComponent(after)}` : "");
      if (alive.current) {
        setRows((old) => (after ? [...old, ...result.items] : result.items));
        setNext(result.nextCursor);
      }
    } catch (cause) {
      if (alive.current)
        setError(
          cause instanceof Error ? cause.message : "Unable to load groups.",
        );
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  useEffect(() => {
    alive.current = true;
    const timer = setTimeout(() => {
      void load();
    }, 0);
    return () => {
      alive.current = false;
      clearTimeout(timer);
    };
  }, []);
  async function toggle() {
    if (!confirm) return;
    setBusy(true);
    setError("");
    try {
      await request(`/${confirm.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !confirm.isActive }),
      });
      setRows((old) =>
        old.map((t) =>
          t.id === confirm.id ? { ...t, isActive: !confirm.isActive } : t,
        ),
      );
      setConfirm(null);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Unable to update group.",
      );
    } finally {
      setBusy(false);
    }
  }
  function label(key: string) {
    const fixed: Record<string, string> = {
      all_users: "All users",
      all_employees: "All employees",
      all_riders: "All riders",
      all_fleet_managers: "All fleet managers",
      all_team_leaders: "All team leaders",
    };
    if (fixed[key]) return fixed[key];
    if (key.startsWith("category_"))
      return (
        options.groups
          .flatMap((g) => g.categories)
          .find((c) => c.code === key.slice(9))?.name ?? key
      );
    for (const [prefix, choices] of [
      ["all_hub_", options.hubs],
      ["all_vehicle_type_", options.vehicleTypes],
      ["all_oem_", options.oems],
    ] as const) {
      if (key.startsWith(prefix) && key.endsWith("_riders")) {
        const name = choices.find(
          (c) => c.id === key.slice(prefix.length, -7),
        )?.name;
        return name ? `${name} riders` : key;
      }
    }
    if (key.startsWith("all_city_") && key.endsWith("_riders"))
      return `${key.slice(9, -7)} riders`;
    return key;
  }
  return (
    <ClientFormDialog
      title="Notification groups"
      busy={busy}
      error={error}
      onClose={onClose}
      wide
    >
      <p className="muted">
        Membership is managed automatically. Changes take effect as devices
        synchronize; this screen does not send notifications.
      </p>
      <ClientDataTable
        rows={rows}
        getRowId={(r) => r.id}
        loading={busy}
        emptyMessage="Groups appear after eligible devices register."
        columns={[
          { key: "group", label: "Group", value: (r) => label(r.logicalKey) },
          {
            key: "application",
            label: "Application",
            value: (r) =>
              r.binding
                ? [
                    r.binding.appCode.replaceAll("_", " "),
                    r.binding.platform,
                    r.binding.applicationId,
                  ].join(" · ")
                : "Unknown application",
          },
          {
            key: "active",
            label: "Status",
            value: (r) => (r.isActive ? "Active" : "Inactive"),
          },
        ]}
        actions={(row) => (
          <button
            type="button"
            className="secondary table-action"
            disabled={busy}
            onClick={() => setConfirm(row)}
          >
            {row.isActive ? "Deactivate" : "Activate"}
          </button>
        )}
      />
      {confirm && (
        <section className="notice" aria-label="Confirm group change">
          <p>
            {confirm.isActive ? "Deactivate" : "Activate"}{" "}
            {label(confirm.logicalKey)}?{" "}
            {confirm.isActive
              ? "Eligible devices will leave this group."
              : "Eligible devices will join this group again."}
          </p>
          <div className="form-actions">
            <button disabled={busy} onClick={() => void toggle()}>
              Confirm
            </button>
            <button
              className="secondary"
              disabled={busy}
              onClick={() => setConfirm(null)}
            >
              Cancel
            </button>
          </div>
        </section>
      )}
      <div className="form-actions">
        <button
          className="secondary"
          disabled={busy}
          onClick={() => void load()}
        >
          Refresh
        </button>
        {next && (
          <button disabled={busy} onClick={() => void load(next)}>
            Load more
          </button>
        )}
        <button disabled={busy} onClick={onClose}>
          Close
        </button>
      </div>
    </ClientFormDialog>
  );
}
