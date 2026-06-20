export const CHAT_SCROLL_TO_BOTTOM_EVENT = "de-koi:chat-scroll-to-bottom";

export type ChatScrollToBottomDetail = {
  chatId: string;
  behavior?: ScrollBehavior;
};

export function requestChatScrollToBottom(detail: ChatScrollToBottomDetail): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<ChatScrollToBottomDetail>(CHAT_SCROLL_TO_BOTTOM_EVENT, { detail }));
}
