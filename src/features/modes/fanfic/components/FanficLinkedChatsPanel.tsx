import { useState } from "react";
import { Link2, MessagesSquare, Unlink } from "lucide-react";

import { FANFIC_LINK_MODES, FANFIC_MAX_LINKED_CHATS } from "../../../../engine/modes/fanfic/links";
import { cn } from "../../../../shared/lib/utils";
import { useChatStore } from "../../../../shared/stores/chat.store";
import { useChat, useChatSummaries } from "../../../catalog/chats/index";
import { useFanficLinkActions, useFanficLinkedChats } from "../../shared/chat-ui/index";
import { FanficButton, FanficSection, fanficInputClass } from "./fanfic-ui";

function modeLabel(mode: string | undefined): string {
  return mode === "roleplay" ? "Roleplay" : "Chat";
}

/**
 * The roleplays and chats linked to this fic. Each knows what happens in the other: the next chapter works in what
 * happened in them since the previous chapter, and their replies know where the fic stands.
 */
export function FanficLinkedChatsPanel({ chatId }: { chatId: string }) {
  const { data: fic } = useChat(chatId);
  const { data: linked = [] } = useFanficLinkedChats(fic);
  const { data: allChats } = useChatSummaries();
  const { link, unlink } = useFanficLinkActions();
  const [picked, setPicked] = useState("");
  const setActiveChatId = useChatStore((state) => state.setActiveChatId);
  const candidates = (allChats ?? []).filter(
    (row) => FANFIC_LINK_MODES.has(row.mode) && !linked.some((chat) => chat.id === row.id),
  );
  const full = linked.length >= FANFIC_MAX_LINKED_CHATS;

  return (
    <FanficSection
      title="Linked roleplays and chats"
      hint="A linked roleplay or chat and this fic know what happens in each other. The next chapter works in what happened there since the previous chapter, and replies there know where the fic stands."
    >
      {linked.length > 0 && (
        <ul className="flex flex-col gap-1.5">
          {linked.map((chat) => (
            <li
              key={chat.id}
              className="flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--secondary)]/30 px-2.5 py-1.5"
            >
              <MessagesSquare size="0.85rem" className="shrink-0 text-[var(--muted-foreground)]" aria-hidden="true" />
              <button
                type="button"
                onClick={() => setActiveChatId(chat.id)}
                className="min-w-0 flex-1 truncate text-left text-[0.8125rem] font-medium text-[var(--foreground)] hover:underline"
                title={`Open ${chat.name || "the chat"}`}
              >
                {chat.name || "Untitled"}
              </button>
              <span className="text-[0.6875rem] text-[var(--muted-foreground)]">{modeLabel(chat.mode)}</span>
              <button
                type="button"
                onClick={() => unlink.mutate({ ficChatId: chatId, chatId: chat.id })}
                disabled={unlink.isPending}
                aria-label={`Unlink ${chat.name || "this chat"}`}
                title="Unlink"
                className="flex h-6 w-6 items-center justify-center rounded-md text-[var(--muted-foreground)] hover:bg-[var(--destructive)]/15 hover:text-[var(--destructive)]"
              >
                <Unlink size="0.75rem" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {full ? (
        <p className="text-xs text-[var(--muted-foreground)]">
          {FANFIC_MAX_LINKED_CHATS} is the most a fic links to. Unlink one to link another.
        </p>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor={`fanfic-link-chat-${chatId}`} className="sr-only">
            Roleplay or chat to link
          </label>
          <select
            id={`fanfic-link-chat-${chatId}`}
            className={cn(fanficInputClass, "min-w-0 flex-1 py-2 text-[0.8125rem]")}
            value={picked}
            onChange={(event) => setPicked(event.target.value)}
          >
            <option value="">{candidates.length > 0 ? "Pick a roleplay or chat…" : "No roleplays or chats yet"}</option>
            {candidates.map((row) => (
              <option key={row.id} value={row.id}>
                {`${row.name || "Untitled"} (${modeLabel(row.mode)})`}
              </option>
            ))}
          </select>
          <FanficButton
            disabled={!picked || link.isPending}
            onClick={() => {
              link.mutate({ ficChatId: chatId, chatId: picked });
              setPicked("");
            }}
          >
            <Link2 size="0.85rem" aria-hidden="true" />
            Link
          </FanficButton>
        </div>
      )}
    </FanficSection>
  );
}
