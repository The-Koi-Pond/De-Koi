import { describe, expect, it } from "vitest";

import { mergeConnectionModels, selectConnectionModel, selectConnectionModelLimits } from "./connection-model-selection";

describe("connection model selection", () => {
  it("uses known catalog limits when fetched models omit metadata", () => {
    expect(
      mergeConnectionModels(
        [{ id: "model-a", name: "Fetched A" }],
        [{ id: "model-a", name: "Known A", context: 128_000, maxOutput: 16_384 }],
      ),
    ).toEqual([
      {
        id: "model-a",
        name: "Fetched A",
        context: 128_000,
        maxOutput: 16_384,
        isRemote: true,
        fallback: undefined,
      },
    ]);
  });

  it("represents genuinely unknown limits without displaying zero as metadata", () => {
    expect(mergeConnectionModels([{ id: "unknown", name: "Unknown" }], [])).toEqual([
      {
        id: "unknown",
        name: "Unknown",
        context: null,
        maxOutput: null,
        isRemote: true,
        fallback: undefined,
      },
    ]);
  });

  it("does not invent limits when the newly selected model has none", () => {
    expect(selectConnectionModelLimits({ id: "unknown", context: null, maxOutput: null })).toEqual({
      maxContext: null,
      maxTokensOverride: null,
    });
  });

  it("clears the transient search query when a model is selected", () => {
    expect(selectConnectionModel({ id: "model-a", context: 128_000, maxOutput: 16_384 })).toEqual({
      modelId: "model-a",
      searchQuery: "",
      maxContext: 128_000,
      maxTokensOverride: 16_384,
    });
  });
});
