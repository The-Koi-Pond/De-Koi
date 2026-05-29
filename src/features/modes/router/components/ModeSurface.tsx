import { Suspense, lazy, useEffect, useRef } from "react";
import { useChat, type ChatMode } from "../../../catalog/chats/index";
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

export function ModeSurface() {
  const activeChatId = useChatStore((state) => state.activeChatId);
  const setActiveChatId = useChatStore((state) => state.setActiveChatId);
  const { data: chat, error: chatError } = useChat(activeChatId);
  const lastModeRef = useRef<ChatMode>("conversation");

  useEffect(() => {
    if (!activeChatId || !(chatError instanceof ApiError) || chatError.status !== 404) return;
    setActiveChatId(null);
  }, [activeChatId, chatError, setActiveChatId]);

  if (!activeChatId) return <ModeHomeSurface />;

  if (chat?.mode) lastModeRef.current = chat.mode;
  const chatMode = chat?.mode ?? lastModeRef.current;
  const fallback = <div className="flex flex-1 overflow-hidden" />;

  return (
    <Suspense fallback={fallback}>
      {chatMode === "game" ? (
        <GameModeRoute activeChatId={activeChatId} />
      ) : chatMode === "conversation" ? (
        <ConversationModeRoute activeChatId={activeChatId} />
      ) : (
        <RoleplayModeRoute activeChatId={activeChatId} fallbackChatMode="roleplay" />
      )}
    </Suspense>
  );
}
