import type { GameNpc } from "../../../../engine/contracts/types/game";
import type { TTSConfig } from "../../../../engine/contracts/types/tts";
import { getOrCreateCachedTTSAudioBlob } from "../../../../shared/lib/tts-audio-cache";
import {
  resolveTTSVoiceForSpeaker,
  splitTTSChunks,
  ttsConfigMatchesSpeaker,
} from "../../../../shared/lib/tts-dialogue";
import { ttsService } from "../../../../shared/lib/tts-service";
import type { GameSideLine, NarrationSegment } from "./game-narration-segments";

export type GameSegmentVoiceEntry =
  | { status: "loading"; speaker?: string; tone?: string; voice?: string; chunks: string[] }
  | { status: "ready"; speaker?: string; tone?: string; voice?: string; chunks: string[]; urls: string[] }
  | { status: "error"; speaker?: string; tone?: string; voice?: string; chunks: string[] };

export interface GameSegmentVoiceRequest {
  speaker?: string;
  tone?: string;
  voice?: string;
  chunks: string[];
}

interface GameVoiceAudioJob {
  cacheKey: string;
  textCacheKey: string;
  chunk: string;
  speaker?: string;
  tone?: string;
  voice?: string;
}

export interface GameVoiceEntryPlan {
  key: string;
  audioJobs: GameVoiceAudioJob[];
  controller: AbortController;
}

type GameSegmentVoiceOptions = {
  playerSpeakerNames?: ReadonlySet<string>;
};

const GAME_TTS_EMOTIONS = [
  "neutral",
  "happy",
  "sad",
  "angry",
  "surprised",
  "scared",
  "disgusted",
  "thinking",
  "laughing",
  "crying",
  "blushing",
  "smirk",
  "embarrassed",
  "determined",
  "confused",
  "sleepy",
] as const;

type GameTtsEmotion = (typeof GAME_TTS_EMOTIONS)[number];

const GAME_TTS_EMOTION_SET = new Set<string>(GAME_TTS_EMOTIONS);

const GAME_TTS_EMOTION_ALIASES: Record<string, GameTtsEmotion> = {
  afraid: "scared",
  anger: "angry",
  amused: "laughing",
  blush: "blushing",
  confused_look: "confused",
  confusion: "confused",
  cry: "crying",
  determined_look: "determined",
  disgust: "disgusted",
  drowsy: "sleepy",
  embarrassed_smile: "embarrassed",
  fear: "scared",
  fearful: "scared",
  flustered: "blushing",
  focused: "determined",
  grin: "happy",
  joyful: "happy",
  laugh: "laughing",
  nervous: "scared",
  pensive: "thinking",
  puzzled: "confused",
  sad_look: "sad",
  sadness: "sad",
  serious: "determined",
  shocked: "surprised",
  shy: "blushing",
  sleep: "sleepy",
  sleepy_eyes: "sleepy",
  smile: "happy",
  smirking: "smirk",
  sobbing: "crying",
  startled: "surprised",
  surprise: "surprised",
  think: "thinking",
  tired: "sleepy",
  worried: "scared",
};

const GAME_TTS_CHUNK_ATTEMPTS = 2;

function normalizeSpriteExpressionKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^full_/, "")
    .replace(/[_\s-]+/g, "_");
}

function normalizeGameTtsEmotion(value?: string | null): GameTtsEmotion | null {
  const normalized = value ? normalizeSpriteExpressionKey(value) : "";
  if (!normalized) return null;
  if (GAME_TTS_EMOTION_SET.has(normalized)) return normalized as GameTtsEmotion;
  if (GAME_TTS_EMOTION_ALIASES[normalized]) return GAME_TTS_EMOTION_ALIASES[normalized];

  const parts = normalized.split("_").filter(Boolean);
  for (const part of parts) {
    if (GAME_TTS_EMOTION_SET.has(part)) return part as GameTtsEmotion;
    if (GAME_TTS_EMOTION_ALIASES[part]) return GAME_TTS_EMOTION_ALIASES[part];
  }

  return null;
}

