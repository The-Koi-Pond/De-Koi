import { Suspense, lazy, useEffect, useRef, type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { useChat, useChatSummaries, type ChatMode } from "../../../catalog/chats/index";
import { ApiError } from "../../../../shared/api/api-errors";
import { useChatStore } from "../../../../shared/stores/chat.store";
import { ModeHomeSurface } from "./ModeHomeSurface";

const ConversationModeRoute = lazy(async () => {
  const module = await import("../../conversation/index");
  return { default: module.ConversationModeRoute };
});

const RoleplayModeRoute = lazy(async () => {
  const module = await import("../../roleplay/index");
  return { default: module.RoleplayModeRoute };
});

const GameModeRoute = lazy(async () => {
  const module = await import("../../game/index");
  return { default: module.GameModeRoute };
});

function RestoringChatState({
  error,
  onBack,
}: {
  error?: string | null;
  onBack: () => void;
}) {
  const hasError = !!error;
  return (
    <div data-component="ModeSurface.RestoringChat" className="flex flex-1 items-center justify-center p-6">
      <div className="flex max-w-sm flex-col items-center gap-3 text-center">
        {!hasError && <Loader2 size="1.75rem" className="animate-spin text-[var(--primary)]" />}
        <div className="space-y-1">
          <p className="text-sm font-medium text-[var(--foreground)]">
            {hasError ? "Could not open this chat" : "Opening chat..."}
          </p>
          {hasError && <p className="text-xs text-[var(--muted-foreground)]">{error}</p>}
        </div>
        {hasError && (
          <button
            type="button"
            onClick={onBack}
            className="rounded-lg border border-[var(--border)] bg-[var(--secondary)] px-3 py-1.5 text-xs font-medium text-[var(--foreground)] transition-colors hover:bg-[var(--accent)]"
          >
            Back to chats
          </button>
        )}
      </div>
    </div>
  );
}

export function ModeSurface({ homeDiscoverySurface = null }: { homeDiscoverySurface?: ReactNode }) {
  const activeChatId = useChatStore((state) => state.activeChatId);
  const setActiveChatId = useChatStore((state) => state.setActiveChatId);
  const { data: chat, error: chatError, isLoading: isChatLoading, isFetching: isChatFetching } = useChat(activeChatId);
  const { data: chatSummaries } = useChatSummaries();
  const cachedChat = activeChatId ? chatSummaries?.find((item) => item.id === activeChatId) : undefined;
  const lastChatRef = useRef<{ id: string; mode: ChatMode } | null>(null);

  useEffect(() => {
    if (!activeChatId || !(chatError instanceof ApiError) || chatError.status !== 404) return;
    setActiveChatId(null);
  }, [activeChatId, chatError, setActiveChatId]);

  useEffect(() => {
    if (!activeChatId || !chatSummaries || cachedChat || chat || isChatLoading || isChatFetching) return;
    setActiveChatId(null);
  }, [activeChatId, cachedChat, chat, chatSummaries, isChatFetching, isChatLoading, setActiveChatId]);

  if (!activeChatId) return <ModeHomeSurface discoverySurface={homeDiscoverySurface} />;

  const fallback = <RestoringChatState onBack={() => setActiveChatId(null)} />;
  const resolvedChatMode = chat?.mode ?? cachedChat?.mode;
  if (resolvedChatMode) lastChatRef.current = { id: activeChatId, mode: resolvedChatMode };

  const chatMode = resolvedChatMode ?? (lastChatRef.current?.id === activeChatId ? lastChatRef.current.mode : null);
  if (!chatMode && (isChatLoading || isChatFetching)) return fallback;
  if (!chatMode) {
    const message =
      chatError instanceof Error
        ? chatError.message
        : chatSummaries && !cachedChat
          ? "This chat is no longer in your library."
          : null;
    return message ? (
      <RestoringChatState error={message} onBack={() => setActiveChatId(null)} />
    ) : (
      <ModeHomeSurface discoverySurface={homeDiscoverySurface} />
    );
  }

  return (
    <Suspense fallback={fallback}>
      {chatMode === "game" ? (
        <GameModeRoute key={activeChatId} activeChatId={activeChatId} />
      ) : chatMode === "conversation" ? (
        <ConversationModeRoute activeChatId={activeChatId} />
      ) : (
        <RoleplayModeRoute activeChatId={activeChatId} fallbackChatMode="roleplay" />
      )}
    </Suspense>
  );
}
