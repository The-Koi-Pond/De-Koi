import type { ModelRouteTask } from "./model-routing";

/**
 * "Use a cheaper model for background work": the helper jobs that move to a small model on a copy of the chosen
 * connection. Replies, fanfic chapters and the fanfic judge stay on the chat's own model. A measured long game ran
 * memory, recaps and the habit check on Haiku and still saved every planted fact.
 */
export const CHEAP_HELPER_TASKS: readonly ModelRouteTask[] = [
  "memory",
  "summaries",
  "habitCheck",
  "status",
  "schedules",
  "responder",
  "interpretations",
  "fanficPlanning",
  "fanficChecks",
];

/** Small current models by family, best first. Matched against the connection's own model list. */
const CHEAP_FAMILIES: readonly RegExp[] = [
  /claude[-_. ]?haiku/,
  /gemini[-_. ][\d.]+[-_. ]flash(?![-_. ]?(?:lite|image|tts|live|thinking))/,
  /gpt[-_. ][\d.]+[-_. ]?mini/,
];

// Variants a background helper should not land on: free tiers (shared daily cap), previews, audio and image models.
const UNSUITABLE = /:free\b|preview|audio|realtime|image|tts|vision|search|embed/;

function versionKey(id: string): number[] {
  return (id.match(/\d+(?:\.\d+)?/g) ?? []).map(Number);
}

function newerFirst(left: string, right: string): number {
  const a = versionKey(left);
  const b = versionKey(right);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const difference = (b[index] ?? 0) - (a[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return left.localeCompare(right);
}

/**
 * The cheap model to use for background work on a connection, picked from the models it lists: the newest Haiku,
 * then the newest Gemini Flash, then the newest GPT mini. Null when the connection lists none of them, or when its
 * own model already is one.
 */
export function pickCheapHelperModel(
  models: ReadonlyArray<{ id: string }>,
  currentModel: string | null | undefined,
): string | null {
  const current = (currentModel ?? "").toLowerCase();
  if (CHEAP_FAMILIES.some((family) => family.test(current))) return null;
  const ids = models.map((model) => model.id.trim()).filter(Boolean);
  for (const family of CHEAP_FAMILIES) {
    const matches = ids.filter((id) => family.test(id.toLowerCase()) && !UNSUITABLE.test(id.toLowerCase()));
    if (matches.length > 0) return [...matches].sort(newerFirst)[0]!;
  }
  return null;
}
