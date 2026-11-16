import type { HomeSuggestionDestination } from "./home-suggestions";

export type HomeMode = "conversation" | "roleplay" | "fanfic" | "trance";

/*
 * What Deki says in their bubble on the Pond theme's Home screen, in
 * Deki-senpai's voice (helpful, playful, direct, a little proudly adorable).
 * While a mode card is hovered or focused, Deki explains that mode; otherwise
 * they point at the most useful next step, in the same order as Home's own
 * suggestions (server, then a model, then the library).
 */
const MODE_LINES: Record<HomeMode, string> = {
  conversation: "Conversation: chat with characters like you're texting them. Or with the model itself!",
  roleplay: "Roleplay: you play a part, the AI plays everyone else, and a story happens. My favourite!",
  fanfic: "Fanfic: pick the fandom, ships and tropes, then read your story chapter by chapter.",
  trance:
    "Trance: a hypnosis session in a character's voice. Pick the feel and length, then just read along, one line at a time.",
};

const NEXT_STEP_LINES: Record<HomeSuggestionDestination, string> = {
  "server-setup": "First, connect me to your De-Koi server. Then the fun can start!",
  "connect-model": "Connect a model first, so characters can talk back. Then pick a mode below!",
  "library-import": "Got characters somewhere? Import your library, or just pick a mode below!",
  discover: "What are we doing today? Point at a mode and I'll tell you about it!",
};

/** Deki's explanation of one mode (also the mode choice's screen-reader description). */
export function getDekiModeLine(mode: HomeMode): string {
  return MODE_LINES[mode];
}

/** Short labels for the setup step's button in Deki's dialogue box. */
export const SETUP_STEP_ACTION_LABELS: Record<Exclude<HomeSuggestionDestination, "discover">, string> = {
  "server-setup": "Set up the server",
  "connect-model": "Connect a model",
  "library-import": "Import a library",
};

export function getDekiHomeLine({
  activeMode,
  nextStep,
}: {
  activeMode: HomeMode | null;
  nextStep: HomeSuggestionDestination | undefined;
}): string {
  if (activeMode) return getDekiModeLine(activeMode);
  return NEXT_STEP_LINES[nextStep ?? "discover"];
}
