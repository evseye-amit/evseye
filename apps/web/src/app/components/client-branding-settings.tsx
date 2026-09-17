"use client";
import { sessionFetch as fetch } from "../../lib/session-fetch";
import { useEffect, useState, type FormEvent } from "react";
import { ClientFormDialog } from "./client-form-dialog";
import { useClientAppearance } from "./client-provider";
export function ClientBrandingSettings({ token }: { token: string }) {
  const { appearance, setAppearance } = useClientAppearance();
  const [authorized, setAuthorized] = useState(false);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState(appearance.branding);
  const [files, setFiles] = useState<{ logo?: File; favicon?: File }>({});
  useEffect(() => {
    const abort = new AbortController();
    void fetch("/api/v1/auth/me", {
      headers: { Authorization: `Bearer ${token}` },
      signal: abort.signal,
    })
      .then((response) => (response.ok ? response.json() : null))
      .then((body) =>
        setAuthorized(body?.data?.roles?.includes("CLIENT_ADMIN") ?? false),
      )
      .catch(() => {});
    return () => abort.abort();
  }, [token]);
  async function request(path: string, body: object, method = "POST") {
    const response = await fetch(`/api/v1/client/identity/${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    const payload = await response.json();
    if (!response.ok)
      throw new Error(payload.error?.message ?? "Unable to update branding.");
    return payload.data;
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      for (const kind of ["logo", "favicon"] as const) {
        const file = files[kind];
        if (!file) continue;
        if (
          !["image/png", "image/jpeg", "image/webp"].includes(file.type) ||
          file.size < 1 ||
          file.size > 2 * 1024 * 1024
        )
          throw new Error("Choose PNG, JPEG or WebP images up to 2 MB.");
        const intent = await request("branding/upload-intents", {
          kind,
          mimeType: file.type,
          sizeBytes: file.size,
        });
        const uploaded = await fetch(intent.uploadUrl, {
          method: "PUT",
          headers: { "Content-Type": file.type },
          body: file,
        });
        if (!uploaded.ok)
          throw new Error("Image upload failed. Please try again.");
        await request("branding/upload-complete", {
          kind,
          objectKey: intent.objectKey,
        });
      }
      const {
        primaryColor,
        secondaryColor,
        accentColor,
        loginTitle,
        loginSubtitle,
        supportEmail,
        supportPhone,
      } = draft;
      setAppearance(
        await request(
          "branding",
          {
            primaryColor,
            secondaryColor,
            accentColor,
            loginTitle,
            loginSubtitle,
            supportEmail: supportEmail || null,
            supportPhone: supportPhone || null,
          },
          "PATCH",
        ),
      );
      setOpen(false);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Unable to update branding.",
      );
    } finally {
      setBusy(false);
    }
  }
  if (!authorized) return null;
  return (
    <>
      <button
        className="secondary"
        type="button"
        onClick={() => {
          setDraft(appearance.branding);
          setFiles({});
          setError("");
          setOpen(true);
        }}
      >
        Branding settings
      </button>
      {open && (
        <ClientFormDialog
          title="Client branding"
          busy={busy}
          error={error}
          onClose={() => setOpen(false)}
        >
          <form className="form-stack client-branding-settings" onSubmit={save}>
            <h2>Client branding</h2>
            <p>
              Customize your client login and operations panel. Powered by EV
              Spares India Pvt Ltd remains visible.
            </p>
            {(["logo", "favicon"] as const).map((kind) => (
              <label key={kind}>
                {kind === "logo" ? "Company logo" : "Browser icon"}
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={(event) =>
                    setFiles((current) => ({
                      ...current,
                      [kind]: event.target.files?.[0],
                    }))
                  }
                />
                <small>PNG, JPEG or WebP, maximum 2 MB.</small>
              </label>
            ))}
            <div className="branding-colors">
              {(["primaryColor", "secondaryColor", "accentColor"] as const).map(
                (key) => (
                  <label key={key}>
                    {key.replace("Color", " color")}
                    <input
                      type="color"
                      value={draft[key]}
                      onChange={(event) =>
                        setDraft({ ...draft, [key]: event.target.value })
                      }
                    />
                  </label>
                ),
              )}
            </div>
            <label>
              Login title
              <input
                maxLength={100}
                value={draft.loginTitle}
                onChange={(event) =>
                  setDraft({ ...draft, loginTitle: event.target.value })
                }
              />
            </label>
            <label>
              Login subtitle
              <input
                maxLength={240}
                value={draft.loginSubtitle}
                onChange={(event) =>
                  setDraft({ ...draft, loginSubtitle: event.target.value })
                }
              />
            </label>
            <label>
              Support email
              <input
                type="email"
                maxLength={254}
                value={draft.supportEmail ?? ""}
                onChange={(event) =>
                  setDraft({ ...draft, supportEmail: event.target.value })
                }
              />
            </label>
            <label>
              Support phone
              <input
                type="tel"
                maxLength={30}
                value={draft.supportPhone ?? ""}
                onChange={(event) =>
                  setDraft({ ...draft, supportPhone: event.target.value })
                }
              />
            </label>
            <div className="form-actions">
              <button
                className="secondary"
                type="button"
                onClick={() => setOpen(false)}
                disabled={busy}
              >
                Cancel
              </button>
              <button disabled={busy}>
                {busy ? "Saving…" : "Save branding"}
              </button>
            </div>
          </form>
        </ClientFormDialog>
      )}
    </>
  );
}
