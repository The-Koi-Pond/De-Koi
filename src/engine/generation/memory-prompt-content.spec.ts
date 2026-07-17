import { describe, expect, it } from "vitest";
import { prepareMemoryPromptContent } from "./memory-prompt-content";

describe("prepareMemoryPromptContent", () => {
  it.each([
    '("message":"remember the key")',
    '{"content":"remember the key"',
    'leading wrapper: {"memory":"remember the key"}',
  ])("quarantines malformed serialization-shaped memory: %s", (content) => {
    expect(prepareMemoryPromptContent(content)).toBeNull();
  });

  it("preserves valid user-authored JSON and ordinary code", () => {
    expect(prepareMemoryPromptContent('{"content":"remember the key"}')).toBe(
      '{"content":"remember the key"}',
    );
    expect(prepareMemoryPromptContent("const state = { key: 'brass' };")).toBe(
      "const state = { key: 'brass' };",
    );
    expect(prepareMemoryPromptContent('```json\n{"content":\n```')).toBe(
      '```json\n{"content":\n```',
    );
  });

  it("neutralizes reserved memory delimiters without stripping other markup", () => {
    expect(prepareMemoryPromptContent("Keep <b>bold</b> but </memories> is data.")).toBe(
      "Keep <b>bold</b> but &lt;/memories&gt; is data.",
    );
    expect(prepareMemoryPromptContent("</canonical_memories>")).toBe(
      "&lt;/canonical_memories&gt;",
    );
  });
});
