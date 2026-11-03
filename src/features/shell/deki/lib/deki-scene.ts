/**
 * How Deki looks in the pond at the top of Deki-senpai's chat:
 * - idle: the slow mochi squish (also while the saved chat loads);
 * - thinking: waiting for Deki's answer, a slow sway with bubbles;
 * - happy: one quick hop right after an answer arrives.
 */
export type DekiSceneMood = "idle" | "thinking" | "happy";

/** How long the happy hop plays after an answer arrives (one hop). */
export const DEKI_HAPPY_HOP_MS = 2100;

export type DekiSceneStateInput = {
  sending: boolean;
  justReplied: boolean;
};

export function getDekiSceneMood({ sending, justReplied }: DekiSceneStateInput): DekiSceneMood {
  if (sending) return "thinking";
  if (justReplied) return "happy";
  return "idle";
}
