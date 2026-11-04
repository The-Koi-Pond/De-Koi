import { useState } from "react";
import { Feather, Plus, Unlink } from "lucide-react";

import type { Chat } from "../../../../../../engine/contracts/types/chat";
import { useChatStore } from "../../../../../../shared/stores/chat.store";
import { useChatSummaries } from "../../../../../catalog/chats/index";
import { useFanficLinkActions, useLinkedFic } from "../../hooks/use-fanfic-links";
import { ChatSettingsSection as Section, PickerDropdown } from "./ChatSettingsSections";

/** Roleplay and chat settings: the fic this chat is linked to, both ways. */
export function LinkedFicSection({ chat }: { chat: Chat }) {
  const { data: linkedFic } = useLinkedFic(chat);
  const { data: allChats } = useChatSummaries();
  const { link, unlink } = useFanficLinkActions();
  const [picking, setPicking] = useState(false);
  const [search, setSearch] = useState("");
  const setActiveChatId = useChatStore((state) => state.setActiveChatId);
  const fics = (allChats ?? []).filter(
    (row) => row.mode === "fanfic" && (row.name ?? "").toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <Section
      label="Linked Fic"
      icon={<Feather size="0.875rem" />}
      count={linkedFic ? 1 : undefined}
      help="Link this chat to a fic and each knows what happens in the other: replies here know where the fic stands, and the fic's next chapter works in what happened here since its previous chapter."
    >
      {linkedFic ? (
        <div className="flex items-center gap-2.5 rounded-lg bg-[var(--primary)]/10 px-3 py-2 ring-1 ring-[var(--primary)]/30">
          <Feather size="0.875rem" className="text-[var(--primary)]" aria-hidden="true" />
          <button
            type="button"
            onClick={() => setActiveChatId(linkedFic.id)}
            className="min-w-0 flex-1 truncate text-left text-xs font-medium hover:underline"
            title="Open the fic"
          >
            {linkedFic.name || "Untitled fic"}
          </button>
          <button
            type="button"
            onClick={() => unlink.mutate({ ficChatId: linkedFic.id, chatId: chat.id })}
            disabled={unlink.isPending}
            aria-label="Unlink the fic"
            title="Unlink"
            className="flex h-5 w-5 items-center justify-center rounded-md text-[var(--muted-foreground)] transition-colors hover:bg-[var(--destructive)]/15 hover:text-[var(--destructive)]"
          >
            <Unlink size="0.6875rem" aria-hidden="true" />
          </button>
        </div>
      ) : !picking ? (
        <button
          type="button"
          onClick={() => {
            setPicking(true);
            setSearch("");
          }}
          className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-[var(--border)] px-3 py-2 text-xs text-[var(--muted-foreground)] transition-colors hover:border-[var(--primary)]/40 hover:text-[var(--primary)]"
        >
          <Plus size="0.75rem" aria-hidden="true" /> Link to a fic
        </button>
      ) : (
        <PickerDropdown
          search={search}
          onSearchChange={setSearch}
          onClose={() => setPicking(false)}
          placeholder="Search fics…"
        >
          {fics.length === 0 && <p className="px-3 py-2 text-xs text-[var(--muted-foreground)]">No fics yet.</p>}
          {fics.map((fic) => (
            <button
              key={fic.id}
              type="button"
              onClick={() => {
                link.mutate({ ficChatId: fic.id, chatId: chat.id });
                setPicking(false);
              }}
              className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-xs transition-colors hover:bg-[var(--accent)]"
            >
              <Feather size="0.75rem" className="shrink-0 text-[var(--muted-foreground)]" aria-hidden="true" />
              <span className="truncate">{fic.name || "Untitled fic"}</span>
            </button>
          ))}
        </PickerDropdown>
      )}
    </Section>
  );
}
