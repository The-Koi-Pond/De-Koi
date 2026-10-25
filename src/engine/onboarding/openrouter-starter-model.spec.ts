import { describe, expect, it } from "vitest";
import {
  OPENROUTER_FREE_ROUTER_MODEL,
  OPENROUTER_STARTER_MODEL_PREFERENCE,
  pickOpenRouterStarterModel,
} from "./openrouter-starter-model";

describe("pickOpenRouterStarterModel", () => {
  it("starts on OpenRouter's free router when it is listed", () => {
    const pick = pickOpenRouterStarterModel([
      { id: "anthropic/claude-sonnet-5", name: "Claude Sonnet 5", context: 1_000_000 },
      { id: OPENROUTER_STARTER_MODEL_PREFERENCE[0], name: "Gemma 4 31B (free)", context: 262_144 },
      { id: OPENROUTER_FREE_ROUTER_MODEL, name: "Free Models Router", context: 200_000 },
    ]);

    expect(pick).toEqual({ id: OPENROUTER_FREE_ROUTER_MODEL, name: "Free Models Router", context: 200_000 });
  });

  it("falls back to the best named free model, then any free model", () => {
    expect(
      pickOpenRouterStarterModel([
        { id: "someone/new-model:free", context: 32_000 },
        { id: OPENROUTER_STARTER_MODEL_PREFERENCE[1], name: "Inkling (free)", context: 1_048_576 },
      ])?.id,
    ).toBe(OPENROUTER_STARTER_MODEL_PREFERENCE[1]);

    expect(pickOpenRouterStarterModel([{ id: "someone/new-model:free", context: 0 }])).toEqual({
      id: "someone/new-model:free",
      name: "someone/new-model:free",
      context: null,
    });
  });

  it("never picks a paid model", () => {
    expect(pickOpenRouterStarterModel([{ id: "openai/gpt-5.5" }, { id: "google/gemma-4-31b-it" }])).toBeNull();
    expect(pickOpenRouterStarterModel([])).toBeNull();
  });
});
