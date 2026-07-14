import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const setupFixtures = vi.hoisted(() => ({
  connections: [
    { id: "gm-connection", name: "GM Connection", provider: "openai", model: "test-model" },
    { id: "image-connection", name: "Image Connection", provider: "image_generation", model: "test-image" },
  ],
  characters: [{ id: "gm-character", data: { name: "Guide" } }],
}));

vi.mock("../../../catalog/connections/index", () => ({
  useConnections: () => ({ data: setupFixtures.connections }),
}));

vi.mock("../../../catalog/characters/index", () => ({
  characterAvatarUrl: () => null,
  CharacterAvatarImage: () => null,
  useCharacterSummaries: () => ({
    data: setupFixtures.characters,
    isLoading: false,
    isFetching: false,
    isError: false,
  }),
  useCharacterSummariesByIds: () => ({ data: setupFixtures.characters }),
}));

vi.mock("../../../catalog/personas/index", () => ({
  usePersonaSummaries: () => ({ data: [] }),
}));

vi.mock("../../../catalog/lorebooks/index", () => ({
  useLorebooks: () => ({ data: [] }),
}));

import { GameSetupWizard } from "./GameSetupWizard";

type OnComplete = ComponentProps<typeof GameSetupWizard>["onComplete"];

function buttonByText(container: HTMLElement, label: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll("button")).find(
    (candidate) => candidate.textContent?.trim() === label,
  );
  if (!button) throw new Error(`Missing button: ${label}`);
  return button;
}

function buttonContainingText(container: HTMLElement, label: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll("button")).find((candidate) =>
    candidate.textContent?.includes(label),
  );
  if (!button) throw new Error(`Missing button containing: ${label}`);
  return button;
}

function selectValue(select: HTMLSelectElement, value: string): void {
  const valueSetter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set;
  valueSetter?.call(select, value);
  select.dispatchEvent(new Event("change", { bubbles: true }));
}

describe("GameSetupWizard selection semantics", () => {
  let container: HTMLDivElement;
  let root: Root;
  let onComplete: ReturnType<typeof vi.fn<OnComplete>>;

  beforeEach(() => {
    onComplete = vi.fn<OnComplete>();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root.render(<GameSetupWizard onComplete={onComplete} onCancel={vi.fn()} isLoading={false} />);
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

  it("blocks Character GM setup until a GM character is selected", () => {
    act(() => buttonByText(container, "Next").click());
    act(() => buttonByText(container, "Character GMUse an existing character as GM").click());
    act(() => buttonByText(container, "Next").click());

    const gmConnection = container.querySelector<HTMLSelectElement>("select");
    expect(gmConnection).not.toBeNull();
    act(() => selectValue(gmConnection!, "gm-connection"));
    act(() => buttonByText(container, "Next").click());

    expect(buttonByText(container, "Start Game").disabled).toBe(true);
    expect(container.textContent).toContain(
      "Select a GM character on the Party & GM step or choose Standalone GM.",
    );
  });

  it("blocks automatic image generation until an image connection is selected", () => {
    act(() => buttonByText(container, "Next").click());
    act(() => buttonByText(container, "Next").click());

    const gmConnection = container.querySelector<HTMLSelectElement>("select");
    expect(gmConnection).not.toBeNull();
    act(() => selectValue(gmConnection!, "gm-connection"));
    act(() =>
      buttonByText(
        container,
        "Image GenerationAuto-generate NPC portraits and location backgrounds during gameplay",
      ).click(),
    );
    act(() => buttonByText(container, "Next").click());

    expect(buttonByText(container, "Start Game").disabled).toBe(true);
    expect(container.textContent).toContain(
      "Select an image generation connection on the You & Model step or turn Image Generation off.",
    );
  });

  it("submits the enabled dependent configuration once every requirement is satisfied", () => {
    act(() => buttonByText(container, "Next").click());
    act(() => buttonByText(container, "Character GMUse an existing character as GM").click());
    act(() => buttonContainingText(container, "Guide").click());
    act(() => buttonByText(container, "Next").click());

    const setupSelects = Array.from(container.querySelectorAll<HTMLSelectElement>("select"));
    act(() => selectValue(setupSelects[0]!, "gm-connection"));
    act(() =>
      buttonByText(
        container,
        "Image GenerationAuto-generate NPC portraits and location backgrounds during gameplay",
      ).click(),
    );
    const imageConnection = Array.from(container.querySelectorAll<HTMLSelectElement>("select")).at(-1);
    expect(imageConnection).not.toBeUndefined();
    act(() => selectValue(imageConnection!, "image-connection"));
    act(() => buttonByText(container, "Next").click());

    const startButton = buttonByText(container, "Start Game");
    expect(startButton.disabled).toBe(false);
    act(() => startButton.click());

    expect(onComplete).toHaveBeenCalledWith(
      expect.objectContaining({
        gmMode: "character",
        gmCharacterId: "gm-character",
        enableSpriteGeneration: true,
        imageConnectionId: "image-connection",
      }),
      expect.any(String),
      expect.objectContaining({ gmConnectionId: "gm-connection" }),
      undefined,
    );
  });
});
