import { useCallback, useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { BookOpen, HelpCircle, List, MessageSquare, Theater } from "lucide-react";
import { APP_VERSION } from "../../../../engine/contracts/constants/defaults";
import { useConnections } from "../../../catalog/connections/index";
import { useCreateChat } from "../../../catalog/chats/index";
import { useApplyUserStarredChatPreset } from "../../../catalog/chat-presets/index";
import { NewChatConnectionGate } from "../../shared/chat-ui/index";
import { filterLanguageGenerationConnections } from "../../../../shared/lib/connection-filters";
import { cn } from "../../../../shared/lib/utils";
import { useChatStore } from "../../../../shared/stores/chat.store";
import { useUIStore } from "../../../../shared/stores/ui.store";
import { HomeCreditsModal } from "./HomeCreditsModal";
import { HOME_CREDIT_LINKS } from "./homeCredits";
import { RecentChats } from "./RecentChats";

type QuickStartMode = "conversation" | "roleplay" | "game";

const quickStartModePreloads: Record<QuickStartMode, () => Promise<unknown>> = {
  conversation: () => import("../../conversation/index"),
  roleplay: () => import("../../roleplay/index"),
  game: () => import("../../game/index"),
};
const preloadedQuickStartModes = new Set<QuickStartMode>();

function prewarmQuickStartMode(mode: QuickStartMode): void {
  if (preloadedQuickStartModes.has(mode)) return;
  preloadedQuickStartModes.add(mode);
  quickStartModePreloads[mode]().catch(() => preloadedQuickStartModes.delete(mode));
}

function prewarmAllQuickStartModes(): void {
  prewarmQuickStartMode("conversation");
  prewarmQuickStartMode("roleplay");
  prewarmQuickStartMode("game");
}

export function ModeHomeSurface({ discoverySurface = null }: { discoverySurface?: ReactNode }) {
  const { data: connections } = useConnections();
  const createChat = useCreateChat();
  const applyUserStarredChatPreset = useApplyUserStarredChatPreset();
  const pendingNewChatMode = useChatStore((state) => state.pendingNewChatMode);
  const [creditsOpen, setCreditsOpen] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const idleWindow = window as Window & {
      requestIdleCallback?: (callback: () => void, options?: { timeout?: number }) => number;
      cancelIdleCallback?: (handle: number) => void;
    };
    const requestIdle = idleWindow.requestIdleCallback;
    if (typeof requestIdle === "function") {
      const handle = requestIdle(prewarmAllQuickStartModes, { timeout: 1800 });
      return () => idleWindow.cancelIdleCallback?.(handle);
    }
    const handle = window.setTimeout(prewarmAllQuickStartModes, 600);
    return () => window.clearTimeout(handle);
  }, []);

  const handleQuickStart = useCallback(
    (mode: QuickStartMode) => {
      const connectionRows = filterLanguageGenerationConnections(
        (connections ?? []) as Array<{ id: string; provider?: string }>,
      ).filter((connection) => !!connection.id);
      if (connectionRows.length === 0) {
        useChatStore.getState().setPendingNewChatMode(mode);
        return;
      }

      const label = mode === "conversation" ? "Conversation" : mode === "game" ? "Game" : "Roleplay";
      createChat.mutate(
        { name: `New ${label}`, mode, characterIds: [], connectionId: connectionRows[0]!.id },
        {
          onSuccess: async (chat) => {
            const store = useChatStore.getState();
            store.setActiveChatId(chat.id);
            try {
              await applyUserStarredChatPreset({ mode, chatId: chat.id });
            } catch {
              /* non-fatal: chat still opens with system defaults */
            }
            store.setShouldOpenSettings(true, chat.id);
            store.setShouldOpenWizard(true, chat.id);
          },
        },
      );
    },
    [applyUserStarredChatPreset, connections, createChat],
  );

  const showQuickStartEntranceEffects = true;

  return (
    <>
      <HomeCreditsModal open={creditsOpen} onClose={() => setCreditsOpen(false)} />
      <div
        data-component="ChatArea.EmptyState"
        className="koi-pond-surface flex min-w-0 flex-1 flex-col items-center overflow-y-auto overflow-x-hidden p-3 sm:p-5 lg:p-6"
      >
        <div className="flex w-full max-w-3xl min-w-0 flex-col items-center gap-4 py-3 sm:gap-5 sm:py-5 lg:pt-6 lg:pb-7">
          <div className="relative">
            <div
              className={cn(
                "koi-logo-tile flex h-16 w-16 items-center justify-center overflow-hidden rounded-[1.35rem] sm:h-24 sm:w-24",
              )}
            >
              <img
                src="/logo.png"
                alt="De-Koi"
                width={80}
                height={80}
                decoding="async"
                className="h-full w-full object-contain p-1.5 sm:p-2"
              />
            </div>
          </div>

          <div className="text-center">
            <h3 className="koi-glow-text inline-flex items-center justify-center gap-1 text-2xl font-black sm:gap-2 sm:text-4xl">
              <img src="/koi-mark.svg" alt="" aria-hidden="true" className="h-4 w-8 shrink-0 sm:h-5 sm:w-12" />
              <span>De-Koi</span>
              <img
                src="/koi-mark.svg"
                alt=""
                aria-hidden="true"
                className="h-4 w-8 shrink-0 -scale-x-100 sm:h-5 sm:w-12"
              />
            </h3>
            <p className="mt-2 max-w-md text-sm leading-relaxed text-[var(--foreground)]/80 sm:mt-3 sm:text-lg">
              To get started, choose the type of chat you'd like to have with the AI
            </p>
          </div>

          <div
            className={cn(
              "grid w-full max-w-[32rem] min-w-0 grid-cols-3 gap-2 px-0 sm:gap-4",
              showQuickStartEntranceEffects && "stagger-children",
            )}
          >
            <QuickStartCard
              icon={<MessageSquare size="1.125rem" />}
              label="Conversation"
              bg="linear-gradient(135deg, #ff9a66 0%, #ff7a4a 54%, #9c3c27 100%)"
              iconColor="#fff4e8"
              labelColor="#ff8957"
              shadowColor="rgba(255,137,87,0.2)"
              tooltip="General chat with one or more characters, or a model itself"
              onPrewarm={() => prewarmQuickStartMode("conversation")}
              onClick={() => handleQuickStart("conversation")}
            />
            <QuickStartCard
              icon={<BookOpen size="1.125rem" />}
              label="Roleplay"
              bg="linear-gradient(135deg, #5ce7df 0%, #22b8b5 52%, #086873 100%)"
              iconColor="#f4eadb"
              labelColor="#52e1da"
              shadowColor="rgba(82,225,218,0.16)"
              tooltip="For roleplaying or creative writing with one or more characters"
              onPrewarm={() => prewarmQuickStartMode("roleplay")}
              onClick={() => handleQuickStart("roleplay")}
            />
            <QuickStartCard
              icon={<Theater size="1.125rem" />}
              label="Game"
              bg="linear-gradient(135deg, #ffd78d 0%, #d9aa57 52%, #80612d 100%)"
              iconColor="#130d07"
              labelColor="#d9aa57"
              shadowColor="rgba(217,170,87,0.18)"
              tooltip="AI-managed singleplayer RPG with a Game Master, party, dice, maps, and quests"
              onPrewarm={() => prewarmQuickStartMode("game")}
              onClick={() => handleQuickStart("game")}
            />
          </div>

          <RecentChats />
          {discoverySurface}

          <div
            className={cn(
              "w-48",
              showQuickStartEntranceEffects ? "retro-divider" : "h-px rounded-[1px] bg-[var(--border)]/40",
            )}
          />

          <div className="flex w-full max-w-2xl flex-col items-center gap-2">
            <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-0.5 text-center text-[0.625rem] leading-tight text-[var(--muted-foreground)]/55 sm:text-xs">
              {HOME_CREDIT_LINKS.map((item) => (
                <span key={item.label}>
                  {item.footerPrefix}{" "}
                  <a
                    href={item.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline decoration-[var(--muted-foreground)]/30 transition-colors hover:text-[var(--primary)] hover:decoration-[var(--primary)]/40"
                  >
                    {item.label}
                  </a>
                </span>
              ))}
            </div>
            <div className="flex flex-wrap justify-center gap-2">
              <a
                href="https://discord.com/invite/KdAkTg94ME"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--secondary)]/60 px-3 py-1.5 text-xs font-medium text-[var(--muted-foreground)] transition-all hover:border-[var(--primary)]/40 hover:text-[var(--primary)]"
              >
                <svg width="0.875rem" height="0.875rem" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.095 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.095 2.157 2.42 0 1.333-.947 2.418-2.157 2.418z" />
                </svg>
                Discord
              </a>
              <a
                href="https://ko-fi.com/marinara_spaghetti"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--secondary)]/60 px-3 py-1.5 text-xs font-medium text-[var(--muted-foreground)] transition-all hover:border-[var(--primary)]/40 hover:text-[var(--primary)]"
              >
                <svg width="0.875rem" height="0.875rem" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
                </svg>
                Support
              </a>
              <button
                type="button"
                onClick={() => setCreditsOpen(true)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--secondary)]/60 px-3 py-1.5 text-xs font-medium text-[var(--muted-foreground)] transition-all hover:border-[var(--primary)]/40 hover:text-[var(--primary)]"
              >
                <List size="0.875rem" />
                Credits
              </button>
            </div>

            <button
              onClick={() => useUIStore.getState().setHasCompletedOnboarding(false)}
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[0.625rem] text-[var(--muted-foreground)]/40 transition-colors hover:bg-[var(--secondary)]/60 hover:text-[var(--muted-foreground)]"
              title="Replay tutorial"
            >
              <HelpCircle size="0.75rem" />
              Replay Tutorial
            </button>

            <p className="text-[0.625rem] tracking-wide text-[var(--muted-foreground)]/30">v{APP_VERSION}</p>
          </div>
        </div>
      </div>
      {pendingNewChatMode && (
        <NewChatConnectionGate
          mode={pendingNewChatMode}
          onClose={() => useChatStore.getState().setPendingNewChatMode(null)}
        />
      )}
    </>
  );
}

