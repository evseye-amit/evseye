"use client";

import { useEffect, useRef, useState } from "react";
import { sessionFetch } from "../../lib/session-fetch";
import { markFormsSaved } from "./unsaved-changes";
import { ClientFormDialog } from "./client-form-dialog";

type Release = { version: string; build: string };
type Identity = {
  appCode: "RIDER_APP" | "FLEET_MANAGER_APP";
  platform: "ANDROID" | "IOS";
  applicationId: string;
  channel: "PRODUCTION" | "TEST";
};
type Settings = {
  enabled: boolean;
  minimum: Release;
  latest: Release;
  storeUrl: string;
  title: string;
  message: string;
  releaseNotes: string;
};
type History = {
  revision: number;
  action: string;
  snapshot: Settings;
  actorName: string;
  createdAt: string;
};
type Policy = Identity & {
  id: string;
  revision: number;
  publishedRevision: number | null;
  publishedAt: string | null;
  draft: Settings | null;
  published: Settings | null;
  history: History[];
};
type Decision = { decision: "allowed" | "optional_update" | "required_update" };
const initialIdentity: Identity = {
  appCode: "RIDER_APP",
  platform: "ANDROID",
  applicationId: "",
  channel: "PRODUCTION",
};
const initialSettings: Settings = {
  enabled: false,
  minimum: { version: "1.0.0", build: "1" },
  latest: { version: "1.0.0", build: "1" },
  storeUrl: "",
  title: "Update available",
  message: "Please update your app to continue.",
  releaseNotes: "",
};
const releaseLabel = (release: Release) =>
  `${release.version} (build ${release.build})`;
const identityLabel = (identity: Identity) =>
  `${identity.appCode === "RIDER_APP" ? "Rider" : "Fleet Manager"} · ${identity.platform} · ${identity.channel} · ${identity.applicationId}`;
const decisions = {
  allowed: "Allowed — the app can continue",
  optional_update: "Optional update — the user can dismiss the prompt",
  required_update: "Mandatory update — the app must block access",
};

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await sessionFetch(path, init);
  const payload = await response.json();
  if (!response.ok)
    throw new Error(
      payload.error?.message ||
        "The request failed. Reload before retrying an uncertain result.",
    );
  return payload.data as T;
}

