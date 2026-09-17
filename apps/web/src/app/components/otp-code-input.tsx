"use client";

import { ClipboardEvent, KeyboardEvent, useEffect, useRef } from "react";

type OtpCredential = Credential & { code: string };

export function OtpCodeInput({
  value,
  onChange,
  disabled = false,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const inputs = useRef<Array<HTMLInputElement | null>>([]);
  const onChangeRef = useRef(onChange);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    inputs.current[0]?.focus();
  }, []);

  useEffect(() => {
    if (!("OTPCredential" in window)) return;
    const controller = new AbortController();
    const credentials = navigator.credentials as unknown as {
      get(options: unknown): Promise<OtpCredential | null>;
    };
    void credentials
      .get({ otp: { transport: ["sms"] }, signal: controller.signal })
      .then((credential) => {
        if (credential?.code) {
          onChangeRef.current(credential.code.replace(/\D/g, "").slice(0, 6));
        }
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, []);

  const setDigits = (next: string, startIndex = 0) => {
    const digits = next.replace(/\D/g, "").slice(0, 6 - startIndex);
    const merged = `${value.slice(0, startIndex)}${digits}${value.slice(startIndex + digits.length)}`
      .replace(/\D/g, "")
      .slice(0, 6);
    onChange(merged);
    const nextIndex = Math.min(startIndex + digits.length, 5);
    window.requestAnimationFrame(() => inputs.current[nextIndex]?.focus());
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>, index: number) => {
    if (event.key === "Backspace" && !value[index] && index > 0) {
      event.preventDefault();
      const next = `${value.slice(0, index - 1)}${value.slice(index)}`;
      onChange(next);
      inputs.current[index - 1]?.focus();
    }
    if (event.key === "ArrowLeft" && index > 0) inputs.current[index - 1]?.focus();
    if (event.key === "ArrowRight" && index < 5) inputs.current[index + 1]?.focus();
  };

  const onPaste = (event: ClipboardEvent<HTMLInputElement>) => {
    event.preventDefault();
    const digits = event.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
    if (digits) onChange(digits);
    window.requestAnimationFrame(() => inputs.current[Math.min(digits.length, 5)]?.focus());
  };

  return (
    <div className="otp-code-input" role="group" aria-label="Six-digit verification code">
      {Array.from({ length: 6 }, (_, index) => (
        <input
          key={index}
          ref={(element) => { inputs.current[index] = element; }}
          value={value[index] ?? ""}
          onChange={(event) => setDigits(event.currentTarget.value, index)}
          onKeyDown={(event) => onKeyDown(event, index)}
          onPaste={onPaste}
          type="text"
          inputMode="numeric"
          autoComplete={index === 0 ? "one-time-code" : "off"}
          aria-label={`OTP digit ${index + 1}`}
          maxLength={6}
          disabled={disabled}
          required={index === 0}
        />
      ))}
    </div>
  );
}
