import { CheckSquare, MessageSquare, Plus, Square as SquareIcon, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { DekiSession } from "../../engine/deki/deki-history";
import { showConfirmDialog } from "../../shared/lib/app-dialogs";
import { cn } from "../../shared/lib/utils";
import {
  getDekiBatchDeleteCopy,
  getSelectedDekiSessionIds,
  toggleDekiSessionSelection,
} from "./deki-sidebar-selection";

type DekiSidebarProps = {
  sessions: DekiSession[];
  activeSessionId: string | null;
  unreadSessionIds: ReadonlySet<string>;
  dekiOpen: boolean;
  onOpenSession: (sessionId: string) => void;
  onCreateSession: () => void;
  onDeleteSession: (sessionId: string) => void;
  onDeleteSessions: (sessionIds: string[]) => void;
  onClose: () => void;
};

export function DekiSidebar({
  sessions,
  activeSessionId,
  unreadSessionIds,
  dekiOpen,
  onOpenSession,
  onCreateSession,
  onDeleteSession,
  onDeleteSessions,
  onClose,
}: DekiSidebarProps) {
  const [multiSelectMode, setMultiSelectMode] = useState(false);
  const [selectedSessionIds, setSelectedSessionIds] = useState<Set<string>>(new Set());
  const orderedSessionIds = useMemo(() => sessions.map((session) => session.id), [sessions]);
  const selectedVisibleSessionIds = useMemo(
    () => getSelectedDekiSessionIds(selectedSessionIds, orderedSessionIds),
    [orderedSessionIds, selectedSessionIds],
  );

  const exitMultiSelect = useCallback(() => {
    setMultiSelectMode(false);
    setSelectedSessionIds(new Set());
  }, []);

  const toggleSelectSession = useCallback((sessionId: string) => {
    setSelectedSessionIds((current) => toggleDekiSessionSelection(current, sessionId));
  }, []);

  useEffect(() => {
    setSelectedSessionIds((current) => new Set(getSelectedDekiSessionIds(current, orderedSessionIds)));
  }, [orderedSessionIds]);

  const closeOnNarrowViewport = useCallback(() => {
    if (typeof window !== "undefined" && window.innerWidth < 768) onClose();
  }, [onClose]);

  const handleOpenSession = useCallback(
    (sessionId: string) => {
      onOpenSession(sessionId);
      closeOnNarrowViewport();
    },
    [closeOnNarrowViewport, onOpenSession],
  );

  const handleCreateSession = useCallback(() => {
    onCreateSession();
    closeOnNarrowViewport();
  }, [closeOnNarrowViewport, onCreateSession]);

  const handleDeleteSession = useCallback(
    async (session: DekiSession) => {
      if (
        await showConfirmDialog({
          title: "Delete Deki Chat",
          message: `Delete "${session.title}"?`,
          confirmLabel: "Delete",
          tone: "destructive",
        })
      ) {
        onDeleteSession(session.id);
      }
    },
    [onDeleteSession],
  );

  const handleDeleteSelectedSessions = useCallback(async () => {
    const sessionIds = getSelectedDekiSessionIds(selectedSessionIds, orderedSessionIds);
    if (sessionIds.length === 0) return;
    const copy = getDekiBatchDeleteCopy(sessionIds.length);
    if (
      await showConfirmDialog({
        title: copy.title,
        message: copy.message,
        confirmLabel: "Delete",
        tone: "destructive",
      })
    ) {
      onDeleteSessions(sessionIds);
      exitMultiSelect();
    }
  }, [exitMultiSelect, onDeleteSessions, orderedSessionIds, selectedSessionIds]);

  return (
    <nav data-component="DekiSidebar" aria-label="Deki-senpai chats" className="mari-chat-sidebar flex h-full flex-col">
      <div className="mari-sidebar-header relative flex h-12 items-center justify-between bg-[var(--card)]/80 px-4 backdrop-blur-sm">
        <div className="absolute inset-x-0 bottom-0 h-px bg-[var(--border)]/30" />
        <div className="flex min-w-0 items-center gap-2">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-sky-500/15 text-sky-500">
            <MessageSquare size="0.875rem" />
          </div>
          <h2 className="retro-glow-text truncate text-sm font-bold">Deki-senpai</h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg p-1.5 text-[var(--muted-foreground)] transition-all hover:bg-[var(--sidebar-accent)] hover:text-[var(--primary)] active:scale-90"
          title="Close Deki chats"
          aria-label="Close Deki chats"
        >
          <X size="1rem" />
        </button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col px-3 py-2">
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="min-w-0 text-[0.625rem] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
            Chat History
          </div>
          <div className="flex items-center gap-1">
            {sessions.length > 1 && (
              <button
                type="button"
                onClick={() => {
                  if (multiSelectMode) exitMultiSelect();
                  else setMultiSelectMode(true);
                }}
                className={cn(
                  "rounded-md p-1 text-[var(--muted-foreground)] transition-all hover:bg-[var(--sidebar-accent)] hover:text-[var(--primary)] active:scale-90",
                  multiSelectMode && "bg-[var(--sidebar-accent)] text-[var(--primary)]",
                )}
                title={multiSelectMode ? "Cancel Deki selection" : "Select Deki chats"}
                aria-label={multiSelectMode ? "Cancel Deki selection" : "Select Deki chats"}
              >
                {multiSelectMode ? <X size="0.8125rem" /> : <CheckSquare size="0.8125rem" />}
              </button>
            )}
            <button
              type="button"
              onClick={handleCreateSession}
              className="rounded-md p-1 text-[var(--muted-foreground)] transition-all hover:bg-[var(--sidebar-accent)] hover:text-[var(--primary)] active:scale-90"
              title="New Deki chat"
              aria-label="New Deki chat"
            >
              <Plus size="0.8125rem" />
            </button>
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto pr-0.5">
          {sessions.map((session) => {
            const isActive = dekiOpen && activeSessionId === session.id;
            const hasUnread = unreadSessionIds.has(session.id);
            const isSelected = selectedSessionIds.has(session.id);
            return (
              <div
                key={session.id}
                role="button"
                tabIndex={0}
                data-deki-session-id={session.id}
                data-deki-session-unread={hasUnread ? "true" : undefined}
                aria-label={hasUnread ? session.title + ", new Deki message" : session.title}
                onClick={() => {
                  if (multiSelectMode) {
                    toggleSelectSession(session.id);
                    return;
                  }
                  handleOpenSession(session.id);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    if (multiSelectMode) {
                      toggleSelectSession(session.id);
                      return;
                    }
                    handleOpenSession(session.id);
                  }
                }}
                className={cn(
                  "group relative flex items-center gap-2 rounded-lg px-2.5 py-2 text-left transition-all",
                  multiSelectMode && isSelected
                    ? "bg-sky-500/10 text-[var(--sidebar-foreground)] ring-1 ring-sky-400/25"
                    : isActive
                      ? "bg-[var(--sidebar-accent)] text-[var(--sidebar-accent-foreground)] shadow-sm"
                      : "text-[var(--sidebar-foreground)] hover:bg-[var(--sidebar-accent)]/60",
                )}
              >
                {multiSelectMode && (
                  <div className="shrink-0 text-sky-500">
                    {isSelected ? (
                      <CheckSquare size="0.875rem" />
                    ) : (
                      <SquareIcon size="0.875rem" className="text-[var(--muted-foreground)]" />
                    )}
                  </div>
                )}
                {isActive && !multiSelectMode && (
                  <span className="absolute -left-0.5 top-1/2 h-5 w-1 -translate-y-1/2 rounded-full bg-sky-400" />
                )}
                <div className="relative flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-sky-500/15 text-sky-500">
                  <MessageSquare size="0.8125rem" />
                  {hasUnread && (
                    <span
                      className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full bg-sky-400 ring-2 ring-[var(--background)]"
                      title="New Deki message"
                      aria-label="New Deki message"
                    />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-medium">{session.title}</span>
                  <span className="block truncate text-[0.625rem] text-[var(--muted-foreground)]">
                    {session.messages.length} message{session.messages.length === 1 ? "" : "s"}
                  </span>
                </div>
                {!multiSelectMode && (
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      void handleDeleteSession(session);
                    }}
                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[var(--muted-foreground)] opacity-0 transition-all hover:bg-[var(--sidebar-accent)] hover:text-[var(--destructive)] focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--destructive)]/35 active:scale-90 group-hover:opacity-100 max-md:opacity-100"
                    title="Delete Deki chat"
                    aria-label={`Delete ${session.title}`}
                  >
                    <Trash2 size="0.8125rem" strokeWidth={1.9} aria-hidden="true" />
                  </button>
                )}
              </div>
            );
          })}
        </div>

        {multiSelectMode && (
          <div className="mt-2 rounded-lg border border-[var(--border)]/35 bg-[var(--card)]/70 p-2">
            <div className="mb-2 text-center text-[0.6875rem] font-medium text-[var(--muted-foreground)]">
              {selectedVisibleSessionIds.length} selected
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={exitMultiSelect}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-[var(--secondary)] px-3 py-2 text-xs font-medium transition-all hover:bg-[var(--accent)]"
              >
                <X size="0.75rem" />
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleDeleteSelectedSessions()}
                disabled={selectedVisibleSessionIds.length === 0}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-[var(--destructive)]/10 px-3 py-2 text-xs font-medium text-[var(--destructive)] transition-all hover:bg-[var(--destructive)]/20 disabled:opacity-40"
                aria-label="Delete selected Deki chats"
              >
                <Trash2 size="0.75rem" />
                Delete
              </button>
            </div>
          </div>
        )}
      </div>
    </nav>
  );
}
