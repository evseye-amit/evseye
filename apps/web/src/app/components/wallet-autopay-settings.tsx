"use client";

import { useEffect, useRef, useState } from "react";
import { sessionFetch } from "../../lib/session-fetch";

type Policy = {
  enabled: boolean;
  threshold: string;
  rechargeAmount: string;
  revision: number;
};
export function WalletAutoPaySettings() {
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const saving = useRef(false);
  useEffect(() => {
    const controller = new AbortController();
    void sessionFetch("/api/v1/client/wallet-autopay-policy", {
      signal: controller.signal,
    })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok)
          throw new Error(
            body.error?.message ?? "Unable to load wallet AutoPay settings.",
          );
        if (!controller.signal.aborted) setPolicy(body.data);
      })
      .catch((cause) => {
        if (!controller.signal.aborted)
          setError(
            cause instanceof Error ? cause.message : "Unable to load settings.",
          );
      });
    return () => controller.abort();
  }, []);
  async function save() {
    if (!policy || saving.current) return;
    saving.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await sessionFetch(
        "/api/v1/client/wallet-autopay-policy",
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(policy),
        },
      );
      const body = await response.json();
      if (!response.ok)
        throw new Error(
          body.error?.message ??
            "Could not save settings. Reload before retrying.",
        );
      setPolicy(body.data);
      setNotice(
        "Wallet AutoPay policy saved. Riders must accept any changed amounts before new recharges start.",
      );
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Unable to save settings.",
      );
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }
  return (
    <section aria-label="Wallet AutoPay settings">
      <h3>Wallet AutoPay</h3>
      <p>
        Automatically recharge opted-in riders with an active scooter. The
        threshold uses available cash, excluding rewards and security deposits.
        Debits require at least 25 hours; credit appears only after payment
        confirmation.
      </p>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {policy && (
        <fieldset disabled={busy}>
          <label>
            <input
              type="checkbox"
              checked={policy.enabled}
              onChange={(e) =>
                setPolicy({ ...policy, enabled: e.target.checked })
              }
            />{" "}
            Enable wallet AutoPay for this client
          </label>
          <label>
            Recharge when cash is below (₹)
            <input
              inputMode="decimal"
              value={policy.threshold}
              onChange={(e) =>
                setPolicy({ ...policy, threshold: e.target.value })
              }
            />
          </label>
          <label>
            Recharge amount (₹)
            <input
              inputMode="decimal"
              value={policy.rechargeAmount}
              onChange={(e) =>
                setPolicy({ ...policy, rechargeAmount: e.target.value })
              }
            />
          </label>
          <p>
            Riders must accept changed amounts before new recharges start.
            Use two decimal places. Recharge: ₹500–₹5,000, greater than the
            threshold. One pending automatic recharge per wallet; at least 24
            hours between a successful recharge and the next request. Disabling
            stops new requests; submitted debits may still complete.
          </p>
          <button type="button" onClick={() => void save()}>
            {busy ? "Saving…" : "Save wallet AutoPay settings"}
          </button>
        </fieldset>
      )}
    </section>
  );
}
