import { useEffect, useState, type ComponentType, type KeyboardEvent } from "react";
import {
  Blocks,
  Brush,
  Download,
  HeartPulse,
  Palette,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Wrench,
  Search,
} from "lucide-react";
import { cn } from "../../../../shared/lib/utils";
import { useUIStore } from "../../../../shared/stores/ui.store";
import { useSetupJourneyStore } from "../../../../shared/stores/setup-journey.store";
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
import { PrivacyDataSettings } from "./settings/PrivacyDataSettings";
import { SetupJourneyContextBanner } from "../../onboarding/shell";
import { searchSettingsDestinations } from "../lib/settings-destinations";

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
    id: "privacy",
    label: "Privacy & Data",
    description: "Understand, export, and permanently erase De-Koi-managed data.",
    icon: ShieldCheck,
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
  privacy: PrivacyDataSettings,
  advanced: AdvancedSettings,
};

export function SettingsPanel() {
  const setupIntent = useSetupJourneyStore((s) => s.intent);
  const settingsTab = useUIStore((s) => s.settingsTab);
  const setSettingsTab = useUIStore((s) => s.setSettingsTab);
  const pendingSettingsDestination = useUIStore((s) => s.pendingSettingsDestination);
  const setPendingSettingsDestination = useUIStore((s) => s.setPendingSettingsDestination);
  const [query, setQuery] = useState("");
  const [highlightedDestination, setHighlightedDestination] = useState<string | null>(null);
  const searchResults = searchSettingsDestinations(query);
  const activeTab = TABS.find((tab) => tab.id === settingsTab) ?? TABS[0];
  const ActiveSettings = SETTINGS_COMPONENTS[activeTab.id];
  useEffect(() => {
    if (!pendingSettingsDestination) return;
    setHighlightedDestination(pendingSettingsDestination);
    const frame = requestAnimationFrame(() => {
      const element = document.getElementById(`settings-destination-${pendingSettingsDestination}`);
      element?.scrollIntoView?.({
        behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
        block: "start",
      });
      setPendingSettingsDestination(null);
    });
    const timeout = window.setTimeout(() => setHighlightedDestination(null), 1800);
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(timeout);
    };
  }, [pendingSettingsDestination, setPendingSettingsDestination]);
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
    <div className="de-koi-settings-panel @container flex h-full min-h-0 flex-col">
      <div className="relative shrink-0 border-b border-[var(--border)] bg-[var(--card)]/65 p-3">
        <label className="flex min-h-10 items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--background)]/70 px-3 focus-within:border-[var(--primary)]/55 focus-within:ring-1 focus-within:ring-[var(--primary)]/25">
          <Search size="0.9rem" className="text-[var(--muted-foreground)]" aria-hidden />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label="Search settings"
            placeholder="Search settings…"
            className="min-w-0 flex-1 bg-transparent py-2 text-sm outline-none placeholder:text-[var(--muted-foreground)]"
          />
        </label>
        {query.trim() && (
          <div className="absolute inset-x-3 top-[3.6rem] z-20 max-h-64 overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--popover)] p-1.5 shadow-xl" aria-live="polite">
            <p className="px-2 py-1 text-[0.65rem] font-medium uppercase tracking-wider text-[var(--muted-foreground)]">
              {searchResults.length} result{searchResults.length === 1 ? "" : "s"}
            </p>
            {searchResults.map((destination) => (
              <button
                key={destination.id}
                type="button"
                onClick={() => {
                  setSettingsTab(destination.tab);
                  setPendingSettingsDestination(destination.id);
                  setQuery("");
                }}
                className="flex min-h-11 w-full items-center justify-between rounded-lg px-2.5 py-2 text-left hover:bg-[var(--secondary)]"
              >
                <span className="text-xs font-semibold text-[var(--foreground)]">{destination.title}</span>
                <span className="text-[0.65rem] capitalize text-[var(--muted-foreground)]">{destination.tab}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="de-koi-settings-layout min-h-0 flex-1 @3xl:grid @3xl:grid-cols-[14rem_minmax(0,1fr)]">
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
                  <span className="de-koi-caption mt-1 hidden font-normal @3xl:block">
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
            {setupIntent && !setupIntent.completed && (
              <div className="mb-4"><SetupJourneyContextBanner owner="runtime" mode={setupIntent.mode} onReturn={() => useUIStore.getState().closeRightPanel()} /></div>
            )}
            <header className="mb-5 border-b border-[var(--border)] pb-4">
              <h2 className="text-lg font-semibold leading-tight text-[var(--foreground)]">{activeTab.label}</h2>
              <p className="mt-1 max-w-[68ch] text-xs leading-relaxed text-[var(--muted-foreground)]">
                {activeTab.description}
              </p>
            </header>
            <div
              id={highlightedDestination ? `settings-destination-${highlightedDestination}` : undefined}
              className={cn(
                "scroll-mt-4 rounded-xl transition-shadow duration-700",
                highlightedDestination && "ring-2 ring-[var(--primary)]/55 ring-offset-4 ring-offset-[var(--background)]",
              )}
            >
              <ActiveSettings />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
