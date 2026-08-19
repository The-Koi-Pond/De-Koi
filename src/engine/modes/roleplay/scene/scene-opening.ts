import { buildNarratorInstructionMessage } from "../../../shared/text/generation-guide";

export function buildRoleplaySceneOpeningGuide(plannedOpeningBeat: string): string {
  return buildNarratorInstructionMessage(
    [
      "Open this roleplay scene now.",
      "Treat the planned opening beat as intent, not prose to copy. Write a fresh in-world opening using the scene context and current Roleplay settings, then leave room for the user.",
      "",
      "Planned opening beat:",
      plannedOpeningBeat,
    ].join("\n"),
  );
}
