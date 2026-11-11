"use client";

import { useEffect, useState, type Dispatch, type SetStateAction } from "react";

// Store view preferences only, never record data. sessionStorage is isolated by host and tab.
export function useTableViewState<T extends object>(key: string | undefined, defaults: T, validate: (value: unknown) => value is T): [T, Dispatch<SetStateAction<T>>, boolean] {
  const [value, setValue] = useState(defaults);
  const [ready, setReady] = useState(!key);
  useEffect(() => {
    if (!key) return;
    const timer = window.setTimeout(() => {
    try {
      const stored: unknown = JSON.parse(sessionStorage.getItem(`evs-table:${key}`) ?? 'null');
      if (validate(stored)) setValue(stored);
    } catch { /* Storage may be disabled or an older preference may be invalid. */ }
    setReady(true);
    }, 0);
    return () => window.clearTimeout(timer);
    // Each keyed table has a stable preference schema during its lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  useEffect(() => {
    if (!key || !ready) return;
    try { sessionStorage.setItem(`evs-table:${key}`, JSON.stringify(value)); } catch { /* Optional preferences. */ }
  }, [key, ready, value]);
  return [value, setValue, ready];
}

export type TablePreferences = {
  search: string; filters: Record<string, string[]>; page: number; limit: number;
  sort: { key: string; direction: "ascending" | "descending" } | null;
};
export const defaultTablePreferences: TablePreferences = { search: "", filters: {}, page: 1, limit: 10, sort: null };
export function isTablePreferences(value: unknown): value is TablePreferences {
  if (!value || typeof value !== 'object') return false;
  const v = value as TablePreferences;
  return typeof v.search === 'string' && v.search.length <= 500 && Number.isInteger(v.page) && v.page > 0 &&
    [10,25,50,100].includes(v.limit) && !!v.filters && typeof v.filters === 'object' && !Array.isArray(v.filters) &&
    Object.values(v.filters).every((values) => Array.isArray(values) && values.every((entry) => typeof entry === 'string')) &&
    (v.sort === null || (!!v.sort && typeof v.sort.key === 'string' && ['ascending','descending'].includes(v.sort.direction)));
}
