"use client";
import { useRef, useState } from "react";
import { sessionFetch } from "../../lib/session-fetch";

type Device = {
  id: string;
  platform: string;
  lastRegisteredAt: string;
  user: { name: string };
};
export function NotificationTestSend({
  application,
  categoryCode,
  title,
  body,
  disabled,
  onBusy,
}: {
  application: string;
  categoryCode: string;
  title: string;
  body: string;
  disabled: boolean;
  onBusy: (busy: boolean) => void;
}) {
  const [phone, setPhone] = useState("");
  const [devices, setDevices] = useState<Device[]>([]);
  const [deviceId, setDeviceId] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const attempt = useRef<{ signature: string; key: string } | null>(null);
  async function request(path: string, options?: RequestInit) {
    const response = await sessionFetch(
      "/api/v1/client/notifications" + path,
      options,
    );
    const result = await response.json();
    if (!response.ok)
      throw new Error(result.error?.message ?? "Unable to complete the test.");
    return result.data;
  }
  async function lookup() {
    onBusy(true);
    setError("");
    setNotice("");
    setDevices([]);
    setDeviceId("");
    try {
      const rows: Device[] = await request(
        `/test-devices?application=${encodeURIComponent(application)}&phone=${encodeURIComponent(phone)}`,
      );
      setDevices(rows);
      if (!rows.length)
        setNotice(
          "No active devices found for this phone number and application.",
        );
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Device lookup failed.",
      );
    } finally {
      onBusy(false);
    }
  }
  async function send() {
    onBusy(true);
    setError("");
    setNotice("");
    const payload = { deviceId, application, categoryCode, title, body };
    const signature = JSON.stringify(payload);
    if (attempt.current?.signature !== signature)
      attempt.current = { signature, key: crypto.randomUUID() };
    try {
      const message = await request("/test", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": attempt.current!.key,
        },
        body: signature,
      });
      setNotice(
        `Test queued (${message.id}). Check sending history for Firebase acceptance or failure. This does not confirm device display.`,
      );
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Test failed. Retry uses the same request key.",
      );
    } finally {
      onBusy(false);
    }
  }
  return (
    <details>
      <summary>Send a test to one device</summary>
      <p className="muted">
        Sends immediately to the selected device and creates a test entry in
        that user’s inbox. Audience filters and scheduling do not apply.
        Permission, consent and notification preferences still apply.
      </p>
      <p className="muted">
        Test titles include a [Test] prefix and allow up to 143 characters.
      </p>
      <fieldset disabled={disabled} className="form-stack">
        <label>
          Test recipient phone number
          <input
            value={phone}
            onChange={(e) => {
              setPhone(e.target.value);
              setDevices([]);
              setDeviceId("");
              setNotice("");
            }}
            placeholder="+919876543210"
          />
        </label>
        <button
          type="button"
          disabled={!phone.trim()}
          onClick={() => void lookup()}
        >
          Find test devices
        </button>
        {devices.length > 0 && (
          <label>
            Test device
            <select
              value={deviceId}
              onChange={(e) => {
                setDeviceId(e.target.value);
                setNotice("");
              }}
            >
              <option value="">Select one device</option>
              {devices.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.user.name} · {d.platform} · {d.id.slice(-8)} · registered{" "}
                  {new Date(d.lastRegisteredAt).toLocaleString()}
                </option>
              ))}
            </select>
          </label>
        )}
        <button
          type="button"
          disabled={
            !deviceId ||
            !categoryCode ||
            !title.trim() ||
            title.length > 143 ||
            !body.trim()
          }
          onClick={() => void send()}
        >
          Send test notification
        </button>
        <button
          type="button"
          onClick={() => {
            attempt.current = null;
            setNotice("Ready to send a new test with the current content.");
          }}
        >
          Start a new test
        </button>
      </fieldset>
      {notice && (
        <p role="status" className="notice">
          {notice}
        </p>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </details>
  );
}
