import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const currentDir = dirname(fileURLToPath(import.meta.url));

function readAppSource() {
  return readFileSync(join(currentDir, "App.tsx"), "utf8");
}

describe("app boot shell boundary", () => {
  it("keeps the root App module free of deferred shell and feature imports", () => {
    const source = readAppSource();

    expect(source).toContain("lazy(");
    expect(source).toContain('import("./AppExperience")');
    expect(source).not.toMatch(/from\s+["']\.\/shell\//);
    expect(source).not.toMatch(/from\s+["']\.\.\/features\//);
    expect(source).not.toMatch(/from\s+["']\.\.\/shared\/api\/settings-assets-api/);
    expect(source).not.toMatch(/from\s+["']sonner["']/);
  });
});
