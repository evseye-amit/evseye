"use client";

import { useId, useRef, useState, type ReactNode } from "react";
import { useTableViewState, defaultTablePreferences, isTablePreferences } from "./table-view-state";
import { useLocale } from "./locale-provider";

export type ClientColumn<Row> = {
  key: string;
  label: string;
  value: (row: Row) => string | number;
  render?: (row: Row) => ReactNode;
  filterOptions?: string[];
  sortable?: boolean;
};

export type ClientTableServer = {
  page: number; limit: number; total: number; search: string;
  sort?: { key: string; direction: "ascending" | "descending" };
  onSearch: (value: string) => void; onPage: (page: number) => void; onLimit?: (limit: number) => void;
  onSort?: (sort: { key: string; direction: "ascending" | "descending" }) => void;
};

export function ClientDataTable<Row>({
  rows, columns, actions, getRowId, emptyMessage = "No records match this view.", server, loading = false, searchable = true, pagination = true, sortable = true, filterable = true, stateKey,
}: {
  stateKey?: string;
  loading?: boolean;
  searchable?: boolean;
  pagination?: boolean;
  sortable?: boolean;
  filterable?: boolean;
  rows: Row[];
  server?: ClientTableServer;
  columns: ClientColumn<Row>[];
  actions?: (row: Row) => ReactNode;
  getRowId: (row: Row) => string;
  emptyMessage?: string;
}) {
  const { t } = useLocale();
  const searchId = useId();
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [preferences, setPreferences, ready] = useTableViewState(stateKey, defaultTablePreferences, isTablePreferences);
  const query = server?.search ?? preferences.search;
  const setQuery = (value: string) => server ? server.onSearch(value) : setPreferences((p) => ({ ...p, search: value }));
  const filters = preferences.filters;
  const setFilters = (update: Record<string, string[]> | ((current: Record<string, string[]>) => Record<string, string[]>)) => setPreferences((p) => ({ ...p, filters: typeof update === "function" ? update(p.filters) : update }));
  const [filterSearches, setFilterSearches] = useState<Record<string, string>>({});
  const [openFilter, setOpenFilter] = useState<string | null>(null);
  const sort = server ? server.sort : preferences.sort;
  const setLocalSort = (value: NonNullable<typeof preferences.sort>) => setPreferences((p) => ({ ...p, sort: value }));
  const pageSize = server?.limit ?? preferences.limit;
  const setPageSize = (value: number) => server ? server.onLimit?.(value) : setPreferences((p) => ({ ...p, limit: value }));
  const page = preferences.page;
  const setPage = (value: number) => server ? server.onPage(value) : setPreferences((p) => ({ ...p, page: value }));
  const hasColumnFilters = filterable && !server && (rows.length >= 10 || Object.values(filters).some((values) => values.length > 0));
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const filteredRows = server ? rows : rows.filter((row) =>
    (!normalizedQuery || columns.some((column) => String(column.value(row)).toLocaleLowerCase().includes(normalizedQuery))) &&
    (!hasColumnFilters || columns.every((column) => !filters[column.key]?.length || filters[column.key].includes(String(column.value(row))))),
  );
  const sortedRows = !server && sort ? [...filteredRows].sort((left, right) => {
    const column = columns.find((entry) => entry.key === sort.key);
    if (!column) return 0;
    const a = column.value(left);
    const b = column.value(right);
    const comparison = typeof a === "number" && typeof b === "number"
      ? a - b : String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" });
    return sort.direction === "ascending" ? comparison : -comparison;
  }) : filteredRows;
  const activeFilterCount = hasColumnFilters ? Object.values(filters).filter((values) => values.length > 0).length : 0;
  const total = server?.total ?? sortedRows.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const currentPage = server?.page ?? Math.min(page, pageCount);
  const visible = server || !pagination ? sortedRows : sortedRows.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const toggleValue = (key: string, value: string) => {
    setFilters((current) => {
      const selected = current[key] ?? [];
      return { ...current, [key]: selected.includes(value) ? selected.filter((item) => item !== value) : [...selected, value] };
    });
    setPage(1);
  };
  const renderFilter = (column: ClientColumn<Row>, mobile: boolean) => {
    const selected = filters[column.key] ?? [];
    const search = filterSearches[column.key] ?? "";
    const allOptions = column.filterOptions ??
      [...new Set(rows.map((row) => String(column.value(row))))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }));
    const options = allOptions.filter((option) => option.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
    const id = `${searchId}-${column.key}-${mobile ? "mobile" : "desktop"}`;
    return <div className="sa-table-filter-field sa-table-multiselect">
      <span>{t("Filter by")} {t(column.label)}</span>
      <div className="sa-table-multiselect-control">
        <input id={id} type="search" value={search} placeholder={`${t("Select")} ${t(column.label)}`} aria-label={`Search ${column.label} filter options`} onFocus={() => setOpenFilter(column.key)} onChange={(event) => { setFilterSearches((current) => ({ ...current, [column.key]: event.target.value })); setOpenFilter(column.key); }} onKeyDown={(event) => { if (event.key === "Escape") { event.currentTarget.blur(); setOpenFilter(null); } }} />
        <button type="button" className="sa-table-filter-toggle" aria-label={`${openFilter === column.key ? "Hide" : "Show"} ${column.label} filter options`} aria-expanded={openFilter === column.key} onClick={() => setOpenFilter((current) => current === column.key ? null : column.key)}>{openFilter === column.key ? "⌃" : "⌄"}</button>
        {selected.length > 0 && <button type="button" className="sa-table-filter-clear-one" aria-label={`Clear ${column.label} filter`} onClick={() => { setFilters((current) => ({ ...current, [column.key]: [] })); setFilterSearches((current) => ({ ...current, [column.key]: "" })); setOpenFilter(null); setPage(1); }}>×</button>}
      </div>
      {selected.length > 0 && <div className="sa-table-filter-values">{selected.map((value) => <button type="button" key={value} aria-label={`Remove ${value} from ${column.label} filter`} onClick={() => toggleValue(column.key, value)}>{value} ×</button>)}</div>}
      {openFilter === column.key && <div className="sa-table-filter-options" role="listbox" aria-label={`${column.label} options`}>{options.length ? options.map((value) => <button type="button" key={value} role="option" aria-selected={selected.includes(value)} className={selected.includes(value) ? "selected" : ""} onClick={() => toggleValue(column.key, value)}><span>{selected.includes(value) ? "✓" : ""}</span>{value}</button>) : <span className="sa-table-filter-empty">{t("No matches")}</span>}</div>}
    </div>;
  };
  if (!ready) return <p role="status">{t("Loading table preferences…")}</p>;
  return <div className="client-data-table" aria-busy={loading}>
    {loading && <p className="muted" role="status">{t("Loading current data…")}</p>}
    <div className="sa-table-toolbar">
      {searchable && <div className="sa-table-search"><label htmlFor={searchId}>{t("Search this table")}</label><div className="sa-table-search-control"><input id={searchId} ref={searchInputRef} type="search" value={query} placeholder={t("Search this table")} onChange={(event) => { setQuery(event.target.value); setPage(1); }} />{query && <button type="button" className="secondary sa-table-search-clear" aria-label="Clear table search" onClick={() => { setQuery(""); setPage(1); searchInputRef.current?.focus(); }}>{t("Clear")}</button>}</div></div>}
      <div className="sa-table-toolbar-meta"><span className="sa-table-result-count" role="status" aria-live="polite">{total} {t(total === 1 ? "result" : "results")}</span>{pagination && (!server || server.onLimit) && <label className="sa-table-page-size">{t("Rows per page")}<select value={pageSize} disabled={loading || total <= 10} onChange={(event) => { setPageSize(Number(event.target.value)); setPage(1); }}>{[10, 25, 50, 100].map((size) => <option key={size} value={size}>{size}</option>)}</select></label>}{!server && (query || activeFilterCount > 0 || sort) && <button type="button" className="secondary sa-table-filter-clear" onClick={() => { setPreferences({ ...defaultTablePreferences, limit: pageSize }); setFilterSearches({}); setOpenFilter(null); }}>{t("Reset filters")}</button>}</div>
    </div>
    {hasColumnFilters && <details className="sa-table-filter-panel"><summary>{t("Filters")}{activeFilterCount ? ` (${activeFilterCount})` : ""}</summary><div className="sa-table-filter-panel-fields">{columns.map((column) => <div key={column.key}>{renderFilter(column, true)}</div>)}</div></details>}
    <div className="sa-table-wrap"><table><thead><tr>{columns.map((column) => <th key={column.key} aria-sort={sortable && column.sortable !== false && (!server || server.onSort) ? sort?.key === column.key ? sort.direction : "none" : undefined}>{(!sortable || column.sortable === false || (server && !server.onSort)) ? <span className="sa-table-heading">{t(column.label)}</span> : <button type="button" className="sa-table-sort" aria-label={`Sort by ${column.label} ${sort?.key === column.key && sort.direction === "ascending" ? "descending" : "ascending"}`} onClick={() => { const next = { key: column.key, direction: (sort?.key === column.key && sort.direction === "ascending" ? "descending" : "ascending") as "ascending" | "descending" }; if (server) server.onSort?.(next); else setLocalSort(next); setPage(1); }}><span>{t(column.label)}</span><span className="sa-table-sort-indicator" aria-hidden="true">{server && !server.onSort ? "" : sort?.key === column.key ? sort.direction === "ascending" ? "↑" : "↓" : "↕"}</span></button>}</th>)}{actions && <th className="sa-table-action-cell">{t("Actions")}</th>}</tr>{hasColumnFilters && <tr className="sa-table-filter-row">{columns.map((column) => <th key={column.key}>{renderFilter(column, false)}</th>)}{actions && <th className="sa-table-action-cell" />}</tr>}</thead><tbody>{visible.map((row) => <tr key={getRowId(row)}>{columns.map((column) => <td key={column.key}>{column.render ? column.render(row) : String(column.value(row))}</td>)}{actions && <td className="sa-table-action-cell"><div className="row-actions">{actions(row)}</div></td>}</tr>)}{visible.length === 0 && <tr><td colSpan={columns.length + (actions ? 1 : 0)}>{loading ? t("Loading current data…") : rows.length ? t("No matching records.") : t(emptyMessage)}</td></tr>}</tbody></table></div>
    {pagination && total > 0 && <div className="sa-pagination" aria-label="Table pagination"><span>{t("Showing")} {(currentPage - 1) * pageSize + 1}–{Math.min(currentPage * pageSize, total)} {t("of")} {total}</span><div><button type="button" className="secondary" disabled={loading || currentPage === 1} onClick={() => setPage(currentPage - 1)}>{t("Previous")}</button><span>{t("Page")} {currentPage} {t("of")} {pageCount}</span><button type="button" className="secondary" disabled={loading || currentPage >= pageCount} onClick={() => setPage(currentPage + 1)}>{t("Next")}</button></div></div>}
  </div>;
}
