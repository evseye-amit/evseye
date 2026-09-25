"use client";

import { useState, type ReactNode } from "react";
import { ClientDataTable } from "./client-data-table";
import { useLocale } from "./locale-provider";
import { localeTag } from "../../lib/i18n";

export type ClientImportHistoryEntry = {
  id: string;
  fileName: string;
  createdAt: string;
  status: string;
  totalRows: number;
  passedRows: number;
  failedRows: number;
  jobId?: string;
};

export function ClientBulkImportWorkspace({ title, requiredColumns, template, history, historyLoading, help, busy, onBack, onUpload, onDownloadFailures }: {
  title: string;
  requiredColumns: string;
  template: string;
  history: ClientImportHistoryEntry[];
  historyLoading: boolean;
  help?: ReactNode;
  busy: boolean;
  onBack: () => void;
  onUpload: (file: File) => Promise<void>;
  onDownloadFailures: (jobId: string) => Promise<void>;
}) {
  const { t, locale } = useLocale();
  const [file, setFile] = useState<File | null>(null);
  const downloadTemplate = () => {
    const url = URL.createObjectURL(new Blob([template], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url; link.download = `${title.toLowerCase().replaceAll(" ", "-")}-template.csv`; link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return <section className="sa-bulk-workspace client-bulk-workspace">
    <div className="sa-bulk-workspace-head">
      <button className="secondary" type="button" onClick={onBack}>← {t("Back to")} {t(title)}</button>
      <div><p className="sa-eyebrow">{t("CLIENT OPERATIONS IMPORT")}</p><h2>{t("Bulk import")} {t(title)}</h2><p>{t("Use the template to add records safely and consistently.")}</p></div>
      <button className="secondary" type="button" onClick={downloadTemplate}>{t("Download template")}</button>
    </div>
    <div className="sa-bulk-workspace-body has-history">
      <section className="sa-bulk-upload-card">
        <div><p className="sa-eyebrow">{t(history.length ? "IMPORT ANOTHER FILE" : "GET STARTED")}</p><h3>{t("Upload a CSV")}</h3><p>{t("Required columns")}: {requiredColumns}.</p><p className="sa-bulk-help">{t("CSV only · Maximum 5 MB · Files are validated before records are saved.")}</p>{help}</div>
        <label className="sa-bulk-file-picker"><span>{file ? file.name : t("Choose CSV file")}</span><input type="file" accept=".csv,text/csv" onChange={(event) => setFile(event.currentTarget.files?.[0] ?? null)} /></label>
        <div className="sa-bulk-upload-actions"><button className="secondary" type="button" onClick={downloadTemplate}>{t("Download template")}</button><button type="button" disabled={!file || busy} onClick={() => file && void onUpload(file)}>{busy ? t("Importing…") : `${t("Import")} ${t(title)}`}</button></div>
      </section>
      <section className="sa-bulk-history"><div className="sa-bulk-section-head"><div><h3>{t("Import history")}</h3><p>{t("Previous uploads for")} {t(title)}.</p></div><span>{history.length} {t(history.length === 1 ? "upload" : "uploads")}</span></div>
        {historyLoading && <p className="sa-bulk-help" role="status">{t("Loading previous uploads…")}</p>}
        <ClientDataTable rows={historyLoading ? [] : history} emptyMessage={t("No imports yet.")} getRowId={(entry) => entry.id} columns={[
          { key: "when", label: "Imported on", value: (entry) => new Date(entry.createdAt).toLocaleString(localeTag(locale)) },
          { key: "file", label: "File name", value: (entry) => entry.fileName },
          { key: "status", label: "Outcome", value: (entry) => entry.status.replaceAll("_", " "), render: (entry) => <span className={`sa-import-status ${entry.status.toLowerCase()}`}>{t(entry.status === "PARTIAL_PASS" ? "Partial pass" : entry.status === "PASS" ? "Passed" : "Failed")}</span> },
          { key: "records", label: "Records", value: (entry) => `${entry.passedRows} / ${entry.totalRows}` },
        ]} actions={(entry) => entry.failedRows > 0 && entry.jobId ? <button type="button" className="secondary table-action" onClick={() => void onDownloadFailures(entry.jobId!)}>{t("Download failures")}</button> : "—"} />
      </section>
    </div>
  </section>;
}
