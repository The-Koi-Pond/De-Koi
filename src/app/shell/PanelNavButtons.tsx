import type { MouseEvent as ReactMouseEvent } from "react";
import { useAgentStore } from "../../shared/stores/agent.store";
import { useUIStore } from "../../shared/stores/ui.store";
import { cn } from "../../shared/lib/utils";
import { SHELL_ACCENT_STYLES, SHELL_PANEL_ITEMS } from "../../shared/components/shell-navigation";
import { preloadRightPanelPanel } from "./right-panel-loaders";

function stopTitlebarDrag(event: ReactMouseEvent<HTMLElement>) {
  event.stopPropagation();
}

export function PanelNavButtons({ className }: { className?: string }) {
  const toggleRightPanel = useUIStore((s) => s.toggleRightPanel);
  const rightPanel = useUIStore((s) => s.rightPanel);
  const rightPanelOpen = useUIStore((s) => s.rightPanelOpen);
  const failedAgentCount = useAgentStore((s) => s.failedAgentTypes.length);

  return (
    <nav
      data-tour="panel-buttons"
      aria-label="Panel navigation"
      className={cn("mari-panel-nav hidden md:flex shrink-0 items-center gap-0.5", className)}
      onMouseDown={stopTitlebarDrag}
      onDoubleClick={stopTitlebarDrag}
    >
      {SHELL_PANEL_ITEMS.map(({ destination: panel, icon: Icon, label, accentRole }) => {
        const isActive = rightPanelOpen && rightPanel === panel;
        const preloadPanel = () => preloadRightPanelPanel(panel);
        const accent = SHELL_ACCENT_STYLES[accentRole];
        return (
          <button
            key={panel}
            type="button"
            onClick={() => {
              preloadPanel();
              toggleRightPanel(panel);
            }}
            onFocus={preloadPanel}
            onPointerEnter={preloadPanel}
            onMouseDown={(event) => {
              stopTitlebarDrag(event);
              preloadPanel();
            }}
            onDoubleClick={stopTitlebarDrag}
            className={cn(
              "mari-titlebar-action de-koi-icon-target relative rounded-md transition-all duration-200",
              isActive
                ? cn("mari-titlebar-action-active [&>svg]:stroke-[2.3]", accent.text)
                : cn("text-[var(--muted-foreground)]", accent.hoverText),
            )}
            title={label}
            aria-label={label}
            aria-pressed={isActive}
          >
            <Icon size="0.875rem" />
            {isActive ? (
              <span
                className={cn(
                  "absolute -bottom-0.5 left-1/2 h-0.5 w-3 -translate-x-1/2 rounded-full",
                  accent.indicator,
                )}
              />
            ) : null}
            {panel === "agents" && failedAgentCount > 0 ? (
              <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-amber-500 ring-1 ring-[var(--card)]" />
            ) : null}
          </button>
        );
      })}
    </nav>
  );
}
