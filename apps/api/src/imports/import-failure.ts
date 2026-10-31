export type ImportFailure = {
  row: number;
  message: string;
  fields: string[];
  raw?: Record<string, unknown>;
};

export function normalizeImportFailures(failures: unknown): ImportFailure[] {
  if (!Array.isArray(failures)) return [];
  return failures.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const value = item as Record<string, unknown>;
    const row = Number(value.row ?? value.row_number);
    const message = String(value.message ?? value.failure_reason ?? 'Invalid row.');
    const fields = String(value.fields ?? value.failure_fields ?? '').split(',').map((field) => field.trim()).filter(Boolean);
    return [{ row: Number.isFinite(row) ? row : 0, message, fields, raw: value }];
  });
}
