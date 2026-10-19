// ──────────────────────────────────────────────
// Chat Sidebar: message search results
// ──────────────────────────────────────────────
import { AlertTriangle, Loader2, SearchX } from "lucide-react";
import { Fragment, type ReactNode } from "react";
import { useMessageSearch } from "../../features/catalog/chats/sidebar";
import type { MessageSearchMode, MessageSearchResult } from "../../shared/api/message-search-api";
import { cn } from "../../shared/lib/utils";

function highlightSnippet(snippet: string, highlights: Array<[number, number]>): ReactNode {
  const chars = Array.from(snippet);
  const parts: ReactNode[] = [];
  let cursor = 0;
  for (const [start, length] of highlights) {
    if (start < cursor || length <= 0) continue;
    if (start > cursor) parts.push(chars.slice(cursor, start).join(""));
    parts.push(
      <mark key={start} className="rounded-sm bg-[var(--primary)]/25 px-px text-[var(--foreground)]">
        {chars.slice(start, start + length).join("")}
      </mark>,
    );
    cursor = start + length;
  }
  if (cursor < chars.length) parts.push(chars.slice(cursor).join(""));
  return parts.map((part, index) => <Fragment key={index}>{part}</Fragment>);
}

function formatResultTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const now = new Date();
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  }
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(date.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }),
  });
}

export interface ChatSidebarMessageResultsProps {
  query: string;
  mode: MessageSearchMode;
  characterName: (characterId: string) => string | undefined;
  activeMessageChatId: string | null;
  onOpen: (result: MessageSearchResult) => void;
}

export function ChatSidebarMessageResults({
  query,
  mode,
  characterName,
  activeMessageChatId,
  onOpen,
}: ChatSidebarMessageResultsProps) {
  const search = useMessageSearch(query, mode);
  const response = search.data;
  const busy = search.settling || search.isFetching;

  if (search.isError) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 px-3 py-6 text-center">
        <AlertTriangle size="1.25rem" className="text-[var(--destructive)]" />
        <p className="text-xs text-[var(--muted-foreground)]">
          Message search failed: {search.error instanceof Error ? search.error.message : "unknown error"}
        </p>
        <button
          type="button"
          onClick={() => void search.refetch()}
          className="rounded-lg bg-[var(--secondary)] px-3 py-1.5 text-[0.72rem] font-semibold text-[var(--foreground)] hover:bg-[var(--sidebar-accent)]/50"
        >
          Try again
        </button>
      </div>
    );
  }

  if (!response) {
    return (
      <div className="flex flex-1 items-center justify-center gap-2 px-3 py-6 text-xs text-[var(--muted-foreground)]">
        <Loader2 size="0.9rem" className="animate-spin" />
        Searching messages…
      </div>
    );
  }

  if (response.results.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 px-3 py-6 text-center">
        <SearchX size="1.25rem" className="text-[var(--muted-foreground)]" />
        <p className="text-xs text-[var(--muted-foreground)]">No messages match “{query.trim()}”.</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between px-2 pb-1 text-[0.625rem] text-[var(--muted-foreground)]">
        <span aria-live="polite">
          {response.truncated
            ? `Newest ${response.results.length} of ${response.totalMatches} matches`
            : `${response.totalMatches} ${response.totalMatches === 1 ? "match" : "matches"}`}
        </span>
        {busy && <Loader2 size="0.7rem" className="animate-spin" aria-label="Updating results" />}
      </div>
      <ul className="min-h-0 flex-1 space-y-0.5 overflow-y-auto pb-2" aria-label="Message search results">
        {response.results.map((result) => {
          const speaker =
            result.role === "user"
              ? "You"
              : result.role === "narrator"
                ? "Narrator"
                : ((result.characterId && characterName(result.characterId)) ?? "Character");
          return (
            <li key={result.messageId}>
              <button
                type="button"
                onClick={() => onOpen(result)}
                className={cn(
                  "flex w-full flex-col gap-0.5 rounded-lg px-3 py-2 text-left transition-colors hover:bg-[var(--sidebar-accent)]/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]/45",
                  activeMessageChatId === result.chatId && "bg-[var(--sidebar-accent)]/30",
                )}
              >
                <span className="flex min-w-0 items-baseline justify-between gap-2">
                  <span className="truncate text-xs font-semibold text-[var(--foreground)]">
                    {result.chatName || "Untitled chat"}
                  </span>
                  <span className="shrink-0 text-[0.625rem] text-[var(--muted-foreground)]">
                    {formatResultTime(result.createdAt)}
                  </span>
                </span>
                <span className="line-clamp-3 text-[0.6875rem] leading-snug text-[var(--muted-foreground)]">
                  <span className="font-medium text-[var(--foreground)]/80">{speaker}: </span>
                  {highlightSnippet(result.snippet, result.highlights)}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
