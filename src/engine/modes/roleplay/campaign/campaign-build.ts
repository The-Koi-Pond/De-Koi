// Building: one ask becomes a campaign. Four model calls plan it (bible, situations, one review, the player-facing
// content), then a narrator card, a lorebook and a Roleplay chat holding the hidden plan are written. A failed step
// fails with its real reason; anything already written is removed again.
import type { StorageGateway } from "../../../capabilities/storage";
import type {
  CampaignFocus,
  CampaignHeat,
  CampaignLength,
  CampaignRequest,
  RoleplayCampaignState,
} from "../../../contracts/types/roleplay-campaign";
import { loadPersona } from "../../../generation/prompt-assembly";
import { readString, type JsonRecord } from "../../../generation/runtime-records";
import { userFacingError } from "../../../shared/user-facing-error";
import { undoThenThrow } from "../scene/scene-errors";
import { deleteChatAndTranscript } from "../scene/scene-removal";
import { resolveUniversalPresetWithHints } from "../scene/universal-preset";
import {
  campaignBuildConnection,
  campaignCall,
  campaignPlanningConnection,
  type CampaignCapabilities,
} from "./campaign-calls";
import { assemblePlan, planProblems } from "./campaign-plan";
import {
  BIBLE_SHAPE,
  bibleMessages,
  CONTENT_SHAPE,
  contentMessages,
  reviewMessages,
  situationMessages,
  SITUATIONS_SHAPE,
  type PlannerContext,
  type PlayerPersona,
} from "./campaign-prompts";
import { loadCampaignLibrary, type CampaignLibrary } from "./campaign-library";
import {
  bibleSchema,
  contentSchema,
  situationsSchema,
  type CampaignBible,
  type CampaignContent,
  type CampaignSituations,
} from "./campaign-schemas";
import { CAMPAIGN_METADATA_KEY, START_KEY } from "./campaign-state";

const MAX_ASK = 2_000;
const MAX_LIMITS = 8;
const MAX_OFF_TABLE = 600;

export interface BuildCampaignInput {
  ask: string;
  /** Null lets the bible step read the focus from the ask. */
  focus: CampaignFocus | null;
  secondaryFocus?: CampaignFocus | null;
  heat: CampaignHeat;
  /** Limits already given as a list (Deki-senpai's card). */
  limits: string[];
  /** The player's own answer to "anything off the table?"; the planner reads the real limits out of it. */
  offTable?: string;
  length: CampaignLength;
  blind: boolean;
  /** The story model the campaign is played on; null uses the app default. */
  connectionId: string | null;
  /** The model that plans it (and later replans); null uses the Campaign planning route, else the story model. */
  planningConnectionId?: string | null;
  /** The planning model's reasoning effort (and later replans'); null leaves it to the connection's defaults. */
  planningReasoningEffort?: string | null;
  /** The chat's own generation parameters (setup's custom parameters); null keeps the connection's defaults. */
  chatParameters?: Record<string, unknown> | null;
  /** The persona the player plays; null uses the active persona. */
  personaId: string | null;
  folderId?: string | null;
  /** The player's own characters to build the campaign around; they play themselves in the chat. */
  characterIds?: string[];
  /** The player's own lorebooks: the world the campaign takes place in. */
  lorebookIds?: string[];
}

export type CampaignBuildStep = "planning" | "situations" | "reviewing" | "writing" | "saving";

export interface BuiltCampaign {
  chatId: string;
  title: string;
  /** Empty when the player chose to go in blind. */
  pitch: string;
}

/** The plan before anything is written: what the lab and the builder share. */
interface CampaignDraft {
  request: CampaignRequest;
  library: CampaignLibrary;
  bible: CampaignBible;
  situations: CampaignSituations;
  /** What the checks found before the review. */
  problems: string[];
  /** What the checks still find after it. */
  remainingProblems: string[];
  content: CampaignContent;
}

