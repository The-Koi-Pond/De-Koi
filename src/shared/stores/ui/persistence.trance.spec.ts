import { describe, expect, it } from "vitest";
import { migrateUiState } from "./persistence";

describe("trance preferences in the persisted UI state", () => {
  it("keeps valid choices", () => {
    const state = migrateUiState({ tranceBackdrop: "spiral", tranceVoice: "eyes-closed" });
    expect(state.tranceBackdrop).toBe("spiral");
    expect(state.tranceVoice).toBe("eyes-closed");
  });

  it("falls back to Drift and voice off for missing or unknown values", () => {
    expect(migrateUiState({})).toMatchObject({ tranceBackdrop: "drift", tranceVoice: "off" });
    expect(migrateUiState({ tranceBackdrop: "strobe", tranceVoice: true })).toMatchObject({
      tranceBackdrop: "drift",
      tranceVoice: "off",
    });
  });
});
