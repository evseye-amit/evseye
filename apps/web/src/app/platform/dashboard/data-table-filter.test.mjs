import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { filterRows, getSelectOptions } from "./data-table-filter.ts";

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

test("Client Feature Usage maps Quantity to a numeric filter", () => {
  const source = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");
  const usageView = source.slice(
    source.indexOf("function ClientFeatureUsageView"),
    source.indexOf("function DataTable"),
  );

  assert.match(
    usageView,
    /columnFilters=\{\[\s*\{ type: "text" \},\s*\{ type: "text" \},\s*\{ type: "text" \},\s*\{ type: "number" \},\s*\{ type: "text" \},/,
  );
});

test("numeric controls keep full accessible names while desktop label text is hidden", () => {
  const page = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");
  const css = readFileSync(
    new URL("../../globals.css", import.meta.url),
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
