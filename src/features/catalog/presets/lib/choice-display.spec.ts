import { describe, expect, it } from "vitest";
import type { ChoiceOption } from "../../../../engine/contracts/types/prompt";
import {
  choiceOptionDisplayText,
  choiceVariableVisible,
  type ChoiceVisibilityRule,
} from "./choice-display";

const sfwBoundary = "Keep the scene SFW. Profanity, fear, danger, grief, and non-graphic violence may appear when appropriate, but sexual content fades to black and gore stays restrained.";
const adultBoundary = "Adult dark fiction is allowed for mature audiences when the user has opted into it.";
const filthyTone = "filthy erotic tone: when adult explicit content is allowed and invited, allow raunchy sexual language, vulgar dirty talk, explicit physical description, and kink-aware wording when the scene supports it; do not soften the beat with euphemism, literary dodging, or sanitized phrasing";

const eroticToneRule: ChoiceVisibilityRule = {
  variableName: "contentBoundary",
  values: [adultBoundary],
};

describe("choice display helpers", () => {
  it("hides dependent variables until their controlling choice allows them", () => {
    expect(
      choiceVariableVisible(eroticToneRule, {
        contentBoundary: sfwBoundary,
      }),
    ).toBe(false);

    expect(
      choiceVariableVisible(eroticToneRule, {
        contentBoundary: adultBoundary,
      }),
    ).toBe(true);
  });

  it("uses friendly option descriptions instead of raw injected prompt text", () => {
    const option: ChoiceOption = {
      id: "erotic_tone_filthy",
      label: "Filthy",
      value: filthyTone,
      description: "Raunchy dirty talk and explicit wording when the scene supports it.",
    };

    expect(choiceOptionDisplayText(option)).toBe("Raunchy dirty talk and explicit wording when the scene supports it.");
  });

  it("falls back to the raw option value for older presets without descriptions", () => {
    const option: ChoiceOption = {
      id: "legacy_option",
      label: "Legacy",
      value: "Raw legacy prompt text.",
    };

    expect(choiceOptionDisplayText(option)).toBe("Raw legacy prompt text.");
  });
});