function cleanRequest(input: BuildCampaignInput): CampaignRequest {
  const ask = input.ask.replace(/\s+\n/g, "\n").trim().slice(0, MAX_ASK);
  if (!ask) throw userFacingError("Say what the campaign should be about.");
  return {
    ask,
    focus: input.focus ?? "story",
    secondaryFocus: input.secondaryFocus && input.secondaryFocus !== input.focus ? input.secondaryFocus : null,
    heat: input.heat,
    // Settled by the bible step from the player's own words (see offTableText).
    limits: [],
    length: input.length,
    blind: input.blind,
  };
}

/** The player's own characters the bible's cast doesn't name. */
function missingOwnCharacters(bible: CampaignBible, library: CampaignLibrary): string[] {
  const castNames = new Set(bible.cast.map((member) => member.name.trim().toLowerCase()));
  return library.characters.map((own) => own.name).filter((name) => !castNames.has(name.trim().toLowerCase()));
}

/** Everything the player said about limits, as they said it. */
function offTableText(input: BuildCampaignInput): string {
  return [
    ...input.limits
      .map((limit) => limit.trim())
      .filter(Boolean)
      .slice(0, MAX_LIMITS),
    input.offTable?.trim() ?? "",
  ]
    .filter(Boolean)
    .join("; ")
    .slice(0, MAX_OFF_TABLE);
}

async function personaFor(storage: StorageGateway, personaId: string | null): Promise<PlayerPersona | null> {
  const persona = await loadPersona(storage, personaId ? { personaId } : {});
  if (!persona) return null;
  const description = [persona.description, persona.appearance].filter(Boolean).join(" ").trim().slice(0, 800);
  return { name: persona.name, description };
}

/** Plans a campaign: the four model calls, no writes. */
async function draftCampaign(
  capabilities: CampaignCapabilities,
  input: BuildCampaignInput,
  options: { connectionId: string; onStep?: (step: CampaignBuildStep) => void; signal?: AbortSignal },
): Promise<CampaignDraft> {
  const { connectionId, onStep, signal } = options;
  const reasoningEffort = input.planningReasoningEffort ?? null;
  let request = cleanRequest(input);
  const [persona, library] = await Promise.all([
    personaFor(capabilities.storage, input.personaId),
    loadCampaignLibrary(capabilities.storage, { characterIds: input.characterIds, lorebookIds: input.lorebookIds }),
  ]);
  const context: PlannerContext = { persona, library };

  onStep?.("planning");
  const bibleRequest = bibleMessages(request, { ...context, offTable: offTableText(input) }, input.focus !== null);
  const askBible = (messages: typeof bibleRequest) =>
    campaignCall(
      capabilities,
      { kind: "bible", connectionId, messages, schema: bibleSchema, shape: BIBLE_SHAPE, reasoningEffort },
      signal,
    );
  let bible = await askBible(bibleRequest);
  const missing = missingOwnCharacters(bible, library);
  if (missing.length > 0) {
    // The review step can't add cast, so a bible without the player's own characters is redone once here.
    bible = await askBible([
      ...bibleRequest,
      { role: "assistant", content: JSON.stringify(bible) },
      {
        role: "user",
        content: `The cast must include the player's own characters under their exact names: ${missing.join(", ")}. Return the full corrected bible as one JSON object.`,
      },
    ]);
    const stillMissing = missingOwnCharacters(bible, library);
    if (stillMissing.length > 0) {
      throw userFacingError(
        `The model left ${stillMissing.join(" and ")} out of the campaign. Try again, or switch to a stronger model.`,
      );
    }
  }
  request = { ...request, limits: bible.limits.slice(0, MAX_LIMITS) };
  if (input.focus === null) {
    request = {
      ...request,
      focus: bible.focus,
      secondaryFocus: bible.secondaryFocus && bible.secondaryFocus !== bible.focus ? bible.secondaryFocus : null,
    };
  }

  onStep?.("situations");
  const first = await campaignCall(
    capabilities,
    {
      kind: "situations",
      connectionId,
      messages: situationMessages(request, context, bible),
      schema: situationsSchema,
      shape: SITUATIONS_SHAPE,
      reasoningEffort,
    },
    signal,
  );
  const problems = planProblems(request, bible, first);

  onStep?.("reviewing");
  const situations = await campaignCall(
    capabilities,
    {
      kind: "review",
      connectionId,
      messages: reviewMessages(request, context, bible, first, problems),
      schema: situationsSchema,
      shape: SITUATIONS_SHAPE,
      reasoningEffort,
    },
    signal,
  );

  onStep?.("writing");
  const content = await campaignCall(
    capabilities,
    {
      kind: "content",
      connectionId,
      messages: contentMessages(request, context, bible, situations),
      schema: contentSchema,
      shape: CONTENT_SHAPE,
      reasoningEffort,
    },
    signal,
  );
  return {
    request,
    bible,
    situations,
    problems,
    remainingProblems: planProblems(request, bible, situations),
    content,
    library,
  };
}

