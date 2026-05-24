import { useEffect, useRef } from "react";
import { useTTSConfig } from "../../../../../shared/hooks/use-tts";
import {
  buildTTSMessageText,
  clientSidePlaybackRate,
  resolveTTSVoiceForSpeaker,
} from "../../../../../shared/lib/tts-dialogue";
import { ttsService } from "../../../../../shared/lib/tts-service";
import type { CharacterMap, MessageWithSwipes } from "../types";

type ChatTtsAutoplayMode = "conversation" | "roleplay" | "visual_novel";

type UseChatTtsAutoplayOptions = {
  mode: ChatTtsAutoplayMode;
  messages: MessageWithSwipes[] | undefined;
  characterMap: CharacterMap;
  isStreaming: boolean;
};

export function useChatTtsAutoplay({ mode, messages, characterMap, isStreaming }: UseChatTtsAutoplayOptions) {
  const { data: ttsConfig } = useTTSConfig();
  const ttsConfigRef = useRef(ttsConfig);
  ttsConfigRef.current = ttsConfig;
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const prevIsStreamingRef = useRef(false);

  useEffect(() => {
    const wasStreaming = prevIsStreamingRef.current;
    prevIsStreamingRef.current = isStreaming;
    if (!wasStreaming || isStreaming) return;

    const config = ttsConfigRef.current;
    if (!config?.enabled) return;

    const currentMode = modeRef.current;
    const shouldAutoplay =
      currentMode === "roleplay" || currentMode === "visual_novel" ? config.autoplayRP : config.autoplayConvo;
    if (!shouldAutoplay) return;

    const messageList = messagesRef.current ?? [];
    let lastMessage: (typeof messageList)[number] | undefined;
    for (let index = messageList.length - 1; index >= 0; index -= 1) {
      const candidate = messageList[index];
      if (candidate.role === "assistant" || candidate.role === "narrator") {
        lastMessage = candidate;
        break;
      }
    }
    if (!lastMessage?.content) return;

    const fallbackSpeaker = lastMessage.characterId ? characterMap.get(lastMessage.characterId)?.name : undefined;
    const text = buildTTSMessageText(lastMessage.content, config, fallbackSpeaker);
    if (!text) return;
    const voice = resolveTTSVoiceForSpeaker(config, fallbackSpeaker, lastMessage.characterId);
    if (config.source === "elevenlabs" && !voice) return;

    void ttsService.speak(text, lastMessage.id, {
      speaker: fallbackSpeaker,
      voice,
      playbackRate: clientSidePlaybackRate(config),
    });
  }, [characterMap, isStreaming]);
}
