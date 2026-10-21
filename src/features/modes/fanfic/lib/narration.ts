// ──────────────────────────────────────────────
// Fanfic narration: chapters → voice parts
// ──────────────────────────────────────────────
import type { TTSConfig } from "../../../../engine/contracts/types/tts";
import { stripFanficChapterHeading } from "../../../../engine/modes/fanfic/prompts";
import {
  hashTTSCacheKey,
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

/**
 * How delivery cues like "(softly)" reach the voice:
 * - "inline": ElevenLabs v3 acts out bracketed audio tags, so each cue becomes "[softly]" where it was written.
 * - "tone": providers that take a tone get the line's opening cue as one; cues later in the line are dropped.
 * - "drop": older ElevenLabs models would read a tag out loud, so cues are left out.
 */
export type FanficCueStyle = "inline" | "tone" | "drop";

export function fanficCueStyle(config: Pick<TTSConfig, "source" | "model">): FanficCueStyle {
  if (config.source !== "elevenlabs") return "tone";
  return /v3/i.test(config.model ?? "") ? "inline" : "drop";
}

/**
 * A paragraph that is only a bracketed production note, like "[SFX: Rain on a window.]" or "[END OF AUDIO]".
 * Sound cues are played instead when sound effects are on (see fanficSoundEffect).
 */
const SCRIPT_NOTE_BLOCK = /^\[[^\]]*\]$/;
/**
 * A labelled note written inside a line, like "[SFX: a door]" or "[Sound effect: rain]". Bare capitals like "[OPEN]"
 * stay, since prose uses them for signs and redactions.
 */
