"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { useLocale } from "./locale-provider";

export function ClientFormDialog({ title, onClose, error, busy = false, wide = false, children }: {
  title: string;
  onClose: () => void;
  error?: string;
  busy?: boolean;
  wide?: boolean;
  children: ReactNode;
}) {
  const { t } = useLocale();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    triggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog.showModal();
    const frame = requestAnimationFrame(() => dialog.querySelector<HTMLElement>("input:not([type=file]), select, textarea, button")?.focus());
    return () => {
      cancelAnimationFrame(frame);
      dialog.close();
      triggerRef.current?.focus();
    };
  }, []);

  return <dialog ref={dialogRef} className={`sa-dialog${wide ? " sa-dialog-wide" : ""}`} aria-label={t(title)} aria-modal="true"
    onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}>
    <div className="sa-form sa-dialog-surface client-form-dialog">{error && <p className="error" role="alert">{error}</p>}{children}</div>
  </dialog>;
}
