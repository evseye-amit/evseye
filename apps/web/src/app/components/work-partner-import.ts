import { parseCsv } from "./client-user-manager";

export const workPartnerRequiredColumns = ["code", "name", "legalName"];
export const workPartnerImportColumns = [...workPartnerRequiredColumns, "category", "status", "logo", "workType", "website"];

export function parseWorkPartnerImport(text: string) {
  const csv = parseCsv(text);
  const headers = (csv.shift() ?? []).map((value) => value.trim());
  if (new Set(headers).size !== headers.length || headers.some((key) => !workPartnerImportColumns.includes(key)))
    throw new Error("CSV contains duplicate or unsupported column names. Use the template.");
  if (!workPartnerRequiredColumns.every((key) => headers.includes(key)))
    throw new Error(`CSV requires columns: ${workPartnerRequiredColumns.join(", ")}.`);
  if (!csv.length || csv.length > 100) throw new Error("Import between 1 and 100 work partners at a time.");
  return csv.map((values, index) => {
    if (values.length !== headers.length) throw new Error(`Row ${index + 2}: column count does not match the header.`);
    return Object.fromEntries(headers.map((key, column) => [key, values[column].trim()]).filter(([, value]) => value !== ""));
  });
}

export type WorkPartnerImportFailure = { row: number; message: string; record: Record<string, unknown> };
export function workPartnerFailuresCsv(failures: WorkPartnerImportFailure[]) {
  const cell = (input: unknown) => {
    let value = String(input ?? "");
    if (/^[=+\-@\t\r]/.test(value)) value = `'${value}`;
    return `"${value.replaceAll('"', '""')}"`;
  };
  return [workPartnerImportColumns.concat(["row", "error"]).map(cell).join(","), ...failures.map((failure) => [
    ...workPartnerImportColumns.map((key) => failure.record[key]), failure.row, failure.message,
  ].map(cell).join(","))].join("\r\n");
}
