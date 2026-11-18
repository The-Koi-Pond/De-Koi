import { useEffect, useState } from "react";
import type { Chat } from "../../../../../engine/contracts/types/chat";
import { useChatStore } from "../../../../../shared/stores/chat.store";
import { NewConversationCard } from "./chat-setup/NewConversationCard";
import { RoleplaySetup } from "./chat-setup/RoleplaySetup";

/**
 * Setup for a new chat, shown over it. Conversation chats get the one-page New conversation card; every other mode
 * gets the step-by-step Roleplay wizard with Quick setup. Both edit the open draft chat directly.
 *
 * Skip and finishing call `onFinish`; closing, Escape, the backdrop and every action that goes elsewhere call
 * `onCancel` (or `onFinish` when there is none). What either does to the draft is `use-new-chat-draft.ts`'s call.
 */
export function ChatSetupWizard({
  chat,
  onFinish,
  onCancel,
}: {
  chat: Chat;
  onFinish: () => void;
  onCancel?: () => void;
}) {
  // Setup belongs to one chat: another chat gets a fresh setup, and nothing pending carries over.
  return <ChatSetup key={chat.id} chat={chat} onFinish={onFinish} onCancel={onCancel ?? onFinish} />;
}

function ChatSetup({ chat, onFinish, onCancel }: { chat: Chat; onFinish: () => void; onCancel: () => void }) {
  // Read once when setup opens: a setup intent that asked for Quick setup (onboarding starting from a character).
  const [startInQuickSetup] = useState(() => useChatStore.getState().shouldOpenWizardInShortcutMode);

  useEffect(() => {
    if (startInQuickSetup) useChatStore.getState().setShouldOpenWizardInShortcutMode(false);
  }, [startInQuickSetup]);

  if (chat.mode === "conversation") {
    return <NewConversationCard chat={chat} onFinish={onFinish} onCancel={onCancel} />;
  }
  return <RoleplaySetup chat={chat} startInQuickSetup={startInQuickSetup} onFinish={onFinish} onCancel={onCancel} />;
}
