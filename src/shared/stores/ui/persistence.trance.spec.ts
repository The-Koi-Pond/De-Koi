import { describe, expect, it } from "vitest";
import { migrateUiState } from "./persistence";

describe("trance preferences in the persisted UI state", () => {
  it("keeps valid choices", () => {
    const state = migrateUiState({
      tranceBackdrop: "spiral",
      tranceVoice: "eyes-closed",
      trancePace: "auto",
      tranceButtonWords: "affirming",
      tranceAmbience: "rain",
      tranceAmbienceVolume: 0.2,
    });
    expect(state.tranceAmbience).toBe("rain");
    expect(state.tranceAmbienceVolume).toBe(0.2);
    expect(state.tranceBackdrop).toBe("spiral");
    expect(state.tranceVoice).toBe("eyes-closed");
    expect(state.trancePace).toBe("auto");
    expect(state.tranceButtonWords).toBe("affirming");
  });

  it("falls back to Drift, voice off, pressing, quiet words and picked sound for missing or unknown values", () => {
    const defaults = {
      tranceBackdrop: "drift",
      tranceVoice: "off",
      trancePace: "press",
      tranceButtonWords: "quiet",
      tranceAmbience: "auto",
      tranceAmbienceVolume: 0.5,
    };
    expect(migrateUiState({})).toMatchObject(defaults);
    expect(
      migrateUiState({
        tranceBackdrop: "strobe",
        tranceVoice: true,
        trancePace: "fast",
        tranceButtonWords: 3,
        tranceAmbience: "thunder",
        tranceAmbienceVolume: "loud",
      }),
    ).toMatchObject(defaults);
  });
});
