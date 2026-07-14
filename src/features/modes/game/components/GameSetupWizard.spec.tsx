import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../catalog/connections/index", () => ({
  useConnections: () => ({ data: [] }),
}));

vi.mock("../../../catalog/characters/index", () => ({
  characterAvatarUrl: () => null,
  CharacterAvatarImage: () => null,
  useCharacterSummaries: () => ({ data: [], isLoading: false, isFetching: false, isError: false }),
  useCharacterSummariesByIds: () => ({ data: [] }),
}));

vi.mock("../../../catalog/personas/index", () => ({
  usePersonaSummaries: () => ({ data: [] }),
}));

vi.mock("../../../catalog/lorebooks/index", () => ({
  useLorebooks: () => ({ data: [] }),
}));

import { GameSetupWizard } from "./GameSetupWizard";

function buttonByText(container: HTMLElement, label: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll("button")).find(
    (candidate) => candidate.textContent?.trim() === label,
  );
  if (!button) throw new Error(`Missing button: ${label}`);
  return button;
}

describe("GameSetupWizard selection semantics", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root.render(<GameSetupWizard onComplete={vi.fn()} onCancel={vi.fn()} isLoading={false} />);
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("exposes multi-select, exclusive, and switch state", () => {
    const fantasy = buttonByText(container, "Fantasy");
    const sciFi = buttonByText(container, "Sci-Fi");
    expect(fantasy.getAttribute("aria-pressed")).toBe("true");
    expect(sciFi.getAttribute("aria-pressed")).toBe("false");

    const difficultyGroup = container.querySelector('[role="radiogroup"][aria-label="Difficulty"]');
    expect(difficultyGroup).not.toBeNull();
    expect(buttonByText(container, "Normal").getAttribute("role")).toBe("radio");
    expect(buttonByText(container, "Normal").getAttribute("aria-checked")).toBe("true");
    expect(buttonByText(container, "Hard").getAttribute("aria-checked")).toBe("false");

    act(() => buttonByText(container, "Next").click());
    act(() => buttonByText(container, "Next").click());

    const musicPlayer = buttonByText(
      container,
      "Music PlayerGenerate fresh picks or activate the Music Player agent for automatic scene music",
    );
    expect(musicPlayer.getAttribute("role")).toBe("switch");
    expect(musicPlayer.getAttribute("aria-checked")).toBe("false");
    act(() => musicPlayer.click());
    expect(musicPlayer.getAttribute("aria-checked")).toBe("true");
  });
});
