"use client";

import { useEffect, useRef } from "react";

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
  const dialogRef = useRef<HTMLDialogElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (confirmation && !dialog.open) {
      dialog.showModal();
      window.requestAnimationFrame(() => confirmRef.current?.focus());
    }
    if (!confirmation && dialog.open) dialog.close();
  }, [confirmation]);
  return <dialog ref={dialogRef} className="sa-dialog sa-delete-dialog" onCancel={(event) => {
    event.preventDefault();
    if (!busy) onClose();
  }} onClose={() => { if (confirmation) onClose(); }}>
    <div className="sa-dialog-surface sa-delete-dialog-surface">
      <span className="sa-delete-dialog-icon" aria-hidden="true">!</span>
      <div><p className="sa-eyebrow">CONFIRM DELETION</p><h2>{confirmation?.title}</h2><p>{confirmation?.description}</p></div>
      <div className="sa-dialog-actions">
        <button type="button" className="secondary" disabled={busy} onClick={onClose}>Keep it</button>
        <button ref={confirmRef} type="button" className="danger" disabled={busy} onClick={() => { if (confirmation) void confirmation.onConfirm().finally(onClose); }}>{busy ? "Deleting…" : confirmation?.confirmLabel ?? "Delete"}</button>
      </div>
    </div>
  </dialog>;
}
