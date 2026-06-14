import { describe, expect, it } from "vitest";
import { buildGenerationPromptPresetCandidates } from "./prompt-preset-selection";

describe("buildGenerationPromptPresetCandidates", () => {
  it("does not select request, chat, or connection presets for conversation generation", () => {
    expect(
      buildGenerationPromptPresetCandidates({
        chatMode: "conversation",
        chatPromptPresetId: "chat-preset",
        connectionPromptPresetId: "connection-preset",
        requestPromptPresetId: "request-preset",
        impersonate: true,
        impersonatePromptPresetId: "impersonate-preset",
      }),
    ).toEqual([]);
  });
});
