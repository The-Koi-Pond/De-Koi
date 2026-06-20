import { describe, expect, it } from "vitest";

import { nextRegexScriptTargetCharacterIds, savedRegexScriptPromptOnly } from "./regex-script-editor-state";

describe("regex script editor state", () => {
  it("forces scoped saves to prompt-only without changing the global prompt-only value", () => {
    const globalPromptOnly = false;
    const scopedTargetIds = nextRegexScriptTargetCharacterIds([], "char-a");

    expect(savedRegexScriptPromptOnly(scopedTargetIds, globalPromptOnly)).toBe(true);
    expect(savedRegexScriptPromptOnly([], globalPromptOnly)).toBe(false);
  });

  it("preserves a global prompt-only choice after scope is cleared", () => {
    const globalPromptOnly = true;
    const scopedTargetIds = nextRegexScriptTargetCharacterIds([], "char-a");

    expect(savedRegexScriptPromptOnly(scopedTargetIds, globalPromptOnly)).toBe(true);
    expect(savedRegexScriptPromptOnly([], globalPromptOnly)).toBe(true);
  });
});
