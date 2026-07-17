export const MEMORY_RECALL_TOGGLE_DESCRIPTION =
  "Recall chat-local transcript fragments and eligible character-wide memories. Embeddings rank matches when configured; otherwise De-Koi uses local lexical matching.";

export const MEMORY_RECALL_SECTION_HELP =
  "When enabled, De-Koi injects relevant chat-local transcript fragments and eligible character-wide memories. Automatic capture saves recent speaker-labeled exchanges, and character-wide memories can follow a character into other chats. Provider embeddings rank matches when configured; otherwise De-Koi uses local lexical matching.";

export const MEMORY_RECALL_CONSOLE_DESCRIPTION =
  "This console combines chat-local transcript captures with read-only inherited character-wide memories. Automatic capture saves speaker-labeled exchanges. Character-wide memories can follow a character into other chats; embeddings rank matches rather than summarizing them.";

export function memoryRecallContinuityDetail(enabled: boolean, readBehindMessages: number): string {
  if (!enabled) {
    return "Memory Recall is not injecting chat-local transcript fragments or character-wide memories.";
  }

  const recentMessages = Math.max(0, Math.trunc(readBehindMessages));
  const recentMessageLabel = recentMessages === 1 ? "recent message" : "recent messages";
  return `Chat-local transcript fragments and eligible character-wide memories can be recalled after ${recentMessages} ${recentMessageLabel}. Automatic capture saves speaker-labeled exchanges; embeddings rank matches when configured.`;
}
