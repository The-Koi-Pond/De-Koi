import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  appendGenerationTailMessages,
  buildUserMessageRegenerationInstruction,
} from "../packages/server/src/routes/generate/generate-route-utils.ts";

describe("user message regeneration instruction", () => {
  it("asks the provider to rewrite the user message as a swipe", () => {
    const instruction = buildUserMessageRegenerationInstruction({ content: "try again" });

    assert.match(instruction, /Regenerate the user's previous message as an alternate swipe/);
    assert.match(instruction, /Write only the replacement user message text/);
    assert.match(instruction, /Do not answer as the assistant/);
    assert.match(instruction, /<original_user_message>\ntry again\n<\/original_user_message>/);
  });

  it("keeps Gemini user-message regeneration as the final user turn while preserving assistant prefill", () => {
    const messages = [{ role: "user" as const, content: "context" }];

    appendGenerationTailMessages(messages, {
      assistantPrefill: "Assistant prefill test:",
      followUpIteration: 0,
      impersonate: false,
      isGoogleProvider: true,
      regenerateUserMessageInstruction: "Regenerate the user message",
    });

    assert.deepEqual(messages.slice(-2), [
      { role: "assistant", content: "Assistant prefill test:" },
      { role: "user", content: "Regenerate the user message" },
    ]);
  });

  it("keeps assistant prefill as the final assistant turn outside Gemini user-message regeneration", () => {
    const messages = [{ role: "user" as const, content: "context" }];

    appendGenerationTailMessages(messages, {
      assistantPrefill: "Continue from here:",
      followUpIteration: 0,
      impersonate: false,
      isGoogleProvider: false,
      regenerateUserMessageInstruction: "Regenerate the user message",
    });

    assert.deepEqual(messages.slice(-1), [{ role: "assistant", content: "Continue from here:" }]);
  });
});
