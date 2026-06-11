import { StickyNote, Trash2 } from "lucide-react";
import { useMemo } from "react";
import type { ConversationNote } from "../../../../../../engine/contracts/types/chat";
import { showConfirmDialog } from "../../../../../../shared/lib/app-dialogs";
import {
  useChatNotes,
  useClearChatNotes,
  useDeleteChatNote,
} from "../../../../../catalog/chats/index";
import { ChatSettingsSection as Section } from "./ChatSettingsSections";
import { formatMemoryDate } from "./MemoryRecallMemoriesModal";

export function ConversationNotesSection({ chatId }: { chatId: string }) {
  const notesQuery = useChatNotes(chatId);
  const deleteNote = useDeleteChatNote(chatId);
  const clearNotes = useClearChatNotes(chatId);
  const notes = useMemo<ConversationNote[]>(() => notesQuery.data ?? [], [notesQuery.data]);
  const totalChars = useMemo(() => notes.reduce((acc, n) => acc + n.content.length, 0), [notes]);

  const handleDelete = async (note: ConversationNote) => {
    const ok = await showConfirmDialog({
      title: "Delete Note",
      message: "Remove this note from the connected roleplay's prompt?",
      confirmLabel: "Delete",
      tone: "destructive",
    });
    if (ok) deleteNote.mutate(note.id);
  };

  const handleClear = async () => {
    if (notes.length === 0) return;
    const ok = await showConfirmDialog({
      title: "Clear All Notes",
      message: "Remove every durable note from this roleplay? This cannot be undone.",
      confirmLabel: "Clear all",
      tone: "destructive",
    });
    if (ok) clearNotes.mutate();
  };

  return (
    <Section
      label="Conversation Notes"
      icon={<StickyNote size="0.875rem" />}
      count={notes.length}
      help="Durable notes the connected conversation's character has saved using <note>. They persist in this roleplay's prompt every turn until cleared."
    >
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2 text-[0.625rem] text-[var(--muted-foreground)]">
          <span>
            {notesQuery.isLoading
              ? "Loading…"
              : notesQuery.error
                ? "Failed to load."
                : notes.length === 0
                  ? "No notes saved yet."
                  : `${notes.length} ${notes.length === 1 ? "note" : "notes"} · ${totalChars.toLocaleString()} chars`}
          </span>
          {notes.length > 0 && !notesQuery.isLoading && !notesQuery.error && (
            <button
              type="button"
              onClick={handleClear}
              disabled={clearNotes.isPending}
              className="rounded-md p-1 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--destructive)]/15 hover:text-[var(--destructive)] disabled:opacity-40"
              title="Clear all notes"
            >
              <Trash2 size="0.75rem" />
            </button>
          )}
        </div>

        {notesQuery.isLoading ? (
          <p className="rounded-lg bg-[var(--secondary)]/50 px-3 py-3 text-center text-[0.625rem] leading-relaxed text-[var(--muted-foreground)]">
            Loading notes…
          </p>
        ) : notesQuery.error ? (
          <p className="rounded-lg bg-[var(--destructive)]/10 px-3 py-3 text-[0.625rem] leading-relaxed text-[var(--destructive)] ring-1 ring-[var(--destructive)]/25">
            Failed to load notes.
          </p>
        ) : notes.length === 0 ? (
          <p className="rounded-lg bg-[var(--secondary)]/50 px-3 py-3 text-[0.625rem] leading-relaxed text-[var(--muted-foreground)]">
            Characters in the connected conversation can save things they want this roleplay to durably remember by
            wrapping text in <code className="rounded bg-[var(--accent)]/60 px-1">{"<note>...</note>"}</code>. Saved
            notes will appear here.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {notes.map((note) => (
              <li
                key={note.id}
                className="flex items-start gap-2 rounded-lg bg-[var(--card)] px-2.5 py-2 ring-1 ring-[var(--border)]"
              >
                <div className="flex-1 min-w-0">
                  <p className="whitespace-pre-wrap break-words text-[0.6875rem] leading-relaxed text-[var(--foreground)]">
                    {note.content}
                  </p>
                  <p className="mt-1 text-[0.5625rem] text-[var(--muted-foreground)]">
                    {formatMemoryDate(note.createdAt)}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void handleDelete(note)}
                  disabled={deleteNote.isPending}
                  className="shrink-0 rounded-md p-1 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--destructive)]/15 hover:text-[var(--destructive)] disabled:opacity-40"
                  title="Delete this note"
                >
                  <Trash2 size="0.6875rem" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Section>
  );
}

// ──────────────────────────────────────────────
// Scoped Regex Scripts Components
// ──────────────────────────────────────────────
