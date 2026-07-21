import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const fixtures = vi.hoisted(() => ({
  chat: {
    id: "chat-1",
    mode: "roleplay",
    promptPresetId: "preset-old" as string | null,
    metadata: { presetChoices: { tone: "warm" } } as { presetChoices: Record<string, string> },
  },
  updateChatMutate: vi.fn(),
  updateChatMutateAsync: vi.fn(),
  updateMetadataMutate: vi.fn(),
  updateMetadataMutateAsync: vi.fn(),
}));

vi.mock("../hooks/use-presets", () => ({
  usePresets: () => ({
    data: [
      { id: "preset-old", name: "Old preset", description: "", sectionOrder: [] },
      { id: "preset-new", name: "New preset", description: "", sectionOrder: [] },
    ],
    isLoading: false,
  }),
  useDeletePreset: () => ({ mutate: vi.fn() }),
  useDuplicatePreset: () => ({ mutate: vi.fn() }),
  useSetDefaultPreset: () => ({ mutate: vi.fn() }),
}));
vi.mock("../../chats/index", () => ({
  useUpdateChat: () => ({ mutate: fixtures.updateChatMutate, mutateAsync: fixtures.updateChatMutateAsync }),
  useUpdateChatMetadata: () => ({
    mutate: fixtures.updateMetadataMutate,
    mutateAsync: fixtures.updateMetadataMutateAsync,
  }),
}));
vi.mock("../../agents/index", () => ({
  useCustomToolCapabilities: () => ({ data: {} }),
  useCustomTools: () => ({ data: [] }),
  useDeleteCustomTool: () => ({ mutate: vi.fn() }),
  useSetCustomToolEnabled: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("../../regex-scripts/shell", () => ({ RegexScriptsSection: () => null }));
vi.mock("../../../../shared/stores/chat.store", () => ({
  useChatStore: (selector: (state: { activeChat: typeof fixtures.chat }) => unknown) =>
    selector({ activeChat: fixtures.chat }),
}));
vi.mock("../../../../shared/stores/ui.store", () => ({
  useUIStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({ openModal: vi.fn(), openPresetDetail: vi.fn(), openToolDetail: vi.fn() }),
}));
vi.mock("../../../../shared/api/export-api", () => ({ exportApi: {} }));
vi.mock("../../../../shared/api/storage-api", () => ({ storageApi: { list: vi.fn().mockResolvedValue([]) } }));
vi.mock("../../../../shared/lib/app-dialogs", () => ({ showConfirmDialog: vi.fn() }));
vi.mock("./ChoiceSelectionModal", () => ({ ChoiceSelectionModal: () => null }));
vi.mock("../../library-folders", () => ({
  LibraryFolderSelect: () => null,
  getNextUnnamedLibraryFolderName: () => "New Folder",
  useCreateLibraryFolder: () => ({ mutate: vi.fn() }),
  useDeleteLibraryFolder: () => ({ mutate: vi.fn() }),
  useLibraryFolders: () => ({ data: [], isLoading: false, isError: false, refetch: vi.fn() }),
  useMoveLibraryItem: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateLibraryFolder: () => ({ mutate: vi.fn() }),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn() } }));

import { PresetsPanel } from "./PresetsPanel";

function assignButton(container: HTMLElement, presetName: string): HTMLButtonElement {
  const row = Array.from(container.querySelectorAll<HTMLElement>("span"))
    .find((element) => element.textContent === presetName)
    ?.closest("div.group");
  const button = row?.querySelector<HTMLButtonElement>('button[title="Assign to chat"]');
  if (!button) throw new Error(`Missing assign button for ${presetName}`);
  return button;
}

describe("PresetsPanel preset switching", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    fixtures.chat.promptPresetId = "preset-old";
    fixtures.chat.metadata = { presetChoices: { tone: "warm" } };
    vi.clearAllMocks();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root.render(<PresetsPanel />));
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("leaves existing choices untouched when preset assignment fails", async () => {
    fixtures.updateChatMutate.mockImplementation((_patch, options) => {
      options?.onError?.(new Error("storage unavailable"));
    });
    fixtures.updateChatMutateAsync.mockRejectedValue(new Error("storage unavailable"));
    fixtures.updateMetadataMutate.mockImplementation((patch) => {
      fixtures.chat.metadata = { ...fixtures.chat.metadata, ...patch };
    });

    await act(async () => assignButton(container, "New preset").click());

    expect(fixtures.chat.promptPresetId).toBe("preset-old");
    expect(fixtures.chat.metadata.presetChoices).toEqual({ tone: "warm" });
    expect(fixtures.updateMetadataMutate).not.toHaveBeenCalled();
    expect(fixtures.updateMetadataMutateAsync).not.toHaveBeenCalled();
  });

  it("restores the prior preset when clearing choices fails", async () => {
    fixtures.updateChatMutateAsync.mockImplementation(async (patch) => {
      fixtures.chat.promptPresetId = patch.promptPresetId;
      return fixtures.chat;
    });
    fixtures.updateMetadataMutateAsync.mockRejectedValue(new Error("metadata unavailable"));

    await act(async () => assignButton(container, "New preset").click());

    expect(fixtures.updateChatMutateAsync).toHaveBeenNthCalledWith(1, {
      id: "chat-1",
      promptPresetId: "preset-new",
    });
    expect(fixtures.updateChatMutateAsync).toHaveBeenNthCalledWith(2, {
      id: "chat-1",
      promptPresetId: "preset-old",
    });
    expect(fixtures.chat.promptPresetId).toBe("preset-old");
    expect(fixtures.chat.metadata.presetChoices).toEqual({ tone: "warm" });
  });
});
