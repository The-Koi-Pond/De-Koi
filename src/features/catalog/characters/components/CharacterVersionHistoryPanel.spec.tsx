import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CharacterCardVersion, CharacterData } from "../../../../engine/contracts/types/character";
import { showConfirmDialog } from "../../../../shared/lib/app-dialogs";
import { CharacterVersionHistoryPanel } from "./CharacterVersionHistoryPanel";

const setPinned = vi.hoisted(() => ({ mutateAsync: vi.fn(), isPending: false }));
const restoreVersion = vi.hoisted(() => ({ mutateAsync: vi.fn(), isPending: false }));
const deleteVersion = vi.hoisted(() => ({ mutateAsync: vi.fn(), isPending: false, variables: undefined }));
const versionsState = vi.hoisted(() => ({ versions: [] as CharacterCardVersion[] }));

vi.mock("../hooks/use-characters", () => ({
  useCharacterVersions: () => ({ data: versionsState.versions, isLoading: false }),
  useDeleteCharacterVersion: () => deleteVersion,
  useRestoreCharacterVersion: () => restoreVersion,
  useSetCharacterVersionPinned: () => setPinned,
}));

vi.mock("../../../../shared/lib/app-dialogs", () => ({ showConfirmDialog: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const data = { name: "Test Character", character_version: "1.0" } as CharacterData;
const props = {
  characterId: "char-1",
  currentData: data,
  currentComment: "",
  currentAvatarPath: null,
};

function version(index: number, pinned = false): CharacterCardVersion {
  return {
    id: `version-${index + 1}`,
    characterId: "char-1",
    data,
    comment: "",
    avatarPath: null,
    version: "1.0",
    source: "manual",
    reason: "edit",
    createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, 51 - index)).toISOString(),
    pinned,
  };
}

describe("CharacterVersionHistoryPanel", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    setPinned.mutateAsync.mockResolvedValue(undefined);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    versionsState.versions = [];
    vi.clearAllMocks();
  });

  async function renderPanel() {
    await act(async () => root.render(<CharacterVersionHistoryPanel {...props} />));
  }

  it("pins and unpins versions with accessible labels", async () => {
    versionsState.versions = [version(0), version(1, true)];
    await renderPanel();

    expect(container.textContent).toContain("De-Koi keeps the newest 50 unpinned versions plus all pinned versions.");
    const pinButton = container.querySelector<HTMLButtonElement>('button[aria-label="Pin version"]');
    const unpinButton = container.querySelector<HTMLButtonElement>('button[aria-label="Unpin version"]');
    expect(pinButton).toBeTruthy();
    expect(unpinButton).toBeTruthy();

    await act(async () => pinButton!.click());
    expect(setPinned.mutateAsync).toHaveBeenCalledWith({
      characterId: "char-1",
      versionId: "version-1",
      pinned: true,
    });
  });

  it("always confirms before unpinning even when client ordering differs from storage", async () => {
    versionsState.versions = [version(0, true)];
    vi.mocked(showConfirmDialog).mockResolvedValue(false);
    await renderPanel();

    const unpinButton = container.querySelector<HTMLButtonElement>('button[aria-label="Unpin version"]');
    await act(async () => unpinButton!.click());

    expect(showConfirmDialog).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining("may be deleted immediately") }),
    );
    expect(setPinned.mutateAsync).not.toHaveBeenCalled();
  });

  it("confirms before unpinning a protected version", async () => {
    versionsState.versions = Array.from({ length: 51 }, (_, index) => version(index, index === 50));
    vi.mocked(showConfirmDialog).mockResolvedValue(false);
    await renderPanel();

    const unpinButton = container.querySelector<HTMLButtonElement>('button[aria-label="Unpin version"]');
    expect(unpinButton).toBeTruthy();
    await act(async () => unpinButton!.click());

    expect(showConfirmDialog).toHaveBeenCalledWith(
      expect.objectContaining({
        message:
          "Unpin this version? De-Koi keeps only the newest 50 unpinned versions, so this older version may be deleted immediately.",
      }),
    );
    expect(setPinned.mutateAsync).not.toHaveBeenCalled();
  });

  it("unpins the confirmed older version", async () => {
    versionsState.versions = Array.from({ length: 51 }, (_, index) => version(index, index === 50));
    vi.mocked(showConfirmDialog).mockResolvedValue(true);
    await renderPanel();

    const unpinButton = container.querySelector<HTMLButtonElement>('button[aria-label="Unpin version"]');
    expect(unpinButton).toBeTruthy();
    await act(async () => unpinButton!.click());

    expect(showConfirmDialog).toHaveBeenCalled();
    expect(setPinned.mutateAsync).toHaveBeenCalledWith({
      characterId: "char-1",
      versionId: "version-51",
      pinned: false,
    });
  });
});
