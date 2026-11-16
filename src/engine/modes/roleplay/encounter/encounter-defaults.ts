// The setup dialog's starting narration choices. Kept apart from the fight rules because the always-loaded encounter
// store needs them, and importing the rules there would pull the whole engine into the home screen's bundle.
import type { EncounterNarrationStyle } from "./encounter-types";

export const DEFAULT_COMBAT_NARRATION: EncounterNarrationStyle = {
  tense: "present",
  person: "third",
  narration: "omniscient",
  pov: "narrator",
};

export const DEFAULT_SUMMARY_NARRATION: EncounterNarrationStyle = {
  tense: "past",
  person: "third",
  narration: "omniscient",
  pov: "narrator",
};
