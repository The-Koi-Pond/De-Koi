import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  begin: vi.fn(),
  createChat: { mutate: vi.fn(), isPending: false },
  setPendingNewChatMode: vi.fn(),
}));

vi.mock("@tanstack/react-query", () => ({ useQueryClient: () => ({ invalidateQueries: vi.fn() }) }));
vi.mock("../../../../shared/api/storage-api", () => ({ storageApi: {} }));
vi.mock("../../../../shared/stores/chat.store", () => ({
  useChatStore: { getState: () => ({ setPendingNewChatMode: mocks.setPendingNewChatMode }) },
}));
vi.mock("../../../../shared/stores/setup-journey.store", () => ({
  useSetupJourneyStore: { getState: () => ({ begin: mocks.begin }) },
}));
vi.mock("../../chats/index", () => ({
  chatKeys: { messages: vi.fn() },
  useCreateChat: () => mocks.createChat,
}));
vi.mock("../../chat-presets/index", () => ({
  findUserStarredChatPreset: vi.fn(),
  useApplyChatPreset: () => ({ mutateAsync: vi.fn() }),
  useChatPresets: () => ({ data: [] }),
}));
vi.mock("../../connections/index", () => ({
  useConnections: () => ({ data: [{ id: "connection-1", provider: "openai" }] }),
}));

import { useStartChatFromCharacter } from "./use-start-chat-from-character";

describe("useStartChatFromCharacter", () => {
  let container: HTMLDivElement;
  let root: Root;
  let startChatFromCharacter: ReturnType<typeof useStartChatFromCharacter>["startChatFromCharacter"];

  function Harness() {
    ({ startChatFromCharacter } = useStartChatFromCharacter());
    return null;
  }

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    mocks.begin.mockReset();
    mocks.createChat.mutate.mockReset();
    mocks.setPendingNewChatMode.mockReset();
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("routes a character launch through the shared setup journey", () => {
    act(() => root.render(<Harness />));

    act(() => startChatFromCharacter({ characterId: "character-1", characterName: "Mira", mode: "roleplay" }));

    expect(mocks.begin).toHaveBeenCalledWith("roleplay", "character-1");
    expect(mocks.setPendingNewChatMode).toHaveBeenCalledWith("roleplay");
    expect(mocks.createChat.mutate).not.toHaveBeenCalled();
  });
});
