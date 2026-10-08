import { QueryClient } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";

const showPendingCardEvolutionReviews = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("../../features/catalog/characters/card-reviews", () => ({ showPendingCardEvolutionReviews }));

import { publishPostReplyRecovery } from "../../engine/generation/post-reply-recoveries";
import { chatKeys } from "../../features/catalog/chats/index";
import { useChatStore } from "../../shared/stores/chat.store";
import { subscribePostReplyRecoveryEffects } from "./app-shell-post-reply-recoveries";

describe("post-reply recovery effects in the app shell", () => {
  let unsubscribe = () => {};

  afterEach(() => {
    unsubscribe();
    vi.clearAllMocks();
    useChatStore.getState().setActiveChatId(null);
  });

  it("refreshes the recovered chat and offers its card updates when that chat is open", async () => {
    const queryClient = new QueryClient();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    unsubscribe = subscribePostReplyRecoveryEffects(queryClient);
    useChatStore.getState().setActiveChatId("chat-1");

    publishPostReplyRecovery({ chatId: "chat-1", messageId: "reply-1", pendingCardReviews: 1 });

    expect(invalidate).toHaveBeenCalledWith({ queryKey: chatKeys.detail("chat-1") });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: chatKeys.messages("chat-1") });
    await vi.waitFor(() => expect(showPendingCardEvolutionReviews).toHaveBeenCalledWith("chat-1"));
  });

  it("leaves card updates for when the chat opens if another chat is on screen, or none are waiting", async () => {
    const queryClient = new QueryClient();
    unsubscribe = subscribePostReplyRecoveryEffects(queryClient);
    useChatStore.getState().setActiveChatId("chat-2");

    publishPostReplyRecovery({ chatId: "chat-1", messageId: "reply-1", pendingCardReviews: 2 });
    useChatStore.getState().setActiveChatId("chat-1");
    publishPostReplyRecovery({ chatId: "chat-1", messageId: "reply-2", pendingCardReviews: 0 });

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(showPendingCardEvolutionReviews).not.toHaveBeenCalled();
  });
});
