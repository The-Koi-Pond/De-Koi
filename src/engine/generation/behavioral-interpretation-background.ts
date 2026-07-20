import { z } from "zod";

import type { LlmGateway, LlmMessage } from "../capabilities/llm";
import type { StorageGateway } from "../capabilities/storage";
import type {
  BehavioralEvidenceClass,
  BehavioralEvidenceField,
  Character,
  CharacterBehavioralInterpretation,
  CharacterData,
} from "../contracts/types/character";
import {
  assessCharacterRichness,
  behavioralInterpretationSourceHash,
  behavioralInterpretationSources,
  BEHAVIORAL_INTERPRETATION_VERSION,
  isBehavioralInterpretationCurrent,
  validateBehavioralInterpretation,
} from "./behavioral-interpretation";
import { generateStructured } from "./structured-generation";

const AUTHORED_EVIDENCE_FIELDS = [
  "description",
  "personality",
  "scenario",
  "backstory",
  "first_mes",
  "mes_example",
  "system_prompt",
  "post_history_instructions",
  "character_book",
] as const satisfies readonly Exclude<BehavioralEvidenceField, "user_override">[];

const generatedInterpretationSchema = z.object({
  claims: z
    .array(
      z.object({
        statement: z.string().trim().min(1).max(240),
        evidenceClass: z.enum(["explicit", "strongly_implied", "tentative"] satisfies [
          BehavioralEvidenceClass,
          ...BehavioralEvidenceClass[],
        ]),
        evidence: z
          .array(
            z.object({
              field: z.enum(AUTHORED_EVIDENCE_FIELDS),
              quote: z.string().trim().min(6).max(320),
            }),
          )
          .min(1)
          .max(3),
      }),
    )
    .min(1)
    .max(5),
});

const SCHEMA_DESCRIPTION = `{
  "claims": [
    {
      "statement": "A concise behavioral tendency, uncertainty included when appropriate.",
      "evidenceClass": "explicit | strongly_implied | tentative",
      "evidence": [
        {
          "field": "description | personality | scenario | backstory | first_mes | mes_example | system_prompt | post_history_instructions | character_book",
          "quote": "An exact continuous quote from that field."
        }
      ]
    }
  ]
}`;

export interface DeriveCharacterBehavioralInterpretationInput {
  character: CharacterData;
  connectionId: string;
}

export interface ScheduleSparseCharacterInterpretationsInput {
  characterIds: string[];
  connectionId?: string | null;
}

const scheduledByStorage = new WeakMap<StorageGateway, Set<string>>();

