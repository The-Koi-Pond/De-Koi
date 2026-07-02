export interface MusicDjIntent {
  mood?: string | null;
  intensity?: string | null;
  setting?: string | null;
  constraints?: string[] | null;
  reason?: string | null;
}

export function musicDjIntentLabel(intent: MusicDjIntent | null | undefined, fallback = "scene music"): string {
  if (!intent) return fallback;
  const parts = [intent.mood, intent.setting].map((part) => part?.trim()).filter((part): part is string => !!part);
  return parts.length > 0 ? parts.join(" - ") : fallback;
}