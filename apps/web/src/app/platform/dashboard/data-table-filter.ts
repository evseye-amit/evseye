export type FilterableScalar = string | number;

export type ColumnFilterSpec =
  | { type: "text" }
  | { type: "select"; options?: readonly FilterableScalar[] }
  | { type: "number" }
  | null;

export type ColumnFilterState = {
  values?: string[];
  text?: string;
  value?: string;
  min?: string;
  max?: string;
};

export type ColumnFilterStateMap = Record<
  number,
  ColumnFilterState | undefined
>;

export type FilterRowsResult<Row> = {
  rows: Row[];
  activeCount: number;
  invalidRanges: number;
};

function isMissing(value: unknown): boolean {
  return (
    value === null ||
    value === undefined ||
    (typeof value === "string" &&
      (value.trim().length === 0 || value === "—")) ||
    (typeof value !== "string" && typeof value !== "number") ||
    (typeof value === "number" && !Number.isFinite(value))
  );
}

function asScalar(value: unknown): FilterableScalar | undefined {
  return isMissing(value) ||
    (typeof value !== "string" && typeof value !== "number")
    ? undefined
    : value;
}

function parseBound(value: string | undefined): number | undefined {
  if (!value?.trim()) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function hasInvalidNumberRange(
  state: ColumnFilterState | undefined,
): boolean {
  if (!state) return false;
  const min = parseBound(state.min);
  const max = parseBound(state.max);
  return min !== undefined && max !== undefined && min > max;
}

function isActive(
  spec: ColumnFilterSpec,
  state: ColumnFilterState | undefined,
) {
  if (!spec || !state) return false;
  if (spec.type === "text" || spec.type === "select") {
    return Boolean(
      state.values?.length || state.text?.trim() || state.value,
    );
  }
  return Boolean(state.min?.trim() || state.max?.trim());
}

function matches(
  value: unknown,
  spec: Exclude<ColumnFilterSpec, null>,
  state: ColumnFilterState,
): boolean {
  const scalar = asScalar(value);
  if (spec.type === "text") {
    if (state.values?.length) {
      return (
        scalar !== undefined &&
        state.values.some(
          (selected) => String(scalar).toLowerCase() === selected.toLowerCase(),
        )
      );
    }
    const query = state.text?.trim().toLowerCase();
    return (
      !query ||
      (scalar !== undefined && String(scalar).toLowerCase().includes(query))
    );
  }
  if (spec.type === "select") {
    if (state.values?.length) {
      return (
        scalar !== undefined && state.values.includes(String(scalar))
      );
    }
    return (
      !state.value || (scalar !== undefined && String(scalar) === state.value)
    );
  }
  if (typeof value !== "number" || !Number.isFinite(value)) return false;
  const min = parseBound(state.min);
  const max = parseBound(state.max);
  return (
    (min === undefined || value >= min) && (max === undefined || value <= max)
  );
}

export function filterRows<Row extends readonly unknown[]>(
  rows: readonly Row[],
  specs: readonly ColumnFilterSpec[] | undefined,
  states: ColumnFilterStateMap,
): FilterRowsResult<Row> {
  let activeCount = 0;
  let invalidRanges = 0;
  const active = (specs ?? []).flatMap((spec, columnIndex) => {
    const state = states[columnIndex];
    if (!isActive(spec, state)) return [];
    activeCount += 1;
    if (spec?.type === "number") {
      if (hasInvalidNumberRange(state)) invalidRanges += 1;
    }
    return spec && state ? [{ columnIndex, spec, state }] : [];
  });
  if (!active.length) return { rows: [...rows], activeCount, invalidRanges };
  return {
    rows: rows.filter((row) =>
      active.every(({ columnIndex, spec, state }) =>
        matches(row[columnIndex], spec, state),
      ),
    ),
    activeCount,
    invalidRanges,
  };
}

export function getSelectOptions<Row extends readonly unknown[]>(
  rows: readonly Row[],
  columnIndex: number,
  spec: Extract<ColumnFilterSpec, { type: "select" }>,
): FilterableScalar[] {
  if (spec.options) return [...spec.options];
  const options: FilterableScalar[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const value = asScalar(row[columnIndex]);
    if (value === undefined) continue;
    const key = String(value);
    if (seen.has(key)) continue;
    seen.add(key);
    options.push(value);
  }
  return options;
}

export function getColumnFilterOptions<Row extends readonly unknown[]>(
  rows: readonly Row[],
  columnIndex: number,
): FilterableScalar[] {
  return getSelectOptions(rows, columnIndex, { type: "select" });
}
