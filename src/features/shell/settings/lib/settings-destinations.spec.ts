import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SETTINGS_DESTINATIONS, searchSettingsDestinations } from "./settings-destinations";

const destinationOwnerFiles = [
  "src/features/shell/settings/components/settings/SettingsSurfaces.tsx",
  "src/features/shell/settings/components/settings/SettingControls.tsx",
  "src/features/shell/settings/components/settings/UserQuickRepliesManager.tsx",
  "src/features/shell/settings/components/settings/PromptOverridesEditor.tsx",
  "src/features/shell/settings/components/settings/PrivacyDataSettings.tsx",
  "src/features/shell/settings/components/settings/BackupExportSettings.tsx",
  "src/features/shell/settings/components/settings/ChatBehaviorSettings.tsx",
  "src/features/shell/settings/components/settings/ChatPresentationSettings.tsx",
  "src/features/shell/settings/components/ProfileImportSection.tsx",
  "src/features/shell/plugins/components/CoreModulesSettings.tsx",
  "src/features/shell/diagnostics/components/HealthDiagnosticsSettings.tsx",
];

describe("settings destinations", () => {
  it("gives every searchable destination a stable owner marker", () => {
    const source = destinationOwnerFiles.map((file) => readFileSync(file, "utf8")).join("\n");
    for (const destination of SETTINGS_DESTINATIONS) {
      expect(source).toContain(`id="settings-destination-${destination.id}"`);
    }
  });

  it("matches individual settings by title and keywords", () => {
    expect(searchSettingsDestinations("sound").map(({ id }) => id)).toContain("notification-sounds");
    expect(searchSettingsDestinations("restore").map(({ id }) => id)).toEqual(
      expect.arrayContaining(["profile-import", "backups"]),
    );
    expect(searchSettingsDestinations("impersonate").map(({ id }) => id)).toContain("chat-behavior");
    expect(searchSettingsDestinations("schedule generation").map(({ id }) => id)).toContain("chat-behavior");
    expect(searchSettingsDestinations("message tokens").map(({ id }) => id)).toContain("chat-presentation");
  });

  it("gives remote backup recovery a stable Admin Access destination", () => {
    expect(searchSettingsDestinations("remote privileged")).toContainEqual(
      expect.objectContaining({ id: "admin-access", tab: "advanced" }),
    );

    const source = destinationOwnerFiles.map((file) => readFileSync(file, "utf8")).join("\n");
    expect(source).toContain('id="settings-destination-admin-access"');
  });
});
