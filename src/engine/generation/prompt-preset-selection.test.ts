import { describe, expect, it } from "vitest";
import { buildGenerationPromptPresetCandidates } from "./prompt-preset-selection";

describe("buildGenerationPromptPresetCandidates", () => {
  it("prefers an explicit request preset over a chat default outside conversation generation", () => {
    expect(
      buildGenerationPromptPresetCandidates({
        chatMode: "roleplay",
        chatPromptPresetId: "chat-preset",
        connectionPromptPresetId: "connection-preset",
        requestPromptPresetId: "request-preset",
      }),
    ).toEqual([
      { id: "request-preset", source: "request" },
      { id: "chat-preset", source: "chat" },
      { id: "connection-preset", source: "connection" },
    ]);
  });

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
