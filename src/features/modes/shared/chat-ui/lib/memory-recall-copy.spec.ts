import { describe, expect, it } from "vitest";

import {
  MEMORY_RECALL_CONSOLE_DESCRIPTION,
  MEMORY_RECALL_SECTION_HELP,
  MEMORY_RECALL_TOGGLE_DESCRIPTION,
  memoryRecallContinuityDetail,
} from "./memory-recall-copy";

const REQUIRED_SCOPE_TERMS = ["chat-local", "character-wide"];

describe("Memory Recall user-facing copy contract", () => {
  it("distinguishes both recall scopes and explains ranking and automatic capture", () => {
    const combinedCopy = [
      MEMORY_RECALL_TOGGLE_DESCRIPTION,
      MEMORY_RECALL_SECTION_HELP,
      MEMORY_RECALL_CONSOLE_DESCRIPTION,
    ]
      .join(" ")
      .toLowerCase();

    for (const term of REQUIRED_SCOPE_TERMS) {
      expect(combinedCopy).toContain(term);
    }
    expect(combinedCopy).toContain("speaker-labeled exchanges");
    expect(combinedCopy).toContain("rank");
    expect(combinedCopy).not.toMatch(/embeddings? (?:create|summarize|write)/);
  });

  it("describes enabled and disabled continuity without collapsing to current-chat fragments", () => {
    expect(memoryRecallContinuityDetail(true, 1)).toBe(
      "Chat-local transcript fragments and eligible character-wide memories can be recalled after 1 recent message. Automatic capture saves speaker-labeled exchanges; embeddings rank matches when configured.",
    );
    expect(memoryRecallContinuityDetail(true, 3)).toContain("after 3 recent messages");
    expect(memoryRecallContinuityDetail(false, 1)).toBe(
      "Memory Recall is not injecting chat-local transcript fragments or character-wide memories.",
    );
  });
});
