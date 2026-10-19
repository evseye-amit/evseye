"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { useLocale } from "./locale-provider";

export function ClientFormDialog({ title, onClose, error, busy = false, wide = false, children, surfaceClassName = "", heading }: {
  title: string;
  heading?: ReactNode;
  onClose: () => void;
  error?: string;
  busy?: boolean;
  wide?: boolean;
  children: ReactNode;
  surfaceClassName?: string;
}) {
  const { t } = useLocale();
  const titleId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    triggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog.showModal();
    const frame = requestAnimationFrame(() => {
      const content = dialog.querySelector(".client-dialog-content");
      const target = content?.querySelector<HTMLElement>("input:not([type=file]):not(:disabled), select:not(:disabled), textarea:not(:disabled), button:not(:disabled)")
        ?? dialog.querySelector<HTMLElement>(".client-dialog-close");
      target?.focus();
    });
    return () => {
      cancelAnimationFrame(frame);
      dialog.close();
      triggerRef.current?.focus();
    };
  }, []);

  return <dialog ref={dialogRef} className={`sa-dialog${wide ? " sa-dialog-wide" : ""}`} aria-labelledby={titleId} aria-modal="true"
    onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}>
    <div className={`sa-form sa-dialog-surface client-form-dialog ${surfaceClassName}`}>
      <header className="client-dialog-header">
        <h2 id={titleId}>{heading ?? t(title)}</h2>
        <button type="button" className="secondary client-dialog-close" aria-label={t("Close")} disabled={busy} onClick={onClose}>×</button>
      </header>
      <div className="client-dialog-content">
        {error && <p className="error" role="alert">{error}</p>}
        {children}
      </div>
    </div>
  </dialog>;
}
