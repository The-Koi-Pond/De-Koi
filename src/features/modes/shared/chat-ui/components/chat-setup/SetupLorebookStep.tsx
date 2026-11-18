import { useId, useMemo, useState } from "react";
import { BookOpen, Plus, Search } from "lucide-react";
import type { Chat } from "../../../../../../engine/contracts/types/chat";
import type { Lorebook } from "../../../../../../engine/contracts/types/lorebook";
import { lorebookCanBeSelectedForContext } from "../../../../../../engine/generation-core/lorebooks/active-lorebook-scope";
import { useLorebooks } from "../../../../../catalog/lorebooks/index";
import { useUpdateChatMetadata } from "../../../../../catalog/chats/index";
import { cn } from "../../../../../../shared/lib/utils";
import { SETUP_INPUT_CLASS, SETUP_ROW_CLASS } from "./setup-styles";
import { useSavedPick } from "./use-saved-pick";
import type { SetupChatFields } from "./setup-chat";

function lorebookIds(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((id): id is string => typeof id === "string" && id.trim().length > 0) : [];
}

function lorebookName(lorebook: Lorebook): string {
  return lorebook.name?.trim() || "Untitled lorebook";
}

/**
 * Attach lorebooks to the chat. Only lorebooks that can be attached in this chat (for its characters and persona)
 * are offered, and an attached id whose lorebook was deleted is ignored by every message here (decision 3).
 */
export function SetupLorebookStep({
  chat,
  fields,
  characterIds,
  personaId,
}: {
  chat: Chat;
  fields: SetupChatFields;
  characterIds: readonly string[];
  personaId: string | null;
}) {
  const searchId = useId();
  const updateMetadata = useUpdateChatMetadata();
  const { data } = useLorebooks();
  const [search, setSearch] = useState("");
  const savedIds = lorebookIds(fields.metadata.activeLorebookIds);
  const [attachedIds, setAttachedIds] = useSavedPick(savedIds, savedIds.join("\0"));

  const lorebooks = useMemo(() => (data ?? []) as Lorebook[], [data]);
  const attached = useMemo(() => {
    const byId = new Map(lorebooks.map((lorebook) => [lorebook.id, lorebook]));
    return attachedIds.flatMap((id) => {
      const lorebook = byId.get(id);
      return lorebook ? [lorebook] : [];
    });
  }, [attachedIds, lorebooks]);

  const attachable = useMemo(() => {
    const attachedSet = new Set(attachedIds);
    const context = {
      chat: { ...chat, metadata: { ...fields.metadata, activeLorebookIds: attachedIds }, personaId },
      characters: characterIds.map((id) => ({ id })),
      persona: personaId ? { id: personaId } : null,
    };
    return lorebooks.filter(
      (lorebook) => !attachedSet.has(lorebook.id) && lorebookCanBeSelectedForContext(lorebook, context),
    );
  }, [attachedIds, characterIds, chat, fields.metadata, lorebooks, personaId]);

  const query = search.trim().toLowerCase();
  const shown = query
    ? attachable.filter((lorebook) => lorebookName(lorebook).toLowerCase().includes(query))
    : attachable;

  const save = (next: string[]) => {
    setAttachedIds(next);
    updateMetadata.mutate({ id: fields.id, activeLorebookIds: next });
  };

  if (attached.length === 0 && attachable.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-[var(--border)] px-3 py-4 text-center text-xs text-[var(--muted-foreground)]">
        No lorebooks yet. They are optional, so you can press Next to skip this step.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {attached.length > 0 && (
        <ul aria-label="Attached lorebooks" className="flex flex-col gap-1">
          {attached.map((lorebook) => (
            <li
              key={lorebook.id}
              className="flex items-center gap-2.5 rounded-lg bg-[var(--secondary)] px-2.5 py-2 ring-1 ring-[var(--border)]"
            >
              <BookOpen size="0.9rem" aria-hidden="true" className="shrink-0 text-[var(--primary)]" />
              <span className="min-w-0 flex-1 truncate text-xs font-medium text-[var(--foreground)]">
                {lorebookName(lorebook)}
              </span>
              <button
                type="button"
                aria-label={`Remove ${lorebookName(lorebook)}`}
                onClick={() => save(attachedIds.filter((id) => id !== lorebook.id))}
                className="shrink-0 rounded-lg px-2 py-1 text-[0.6875rem] font-medium text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)] hover:text-[var(--foreground)]"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="relative">
        <label htmlFor={searchId} className="sr-only">
          Search lorebooks
        </label>
        <Search
          size="0.8rem"
          aria-hidden="true"
          className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)]"
        />
        <input
          id={searchId}
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search lorebooks…"
          className={cn(SETUP_INPUT_CLASS, "pl-8")}
        />
      </div>
      {shown.length > 0 ? (
        <ul aria-label="Lorebooks you can attach" className="flex max-h-56 flex-col gap-0.5 overflow-y-auto">
          {shown.map((lorebook) => (
            <li key={lorebook.id}>
              <button
                type="button"
                aria-label={`Attach ${lorebookName(lorebook)}`}
                onClick={() => save([...attachedIds, lorebook.id])}
                className={SETUP_ROW_CLASS}
              >
                <BookOpen size="0.9rem" aria-hidden="true" className="shrink-0 text-[var(--muted-foreground)]" />
                <span className="min-w-0 flex-1 truncate text-xs text-[var(--foreground)]">
                  {lorebookName(lorebook)}
                </span>
                <Plus size="0.9rem" aria-hidden="true" className="shrink-0 text-[var(--primary)]" />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="px-3 py-3 text-center text-[0.6875rem] text-[var(--muted-foreground)]">
          {attachable.length === 0 ? "All lorebooks already added." : "No matches."}
        </p>
      )}
    </div>
  );
}
