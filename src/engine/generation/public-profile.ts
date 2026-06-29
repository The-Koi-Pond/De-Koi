import { z } from "zod";

import type { LlmGateway, LlmMessage } from "../capabilities/llm";
import type { CharacterData, CharacterPublicProfile } from "../contracts/types/character";
import { generateStructured } from "./structured-generation";

const generatedPublicProfileBioSchema = z.object({
  bio: z.string().trim().min(1).max(1000),
});

export type GenerateCharacterPublicProfileBioInput = {
  connectionId: string;
  character: CharacterData;
  comment?: string | null;
  existingProfile?: CharacterPublicProfile | null;
};

const PUBLIC_PROFILE_BIO_SCHEMA_DESCRIPTION = `{
  "bio": "A short first-person About Me bio, written by the character."
}`;

function cleanText(value: string | null | undefined): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function cleanMultiline(value: string | null | undefined): string {
  return typeof value === "string" ? value.replace(/\r\n/g, "\n").trim() : "";
}

function truncateBio(value: string, maxLength = 280): string {
  const compact = cleanText(value).replace(/^['"]|['"]$/g, "");
  if (compact.length <= maxLength) return compact;
  const sliced = compact.slice(0, maxLength - 3);
  const lastSpace = sliced.lastIndexOf(" ");
  return `${(lastSpace > 120 ? sliced.slice(0, lastSpace) : sliced).trimEnd()}...`;
}

function publicCharacterFacts(input: GenerateCharacterPublicProfileBioInput): string {
  const { character, existingProfile } = input;
  const lines = [
    `Name: ${cleanText(character.name) || "Unnamed"}`,
    `Profile display name: ${cleanText(existingProfile?.displayName) || "(not set)"}`,
    `Profile handle: ${cleanText(existingProfile?.handle) || "(not set)"}`,
    `Public title/comment: ${cleanText(input.comment) || "(not set)"}`,
    `Tags: ${character.tags.map(cleanText).filter(Boolean).join(", ") || "(none)"}`,
    "",
    "Character card public fields:",
    `Description: ${cleanMultiline(character.description) || "(blank)"}`,
    `Personality: ${cleanMultiline(character.personality) || "(blank)"}`,
    `Scenario: ${cleanMultiline(character.scenario) || "(blank)"}`,
    `First message: ${cleanMultiline(character.first_mes) || "(blank)"}`,
  ];
  return lines.join("\n");
}

function buildPublicProfileBioMessages(input: GenerateCharacterPublicProfileBioInput): LlmMessage[] {
  const name = cleanText(input.character.name) || "this character";
  return [
    {
      role: "system",
      content: [
        "You write fictional character public profile bios for a Discord-style character card.",
        `Write as ${name}, in first person, as if the character wrote their own About Me bio.`,
        "Use only outward-facing character-card facts supplied by the user message.",
        "Do not mention character cards, roleplay instructions, prompts, models, private notes, or being an AI.",
        "Keep it compact: 1-2 sentences, under 240 characters when possible.",
        "Return only one valid JSON object with this exact shape:",
        PUBLIC_PROFILE_BIO_SCHEMA_DESCRIPTION,
      ].join("\n"),
    },
    {
      role: "user",
      content: publicCharacterFacts(input),
    },
  ];
}

export async function generateCharacterPublicProfileBio(
  capabilities: { llm: LlmGateway },
  input: GenerateCharacterPublicProfileBioInput,
  signal?: AbortSignal,
): Promise<string> {
  const connectionId = cleanText(input.connectionId);
  if (!connectionId) throw new Error("Choose a model connection before generating a profile bio.");

  const result = await generateStructured(
    capabilities,
    {
      taskName: "character public profile bio",
      connectionId,
      messages: buildPublicProfileBioMessages(input),
      parameters: { temperature: 0.9, maxTokens: 220 },
      schema: generatedPublicProfileBioSchema,
      schemaDescription: PUBLIC_PROFILE_BIO_SCHEMA_DESCRIPTION,
      maxRepairAttempts: 1,
      failureMessage: "The model did not return a usable public profile bio.",
    },
    signal,
  );

  if (!result.ok) throw new Error(result.failure.message);
  return truncateBio(result.data.bio);
}
