// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useChatStore } from "../../../../shared/stores/chat.store";
import { ModeHomeSurface } from "./ModeHomeSurface";

vi.mock("../../../catalog/connections/index", () => ({
  useConnections: () => ({ data: [] }),
}));

vi.mock("../../../catalog/chats/index", () => ({
  useCreateChat: () => ({ mutate: vi.fn() }),
  useRecentChatSummaries: () => ({ data: [] }),
}));

vi.mock("../../../catalog/characters/index", () => ({
  useCharacterSummariesByIds: () => ({ data: [] }),
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("ModeHomeSurface", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    useChatStore.setState({ pendingNewChatMode: null });
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it("renders Discover on the homepage instead of the FAQ", () => {
    act(() => {
      root.render(<ModeHomeSurface discoverySurface={<section>Discover Marinara</section>} />);
    });

    expect(container.textContent).toContain("Discover Marinara");
    expect(container.textContent).not.toContain("Professor Mari's FAQ");
  });
});
