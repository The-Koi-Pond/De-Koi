import type { StarterCharacter } from "../../../../engine/modes/roleplay/starter-characters";

// The create payload for a new, mostly empty character card.
export function blankCharacterCreateInput(name: string, description = "") {
  return {
    name,
    data: {
      name,
      description,
      personality: "",
      first_mes: "",
      scenario: "",
      system_prompt: "",
      mes_example: "",
      creator_notes: "",
      tags: [],
      creator: "",
      character_version: "1.0",
      extensions: {},
      alternate_greetings: [],
      character_book: undefined,
      post_history_instructions: "",
    },
    format: "chara_card_v2" as const,
  };
}

// The create payload for one of the ready-made starter characters.
export function starterCharacterCreateInput(starter: StarterCharacter) {
  const input = blankCharacterCreateInput(starter.name, starter.description);
  return {
    ...input,
    data: {
      ...input.data,
      personality: starter.personality,
      scenario: starter.scenario,
      first_mes: starter.firstMessage,
      tags: [...starter.tags],
      creator: "De-Koi",
      creator_notes: "A De-Koi starter character. Edit anything you like.",
      // A staged starter opens new Roleplays in its first scene with its sprites shown, and its backgrounds follow
      // the story (see engine/modes/roleplay/scene/starter-staging.ts).
      extensions: starter.staging
        ? {
            sceneBackgrounds: starter.staging.scenes.map((scene) => ({ ...scene, keywords: [...scene.keywords] })),
            startsStaged: true,
          }
        : {},
    },
  };
}
