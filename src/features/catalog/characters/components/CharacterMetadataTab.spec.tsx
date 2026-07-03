import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CharacterData } from "../../../../engine/contracts/types/character";
import { CharacterMetadataTab } from "./CharacterMetadataTab";

const apiMocks = vi.hoisted(() => ({
  listConnections: vi.fn(async () => [{ id: "conn-1", provider: "openai", isDefault: true }]),
  streamCompletion: vi.fn(async function* (_request?: unknown) {
    yield { type: "token", text: "I turn fear into a headline. Smile for the camera." };
  }),
  generateImage: vi.fn(async () => ({ image: "data:image/png;base64,banner" })),
  uploadCharacterDataUrl: vi.fn(async () => ({ url: "http://pi:7860/api/assets/gallery/rook-banner.png" })),
}));

vi.mock("../../../../shared/api/storage-api", () => ({
  storageApi: { list: apiMocks.listConnections },
}));

vi.mock("../../../../shared/api/llm-api", () => ({
  llmApi: { stream: apiMocks.streamCompletion },
}));

vi.mock("../../../../shared/api/image-generation-api", () => ({
  imageGenerationApi: { generate: apiMocks.generateImage },
  galleryApi: { uploadCharacterDataUrl: apiMocks.uploadCharacterDataUrl },
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
          imageConnections={[
            { id: "image-1", name: "Default Image", provider: "image_generation", defaultForAgents: true },
          ]}
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

  it("stores a generated in-character banner image as a managed gallery asset", async () => {
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
          imageConnections={[
            { id: "image-1", name: "Default Image", provider: "image_generation", defaultForAgents: true },
          ]}
        />,
      );
    });

    const generateButton = container!.querySelector<HTMLButtonElement>('button[aria-label="Generate banner image"]');
    expect(generateButton).toBeTruthy();

    await act(async () => {
      generateButton!.click();
    });

    expect(apiMocks.generateImage).toHaveBeenCalledWith(
      expect.objectContaining({
        connectionId: "image-1",
        prompt: expect.stringContaining("the public profile banner this character would choose for themself"),
      }),
    );
    expect(apiMocks.uploadCharacterDataUrl).toHaveBeenCalledWith(
      "char-1",
      "data:image/png;base64,banner",
      expect.objectContaining({ filename: "The Ghost Face-public-profile-banner.png" }),
    );
    expect(updateExtension).toHaveBeenCalledWith("publicProfile", {
      bannerImage: "http://pi:7860/api/assets/gallery/rook-banner.png",
    });
  });

  it("writes generated favorite music artists into the music profile", async () => {
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
          imageConnections={[]}
        />,
      );
    });

    const generateButton = container!.querySelector<HTMLButtonElement>(
      'button[aria-label="Generate Favorite Music Artists"]',
    );
    expect(generateButton).toBeTruthy();
    apiMocks.streamCompletion.mockImplementationOnce(async function* (_request?: unknown) {
      yield { type: "token", text: '["Portishead", "Akira Yamaoka"]' };
    });

    await act(async () => {
      generateButton!.click();
    });

    expect(apiMocks.streamCompletion).toHaveBeenCalledWith(
      expect.objectContaining({
        connectionId: "conn-1",
        messages: expect.arrayContaining([
          expect.objectContaining({ content: expect.stringContaining("Requested field: Favorite Music Artists") }),
        ]),
      }),
      expect.any(AbortSignal),
    );
    expect(updateExtension).toHaveBeenCalledWith("musicProfile", {
      publicListeningEnabled: false,
      favoriteGenres: [],
      favoriteArtists: ["Portishead", "Akira Yamaoka"],
      favoriteSongs: [],
      vibeNotes: "",
    });
  });
  it("starts another public profile wand request while a previous wand is still pending", async () => {
    const releases: Array<() => void> = [];
    const requestedFields: string[] = [];
    apiMocks.streamCompletion.mockImplementation(async function* (request: unknown) {
      const messages = (request as { messages?: Array<{ content?: string }> }).messages ?? [];
      const userMessage = messages[1]?.content ?? "";
      const match = /Requested field: ([^\n]+)/.exec(userMessage);
      requestedFields.push(match?.[1] ?? "unknown");
      await new Promise<void>((resolve) => releases.push(resolve));
      yield { type: "token", text: match?.[1] === "handle" ? "@mira_keys" : "Mira Vale" };
    });

    const updateExtension = vi.fn();

    act(() => {
      root = createRoot(container!);
      root.render(
        <CharacterMetadataTab
          characterId={null}
          formData={formData}
          characterComment="Night-shift archive keeper"
          updateField={vi.fn()}
          updateExtension={updateExtension}
          newTag=""
          setNewTag={vi.fn()}
          addTag={vi.fn()}
          removeTag={vi.fn()}
          removeAllTags={vi.fn()}
          avatarPreview={null}
          imageConnections={[]}
        />,
      );
    });

    const displayNameButton = container!.querySelector<HTMLButtonElement>("[aria-label='Generate display name']");
    const handleButton = container!.querySelector<HTMLButtonElement>("[aria-label='Generate handle']");

    expect(displayNameButton).not.toBeNull();
    expect(handleButton).not.toBeNull();

    await act(async () => {
      displayNameButton!.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      handleButton!.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(requestedFields).toEqual(["display name", "handle"]);

    await act(async () => {
      releases.forEach((release) => release());
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(updateExtension).toHaveBeenLastCalledWith("publicProfile", {
      displayName: "Mira Vale",
      handle: "@mira_keys",
    });
  });
});