/** The stored campaign for a draft. */
function campaignStateFromDraft(
  draft: CampaignDraft,
  rows: Pick<
    RoleplayCampaignState,
    "narratorCharacterId" | "lorebookId" | "planningConnectionId" | "planningReasoningEffort"
  >,
  now: string,
): RoleplayCampaignState {
  const plan = assemblePlan(draft.bible, draft.situations);
  const first = plan.situations[0];
  if (!first) throw new Error("The campaign plan has no situations.");
  return {
    version: 1,
    status: "playing",
    request: draft.request,
    plan,
    progress: [
      {
        key: START_KEY,
        situationId: first.id,
        clock: 0,
        replies: 0,
        outcomes: [],
        facts: [],
        debts: [],
        revealedClueIds: [],
        stances: {},
        ladder: {},
        pacing: "hold",
        endingId: null,
        turn: 0,
      },
    ],
    lastReplanTurn: 0,
    narratorCharacterId: rows.narratorCharacterId,
    lorebookId: rows.lorebookId,
    planningConnectionId: rows.planningConnectionId,
    planningReasoningEffort: rows.planningReasoningEffort,
    createdAt: now,
    updatedAt: now,
  };
}

function presetHints(heat: CampaignHeat): Record<string, string> {
  if (heat === "explicit") return { contentBoundary: "boundary_mature_dark", eroticTone: "erotic_tone_direct" };
  if (heat === "fade") return { contentBoundary: "boundary_mature_dark", eroticTone: "erotic_tone_restrained" };
  return { contentBoundary: "boundary_sfw", eroticTone: "erotic_tone_none" };
}

/** The narrator card for a campaign without the player's own characters. */
async function createNarrator(
  storage: StorageGateway,
  content: CampaignContent,
  title: string,
  created: Array<() => Promise<void>>,
): Promise<string> {
  const character = await storage.create<JsonRecord>("characters", {
    name: content.narrator.name,
    data: {
      name: content.narrator.name,
      description: content.narrator.description,
      personality: content.narrator.personality,
      // The opening lives in the campaign chat; a fresh chat with this card has no plan behind it.
      first_mes: "",
      scenario: "",
      mes_example: "",
      creator_notes: `Narrator for the campaign "${title}". The plan lives in the campaign chat, not on this card.`,
      system_prompt: "",
      post_history_instructions: "",
      creator: "",
      character_version: "1.0",
      tags: ["campaign"],
      alternate_greetings: [],
      extensions: { campaignNarrator: true },
      character_book: null,
    },
  });
  const characterId = readString(character.id).trim();
  if (!characterId) throw new Error("The narrator card was saved without an id.");
  created.push(async () => void (await storage.delete("characters", characterId)));
  return characterId;
}

