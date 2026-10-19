"use client";

import { useEffect, useId, useRef } from "react";
import { useLocale } from "./locale-provider";

export type ClientDeleteConfirmation = {
  title: string;
  description: string;
  confirmLabel: string;
  onConfirm: () => Promise<void>;
};

export function ClientDeleteDialog({ confirmation, busy, onClose }: {
  confirmation: ClientDeleteConfirmation | null;
  busy: boolean;
  onClose: () => void;
}) {
  const { t } = useLocale();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const triggerRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    let focusFrame: number | undefined;
    if (confirmation && !dialog.open) {
      triggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      dialog.showModal();
      focusFrame = window.requestAnimationFrame(() => cancelRef.current?.focus());
    }
    if (!confirmation && dialog.open) { dialog.close(); triggerRef.current?.focus(); }
    return () => { if (focusFrame !== undefined) window.cancelAnimationFrame(focusFrame); };
  }, [confirmation]);
  return <dialog ref={dialogRef} className="sa-dialog sa-delete-dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descriptionId} aria-busy={busy} onCancel={(event) => {
    event.preventDefault();
    if (!busy) onClose();
  }} onClose={() => { if (confirmation) onClose(); }}>
    <div className="sa-dialog-surface sa-delete-dialog-surface">
      <span className="sa-delete-dialog-icon" aria-hidden="true">!</span>
      <div><p className="sa-eyebrow">{t("CONFIRM DELETION")}</p><h2 id={titleId}>{t(confirmation?.title ?? "")}</h2><p id={descriptionId}>{t(confirmation?.description ?? "")}</p></div>
      <div className="sa-dialog-actions">
        <button ref={cancelRef} type="button" className="secondary" disabled={busy} onClick={onClose}>{t("Keep it")}</button>
        <button type="button" className="danger" disabled={busy} onClick={() => { if (confirmation) void confirmation.onConfirm().finally(onClose); }}>{t(busy ? "Deleting…" : confirmation?.confirmLabel ?? "Delete")}</button>
      </div>
    </div>
  </dialog>;
}
