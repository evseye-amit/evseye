"use client";

import { useLocale } from "./locale-provider";
import { ClientFormDialog } from "./client-form-dialog";

export function ClientConfirmationDialog({ title, description, confirmLabel, busy, error, danger = false, onClose, onConfirm }: {
  title: string; description: string; confirmLabel: string; busy: boolean; error?: string;
  danger?: boolean; onClose: () => void; onConfirm: () => Promise<void>;
}) {
  const { t } = useLocale();
  return <ClientFormDialog title={title} busy={busy} error={error} onClose={onClose}>
    <p>{description}</p>
    <div className="form-actions">
      <button type="button" className="secondary" data-initial-focus disabled={busy} onClick={onClose}>{t("Cancel")}</button>
      <button type="button" className={danger ? "danger" : undefined} disabled={busy} onClick={() => void onConfirm()}>{t(busy ? "Saving…" : confirmLabel)}</button>
    </div>
  </ClientFormDialog>;
}
