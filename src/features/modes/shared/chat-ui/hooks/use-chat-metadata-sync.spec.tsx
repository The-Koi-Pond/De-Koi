import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { chatBackgroundMetadataToUrl } from "../../../../../shared/lib/backgrounds";
import { useUIStore } from "../../../../../shared/stores/ui.store";
import { useChatMetadataSync } from "./use-chat-metadata-sync";

vi.mock("../../../../catalog/chats/index", () => ({
  useUpdateChatMetadata: () => ({ mutate: vi.fn() }),
}));

function Probe({ chatId, background }: { chatId: string; background?: string | null }) {
  const { chatBackground } = useChatMetadataSync({
    chat: { id: chatId } as never,
    chatMeta: { background },
    messages: [],
    messagePageCount: 1,
  });

  return <div data-testid="background" data-background={chatBackground ?? ""} />;
}

describe("useChatMetadataSync", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  beforeEach(() => {
    useUIStore.getState().setChatBackground(null);
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    if (root) {
      act(() => {
        root?.unmount();
      });
    }
    root = null;
    container?.remove();
    container = null;
    useUIStore.getState().setChatBackground(null);
    vi.restoreAllMocks();
  });

  it("renders the target chat background on chat switches before store restore effects run", () => {
    const oldBackground = chatBackgroundMetadataToUrl("old-bg.png");

    act(() => {
      root = createRoot(container!);
      root.render(<Probe chatId="chat-a" background="old-bg.png" />);
    });

    expect(container!.querySelector("[data-testid='background']")?.getAttribute("data-background")).toBe(oldBackground);

    act(() => {
      useUIStore.getState().setChatBackground(oldBackground);
      root!.render(<Probe chatId="chat-b" background={null} />);
    });

    expect(container!.querySelector("[data-testid='background']")?.getAttribute("data-background")).toBe("");
  });
});
