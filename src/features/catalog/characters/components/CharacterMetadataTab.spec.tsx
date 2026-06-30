import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CharacterData } from "../../../../engine/contracts/types/character";
import { CharacterMetadataTab } from "./CharacterMetadataTab";

const apiMocks = vi.hoisted(() => ({
  listConnections: vi.fn(async () => [{ id: "conn-1", provider: "openai", isDefault: true }]),
  streamCompletion: vi.fn(async function* () {
    yield { type: "token", text: "I turn fear into a headline. Smile for the camera." };
  }),
}));

vi.mock("../../../../shared/api/storage-api", () => ({
  storageApi: { list: apiMocks.listConnections },
}));

vi.mock("../../../../shared/api/llm-api", () => ({
  llmApi: { stream: apiMocks.streamCompletion },
}));

vi.mock("./CharacterVersionHistoryPanel", () => ({
  CharacterVersionHistoryPanel: () => null,
}));

const formData = {
  name: "The Ghost Face",
  description: "Danny Johnson is The Ghost Face.",
  personality: "Theatrical and patient.",
  scenario: "A city at night.",
  first_mes: "Hello.",
  mes_example: "",
  creator_notes: "PRIVATE NOTES",
  system_prompt: "PRIVATE SYSTEM",
  post_history_instructions: "PRIVATE POST HISTORY",
  tags: ["dbd", "slasher"],
  creator: "",
  character_version: "1.0",
  alternate_greetings: [],
  extensions: {
    talkativeness: 0.5,
    fav: false,
    world: "",
    depth_prompt: { prompt: "", depth: 4, role: "system" },
    backstory: "",
    appearance: "",
  },
  character_book: null,
} satisfies CharacterData;

describe("CharacterMetadataTab public profile generation", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    if (root) {
      act(() => root?.unmount());
    }
    root = null;
    container?.remove();
    container = null;
    vi.clearAllMocks();
  });

  it("writes a generated in-character bio into the public profile", async () => {
    const updateExtension = vi.fn();

    await act(async () => {
      root = createRoot(container!);
      root.render(
        <CharacterMetadataTab
          characterId="char-1"
          formData={formData}
          characterComment="Freelance journalist with a taste for fear"
          updateField={vi.fn()}
          updateExtension={updateExtension}
          newTag=""
          setNewTag={vi.fn()}
          addTag={vi.fn()}
          removeTag={vi.fn()}
          removeAllTags={vi.fn()}
          avatarPreview={null}
        />,
      );
    });

    const generateButton = container!.querySelector<HTMLButtonElement>('button[aria-label="Generate bio"]');
    expect(generateButton).toBeTruthy();

    await act(async () => {
      generateButton!.click();
    });

    expect(apiMocks.streamCompletion).toHaveBeenCalledWith(
      expect.objectContaining({
        connectionId: "conn-1",
        messages: expect.arrayContaining([
          expect.objectContaining({ content: expect.stringContaining("roleplaying") }),
        ]),
      }),
      expect.any(AbortSignal),
    );
    expect(updateExtension).toHaveBeenCalledWith("publicProfile", {
      bio: "I turn fear into a headline. Smile for the camera.",
    });
  });
});