function resolveGameSegmentTtsEmotion(segment: NarrationSegment): GameTtsEmotion {
  return normalizeGameTtsEmotion(segment.sprite) ?? (segment.partyType === "thought" ? "thinking" : "neutral");
}

function hashVoiceKey(value: string): string {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash << 5) - hash + value.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

export function buildVoiceConfigSignature(config?: TTSConfig | null): string {
  if (!config) return "tts:none";
  return [
    config.source,
    config.baseUrl,
    config.model,
    config.voice,
    config.voiceMode,
    JSON.stringify(config.voiceAssignments ?? []),
    config.npcDefaultVoicesEnabled ? "npc-defaults" : "npc-global",
    JSON.stringify(config.npcDefaultMaleVoices ?? []),
    JSON.stringify(config.npcDefaultFemaleVoices ?? []),
    config.speed,
    config.elevenLabsStability,
    config.elevenLabsLanguageCode,
    config.dialogueOnly ? "dialogue" : "all-text",
    config.dialogueScope,
    config.dialogueCharacterName,
  ].join("|");
}

function buildVoiceLineTextCacheKey(
  config: TTSConfig,
  job: Omit<GameVoiceAudioJob, "cacheKey" | "textCacheKey">,
): string {
  const rawKey = [
    config.source,
    config.baseUrl,
    config.model,
    config.speed,
    config.elevenLabsStability,
    config.elevenLabsLanguageCode,
    job.voice ?? "",
    job.speaker ?? "",
    job.tone ?? "",
    job.chunk,
  ].join("\n");
  return `game-voice-line-v1:${rawKey.length}:${hashVoiceKey(rawKey)}`;
}

function buildVoiceLineSegmentCacheKey(segmentVoiceKey: string, jobIndex: number, textCacheKey: string): string {
  return `game-voice-line-v3:${segmentVoiceKey}:${jobIndex}:${hashVoiceKey(textCacheKey)}`;
}

function buildGameVoiceAudioJobs(
  key: string,
  requests: GameSegmentVoiceRequest[],
  config: TTSConfig,
): GameVoiceAudioJob[] {
  let voiceJobIndex = 0;
  return requests.flatMap((request) =>
    request.chunks.map((chunk) => {
      const jobIndex = voiceJobIndex;
      voiceJobIndex += 1;
      const job = {
        chunk,
        speaker: request.speaker,
        tone: request.tone,
        voice: request.voice,
      };
      const textCacheKey = buildVoiceLineTextCacheKey(config, job);
      return {
        ...job,
        cacheKey: buildVoiceLineSegmentCacheKey(key, jobIndex, textCacheKey),
        textCacheKey,
      };
    }),
  );
}

function waitForGameTTSRetry(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("TTS request aborted", "AbortError"));
      return;
    }
    const timeout = window.setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        window.clearTimeout(timeout);
        reject(new DOMException("TTS request aborted", "AbortError"));
      },
      { once: true },
    );
  });
}

