// Layout: Right Panel (polished with panel transitions)
import { lazy, Suspense, useRef, type ComponentType, type LazyExoticComponent } from "react";
import { X } from "lucide-react";
import { useEscapeOverlay } from "../../shared/hooks/use-escape-overlay";
import { useUIStore } from "../../shared/stores/ui.store";
import {
  SHELL_ACCENT_STYLES,
  SHELL_PANEL_BY_DESTINATION,
  type ShellPanelDestination,
} from "../../shared/components/shell-navigation";
import { cn } from "../../shared/lib/utils";
import { RIGHT_PANEL_LOADERS } from "./right-panel-loaders";

const BotBrowserPanel = lazy(RIGHT_PANEL_LOADERS["bot-browser"]);
const CharactersPanel = lazy(RIGHT_PANEL_LOADERS.characters);
const LorebooksPanel = lazy(RIGHT_PANEL_LOADERS.lorebooks);
const PresetsPanel = lazy(RIGHT_PANEL_LOADERS.presets);
const ConnectionsPanel = lazy(RIGHT_PANEL_LOADERS.connections);
const AgentsPanel = lazy(RIGHT_PANEL_LOADERS.agents);
const PersonasPanel = lazy(RIGHT_PANEL_LOADERS.personas);
const GlobalGalleryPanel = lazy(RIGHT_PANEL_LOADERS.gallery);
const SettingsPanel = lazy(RIGHT_PANEL_LOADERS.settings);
const HelpPanel = lazy(RIGHT_PANEL_LOADERS.help);

const PANELS: Record<string, LazyExoticComponent<ComponentType>> = {
  "bot-browser": BotBrowserPanel,
  characters: CharactersPanel,
  lorebooks: LorebooksPanel,
  presets: PresetsPanel,
  connections: ConnectionsPanel,
  agents: AgentsPanel,
  personas: PersonasPanel,
  gallery: GlobalGalleryPanel,
  settings: SettingsPanel,
  help: HelpPanel,
};

function isEditableElement(element: Element | null): element is HTMLElement {
  if (!(element instanceof HTMLElement)) return false;
  if (element.isContentEditable) return true;
  return element.matches("input:not([type=checkbox]):not([type=radio]):not([type=button]), textarea, select");
}

function PanelFallback() {
  return (
    <div className="flex h-full items-center justify-center text-sm text-[var(--muted-foreground)]">Loading...</div>
  );
}

export function RightPanel() {
  const panel = useUIStore((s) => s.rightPanel);
  const close = useUIStore((s) => s.closeRightPanel);
  const open = useUIStore((s) => s.rightPanelOpen);
  const panelRef = useRef<HTMLElement>(null);

  // Escape closes the panel. Typing elsewhere is left alone, and while a field inside the panel is
  // focused the first Escape only leaves the field (blur-saved fields save, drafts stay visible);
  // the next Escape closes the panel. Modals opened from the panel register later and win.
  useEscapeOverlay(() => {
    const active = document.activeElement;
    if (isEditableElement(active)) {
      if (!panelRef.current?.contains(active)) return false;
      active.blur();
      return true;
    }
    close();
    return true;
  }, open);

  const config = SHELL_PANEL_BY_DESTINATION[panel as ShellPanelDestination];
  const ActivePanel = PANELS[panel];
  const Icon = config?.icon;
  const title = config?.label ?? "Panel";
  const accent = SHELL_ACCENT_STYLES[config?.accentRole ?? "muted"];

  return (
    <section
      ref={panelRef}
      data-component="RightPanel"
      aria-label={title}
      className="mari-right-panel-content flex h-full flex-col"
    >
      {/* Header - OS window style */}
      <div className="mari-right-panel-header relative flex h-12 flex-shrink-0 items-center justify-between bg-[var(--card)]/80 px-4 backdrop-blur-sm">
        <div className="absolute inset-x-0 bottom-0 h-px bg-[var(--border)]/30" />
        <div className="flex items-center gap-2.5">
          <div className={cn("flex h-6 w-6 items-center justify-center rounded-lg shadow-sm", accent.icon)}>
            {Icon ? <Icon size="0.875rem" /> : null}
          </div>
          <h2 className="text-sm font-semibold text-[var(--foreground)]">{title}</h2>
        </div>
        <button
          type="button"
          onClick={close}
          aria-label={`Close ${title}`}
          className="flex min-h-8 min-w-8 items-center justify-center rounded-lg text-[var(--muted-foreground)] transition-all hover:bg-[var(--accent)] hover:text-[var(--primary)] active:scale-90 max-md:min-h-11 max-md:min-w-11"
        >
          <X size="0.875rem" aria-hidden="true" />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {ActivePanel ? (
          <Suspense fallback={<PanelFallback />}>
            <ActivePanel />
          </Suspense>
        ) : null}
      </div>
    </section>
  );
}
