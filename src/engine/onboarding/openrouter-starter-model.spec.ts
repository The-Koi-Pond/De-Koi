import { describe, expect, it } from "vitest";
import {
  OPENROUTER_FREE_ROUTER_MODEL,
  OPENROUTER_STARTER_MODEL_PREFERENCE,
  pickOpenRouterStarterModel,
} from "./openrouter-starter-model";

describe("pickOpenRouterStarterModel", () => {
  it("takes the best preferred free model the account can see", () => {
    const pick = pickOpenRouterStarterModel([
      { id: "anthropic/claude-sonnet-5", name: "Claude Sonnet 5", context: 1_000_000 },
      { id: OPENROUTER_STARTER_MODEL_PREFERENCE[1], name: "Inkling (free)", context: 1_048_576 },
      { id: OPENROUTER_FREE_ROUTER_MODEL, name: "Free Models Router", context: 200_000 },
    ]);

    expect(pick).toEqual({ id: OPENROUTER_STARTER_MODEL_PREFERENCE[1], name: "Inkling (free)", context: 1_048_576 });
  });

  it("falls back to OpenRouter's free router, then any free model", () => {
    expect(
      pickOpenRouterStarterModel([
        { id: "someone/new-model:free", context: 32_000 },
        { id: OPENROUTER_FREE_ROUTER_MODEL, context: 200_000 },
      ])?.id,
    ).toBe(OPENROUTER_FREE_ROUTER_MODEL);

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
