import test from "node:test";
import assert from "node:assert/strict";

import { buildStoryScopeCsv } from "./build-storyscope-input.mjs";

test("emits StoryScope's prompt_id, title, and human_story adapter columns", () => {
  const csv = buildStoryScopeCsv(
    [
      {
        caseId: "case-a",
        condition: "baseline",
        model: "provider/model",
        seed: "1",
        text: "Generated text, with a comma.",
        latencyMs: 100,
        inputTokens: 20,
        outputTokens: 30,
      },
      {
        caseId: "case-a",
        condition: "treatment",
        model: "provider/model",
        seed: "1",
        text: "Treatment text.",
        latencyMs: 110,
        inputTokens: 22,
        outputTokens: 28,
      },
    ],
    [{ caseId: "case-a", title: "Case A" }],
  );

  assert.match(csv, /^prompt_id,title,human_story\r?\n/);
  assert.match(csv, /Case A \[baseline \| provider\/model \| seed 1\]/);
  assert.match(csv, /"Generated text, with a comma\."/);
  assert.doesNotMatch(csv, /human-authored/i);
});
