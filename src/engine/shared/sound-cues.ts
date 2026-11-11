/**
 * Sound cues written into story text, like "[SFX: Rain on a window.]". Fanfic read-aloud plays a cue paragraph as a
 * sound; Roleplay scene sound plays a cue line in a reply. Both read cues with this one rule.
 */

const SOUND_CUE = /^\[\s*(?:SFX|FX|SOUND(?:\s+EFFECTS?)?)\s*:\s*([^\]]+)\]$/i;

/** A paragraph or line that is only a sound cue: its description, or null. */
export function soundCueDescription(block: string): string | null {
  const match = block.trim().match(SOUND_CUE);
  const description = match?.[1]?.replace(/\s+/g, " ").trim();
  return description || null;
}
