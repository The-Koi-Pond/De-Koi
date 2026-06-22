import { z } from "zod";

export type GameLoreExtractionJsonRecord = Record<string, unknown>;

const nonEmptyString = z.string().trim().min(1);

const loreEntrySchema = z
  .object({
    name: nonEmptyString,
    content: nonEmptyString,
    keys: z.array(nonEmptyString).min(1).max(12),
    tag: z.string().trim().optional().nullable(),
    dynamicState: z.record(z.unknown()).optional(),
  })
  .passthrough();

export const gameLoreExtractionStructuredSchema = z
  .object({
    entries: z.array(loreEntrySchema).min(1).max(12),
  })
  .passthrough()
  .transform((value): GameLoreExtractionJsonRecord => value as GameLoreExtractionJsonRecord);

export const GAME_LORE_EXTRACTION_SCHEMA_DESCRIPTION = JSON.stringify({
  entries: [
    {
      name: "non-empty string",
      content: "non-empty string",
      keys: "1-12 non-empty strings",
      tag: "optional string or null",
      dynamicState: "optional object",
    },
  ],
});
