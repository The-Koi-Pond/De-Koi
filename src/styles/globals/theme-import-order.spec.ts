import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const globalsCss = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../globals.css"), "utf8");
const imports = [...globalsCss.matchAll(/@import\s+"([^"]+)"/g)].map((match) => match[1]);

describe("visual theme import order", () => {
  // pond.css's main token block has the same specificity as the default
  // [data-theme] token blocks, so it only wins by coming after them.
  it("imports the Pond theme last, after every default stylesheet it overrides", () => {
    expect(imports.at(-1)).toBe("./themes/pond.css");
    expect(imports).toContain("./globals/02-theme-tokens.css");
  });
});
