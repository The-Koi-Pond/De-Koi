import type { ComponentType, KeyboardEvent } from "react";
import { Blocks, Brush, Download, HeartPulse, Palette, Settings2, SlidersHorizontal, Wrench } from "lucide-react";
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
  {
    id: "general",
    label: "General",
    description: "Everyday behavior, message controls, and generation defaults.",
    icon: Settings2,
  },
  {
    id: "appearance",
    label: "Appearance",
    description: "Text, chat surfaces, roleplay art, and visual comfort.",
    icon: Brush,
  },
  { id: "themes", label: "Themes", description: "Choose, import, and manage complete visual themes.", icon: Palette },
  { id: "plugins", label: "Modules", description: "Turn bundled De-Koi capabilities on or off.", icon: Blocks },
  { id: "extensions", label: "Extensions", description: "Manage installed extensions and their access.", icon: Wrench },
  {
    id: "import",
    label: "Import",
    description: "Bring compatible characters, chats, and settings into De-Koi.",
    icon: Download,
  },
  {
    id: "health",
    label: "Health",
    description: "Check app readiness and troubleshoot local services.",
    icon: HeartPulse,
  },
  {
    id: "advanced",
    label: "Advanced",
    description: "Runtime, storage, diagnostics, and expert controls.",
    icon: SlidersHorizontal,
  },
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
    <div className="de-koi-settings-panel @container h-full min-h-0">
      <div className="de-koi-settings-layout h-full min-h-0 @3xl:grid @3xl:grid-cols-[14rem_minmax(0,1fr)]">
        <div
          className="de-koi-settings-tabs flex min-w-0 shrink-0 gap-1 overflow-x-auto border-b border-[var(--border)] bg-[var(--card)]/45 p-2 @3xl:flex-col @3xl:overflow-y-auto @3xl:border-b-0 @3xl:border-r @3xl:p-3"
          role="tablist"
          aria-label="Settings sections"
        >
          {TABS.map((tab, tabIndex) => {
            const Icon = tab.icon;
            const selected = activeTab.id === tab.id;
            return (
              <button
                key={tab.id}
                id={getSettingsTabButtonId(tab.id)}
                type="button"
                role="tab"
                aria-selected={selected}
                aria-controls={selected ? `settings-panel-${tab.id}` : undefined}
                tabIndex={selected ? 0 : -1}
                onClick={() => activateTab(tab.id)}
                onKeyDown={(event) => handleTabKeyDown(event, tabIndex)}
                className={cn(
                  "de-koi-settings-tab flex min-h-10 shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] @3xl:w-full @3xl:items-start",
                  selected
                    ? "de-koi-settings-tab-active bg-[var(--primary)]/12 text-[var(--foreground)] ring-1 ring-[var(--primary)]/35"
                    : "text-[var(--muted-foreground)] hover:bg-[var(--secondary)]/65 hover:text-[var(--foreground)]",
                )}
              >
                <Icon size="0.95rem" className={cn("mt-px shrink-0", selected && "text-[var(--primary)]")} />
                <span className="min-w-0">
                  <span className="block whitespace-nowrap text-xs font-semibold leading-tight">{tab.label}</span>
                  <span className="mt-1 hidden text-[0.625rem] font-normal leading-snug text-[var(--muted-foreground)] @3xl:block">
                    {tab.description}
                  </span>
                </span>
              </button>
            );
          })}
        </div>

        <div
          id={`settings-panel-${activeTab.id}`}
          className="de-koi-settings-body min-h-0 overflow-y-auto"
          role="tabpanel"
          aria-labelledby={`settings-tab-${activeTab.id}`}
        >
          <div className="mx-auto w-full max-w-4xl px-4 py-5 sm:px-6 sm:py-6">
            <header className="mb-5 border-b border-[var(--border)] pb-4">
              <h2 className="text-lg font-semibold leading-tight text-[var(--foreground)]">{activeTab.label}</h2>
              <p className="mt-1 max-w-[68ch] text-xs leading-relaxed text-[var(--muted-foreground)]">
                {activeTab.description}
              </p>
            </header>
            <ActiveSettings />
          </div>
        </div>
      </div>
    </div>
  );
}
