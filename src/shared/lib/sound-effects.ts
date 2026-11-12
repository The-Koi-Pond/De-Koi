// ──────────────────────────────────────────────
// Generated sound effects shared by Fanfic read-aloud and Roleplay scene sound
// ──────────────────────────────────────────────
import type { TTSConfig } from "../../engine/contracts/types/tts";
import { hashTTSCacheKey } from "./tts-dialogue";

/** Whether the Text to Speech provider can make sound effects (ElevenLabs, not through NanoGPT). */
export function soundEffectsProviderReady(config: Pick<TTSConfig, "source" | "baseUrl">): boolean {
  return config.source === "elevenlabs" && !(config.baseUrl ?? "").toLowerCase().includes("nano-gpt.com");
}

/** Why Roleplay scene sound can't run with these Text to Speech settings, or null when it can. */
export function sceneSoundUnavailableReason(config: Pick<TTSConfig, "source" | "baseUrl">): string | null {
  if (!soundEffectsProviderReady(config)) {
    return "Needs ElevenLabs as the Text to Speech provider and its API key (Settings > Text to Speech). Reading replies aloud can stay off.";
  }
  return null;
}

/**
 * Cache key for a generated sound: the description alone (plus a fixed length when one is asked for), so the same
 * sound in any fic or chat is made once and voice changes don't pay for it again.
 */
export function soundEffectCacheKey(description: string, durationSeconds?: number): string {
  const length = durationSeconds ? `:${durationSeconds}s` : "";
  return `sfx-v1:${hashTTSCacheKey(description.toLowerCase())}${length}`;
}

/** Fanfic's key from before the cache was shared, kept as an alias so sounds made then still replay free. */
export function legacyFanficSoundEffectCacheKey(description: string): string {
  return `fanfic-sfx-v1:${hashTTSCacheKey(description.toLowerCase())}`;
}

/** Whether a failed sound effect request came from an ElevenLabs key without the Sound Effects permission. */
export function isMissingSoundEffectsPermission(error: unknown): boolean {
  const raw = [
    error instanceof Error ? error.message : String(error),
    JSON.stringify((error as { details?: unknown } | null)?.details ?? null),
  ].join(" ");
  return /sound_generation|missing_permissions/i.test(raw);
}
