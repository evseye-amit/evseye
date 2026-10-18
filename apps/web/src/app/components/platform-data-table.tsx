"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useId, useRef, useState, type ReactNode } from "react";
import { useLocale } from "./locale-provider";
import {
  filterRows, getColumnFilterOptions, getSelectOptions, hasInvalidNumberRange,
  type ColumnFilterSpec, type ColumnFilterState, type ColumnFilterStateMap,
} from "../platform/dashboard/data-table-filter";

const TABLE_CELL_LINE_LIMIT = 80;

function renderTableCellContent(cell: ReactNode) {
  if (typeof cell !== "string" || cell.length <= TABLE_CELL_LINE_LIMIT) {
    return cell;
  }

  const lines: string[] = [];
  let currentLine = "";

  for (const word of cell.trim().split(/\s+/)) {
    if (
      currentLine.length > 0 &&
      currentLine.length + word.length + 1 > TABLE_CELL_LINE_LIMIT
    ) {
      lines.push(currentLine);
      currentLine = word;
    } else {
      currentLine = currentLine ? `${currentLine} ${word}` : word;
    }
  }

  if (currentLine) {
    lines.push(currentLine);
  }

  return lines.map((line, index) => (
    <span key={`${index}-${line}`}>
      {line}
      {index < lines.length - 1 && <br />}
    </span>
  ));
}

