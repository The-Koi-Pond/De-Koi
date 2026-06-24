import { useCallback, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { BookOpen, Compass, HelpCircle, List, MessageSquare, Theater } from "lucide-react";
import { useConnections } from "../../../catalog/connections/index";
import { useCreateChat } from "../../../catalog/chats/index";
import { useApplyUserStarredChatPreset } from "../../../catalog/chat-presets/index";
import { NewChatConnectionGate } from "../../shared/chat-ui/index";
import { filterLanguageGenerationConnections } from "../../../../shared/lib/connection-filters";
import { cn } from "../../../../shared/lib/utils";
import { useChatStore } from "../../../../shared/stores/chat.store";
import { useUIStore } from "../../../../shared/stores/ui.store";
import { HomeCreditsModal } from "./HomeCreditsModal";
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

export const HOME_SPLASH_TEXTS = [
  "Where's my pizza?",
  "Sponsored by Donkey Kong",
  "How'd you find this repo?!",
  "Lamp oil? Rope? Bombs?",
  "Cloner? I hardly know-er.",
  '"We have AI roleplay at home!" (AI roleplay at home:)',
  "Vibe code go BRRRRRRRR",
  "No rules just (CODE BREAKING SOUNDS)",
  "8008135",
] as const;

export function pickHomeSplashText(random = Math.random): string {
  const index = Math.min(
    HOME_SPLASH_TEXTS.length - 1,
    Math.max(0, Math.floor(random() * HOME_SPLASH_TEXTS.length)),
  );
  return HOME_SPLASH_TEXTS[index] ?? HOME_SPLASH_TEXTS[0];
}

export function ModeHomeSurface({
  discoverySurface = null,
  onOpenNoModelShowcase,
}: {
  discoverySurface?: ReactNode;
  onOpenNoModelShowcase?: () => void;
}) {
  const { data: connections } = useConnections();
  const createChat = useCreateChat();
  const applyUserStarredChatPreset = useApplyUserStarredChatPreset();
  const pendingNewChatMode = useChatStore((state) => state.pendingNewChatMode);
  const [creditsOpen, setCreditsOpen] = useState(false);
  const [homeSplashText] = useState(() => pickHomeSplashText());
  const languageConnections = useMemo(
    () =>
      filterLanguageGenerationConnections(
        (connections ?? []) as Array<{ id: string; provider?: string }>,
      ).filter((connection) => !!connection.id),
    [connections],
  );
  const hasLanguageConnections = languageConnections.length > 0;

  const handleQuickStart = useCallback(
    (mode: QuickStartMode) => {
      if (languageConnections.length === 0) {
        useChatStore.getState().setPendingNewChatMode(mode);
        return;
      }

      const label = mode === "conversation" ? "Conversation" : mode === "game" ? "Game" : "Roleplay";
      createChat.mutate(
        { name: `New ${label}`, mode, characterIds: [], connectionId: languageConnections[0]!.id },
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
    [applyUserStarredChatPreset, createChat, languageConnections],
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
          <div className="koi-home-hero relative flex flex-col items-center gap-4 sm:gap-5">
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

            <p className="koi-home-splash" aria-label={`Launch splash: ${homeSplashText}`}>
              {homeSplashText}
            </p>

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

          {!hasLanguageConnections && onOpenNoModelShowcase && (
            <button
              type="button"
              onClick={onOpenNoModelShowcase}
              className="group flex w-full max-w-[32rem] items-center gap-3 rounded-lg border border-[var(--primary)]/25 bg-[var(--card)]/75 px-3 py-2.5 text-left shadow-sm transition-colors hover:border-[var(--primary)]/45 hover:bg-[var(--primary)]/8"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-[var(--primary)]/25 bg-[var(--primary)]/10 text-[var(--primary)]">
                <Compass size="1rem" aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-[var(--foreground)]">Explore sample world</span>
                <span className="mt-0.5 block text-xs leading-snug text-[var(--muted-foreground)]">
                  Browse a Game scene, party, journal, map, and lore before connecting a model.
                </span>
              </span>
            </button>
          )}

          <RecentChats />
          {discoverySurface}

          <div
            className={cn(
              "w-48",
              showQuickStartEntranceEffects ? "retro-divider" : "h-px rounded-[1px] bg-[var(--border)]/40",
            )}
          />

          <div className="flex w-full max-w-2xl flex-col items-center gap-2">
            <p className="max-w-[36rem] px-1 text-center text-[0.625rem] leading-snug text-[var(--muted-foreground)]/55 sm:text-xs">
              De-Koi is an unofficial modified fork of{" "}
              <a
                href="https://github.com/Pasta-Devs/Marinara-Engine"
                target="_blank"
                rel="noopener noreferrer"
                className="underline decoration-[var(--muted-foreground)]/30 transition-colors hover:text-[var(--primary)] hover:decoration-[var(--primary)]/40"
              >
                Marinara Engine
              </a>
              .
            </p>
            <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-0.5 text-center text-[0.625rem] leading-tight text-[var(--muted-foreground)]/45">
              <span>AGPL-3.0-or-later</span>
              <span>No warranty</span>
              <a
                href="https://github.com/The-Koi-Pond/De-Koi"
                target="_blank"
                rel="noopener noreferrer"
                className="underline decoration-[var(--muted-foreground)]/25 transition-colors hover:text-[var(--primary)] hover:decoration-[var(--primary)]/40"
              >
                Source
              </a>
              <a
                href="https://github.com/The-Koi-Pond/De-Koi/blob/HEAD/LICENSE.txt"
                target="_blank"
                rel="noopener noreferrer"
                className="underline decoration-[var(--muted-foreground)]/25 transition-colors hover:text-[var(--primary)] hover:decoration-[var(--primary)]/40"
              >
                License
              </a>
              <a
                href="https://github.com/The-Koi-Pond/De-Koi/blob/HEAD/NOTICE.md"
                target="_blank"
                rel="noopener noreferrer"
                className="underline decoration-[var(--muted-foreground)]/25 transition-colors hover:text-[var(--primary)] hover:decoration-[var(--primary)]/40"
              >
                Notices
              </a>
              <button
                type="button"
                onClick={() => setCreditsOpen(true)}
                className="underline decoration-[var(--muted-foreground)]/25 transition-colors hover:text-[var(--primary)] hover:decoration-[var(--primary)]/40"
              >
                <List size="0.75rem" aria-hidden="true" className="mr-1 inline-block align-[-0.125rem]" />
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
