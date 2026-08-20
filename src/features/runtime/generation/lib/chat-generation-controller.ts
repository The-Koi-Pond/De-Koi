import { useChatStore } from "../../../../shared/stores/chat.store";

export function acquireChatGenerationController(chatId: string): AbortController | null {
  const chatStore = useChatStore.getState();
  if (chatStore.abortControllers.has(chatId)) return null;

  const controller = new AbortController();
  chatStore.setAbortController(chatId, controller);
  return controller;
}

export function releaseChatGenerationController(chatId: string, controller: AbortController): void {
  const chatStore = useChatStore.getState();
  if (chatStore.abortControllers.get(chatId) !== controller) return;
  chatStore.setAbortController(chatId, null);
}
