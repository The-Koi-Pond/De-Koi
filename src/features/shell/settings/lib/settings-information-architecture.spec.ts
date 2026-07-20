import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

describe("settings information architecture", () => {
  it("keeps automatic Roleplay correction visible and default-on in per-chat settings", () => {
    const drawer = read("src/features/modes/shared/chat-ui/components/ChatSettingsDrawer.tsx");

    expect(drawer).toContain('label="Roleplay Quality"');
    expect(drawer).toContain("metadata.automaticRoleplayQualityCorrection !== false");
    expect(drawer).toContain("automaticRoleplayQualityCorrection: !automaticRoleplayQualityCorrection");
    expect(drawer).toContain('role="switch"');
    expect(drawer).toContain("aria-checked={automaticRoleplayQualityCorrection}");
    expect(drawer).toContain("Clean replies stay fast and use no extra model call.");
  });

  it("keeps per-chat context, research, and reasoning in separate sections", () => {
    const drawer = read("src/features/modes/shared/chat-ui/components/ChatSettingsDrawer.tsx");

    expect(drawer).toContain('label="Context Limit"');
    expect(drawer).toContain('label="Character Web Research"');
    expect(drawer).toContain('label="Reasoning"');
    expect(drawer).not.toContain('label="Impersonate"');

    const contextStart = drawer.indexOf('label="Context Limit"');
    const researchStart = drawer.indexOf('label="Character Web Research"');
    const reasoningStart = drawer.indexOf('label="Reasoning"');
    expect(contextStart).toBeGreaterThan(-1);
    expect(researchStart).toBeGreaterThan(contextStart);
    expect(reasoningStart).toBeGreaterThan(researchStart);

    const contextSection = drawer.slice(contextStart, researchStart);
    expect(contextSection).not.toContain("Character Web Research");
    expect(contextSection).not.toContain("Show Model Reasoning");
    expect(contextSection).not.toContain("Exclude Past Reasoning");
    expect(contextSection).toContain("updateMeta.mutate({ id: chat.id, contextMessageLimit:");

    const researchSection = drawer.slice(researchStart, reasoningStart);
    expect(researchSection).toContain("updateMeta.mutate({");
    expect(researchSection).toContain("characterWebAccessEnabled:");
    expect(researchSection).toContain("characterWebResearchGrant: null");
    expect(researchSection).toContain("Keep web research in the background");
    expect(researchSection).toContain("characterWebResearchPresentation:");
    expect(researchSection).toContain('role="switch"');
    expect(researchSection).toContain("aria-checked={quietCharacterWebResearch}");
    expect(researchSection).toContain("Show only the final answer. Permission prompts still appear when required.");
    expect(researchSection).toContain("Let characters narrate web research while it happens.");

    const reasoningSection = drawer.slice(reasoningStart);
    expect(reasoningSection).toContain("updateMeta.mutate({ id: chat.id, showInlineReasoning:");
    expect(reasoningSection).toContain("updateMeta.mutate({ id: chat.id, excludePastReasoning:");
  });

  it("keeps global chat behavior in General and presentation in Appearance", () => {
    const behavior = read("src/features/shell/settings/components/settings/ChatBehaviorSettings.tsx");
    const presentation = read("src/features/shell/settings/components/settings/ChatPresentationSettings.tsx");

    expect(behavior).toContain('id="settings-destination-chat-behavior"');
    expect(behavior).toContain("Quick replies");
    expect(behavior).toContain("Guide swipes/regens with chat input");
    expect(behavior).toContain("Schedule generation preferences");
    expect(behavior).toContain("Impersonate");
    expect(behavior).toContain("const setShowQuickRepliesMenu = useUIStore((s) => s.setShowQuickRepliesMenu)");
    expect(behavior).toContain(
      "const setScheduleGenerationPreferences = useUIStore((s) => s.setScheduleGenerationPreferences)",
    );

    expect(presentation).toContain('id="settings-destination-chat-presentation"');
    expect(presentation).toContain("Group consecutive messages");
    expect(presentation).toContain("Show model name on messages");
    expect(presentation).toContain("Show token usage on messages");
    expect(presentation).toContain("const setMessageGrouping = useUIStore((s) => s.setMessageGrouping)");
    expect(presentation).toContain("const setShowTokenUsage = useUIStore((s) => s.setShowTokenUsage)");
  });

  it("leaves Advanced with one expert owner and no duplicate data erasure", () => {
    const advanced = read("src/features/shell/settings/components/settings/SettingsSurfaces.tsx").slice(
      read("src/features/shell/settings/components/settings/SettingsSurfaces.tsx").indexOf(
        "export function AdvancedSettings",
      ),
    );

    expect(advanced).not.toContain("Quick replies");
    expect(advanced).not.toContain("Group consecutive messages");
    expect(advanced).not.toContain("Clear Selected Data");
    expect(advanced).not.toContain("Create Managed Backup");
    expect(advanced).not.toContain("Export Profile");

    const privacy = read("src/features/shell/settings/components/settings/PrivacyDataSettings.tsx");
    const backups = read("src/features/shell/settings/components/settings/BackupExportSettings.tsx");
    expect(privacy).toContain("<BackupExportSettings />");
    expect(backups).toContain('id="settings-destination-backups"');
    expect(backups).toContain("Create Managed Backup");
    expect(backups).toContain("Export Profile");
  });

  it("routes backup and export discovery to Privacy and Data", () => {
    const destinations = read("src/features/shell/settings/lib/settings-destinations.ts");
    expect(destinations).toContain(
      '{ id: "backups", tab: "privacy", title: "Backups and profile export", keywords: ["backup", "export", "restore"] }',
    );

    const discovery = JSON.parse(read("src/features/shell/discovery/discovery-entries.json")) as Array<{
      id?: string;
      where?: string;
      keywords?: string[];
      actions?: Array<{ type?: string; tab?: string; destination?: string }>;
    }>;
    const privacyEntry = discovery.find((entry) => entry.id === "privacy-data-controls");
    expect(privacyEntry?.where).toBe("Settings > Privacy & Data.");
    expect(privacyEntry?.keywords).toEqual(expect.arrayContaining(["backup", "export"]));
    expect(privacyEntry?.actions).toContainEqual(
      expect.objectContaining({
        type: "open-settings",
        tab: "privacy",
        destination: "privacy-data",
      }),
    );
  });
});
