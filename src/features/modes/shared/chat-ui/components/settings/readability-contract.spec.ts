import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const readSource = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const arbitraryRemSize = /text-\[(0(?:\.\d+)?)rem\]/g;

function findSubCaptionSizes(source: string): string[] {
  return Array.from(source.matchAll(arbitraryRemSize))
    .filter((match) => Number(match[1]) < 0.75)
    .map((match) => match[0]);
}

describe("representative dense UI readability", () => {
  it("catches arbitrary sub-caption values instead of enumerating known literals", () => {
    expect(findSubCaptionSizes('className="text-[0.65rem] text-[0.7rem] text-[0.749rem] text-[0.75rem]"')).toEqual([
      "text-[0.65rem]",
      "text-[0.7rem]",
      "text-[0.749rem]",
    ]);
  });

  it.each([
    "src/features/modes/shared/chat-ui/components/settings/ModePromptSettingsSections.tsx",
    "src/features/shell/settings/components/SettingsPanel.tsx",
    "src/app/shell/MobileTabBar.tsx",
    "src/shared/components/ui/HelpTooltip.tsx",
  ])("keeps persistent copy at or above the 12px caption floor in %s", (path) => {
    expect(findSubCaptionSizes(readSource(path))).toEqual([]);
  });

  it("raises the schedule editor's persistent prompts, labels, and explanatory copy", () => {
    const source = readSource("src/features/modes/shared/chat-ui/components/settings/ScheduleEditor.tsx");

    expect(source).toMatch(/Selfie prompt<\/span>[\s\S]{0,500}text-xs/);
    expect(source).toMatch(/Saved for this chat[\s\S]{0,200}/);
    expect(source).toMatch(/className="de-koi-caption">\s*Saved for this chat/);
    expect(source).toMatch(/Character Routines<\/span>[\s\S]{0,300}de-koi-caption/);
  });

  it("uses the shared interaction target for app titlebar actions", () => {
    const source = readSource("src/app/shell/WindowTitleBar.tsx");

    expect(source).toMatch(/mari-title-home-button[^"\n]*de-koi-icon-target/);
    expect(source).toMatch(/mari-titlebar-action de-koi-icon-target[\s\S]{0,300}title="Help"/);
  });
});
