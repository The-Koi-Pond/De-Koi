import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const currentDir = dirname(fileURLToPath(import.meta.url));

function readAppShellSource() {
  return readFileSync(join(currentDir, "AppShell.tsx"), "utf8");
}

function readModeSurfaceLoaderSource() {
  return readFileSync(join(currentDir, "mode-surface-loader.ts"), "utf8");
}

describe("app shell mode boundary", () => {
  it("keeps mode-owned code behind dynamic imports", () => {
    const source = readAppShellSource();
    const staticModeImports = source
      .split(/\r?\n/)
      .filter((line) => /^import\s/.test(line) && line.includes("../../features/modes/"));

    expect(staticModeImports).toEqual([]);
  });

  it("keeps the mode surface behind the shared dynamic loader", () => {
    const shellSource = readAppShellSource();
    const loaderSource = readModeSurfaceLoaderSource();

    expect(shellSource).toContain("lazy(loadModeSurface)");
    expect(loaderSource).toContain('import("../../features/modes/router/shell")');
  });
});
