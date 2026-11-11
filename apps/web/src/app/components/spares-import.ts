import { parseCsv } from "./client-user-manager";

export const spareRequiredColumns = ["code", "name", "baseRate", "gstPercent", "hsnCode"];
export const spareColumns = (platform: boolean) => [
  ...spareRequiredColumns, "unit", "vehicleTypeIds", "isActive",
  ...(!platform ? ["penaltyAmount", "evidenceRequired"] : []),
];

export function parseSpareImport(text: string, platform: boolean) {
  const csv = parseCsv(text);
  const headers = (csv.shift() ?? []).map((value) => value.trim());
  if (new Set(headers).size !== headers.length || headers.some((key) => !spareColumns(platform).includes(key))) {
    throw new Error("CSV contains duplicate or unsupported column names. Use the template.");
  }
  if (!spareRequiredColumns.every((key) => headers.includes(key))) {
    throw new Error(`CSV requires columns: ${spareRequiredColumns.join(", ")}.`);
  }
  if (!csv.length || csv.length > 100) throw new Error("Import between 1 and 100 spares at a time.");
  return csv.map((values, index) => {
    if (values.length !== headers.length) throw new Error(`Row ${index + 2}: column count does not match the header.`);
    const row: Record<string, string | boolean | string[]> = {};
    headers.forEach((key, column) => {
      const value = values[column].trim();
      if (!value) return;
      if (key === "isActive" || key === "evidenceRequired") {
        if (!/^(true|false)$/i.test(value)) throw new Error(`Row ${index + 2}: ${key} must be true or false.`);
        row[key] = value.toLowerCase() === "true";
      } else if (key === "vehicleTypeIds") row[key] = value.split(";").map((id) => id.trim()).filter(Boolean);
      else row[key] = value;
    });
    return row;
  });
}

export type SpareImportFailure = { row: number; code: string; message: string; record: Record<string, unknown> };
export function spareFailuresCsv(failures: SpareImportFailure[], platform: boolean) {
  const columns = spareColumns(platform);
  const cell = (input: unknown) => {
    let value = String(input ?? "");
    if (/^[=+\-@\t\r]/.test(value)) value = `'${value}`;
    return `"${value.replaceAll('"', '""')}"`;
  };
  return [columns.concat(["row", "error"]).map(cell).join(","), ...failures.map((failure) => [
    ...columns.map((key) => Array.isArray(failure.record[key]) ? (failure.record[key] as string[]).join(";") : failure.record[key]),
    failure.row, failure.message,
  ].map(cell).join(","))].join("\r\n");
}
