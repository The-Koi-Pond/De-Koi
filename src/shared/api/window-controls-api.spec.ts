import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// A window method missing from the capability fails only inside the desktop shell, as a
// rejected promise ("window.destroy not allowed"), so the title bar X silently did nothing.
const source = readFileSync("src/shared/api/window-controls-api.ts", "utf8");
const capability = JSON.parse(readFileSync("src-tauri/capabilities/default.json", "utf8")) as {
  permissions: string[];
};

const kebab = (name: string) => name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);

describe("window controls capability", () => {
  it("allows every window command the controls call", () => {
    const called = new Set(
      [...source.matchAll(/appWindow\.(\w+)\(|requireCurrentWindow\(\)\.(\w+)\(/g)]
        .map((match) => match[1] ?? match[2])
        .filter((name) => !name.startsWith("on")),
    );
    // Tauri's onCloseRequested destroys the window itself when the handler does not prevent it.
    if (source.includes("onCloseRequested(")) called.add("destroy");

    expect(called.size).toBeGreaterThan(0);
    const missing = [...called].filter((name) => !capability.permissions.includes(`core:window:allow-${kebab(name)}`));
    expect(missing).toEqual([]);
  });
});
