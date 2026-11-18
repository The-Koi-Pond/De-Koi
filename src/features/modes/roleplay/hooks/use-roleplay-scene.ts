// The app side of Roleplay scenes: runs the engine's scene steps on the active runtime, refreshes the chats they touch,
// moves the user where each step leads, and says what happened. Behavior spec: docs/provenance/roleplay-scenes.md.
import { useCallback, useRef, useState } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import type { Chat } from "../../../../engine/contracts/types/chat";
import { scheduleContinuityDirectorRefresh } from "../../../../engine/modes/roleplay/continuity-director/continuity-director-scheduler";
import { createRoleplayScene } from "../../../../engine/modes/roleplay/scene/scene-create";
import { forkRoleplayScene } from "../../../../engine/modes/roleplay/scene/scene-fork";
import {
  concludeRoleplayScene,
  discardRoleplayScene,
  reopenRoleplayScene,
} from "../../../../engine/modes/roleplay/scene/scene-lifecycle";
import type {
  CreatedScene,
  ForkedScene,
  SceneForkMode,
  SceneFullPlan,
  SceneOpeningMode,
} from "../../../../engine/modes/roleplay/scene/scene-types";
import { offerWorldTickAfterScene } from "../../../../engine/modes/roleplay/world-tick/world-tick-offers";
import { llmApi } from "../../../../shared/api/llm-api";
import { roleplayWorldTickKeys } from "../../../../shared/api/roleplay-world-tick-query-keys";
import { storageApi } from "../../../../shared/api/storage-api";
import { parseChatMetadata } from "../../../../shared/lib/chat-display";
import { toUserMessage } from "../../../../shared/lib/error-message";
import { useChatStore } from "../../../../shared/stores/chat.store";
import { chatKeys } from "../../../catalog/chats";

export interface CreateSceneInput {
  plan: SceneFullPlan;
  /** Defaults to the open chat. */
  originChatId?: string | null;
  initiatorCharId?: string | null;
  connectionId?: string | null;
  /** Defaults to `planned`: this path has no generator to write the opening with. */
  openingMode?: SceneOpeningMode;
}

function refreshChat(queryClient: QueryClient, chatId: string): Promise<unknown> {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: chatKeys.detail(chatId) }),
    queryClient.invalidateQueries({ queryKey: chatKeys.messages(chatId) }),
    queryClient.invalidateQueries({ queryKey: chatKeys.messageCount(chatId) }),
  ]);
}

function refreshChatList(queryClient: QueryClient): Promise<unknown> {
  return queryClient.invalidateQueries({ queryKey: chatKeys.list() });
}

/** Forgets a deleted scene so nothing renders it from the cache. */
function dropChat(queryClient: QueryClient, chatId: string): void {
  queryClient.removeQueries({ queryKey: chatKeys.detail(chatId) });
  queryClient.removeQueries({ queryKey: chatKeys.messages(chatId) });
  queryClient.removeQueries({ queryKey: chatKeys.messageCount(chatId) });
}

/** The cached origin stops pointing at its scene, so the "A scene is in progress" card goes away at once. */
function forgetActiveScene(queryClient: QueryClient, originChatId: string, sceneChatId: string): void {
  queryClient.setQueryData<Chat>(chatKeys.detail(originChatId), (chat) => {
    if (!chat) return chat;
    const metadata = parseChatMetadata(chat.metadata);
    if (metadata.activeSceneChatId !== sceneChatId) return chat;
    const cleared = { ...metadata, activeSceneChatId: null, sceneBusyCharIds: null };
    return { ...chat, metadata: cleared as unknown as Chat["metadata"] };
  });
}

function openChat(chatId: string): void {
  useChatStore.getState().setActiveChatId(chatId);
}

function sceneErrorToast(error: unknown, fallback: string, toastId?: string | number): void {
  toast.error(toUserMessage(error, { fallback }), toastId === undefined ? undefined : { id: toastId, icon: null });
}

const capabilities = { storage: storageApi, llm: llmApi };

