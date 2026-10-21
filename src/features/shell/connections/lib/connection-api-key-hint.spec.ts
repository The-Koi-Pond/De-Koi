import { describe, expect, it } from "vitest";
import { connectionApiKeyHint } from "./connection-api-key-hint";

describe("connectionApiKeyHint", () => {
  // A new connection used to say "leave empty to keep existing key" when there was no key at all.
  it("asks for a key on a connection that has none saved", () => {
    const hint = connectionApiKeyHint({ localAuth: null, hasSavedKey: false });
    expect(hint.placeholder).toBe("Paste your API key here");
    expect(hint.placeholder).not.toMatch(/existing/i);
    expect(hint.note).not.toMatch(/keep/i);
  });

  it("offers to keep the saved key when one exists", () => {
    const hint = connectionApiKeyHint({ localAuth: null, hasSavedKey: true });
    expect(hint.placeholder).toMatch(/keep existing key/);
    expect(hint.note).toMatch(/keep the saved key/);
  });

  it.each([
    ["claude", /Claude Code login/],
    ["chatgpt", /Codex ChatGPT login/],
    ["codex-image", /local Codex login/],
  ] as const)("explains the local %s login whatever the saved-key state", (localAuth, pattern) => {
    expect(connectionApiKeyHint({ localAuth, hasSavedKey: false }).placeholder).toMatch(pattern);
    expect(connectionApiKeyHint({ localAuth, hasSavedKey: true }).placeholder).toMatch(pattern);
  });
});
