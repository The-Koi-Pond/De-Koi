/**
 * Picks at most one sound effect for a finished Roleplay reply, without a model call. A "[SFX: …]" line the reply
 * wrote itself comes first; otherwise the first clear event in the narration (a door slams, thunder cracks). Quoted
 * dialogue is ignored, and the effect that played last is never played again straight after.
 */
import { soundCueDescription } from "../../../shared/sound-cues";
import { SCENE_EFFECT_SOUNDS, type SceneSound } from "./scene-sound-catalog";

const QUOTED_DIALOGUE = /"[^"\n]*"|“[^”\n]*”/g;

/** The id a written cue plays under: the same description is the same sound. */
function soundCueEffectId(description: string): string {
  return `cue:${description.toLowerCase()}`;
}

export function pickReplySoundEffect(reply: string, lastEffectId: string | null): SceneSound | null {
  const lines = reply.split("\n");
  const narration: string[] = [];
  for (const line of lines) {
    const cue = soundCueDescription(line);
    if (!cue) {
      narration.push(line);
      continue;
    }
    const id = soundCueEffectId(cue);
    if (id !== lastEffectId) return { id, description: cue };
  }

  const text = narration.join("\n").replace(QUOTED_DIALOGUE, " ");
  const found = SCENE_EFFECT_SOUNDS.flatMap((effect) => {
    const index = text.search(effect.pattern);
    return index >= 0 && effect.id !== lastEffectId ? [{ index, effect }] : [];
  }).sort((a, b) => a.index - b.index);
  const first = found[0]?.effect;
  return first ? { id: first.id, description: first.description } : null;
}