export function useRoleplayScene() {
  const queryClient = useQueryClient();
  const forkingRef = useRef(false);
  const [isForking, setIsForking] = useState(false);

  const createScene = useCallback(
    async (input: CreateSceneInput): Promise<CreatedScene | null> => {
      const originChatId = input.originChatId ?? useChatStore.getState().activeChatId;
      if (!originChatId) {
        toast.error("Open the chat the scene should start from, then try again.");
        return null;
      }
      try {
        const scene = await createRoleplayScene(storageApi, {
          originChatId,
          plan: input.plan,
          initiatorCharId: input.initiatorCharId ?? null,
          connectionId: input.connectionId ?? null,
          openingMode: input.openingMode ?? "planned",
        });
        void refreshChatList(queryClient);
        void refreshChat(queryClient, originChatId);
        scheduleContinuityDirectorRefresh({ ...capabilities, chatId: originChatId, trigger: "scene_created" });
        openChat(scene.chatId);
        toast.success(`Scene started: ${scene.chatName}`, { icon: "🎬" });
        return scene;
      } catch (error) {
        sceneErrorToast(error, "Couldn't start the scene. Try again.");
        return null;
      }
    },
    [queryClient],
  );

  const offerTimeToPass = useCallback(
    async (originChatId: string, sceneChatId: string) => {
      try {
        const outcome = await offerWorldTickAfterScene(storageApi, { originChatId, sceneChatId });
        if (!outcome.offered) return;
        void queryClient.invalidateQueries({ queryKey: chatKeys.detail(originChatId) });
        void queryClient.invalidateQueries({ queryKey: roleplayWorldTickKeys.state(originChatId) });
      } catch (error) {
        const reason = error instanceof Error ? error.message.trim() : "";
        toast.warning("Scene concluded, but couldn't offer to let time pass", {
          description: reason || "Use Let time pass in the toolbar instead.",
        });
      }
    },
    [queryClient],
  );

  const concludeScene = useCallback(
    async (sceneChatId: string, connectionId?: string | null): Promise<boolean> => {
      const toastId = toast.loading("Generating scene summary...", { icon: "✍️" });
      try {
        const { originChatId } = await concludeRoleplayScene(capabilities, { sceneChatId, connectionId });
        void refreshChatList(queryClient);
        void refreshChat(queryClient, sceneChatId);
        void refreshChat(queryClient, originChatId);
        scheduleContinuityDirectorRefresh({ ...capabilities, chatId: originChatId, trigger: "scene_concluded" });
        await offerTimeToPass(originChatId, sceneChatId);
        // Ending takes a while: only move the user if they're still in the scene (decision 5).
        const stillInScene = useChatStore.getState().activeChatId === sceneChatId;
        if (stillInScene) openChat(originChatId);
        toast.success("Scene concluded — summary added as a memory", {
          id: toastId,
          icon: "📖",
          ...(stillInScene ? {} : { action: { label: "Go to conversation", onClick: () => openChat(originChatId) } }),
        });
        return true;
      } catch (error) {
        sceneErrorToast(error, "Couldn't end the scene, so it's still open. Try again.", toastId);
        return false;
      }
    },
    [offerTimeToPass, queryClient],
  );

  const discardScene = useCallback(
    async (sceneChatId: string): Promise<boolean> => {
      try {
        const { originChatId } = await discardRoleplayScene(storageApi, { sceneChatId });
        forgetActiveScene(queryClient, originChatId, sceneChatId);
        dropChat(queryClient, sceneChatId);
        void refreshChatList(queryClient);
        void queryClient.invalidateQueries({ queryKey: chatKeys.detail(originChatId) });
        openChat(originChatId);
        toast.success("Scene discarded", { icon: "🗑️" });
        return true;
      } catch (error) {
        sceneErrorToast(error, "Couldn't discard the scene. Try again.");
        return false;
      }
    },
    [queryClient],
  );

  const reopenScene = useCallback(
    async (sceneChatId: string): Promise<boolean> => {
      try {
        const { originChatId } = await reopenRoleplayScene(storageApi, { sceneChatId });
        void refreshChatList(queryClient);
        void refreshChat(queryClient, sceneChatId);
        void refreshChat(queryClient, originChatId);
        openChat(sceneChatId);
        toast.success("Scene reopened");
        return true;
      } catch (error) {
        sceneErrorToast(error, "Couldn't reopen the scene. Try again.");
        return false;
      }
    },
    [queryClient],
  );

  const forkScene = useCallback(
    async (
      sceneChatId: string,
      mode: SceneForkMode,
      options: { upToMessageId?: string | null } = {},
    ): Promise<ForkedScene | null> => {
      // One fork at a time: a repeat click while one runs does nothing.
      if (forkingRef.current) return null;
      forkingRef.current = true;
      setIsForking(true);
      try {
        const forked = await forkRoleplayScene(storageApi, { sceneChatId, mode, upToMessageId: options.upToMessageId });
        void refreshChatList(queryClient);
        void refreshChat(queryClient, forked.chatId);
        if (forked.originChatId) void refreshChat(queryClient, forked.originChatId);
        if (mode === "convert") {
          if (forked.originChatId) forgetActiveScene(queryClient, forked.originChatId, sceneChatId);
          dropChat(queryClient, sceneChatId);
        } else {
          void refreshChat(queryClient, sceneChatId);
        }
        openChat(forked.chatId);
        toast.success(mode === "convert" ? "Scene converted to roleplay" : "Scene cloned as roleplay");
        return forked;
      } catch (error) {
        sceneErrorToast(
          error,
          mode === "convert" ? "Couldn't convert the scene. Try again." : "Couldn't clone the scene. Try again.",
        );
        return null;
      } finally {
        forkingRef.current = false;
        setIsForking(false);
      }
    },
    [queryClient],
  );

  return { createScene, concludeScene, discardScene, reopenScene, forkScene, isForking };
}
