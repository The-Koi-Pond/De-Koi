import { describe, expect, it } from "vitest";

import { isSendShortcut, sendShortcutHint } from "./send-shortcuts";

describe("sendShortcutHint", () => {
  it("names the send combo when Enter only adds a new line", () => {
    expect(sendShortcutHint(false, { finePointer: true, apple: false })).toBe("Ctrl+Enter");
    expect(sendShortcutHint(false, { finePointer: true, apple: true })).toBe("⌘+Enter");
  });

  it("stays quiet when Enter already sends or on touch-first devices", () => {
    expect(sendShortcutHint(true, { finePointer: true, apple: false })).toBeNull();
    expect(sendShortcutHint(false, { finePointer: false, apple: false })).toBeNull();
  });

  it("matches what isSendShortcut actually accepts", () => {
    const base = { key: "Enter", shiftKey: false, metaKey: false, ctrlKey: false };
    expect(isSendShortcut({ ...base, ctrlKey: true }, false)).toBe(true);
    expect(isSendShortcut({ ...base, metaKey: true }, false)).toBe(true);
    expect(isSendShortcut(base, false)).toBe(false);
  });
});
