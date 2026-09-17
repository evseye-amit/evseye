"use client";

import { useId, useState, type ReactNode } from "react";

export type ClientColumn<Row> = {
  key: string;
  label: string;
  value: (row: Row) => string | number;
  render?: (row: Row) => ReactNode;
  filterOptions?: string[];
};

export function ClientDataTable<Row>({
  rows, columns, actions, getRowId, emptyMessage = "No records match this view.",
}: {
  rows: Row[];
  columns: ClientColumn<Row>[];
  actions?: (row: Row) => ReactNode;
  getRowId: (row: Row) => string;
  emptyMessage?: string;
}) {
  const searchId = useId();
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<Record<string, string[]>>({});
  const [filterSearches, setFilterSearches] = useState<Record<string, string>>({});
  const [openFilter, setOpenFilter] = useState<string | null>(null);
  const [sort, setSort] = useState<{ key: string; direction: "ascending" | "descending" } | null>(null);
  const [pageSize, setPageSize] = useState(10);
  const [page, setPage] = useState(1);
  const hasColumnFilters = rows.length >= 10;
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const filteredRows = rows.filter((row) =>
    (!normalizedQuery || columns.some((column) => String(column.value(row)).toLocaleLowerCase().includes(normalizedQuery))) &&
    (!hasColumnFilters || columns.every((column) => !filters[column.key]?.length || filters[column.key].includes(String(column.value(row))))),
  );
  const sortedRows = sort ? [...filteredRows].sort((left, right) => {
    const column = columns.find((entry) => entry.key === sort.key);
    if (!column) return 0;
    const a = column.value(left);
    const b = column.value(right);
    const comparison = typeof a === "number" && typeof b === "number"
      ? a - b : String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" });
    return sort.direction === "ascending" ? comparison : -comparison;
  }) : filteredRows;
  const activeFilterCount = hasColumnFilters ? Object.values(filters).filter((values) => values.length > 0).length : 0;
  const pageCount = Math.max(1, Math.ceil(sortedRows.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const visible = sortedRows.slice((currentPage - 1) * pageSize, currentPage * pageSize);
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
      <span>Filter by {column.label}</span>
      <div className="sa-table-multiselect-control">
        <input id={id} type="search" value={search} placeholder={`Select ${column.label}`} aria-label={`Search ${column.label} filter options`} onFocus={() => setOpenFilter(column.key)} onChange={(event) => { setFilterSearches((current) => ({ ...current, [column.key]: event.target.value })); setOpenFilter(column.key); }} onKeyDown={(event) => { if (event.key === "Escape") { event.currentTarget.blur(); setOpenFilter(null); } }} />
        <button type="button" className="sa-table-filter-toggle" aria-label={`${openFilter === column.key ? "Hide" : "Show"} ${column.label} filter options`} aria-expanded={openFilter === column.key} onClick={() => setOpenFilter((current) => current === column.key ? null : column.key)}>{openFilter === column.key ? "⌃" : "⌄"}</button>
        {selected.length > 0 && <button type="button" className="sa-table-filter-clear-one" aria-label={`Clear ${column.label} filter`} onClick={() => { setFilters((current) => ({ ...current, [column.key]: [] })); setFilterSearches((current) => ({ ...current, [column.key]: "" })); setOpenFilter(null); setPage(1); }}>×</button>}
      </div>
      {selected.length > 0 && <div className="sa-table-filter-values">{selected.map((value) => <button type="button" key={value} aria-label={`Remove ${value} from ${column.label} filter`} onClick={() => toggleValue(column.key, value)}>{value} ×</button>)}</div>}
      {openFilter === column.key && <div className="sa-table-filter-options" role="listbox" aria-label={`${column.label} options`}>{options.length ? options.map((value) => <button type="button" key={value} role="option" aria-selected={selected.includes(value)} className={selected.includes(value) ? "selected" : ""} onClick={() => toggleValue(column.key, value)}><span>{selected.includes(value) ? "✓" : ""}</span>{value}</button>) : <span className="sa-table-filter-empty">No matches</span>}</div>}
    </div>;
  };
  return <div className="client-data-table">
    <div className="sa-table-toolbar">
      <div className="sa-table-search"><label htmlFor={searchId}>Search this table</label><div className="sa-table-search-control"><input id={searchId} type="search" value={query} placeholder="Search this table" onChange={(event) => { setQuery(event.target.value); setPage(1); }} />{query && <button type="button" className="secondary sa-table-search-clear" onClick={() => { setQuery(""); setPage(1); }}>Clear</button>}</div></div>
      <div className="sa-table-toolbar-meta"><span className="sa-table-result-count" role="status" aria-live="polite">{filteredRows.length} {filteredRows.length === 1 ? "result" : "results"}</span><label className="sa-table-page-size">Rows per page<select value={pageSize} disabled={rows.length <= 10} onChange={(event) => { setPageSize(Number(event.target.value)); setPage(1); }}>{[10, 25, 50, 100].map((size) => <option key={size} value={size}>{size}</option>)}</select></label>{activeFilterCount > 0 && <button type="button" className="secondary sa-table-filter-clear" onClick={() => { setFilters({}); setPage(1); }}>Clear all ({activeFilterCount})</button>}</div>
    </div>
    {hasColumnFilters && <details className="sa-table-filter-panel"><summary>Filters{activeFilterCount ? ` (${activeFilterCount})` : ""}</summary><div className="sa-table-filter-panel-fields">{columns.map((column) => <div key={column.key}>{renderFilter(column, true)}</div>)}</div></details>}
    <div className="sa-table-wrap"><table><thead><tr>{columns.map((column) => <th key={column.key} aria-sort={sort?.key === column.key ? sort.direction : "none"}><button type="button" className="sa-table-sort" aria-label={`Sort by ${column.label} ${sort?.key === column.key && sort.direction === "ascending" ? "descending" : "ascending"}`} onClick={() => { setSort((current) => ({ key: column.key, direction: current?.key === column.key && current.direction === "ascending" ? "descending" : "ascending" })); setPage(1); }}><span>{column.label}</span><span className="sa-table-sort-indicator" aria-hidden="true">{sort?.key === column.key ? sort.direction === "ascending" ? "↑" : "↓" : "↕"}</span></button></th>)}{actions && <th className="sa-table-action-cell">Actions</th>}</tr>{hasColumnFilters && <tr className="sa-table-filter-row">{columns.map((column) => <th key={column.key}>{renderFilter(column, false)}</th>)}{actions && <th className="sa-table-action-cell" />}</tr>}</thead><tbody>{visible.map((row) => <tr key={getRowId(row)}>{columns.map((column) => <td key={column.key}>{column.render ? column.render(row) : String(column.value(row))}</td>)}{actions && <td className="sa-table-action-cell"><div className="row-actions">{actions(row)}</div></td>}</tr>)}{visible.length === 0 && <tr><td colSpan={columns.length + (actions ? 1 : 0)}>{rows.length ? "No matching records." : emptyMessage}</td></tr>}</tbody></table></div>
    {sortedRows.length > pageSize && <div className="sa-pagination"><span>{sortedRows.length ? (currentPage - 1) * pageSize + 1 : 0}–{Math.min(currentPage * pageSize, sortedRows.length)} of {sortedRows.length} records</span><div><button type="button" className="secondary" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}>Previous</button><span>Page {currentPage} of {pageCount}</span><button type="button" className="secondary" disabled={currentPage >= pageCount} onClick={() => setPage(currentPage + 1)}>Next</button></div></div>}
  </div>;
}
