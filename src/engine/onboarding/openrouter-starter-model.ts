/**
 * The model a fresh "Log in with OpenRouter" connection starts on, so a first chat costs nothing.
 *
 * OpenRouter's free lineup changes often, so the picks are checked against the live model list.
 * Update the preference list when these leave OpenRouter; the router fallback keeps working meanwhile.
 */

/**
 * Named free models to fall back on when the router isn't listed, best first. Checked 2026-10-25 with a fresh
 * login: Gemma was rate-limited (429), Inkling only serves agentic apps (403), Nemotron returned 404. So these
 * come after the router.
 */
export const OPENROUTER_STARTER_MODEL_PREFERENCE = [
  "google/gemma-4-31b-it:free",
  "thinkingmachines/inkling:free",
  "nvidia/nemotron-3-super-120b-a12b:free",
] as const;

/** OpenRouter's own router across its free models. It sends each reply to a free model that is up, so it goes first. */
export const OPENROUTER_FREE_ROUTER_MODEL = "openrouter/free";

export interface StarterModelCandidate {
  id: string;
  name?: string | null;
  context?: number | null;
}

export interface StarterModelPick {
  id: string;
  name: string;
  context: number | null;
}

function pickFrom(candidate: StarterModelCandidate): StarterModelPick {
  const context = Number(candidate.context);
  return {
    id: candidate.id,
    name: candidate.name?.trim() || candidate.id,
    context: Number.isFinite(context) && context > 0 ? context : null,
  };
}

/**
 * Picks a free model from the models the account can see. Returns null when nothing free is listed, so the
 * caller leaves the model for the user to choose instead of guessing a paid one.
 */
export function pickOpenRouterStarterModel(models: readonly StarterModelCandidate[]): StarterModelPick | null {
  const byId = new Map(models.map((model) => [model.id, model]));
  const router = byId.get(OPENROUTER_FREE_ROUTER_MODEL);
  if (router) return pickFrom(router);
  for (const id of OPENROUTER_STARTER_MODEL_PREFERENCE) {
    const model = byId.get(id);
    if (model) return pickFrom(model);
  }
  const anyFree = models.find((model) => model.id.endsWith(":free"));
  return anyFree ? pickFrom(anyFree) : null;
}
