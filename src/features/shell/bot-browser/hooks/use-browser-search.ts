import { useEffect, useMemo, useRef, useState } from "react";

import { hasSearchText } from "../lib/providers/shared";
import type { BrowserProvider, SearchCriteria, SearchResult } from "../lib/providers/types";

/** How long typing waits before searching. */
const SEARCH_TYPING_DELAY_MS = 400;

export interface BrowserSearchState {
  loading: boolean;
  error: unknown;
  result: SearchResult | null;
}

/**
 * Runs the provider's search whenever the criteria change (after a short wait while there is search text, at once
 * otherwise) or, at once, when `refreshKey` moves. Only the newest search counts: a reply for criteria that are no
 * longer current changes nothing.
 */
export function useBrowserSearch(provider: BrowserProvider, criteria: SearchCriteria, refreshKey: number) {
  const [state, setState] = useState<BrowserSearchState>({ loading: true, error: null, result: null });
  const latestRun = useRef(0);
  const criteriaKey = useMemo(() => JSON.stringify(criteria), [criteria]);
  const criteriaRef = useRef(criteria);
  criteriaRef.current = criteria;

  useEffect(() => {
    setState({ loading: true, error: null, result: null });
  }, [provider]);

  // Refresh and Retry search again at once, even while there is search text.
  const lastCriteria = useRef<{ provider: BrowserProvider; key: string } | null>(null);

  useEffect(() => {
    const run = ++latestRun.current;
    const current = criteriaRef.current;
    const refreshOnly = lastCriteria.current?.provider === provider && lastCriteria.current.key === criteriaKey;
    lastCriteria.current = { provider, key: criteriaKey };
    setState((previous) => ({ ...previous, loading: true, error: null }));
    const start = () => {
      provider.search(current).then(
        (result) => {
          if (latestRun.current === run) setState({ loading: false, error: null, result });
        },
        (error: unknown) => {
          if (latestRun.current === run) setState({ loading: false, error, result: null });
        },
      );
    };
    if (refreshOnly || !hasSearchText(current)) {
      start();
      return;
    }
    const timer = setTimeout(start, SEARCH_TYPING_DELAY_MS);
    return () => clearTimeout(timer);
  }, [provider, criteriaKey, refreshKey]);

  return state;
}