function clean(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function boundedDerivationSources(character: CharacterData): Record<string, string> {
  const sources = behavioralInterpretationSources(character);
  let remaining = 12_000;
  return Object.fromEntries(
    Object.entries(sources).map(([field, value]) => {
      const bounded = value.slice(0, Math.min(2_400, remaining));
      remaining = Math.max(0, remaining - bounded.length);
      return [field, bounded];
    }),
  );
}

function derivationMessages(character: CharacterData): LlmMessage[] {
  const sources = boundedDerivationSources(character);
  return [
    {
      role: "system",
      content: [
        "Derive a small, inspectable behavioral interpretation for a sparse fictional character card.",
        "Use only the authored evidence supplied by the user. Never invent biography, relationships, history, or facts.",
        "Never control the user's actions, words, thoughts, feelings, agreement, or decisions.",
        "Every claim needs an exact continuous quote from its named field.",
        "Use tentative when the evidence supports more than one reading.",
        "Prefer response tendencies, social boundaries, decision style, emotional regulation, and recurring mannerisms.",
        "Return only one valid JSON object with this exact shape:",
        SCHEMA_DESCRIPTION,
      ].join("\n"),
    },
    {
      role: "user",
      content: [
        `Character: ${clean(character.name) || "Unnamed"}`,
        "Authored evidence:",
        JSON.stringify(sources, null, 2),
      ].join("\n"),
    },
  ];
}

export async function deriveCharacterBehavioralInterpretation(
  capabilities: { llm: LlmGateway },
  input: DeriveCharacterBehavioralInterpretationInput,
  signal?: AbortSignal,
): Promise<CharacterBehavioralInterpretation | null> {
  const connectionId = clean(input.connectionId);
  if (!connectionId) return null;
  const result = await generateStructured(
    capabilities,
    {
      taskName: "sparse character behavioral interpretation",
      connectionId,
      messages: derivationMessages(input.character),
      parameters: { temperature: 0.35, maxTokens: 900 },
      schema: generatedInterpretationSchema,
      schemaDescription: SCHEMA_DESCRIPTION,
      maxRepairAttempts: 1,
      failureMessage: "The model did not return a valid evidence-backed behavioral interpretation.",
    },
    signal,
  );
  if (!result.ok) throw new Error(result.failure.message);
  const validated = validateBehavioralInterpretation(input.character, result.data);
  if (!validated) return null;
  return {
    ...validated,
    generatedAt: new Date().toISOString(),
    generatorConnectionId: connectionId,
  };
}

function needsDerivation(character: Character): boolean {
  const profile = character.behavioralInterpretation;
  if (profile?.enabled === false) return false;
  if (profile?.regenerationRequested === true) return true;
  if (isBehavioralInterpretationCurrent(character.data, profile)) return false;
  if (profile?.status === "pending") return true;
  const sourceHash = behavioralInterpretationSourceHash(character.data);
  if (
    profile?.version === BEHAVIORAL_INTERPRETATION_VERSION &&
    profile.status === "failed" &&
    profile.sourceHash === sourceHash
  ) {
    return false;
  }
  return assessCharacterRichness(character.data).sparse;
}

async function saveIfSourceUnchanged(
  storage: StorageGateway,
  characterId: string,
  originalSourceHash: string,
  originalProfile: CharacterBehavioralInterpretation | undefined,
  profile: CharacterBehavioralInterpretation,
): Promise<void> {
  const latest = await storage.get<Character>("characters", characterId);
  if (!latest || behavioralInterpretationSourceHash(latest.data) !== originalSourceHash) return;
  if (JSON.stringify(latest.behavioralInterpretation) !== JSON.stringify(originalProfile)) return;
  await storage.update("characters", characterId, { behavioralInterpretation: profile });
}

function failedInterpretation(
  character: Character,
  sourceHash: string,
  lastError: string,
): CharacterBehavioralInterpretation {
  if (isBehavioralInterpretationCurrent(character.data, character.behavioralInterpretation)) {
    return {
      ...character.behavioralInterpretation!,
      regenerationRequested: false,
      lastError,
    };
  }
  return {
    version: BEHAVIORAL_INTERPRETATION_VERSION,
    sourceHash,
    status: "failed",
    enabled: true,
    claims: [],
    lastError,
  };
}

async function deriveAndSave(
  deps: { storage: StorageGateway; llm: LlmGateway },
  characterId: string,
  connectionId: string,
): Promise<void> {
  const character = await deps.storage.get<Character>("characters", characterId);
  if (!character || !needsDerivation(character)) return;
  const sourceHash = behavioralInterpretationSourceHash(character.data);
  try {
    const profile = await deriveCharacterBehavioralInterpretation(
      { llm: deps.llm },
      { character: character.data, connectionId },
    );
    if (!profile) {
      await saveIfSourceUnchanged(
        deps.storage,
        characterId,
        sourceHash,
        character.behavioralInterpretation,
        failedInterpretation(character, sourceHash, "No valid evidence-backed claims were returned."),
      );
      return;
    }
    const userCorrections =
      character.behavioralInterpretation?.claims.filter((claim) => claim.source === "user_override") ?? [];
    await saveIfSourceUnchanged(deps.storage, characterId, sourceHash, character.behavioralInterpretation, {
      ...profile,
      claims: [...userCorrections, ...profile.claims].slice(0, 8),
    });
  } catch (error) {
    await saveIfSourceUnchanged(
      deps.storage,
      characterId,
      sourceHash,
      character.behavioralInterpretation,
      failedInterpretation(
        character,
        sourceHash,
        error instanceof Error ? error.message : "Behavioral interpretation failed.",
      ),
    );
  }
}

export function scheduleSparseCharacterInterpretations(
  deps: { storage: StorageGateway; llm: LlmGateway },
  input: ScheduleSparseCharacterInterpretationsInput,
): void {
  const connectionId = clean(input.connectionId);
  if (!connectionId) return;
  const scheduled = scheduledByStorage.get(deps.storage) ?? new Set<string>();
  scheduledByStorage.set(deps.storage, scheduled);
  const characterIds = [...new Set(input.characterIds.map(clean).filter(Boolean))].filter((id) => !scheduled.has(id));
  for (const characterId of characterIds) scheduled.add(characterId);
  if (characterIds.length === 0) return;

  queueMicrotask(() => {
    void runScheduledDerivations(deps, characterIds, connectionId, scheduled);
  });
}

async function runScheduledDerivations(
  deps: { storage: StorageGateway; llm: LlmGateway },
  characterIds: string[],
  connectionId: string,
  scheduled: Set<string>,
): Promise<void> {
  for (const characterId of characterIds) {
    await Promise.allSettled([deriveAndSave(deps, characterId, connectionId)]);
    scheduled.delete(characterId);
  }
}
