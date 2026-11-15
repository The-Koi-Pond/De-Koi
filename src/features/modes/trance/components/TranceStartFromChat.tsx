import { useMemo, useState } from "react";
import { BookOpen, Loader2 } from "lucide-react";

import { TRANCE_SOURCE_MODES } from "../../../../engine/modes/trance/source";
import { toUserMessage } from "../../../../shared/lib/error-message";
import { useChatSummaries } from "../../../catalog/chats/index";
import { useBaseTranceOnChat } from "../hooks/use-trance";

const MODE_LABELS: Record<string, string> = {
  conversation: "Chat",
  roleplay: "Roleplay",
  visual_novel: "Roleplay",
  fanfic: "Fic",
};

/**
 * "Start from one of your chats" on a new session: pick a chat, roleplay or fic and the session opens on three ideas
 * drawn from it, with its character as the guide.
 */
export function TranceStartFromChat({ chatId }: { chatId: string }) {
  const { data: chats } = useChatSummaries();
  const base = useBaseTranceOnChat(chatId);
  const sources = useMemo(
    () =>
      (chats ?? [])
        .filter((chat) => TRANCE_SOURCE_MODES.has(chat.mode) && (chat.characterIds?.length ?? 0) > 0)
        .sort((a, b) => String(b.updatedAt ?? "").localeCompare(String(a.updatedAt ?? ""))),
    [chats],
  );
  const [picked, setPicked] = useState("");
  const sourceId = picked || sources[0]?.id || "";
  const error =
    base.error && !(base.error instanceof DOMException && base.error.name === "AbortError")
      ? toUserMessage(base.error, { fallback: "That didn't work. Try again." })
      : null;
  if (sources.length === 0) return null;

  return (
    <section className="mx-auto mt-4 w-full max-w-2xl px-3 sm:px-4">
      <div className="rounded-xl border border-[var(--primary)]/40 bg-[var(--primary)]/10 p-3 sm:p-4">
        <div className="mb-2 flex items-start gap-2.5">
          <BookOpen size="1.125rem" className="mt-0.5 shrink-0 text-[var(--primary)]" aria-hidden="true" />
          <div>
            <h3 className="text-sm font-bold text-[var(--foreground)]">Start from one of your chats</h3>
            <p className="text-xs leading-snug text-[var(--muted-foreground)]">
              Pick a chat, roleplay or fic. Its character guides you, and you get three ideas built from what happened
              there.
            </p>
          </div>
        </div>
        {base.isPending ? (
          <div role="status" className="flex items-center gap-2 text-sm text-[var(--foreground)]">
            <Loader2 size="1rem" className="animate-spin" aria-hidden="true" />
            Reading it and thinking up ideas…
            <button
              type="button"
              onClick={base.stop}
              className="ml-auto text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
            >
              Stop
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-2 sm:flex-row">
            <select
              aria-label="Chat, roleplay or fic to start from"
              value={sourceId}
              onChange={(event) => setPicked(event.target.value)}
              className="min-w-0 flex-1 rounded-lg border border-[var(--border)] bg-[var(--secondary)] px-3 py-2 text-sm text-[var(--foreground)]"
            >
              {sources.map((chat) => (
                <option key={chat.id} value={chat.id}>
                  {MODE_LABELS[chat.mode] ?? "Chat"}: {chat.name?.trim() || "Untitled"}
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={!sourceId}
              onClick={() => base.mutate(sourceId)}
              className="rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-semibold text-[var(--primary-foreground)] disabled:opacity-50"
            >
              Get ideas from it
            </button>
          </div>
        )}
        {error && (
          <p role="alert" className="mt-2 text-sm text-[var(--foreground)]">
            {error}
          </p>
        )}
      </div>
    </section>
  );
}
