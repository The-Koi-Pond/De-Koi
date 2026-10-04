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
  it("sends chats in chunks and reports progress after each chunk", async () => {
    const deleteChats = vi.fn(() => Promise.resolve());
    const onProgress = vi.fn();

    await deleteSelectedChatsSequentially({
      chatIds: ["a", "b", "c", "d", "e"],
      activeChatId: null,
      deleteMemories: false,
      deleteChats,
      setActiveChatId: vi.fn(),
      exitMultiSelect: vi.fn(),
      onProgress,
      batchSize: 2,
    });

    expect(deleteChats.mock.calls).toEqual([
      [{ ids: ["a", "b"], deleteMemories: false }],
      [{ ids: ["c", "d"], deleteMemories: false }],
      [{ ids: ["e"], deleteMemories: false }],
    ]);
    expect(onProgress.mock.calls).toEqual([
      [2, 5],
      [4, 5],
      [5, 5],
    ]);
  });

  it("reports progress after each delete and returns the deleted count", async () => {
    const onProgress = vi.fn();

    const deletedCount = await deleteSelectedChatsSequentially({
      chatIds: ["chat-a", "chat-b", "chat-c"],
      activeChatId: null,
      deleteMemories: false,
      deleteChats: vi.fn(() => Promise.resolve()),
      batchSize: 1,
      setActiveChatId: vi.fn(),
      exitMultiSelect: vi.fn(),
      onProgress,
    });

    expect(deletedCount).toBe(3);
    expect(onProgress.mock.calls).toEqual([
      [1, 3],
      [2, 3],
      [3, 3],
    ]);
  });

  it("deletes chunks in order before leaving multi-select", async () => {
    const first = deferred();
    const second = deferred();
    const deleteChats = vi.fn((input: { ids: string[] }) =>
      input.ids[0] === "chat-a" ? first.promise : second.promise,
    );
    const setActiveChatId = vi.fn();
    const exitMultiSelect = vi.fn();

    const pending = deleteSelectedChatsSequentially({
      chatIds: ["chat-a", "chat-b"],
      activeChatId: "chat-b",
      deleteMemories: true,
      deleteChats,
      batchSize: 1,
      setActiveChatId,
      exitMultiSelect,
    });

    expect(deleteChats).toHaveBeenCalledTimes(1);
    expect(deleteChats).toHaveBeenNthCalledWith(1, { ids: ["chat-a"], deleteMemories: true });
    expect(exitMultiSelect).not.toHaveBeenCalled();

    first.resolve();
    await Promise.resolve();

    expect(deleteChats).toHaveBeenCalledTimes(2);
    expect(deleteChats).toHaveBeenNthCalledWith(2, { ids: ["chat-b"], deleteMemories: true });
    expect(setActiveChatId).not.toHaveBeenCalled();

    second.resolve();
    await pending;

    expect(setActiveChatId).toHaveBeenCalledWith(null);
    expect(exitMultiSelect).toHaveBeenCalledTimes(1);
  });

  it("resets selection mode when the first delete fails", async () => {
    const deleteChats = vi.fn(async (input: { ids: string[] }) => {
      if (input.ids.includes("chat-a")) throw new Error("storage delete failed");
    });
    const setActiveChatId = vi.fn();
    const exitMultiSelect = vi.fn();

    await expect(
      deleteSelectedChatsSequentially({
        chatIds: ["chat-a", "chat-b"],
        activeChatId: "chat-b",
        deleteMemories: false,
        deleteChats,
        batchSize: 1,
        setActiveChatId,
        exitMultiSelect,
      }),
    ).rejects.toMatchObject({
      deletedCount: 0,
      totalCount: 2,
      failedChatId: "chat-a",
    });

    expect(deleteChats).toHaveBeenCalledTimes(1);
    expect(setActiveChatId).not.toHaveBeenCalled();
    expect(exitMultiSelect).toHaveBeenCalledTimes(1);
  });

  it("reports partial deletion after clearing deleted active chat state", async () => {
    const deleteChats = vi.fn(async (input: { ids: string[] }) => {
      if (input.ids.includes("chat-b")) throw new Error("storage delete failed");
    });
    const setActiveChatId = vi.fn();
    const exitMultiSelect = vi.fn();

    let captured: unknown;
    try {
      await deleteSelectedChatsSequentially({
        chatIds: ["chat-a", "chat-b"],
        activeChatId: "chat-a",
        deleteMemories: false,
        deleteChats,
        batchSize: 1,
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
    expect(deleteChats).toHaveBeenCalledTimes(2);
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
