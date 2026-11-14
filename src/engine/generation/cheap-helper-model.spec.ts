import { describe, expect, it } from "vitest";

import { CHEAP_HELPER_TASKS, pickCheapHelperModel } from "./cheap-helper-model";

const list = (...ids: string[]) => ids.map((id) => ({ id }));

describe("pickCheapHelperModel", () => {
  it("picks the newest Haiku from an Anthropic or OpenRouter list", () => {
    expect(
      pickCheapHelperModel(
        list("claude-opus-5-5", "claude-haiku-4-5", "claude-haiku-5-5", "claude-sonnet-5-5"),
        "claude-opus-5-5",
      ),
    ).toBe("claude-haiku-5-5");
    expect(
      pickCheapHelperModel(
        list("anthropic/claude-opus-5.5", "anthropic/claude-haiku-5.5", "anthropic/claude-haiku-4.5"),
        "anthropic/claude-opus-5.5",
      ),
    ).toBe("anthropic/claude-haiku-5.5");
  });

  it("falls back to Gemini Flash, then GPT mini, skipping lite, image and free variants", () => {
    expect(
      pickCheapHelperModel(
        list(
          "gemini-4-argon",
          "gemini-3.8-flash-lite",
          "gemini-3.8-flash-image",
          "gemini-3.8-flash",
          "gemini-3.5-flash",
        ),
        "gemini-4-argon",
      ),
    ).toBe("gemini-3.8-flash");
    expect(pickCheapHelperModel(list("gpt-6", "gpt-5.5-mini", "gpt-5.5-mini-audio-preview"), "gpt-6")).toBe(
      "gpt-5.5-mini",
    );
    expect(pickCheapHelperModel(list("google/gemma-4-31b-it:free", "anthropic/claude-haiku-5.5:free"), "x")).toBeNull();
  });

  it("offers nothing when the connection already runs a cheap model or lists none", () => {
    expect(pickCheapHelperModel(list("claude-haiku-5-5"), "claude-haiku-5-5")).toBeNull();
    expect(pickCheapHelperModel(list("z-ai/glm-5.3-flash", "moonshotai/kimi-k2.5"), "z-ai/glm-5.3-flash")).toBeNull();
  });

  it("keeps replies, chapters and the fanfic judge off the cheap model", () => {
    expect(CHEAP_HELPER_TASKS).not.toContain("judge");
    expect(CHEAP_HELPER_TASKS).toEqual(expect.arrayContaining(["memory", "summaries", "habitCheck", "fanficChecks"]));
  });
});
