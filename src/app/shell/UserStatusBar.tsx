import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { Check, Circle, MinusCircle, Moon, Users } from "lucide-react";
import { toast } from "sonner";

import {
  PersonaAvatarImage,
  useActivatePersona,
  useActivePersonaSummary,
  usePersonaSummaries,
} from "../../features/catalog/personas/index";
import { PondDiscoverIcon, PondHelpIcon, PondSettingsIcon, type PondIcon } from "../../shared/components/pond-icons";
import { isShellPanelTabOpen } from "../../shared/components/shell-navigation";
import { useEscapeOverlay } from "../../shared/hooks/use-escape-overlay";
import { toUserMessage } from "../../shared/lib/error-message";
import { cn } from "../../shared/lib/utils";
import { useUIStore, type UserStatus } from "../../shared/stores/ui.store";
import { preloadRightPanelPanel } from "./right-panel-loaders";

const STATUS_OPTIONS: Array<{
  value: UserStatus;
  label: string;
  description: string;
  color: string;
  icon: ReactNode;
}> = [
  {
    value: "active",
    label: "Active",
    description: "You're online and available",
    color: "bg-green-500",
    icon: <Circle size="0.625rem" className="fill-green-500 text-green-500" />,
  },
  {
    value: "idle",
    label: "Idle",
    description: "Automatic when you're away",
    color: "bg-yellow-500",
    icon: <Moon size="0.625rem" className="text-yellow-500" />,
  },
  {
    value: "dnd",
    label: "Do Not Disturb",
    description: "Suppress auto messages",
    color: "bg-red-500",
    icon: <MinusCircle size="0.625rem" className="text-red-500" />,
  },
];

const ACTIVITY_HINT = "What are you doing?";

type PersonaAvatarSource = Parameters<typeof PersonaAvatarImage>[0]["persona"] & { avatarPath?: string | null };

/** A persona's small avatar, or its first letter when it has no picture. */
function PersonaAvatar({
  persona,
  name,
  size = "small",
}: {
  persona: PersonaAvatarSource | null;
  name: string;
  size?: "small" | "large";
}) {
  const box = size === "large" ? "h-8 w-8" : "h-6 w-6";
  return persona?.avatarPath ? (
    <PersonaAvatarImage persona={persona} alt="" className={cn(box, "shrink-0 rounded-lg object-cover")} />
  ) : (
    <span
      className={cn(
        box,
        "flex shrink-0 items-center justify-center rounded-lg bg-[var(--secondary)] font-semibold text-[var(--muted-foreground)]",
        size === "large" ? "text-xs" : "text-[0.625rem]",
      )}
    >
      {name[0]?.toUpperCase()}
    </span>
  );
}

function getMenuItems(menu: HTMLElement): HTMLElement[] {
  return Array.from(menu.querySelectorAll<HTMLElement>('[role="menuitem"], [role="menuitemradio"]'));
}

/**
 * A pop-up menu above the bar. It's mounted only while open, so its Escape handler is the topmost on the escape
 * stack: Escape closes the menu, not the panel behind it. Opening moves focus to the checked item (or the first);
 * the arrow keys, Home and End move between items. `itemsReady`: false while the items are still loading.
 */
function PopupMenu({
  label,
  className,
  itemsReady = true,
  onClose,
  children,
}: {
  label: string;
  className: string;
  itemsReady?: boolean;
  /** `returnFocus`: give focus back to the button that opened the menu (Escape); false when Tab moves it on. */
  onClose: (returnFocus: boolean) => void;
  children: ReactNode;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const waitedForItemsRef = useRef(false);
  useEscapeOverlay(() => {
    onClose(true);
    return true;
  });

  useEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;
    if (!itemsReady) {
      waitedForItemsRef.current = true;
      menu.focus();
      return;
    }
    // After a wait for the items, only when focus is still on the menu itself: the user may have moved it
    // (say, into the activity bubble) while the items were loading.
    if (!waitedForItemsRef.current || document.activeElement === menu) {
      const items = getMenuItems(menu);
      (items.find((item) => item.getAttribute("aria-checked") === "true") ?? items[0] ?? menu).focus();
    }
  }, [itemsReady]);

  const moveFocus = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Tab") {
      onClose(false);
      return;
    }
    const items = getMenuItems(event.currentTarget);
    if (items.length === 0) return;
    const index = items.indexOf(document.activeElement as HTMLElement);
    const next =
      event.key === "ArrowDown"
        ? (index + 1) % items.length
        : event.key === "ArrowUp"
          ? index <= 0
            ? items.length - 1
            : index - 1
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? items.length - 1
              : null;
    if (next === null) return;
    event.preventDefault();
    items[next]?.focus();
  };

  return (
    <div
      ref={menuRef}
      role="menu"
      aria-label={label}
      tabIndex={-1}
      onKeyDown={moveFocus}
      className={cn("focus-visible:outline-none", className)}
    >
      {children}
    </div>
  );
}