async function generateGameVoiceJobBlob(job: GameVoiceAudioJob, controller: AbortController): Promise<Blob> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= GAME_TTS_CHUNK_ATTEMPTS; attempt += 1) {
    if (controller.signal.aborted) throw new DOMException("TTS request aborted", "AbortError");
    try {
      return await getOrCreateCachedTTSAudioBlob(
        job.cacheKey,
        () =>
          ttsService.generateAudio(job.chunk, {
            speaker: job.speaker,
            tone: job.tone,
            voice: job.voice,
            signal: controller.signal,
          }),
        [job.textCacheKey],
      );
    } catch (err) {
      if (controller.signal.aborted || (err instanceof Error && err.name === "AbortError")) throw err;
      lastError = err;
      if (attempt < GAME_TTS_CHUNK_ATTEMPTS) {
        await waitForGameTTSRetry(350 * attempt, controller.signal);
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error("TTS request failed");
}

function findNpcVoiceHint(speaker: string | null | undefined, gameNpcs: GameNpc[]) {
  const speakerName = speaker?.trim();
  if (!speakerName) return null;
  const normalizedSpeaker = speakerName.toLowerCase();
  const npc = gameNpcs.find((candidate) => candidate.name.trim().toLowerCase() === normalizedSpeaker);
  if (!npc) return { name: speakerName };
  return { name: npc.name, description: npc.description, gender: npc.gender, pronouns: npc.pronouns, notes: npc.notes };
}

function normalizeGameVoiceSpeakerName(value: string | null | undefined): string {
  return value?.trim().toLowerCase().replace(/\s+/g, " ") ?? "";
}

export function getGameVoicePlayerSpeakerNames(personaName: string | undefined): Set<string> {
  const names = new Set(["you", "player", "player character", "playername", "player name", "protagonist", "pc"]);
  const normalizedPersonaName = normalizeGameVoiceSpeakerName(personaName);
  if (normalizedPersonaName) names.add(normalizedPersonaName);
  return names;
}

function isGameVoicePlayerSpeaker(
  speaker: string | null | undefined,
  playerSpeakerNames: ReadonlySet<string> | undefined,
): boolean {
  const normalizedSpeaker = normalizeGameVoiceSpeakerName(speaker);
  return Boolean(normalizedSpeaker && playerSpeakerNames?.has(normalizedSpeaker));
}

function isGameVoicePlayerTaggedNarration(
  content: string,
  playerSpeakerNames: ReadonlySet<string> | undefined,
): boolean {
  if (!playerSpeakerNames?.size) return false;
  const speakerMatch = content.match(/^\s*\[([^\]]+)\](?:\s*\[[^\]]+\])?/);
  if (!speakerMatch) return false;
  return isGameVoicePlayerSpeaker(speakerMatch[1], playerSpeakerNames);
}

function shouldSkipGameVoiceSegment(segment: NarrationSegment, options: GameSegmentVoiceOptions): boolean {
  if (segment.sourceRole === "user" || segment.sourceRole === "system") return true;
  if (segment.partyType === "thought") return true;
  if (isGameVoicePlayerSpeaker(segment.speaker, options.playerSpeakerNames)) return true;
  return segment.type === "narration" && isGameVoicePlayerTaggedNarration(segment.content, options.playerSpeakerNames);
}

export function getGameSegmentVoiceRequest(
  segment: NarrationSegment,
  config: TTSConfig,
  gameNpcs: GameNpc[] = [],
  options: GameSegmentVoiceOptions = {},
): GameSegmentVoiceRequest | null {
  if (shouldSkipGameVoiceSegment(segment, options)) return null;
  if (segment.type !== "dialogue" && segment.type !== "narration") return null;

  if (segment.type === "dialogue") {
    if (!ttsConfigMatchesSpeaker(config, segment.speaker)) return null;
    const chunks = splitTTSChunks(segment.content);
    if (chunks.length === 0) return null;
    const tone = resolveGameSegmentTtsEmotion(segment);
    const voice = resolveTTSVoiceForSpeaker(
      config,
      segment.speaker,
      undefined,
      findNpcVoiceHint(segment.speaker, gameNpcs),
    );
    if (config.source === "elevenlabs" && !voice) return null;
    return {
      chunks,
      speaker: segment.speaker,
      tone,
      voice,
    };
  }

  if (config.dialogueOnly) return null;
  const chunks = splitTTSChunks(segment.content);
  if (chunks.length === 0) return null;
  const voice = config.voice;
  if (config.source === "elevenlabs" && !voice) return null;
  return { chunks, voice };
}

export function getGameSegmentVoiceKeyForRequests(
  segment: NarrationSegment,
  configSignature: string,
  requests: GameSegmentVoiceRequest[],
): string | null {
  if (!segment.sourceMessageId || segment.sourceSegmentIndex == null || requests.length === 0) return null;
  return `${segment.sourceMessageId}:${segment.sourceSegmentIndex}:${hashVoiceKey(configSignature)}`;
}