function QuickStartCard({
  icon,
  label,
  bg,
  iconColor = "#0a0a0a",
  labelColor,
  shadowColor,
  onClick,
  onPrewarm,
  comingSoon,
  tooltip,
}: {
  icon: ReactNode;
  label: string;
  bg: string;
  iconColor?: string;
  labelColor?: string;
  shadowColor?: string;
  onClick?: () => void;
  onPrewarm?: () => void;
  comingSoon?: boolean;
  tooltip?: string;
}) {
  const [showComingSoon, setShowComingSoon] = useState(false);

  const handleClick = () => {
    if (comingSoon && !onClick) {
      setShowComingSoon(true);
      setTimeout(() => setShowComingSoon(false), 1500);
      return;
    }
    onPrewarm?.();
    onClick?.();
  };

  const quickStartStyle = {
    "--quick-start-label": labelColor ?? "var(--muted-foreground)",
    "--quick-start-border": labelColor ?? "var(--border)",
    "--quick-start-shadow": shadowColor ?? "rgba(255,137,87,0.12)",
  } as CSSProperties;

  return (
    <button
      type="button"
      onClick={handleClick}
      onPointerEnter={onPrewarm}
      onFocus={onPrewarm}
      title={tooltip}
      aria-label={`${comingSoon && !onClick ? "Show status for" : "Start"} ${label} chat`}
      className={cn(
        "koi-start-card group card-3d-tilt btn-scanlines koi-ripple relative flex w-full flex-col items-center justify-center gap-2 overflow-hidden rounded-xl border p-2.5 text-center transition-all",
        "aspect-square min-h-[6rem] sm:gap-3 sm:p-5",
        "cursor-pointer hover:-translate-y-1",
      )}
      style={quickStartStyle}
    >
      {showComingSoon && (
        <span className="absolute -top-3 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-[var(--secondary)] px-2 py-0.5 text-[0.5625rem] font-semibold uppercase tracking-wider text-[var(--muted-foreground)] shadow-md animate-fade-in-up">
          Coming Soon
        </span>
      )}
      <div
        className="koi-start-icon flex h-10 w-10 items-center justify-center rounded-xl transition-transform group-hover:scale-110 sm:h-16 sm:w-16 sm:rounded-2xl"
        style={{ background: bg, color: iconColor }}
      >
        {icon}
      </div>
      <span className="koi-start-label text-[0.7rem] font-bold sm:text-lg">{label}</span>
    </button>
  );
}
