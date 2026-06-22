import type { ComponentType, KeyboardEvent } from "react";
import { cn } from "../../../../shared/lib/utils";
import { useUIStore } from "../../../../shared/stores/ui.store";
import { HealthDiagnosticsSettings } from "../../diagnostics/shell";
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
  { id: "health", label: "Health" },
  { id: "advanced", label: "Advanced" },
] as const;

type SettingsTabId = (typeof TABS)[number]["id"];

const getSettingsTabButtonId = (tabId: SettingsTabId) => `settings-tab-${tabId}`;

const SETTINGS_COMPONENTS: Record<SettingsTabId, ComponentType> = {
  general: GeneralSettings,
  appearance: AppearanceSettings,
  themes: ThemesSettings,
  plugins: CoreModulesSettings,
  extensions: ExtensionsSettings,
  import: ImportSettings,
  health: HealthDiagnosticsSettings,
  advanced: AdvancedSettings,
};

export function SettingsPanel() {
  const settingsTab = useUIStore((s) => s.settingsTab);
  const setSettingsTab = useUIStore((s) => s.setSettingsTab);
  const activeTab = TABS.find((tab) => tab.id === settingsTab) ?? TABS[0];
  const ActiveSettings = SETTINGS_COMPONENTS[activeTab.id];
  const activateTab = (tabId: SettingsTabId, shouldFocus = false) => {
    setSettingsTab(tabId);
    if (shouldFocus) {
      requestAnimationFrame(() => {
        document.getElementById(getSettingsTabButtonId(tabId))?.focus();
      });
    }
  };
  const handleTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, tabIndex: number) => {
    const lastIndex = TABS.length - 1;
    let nextIndex: number | null = null;

    switch (event.key) {
      case "ArrowRight":
      case "ArrowDown":
        nextIndex = tabIndex === lastIndex ? 0 : tabIndex + 1;
        break;
      case "ArrowLeft":
      case "ArrowUp":
        nextIndex = tabIndex === 0 ? lastIndex : tabIndex - 1;
        break;
      case "Home":
        nextIndex = 0;
        break;
      case "End":
        nextIndex = lastIndex;
        break;
      default:
        return;
    }

    event.preventDefault();
    activateTab(TABS[nextIndex].id, true);
  };

  return (
    <div className="de-koi-settings-panel flex h-full flex-col">
      <div
        className="de-koi-settings-tabs flex-shrink-0 border-b border-[var(--border)] bg-[var(--card)]/40"
        role="tablist"
        aria-label="Settings sections"
      >
        {TABS.map((tab, tabIndex) => (
          <button
            key={tab.id}
            id={getSettingsTabButtonId(tab.id)}
            type="button"
            role="tab"
            aria-selected={activeTab.id === tab.id}
            aria-controls={activeTab.id === tab.id ? `settings-panel-${tab.id}` : undefined}
            tabIndex={activeTab.id === tab.id ? 0 : -1}
            onClick={() => activateTab(tab.id)}
            onKeyDown={(event) => handleTabKeyDown(event, tabIndex)}
            className={cn(
              "de-koi-settings-tab flex min-w-0 items-center justify-center px-2.5 py-2 text-center text-xs font-semibold transition-all active:scale-[0.98] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--primary)]",
              activeTab.id === tab.id
                ? "de-koi-settings-tab-active text-[var(--foreground)]"
                : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]",
            )}
          >
            <span className="min-w-0 truncate leading-tight">{tab.label}</span>
          </button>
        ))}
      </div>

      <div
        id={`settings-panel-${activeTab.id}`}
        className="de-koi-settings-body min-h-0 flex-1 overflow-y-auto p-3"
        role="tabpanel"
        aria-labelledby={`settings-tab-${activeTab.id}`}
      >
        <ActiveSettings />
      </div>
    </div>
  );
}
