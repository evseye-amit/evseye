"use client";

import { createContext, useContext, useEffect, type Dispatch, type SetStateAction } from "react";

export const PanelLoadingContext = createContext<Dispatch<SetStateAction<boolean>> | null>(null);

// The active panel reports background work without coupling its data loader to the shell.
export function usePanelLoading(loading: boolean) {
  const report = useContext(PanelLoadingContext);
  useEffect(() => {
    report?.(loading);
    return () => report?.(false);
  }, [loading, report]);
}
