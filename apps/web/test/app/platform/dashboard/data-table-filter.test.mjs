import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  deriveRemediationRows,
  parseRemediationRows,
} from "../../../../src/app/components/import-failure-remediation-data.ts";
import { filterRows, getSelectOptions } from "../../../../src/app/platform/dashboard/data-table-filter.ts";

const rows = [
  ["Alpha", "ACTIVE", 10, { action: "edit" }],
  ["beta", "INACTIVE", 20, { action: "edit" }],
  ["alphabet", "ACTIVE", 30, { action: "edit" }],
  ["missing number", "ACTIVE", null, { action: "edit" }],
  ["string number", "ACTIVE", "40", { action: "edit" }],
];
const specs = [
  { type: "text" },
  { type: "select", options: ["ACTIVE", "INACTIVE"] },
  { type: "number" },
  null,
];

test("filters text, select, and inclusive numeric ranges with AND semantics", () => {
  const result = filterRows(rows, specs, {
    0: { text: "ALP" },
    1: { value: "ACTIVE" },
    2: { min: "10", max: "30" },
  });

  assert.deepEqual(
    result.rows.map((row) => row[0]),
    ["Alpha", "alphabet"],
  );
  assert.equal(result.activeCount, 3);
});

test("text and select filters support multiple selected values", () => {
  const result = filterRows(rows, specs, {
    0: { values: ["Alpha", "beta"] },
    1: { values: ["ACTIVE", "INACTIVE"] },
  });

  assert.deepEqual(
    result.rows.map((row) => row[0]),
    ["Alpha", "beta"],
  );
  assert.equal(result.activeCount, 2);
});

test("missing and non-numeric values do not match number filters", () => {
  const result = filterRows(rows, specs, { 2: { min: "0", max: "50" } });

  assert.deepEqual(
    result.rows.map((row) => row[0]),
    ["Alpha", "beta", "alphabet"],
  );
});

test("quantity columns use finite numeric filtering", () => {
  const specs = [
    { type: "text" },
    { type: "number" },
    { type: "text" },
    { type: "number" },
  ];
  const result = filterRows(
    [
      ["Feature", 1, "Tier A", 10],
      ["Feature", 2, "Tier B", 20],
      ["Feature", 3, "Tier C", "30"],
    ],
    specs,
    { 1: { min: "2" }, 3: { max: "20" } },
  );

  assert.deepEqual(result.rows, [["Feature", 2, "Tier B", 20]]);
  assert.equal(result.activeCount, 2);
});

test("client feature usage ledger displays quantity values", () => {
  const source = readFileSync(new URL("../../../../src/app/components/client-commercial-settings.tsx", import.meta.url), "utf8");
  const ledgerStart = source.indexOf('{(!section || section === "ledger") && <section');
  const ledgerView = source.slice(ledgerStart, source.indexOf("</section>", ledgerStart));

  assert.match(ledgerView, /headings=\{\["When", "Feature", "Transaction", "Source", "Quantity", "Balance after", "Reference"\]\}/);
  assert.match(ledgerView, /number\(item\.quantity\)/);
});

test("numeric controls keep full accessible names while desktop label text is hidden", () => {
  const page = readFileSync(new URL("../../../../src/app/components/platform-data-table.tsx", import.meta.url), "utf8");
  const css = readFileSync(
    new URL("../../../../src/app/globals.css", import.meta.url),
    "utf8",
  );

  assert.match(page, /placeholder="Min"/);
  assert.match(page, /aria-label=\{`Minimum \$\{heading\}`\}/);
  assert.match(page, /placeholder="Max"/);
  assert.match(page, /aria-label=\{`Maximum \$\{heading\}`\}/);
  assert.match(
    css,
    /\.sa-table-filter-row \.sa-table-filter-range label > span[\s\S]*clip: rect\(0 0 0 0\)/,
  );
});

test("invalid numeric ranges are reported without swapping bounds", () => {
  const result = filterRows(rows, specs, { 2: { min: "40", max: "10" } });

  assert.equal(result.invalidRanges, 1);
  assert.equal(result.activeCount, 1);
  assert.deepEqual(result.rows, []);
});

test("select options derive distinct non-missing primitive values", () => {
  assert.deepEqual(
    getSelectOptions(
      [["A"], ["B"], ["A"], [null], [{ action: "edit" }], [2]],
      0,
      { type: "select" },
    ),
    ["A", "B", 2],
  );
});

test("remediation rows prefer explicit corrections and otherwise preserve raw failures", () => {
  const rawRows = [
    { code: "ACME", name: "Acme" },
    { code: "SCOOTER", name: "Scooter", categoryCode: "BAD", energyType: "BAD" },
  ];

  assert.deepEqual(
    deriveRemediationRows(
      undefined,
      [{ message: "invalid code", raw: rawRows[0] }, { message: "missing raw" }, { message: "invalid fields", raw: rawRows[1] }],
    ),
    rawRows,
  );
  assert.deepEqual(
    deriveRemediationRows([{ code: "FIXED", name: "Fixed" }], [{ message: "invalid code", raw: rawRows[0] }]),
    [{ code: "FIXED", name: "Fixed" }],
  );
});

