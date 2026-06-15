import type { ComponentType } from "react";
import { cn } from "../../../../shared/lib/utils";
import { useUIStore } from "../../../../shared/stores/ui.store";
import { CoreModulesSettings } from "../../plugins/settings";
import {
  AdvancedSettings,
  AppearanceSettings,
  ExtensionsSettings,
  GeneralSettings,
  ImportSettings,
  ThemesSettings,
} from "./settings/SettingsSurfaces";

const TABS = [
  { id: "general", label: "General" },
  { id: "appearance", label: "Appearance" },
  { id: "themes", label: "Themes" },
  { id: "plugins", label: "Modules" },
  { id: "extensions", label: "Extensions" },
  { id: "import", label: "Import" },
  { id: "advanced", label: "Advanced" },
] as const;

type SettingsTabId = (typeof TABS)[number]["id"];

const SETTINGS_COMPONENTS: Record<SettingsTabId, ComponentType> = {
  general: GeneralSettings,
  appearance: AppearanceSettings,
  themes: ThemesSettings,
  plugins: CoreModulesSettings,
  extensions: ExtensionsSettings,
  import: ImportSettings,
  advanced: AdvancedSettings,
};

export function SettingsPanel() {
  const settingsTab = useUIStore((s) => s.settingsTab);
  const setSettingsTab = useUIStore((s) => s.setSettingsTab);
  const activeTab = TABS.find((tab) => tab.id === settingsTab) ?? TABS[0];
  const ActiveSettings = SETTINGS_COMPONENTS[activeTab.id];

  return (
    <div className="de-koi-settings-panel flex h-full flex-col">
      <div className="de-koi-settings-tabs flex flex-shrink-0 flex-wrap border-b border-[var(--border)] bg-[var(--card)]/40">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setSettingsTab(tab.id)}
            className={cn(
              "de-koi-settings-tab relative px-3 py-2.5 text-xs font-medium transition-colors",
              settingsTab === tab.id
                ? "de-koi-settings-tab-active text-[var(--foreground)]"
                : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]",
            )}
          >
            {tab.label}
            {settingsTab === tab.id && (
              <span className="absolute inset-x-1 bottom-0 h-0.5 rounded-full bg-[var(--primary)]" />
            )}
          </button>
        ))}
      </div>

      <div className="de-koi-settings-body min-h-0 flex-1 overflow-y-auto p-3">
        <ActiveSettings />
      </div>
    </div>
  );
}
