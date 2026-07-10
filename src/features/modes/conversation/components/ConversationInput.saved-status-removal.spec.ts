import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const currentDir = dirname(fileURLToPath(import.meta.url));

describe("saved persona status removal", () => {
  it("does not expose or persist saved persona statuses from Conversation input", () => {
    const source = readFileSync(join(currentDir, "ConversationInput.tsx"), "utf8");

    expect(source).not.toContain("Saved persona statuses");
    expect(source).not.toContain("Saved Statuses");
    expect(source).not.toContain("savedStatusOptions");
  });
});
