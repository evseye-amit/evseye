"use client";
import { useEffect, useId, useState } from "react";
import { deriveRemediationRows, parseRemediationRows } from "./import-failure-remediation-data";

export type ImportFailure = { row?: number; fields?: string[] | string; message: string; raw?: Record<string, unknown> };

export function ImportFailureRemediation({ failures, correctedRows, onDownload, onRetry }: { failures: ImportFailure[]; correctedRows?: Record<string, unknown>[]; onDownload?: () => void; onRetry?: (rows: Record<string, unknown>[]) => void | Promise<void> }) {
  const initialRows = deriveRemediationRows(correctedRows, failures);
  const serializedRows = JSON.stringify(initialRows, null, 2);
  const textareaId = useId();
  const [draft, setDraft] = useState(serializedRows);
  const [draftError, setDraftError] = useState("");
  // The API can replace failures while this editor stays mounted; resync the draft to that response.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    setDraft(serializedRows);
    setDraftError("");
  }, [serializedRows]);
  /* eslint-enable react-hooks/set-state-in-effect */
  const retry = async () => {
    try { const rows = parseRemediationRows(draft); setDraftError(""); await onRetry?.(rows); }
    catch (error) { setDraftError(error instanceof Error ? error.message : "Invalid corrected rows."); }
  };
  if (!failures.length) return null;
  return <section className="client-import-failures" role="alert">
    <strong>{failures.length} import row{failures.length === 1 ? "" : "s"} need correction</strong>
    <ul>{failures.slice(0, 20).map((failure, index) => <li key={`${failure.row ?? index}-${String(failure.fields ?? "row")}`}>{failure.row ? `Row ${failure.row}: ` : ""}{failure.fields ? `${Array.isArray(failure.fields) ? failure.fields.join(", ") : failure.fields}: ` : ""}{failure.message}</li>)}</ul>
    {onRetry ? <><label htmlFor={textareaId}>Corrected rows (JSON)</label><textarea id={textareaId} value={draft} onChange={(event) => setDraft(event.target.value)} rows={6} />{draftError ? <p role="alert">{draftError}</p> : null}</> : null}
    <div className="client-rejection-actions">
      {onDownload ? <button type="button" onClick={onDownload}>Download failures</button> : null}
      {onRetry ? <button type="button" onClick={() => void retry()}>Retry corrected rows</button> : null}
    </div>
  </section>;
}
