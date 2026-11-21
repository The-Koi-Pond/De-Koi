// Shapes for the stored campaign and for every model answer the campaign reads. Model text is clipped to its cap
// instead of rejected for running long; anything structurally wrong is rejected and the caller reports why.
import { z } from "zod";

const FOCUS = ["story", "character", "challenge"] as const;
const HEAT = ["none", "fade", "explicit"] as const;
const LENGTH = ["short", "medium", "long"] as const;
const PACING = ["hold", "press", "turn", "land"] as const;
const STATUS = ["playing", "ended", "off"] as const;

/** Trimmed text clipped to `max` characters; must not be empty. */
function text(max: number) {
  return z
    .string()
    .transform((value) => value.replace(/\s+/g, " ").trim().slice(0, max))
    .pipe(z.string().min(1));
}

/** Prose clipped to `max`: paragraph breaks kept (at most one blank line), other runs of space collapsed. */
function prose(max: number) {
  return z
    .string()
    .transform((value) =>
      value
        .replace(/\r\n?/g, "\n")
        .replace(/[^\S\n]+/g, " ")
        .replace(/ *\n */g, "\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim()
        .slice(0, max),
    )
    .pipe(z.string().min(1));
}

/** Trimmed text clipped to `max`; may be empty. */
function optionalText(max: number) {
  return z
    .string()
    .nullish()
    .transform((value) => (value ?? "").replace(/\s+/g, " ").trim().slice(0, max));
}

/** A short id the model chose: lower-case letters, digits and dashes. */
const modelId = z
  .string()
  .transform((value) =>
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40),
  )
  .pipe(z.string().min(1));

const idList = z.array(modelId).max(12).default([]);

const castMemberSchema = z.object({
  id: modelId,
  name: text(60),
  role: text(160),
  want: text(240),
  fear: text(240),
  secret: text(320),
  towardPlayer: text(240),
  ladder: z
    .array(z.object({ looksLike: text(240), opensNext: text(240) }))
    .max(5)
    .default([]),
});

const truthSchema = z.object({ id: modelId, text: text(320) });
const clueSchema = z.object({ id: modelId, text: text(240), truthId: modelId });
const endingSchema = z.object({ id: modelId, condition: text(280), tone: text(160) });

const exitSchema = z.object({
  id: modelId,
  text: text(200),
  consequence: text(240),
  leadsTo: modelId.nullable().default(null),
});

const situationSchema = z.object({
  id: modelId,
  act: z.number().int().min(1).max(5),
  title: text(80),
  happening: text(600),
  question: text(400),
  present: idList,
  pressure: z.array(text(240)).min(1).max(4),
  clueIds: idList,
  holds: z.array(text(200)).max(4).default([]),
  exits: z.array(exitSchema).min(1).max(4),
});

/** Builder step 1: everything but the situations. */
export const bibleSchema = z.object({
  focus: z.enum(FOCUS).catch("story"),
  secondaryFocus: z.enum(FOCUS).nullable().catch(null),
  limits: z.array(text(160)).max(8).default([]),
  title: text(80),
  pitch: text(500),
  truth: text(1_000),
  keyTruths: z.array(truthSchema).min(1).max(5),
  tableRules: text(900),
  cast: z.array(castMemberSchema).min(1).max(6),
  endings: z.array(endingSchema).min(2).max(4),
});
export type CampaignBible = z.infer<typeof bibleSchema>;

/** Builder step 2 (and the review step's answer): the situations and the clues. */
export const situationsSchema = z.object({
  clues: z.array(clueSchema).min(1).max(30),
  situations: z.array(situationSchema).min(2).max(16),
});
export type CampaignSituations = z.infer<typeof situationsSchema>;

/** Builder step 4: what goes in the library and the first message. */
export const contentSchema = z.object({
  narrator: z.object({
    name: text(60),
    description: prose(2_400),
    personality: optionalText(1_200),
  }),
  lorebook: z
    .array(
      z.object({
        name: text(80),
        keys: z.array(text(40)).min(1).max(6),
        content: prose(1_200),
      }),
    )
    .min(1)
    .max(24),
  opening: prose(4_000),
});
export type CampaignContent = z.infer<typeof contentSchema>;