export function getGameSideLineVoiceKeyForRequests(
  segment: NarrationSegment,
  line: GameSideLine,
  sideIndex: number,
  configSignature: string,
  requests: GameSegmentVoiceRequest[],
): string | null {
  if (requests.length === 0) return null;
  const sourceMessageId = line.voiceSourceMessageId ?? segment.sourceMessageId;
  const sourceSegmentIndex = line.voiceSourceSegmentIndex ?? segment.sourceSegmentIndex;
  if (!sourceMessageId || sourceSegmentIndex == null) return null;

  const suffix = line.voiceSourceSegmentIndex == null ? `:side:${sideIndex}` : "";
  return `${sourceMessageId}:${sourceSegmentIndex}${suffix}:${hashVoiceKey(configSignature)}`;
}

export function queueGameVoiceEntryPlan(args: {
  key: string | null;
  requests: GameSegmentVoiceRequest[];
  config: TTSConfig;
  cache: Map<string, GameSegmentVoiceEntry>;
  pending: Map<string, AbortController>;
}): GameVoiceEntryPlan | null {
  const { key, requests, config, cache, pending } = args;
  if (!key || cache.has(key) || pending.has(key)) return null;
  const audioJobs = buildGameVoiceAudioJobs(key, requests, config);
  if (audioJobs.length === 0) return null;

  const controller = new AbortController();
  pending.set(key, controller);
  cache.set(key, {
    status: "loading",
    chunks: audioJobs.map((job) => job.chunk),
    speaker: audioJobs[0]?.speaker,
    tone: audioJobs[0]?.tone,
    voice: audioJobs[0]?.voice,
  });
  return { key, audioJobs, controller };
}

export async function resolveGameVoiceEntryPlan(args: {
  plan: GameVoiceEntryPlan;
  cache: Map<string, GameSegmentVoiceEntry>;
  pending: Map<string, AbortController>;
  createObjectUrl?: (blob: Blob) => string;
  revokeObjectUrl?: (url: string) => void;
  onChunkError?: (jobIndex: number, audioJobCount: number, error: unknown) => void;
}): Promise<boolean> {
  const {
    plan: { key, audioJobs, controller },
    cache,
    pending,
    createObjectUrl = (blob) => URL.createObjectURL(blob),
    revokeObjectUrl = (url) => URL.revokeObjectURL(url),
    onChunkError,
  } = args;

  if (controller.signal.aborted) return false;

  const blobs: Blob[] = [];
  let failed = false;
  for (const [jobIndex, job] of audioJobs.entries()) {
    if (controller.signal.aborted) break;
    try {
      const blob = await generateGameVoiceJobBlob(job, controller);
      blobs.push(blob);
    } catch (err) {
      if (controller.signal.aborted || (err instanceof Error && err.name === "AbortError")) break;
      failed = true;
      onChunkError?.(jobIndex, audioJobs.length, err);
      break;
    }
  }

  try {
    if (controller.signal.aborted) return false;
    const urls = blobs.map((blob) => createObjectUrl(blob));
    if (!failed && urls.length === audioJobs.length) {
      cache.set(key, {
        status: "ready",
        chunks: audioJobs.map((job) => job.chunk),
        speaker: audioJobs[0]?.speaker,
        tone: audioJobs[0]?.tone,
        voice: audioJobs[0]?.voice,
        urls,
      });
    } else {
      for (const url of urls) revokeObjectUrl(url);
      cache.set(key, {
        status: "error",
        chunks: audioJobs.map((job) => job.chunk),
        speaker: audioJobs[0]?.speaker,
        tone: audioJobs[0]?.tone,
        voice: audioJobs[0]?.voice,
      });
    }
    return true;
  } finally {
    pending.delete(key);
  }
}
