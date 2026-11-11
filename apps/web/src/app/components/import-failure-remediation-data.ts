export type RemediationFailure = { raw?: Record<string, unknown> };

const syntheticFailureKeys = new Set(["row", "row_number", "failure_reason", "failure_fields"]);

function stripSyntheticFailureMetadata(row: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(row).filter(([key]) => !syntheticFailureKeys.has(key)));
}

export function deriveRemediationRows(
  correctedRows: Record<string, unknown>[] | undefined,
  failures: RemediationFailure[],
): Record<string, unknown>[] {
  const rows = correctedRows ?? failures.flatMap((failure) => failure.raw ? [failure.raw] : []);
  return rows.map(stripSyntheticFailureMetadata);
}

export function parseRemediationRows(draft: string): Record<string, unknown>[] {
  const rows: unknown = JSON.parse(draft);
  if (!Array.isArray(rows)) throw new Error("Rows must be a JSON array.");
  return rows as Record<string, unknown>[];
}
