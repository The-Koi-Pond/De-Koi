import { describe, expect, it, vi } from "vitest";

import { deleteSelectedChatsSequentially } from "./chat-sidebar-batch-actions";

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
    const deleteChat = vi.fn((chatId: string) => (chatId === "chat-a" ? first.promise : second.promise));
    const setActiveChatId = vi.fn();
    const exitMultiSelect = vi.fn();

    const pending = deleteSelectedChatsSequentially({
      chatIds: ["chat-a", "chat-b"],
      activeChatId: "chat-b",
      deleteChat,
      setActiveChatId,
      exitMultiSelect,
    });

    expect(deleteChat).toHaveBeenCalledTimes(1);
    expect(deleteChat).toHaveBeenNthCalledWith(1, "chat-a");
    expect(exitMultiSelect).not.toHaveBeenCalled();

    first.resolve();
    await Promise.resolve();

    expect(deleteChat).toHaveBeenCalledTimes(2);
    expect(deleteChat).toHaveBeenNthCalledWith(2, "chat-b");
    expect(setActiveChatId).not.toHaveBeenCalled();

    second.resolve();
    await pending;

    expect(setActiveChatId).toHaveBeenCalledWith(null);
    expect(exitMultiSelect).toHaveBeenCalledTimes(1);
  });

  it("keeps selection mode open when a delete fails", async () => {
    const deleteChat = vi.fn(async (chatId: string) => {
      if (chatId === "chat-a") throw new Error("storage delete failed");
    });
    const setActiveChatId = vi.fn();
    const exitMultiSelect = vi.fn();

    await expect(
      deleteSelectedChatsSequentially({
        chatIds: ["chat-a", "chat-b"],
        activeChatId: "chat-b",
        deleteChat,
        setActiveChatId,
        exitMultiSelect,
      }),
    ).rejects.toThrow("storage delete failed");

    expect(deleteChat).toHaveBeenCalledTimes(1);
    expect(setActiveChatId).not.toHaveBeenCalled();
    expect(exitMultiSelect).not.toHaveBeenCalled();
  });
});
