import { describe, expect, it } from "vitest";

import { createDefaultImageStyleProfileSettings } from "../../../../../engine/generation/image-style-profiles";
import recordings from "../test-fixtures/recorded-calls.json";
import {
  buildCleanupBody,
  buildGenerationBody,
  referenceImagesToSend,
  spriteNegativePrompt,
  withPromptOverrides,
} from "./request-bodies";

type RecordedBody = { negativePrompt?: string };

function recordedNegativePrompt(scenario: number): string | undefined {
  const call = recordings.scenarios
    .find((item) => item.scenario === scenario)
    ?.calls.find((item) => item.command === "sprite_generate_sheet");
  return ((call?.args as { body?: RecordedBody } | null)?.body ?? {}).negativePrompt;
}

const baseInput = {
  connectionId: "connection-1",
  appearance: "  blue eyes  ",
  referenceImages: [] as string[],
  expressions: ["neutral", "happy"],
  grid: { cols: 2, rows: 3 },
  spriteType: "expressions" as const,
  matched: false,
  nativeTransparentPng: false,
  negativePrompt: "text",
};

describe("sprite negative prompt", () => {
  const profiles = createDefaultImageStyleProfileSettings();

  it("matches the recorded portrait, full-body and matched negative prompts", () => {
    expect(spriteNegativePrompt("expressions", false, profiles)).toBe(recordedNegativePrompt(1));
    expect(spriteNegativePrompt("full-body", false, profiles)).toBe(recordedNegativePrompt(6));
    expect(spriteNegativePrompt("full-body", true, profiles)).toBe(recordedNegativePrompt(7));
  });

  it("gives matched batches and plain full-body sheets different negative prompts", () => {
    expect(spriteNegativePrompt("full-body", true, profiles)).not.toBe(
      spriteNegativePrompt("full-body", false, profiles),
    );
  });
});

describe("generation body", () => {
  it("sends the appearance as typed, noBackground false, and leaves out empty references and negative prompt", () => {
    const body = buildGenerationBody({ ...baseInput, negativePrompt: "" });
    expect(body).toEqual({
      connectionId: "connection-1",
      appearance: "  blue eyes  ",
      expressions: ["neutral", "happy"],
      cols: 2,
      rows: 3,
      spriteType: "expressions",
      fullBodyExpressionMode: false,
      nativeTransparentPng: false,
      noBackground: false,
    });
    expect(Object.keys(body)).not.toContain("referenceImages");
    expect(Object.keys(body)).not.toContain("negativePrompt");
    expect(Object.keys(body)).not.toContain("promptOverrides");
  });

  it("caps the reference images at four and carries the matched and transparent switches", () => {
    const body = buildGenerationBody({
      ...baseInput,
      referenceImages: ["a", "b", "c", "d", "e"],
      spriteType: "full-body",
      matched: true,
      nativeTransparentPng: true,
    });
    expect(body.referenceImages).toEqual(["a", "b", "c", "d"]);
    expect(body.fullBodyExpressionMode).toBe(true);
    expect(body.nativeTransparentPng).toBe(true);
    expect(body.negativePrompt).toBe("text");
  });

  it("adds the review's overrides unchanged", () => {
    const overrides = [{ id: "x", prompt: "edited" }];
    expect(withPromptOverrides(buildGenerationBody(baseInput), overrides).promptOverrides).toBe(overrides);
  });
});

describe("reference images sent", () => {
  it("puts the avatar first only while its box is on, then the uploads, at most four", () => {
    expect(referenceImagesToSend("avatar", true, ["u1", "u2"])).toEqual(["avatar", "u1", "u2"]);
    expect(referenceImagesToSend("avatar", false, ["u1", "u2"])).toEqual(["u1", "u2"]);
    expect(referenceImagesToSend(null, true, ["u1"])).toEqual(["u1"]);
    expect(referenceImagesToSend("avatar", true, ["u1", "u2", "u3", "u4"])).toEqual(["avatar", "u1", "u2", "u3"]);
  });
});

describe("cleanup body", () => {
  it("sends the whole-number strength, the auto engine and every cell", () => {
    expect(buildCleanupBody(70, [{ expression: "happy", base64: "data:image/png;base64,x" }])).toEqual({
      cleanupStrength: 70,
      engine: "auto",
      cells: [{ expression: "happy", base64: "data:image/png;base64,x" }],
    });
  });
});
