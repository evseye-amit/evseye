"use client";
import { useCallback, useEffect, useState } from "react";
import { sessionFetch } from "../../lib/session-fetch";
import { ClientFormDialog } from "./client-form-dialog";
import { ClientDataTable } from "./client-data-table";
const applications: Record<string, string> = {
  RIDER: "Rider App",
  FLEET_MANAGER: "Fleet Manager App",
  TEAM_LEADER: "Team Leader App",
  ADMIN: "Admin",
};
type Category = {
  code: string;
  parentCode: string;
  name: string;
  description: string;
  isActive: boolean;
  defaultPriority: string;
  defaultDelivery: string;
  updatedAt: string;
  applications: Array<{ application: string; allowed: boolean }>;
};
type Group = {
  code: string;
  name: string;
  isActive: boolean;
  updatedAt: string;
  categories: Category[];
};
type Draft = {
  creating: boolean;
  code: string;
  parentCode: string;
  name: string;
  description: string;
  isActive: boolean;
  applications: string[];
  expectedUpdatedAt?: string;
};
async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await sessionFetch(
    `/api/v1/platform/notifications/catalog${path}`,
    options,
  );
  const body = await response.json();
  if (!response.ok)
    throw new Error(
      body.error?.message ?? "Unable to update notification catalog.",
    );
  return body.data;
}
export function PlatformNotificationCatalog({
  refreshKey = 0,
}: {
  refreshKey?: number;
}) {
  const [groups, setGroups] = useState<Group[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [groupChange, setGroupChange] = useState<Group | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [filter, setFilter] = useState("");
  const load = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      const data = await request<{ groups: Group[] }>("");
      setGroups(data.groups);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Unable to load catalog.",
      );
    } finally {
      setBusy(false);
    }
  }, []);
  useEffect(() => {
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [load, refreshKey]);
  function edit(category: Category) {
    setError("");
    setConfirmed(false);
    setDraft({
      creating: false,
      code: category.code,
      parentCode: category.parentCode,
      name: category.name,
      description: category.description,
      isActive: category.isActive,
      applications: category.applications
        .filter((a) => a.allowed)
        .map((a) => a.application),
      expectedUpdatedAt: category.updatedAt,
    });
  }
  async function save() {
    if (!draft || !confirmed) return;
    setBusy(true);
    setError("");
    const { creating, code, parentCode, ...fields } = draft;
    try {
      await request(
        creating ? "/categories" : `/categories/${encodeURIComponent(code)}`,
        {
          method: creating ? "POST" : "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...fields,
            ...(creating ? { code, parentCode } : {}),
          }),
        },
      );
      setDraft(null);
      setNotice("Notification catalog saved for all clients.");
      await load();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Unable to save category.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function toggleGroup() {
    if (!groupChange || !confirmed) return;
    setBusy(true);
    setError("");
    try {
      await request(`/groups/${groupChange.code}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          isActive: !groupChange.isActive,
          expectedUpdatedAt: groupChange.updatedAt,
        }),
      });
      setGroupChange(null);
      setNotice("Group availability updated for all clients.");
      await load();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Unable to update group.",
      );
    } finally {
      setBusy(false);
    }
  }
  const categories = groups
    .filter((g) => !filter || g.code === filter)
    .flatMap((g) =>
      g.categories.map((c) => ({
        ...c,
        groupName: g.name,
        groupActive: g.isActive,
      })),
    );
  return (
    <section className="form-stack">
      <p className="notice">
        This catalog is shared by every client. Changes affect new sends and
        automatic subscriptions. Existing inbox history is retained; already
        queued pushes may still be delivered.
      </p>
      {error && !draft && !groupChange && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="notice">
          {notice}
        </p>
      )}
      <div className="form-actions">
        <button
          disabled={busy}
          className="secondary"
          onClick={() => void load()}
        >
          Refresh catalog
        </button>
        <button
          disabled={busy || !groups.length}
          onClick={() => {
            setError("");
            setConfirmed(false);
            setDraft({
              creating: true,
              code: "",
              parentCode: filter || groups[0].code,
              name: "",
              description: "",
              isActive: true,
              applications: [],
            });
          }}
        >
          Add category
        </button>
      </div>
      <label>
        Parent group
        <select value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="">All groups</option>
          {groups.map((g) => (
            <option key={g.code} value={g.code}>
              {g.name}
              {g.isActive ? "" : " (inactive)"}
            </option>
          ))}
        </select>
      </label>
      {filter && (
        <div className="form-actions">
          <button
            disabled={busy}
            className="secondary"
            onClick={() => {
              setError("");
              setConfirmed(false);
              setGroupChange(groups.find((g) => g.code === filter)!);
            }}
          >
            {groups.find((g) => g.code === filter)?.isActive
              ? "Deactivate"
              : "Activate"}{" "}
            parent group
          </button>
        </div>
      )}
      <ClientDataTable
        rows={categories}
        getRowId={(c) => c.code}
        loading={busy}
        emptyMessage="No categories match this group."
        columns={[
          { key: "name", label: "Category", value: (c) => c.name },
          { key: "group", label: "Parent group", value: (c) => c.groupName },
          {
            key: "apps",
            label: "Applications",
            value: (c) =>
              c.applications
                .filter((a) => a.allowed)
                .map((a) => applications[a.application] ?? a.application)
                .join(", ") || "None",
          },
          {
            key: "status",
            label: "Availability",
            value: (c) =>
              !c.groupActive
                ? "Parent inactive"
                : !c.isActive
                  ? "Inactive"
                  : !c.applications.some((a) => a.allowed)
                    ? "No applications"
                    : "Active",
          },
        ]}
        actions={(c) => (
          <button
            disabled={busy}
            className="secondary table-action"
            onClick={() => edit(c)}
          >
            Edit
          </button>
        )}
      />
      {draft && (
        <ClientFormDialog
          title={
            draft.creating
              ? "Add notification category"
              : "Edit notification category"
          }
          busy={busy}
          error={error}
          onClose={() => setDraft(null)}
          wide
        >
          <form
            className="form-stack"
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            <fieldset disabled={busy} className="form-stack">
              <legend>Category details</legend>
              {draft.creating ? (
                <>
                  <label>
                    Parent group
                    <select
                      value={draft.parentCode}
                      onChange={(e) => {
                        setConfirmed(false);
                        setDraft({
                          ...draft,
                          parentCode: e.target.value,
                          code: "",
                        });
                      }}
                    >
                      {groups.map((g) => (
                        <option key={g.code} value={g.code}>
                          {g.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Stable category code
                    <input
                      required
                      maxLength={100}
                      pattern={`${draft.parentCode}_[A-Z0-9_]+`}
                      placeholder={`${draft.parentCode}_CUSTOM_NOTICE`}
                      value={draft.code}
                      onChange={(e) => {
                        setConfirmed(false);
                        setDraft({
                          ...draft,
                          code: e.target.value.toUpperCase(),
                        });
                      }}
                    />
                    <span className="muted">
                      Must start with {draft.parentCode}_. The code and parent
                      cannot change after creation.
                    </span>
                  </label>
                </>
              ) : (
                <p className="muted">
                  {draft.code} ·{" "}
                  {groups.find((g) => g.code === draft.parentCode)?.name}.
                  Stable identity and delivery policy are preserved.
                </p>
              )}
              <label>
                Name
                <input
                  required
                  maxLength={150}
                  value={draft.name}
                  onChange={(e) => {
                    setConfirmed(false);
                    setDraft({ ...draft, name: e.target.value });
                  }}
                />
              </label>
              <label>
                Description
                <textarea
                  maxLength={1000}
                  rows={3}
                  value={draft.description}
                  onChange={(e) => {
                    setConfirmed(false);
                    setDraft({ ...draft, description: e.target.value });
                  }}
                />
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={draft.isActive}
                  onChange={(e) => {
                    setConfirmed(false);
                    setDraft({ ...draft, isActive: e.target.checked });
                  }}
                />{" "}
                Category active
              </label>
              <fieldset>
                <legend>Applicable applications</legend>
                {Object.entries(applications).map(([code, label]) => (
                  <label key={code}>
                    <input
                      type="checkbox"
                      checked={draft.applications.includes(code)}
                      onChange={(e) => {
                        setConfirmed(false);
                        setDraft({
                          ...draft,
                          applications: e.target.checked
                            ? [...draft.applications, code]
                            : draft.applications.filter((a) => a !== code),
                        });
                      }}
                    />
                    {label}
                  </label>
                ))}
              </fieldset>
            </fieldset>
            <p className="muted">
              Application mapping allows targeting; it does not grant roles or
              marketing consent. No selection disables this category for new
              sends in every application.
            </p>
            <label>
              <input
                type="checkbox"
                checked={confirmed}
                disabled={busy}
                onChange={(e) => setConfirmed(e.target.checked)}
              />{" "}
              I understand this change applies to all clients.
            </label>
            <div className="form-actions">
              <button
                disabled={busy || !confirmed || !draft.name.trim()}
                type="submit"
              >
                Save category
              </button>
              {error && (
                <button
                  type="button"
                  className="secondary"
                  disabled={busy}
                  onClick={() => {
                    setDraft(null);
                    void load();
                  }}
                >
                  Discard edits and reload
                </button>
              )}
              <button
                type="button"
                className="secondary"
                disabled={busy}
                onClick={() => setDraft(null)}
              >
                Cancel
              </button>
            </div>
          </form>
        </ClientFormDialog>
      )}
      {groupChange && (
        <ClientFormDialog
          title="Change parent group availability"
          busy={busy}
          error={error}
          onClose={() => setGroupChange(null)}
        >
          <p>
            {groupChange.isActive ? "Deactivate" : "Activate"}{" "}
            {groupChange.name} for all clients? This affects every category
            under the group. Individual category settings will be retained.
          </p>
          <label>
            <input
              type="checkbox"
              checked={confirmed}
              disabled={busy}
              onChange={(e) => setConfirmed(e.target.checked)}
            />{" "}
            I understand this change applies to all clients.
          </label>
          <div className="form-actions">
            <button
              disabled={busy || !confirmed}
              onClick={() => void toggleGroup()}
            >
              Confirm group change
            </button>
            <button
              className="secondary"
              disabled={busy}
              onClick={() => setGroupChange(null)}
            >
              Cancel
            </button>
          </div>
        </ClientFormDialog>
      )}
    </section>
  );
}
