import { useCallback, useEffect, useMemo, useState } from "react";
import { useCachedTTSConfig } from "../../../../../shared/hooks/use-tts";
import { ttsService } from "../../../../../shared/lib/tts-service";
import {
  buildTTSVoiceRequests,
  clientSidePlaybackRate,
  withTTSVoiceRequestCacheKeys,
} from "../../../../../shared/lib/tts-dialogue";
import { isStreamingTTSActive, stopStreamingTTS, subscribeStreamingTTSActive } from "./use-streaming-tts";

export interface MessageSpeech {
  /** Text to Speech is turned on in Connections. */
  enabled: boolean;
  /** The message has something to read (with "Only read dialogues", narration alone has nothing). */
  hasContent: boolean;
  /** Another message is loading, playing or paused. */
  busy: boolean;
  speakingThis: boolean;
  loadingThis: boolean;
  pausedThis: boolean;
  /** A reply is being read aloud as it streams in; the speak button stops it. */
  streamingActive: boolean;
  /** Starts reading this message, or stops it (or the streaming read-aloud) if it is playing. */
  toggle: () => void;
  pauseOrResume: () => void;
  restart: () => void;
}

/** Read-aloud state and controls for one chat message, shared by Roleplay and Conversation. */
export function useMessageSpeech({
  messageId,
  content,
  characterId,
  speakerName,
}: {
  messageId: string;
  content: string;
  characterId?: string | null;
  speakerName?: string;
}): MessageSpeech {
  const { data: ttsConfig } = useCachedTTSConfig();
  const voiceRequests = useMemo(
    () =>
      ttsConfig
        ? withTTSVoiceRequestCacheKeys(
            buildTTSVoiceRequests(content, ttsConfig, speakerName, characterId).filter((request) =>
              request.text.trim(),
            ),
            ttsConfig,
            messageId,
          )
        : [],
    [characterId, content, messageId, speakerName, ttsConfig],
  );
  const hasContent = voiceRequests.length > 0;
  const [state, setState] = useState(ttsService.getState());
  const [activeId, setActiveId] = useState<string | null>(ttsService.getActiveId());
  useEffect(
    () =>
      ttsService.subscribe((nextState, id) => {
        setState(nextState);
        setActiveId(id);
      }),
    [],
  );
  const [streamingActive, setStreamingActive] = useState<boolean>(() => isStreamingTTSActive());
  useEffect(() => subscribeStreamingTTSActive(setStreamingActive), []);

  const toggle = useCallback(() => {
    if (isStreamingTTSActive()) {
      stopStreamingTTS();
      return;
    }
    // Read directly from the singleton so we never act on stale React state
    const liveState = ttsService.getState();
    const liveIsThis = ttsService.getActiveId() === messageId;
    const liveBusy = liveState === "loading" || liveState === "playing" || liveState === "paused";
    if (liveBusy && !liveIsThis) return;
    if (liveIsThis) {
      ttsService.stop();
    } else {
      if (!hasContent) return;
      void ttsService.speakSequence(voiceRequests, messageId, {
        playbackRate: clientSidePlaybackRate(ttsConfig),
      });
    }
  }, [hasContent, messageId, ttsConfig, voiceRequests]);

  const pauseOrResume = useCallback(() => {
    if (ttsService.getActiveId() !== messageId) return;
    if (ttsService.getState() === "paused") {
      ttsService.resume();
    } else {
      ttsService.pause();
    }
  }, [messageId]);

  const restart = useCallback(() => {
    if (ttsService.getActiveId() === messageId) {
      ttsService.restart();
    }
  }, [messageId]);

  const speakingThis = activeId === messageId;
  return {
    enabled: ttsConfig?.enabled ?? false,
    hasContent,
    busy: state === "loading" || state === "playing" || state === "paused",
    speakingThis,
    loadingThis: speakingThis && state === "loading",
    pausedThis: speakingThis && state === "paused",
    streamingActive,
    toggle,
    pauseOrResume,
    restart,
  };
}
