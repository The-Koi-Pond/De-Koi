import { describe, expect, it, vi } from "vitest";

import {
  DeleteSelectedChatsError,
  deleteSingleChatWithConfirmation,
  deleteSelectedChatsSequentially,
  formatDeleteSelectedChatsError,
} from "./chat-sidebar-batch-actions";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe("deleteSelectedChatsSequentially", () => {
  it("deletes selected chats one at a time before leaving multi-select", async () => {
    const first = deferred();
    const second = deferred();
    const deleteChat = vi.fn((input: { id: string }) => (input.id === "chat-a" ? first.promise : second.promise));
    const setActiveChatId = vi.fn();
    const exitMultiSelect = vi.fn();

    const pending = deleteSelectedChatsSequentially({
      chatIds: ["chat-a", "chat-b"],
      activeChatId: "chat-b",
      deleteMemories: true,
      deleteChat,
      setActiveChatId,
      exitMultiSelect,
    });

    expect(deleteChat).toHaveBeenCalledTimes(1);
    expect(deleteChat).toHaveBeenNthCalledWith(1, { id: "chat-a", deleteMemories: true });
    expect(exitMultiSelect).not.toHaveBeenCalled();

    first.resolve();
    await Promise.resolve();

    expect(deleteChat).toHaveBeenCalledTimes(2);
    expect(deleteChat).toHaveBeenNthCalledWith(2, { id: "chat-b", deleteMemories: true });
    expect(setActiveChatId).not.toHaveBeenCalled();

    second.resolve();
    await pending;

    expect(setActiveChatId).toHaveBeenCalledWith(null);
    expect(exitMultiSelect).toHaveBeenCalledTimes(1);
  });

  it("resets selection mode when the first delete fails", async () => {
    const deleteChat = vi.fn(async (input: { id: string }) => {
      if (input.id === "chat-a") throw new Error("storage delete failed");
    });
    const setActiveChatId = vi.fn();
    const exitMultiSelect = vi.fn();

    await expect(
      deleteSelectedChatsSequentially({
        chatIds: ["chat-a", "chat-b"],
        activeChatId: "chat-b",
        deleteMemories: false,
        deleteChat,
        setActiveChatId,
        exitMultiSelect,
      }),
    ).rejects.toMatchObject({
      deletedCount: 0,
      totalCount: 2,
      failedChatId: "chat-a",
    });

    expect(deleteChat).toHaveBeenCalledTimes(1);
    expect(setActiveChatId).not.toHaveBeenCalled();
    expect(exitMultiSelect).toHaveBeenCalledTimes(1);
  });

  it("reports partial deletion after clearing deleted active chat state", async () => {
    const deleteChat = vi.fn(async (input: { id: string }) => {
      if (input.id === "chat-b") throw new Error("storage delete failed");
    });
    const setActiveChatId = vi.fn();
    const exitMultiSelect = vi.fn();

    let captured: unknown;
    try {
      await deleteSelectedChatsSequentially({
        chatIds: ["chat-a", "chat-b"],
        activeChatId: "chat-a",
        deleteMemories: false,
        deleteChat,
        setActiveChatId,
        exitMultiSelect,
      });
    } catch (error) {
      captured = error;
    }

    expect(captured).toBeInstanceOf(DeleteSelectedChatsError);
    expect(captured).toMatchObject({
      deletedCount: 1,
      totalCount: 2,
      failedChatId: "chat-b",
    });
    expect(formatDeleteSelectedChatsError(captured)).toBe("Deleted 1 of 2 chats. storage delete failed");
    expect(deleteChat).toHaveBeenCalledTimes(2);
    expect(setActiveChatId).toHaveBeenCalledWith(null);
    expect(exitMultiSelect).toHaveBeenCalledTimes(1);
  });
});

describe("deleteSingleChatWithConfirmation", () => {
  it("forwards the user's memory cleanup choice to the delete mutation", async () => {
    const deleteChat = vi.fn(async () => undefined);
    const setActiveChatId = vi.fn();

    await deleteSingleChatWithConfirmation({
      chatId: "chat-a",
      activeChatId: "chat-a",
      confirmDeletion: vi.fn(async () => ({ confirmed: true, deleteMemories: true })),
      deleteChat,
      setActiveChatId,
    });

    expect(deleteChat).toHaveBeenCalledWith({ id: "chat-a", deleteMemories: true });
    expect(setActiveChatId).toHaveBeenCalledWith(null);
  });

  it("does not delete when the user cancels", async () => {
    const deleteChat = vi.fn(async () => undefined);
    const setActiveChatId = vi.fn();

    await deleteSingleChatWithConfirmation({
      chatId: "chat-a",
      activeChatId: null,
      confirmDeletion: vi.fn(async () => ({ confirmed: false, deleteMemories: false })),
      deleteChat,
      setActiveChatId,
    });

    expect(deleteChat).not.toHaveBeenCalled();
    expect(setActiveChatId).not.toHaveBeenCalled();
  });
});
