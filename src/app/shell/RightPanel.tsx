// Layout: Right Panel (polished with panel transitions)
import { lazy, Suspense, useRef, type ComponentType, type LazyExoticComponent } from "react";
import { X } from "lucide-react";
import { useEscapeOverlay } from "../../shared/hooks/use-escape-overlay";
import { useUIStore } from "../../shared/stores/ui.store";
import {
  PEOPLE_PANELS,
  SHELL_ACCENT_STYLES,
  SHELL_PANEL_BY_DESTINATION,
  type ShellPanelDestination,
} from "../../shared/components/shell-navigation";
import { cn } from "../../shared/lib/utils";
import { ColumnCollapseButton } from "./ColumnCollapseButton";
import { preloadRightPanelPanel, RIGHT_PANEL_LOADERS } from "./right-panel-loaders";

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

/**
 * Characters and Personas share one menu tab; this switch in the panel's title bar moves between them.
 * Two tabs in an inset track; the chosen one glows (styles: `.de-koi-people-switch` in 04-surfaces-components.css).
 */
function PeoplePanelSwitch({ panel }: { panel: (typeof PEOPLE_PANELS)[number] }) {
  const openRightPanel = useUIStore((s) => s.openRightPanel);

  const select = (next: (typeof PEOPLE_PANELS)[number], focus = false) => {
    preloadRightPanelPanel(next);
    openRightPanel(next);
    if (focus) document.getElementById(`people-panel-tab-${next}`)?.focus();
  };

  return (
    <div
      role="tablist"
      aria-label="Characters or personas"
      className="de-koi-people-switch min-w-0 flex-1"
      onKeyDown={(event) => {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
        event.preventDefault();
        select(panel === "characters" ? "personas" : "characters", true);
      }}
    >
      {PEOPLE_PANELS.map((option) => {
        const selected = option === panel;
        return (
          <button
            key={option}
            id={`people-panel-tab-${option}`}
            type="button"
            role="tab"
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => select(option)}
            onPointerEnter={() => preloadRightPanelPanel(option)}
            className="de-koi-people-switch-tab px-3"
          >
            <span className="truncate">{SHELL_PANEL_BY_DESTINATION[option].label}</span>
          </button>
        );
      })}
    </div>
  );
}

function isPeoplePanel(panel: string): panel is (typeof PEOPLE_PANELS)[number] {
  return (PEOPLE_PANELS as readonly string[]).includes(panel);
}

function PanelFallback() {
  return (
    <div className="flex h-full items-center justify-center text-sm text-[var(--muted-foreground)]">Loading...</div>
  );
}

/**
 * `onCollapse`: the panel sits in the Pond rail's column, so its header gets the
 * fold-away "‹" on the left instead of the close ✕.
 */
export function RightPanel({ onCollapse }: { onCollapse?: () => void } = {}) {
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
      {/* Header - OS window style. The fold-away tab sits against the left edge, the ✕ (outside the
          Pond rail's column) is a flush cell at the right edge. */}
      <div
        className={cn(
          "mari-right-panel-header relative flex h-12 flex-shrink-0 items-center bg-[var(--card)]/80 backdrop-blur-sm",
          isPeoplePanel(panel) && "gap-1",
          isPeoplePanel(panel) && (onCollapse ? "pr-1" : "pl-1"),
        )}
      >
        <div className="absolute inset-x-0 bottom-0 h-px bg-[var(--border)]/30" />
        {onCollapse && <ColumnCollapseButton onCollapse={onCollapse} />}
        {/* Characters and Personas share the tab: the switch takes the title's place. */}
        {isPeoplePanel(panel) ? (
          <PeoplePanelSwitch panel={panel} />
        ) : (
          <div className="flex min-w-0 flex-1 items-center gap-2.5 self-stretch px-4">
            <div className={cn("flex h-6 w-6 items-center justify-center rounded-lg shadow-sm", accent.icon)}>
              {Icon ? <Icon size="0.875rem" /> : null}
            </div>
            <h2 className="de-koi-display-title truncate text-sm font-semibold text-[var(--foreground)]">{title}</h2>
          </div>
        )}
        {!onCollapse && (
          <button
            type="button"
            onClick={close}
            aria-label={`Close ${title}`}
            className="flex w-12 shrink-0 items-center justify-center self-stretch border-l border-[var(--border)]/40 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)] hover:text-[var(--primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--ring)]"
          >
            <X size="0.875rem" aria-hidden="true" />
          </button>
        )}
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
