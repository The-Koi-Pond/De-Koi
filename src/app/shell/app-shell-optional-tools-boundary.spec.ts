import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const currentDir = dirname(fileURLToPath(import.meta.url));

function readAppShellSource() {
  return readFileSync(join(currentDir, "AppShell.tsx"), "utf8");
}

describe("app shell optional tool boundary", () => {
  it("loads discovery showcase creation only when the action is used", () => {
    const source = readAppShellSource();

    expect(source).not.toMatch(/^import\s+.*features\/shell\/discovery\/showcase/m);
    expect(source).toContain('import("../../features/shell/discovery/showcase")');
  });
});