test("hub retry rows drop synthetic failure metadata but keep supported fields", () => {
  const failedRow = {
    row: 4,
    row_number: 4,
    failure_reason: "Hub code already exists for this client.",
    failure_fields: "code",
    code: "HUB-OLD",
    name: "Main Hub",
    city: "Pune",
    state: "Maharashtra",
    status: "ACTIVE",
  };
  const expectedRow = {
    code: "HUB-OLD",
    name: "Main Hub",
    city: "Pune",
    state: "Maharashtra",
    status: "ACTIVE",
  };

  const derived = deriveRemediationRows(undefined, [{
    message: "Hub code already exists for this client.",
    raw: failedRow,
  }]);
  assert.deepEqual(derived, [expectedRow]);

  const retriedRows = derived.map((row) => ({ ...row, code: "HUB-NEW" }));
  assert.deepEqual(retriedRows, [{ ...expectedRow, code: "HUB-NEW" }]);
  assert.deepEqual(deriveRemediationRows([failedRow], []), [expectedRow]);
});

test("remediation JSON keeps actual fields when correcting platform rows", () => {
  const rows = parseRemediationRows(JSON.stringify([
    { code: "ACME-UPDATED", name: "Acme", description: "unchanged" },
    { code: "SCOOTER", name: "Scooter", categoryCode: "2W", energyType: "ELECTRIC" },
  ]));

  assert.deepEqual(rows, [
    { code: "ACME-UPDATED", name: "Acme", description: "unchanged" },
    { code: "SCOOTER", name: "Scooter", categoryCode: "2W", energyType: "ELECTRIC" },
  ]);
});

test("fleet workbook keeps IoT credentials in ephemeral download state only", () => {
  const source = readFileSync(new URL("../../../../src/app/client/page.tsx", import.meta.url), "utf8");
  const flowStart = source.indexOf("const bulkCreateJobBacked = async () => {");
  const flowEnd = source.indexOf("const downloadIotCredentials", flowStart);
  const flow = source.slice(flowStart, flowEnd);
  const retryStart = source.indexOf("onRetry={async (rows) => {", source.indexOf("importJobs.map"));
  const retryEnd = source.indexOf("}} />", retryStart);
  const retry = source.slice(retryStart, retryEnd);

  assert.match(source, /type ImportResult = .*ingestCredentials\?: Array<\{ deviceNumber: string; ingestSecret: string \}>/);
  assert.match(flow, /setImportedIotCredentials\(\[\]\)/);
  assert.match(flow, /const iotResult = await request\("\/iot\/devices\/bulk"/);
  assert.match(flow, /const \{ ingestCredentials, \.\.\.iotResultWithoutCredentials \} = iotResult;/);
  assert.match(flow, /setImportedIotCredentials\(ingestCredentials \?\? \[\]\)/);
  assert.match(flow, /results\.push\(\{ entity: "iot", result: iotResultWithoutCredentials \}\)/);
  assert.doesNotMatch(flow, /onSaved\(\)/);
  assert.match(source, /onClick=\{onSaved\}>\s*Continue to Rider creation/);
  assert.match(retry, /const \{ ingestCredentials: retryCredentials, \.\.\.retryResultWithoutCredentials \} = next;/);
  assert.match(retry, /setImportedIotCredentials\(\(current\) => \[\.\.\.current, \.\.\.\(retryCredentials \?\? \[\]\)\]\)/);
  assert.match(retry, /result: retryResultWithoutCredentials/);
  assert.doesNotMatch(source, /localStorage\.[^\n]*ingestCredentials/);
});

test("platform import history uses created then passedRows counts for initial and retry responses", () => {
  const source = readFileSync(new URL("../../../../src/app/platform/dashboard/page.tsx", import.meta.url), "utf8");
  const recordStart = source.indexOf("function recordBulkImport");
  const recordEnd = source.indexOf("async function uploadOemCsv", recordStart);
  const record = source.slice(recordStart, recordEnd);

  assert.match(record, /result: \{ created\?: number; passedRows\?: number;/);
  assert.match(record, /const passedRows = result\.created \?\? result\.passedRows \?\? 0;/);
  assert.match(source, /recordBulkImport\(entry\.entity, `\$\{entry\.fileName\} \(retry\)`, rows\.length, result\);/);
  assert.doesNotMatch(source, /created: result\.passedRows/);
});

test("platform retry renders the shared JSON editor instead of a name-only input", () => {
  const source = readFileSync(new URL("../../../../src/app/platform/dashboard/page.tsx", import.meta.url), "utf8");
  const workspaceStart = source.indexOf("function BulkImportWorkspace");
  const workspace = source.slice(workspaceStart);

  assert.match(source, /import \{ ImportFailureRemediation \} from "\.\.\/\.\.\/components\/import-failure-remediation"/);
  assert.doesNotMatch(workspace, /const \[retryRows/);
  assert.doesNotMatch(workspace, /row\.name \?\? row\.code/);
  assert.match(workspace, /const editingEntry = editing \? history\.find\(\(item\) => item\.id === editing\) : undefined;/);
  assert.match(workspace, /<ImportFailureRemediation/);
  assert.match(workspace, /correctedRows=\{editingEntry\.failures\?\.flatMap/);
  assert.match(workspace, /await onRetry\(editingEntry, rows\); setEditing\(null\);/);
  assert.match(source, /setError\(message\);\s*throw cause instanceof Error \? cause : new Error\(message\);/);
});
