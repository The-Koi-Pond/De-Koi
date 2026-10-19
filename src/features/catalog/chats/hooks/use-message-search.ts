import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { messageSearchApi, type MessageSearchMode } from "../../../../shared/api/message-search-api";
import { chatKeys } from "../query-keys";

/** Queries shorter than this only filter chat names; message text search starts here. */
export const MESSAGE_SEARCH_MIN_CHARS = 2;
const MESSAGE_SEARCH_DEBOUNCE_MS = 250;

/** Debounced text search over saved messages in one chat mode, newest match first. */
export function useMessageSearch(query: string, mode: MessageSearchMode, enabled = true) {
  const trimmed = query.trim();
  const [debounced, setDebounced] = useState(trimmed);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(trimmed), MESSAGE_SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [trimmed]);
  const active = enabled && debounced.length >= MESSAGE_SEARCH_MIN_CHARS;
  const result = useQuery({
    queryKey: [...chatKeys.all, "message-search", mode, debounced] as const,
    queryFn: ({ signal }) => messageSearchApi.search({ query: debounced, mode, limit: 50 }, signal),
    enabled: active,
    staleTime: 15_000,
    placeholderData: keepPreviousData,
  });
  return {
    ...result,
    active,
    /** True while the typed query has not reached the server yet. */
    settling: trimmed !== debounced,
  };
}
