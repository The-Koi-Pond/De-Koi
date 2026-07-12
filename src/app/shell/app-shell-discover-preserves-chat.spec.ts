import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Discover shell navigation", () => {
  it("does not clear the active chat when Discover opens", () => {
    const source = readFileSync("src/app/shell/AppShell.tsx", "utf8");
    const openDiscover = source.match(/const openDiscover = useCallback\(\(\) => \{([\s\S]*?)\n {2}\}, \[/)?.[1] ?? "";

    expect(openDiscover).not.toContain("setActiveChatId(null)");
    expect(openDiscover).toContain("setDiscoverOpen(true)");
  });
});
