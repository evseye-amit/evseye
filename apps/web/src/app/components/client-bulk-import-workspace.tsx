"use client";

import { useRef, useState, type ReactNode } from "react";
import { ClientDataTable } from "./client-data-table";
import { useLocale } from "./locale-provider";
import { formatDateTime } from "../../lib/presentation";
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

export function ClientBulkImportWorkspace({ title, requiredColumns, template, history, historyLoading, help, busy, onBack, onUpload, onDownloadFailures, eyebrow = "CLIENT OPERATIONS IMPORT" }: {
  eyebrow?: string;
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
  const [fileError, setFileError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const uploading = useRef(false);
  const [file, setFile] = useState<File | null>(null);
  const validate = (selected: File | null) => !selected ? "Choose a CSV file." : !/\.csv$/i.test(selected.name) ? "Choose a CSV file using the downloaded template." : selected.size === 0 ? "The selected file is empty." : selected.size > 5 * 1024 * 1024 ? "The CSV file must be 5 MB or smaller." : "";
  const importFile = async () => {
    if (uploading.current || busy) return;
    const issue = validate(file); setFileError(issue);
    if (issue || !file) return;
    uploading.current = true; setSubmitting(true);
    try { await onUpload(file); }
    catch (cause) { setFileError(cause instanceof Error ? cause.message : "Unable to import this file. Please try again."); }
    finally { uploading.current = false; setSubmitting(false); }
  };
  const downloadTemplate = () => {
    const url = URL.createObjectURL(new Blob([template], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url; link.download = `${title.toLowerCase().replaceAll(" ", "-")}-template.csv`; link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return <section className="sa-bulk-workspace client-bulk-workspace">
    <div className="sa-bulk-workspace-head">
      <button className="secondary" type="button" disabled={busy || submitting} onClick={onBack}>← {t("Back to")} {t(title)}</button>
      <div><p className="sa-eyebrow">{t(eyebrow)}</p><h2>{t("Bulk import")} {t(title)}</h2><p>{t("Use the template to add records safely and consistently.")}</p></div>
      <button className="secondary" type="button" onClick={downloadTemplate}>{t("Download template")}</button>
    </div>
    <div className="sa-bulk-workspace-body has-history">
      <section className="sa-bulk-upload-card">
        <div><p className="sa-eyebrow">{t(history.length ? "IMPORT ANOTHER FILE" : "GET STARTED")}</p><h3>{t("Upload a CSV")}</h3><p>{t("Required columns")}: {requiredColumns}.</p><p className="sa-bulk-help">{t("CSV only · Maximum 5 MB · Files are validated before records are saved.")}</p>{help}</div>
        <label className="sa-bulk-file-picker"><span>{file ? file.name : t("Choose CSV file")}</span><input type="file" aria-describedby={fileError ? "bulk-file-error" : undefined} aria-invalid={Boolean(fileError)} disabled={busy || submitting} accept=".csv,text/csv" onChange={(event) => { const selected = event.currentTarget.files?.[0] ?? null; setFile(selected); setFileError(selected ? validate(selected) : ""); }} /></label>
        {fileError && <p id="bulk-file-error" className="error" role="alert">{fileError}</p>}
        <div className="sa-bulk-upload-actions"><button className="secondary" type="button" onClick={downloadTemplate}>{t("Download template")}</button><button type="button" disabled={!file || Boolean(fileError) || busy || submitting} onClick={() => void importFile()}>{busy || submitting ? t("Importing…") : `${t("Import")} ${t(title)}`}</button></div>
      </section>
      <section className="sa-bulk-history"><div className="sa-bulk-section-head"><div><h3>{t("Import history")}</h3><p>{t("Previous uploads for")} {t(title)}.</p><p className="sa-bulk-help">{t("Partial success means only successful rows were imported. Download the failed rows, correct them, and upload them again.")}</p></div><span>{history.length} {t(history.length === 1 ? "upload" : "uploads")}</span></div>
        <ClientDataTable loading={historyLoading} rows={history} emptyMessage={t("No imports yet.")} getRowId={(entry) => entry.id} columns={[
          { key: "when", label: "Imported on", value: (entry) => formatDateTime(entry.createdAt, localeTag(locale)) },
          { key: "file", label: "File name", value: (entry) => entry.fileName },
          { key: "status", label: "Outcome", value: (entry) => entry.status.replaceAll("_", " "), render: (entry) => <span className={`sa-import-status ${entry.status.toLowerCase()}`}>{t(entry.status === "PARTIAL_PASS" ? "Partial pass" : entry.status === "PASS" ? "Passed" : entry.status === "FAIL" ? "Failed" : entry.status === "PROCESSING" ? "Processing" : entry.status === "INTERRUPTED" ? "Interrupted" : entry.status)}</span> },
          { key: "records", label: "Total rows", value: (entry) => entry.totalRows },
          { key: "passed", label: "Successful rows", value: (entry) => entry.passedRows },
          { key: "failed", label: "Failed rows", value: (entry) => entry.failedRows },
        ]} actions={(entry) => entry.failedRows > 0 && entry.jobId ? <button type="button" className="secondary table-action" onClick={() => void onDownloadFailures(entry.jobId!)} disabled={busy || submitting}>{t("Download failures")} ({entry.failedRows})</button> : "—"} />
      </section>
    </div>
  </section>;
}
