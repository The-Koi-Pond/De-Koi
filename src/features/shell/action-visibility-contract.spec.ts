import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const readSource = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("essential action visibility", () => {
  it("reveals conversation actions when the message group contains keyboard focus", () => {
    const source = readSource("src/features/modes/conversation/components/ConversationMessageActions.tsx");

    expect(source).toContain("group-focus-within:visible");
    expect(source).toContain("group-focus-within:pointer-events-auto");
    expect(source).toContain("group-focus-within:opacity-100");
    expect(source).toContain('data-de-koi-action-group="message"');
  });

  it("reveals connection row and folder actions for keyboard focus", () => {
    const source = readSource("src/features/shell/connections/components/ConnectionsPanel.tsx");

    expect(source).toContain("group-focus-within:opacity-100");
    expect(source).toContain('data-de-koi-action-group="connection"');
    expect(source).toContain('data-de-koi-action-group="connection-folder"');
  });

  it("keeps marked action groups visible for coarse pointers", () => {
    const css = readSource("src/styles/globals/07-responsive-accessibility.css");

    expect(css).toMatch(
      /@media\s*\(pointer:\s*coarse\)[\s\S]*\[data-de-koi-action-group\][^{]*{[^}]*opacity:\s*1[^}]*visibility:\s*visible[^}]*pointer-events:\s*auto/s,
    );
  });
});
