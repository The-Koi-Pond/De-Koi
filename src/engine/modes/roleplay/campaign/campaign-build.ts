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
import { campaignBuildConnection, campaignCall, type CampaignCapabilities } from "./campaign-calls";
import { assemblePlan, planProblems } from "./campaign-plan";
import {
  BIBLE_SHAPE,
  bibleMessages,
  CONTENT_SHAPE,
  contentMessages,
  reviewMessages,
  situationMessages,
  SITUATIONS_SHAPE,
  type PlayerPersona,
} from "./campaign-prompts";
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

export interface BuildCampaignInput {
  ask: string;
  /** Null lets the bible step read the focus from the ask. */
  focus: CampaignFocus | null;
  secondaryFocus?: CampaignFocus | null;
  heat: CampaignHeat;
  limits: string[];
  length: CampaignLength;
  blind: boolean;
  /** The connection the campaign is built with and played on; null uses the app default. */
  connectionId: string | null;
  /** The persona the player plays; null uses the active persona. */
  personaId: string | null;
  folderId?: string | null;
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
    limits: input.limits
      .map((limit) => limit.trim())
      .filter(Boolean)
      .slice(0, MAX_LIMITS),
    length: input.length,
    blind: input.blind,
  };
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
  let request = cleanRequest(input);
  const persona = await personaFor(capabilities.storage, input.personaId);

  onStep?.("planning");
  const bible = await campaignCall(
    capabilities,
    {
      kind: "bible",
      connectionId,
      messages: bibleMessages(request, persona, input.focus !== null),
      schema: bibleSchema,
      shape: BIBLE_SHAPE,
    },
    signal,
  );
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
      messages: situationMessages(request, persona, bible),
      schema: situationsSchema,
      shape: SITUATIONS_SHAPE,
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
      messages: reviewMessages(request, persona, bible, first, problems),
      schema: situationsSchema,
      shape: SITUATIONS_SHAPE,
    },
    signal,
  );

  onStep?.("writing");
  const content = await campaignCall(
    capabilities,
    {
      kind: "content",
      connectionId,
      messages: contentMessages(request, persona, bible, situations),
      schema: contentSchema,
      shape: CONTENT_SHAPE,
    },
    signal,
  );
  return { request, bible, situations, problems, remainingProblems: planProblems(request, bible, situations), content };
}

/** The stored campaign for a draft. */
function campaignStateFromDraft(
  draft: CampaignDraft,
  rows: { narratorCharacterId: string | null; lorebookId: string | null },
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
    createdAt: now,
    updatedAt: now,
  };
}

function presetHints(heat: CampaignHeat): Record<string, string> {
  if (heat === "explicit") return { contentBoundary: "boundary_mature_dark", eroticTone: "erotic_tone_direct" };
  if (heat === "fade") return { contentBoundary: "boundary_mature_dark", eroticTone: "erotic_tone_restrained" };
  return { contentBoundary: "boundary_sfw", eroticTone: "erotic_tone_none" };
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
  try {
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
    const state = campaignStateFromDraft(draft, { narratorCharacterId: characterId, lorebookId }, now);
    const chat = await storage.create<JsonRecord>("chats", {
      name: title,
      mode: "roleplay",
      characterIds: [characterId],
      personaId: input.personaId,
      folderId: input.folderId ?? null,
      connectionId: input.connectionId,
      promptPresetId: preset.presetId,
      activeLorebookIds: [lorebookId],
      metadata: {
        [CAMPAIGN_METADATA_KEY]: state,
        activeLorebookIds: [lorebookId],
        enableMemoryRecall: true,
        ...(preset.presetId ? { presetChoices: preset.presetChoices } : {}),
      },
    });
    const chatId = readString(chat.id).trim();
    if (!chatId) throw new Error("The campaign chat was saved without an id.");
    created.push(() => deleteChatAndTranscript(storage, chatId));
    await storage.createChatMessage(chatId, { role: "assistant", characterId, content: content.opening });
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
    const connectionId = await campaignBuildConnection(storage, input.connectionId);
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