/** Settings or Help, as a cell in the strip's corner: opens or closes that panel. */
function CornerPanelButton({
  destination,
  label,
  icon: Icon,
}: {
  destination: "settings" | "help";
  label: string;
  icon: PondIcon;
}) {
  const rightPanel = useUIStore((s) => s.rightPanel);
  const rightPanelOpen = useUIStore((s) => s.rightPanelOpen);
  const active = isShellPanelTabOpen(destination, rightPanel, rightPanelOpen);
  return (
    <button
      type="button"
      onClick={() => {
        const ui = useUIStore.getState();
        if (active) ui.closeRightPanel();
        else ui.openRightPanel(destination);
      }}
      onFocus={() => preloadRightPanelPanel(destination)}
      onPointerEnter={() => preloadRightPanelPanel(destination)}
      className={cn(
        "flex w-10 items-center justify-center text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)] hover:text-[var(--foreground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--ring)]",
        active && "bg-[var(--accent)] text-[var(--foreground)]",
      )}
      title={label}
      aria-label={label}
      aria-pressed={active}
    >
      <Icon size="1.0625rem" aria-hidden />
    </button>
  );
}

/**
 * Your presence (Active / Idle / Do Not Disturb) and a "What are you doing?" line that characters can see.
 * `strip`: the Pond rail layout's permanent bar along the whole window's bottom (like DeKoi's), led by
 * your active persona: its avatar switches persona, its name and status set your presence. Otherwise
 * it's the footer of the chat list.
 */
