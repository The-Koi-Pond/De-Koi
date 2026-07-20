import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CharacterData } from "../../../../engine/contracts/types/character";
import { CharacterEditorHeader } from "./CharacterEditorHeader";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const character: CharacterData = {
  name: "Mira",
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
  },
  character_book: null,
};

describe("CharacterEditorHeader", () => {
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

  it("shows when detached behavioral data is refreshing without replacing the editor", async () => {
    const action = vi.fn();
    await act(async () => {
      root = createRoot(container!);
      root.render(
        <CharacterEditorHeader
          characterId="mira"
          formData={character}
          characterComment=""
          avatarPreview={null}
          avatarUploading={false}
          dirty={false}
          imageGenerationAvailable={false}
          isImportingPersona={false}
          isStartingChat={false}
          refreshingDerivedArtifact
          saving={false}
          onAvatarUpload={action}
          onBack={action}
          onCommentChange={action}
          onDelete={action}
          onDuplicate={action}
          onExport={action}
          onGenerateAvatar={action}
          onImportAsPersona={action}
          onNameChange={action}
          onRemoveAvatar={action}
          onSave={action}
          onStartChat={action}
          onToggleFavorite={action}
        />,
      );
    });

    expect(container!.querySelector('[role="status"]')?.textContent).toContain("Refreshing behavior");
    expect(container!.querySelector<HTMLInputElement>('input[value="Mira"]')).not.toBeNull();
  });
});
