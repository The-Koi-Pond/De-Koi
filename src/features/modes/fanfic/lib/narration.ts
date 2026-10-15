// ──────────────────────────────────────────────
// Fanfic narration: chapters → voice parts
// ──────────────────────────────────────────────
import type { TTSConfig } from "../../../../engine/contracts/types/tts";
import { stripFanficChapterHeading } from "../../../../engine/modes/fanfic/prompts";
import {
  resolveTTSNarratorVoice,
  splitTTSChunks,
  withTTSVoiceRequestCacheKeys,
  type CachedTTSVoiceRequest,
} from "../../../../shared/lib/tts-dialogue";

export const FANFIC_SCENE_BREAK = /^(?:(?:\*\s*){3,}|-{3,}|_{3,}|~{3,}|#{1,6}|⁂)$/;

/** The paragraphs the reader renders for a chapter, in order. Narration parts point at these by index. */
export function fanficProseBlocks(text: string): string[] {
  return stripFanficChapterHeading(text)
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter(Boolean);
}

/** Drops the markdown markers the reader turns into emphasis, so the voice never reads them out. */
export function fanficNarrationText(block: string): string {
  return block
    .replace(/(\*{1,3}|_{1,3}|~~)(?=\S)([\s\S]*?\S)\1/g, "$2")
    .replace(/[*_~`]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export interface FanficNarrationChapter {
  messageId: string;
  number: number;
  heading: string;
  content: string;
}

export interface FanficNarrationPart extends CachedTTSVoiceRequest {
  chapterNumber: number;
  /** Index into fanficProseBlocks for the chapter, or null for the spoken chapter heading. */
  block: number | null;
}

export interface FanficNarrationPlan {
  parts: FanficNarrationPart[];
  characters: number;
  /** Set when the plan cannot be read aloud with the current voice settings. */
  problem: string | null;
}

/**
 * Reads every chapter in one narrator voice, like an audiobook: the chapter heading first,
 * then each paragraph split into provider-sized parts. Scene breaks become silence.
 */
export function buildFanficNarration(chapters: FanficNarrationChapter[], config: TTSConfig): FanficNarrationPlan {
  const voice = resolveTTSNarratorVoice(config);
  if (config.source === "elevenlabs" && !voice) {
    return { parts: [], characters: 0, problem: "Pick an ElevenLabs voice under Connections → Text to Speech first." };
  }

  const parts: FanficNarrationPart[] = [];
  for (const chapter of chapters) {
    const pieces: Array<{ text: string; block: number | null }> = [{ text: `${chapter.heading}.`, block: null }];
    fanficProseBlocks(chapter.content).forEach((block, index) => {
      if (FANFIC_SCENE_BREAK.test(block)) return;
      for (const text of splitTTSChunks(fanficNarrationText(block))) pieces.push({ text, block: index });
    });
    const cached = withTTSVoiceRequestCacheKeys(
      pieces.map(({ text }) => ({ text, speaker: "Narrator", voice })),
      config,
      `fanfic:${chapter.messageId}`,
    );
    cached.forEach((request, index) => {
      parts.push({ ...request, chapterNumber: chapter.number, block: pieces[index]!.block });
    });
  }

  const characters = parts.reduce((sum, part) => sum + part.text.length, 0);
  return { parts, characters, problem: parts.length === 0 ? "There is nothing to read yet." : null };
}