export function UserStatusBar({
  variant,
  discover,
}: {
  variant: "sidebar" | "strip";
  /** The strip's Discover button: whether Discover is open, and what opens or closes it. */
  discover?: { open: boolean; onToggle: () => void };
}) {
  const userStatus = useUIStore((s) => s.userStatus);
  const userActivity = useUIStore((s) => s.userActivity);
  const setUserStatusManual = useUIStore((s) => s.setUserStatusManual);
  const setUserActivity = useUIStore((s) => s.setUserActivity);
  const strip = variant === "strip";
  const { data: activePersona } = useActivePersonaSummary(strip);
  // Which menu is open: the presence menu, or (strip only) the persona switcher.
  const [openMenu, setOpenMenu] = useState<"status" | "persona" | null>(null);
  const { data: personas } = usePersonaSummaries(strip && openMenu === "persona");
  const activatePersona = useActivatePersona();
  const ref = useRef<HTMLDivElement>(null);
  const statusButtonRef = useRef<HTMLButtonElement>(null);
  const personaButtonRef = useRef<HTMLButtonElement>(null);

  // Close on click outside
  useEffect(() => {
    if (!openMenu) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpenMenu(null);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [openMenu]);

  const current = STATUS_OPTIONS.find((s) => s.value === userStatus) ?? STATUS_OPTIONS[0]!;
  const personaName = activePersona?.name?.trim() || "You";
  const toggleMenu = (menu: "status" | "persona") => setOpenMenu((open) => (open === menu ? null : menu));
  // Closing after a pick or Escape gives focus back to the button that opened the menu.
  const closeMenu = (returnFocus = true) => {
    const opener = openMenu === "persona" ? personaButtonRef.current : statusButtonRef.current;
    setOpenMenu(null);
    if (returnFocus) opener?.focus();
  };

  const menuFrame = (children: ReactNode, label: string, itemsReady?: boolean) => (
    <PopupMenu
      label={label}
      itemsReady={itemsReady}
      onClose={closeMenu}
      className={cn(
        "absolute bottom-full z-50 mb-1 max-h-80 overflow-y-auto rounded-xl bg-[var(--popover)] p-1.5 shadow-xl ring-1 ring-[var(--border)]/40",
        strip ? "left-1 w-64" : "left-2 right-2",
      )}
    >
      {children}
    </PopupMenu>
  );

  const statusMenu =
    openMenu === "status" &&
    menuFrame(
      STATUS_OPTIONS.map((opt) => (
        <button
          key={opt.value}
          type="button"
          role="menuitemradio"
          aria-checked={userStatus === opt.value}
          onClick={() => {
            setUserStatusManual(opt.value);
            closeMenu();
          }}
          className={cn(
            "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-all hover:bg-[var(--accent)]",
            userStatus === opt.value && "bg-[var(--accent)]",
          )}
        >
          <span className={`h-2 w-2 rounded-full ${opt.color}`} />
          <div className="min-w-0 flex-1">
            <div className="text-xs font-medium text-[var(--foreground)]">{opt.label}</div>
            <div className="text-[0.625rem] text-[var(--muted-foreground)]">{opt.description}</div>
          </div>
        </button>
      )),
      "Activity status",
    );

  const personaMenu =
    openMenu === "persona" &&
    menuFrame(
      <>
        {(personas ?? []).map((persona) => {
          const selected = persona.id === activePersona?.id;
          const name = persona.name?.trim() || "Unnamed";
          return (
            <button
              key={persona.id}
              type="button"
              role="menuitemradio"
              aria-checked={selected}
              onClick={() => {
                if (!selected) {
                  activatePersona.mutate(persona.id, {
                    onError: (error) =>
                      toast.error(toUserMessage(error, { fallback: `Couldn't switch to ${name}. Try again.` })),
                  });
                }
                closeMenu();
              }}
              className={cn(
                "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left transition-all hover:bg-[var(--accent)]",
                selected && "bg-[var(--accent)]",
              )}
            >
              <PersonaAvatar persona={persona} name={name} />
              <span className="min-w-0 flex-1 truncate text-xs font-medium text-[var(--foreground)]">{name}</span>
              {selected && <Check size="0.75rem" className="shrink-0 text-[var(--primary)]" aria-hidden="true" />}
            </button>
          );
        })}
        {personas && personas.length === 0 && (
          <p className="px-2.5 py-2 text-xs text-[var(--muted-foreground)]">No personas yet.</p>
        )}
        <button
          type="button"
          role="menuitem"
          onClick={() => {
            useUIStore.getState().openRightPanel("personas");
            closeMenu();
          }}
          className="mt-1 flex w-full items-center gap-2 rounded-lg border-t border-[var(--border)]/40 px-2.5 py-2 text-left text-xs text-[var(--muted-foreground)] transition-all hover:bg-[var(--accent)] hover:text-[var(--foreground)]"
        >
          <Users size="0.75rem" aria-hidden="true" />
          Manage personas…
        </button>
      </>,
      "Switch persona",
      personas !== undefined,
    );

  const activityInput = (
    <input
      value={userActivity}
      onChange={(event) => setUserActivity(event.target.value)}
      maxLength={120}
      placeholder={ACTIVITY_HINT}
      aria-label="Custom activity"
      // In the strip the bubble is as wide as its text (or the hint while empty), up to a limit; it grows as you
      // type. Measured in characters because Firefox can't size a text box to its content by itself yet.
      style={
        strip
          ? ({ width: `calc(${Math.max(userActivity.length, ACTIVITY_HINT.length) + 2}ch + 1rem)` } as CSSProperties)
          : undefined
      }
      className={cn(
        "min-w-0 rounded-lg border border-[var(--border)]/40 bg-[var(--sidebar-accent)]/35 px-2 py-1.5 text-xs text-[var(--sidebar-foreground)] outline-none transition-colors placeholder:text-[var(--muted-foreground)]/70 focus:border-[var(--primary)]/40 focus:bg-[var(--sidebar-accent)]/60",
        strip ? "max-w-[32rem]" : "flex-1",
      )}
    />
  );

  if (strip) {
    // You (the avatar switches persona, the name and status set your presence), then the activity bubble.
    return (
      <div
        ref={ref}
        data-component="UserStatusStrip"
        className="relative flex h-10 shrink-0 border-t border-[var(--border)] bg-[var(--sidebar)]"
      >
        {statusMenu}
        {personaMenu}
        <div className="flex min-w-0 max-w-[16rem] shrink-0 items-stretch">
          <button
            ref={personaButtonRef}
            type="button"
            onClick={() => toggleMenu("persona")}
            // The avatar itself glows on hover (and on keyboard focus), not the whole cell.
            className="group/avatar flex shrink-0 items-center pl-2 pr-1 focus-visible:outline-none"
            title="Switch persona"
            aria-label={`Switch persona (now ${personaName})`}
            aria-haspopup="menu"
            aria-expanded={openMenu === "persona"}
          >
            <span
              className={cn(
                "relative h-8 w-8 rounded-lg transition-shadow",
                "group-hover/avatar:shadow-[0_0_0_2px_color-mix(in_srgb,var(--primary)_65%,transparent),0_0_12px_color-mix(in_srgb,var(--primary)_45%,transparent)]",
                "group-focus-visible/avatar:shadow-[0_0_0_2px_var(--ring)]",
                openMenu === "persona" && "shadow-[0_0_0_2px_color-mix(in_srgb,var(--primary)_65%,transparent)]",
              )}
            >
              <PersonaAvatar persona={activePersona ?? null} name={personaName} size="large" />
              <span
                className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full ring-2 ring-[var(--sidebar)] ${current.color}`}
              />
            </span>
          </button>
          <button
            ref={statusButtonRef}
            type="button"
            onClick={() => toggleMenu("status")}
            // A rounded highlight that hugs the name and status (like the bubble beside it), lit while the menu is open.
            className={cn(
              "my-1 mr-1 flex min-w-0 items-center rounded-lg border border-transparent px-1.5 text-left leading-tight transition-colors hover:border-[var(--border)]/60 hover:bg-[var(--sidebar-accent)]/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]",
              openMenu === "status" && "border-[var(--border)]/60 bg-[var(--sidebar-accent)]/50",
            )}
            title="Change activity status"
            aria-label={`Change activity status (${current.label})`}
            aria-haspopup="menu"
            aria-expanded={openMenu === "status"}
          >
            <span className="min-w-0">
              <span className="block truncate text-xs font-medium text-[var(--foreground)]">{personaName}</span>
              <span className="block truncate text-[0.625rem] text-[var(--muted-foreground)]">{current.label}</span>
            </span>
          </button>
        </div>
        {/* Right beside the name and status, no line between them. */}
        <div className="flex min-w-0 flex-1 items-center pr-3">{activityInput}</div>
        {/* Discover (in koi orange, so it's easy to find), Settings and Help in the bottom-right corner. */}
        <div className="flex shrink-0 border-l border-[var(--border)]">
          {discover && (
            <button
              type="button"
              onClick={discover.onToggle}
              className={cn(
                "flex w-10 items-center justify-center text-[var(--primary)] transition-colors hover:bg-[var(--primary)]/12 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--ring)]",
                discover.open && "bg-[var(--primary)]/15",
              )}
              title="Discover"
              aria-label="Discover"
              aria-pressed={discover.open}
            >
              <PondDiscoverIcon size="1.125rem" aria-hidden />
            </button>
          )}
          <CornerPanelButton destination="settings" label="Settings" icon={PondSettingsIcon} />
          <CornerPanelButton destination="help" label="Help" icon={PondHelpIcon} />
        </div>
      </div>
    );
  }

  return (
    <div ref={ref} className="relative border-t border-[var(--border)]/30 px-3 py-2">
      {statusMenu}
      <div className="flex min-w-0 items-center gap-1.5">
        <button
          ref={statusButtonRef}
          onClick={() => toggleMenu("status")}
          className="flex min-w-0 shrink-0 items-center gap-2 rounded-lg px-2 py-1.5 transition-all hover:bg-[var(--sidebar-accent)]/60"
          title="Change activity status"
          aria-label="Change activity status"
        >
          <span className={`h-2 w-2 shrink-0 rounded-full ${current.color}`} />
          <span className="max-w-20 truncate text-xs text-[var(--sidebar-foreground)]">{current.label}</span>
        </button>
        {activityInput}
      </div>
    </div>
  );
}
