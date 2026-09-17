"use client";
import { sessionFetch as fetch } from "../../lib/session-fetch";
import { useState } from "react";
import { ClientFormDialog } from "./client-form-dialog";
type Domain = {
  id: string;
  hostname: string;
  type: string;
  isVerified: boolean;
  isPrimary: boolean;
  verificationToken: string;
};
export function ClientDomainSettings({
  clientId,
  clientName,
}: {
  clientId: string;
  clientName: string;
}) {
  const [open, setOpen] = useState(false);
  const [domains, setDomains] = useState<Domain[]>([]);
  const [hostname, setHostname] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [removing, setRemoving] = useState<string | null>(null);
  async function request(path = "", method = "GET", body?: object) {
    const response = await fetch(
      `/api/v1/platform/clients/${encodeURIComponent(clientId)}/domains${path}`,
      {
        method,
        headers: body ? { "Content-Type": "application/json" } : {},
        body: body ? JSON.stringify(body) : undefined,
      },
    );
    const payload = await response.json();
    if (!response.ok)
      throw new Error(
        payload.error?.message || "Unable to update client domains.",
      );
    return payload.data;
  }
  async function run(action?: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      if (action) await action();
      setDomains(await request());
      setRemoving(null);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Unable to load domains.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <button
        type="button"
        className="secondary"
        onClick={() => {
          setOpen(true);
          void run();
        }}
      >
        Domains
      </button>
      {open && (
        <ClientFormDialog
          title={`Domains — ${clientName}`}
          wide
          busy={busy}
          error={error}
          onClose={() => setOpen(false)}
        >
          <h2>Domains — {clientName}</h2>
          <p>
            Manage client login addresses. Custom domains require DNS
            verification and HTTPS routing before use.
          </p>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void run(async () => {
                await request("", "POST", { hostname });
                setHostname("");
              });
            }}
          >
            <label>
              <span>Hostname <span className="required-marker">*</span></span>
              <input
                required
                value={hostname}
                maxLength={253}
                placeholder="client.example.com"
                onChange={(event) => setHostname(event.target.value)}
              />
            </label>
            <div className="sa-actions">
              <button disabled={busy} type="submit">
                Add domain
              </button>
            </div>
          </form>
          <div className="client-domain-list" aria-live="polite">
            {!domains.length && (
              <p>
                {busy
                  ? "Loading domains…"
                  : "No explicit domains. The client’s default platform subdomain remains available."}
              </p>
            )}
            {domains.map((domain) => (
              <section className="client-domain-card" key={domain.id}>
                <h3>{domain.hostname}</h3>
                <p>
                  {domain.isVerified ? "Verified" : "Awaiting DNS verification"}
                  {domain.isPrimary ? " · Primary" : ""}
                </p>
                {!domain.isVerified && (
                  <>
                    <p>Add this TXT record with your DNS provider:</p>
                    <p>
                      <strong>Name:</strong>{" "}
                      <code>_evseye-verification.{domain.hostname}</code>
                    </p>
                    <p>
                      <strong>Value:</strong>{" "}
                      <code>
                        evseye-verification={domain.verificationToken}
                      </code>
                    </p>
                  </>
                )}
                <div className="sa-actions">
                  {!domain.isVerified && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        void run(() => request(`/${domain.id}/verify`, "POST"))
                      }
                    >
                      Verify DNS
                    </button>
                  )}
                  {domain.isVerified && !domain.isPrimary && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        void run(() => request(`/${domain.id}/primary`, "POST"))
                      }
                    >
                      Make primary
                    </button>
                  )}
                  <button
                    type="button"
                    className="danger"
                    disabled={busy}
                    onClick={() => setRemoving(domain.id)}
                  >
                    Remove
                  </button>
                </div>
                {removing === domain.id && (
                  <div role="alert">
                    <p>
                      Remove this domain mapping? Custom-domain access will stop
                      immediately. A default platform subdomain remains
                      available while the client is active.
                    </p>
                    <div className="sa-actions">
                      <button
                        type="button"
                        className="secondary"
                        disabled={busy}
                        onClick={() => setRemoving(null)}
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        className="danger"
                        disabled={busy}
                        onClick={() =>
                          void run(() => request(`/${domain.id}`, "DELETE"))
                        }
                      >
                        Confirm removal
                      </button>
                    </div>
                  </div>
                )}
              </section>
            ))}
          </div>
          <div className="form-actions">
            <button
              type="button"
              className="secondary"
              disabled={busy}
              onClick={() => setOpen(false)}
            >
              Close
            </button>
          </div>
        </ClientFormDialog>
      )}
    </>
  );
}
