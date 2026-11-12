import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useNewChatDraft } from "./use-new-chat-draft";

// Closing the setup wizard used to delete whatever chat was active, and the wizard stayed open when another
// chat was opened, so closing it deleted that real chat. These cover which chats the wizard may delete.

const { mutate, mutateAsync } = vi.hoisted(() => ({
  mutate: vi.fn(),
  mutateAsync: vi.fn(() => Promise.resolve({})),
}));
vi.mock("../../../../catalog/chats/index", () => ({ useDeleteChat: () => ({ mutate, mutateAsync }) }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Props = {
  activeChatId: string | null;
  setupChatId: string | null;
  chatCharIds?: string[];
  totalMessageCount?: number;
};

const finishWizard = vi.fn();
let draft: ReturnType<typeof useNewChatDraft>;

function Harness({ activeChatId, setupChatId, chatCharIds = [], totalMessageCount = 0 }: Props) {
  draft = useNewChatDraft({
    activeChatId,
    overlays: { newChatSetupChatId: setupChatId, setWizardOpen: vi.fn(), clearNewChatSetup: vi.fn(), finishWizard },
    chatCharIds,
    totalMessageCount,
    messagesLoaded: true,
  });
  return null;
}

describe("useNewChatDraft", () => {
  let container: HTMLDivElement;
  let root: Root;
  const render = (props: Props) => act(() => root.render(<Harness {...props} />));

  beforeEach(() => {
    mutate.mockClear();
    mutateAsync.mockClear();
    finishWizard.mockClear();
    container = document.createElement("div");
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
  });

  it("only closes the wizard when it is open on a chat that is not the new draft", () => {
    render({ activeChatId: "real-chat", setupChatId: null, chatCharIds: ["vera"], totalMessageCount: 12 });
    act(() => draft.cancel());
    expect(mutateAsync).not.toHaveBeenCalled();
    expect(finishWizard).toHaveBeenCalledTimes(1);
  });

  it("drops the new draft on close when nothing was written in it", () => {
    render({ activeChatId: "draft", setupChatId: "draft", chatCharIds: ["wren"] });
    act(() => draft.cancel());
    expect(mutateAsync).toHaveBeenCalledWith("draft");
  });

  it("drops an unused draft once when you leave it, and keeps a chat you left after starting", () => {
    render({ activeChatId: "draft", setupChatId: "draft" });
    render({ activeChatId: "other", setupChatId: null, chatCharIds: ["vera"], totalMessageCount: 3 });
    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate).toHaveBeenCalledWith("draft");

    render({ activeChatId: null, setupChatId: null });
    expect(mutate).toHaveBeenCalledTimes(1);
  });

  it("keeps a draft you picked someone for when you leave it", () => {
    render({ activeChatId: "draft", setupChatId: "draft", chatCharIds: ["wren"] });
    render({ activeChatId: null, setupChatId: null });
    expect(mutate).not.toHaveBeenCalled();
  });

  it("does not delete again on leave after Skip already dropped the draft", () => {
    render({ activeChatId: "draft", setupChatId: "draft" });
    act(() => draft.finish());
    expect(mutateAsync).toHaveBeenCalledTimes(1);
    render({ activeChatId: null, setupChatId: null });
    expect(mutate).not.toHaveBeenCalled();
  });
});
