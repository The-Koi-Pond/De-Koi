// ──────────────────────────────────────────────
// Hook: Roleplay scene sound (ambient bed + one effect per reply)
// ──────────────────────────────────────────────
import { useEffect, useMemo, useRef } from "react";
import { pickSceneAmbient } from "../../../../engine/modes/roleplay/scene-sound/scene-ambient";
import { pickReplySoundEffect } from "../../../../engine/modes/roleplay/scene-sound/scene-effects";
import {
  SCENE_AMBIENT_CLIP_SECONDS,
  sceneAmbientSound,
  type SceneAmbientId,
} from "../../../../engine/modes/roleplay/scene-sound/scene-sound-catalog";
import { useTTSConfig } from "../../../../shared/hooks/use-tts";
import { sceneSoundPlayer } from "../../../../shared/lib/scene-sound-player";
import { sceneSoundUnavailableReason } from "../../../../shared/lib/sound-effects";
import { useUIStore } from "../../../../shared/stores/ui.store";
import { useTrackerStateStore } from "../../../runtime/world-state/index";
import type { MessageWithSwipes } from "../../shared/chat-ui/index";

/** Replies the ambient pick reads when the chat has no World State. */
const AMBIENT_REPLY_WINDOW = 3;

function isReply(message: MessageWithSwipes): boolean {
  return message.role === "assistant" || message.role === "narrator";
}

function replyKey(message: MessageWithSwipes): string {
  return `${message.id}:${message.activeSwipeIndex}`;
}

/** Whether scene sound can run with the saved Text to Speech settings, and what to tell the user when it can't. */
export function useSceneSoundAvailability(): { ready: boolean; reason: string | null } {
  const { data: config } = useTTSConfig();
  if (!config) return { ready: false, reason: null };
  const reason = sceneSoundUnavailableReason(config);
  return { ready: !reason, reason };
}

export function useRoleplaySceneSound({
  chatId,
  messages,
  isStreaming,
  sceneText,
}: {
  chatId: string | null;
  messages: MessageWithSwipes[] | undefined;
  isStreaming: boolean;
  sceneText: string;
}) {
  const enabled = useUIStore((state) => state.roleplaySceneSound);
  const ambientVolume = useUIStore((state) => state.sceneAmbientVolume);
  const effectsVolume = useUIStore((state) => state.sceneEffectsVolume);
  const { ready } = useSceneSoundAvailability();
  const active = Boolean(enabled && ready && chatId);
  const tracker = useTrackerStateStore((state) => (chatId && state.current?.chatId === chatId ? state.current : null));

  useEffect(() => {
    sceneSoundPlayer.setVolumes(ambientVolume, effectsVolume);
  }, [ambientVolume, effectsVolume]);

  // Leaving the chat or turning scene sound off fades everything out.
  useEffect(() => {
    if (!active) return;
    return () => sceneSoundPlayer.stop();
  }, [active, chatId]);

  // Right after a chat switch the transcript can still hold the previous chat's messages; they count as not loaded.
  const messagesLoaded = messages !== undefined && messages.every((message) => message.chatId === chatId);
  const replies = useMemo(() => (messagesLoaded ? (messages ?? []).filter(isReply) : []), [messages, messagesLoaded]);
  const recentReplies = useMemo(
    () => replies.slice(-AMBIENT_REPLY_WINDOW).map((message) => message.content ?? ""),
    [replies],
  );
  const repliesKey = recentReplies.join("\u0000");
  const location = tracker?.location ?? null;
  const weather = tracker?.weather ?? null;
  const time = tracker?.time ?? null;
  // Read inside effects that key on repliesKey/latestKey, so a re-render with the same text never re-runs them.
  const latest = useRef({ recentReplies, replies });
  latest.current = { recentReplies, replies };

  const ambientRef = useRef<{ chatId: string | null; id: SceneAmbientId | null }>({ chatId: null, id: null });
  useEffect(() => {
    if (!active || isStreaming || !messagesLoaded) return;
    const current = ambientRef.current.chatId === chatId ? ambientRef.current.id : null;
    const next = pickSceneAmbient(
      { tracker: { location, weather, time }, sceneText, recentReplies: latest.current.recentReplies },
      current,
    );
    ambientRef.current = { chatId, id: next };
    if (!next) {
      sceneSoundPlayer.setAmbient(null);
      return;
    }
    const sound = sceneAmbientSound(next);
    sceneSoundPlayer.setAmbient({
      id: sound.id,
      description: sound.description,
      durationSeconds: SCENE_AMBIENT_CLIP_SECONDS,
    });
  }, [active, chatId, isStreaming, messagesLoaded, location, weather, time, sceneText, repliesKey]);

  // One effect per new reply (or new swipe). Replies already in the chat when it opens play nothing.
  const latestReply = replies.at(-1);
  const latestKey = latestReply ? replyKey(latestReply) : null;
  const seenRef = useRef<{ chatId: string | null; keys: Set<string> | null }>({ chatId: null, keys: null });
  const lastEffectRef = useRef<string | null>(null);
  useEffect(() => {
    if (seenRef.current.chatId !== chatId) {
      seenRef.current = { chatId, keys: null };
      lastEffectRef.current = null;
    }
    if (!messagesLoaded || isStreaming) return;
    const seen = seenRef.current;
    if (!seen.keys) {
      seen.keys = new Set(latest.current.replies.map(replyKey));
      return;
    }
    if (!latestKey || seen.keys.has(latestKey)) return;
    seen.keys.add(latestKey);
    const reply = latest.current.replies.at(-1);
    if (!active || !reply?.content) return;
    const effect = pickReplySoundEffect(reply.content, lastEffectRef.current);
    if (!effect) return;
    lastEffectRef.current = effect.id;
    sceneSoundPlayer.playEffect(effect);
  }, [active, chatId, isStreaming, latestKey, messagesLoaded]);
}
