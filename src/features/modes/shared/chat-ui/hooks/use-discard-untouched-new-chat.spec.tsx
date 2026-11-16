import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useChatStore } from "../../../../../shared/stores/chat.store";
import { useDiscardUntouchedNewChat } from "./use-discard-untouched-new-chat";

// New fic / New session make the chat before the request form shows. These cover which of those chats are
// dropped when left, and that a chat opened any other way is never deleted.

const { mutate } = vi.hoisted(() => ({ mutate: vi.fn() }));
vi.mock("../../../../catalog/chats/index", () => ({ useDeleteChat: () => ({ mutate }) }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function Harness({ chatId, untouched }: { chatId: string; untouched: boolean }) {
  useDiscardUntouchedNewChat(chatId, untouched);
  return null;
}

describe("useDiscardUntouchedNewChat", () => {
  let root: Root;
  const render = (chatId: string, untouched: boolean) =>
    act(() => root.render(<Harness chatId={chatId} untouched={untouched} />));
  const startedWithNew = (chatId: string) =>
    useChatStore
      .getState()
      .setNewChatSetupIntent({ chatId, openSettings: true, openWizard: true, shortcutMode: false });

  beforeEach(() => {
    mutate.mockClear();
    useChatStore.getState().setNewChatSetupIntent(null);
    root = createRoot(document.createElement("div"));
  });

  afterEach(() => {
    act(() => root.unmount());
  });

  it("drops a chat started with New and left untouched, once", () => {
    startedWithNew("new-fic");
    render("new-fic", true);
    expect(useChatStore.getState().newChatSetupIntent).toBeNull();

    render("other-fic", false);
    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate).toHaveBeenCalledWith("new-fic");

    act(() => root.unmount());
    root = createRoot(document.createElement("div"));
    expect(mutate).toHaveBeenCalledTimes(1);
  });

  it("drops it when the screen closes (Home, or a chat in another mode)", () => {
    startedWithNew("new-session");
    render("new-session", true);
    act(() => root.unmount());
    root = createRoot(document.createElement("div"));
    expect(mutate).toHaveBeenCalledWith("new-session");
  });

  it("keeps a chat started with New once something was saved to it", () => {
    startedWithNew("new-fic");
    render("new-fic", true);
    render("new-fic", false);
    render("other-fic", false);
    expect(mutate).not.toHaveBeenCalled();
  });

  it("never deletes an empty chat opened from the list or still there after a reload", () => {
    render("old-empty-fic", true);
    render("other-fic", true);
    act(() => root.unmount());
    root = createRoot(document.createElement("div"));
    expect(mutate).not.toHaveBeenCalled();
  });
});
