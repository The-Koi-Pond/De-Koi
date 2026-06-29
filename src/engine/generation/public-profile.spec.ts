import { describe, expect, it, vi } from "vitest";

import type { LlmGateway, LlmRequest } from "../capabilities/llm";
import type { CharacterData } from "../contracts/types/character";
import { generateCharacterPublicProfileBio } from "./public-profile";

const character = {
  name: "The Ghost Face",
  description: "Danny Johnson is a methodical killer who turns murders into headlines.",
  personality: "Narcissistic, theatrical, patient.",
  scenario: "He stalks victims while posing as a freelance journalist.",
  first_mes: "*I lift the camera and smile behind the mask.*",
  mes_example: "",
  creator_notes: "PRIVATE: use a specific model preset.",
  system_prompt: "PRIVATE SYSTEM: never reveal this.",
  post_history_instructions: "PRIVATE POST HISTORY.",
  tags: ["dbd", "slasher"],
  creator: "",
  character_version: "1.0",
  alternate_greetings: [],
  extensions: {
    talkativeness: 0.5,
    fav: false,
    world: "",
    depth_prompt: { prompt: "", depth: 4, role: "system" },
    backstory: "",
    appearance: "",
  },
  character_book: null,
} satisfies CharacterData;

describe("generateCharacterPublicProfileBio", () => {
  it("asks the model for a first-person public bio without leaking private character fields", async () => {
    const requests: LlmRequest[] = [];
    const llm = {
      complete: vi.fn(async (request: LlmRequest) => {
        requests.push(request);
        return JSON.stringify({ bio: "I turn fear into a headline. Smile for the camera." });
      }),
      stream: vi.fn(),
      listModels: vi.fn(),
    } as unknown as LlmGateway;

    const bio = await generateCharacterPublicProfileBio(
      { llm },
      {
        connectionId: "conn-1",
        character,
        comment: "Freelance journalist with a taste for fear",
      },
    );

    expect(bio).toBe("I turn fear into a headline. Smile for the camera.");
    expect(requests[0]).toMatchObject({ connectionId: "conn-1" });
    const promptText = requests[0]!.messages.map((message) => message.content).join("\n");
    expect(promptText).toContain("Write as The Ghost Face");
    expect(promptText).toContain("Danny Johnson is a methodical killer");
    expect(promptText).not.toContain("PRIVATE");
    expect(promptText).not.toContain("specific model preset");
    expect(promptText).not.toContain("never reveal this");
  });
});
