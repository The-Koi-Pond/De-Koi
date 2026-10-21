// ──────────────────────────────────────────────
// Hook: read a fic aloud with the configured voice
// ──────────────────────────────────────────────
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { toUserMessage } from "../../../../shared/lib/error-message";
import { useTTSConfig } from "../../../../shared/hooks/use-tts";
import { clientSidePlaybackRate } from "../../../../shared/lib/tts-dialogue";
import { ttsService } from "../../../../shared/lib/tts-service";
import type { FanficNarrationPart } from "../lib/narration";

export type FanficNarrationStatus = "idle" | "loading" | "playing" | "paused";

/** Parts fetched ahead of the one playing, so paragraphs follow each other without a pause. */
const NARRATION_LOOKAHEAD = 2;

export function useFanficNarration(chatId: string) {
  const { data: config } = useTTSConfig();
  const activeId = `fanfic-narration:${chatId}`;
  const [serviceState, setServiceState] = useState(() => ({
    state: ttsService.getState(),
    activeId: ttsService.getActiveId(),
  }));
  const [parts, setParts] = useState<FanficNarrationPart[]>([]);
  const [label, setLabel] = useState("");
  const [partIndex, setPartIndex] = useState<number | null>(null);

  useEffect(
    () =>
      ttsService.subscribe((state, id) => {
        setServiceState({ state, activeId: id });
      }),
    [],
  );

  const mine = serviceState.activeId === activeId;
  const status: FanficNarrationStatus =
    mine && (serviceState.state === "loading" || serviceState.state === "playing" || serviceState.state === "paused")
      ? serviceState.state
      : "idle";

  useEffect(() => {
    if (status === "idle") setPartIndex(null);
  }, [status]);

  // Leaving the fic stops its narration; other speech in the app is left alone.
  useEffect(
    () => () => {
      if (ttsService.getActiveId() === activeId) ttsService.stop();
    },
    [activeId],
  );

  const play = useCallback(
    (nextParts: FanficNarrationPart[], nextLabel: string) => {
      if (!config || nextParts.length === 0) return;
      setParts(nextParts);
      setLabel(nextLabel);
      setPartIndex(null);
      ttsService
        .speakSequence(nextParts, activeId, {
          lookahead: NARRATION_LOOKAHEAD,
          playbackRate: clientSidePlaybackRate(config),
          throwOnError: true,
          onPartStart: setPartIndex,
        })
        .catch((error: unknown) => {
          toast.error(`Narration stopped. ${toUserMessage(error, { fallback: "Press play to try again." })}`);
        });
    },
    [activeId, config],
  );

  const stop = useCallback(() => {
    if (ttsService.getActiveId() === activeId) ttsService.stop();
  }, [activeId]);

  return {
    config: config?.enabled ? config : null,
    status,
    currentPart: partIndex === null ? null : (parts[partIndex] ?? null),
    partIndex,
    partCount: parts.length,
    /** What is being read, e.g. "chapter 2", fixed when playback starts. */
    label,
    play,
    pause: () => ttsService.pause(),
    resume: () => ttsService.resume(),
    stop,
  };
}