export function ClientAppUpdateSettings({
  clientId,
  clientName,
}: {
  clientId: string;
  clientName: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        App Updates
      </button>
      {open && (
        <UpdateDialog
          key={clientId}
          clientId={clientId}
          clientName={clientName}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function UpdateDialog({
  clientId,
  clientName,
  onClose,
}: {
  clientId: string;
  clientName: string;
  onClose: () => void;
}) {
  const base = `/api/v1/platform/clients/${clientId}/app-updates`;
  const [rows, setRows] = useState<Policy[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [identity, setIdentity] = useState<Identity>(initialIdentity);
  const [settings, setSettings] = useState<Settings>(initialSettings);
  const [installed, setInstalled] = useState<Release>({
    version: "1.0.0",
    build: "1",
  });
  const [preview, setPreview] = useState<Decision | null>(null);
  const [busy, setBusy] = useState(true),
    [loaded, setLoaded] = useState(false),
    [dirty, setDirty] = useState(false);
  const [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [review, setReview] = useState(false),
    [releaseAvailable, setReleaseAvailable] = useState(false);
  const inFlight = useRef(false);
  const current = rows.find((row) => row.id === selectedId);

  function select(row?: Policy) {
    setSelectedId(row?.id ?? "");
    setIdentity(
      row
        ? {
            appCode: row.appCode,
            platform: row.platform,
            channel: row.channel,
            applicationId: row.applicationId,
          }
        : initialIdentity,
    );
    setSettings(row?.draft ?? row?.published ?? initialSettings);
    setDirty(false);
    setReview(false);
    setReleaseAvailable(false);
    setPreview(null);
  }
  useEffect(() => {
    const controller = new AbortController();
    void api<Policy[]>(base, { signal: controller.signal })
      .then((data) => {
        if (controller.signal.aborted) return;
        setRows(data);
        select(data[0]);
        setLoaded(true);
      })
      .catch((cause) => {
        if (!controller.signal.aborted)
          setError(
            cause instanceof Error
              ? cause.message
              : "Could not load update policies.",
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) setBusy(false);
      });
    return () => controller.abort();
  }, [base]);

  useEffect(() => {
    if (!dirty && loaded && !busy) {
      const frame = requestAnimationFrame(markFormsSaved);
      return () => cancelAnimationFrame(frame);
    }
  }, [dirty, loaded, busy, selectedId]);

  function edited() {
    setDirty(true);
    setReview(false);
    setReleaseAvailable(false);
    setPreview(null);
    setNotice("");
  }
  function edit<K extends keyof Settings>(key: K, value: Settings[K]) {
    setSettings((previous) => ({ ...previous, [key]: value }));
    edited();
  }
  async function reload() {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    try {
      const data = await api<Policy[]>(base);
      setRows(data);
      select(data.find((row) => row.id === selectedId) ?? data[0]);
      setLoaded(true);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not load policies.",
      );
      setLoaded(false);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  async function mutate(
    path: string,
    body: object,
    success: string,
    method = "POST",
  ) {
    if (inFlight.current || !loaded) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const saved = await api<Policy>(`${base}/${path}`, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await api<Policy[]>(base);
      setRows(data);
      select(data.find((row) => row.id === saved.id));
      setLoaded(true);
      setNotice(success);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not save the policy.",
      );
      // A lost response may follow a committed write. Force a reload instead of replaying it.
      setLoaded(false);
      setReview(false);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  async function checkPreview() {
    if (inFlight.current || !loaded) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    setPreview(null);
    try {
      setPreview(
        await api<Decision>(`${base}/preview`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...identity, installed, settings }),
        }),
      );
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not preview the policy.",
      );
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return (
    <ClientFormDialog
      title={`App Updates — ${clientName}`}
      wide
      formsOnly
      surfaceClassName="app-update-settings"
      busy={busy}
      error={error}
      onClose={onClose}
    >
      <p>
        Control updates separately for each application, platform, package ID,
        and release channel. Draft changes do not affect users.
      </p>
      <p>
        Requires Flutter integration. Existing apps without update metadata
        remain compatible.
      </p>
      <label>
        Policy
        <select
          disabled={busy || !loaded || dirty}
          value={selectedId}
          onChange={(event) => {
            select(rows.find((row) => row.id === event.target.value));
            setNotice("");
          }}
        >
          <option value="">Create a new policy</option>
          {rows.map((row) => (
            <option key={row.id} value={row.id}>
              {identityLabel(row)}
            </option>
          ))}
        </select>
      </label>
      {dirty && (
        <p>
          Save or discard your edits before switching policies.{" "}
          <button type="button" disabled={busy} onClick={() => select(current)}>
            Discard local edits
          </button>
        </p>
      )}
      <button
        type="button"
        disabled={busy || (dirty && loaded)}
        onClick={() => void reload()}
      >
        Reload policies
      </button>
      {current && (
        <section aria-label="Published policy">
          <h3>Published policy</h3>
          <p>
            {current.published
              ? `${current.published.enabled ? "Enabled" : "Disabled"} · Published revision ${current.publishedRevision} · ${new Date(current.publishedAt!).toLocaleString()}`
              : "Not published. Users are allowed to continue."}
          </p>
          {current.published && (
            <p>
              Minimum: {releaseLabel(current.published.minimum)}. Latest:{" "}
              {releaseLabel(current.published.latest)}.
            </p>
          )}
          {current.published?.enabled && (
            <button
              type="button"
              disabled={busy || !loaded || dirty}
              onClick={() =>
                void mutate(
                  `${current.id}/disable`,
                  { expectedRevision: current.revision },
                  "Live policy disabled. Any saved draft is retained.",
                )
              }
            >
              Disable live policy now
            </button>
          )}
        </section>
      )}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void mutate(
            "draft",
            { ...identity, settings, expectedRevision: current?.revision ?? 0 },
            "Draft saved. Review and publish it to apply changes.",
            "PUT",
          );
        }}
      >
        <fieldset disabled={busy || !loaded}>
          <legend>{current?.draft ? "Saved draft" : "Edit policy"}</legend>
          <fieldset className="app-update-fields" disabled={Boolean(current)}>
            <legend>Application identity (fixed after creation)</legend>
            <label>
              Application
              <select
                value={identity.appCode}
                onChange={(event) => {
                  setIdentity({
                    ...identity,
                    appCode: event.target.value as Identity["appCode"],
                  });
                  edited();
                }}
              >
                <option value="RIDER_APP">Rider</option>
                <option value="FLEET_MANAGER_APP">Fleet Manager</option>
              </select>
            </label>
            <label>
              Platform
              <select
                value={identity.platform}
                onChange={(event) => {
                  setIdentity({
                    ...identity,
                    platform: event.target.value as Identity["platform"],
                  });
                  edited();
                }}
              >
                <option value="ANDROID">Android</option>
                <option value="IOS">iOS</option>
              </select>
            </label>
            <label>
              Package / bundle ID
              <input
                required
                maxLength={200}
                placeholder="com.company.rider"
                value={identity.applicationId}
                onChange={(event) => {
                  setIdentity({
                    ...identity,
                    applicationId: event.target.value.trim(),
                  });
                  edited();
                }}
              />
            </label>
            <label>
              Release channel
              <select
                value={identity.channel}
                onChange={(event) => {
                  setIdentity({
                    ...identity,
                    channel: event.target.value as Identity["channel"],
                  });
                  edited();
                }}
              >
                <option value="PRODUCTION">Production</option>
                <option value="TEST">Test</option>
              </select>
            </label>
          </fieldset>
          <label>
            <input
              type="checkbox"
              checked={settings.enabled}
              onChange={(event) => edit("enabled", event.target.checked)}
            />{" "}
            Enable update prompts and minimum-release enforcement when published
          </label>
          <p>
            {identity.platform === "ANDROID"
              ? "Android compares numeric build codes; version names are displayed to users."
              : "iOS compares numeric version components, then build components within that version."}
          </p>
          {(["minimum", "latest"] as const).map((key) => (
            <fieldset className="app-update-fields" key={key}>
              <legend>
                {key === "minimum"
                  ? "Minimum supported release"
                  : "Latest recommended release"}
              </legend>
              <label>
                Version
                <input
                  required
                  pattern="[0-9]+\.[0-9]+\.[0-9]+"
                  maxLength={29}
                  placeholder="1.2.0"
                  value={settings[key].version}
                  onChange={(event) =>
                    edit(key, { ...settings[key], version: event.target.value })
                  }
                />
              </label>
              <label>
                Build
                <input
                  required
                  maxLength={32}
                  placeholder={
                    identity.platform === "ANDROID" ? "120" : "120 or 120.1"
                  }
                  value={settings[key].build}
                  onChange={(event) =>
                    edit(key, { ...settings[key], build: event.target.value })
                  }
                />
              </label>
            </fieldset>
          ))}
          <label>
            Store URL
            <input
              type="url"
              required
              maxLength={2048}
              value={settings.storeUrl}
              placeholder={
                identity.platform === "ANDROID"
                  ? "https://play.google.com/store/apps/details?id=com.company.rider"
                  : "https://apps.apple.com/app/id123456789"
              }
              onChange={(event) => edit("storeUrl", event.target.value)}
            />
          </label>
          <label>
            Update title
            <input
              required
              maxLength={120}
              value={settings.title}
              onChange={(event) => edit("title", event.target.value)}
            />
          </label>
          <label>
            Update message
            <textarea
              required
              maxLength={2000}
              value={settings.message}
              onChange={(event) => edit("message", event.target.value)}
            />
          </label>
          <label>
            Release notes
            <textarea
              maxLength={5000}
              value={settings.releaseNotes}
              onChange={(event) => edit("releaseNotes", event.target.value)}
            />
          </label>
          <button type="submit" disabled={Boolean(current) && !dirty}>
            Save draft
          </button>
        </fieldset>
      </form>
      <fieldset className="app-update-fields" disabled={busy || !loaded}>
        <legend>Preview the current form</legend>
        <label>
          Installed version
          <input
            value={installed.version}
            onChange={(event) => {
              setInstalled({ ...installed, version: event.target.value });
              setPreview(null);
            }}
          />
        </label>
        <label>
          Installed build
          <input
            value={installed.build}
            onChange={(event) => {
              setInstalled({ ...installed, build: event.target.value });
              setPreview(null);
            }}
          />
        </label>
        <button type="button" onClick={() => void checkPreview()}>
          Check update behavior
        </button>
        {preview && <p role="status">{decisions[preview.decision]}</p>}
      </fieldset>
      {current?.draft && (
        <section aria-label="Publish update policy">
          <h3>Publish saved draft</h3>
          <button
            type="button"
            disabled={busy || !loaded || dirty}
            onClick={() => setReview(true)}
          >
            Review publication
          </button>
          {dirty && <p>Save your changes before reviewing publication.</p>}
          {review && (
            <>
              <p>
                <strong>{clientName}</strong> · {identityLabel(current)}
              </p>
              <p>
                {current.draft.enabled
                  ? `Builds below ${releaseLabel(current.draft.minimum)} will require an update. Older supported releases below ${releaseLabel(current.draft.latest)} will receive an optional update prompt.`
                  : "This publishes a disabled policy. No update prompts or restrictions will apply."}
              </p>
              <p>
                Update destination:{" "}
                <a
                  href={current.draft.storeUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open store listing
                </a>
              </p>
              {current.draft.enabled && (
                <label>
                  <input
                    type="checkbox"
                    disabled={busy}
                    checked={releaseAvailable}
                    onChange={(event) =>
                      setReleaseAvailable(event.target.checked)
                    }
                  />{" "}
                  I verified the target release is available to all affected
                  users, including their store region and rollout group.
                </label>
              )}
              <button
                type="button"
                disabled={
                  busy ||
                  !loaded ||
                  dirty ||
                  (current.draft.enabled && !releaseAvailable)
                }
                onClick={() =>
                  void mutate(
                    `${current.id}/publish`,
                    { expectedRevision: current.revision, releaseAvailable },
                    "Policy published. Integrated mobile apps will use it on their next check or protected request.",
                  )
                }
              >
                Confirm and publish
              </button>
            </>
          )}
        </section>
      )}
      {notice && <p role="status">{notice}</p>}
      <section aria-label="Policy history">
        <h3>Change history</h3>
        <p>
          Latest 50 changes. Restoring a revision creates a draft; publish it
          separately to make it live.
        </p>
        {current?.history.length ? (
          <ol>
            {current.history.map((item) => (
              <li key={item.revision}>
                <p>
                  Revision {item.revision} ·{" "}
                  {item.action.replaceAll("_", " ").toLowerCase()} ·{" "}
                  {item.actorName} · {new Date(item.createdAt).toLocaleString()}
                </p>
                <p>
                  {item.snapshot.enabled ? "Enabled" : "Disabled"} · Minimum{" "}
                  {releaseLabel(item.snapshot.minimum)} · Latest{" "}
                  {releaseLabel(item.snapshot.latest)}
                </p>
                <button
                  type="button"
                  disabled={busy || !loaded || dirty}
                  onClick={() =>
                    void mutate(
                      `${current.id}/restore`,
                      {
                        expectedRevision: current.revision,
                        sourceRevision: item.revision,
                      },
                      `Revision ${item.revision} restored to draft. Review and publish to apply it.`,
                    )
                  }
                >
                  Restore revision {item.revision} to draft
                </button>
              </li>
            ))}
          </ol>
        ) : (
          <p>No saved changes.</p>
        )}
      </section>
    </ClientFormDialog>
  );
}