/** Saves a planned campaign: narrator card, lorebook, the chat with its hidden plan, and the opening. */
async function saveCampaignDraft(
  storage: StorageGateway,
  input: BuildCampaignInput,
  draft: CampaignDraft,
  now: string,
): Promise<BuiltCampaign> {
  const { content } = draft;
  const title = draft.bible.title;
  const created: Array<() => Promise<void>> = [];
  const ownCharacterIds = draft.library.characters.map((character) => character.id);
  const ownLorebookIds = draft.library.lorebooks.map((lorebook) => lorebook.id);
  try {
    // The player's own characters play themselves; only a campaign without them gets a narrator card.
    const narratorId = ownCharacterIds.length > 0 ? null : await createNarrator(storage, content, title, created);
    const speakerIds = narratorId ? [narratorId] : ownCharacterIds;

    const lorebook = await storage.create<JsonRecord>("lorebooks", {
      name: `${title} (campaign)`,
      description: draft.request.blind ? "World notes for a campaign." : draft.bible.pitch,
      category: "uncategorized",
      tags: ["campaign"],
    });
    const lorebookId = readString(lorebook.id).trim();
    if (!lorebookId) throw new Error("The campaign lorebook was saved without an id.");
    created.push(async () => void (await storage.delete("lorebooks", lorebookId)));
    await storage.createLorebookEntries(
      lorebookId,
      content.lorebook.map((entry, index) => ({
        lorebookId,
        name: entry.name,
        content: entry.content,
        keys: entry.keys,
        secondaryKeys: [],
        enabled: true,
        constant: false,
        selective: false,
        tag: "",
        order: index,
      })),
    );

    const preset = await resolveUniversalPresetWithHints(storage, presetHints(draft.request.heat));
    const state = campaignStateFromDraft(
      draft,
      {
        narratorCharacterId: narratorId,
        lorebookId,
        planningConnectionId: input.planningConnectionId ?? null,
        planningReasoningEffort: input.planningReasoningEffort ?? null,
      },
      now,
    );
    const lorebookIds = [lorebookId, ...ownLorebookIds];
    const chat = await storage.create<JsonRecord>("chats", {
      name: title,
      mode: "roleplay",
      characterIds: speakerIds,
      personaId: input.personaId,
      folderId: input.folderId ?? null,
      connectionId: input.connectionId,
      promptPresetId: preset.presetId,
      activeLorebookIds: lorebookIds,
      metadata: {
        [CAMPAIGN_METADATA_KEY]: state,
        activeLorebookIds: lorebookIds,
        enableMemoryRecall: true,
        ...(input.chatParameters ? { chatParameters: input.chatParameters } : {}),
        ...(preset.presetId ? { presetChoices: preset.presetChoices } : {}),
      },
    });
    const chatId = readString(chat.id).trim();
    if (!chatId) throw new Error("The campaign chat was saved without an id.");
    created.push(() => deleteChatAndTranscript(storage, chatId));
    await storage.createChatMessage(chatId, {
      role: "assistant",
      characterId: speakerIds[0],
      content: content.opening,
    });
    return { chatId, title, pitch: draft.request.blind ? "" : draft.bible.pitch };
  } catch (error) {
    return undoThenThrow(error, async () => {
      for (const undo of created.reverse()) await undo();
    });
  }
}

const building = new WeakMap<StorageGateway, boolean>();

/** Builds and saves a campaign. One build per runtime at a time; it takes a few minutes on a strong model. */
export async function buildCampaign(
  capabilities: CampaignCapabilities,
  input: BuildCampaignInput,
  options: { onStep?: (step: CampaignBuildStep) => void; signal?: AbortSignal; now?: () => string } = {},
): Promise<BuiltCampaign> {
  const { storage } = capabilities;
  if (building.get(storage)) throw userFacingError("A campaign is already being built. Wait for it to finish.");
  building.set(storage, true);
  try {
    const connectionId = await campaignPlanningConnection(storage, {
      storyConnectionId: await campaignBuildConnection(storage, input.connectionId),
      planningConnectionId: input.planningConnectionId ?? null,
      job: "build",
      chatConnectionId: input.connectionId,
    });
    const draft = await draftCampaign(capabilities, input, {
      connectionId,
      onStep: options.onStep,
      signal: options.signal,
    });
    options.onStep?.("saving");
    return await saveCampaignDraft(storage, input, draft, options.now?.() ?? new Date().toISOString());
  } finally {
    building.delete(storage);
  }
}
