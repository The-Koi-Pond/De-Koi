import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CharacterData } from "../../../../engine/contracts/types/character";
import { CharacterColorsTab } from "./CharacterColorsTab";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// The avatar override control loads sprites and gallery images; it has nothing to do with colors.
vi.mock("./ConversationAvatarControl", () => ({
  ConversationAvatarControl: () => null,
  parseConversationAvatarOverride: () => undefined,
}));

/** A card as an importer might hand it over: colors that are numbers, objects and arrays, not text. */
const importedCard = {
  name: "Bad Colors",
  description: "",
  personality: "",
  scenario: "",
  first_mes: "",
  mes_example: "",
  creator_notes: "",
  system_prompt: "",
  post_history_instructions: "",
  tags: [],
  creator: "",
  character_version: "",
  alternate_greetings: [],
  extensions: {
    talkativeness: 0.5,
    fav: false,
    world: "",
    depth_prompt: { prompt: "", depth: 4, role: "system" },
    backstory: "",
    appearance: "",
    nameColor: 16711680,
    dialogueColor: ["#ffffff"],
    boxColor: { r: 255, g: 0, b: 0 },
    trackerCardColors: { mode: "chat" },
  },
  character_book: null,
} as unknown as CharacterData;

describe("CharacterColorsTab", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    act(() => root?.unmount());
    root = null;
    container?.remove();
    container = null;
  });

  it("opens on a card whose colors aren't text and shows them as empty", () => {
    const updateExtension = vi.fn();
    act(() => {
      root = createRoot(container!);
      root.render(
        <CharacterColorsTab
          formData={importedCard}
          updateExtension={updateExtension}
          avatarUrl={null}
          characterId="bad-colors"
        />,
      );
    });

    // The preview falls back to the default name color and bubble.
    const name = [...container!.querySelectorAll<HTMLElement>("span")].find(
      (span) => span.textContent === "Bad Colors",
    )!;
    expect(name.style.color).toBe("rgb(192, 132, 252)");
    const bubble = name.nextElementSibling as HTMLElement;
    expect(bubble.style.backgroundColor).toBe("rgba(255, 255, 255, 0.08)");

    // Both pickers read as unset.
    expect(container!.querySelector('[aria-label^="Name Display Color:"]')!.getAttribute("aria-label")).not.toContain(
      "16711680",
    );
    expect(container!.querySelector('[aria-label^="Message Box Color:"]')!.getAttribute("aria-label")).not.toContain(
      "object",
    );

    // The tracker card controls render with no chat paint.
    expect(container!.textContent).toContain("Character Tracker CardChat colors");
    expect(updateExtension).not.toHaveBeenCalled();
  });
});
