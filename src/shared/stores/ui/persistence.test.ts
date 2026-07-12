import { describe, expect, it } from "vitest";
import { createDefaultImageStyleProfileSettings } from "../../../engine/generation/image-style-profiles";
import type { UIState } from "./model";
import type { SetupJourneyIntent } from "../../../engine/onboarding";
import {
  migrateUiState,
  partializeSetupJourneyState,
  partializeUiState,
  UI_STORE_VERSION,
} from "./persistence";

describe("ui persistence migration", () => {
  it("bumps the store version for the chibi visit setting removal", () => {
    expect(UI_STORE_VERSION).toBe(11);
  });

  it("drops legacy chibi visit settings during migration", () => {
    const migrated = migrateUiState({
      chibiDekiEnabled: true,
      chibiProfessorMariEnabled: false,
    });

    expect(migrated).not.toHaveProperty("chibiDekiEnabled");
    expect(migrated).not.toHaveProperty("chibiProfessorMariEnabled");
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

  it("restores conversation timestamps for persisted UI state", () => {
    const migrated = migrateUiState({
      showTimestamps: false,
    });

    expect(migrated.showTimestamps).toBe(true);
  });

  it("persists the Echo Chamber open state with its placement settings", () => {
    const partialized = partializeUiState({
      chibiDekiEnabled: true,
      echoChamberOpen: true,
      echoChamberSide: "top-left",
      echoChamberDismissedChatIds: { "chat-1": true },
    } as unknown as UIState);

    expect(partialized).not.toHaveProperty("chibiDekiEnabled");
    expect(partialized.echoChamberOpen).toBe(true);
    expect(partialized.echoChamberSide).toBe("top-left");
    expect(partialized.echoChamberDismissedChatIds).toEqual({ "chat-1": true });
  });
});

describe("setup journey persistence", () => {
  it("allowlists only resumable journey metadata", () => {
    const intent: SetupJourneyIntent & Record<string, unknown> = {
      journeyId: "journey-1",
      mode: "roleplay",
      originCharacterId: "character-1",
      selectedConnectionId: "connection-1",
      dismissed: true,
      completed: false,
      apiToken: "do-not-persist",
      credential: "do-not-persist",
      providerPayload: { secret: "do-not-persist" },
    };

    const serialized = partializeSetupJourneyState({ intent });

    expect(serialized).toEqual({
      intent: {
        journeyId: "journey-1",
        mode: "roleplay",
        originCharacterId: "character-1",
        selectedConnectionId: "connection-1",
        dismissed: true,
        completed: false,
      },
    });
    expect(JSON.stringify(serialized)).not.toMatch(/api|credential|secret|token|providerPayload/i);
  });
});
