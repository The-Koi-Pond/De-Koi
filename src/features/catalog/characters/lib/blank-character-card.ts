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
