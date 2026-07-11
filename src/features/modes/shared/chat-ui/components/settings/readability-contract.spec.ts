import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const readSource = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const subCaptionSize = /text-\[(?:0\.5|0\.55|0\.5625|0\.6|0\.625|0\.6875)rem\]/;

describe("representative dense UI readability", () => {
  it.each([
    "src/features/modes/shared/chat-ui/components/settings/ModePromptSettingsSections.tsx",
    "src/features/shell/settings/components/SettingsPanel.tsx",
  ])("keeps persistent copy at or above the 12px caption floor in %s", (path) => {
    expect(readSource(path)).not.toMatch(subCaptionSize);
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
