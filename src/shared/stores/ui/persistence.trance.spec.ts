import { describe, expect, it } from "vitest";
import { migrateUiState } from "./persistence";

describe("trance preferences in the persisted UI state", () => {
  it("keeps valid choices", () => {
    const state = migrateUiState({
      tranceBackdrop: "spiral",
      tranceVoice: "eyes-closed",
      trancePace: "auto",
      tranceButtonWords: "affirming",
    });
    expect(state.tranceBackdrop).toBe("spiral");
    expect(state.tranceVoice).toBe("eyes-closed");
    expect(state.trancePace).toBe("auto");
    expect(state.tranceButtonWords).toBe("affirming");
  });

  it("falls back to Drift, voice off, pressing and quiet words for missing or unknown values", () => {
    const defaults = { tranceBackdrop: "drift", tranceVoice: "off", trancePace: "press", tranceButtonWords: "quiet" };
    expect(migrateUiState({})).toMatchObject(defaults);
    expect(
      migrateUiState({ tranceBackdrop: "strobe", tranceVoice: true, trancePace: "fast", tranceButtonWords: 3 }),
    ).toMatchObject(defaults);
  });
});