export function PlatformDataTable({
  headings,
  rows,
  columnFilters = [],
  nonSortableColumns = [],
  columnFiltersMinimumRows = 10,
  disablePageSizeAtOrBelow = 10,
}: {
  headings: string[];
  rows: any[][];
  columnFilters?: readonly ColumnFilterSpec[];
  nonSortableColumns?: readonly number[];
  columnFiltersMinimumRows?: number;
  disablePageSizeAtOrBelow?: number;
}) {
  const { t } = useLocale();
  const [pageSize, setPageSize] = useState(10);
  const searchId = useId();
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [columnFilterStates, setColumnFilterStates] =
    useState<ColumnFilterStateMap>({});
  const [columnFilterSearches, setColumnFilterSearches] = useState<
    Record<number, string>
  >({});
  const [openColumnFilter, setOpenColumnFilter] = useState<number | null>(
    null,
  );
  const [sort, setSort] = useState<{
    columnIndex: number;
    direction: "ascending" | "descending";
  } | null>(null);
  const normalizedQuery = query.trim().toLowerCase();
  const filteredRows = normalizedQuery
    ? rows.filter((row) =>
        row.some(
          (cell) =>
            (typeof cell === "string" || typeof cell === "number") &&
            String(cell).toLowerCase().includes(normalizedQuery),
        ),
      )
    : rows;
  const effectiveColumnFilters =
    rows.length > columnFiltersMinimumRows
      ? columnFilters.map((filter, columnIndex) =>
          headings[columnIndex]?.trim().toLowerCase() === "description"
            ? null
            : filter,
        )
      : [];
  const columnFilterResult = filterRows(
    filteredRows,
    effectiveColumnFilters,
    columnFilterStates,
  );
  const filteredColumnRows = columnFilterResult.rows;
  const activeFilterCount = columnFilterResult.activeCount;
  const sortedRows = sort
    ? filteredColumnRows
        .map((row, index) => ({ row, index }))
        .sort((left, right) => {
          const leftValue = left.row[sort.columnIndex];
          const rightValue = right.row[sort.columnIndex];
          const leftMissing =
            leftValue === null ||
            leftValue === undefined ||
            (typeof leftValue === "string" &&
              (leftValue.trim().length === 0 || leftValue === "—")) ||
            (typeof leftValue !== "string" && typeof leftValue !== "number") ||
            (typeof leftValue === "number" && Number.isNaN(leftValue));
          const rightMissing =
            rightValue === null ||
            rightValue === undefined ||
            (typeof rightValue === "string" &&
              (rightValue.trim().length === 0 || rightValue === "—")) ||
            (typeof rightValue !== "string" && typeof rightValue !== "number") ||
            (typeof rightValue === "number" && Number.isNaN(rightValue));
          let comparison = 0;
          if (leftMissing !== rightMissing) {
            comparison = leftMissing ? 1 : -1;
          } else if (!leftMissing && !rightMissing) {
            comparison =
              typeof leftValue === "number" &&
              typeof rightValue === "number"
                ? leftValue - rightValue
                : String(leftValue).localeCompare(String(rightValue), undefined, {
                    numeric: true,
                    sensitivity: "base",
                  });
          }
          if (comparison === 0) return left.index - right.index;
          return sort.direction === "ascending" ? comparison : -comparison;
        })
        .map(({ row }) => row)
    : filteredColumnRows;
  const pageCount = Math.max(1, Math.ceil(sortedRows.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const pageRows = sortedRows.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize,
  );
  const hasColumnFilters = effectiveColumnFilters.some(Boolean);
  const updateColumnFilter = (
    columnIndex: number,
    state: ColumnFilterState,
  ) => {
    setColumnFilterStates((current) => ({
      ...current,
      [columnIndex]: state,
    }));
    setPage(1);
  };
  const clearColumnFilter = (columnIndex: number) => {
    updateColumnFilter(columnIndex, {});
    setColumnFilterSearches((current) => ({ ...current, [columnIndex]: "" }));
    setOpenColumnFilter(null);
  };
  const renderColumnFilter = (columnIndex: number, mobile: boolean) => {
    const spec = effectiveColumnFilters[columnIndex];
    if (!spec) return null;
    const heading = headings[columnIndex] || `Column ${columnIndex + 1}`;
    const state = columnFilterStates[columnIndex] ?? {};
    const id = `${searchId}-filter-${columnIndex}-${mobile ? "mobile" : "desktop"}`;
    if (spec.type === "text" || spec.type === "select") {
      const selectedValues = state.values ??
        (state.text ? [state.text] : state.value ? [state.value] : []);
      const filterQuery = columnFilterSearches[columnIndex] ?? "";
      const allOptions =
        spec.type === "select"
          ? getSelectOptions(rows, columnIndex, spec)
          : getColumnFilterOptions(rows, columnIndex);
      const options = allOptions.filter((option) =>
        String(option).toLowerCase().includes(filterQuery.trim().toLowerCase()),
      );
      const toggleValue = (value: string) => {
        const nextValues = selectedValues.includes(value)
          ? selectedValues.filter((selected) => selected !== value)
          : [...selectedValues, value];
        updateColumnFilter(columnIndex, { values: nextValues });
      };
      return (
        <div className="sa-table-filter-field sa-table-multiselect">
          <span>Filter by {heading}</span>
          <div className="sa-table-multiselect-control">
            <input
              id={id}
              type="search"
              role="combobox"
              aria-autocomplete="list"
              aria-controls={`${id}-options`}
              value={filterQuery}
              placeholder={`Select ${heading}`}
              aria-label={`Search ${heading} filter options`}
              aria-expanded={openColumnFilter === columnIndex}
              onFocus={() => setOpenColumnFilter(columnIndex)}
              onChange={(event) => {
                const value = event.currentTarget.value;
                setColumnFilterSearches((current) => ({
                  ...current,
                  [columnIndex]: value,
                }));
                setOpenColumnFilter(columnIndex);
              }}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.currentTarget.blur();
                  setOpenColumnFilter(null);
                }
              }}
            />
            <button
              type="button"
              className="sa-table-filter-toggle"
              aria-label={`${openColumnFilter === columnIndex ? "Hide" : "Show"} ${heading} filter options`}
              aria-expanded={openColumnFilter === columnIndex}
              onClick={() =>
                setOpenColumnFilter((current) =>
                  current === columnIndex ? null : columnIndex,
                )
              }
            >
              {openColumnFilter === columnIndex ? "⌃" : "⌄"}
            </button>
            {selectedValues.length > 0 && (
              <button
                type="button"
                className="sa-table-filter-clear-one"
                aria-label={`Clear ${heading} filter`}
                onClick={() => clearColumnFilter(columnIndex)}
              >
                ×
              </button>
            )}
          </div>
          {selectedValues.length > 0 && (
            <div className="sa-table-filter-values">
              {selectedValues.map((value) => (
                <button
                  type="button"
                  key={value}
                  aria-label={`Remove ${value} from ${heading} filter`}
                  onClick={() => toggleValue(value)}
                >
                  {value} ×
                </button>
              ))}
            </div>
          )}
          {openColumnFilter === columnIndex && (
            <div id={`${id}-options`} className="sa-table-filter-options" role="listbox" aria-label={`${heading} options`}>
              {options.length ? (
                options.map((option) => {
                  const value = String(option);
                  const selected = selectedValues.includes(value);
                  return (
                    <button
                      key={value}
                      type="button"
                      role="option"
                      aria-selected={selected}
                      className={selected ? "selected" : ""}
                      onClick={() => toggleValue(value)}
                    >
                      <span>{selected ? "✓" : ""}</span>
                      {value}
                    </button>
                  );
                })
              ) : (
                <span className="sa-table-filter-empty">No matches</span>
              )}
            </div>
          )}
        </div>
      );
    }
    const invalidRange = hasInvalidNumberRange(state);
    const minId = `${id}-min`;
    const maxId = `${id}-max`;
    return (
      <fieldset
        className="sa-table-filter-field sa-table-filter-number"
        aria-label={`Filter by ${heading}`}
      >
        <legend>Filter by {heading}</legend>
        <div className="sa-table-filter-range">
          <label htmlFor={minId}>
            <span>Minimum {heading}</span>
            <input
              id={minId}
              type="number"
              step="any"
              placeholder="Min"
              value={state.min ?? ""}
              aria-label={`Minimum ${heading}`}
              aria-invalid={invalidRange || undefined}
              onChange={(event) =>
                updateColumnFilter(columnIndex, {
                  ...state,
                  min: event.currentTarget.value,
                })
              }
            />
          </label>
          <label htmlFor={maxId}>
            <span>Maximum {heading}</span>
            <input
              id={maxId}
              type="number"
              step="any"
              placeholder="Max"
              value={state.max ?? ""}
              aria-label={`Maximum ${heading}`}
              aria-invalid={invalidRange || undefined}
              onChange={(event) =>
                updateColumnFilter(columnIndex, {
                  ...state,
                  max: event.currentTarget.value,
                })
              }
            />
          </label>
        </div>
        {invalidRange && (
          <span className="sa-table-filter-error" role="alert">
            Minimum must not exceed maximum.
          </span>
        )}
      </fieldset>
    );
  };

  return (
    <div>
      <div className="sa-table-toolbar">
        <div className="sa-table-search">
          <label htmlFor={searchId}>{t("Search this table")}</label>
          <div className="sa-table-search-control">
            <input
              id={searchId}
              ref={searchInputRef}
              type="search"
              value={query}
              placeholder={t("Search this table")}
              onChange={(event) => {
                setQuery(event.currentTarget.value);
                setPage(1);
              }}
            />
            {normalizedQuery && (
              <button
                type="button"
                className="secondary sa-table-search-clear"
                aria-label="Clear table search"
                onClick={() => {
                  setQuery("");
                  setPage(1);
                  searchInputRef.current?.focus();
                }}
              >
                {t("Clear")}
              </button>
            )}
          </div>
        </div>
        <div className="sa-table-toolbar-meta">
          <span
            className="sa-table-result-count"
            role="status"
            aria-live="polite"
          >
            {filteredColumnRows.length}{" "}
            {t(filteredColumnRows.length === 1 ? "result" : "results")}
          </span>
          <label className="sa-table-page-size">
            {t("Rows per page")}
            <select
              value={pageSize}
              disabled={
                disablePageSizeAtOrBelow !== undefined &&
                rows.length <= disablePageSizeAtOrBelow
              }
              onChange={(event) => {
                setPageSize(Number(event.currentTarget.value));
                setPage(1);
              }}
            >
              {[10, 25, 50, 100].map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
          </label>
          {activeFilterCount > 0 && (
            <button
              type="button"
              className="secondary sa-table-filter-clear"
              onClick={() => {
                setColumnFilterStates({});
                setPage(1);
              }}
            >
              {t("Clear all")} ({activeFilterCount})
            </button>
          )}
        </div>
      </div>
      {hasColumnFilters && (
        <details className="sa-table-filter-panel">
          <summary>
            {t("Filters")}{activeFilterCount ? ` (${activeFilterCount})` : ""}
          </summary>
          <div className="sa-table-filter-panel-fields">
            {headings.map((heading, columnIndex) => (
              <div key={`${heading}-${columnIndex}`}>
                {renderColumnFilter(columnIndex, true)}
              </div>
            ))}
            {activeFilterCount > 0 && (
              <button
                type="button"
                className="secondary sa-table-filter-clear"
                onClick={() => {
                  setColumnFilterStates({});
                  setPage(1);
                }}
              >
                {t("Clear all")} ({activeFilterCount})
              </button>
            )}
          </div>
        </details>
      )}
      <div className="sa-table-wrap">
        <table>
          <thead>
            <tr>
              {headings.map((heading, headingIndex) => {
                const normalizedHeading = heading.trim().toLowerCase();
                const isActionColumn =
                  normalizedHeading.length === 0 || normalizedHeading === "actions";
                const sortable =
                  normalizedHeading.length > 0 &&
                  normalizedHeading !== "description" &&
                  normalizedHeading !== "order" &&
                  normalizedHeading !== "display order" &&
                  !nonSortableColumns.includes(headingIndex);
                const active = sort?.columnIndex === headingIndex;
                const direction = active ? sort.direction : "none";
                const nextDirection =
                  active && sort.direction === "ascending"
                    ? "descending"
                    : "ascending";
                return (
                  <th
                    key={`${heading}-${headingIndex}`}
                    className={
                      isActionColumn ? "sa-table-action-cell" : undefined
                    }
                    aria-sort={sortable ? direction : undefined}
                  >
                    {sortable ? (
                      <button
                        type="button"
                        className="sa-table-sort"
                        aria-label={`Sort by ${heading} ${nextDirection}`}
                        title={`Sort by ${heading} ${nextDirection}`}
                        onClick={() => {
                          setSort((current) => ({
                            columnIndex: headingIndex,
                            direction:
                              current?.columnIndex === headingIndex &&
                              current.direction === "ascending"
                                ? "descending"
                                : "ascending",
                          }));
                          setPage(1);
                        }}
                      >
                        <span>{t(heading)}</span>
                        <span className="sa-table-sort-indicator" aria-hidden="true">
                          {active
                            ? sort.direction === "ascending"
                              ? "↑"
                              : "↓"
                            : "↕"}
                        </span>
                      </button>
                    ) : (
                      <span>{t(heading)}</span>
                    )}
                  </th>
                );
              })}
            </tr>
            {hasColumnFilters && (
              <tr className="sa-table-filter-row">
                {headings.map((heading, columnIndex) => (
                  <th key={`${heading}-${columnIndex}`}>
                    {renderColumnFilter(columnIndex, false)}
                  </th>
                ))}
              </tr>
            )}
          </thead>
          <tbody>
            {pageRows.length ? (
              pageRows.map((row, index) => (
                <tr key={(currentPage - 1) * pageSize + index}>
                  {row.map((cell, cellIndex) => (
                    <td
                      key={cellIndex}
                      className={
                        headings[cellIndex]?.trim().length === 0 ||
                        headings[cellIndex]?.trim().toLowerCase() === "actions"
                          ? "sa-table-action-cell"
                          : undefined
                      }
                    >
                      <div className="sa-table-cell-content">
                        {renderTableCellContent(cell)}
                      </div>
                    </td>
                  ))}
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={headings.length}>
                  {t(rows.length ? "No matching records." : "No records yet.")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {filteredColumnRows.length > pageSize && (
        <div className="sa-pagination" aria-label="Table pagination">
          <span>
            {t("Showing")} {(currentPage - 1) * pageSize + 1}–
            {Math.min(currentPage * pageSize, filteredColumnRows.length)} {t("of")}{" "}
            {filteredColumnRows.length}
          </span>
          <div>
            <button
              className="secondary"
              disabled={currentPage === 1}
              onClick={() => setPage((value) => Math.max(1, value - 1))}
            >
              {t("Previous")}
            </button>
            <span>
              {t("Page")} {currentPage} {t("of")} {pageCount}
            </span>
            <button
              className="secondary"
              disabled={currentPage === pageCount}
              onClick={() => setPage((value) => Math.min(pageCount, value + 1))}
            >
              {t("Next")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
