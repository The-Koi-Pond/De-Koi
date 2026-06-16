import { describe, expect, it } from "vitest";
import { createDefaultImageStyleProfileSettings } from "../../../engine/generation/image-style-profiles";
import { migrateUiState, UI_STORE_VERSION } from "./persistence";

describe("ui persistence migration", () => {
  it("bumps the store version for the Deki chibi setting migration", () => {
    expect(UI_STORE_VERSION).toBe(9);
  });

  it("hydrates the legacy chibi assistant setting to Deki", () => {
    const migrated = migrateUiState({
      chibiProfessorMariEnabled: false,
    });

    expect(migrated.chibiDekiEnabled).toBe(false);
  });

  it("preserves an explicit Deki chibi setting over the legacy setting", () => {
    const migrated = migrateUiState({
      chibiDekiEnabled: true,
      chibiProfessorMariEnabled: false,
    });

    expect(migrated.chibiDekiEnabled).toBe(true);
  });

  it("hydrates legacy tag prompt settings to the Danbooru image style profile", () => {
    const migrated = migrateUiState({
      imagePromptFormat: "tags",
    });

    expect(migrated.imagePromptFormat).toBe("tags");
    expect(migrated.imageStyleProfiles?.defaultProfileId).toBe("danbooru");
  });

  it("preserves an existing valid image style profile selection", () => {
    const existing = createDefaultImageStyleProfileSettings();
    existing.defaultProfileId = "cinematic";
    const migrated = migrateUiState({
      imagePromptFormat: "tags",
      imageStyleProfiles: existing,
    });

    expect(migrated.imageStyleProfiles?.defaultProfileId).toBe("cinematic");
  });

  it("repairs malformed style profiles from the legacy prompt format", () => {
    const migrated = migrateUiState({
      imagePromptFormat: "tags",
      imageStyleProfiles: { defaultProfileId: "auto", profiles: [] },
    });

    expect(migrated.imageStyleProfiles?.defaultProfileId).toBe("danbooru");
  });

  it("hydrates the legacy conversation bubble message layout", () => {
    const migrated = migrateUiState({
      conversationMessageStyle: "bubble",
    });

    expect(migrated.conversationMessageStyle).toBe("bubble");
  });

  it("repairs unknown conversation message layouts to classic", () => {
    const migrated = migrateUiState({
      conversationMessageStyle: "compact",
    });

    expect(migrated.conversationMessageStyle).toBe("classic");
  });
});