const SCRIPT_NOTE_INLINE = /\[\s*[A-Z][A-Za-z0-9 &'-]*:[^\]]*\]/g;
/**
 * A script speaker label at the start of a paragraph: "**PIERROT:**", "**Pierrot**:", or a plain all-capitals
 * "PIERROT:" / "PIERROT (softly):". Plain mixed-case "Word:" is left alone, since prose starts sentences that way.
 */
const SPEAKER_LABEL =
  /^\s*(?:\*\*[^*\n:]{1,40}:\*\*|\*\*[^*\n:]{1,40}\*\*\s*:|[A-Z][A-Z0-9'. -]{1,30}?(?:\s*\([^)\n]{1,60}\))?\s*:)\s*/;
/** A parenthetical delivery cue inside a speaker's line, like "(softly)" or "(a pause)". */
const DELIVERY_CUE = /\(([^()\n]{1,60})\)/g;
/** A paragraph that is only a short lowercase cue, like "(a pause)" or "(softly)". */
const CUE_ONLY_BLOCK = /^\(\s*[a-z][^()\n]{0,60}\)$/;
/** A paragraph wrapped whole in brackets, like "(You cross the apartment. The door opens.)". */
const WHOLE_PARENTHETICAL = /^\([\s\S]*\)$/;

/**
 * Whether a chapter is written as an audio script rather than prose: it has a bracketed production note paragraph
 * ("[SFX: …]") or at least two speaker-labelled lines. One stray "NOTE:" in prose doesn't make it a script.
 */
export function isFanficScriptChapter(blocks: readonly string[]): boolean {
  let labels = 0;
  for (const block of blocks) {
    const raw = block.trim();
    if (SCRIPT_NOTE_BLOCK.test(raw)) return true;
    if (SPEAKER_LABEL.test(raw) && ++labels >= 2) return true;
  }
  return false;
}

function cleanCue(cue: string): string {
  return cue
    .replace(/[[\]<>{}]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Reads one paragraph the way a listener should hear it when a fic is written as an audio script: production notes
 * and speaker labels are never spoken, delivery cues direct the voice instead of being read, and plain prose is
 * unchanged. Returns null for a paragraph with nothing to say.
 */
export function fanficScriptLine(
  block: string,
  cueStyle: FanficCueStyle,
  scriptChapter = false,
): { text: string; tone?: string } | null {
  const raw = block.trim();
  if (SCRIPT_NOTE_BLOCK.test(raw)) return null;

  const withoutNotes = raw.replace(SCRIPT_NOTE_INLINE, " ");
  const label = withoutNotes.match(SPEAKER_LABEL);
  if (!label) {
    const prose = fanficNarrationText(withoutNotes);
    // A cue with no words to act on has nothing to say.
    if (CUE_ONLY_BLOCK.test(prose)) return null;
    // In a script, a whole parenthesised paragraph is a stage direction for the listener, not a line. In prose it can
    // be an aside that belongs to the story, so it's read there.
    if (scriptChapter && WHOLE_PARENTHETICAL.test(prose)) return null;
    const text = prose.replace(/^\((.*)\)$/, "$1").trim();
    return text ? { text } : null;
  }

  // A cue written inside the label ("PIERROT (softly):") is the line's opening cue.
  const labelCue = label[0].match(/\(([^)]*)\)/)?.[1];
  let line = fanficNarrationText(withoutNotes.slice(label[0].length));
  let tone: string | undefined;
  const opening = labelCue ?? line.match(/^\(([^()]{1,60})\)/)?.[1];
  if (labelCue === undefined && opening !== undefined) line = line.replace(/^\([^()]*\)\s*/, "");

  if (cueStyle === "inline") {
    line = line.replace(DELIVERY_CUE, (_match, cue: string) => {
      const clean = cleanCue(cue);
      return clean ? ` [${clean}] ` : " ";
    });
    const openingCue = opening ? cleanCue(opening) : "";
    if (openingCue) line = `[${openingCue}] ${line}`;
  } else {
    line = line.replace(DELIVERY_CUE, " ");
    if (cueStyle === "tone" && opening) tone = cleanCue(opening) || undefined;
  }

  const text = line.replace(/\s+/g, " ").trim();
  if (!text || /^(?:\[[^\]]*\]\s*)+$/.test(text)) return null;
  return tone ? { text, tone } : { text };
}

/** A paragraph that is only a sound cue, like "[SFX: Rain on a window.]": its description, or null. */
export function fanficSoundEffect(block: string): string | null {
  const match = block.trim().match(/^\[\s*(?:SFX|FX|SOUND(?:\s+EFFECTS?)?)\s*:\s*([^\]]+)\]$/i);
  const description = match?.[1]?.replace(/\s+/g, " ").trim();
  return description || null;
}

/** Whether "[SFX: …]" paragraphs are played as sounds with these settings. */
export function fanficSoundEffectsOn(config: Pick<TTSConfig, "source" | "baseUrl" | "fanficSoundEffects">): boolean {
  return (
    config.source === "elevenlabs" &&
    config.fanficSoundEffects &&
    !(config.baseUrl ?? "").toLowerCase().includes("nano-gpt.com")
  );
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
  /** Characters of speech, which is what the provider bills. */
  characters: number;
  /** Sound effects in the plan; each one is generated once, then replayed from the cache. */
  soundEffects: number;
  /** Set when the plan cannot be read aloud with the current voice settings. */
  problem: string | null;
}

/**
 * Reads every chapter in one narrator voice, like an audiobook: the chapter heading first,
 * then each paragraph split into provider-sized parts. Scene breaks become silence, and audio-script markup
 * (speaker labels, production notes, delivery cues) is handled by fanficScriptLine instead of read out.
 */
export function buildFanficNarration(chapters: FanficNarrationChapter[], config: TTSConfig): FanficNarrationPlan {
  const voice = resolveTTSNarratorVoice(config);
  if (config.source === "elevenlabs" && !voice) {
    return {
      parts: [],
      characters: 0,
      soundEffects: 0,
      problem: "Pick an ElevenLabs voice under Connections → Text to Speech first.",
    };
  }

  const cueStyle = fanficCueStyle(config);
  const soundEffectsOn = fanficSoundEffectsOn(config);
  const parts: FanficNarrationPart[] = [];
  for (const chapter of chapters) {
    const pieces: Array<{ text: string; block: number | null; tone?: string; sound?: true }> = [
      { text: `${chapter.heading}.`, block: null },
    ];
    const blocks = fanficProseBlocks(chapter.content);
    const scriptChapter = isFanficScriptChapter(blocks);
    blocks.forEach((block, index) => {
      if (FANFIC_SCENE_BREAK.test(block)) return;
      const sound = soundEffectsOn ? fanficSoundEffect(block) : null;
      if (sound) {
        pieces.push({ text: sound, block: index, sound: true });
        return;
      }
      const line = fanficScriptLine(block, cueStyle, scriptChapter);
      if (!line) return;
      splitTTSChunks(line.text).forEach((text, chunk) => {
        // A delivery cue belongs to the start of the line, so only its first part carries it.
        pieces.push({ text, block: index, ...(line.tone && chunk === 0 ? { tone: line.tone } : {}) });
      });
    });
    const speech = pieces.filter((piece) => !piece.sound);
    const cached = withTTSVoiceRequestCacheKeys(
      speech.map(({ text, tone }) => ({ text, speaker: "Narrator", voice, ...(tone ? { tone } : {}) })),
      config,
      `fanfic:${chapter.messageId}`,
    );
    let next = 0;
    for (const piece of pieces) {
      const request: CachedTTSVoiceRequest = piece.sound
        ? {
            text: piece.text,
            speaker: "Sound effect",
            kind: "sound_effect",
            // Keyed by the description alone, so the same sound anywhere in any fic is made once and voice changes
            // don't pay for it again.
            cacheKey: `fanfic-sfx-v1:${hashTTSCacheKey(piece.text.toLowerCase())}`,
          }
        : cached[next++]!;
      parts.push({ ...request, chapterNumber: chapter.number, block: piece.block });
    }
  }

  const speechParts = parts.filter((part) => part.kind !== "sound_effect");
  const characters = speechParts.reduce((sum, part) => sum + part.text.length, 0);
  return {
    parts,
    characters,
    soundEffects: parts.length - speechParts.length,
    problem: parts.length === 0 ? "There is nothing to read yet." : null,
  };
}
