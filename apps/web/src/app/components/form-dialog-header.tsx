"use client";

import type { ReactNode } from "react";
import { useLocale } from "./locale-provider";

export function FormDialogHeader({ titleId, title, descriptionId, description, busy = false, onClose }: {
  titleId: string;
  title: ReactNode;
  descriptionId?: string;
  description?: ReactNode;
  busy?: boolean;
  onClose: () => void;
}) {
  const { t } = useLocale();
  return <header className="client-dialog-header form-dialog-header">
    <div>
      <h2 id={titleId}>{title}</h2>
      {description && <p id={descriptionId}>{description}</p>}
    </div>
    <button type="button" className="secondary client-dialog-close" aria-label={t("Close")} disabled={busy} onClick={onClose}>×</button>
  </header>;
}