/** The runner's read of the latest exchange. */
export const tickSchema = z.object({
  situation: z.enum(["ongoing", "resolved", "left"]),
  exitId: modelId.nullable().default(null),
  outcome: optionalText(240),
  clockAdvanced: z.boolean().default(false),
  newFacts: z.array(text(200)).max(4).default([]),
  revealedClueIds: idList,
  debtsCreated: z
    .array(z.object({ text: text(200), due: z.enum(["soon", "later"]).default("later") }))
    .max(2)
    .default([]),
  debtsPaidIds: idList,
  stances: z
    .array(z.object({ castId: modelId, text: text(200) }))
    .max(6)
    .default([]),
  ladder: z
    .array(z.object({ castId: modelId, stage: z.number().int().min(0).max(4) }))
    .max(6)
    .default([]),
  pacing: z.enum(PACING),
  endingId: modelId.nullable().default(null),
  replan: z.boolean().default(false),
  replanWhy: optionalText(240),
});
export type CampaignTick = z.infer<typeof tickSchema>;

/** A replan's answer: the unplayed situations and the endings, rewritten. */
export const replanSchema = z.object({
  situations: z.array(situationSchema).min(1).max(14),
  clues: z.array(clueSchema).max(30).default([]),
  endings: z.array(endingSchema).min(2).max(4),
});
export type CampaignReplan = z.infer<typeof replanSchema>;

// ── Stored state ───────────────────────────────────────────────────────────

const storedText = z.string();

const progressSchema = z.object({
  key: storedText,
  situationId: storedText,
  clock: z.number().int().min(0),
  replies: z.number().int().min(0),
  outcomes: z.array(z.object({ situationId: storedText, text: storedText })),
  facts: z.array(storedText),
  debts: z.array(z.object({ id: storedText, text: storedText, due: z.enum(["soon", "later"]) })),
  revealedClueIds: z.array(storedText),
  stances: z.record(z.string(), storedText),
  ladder: z.record(z.string(), z.number().int().min(0)),
  pacing: z.enum(PACING),
  endingId: storedText.nullable(),
  turn: z.number().int().min(0),
});

const storedSituationSchema = z.object({
  id: storedText,
  act: z.number().int(),
  title: storedText,
  happening: storedText,
  question: storedText,
  present: z.array(storedText),
  pressure: z.array(storedText).min(1),
  clueIds: z.array(storedText),
  holds: z.array(storedText),
  exits: z.array(
    z.object({ id: storedText, text: storedText, consequence: storedText, leadsTo: storedText.nullable() }),
  ),
});

export const storedCampaignSchema = z.object({
  version: z.literal(1),
  status: z.enum(STATUS),
  request: z.object({
    ask: storedText,
    focus: z.enum(FOCUS),
    secondaryFocus: z.enum(FOCUS).nullable(),
    heat: z.enum(HEAT),
    limits: z.array(storedText),
    length: z.enum(LENGTH),
    blind: z.boolean(),
  }),
  plan: z.object({
    title: storedText,
    pitch: storedText,
    truth: storedText,
    keyTruths: z.array(z.object({ id: storedText, text: storedText })),
    tableRules: storedText,
    cast: z.array(
      z.object({
        id: storedText,
        name: storedText,
        role: storedText,
        want: storedText,
        fear: storedText,
        secret: storedText,
        towardPlayer: storedText,
        ladder: z.array(z.object({ looksLike: storedText, opensNext: storedText })),
      }),
    ),
    clues: z.array(z.object({ id: storedText, text: storedText, truthId: storedText })),
    endings: z.array(z.object({ id: storedText, condition: storedText, tone: storedText })),
    situations: z.array(storedSituationSchema).min(1),
    revision: z.number().int().min(0),
  }),
  progress: z.array(progressSchema).min(1),
  lastReplanTurn: z.number().int().min(0),
  narratorCharacterId: storedText.nullable(),
  lorebookId: storedText.nullable(),
  createdAt: storedText,
  updatedAt: storedText,
});
