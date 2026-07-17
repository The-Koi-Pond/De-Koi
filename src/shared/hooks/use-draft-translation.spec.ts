import { describe, expect, it } from "vitest";
import { getDraftTranslationActionState } from "./use-draft-translation";

describe("getDraftTranslationActionState", () => {
  it("enables Translate only while idle with an available draft", () => {
    expect(getDraftTranslationActionState({ isTranslating: false, canStart: true })).toEqual({
      action: "translate",
      disabled: false,
    });
    expect(getDraftTranslationActionState({ isTranslating: false, canStart: false })).toEqual({
      action: "translate",
      disabled: true,
    });
  });

  it("always exposes an enabled Cancel action for an active request", () => {
    expect(getDraftTranslationActionState({ isTranslating: true, canStart: false })).toEqual({
      action: "cancel",
      disabled: false,
    });
  });
});
