"use client";
import { useState } from "react";

export type ImportFailure = { row?: number; fields?: string[] | string; message: string; raw?: Record<string, unknown> };

export function ImportFailureRemediation({ failures, correctedRows, onDownload, onRetry }: { failures: ImportFailure[]; correctedRows?: Record<string, unknown>[]; onDownload?: () => void; onRetry?: (rows: Record<string, unknown>[]) => void }) {
  const [draft, setDraft] = useState(JSON.stringify(correctedRows ?? [], null, 2));
  const [draftError, setDraftError] = useState("");
  const retry = () => {
    try { const rows = JSON.parse(draft); if (!Array.isArray(rows)) throw new Error("Rows must be a JSON array."); setDraftError(""); onRetry?.(rows); }
    catch (error) { setDraftError(error instanceof Error ? error.message : "Invalid corrected rows."); }
  };
  if (!failures.length) return null;
  return <section className="client-import-failures" role="alert">
    <strong>{failures.length} import row{failures.length === 1 ? "" : "s"} need correction</strong>
    <ul>{failures.slice(0, 20).map((failure, index) => <li key={`${failure.row ?? index}-${String(failure.fields ?? "row")}`}>{failure.row ? `Row ${failure.row}: ` : ""}{failure.fields ? `${Array.isArray(failure.fields) ? failure.fields.join(", ") : failure.fields}: ` : ""}{failure.message}</li>)}</ul>
    {onRetry ? <><label>Corrected rows (JSON)</label><textarea value={draft} onChange={(event) => setDraft(event.target.value)} rows={6} />{draftError ? <p role="alert">{draftError}</p> : null}</> : null}
    <div className="client-rejection-actions">
      {onDownload ? <button type="button" onClick={onDownload}>Download failures</button> : null}
      {onRetry ? <button type="button" onClick={retry}>Retry corrected rows</button> : null}
    </div>
  </section>;
}
