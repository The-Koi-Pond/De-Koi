// The game master between turns: after a reply is saved, read what happened and move the campaign along; now and
// then, rewrite the unplayed part of the plan around where the player went. Nothing here is required for a reply:
// a read that never ran is simply done after the next reply, which reads everything since the last one.
import type { StorageGateway } from "../../../capabilities/storage";
import type { RoleplayCampaignState } from "../../../contracts/types/roleplay-campaign";
import { trackPostReplyWork } from "../../../generation/post-reply-work";
import { oldestFirst, parseRecord, readString, type JsonRecord } from "../../../generation/runtime-records";
import { campaignCall, campaignRunConnection, type CampaignCapabilities } from "./campaign-calls";
import { mergeReplan } from "./campaign-plan";
import { REPLAN_SHAPE, replanMessages, TICK_SHAPE, tickMessages } from "./campaign-prompts";
import { replanSchema, tickSchema } from "./campaign-schemas";
import {
  applyTick,
  CAMPAIGN_METADATA_KEY,
  currentProgress,
  readCampaign,
  replanDue,
  replyKey,
  unreadExchange,
  visibleTurns,
  withProgress,
} from "./campaign-state";

/** How much of the chat one read loads. */
const MESSAGE_PAGE = 40;
/** At most this many unread turns go into one read. */
const MAX_UNREAD_TURNS = 12;
const RECENT_FOR_REPLAN = 10;
const SAVE_ATTEMPTS = 3;

export type CampaignTickResult =
  | { status: "skipped"; reason: "no_campaign" | "not_playing" | "nothing_new" | "changed_meanwhile" }
  | { status: "ticked"; state: RoleplayCampaignState; replan: { due: boolean; why: string } };

async function loadChat(storage: StorageGateway, chatId: string): Promise<JsonRecord | null> {
  return storage.get<JsonRecord>("chats", chatId);
}

async function loadMessages(storage: StorageGateway, chatId: string): Promise<JsonRecord[]> {
  const page = await storage.listChatMessages<JsonRecord>(chatId, {
    orderBy: "createdAt",
    descending: true,
    limit: MESSAGE_PAGE,
    fields: ["id", "role", "content", "extra", "hiddenFromAI", "createdAt"],
  });
  return oldestFirst(page);
}

function storedValue(chat: JsonRecord): unknown {
  return parseRecord(chat.metadata)[CAMPAIGN_METADATA_KEY] ?? null;
}

/** Saves `next` only if the stored campaign is still `expected`. */
async function saveIfUnchanged(
  storage: StorageGateway,
  chatId: string,
  expected: unknown,
  next: RoleplayCampaignState,
): Promise<boolean> {
  if (!storage.updateChatIfUnchanged) {
    await storage.patchChatMetadata(chatId, { [CAMPAIGN_METADATA_KEY]: next });
    return true;
  }
  const result = await storage.updateChatIfUnchanged(
    chatId,
    { metadata: { [CAMPAIGN_METADATA_KEY]: expected } },
    { metadata: { [CAMPAIGN_METADATA_KEY]: next } },
  );
  return result.updated;
}

/** Reads the replies the campaign has not seen yet and stores the next snapshot. */
export async function runCampaignTick(
  capabilities: CampaignCapabilities,
  chatId: string,
  options: { signal?: AbortSignal; now?: () => string } = {},
): Promise<CampaignTickResult> {
  const { storage } = capabilities;
  const chat = await loadChat(storage, chatId);
  if (!chat) return { status: "skipped", reason: "no_campaign" };
  const expected = storedValue(chat);
  const state = readCampaign(chat.metadata);
  if (!state) return { status: "skipped", reason: "no_campaign" };
  if (state.status !== "playing") return { status: "skipped", reason: "not_playing" };

  const messages = await loadMessages(storage, chatId);
  const { from, turns } = unreadExchange(state, messages);
  if (turns.length === 0) return { status: "skipped", reason: "nothing_new" };
  const read = turns.slice(-MAX_UNREAD_TURNS);
  const lastReply = [...read].reverse().find((turn) => turn.role === "assistant");
  if (!lastReply) return { status: "skipped", reason: "nothing_new" };

  const connectionId = await campaignRunConnection(storage, chat, "tick");
  const tick = await campaignCall(
    capabilities,
    { kind: "tick", connectionId, messages: tickMessages(state, from, read), schema: tickSchema, shape: TICK_SHAPE },
    options.signal,
  );
  const now = options.now?.() ?? new Date().toISOString();
  const userLengths = visibleTurns(messages)
    .filter((message) => message.role === "user")
    .map((message) => readString(message.content).trim().length);
  const next = applyTick(state, from, tick, { key: replyKey(lastReply), recentUserLengths: userLengths, now });
  const saved = withProgress(state, from, next, now);
  if (!(await saveIfUnchanged(storage, chatId, expected, saved))) {
    // Another read or a replan saved first; the next reply's read picks up from there.
    return { status: "skipped", reason: "changed_meanwhile" };
  }
  return {
    status: "ticked",
    state: saved,
    replan: { due: replanDue(saved, next, tick.replan), why: tick.replanWhy },
  };
}

/**
 * Rewrites the unplayed part of the plan around where the player is going. Played situations, the truth and the cast
 * stay fixed. Returns the saved campaign, or null when there was nothing to replan.
 */
export async function runCampaignReplan(
  capabilities: CampaignCapabilities,
  chatId: string,
  why: string,
  options: { signal?: AbortSignal; now?: () => string } = {},
): Promise<RoleplayCampaignState | null> {
  const { storage } = capabilities;
  let chat = await loadChat(storage, chatId);
  let state = chat ? readCampaign(chat.metadata) : null;
  if (!chat || !state || state.status !== "playing") return null;
  let messages = await loadMessages(storage, chatId);
  const progress = currentProgress(state, messages);
  const connectionId = await campaignRunConnection(storage, chat, "replan", state.planningConnectionId);
  const replan = await campaignCall(
    capabilities,
    {
      kind: "replan",
      connectionId,
      messages: replanMessages(state, progress, visibleTurns(messages).slice(-RECENT_FOR_REPLAN), why),
      schema: replanSchema,
      shape: REPLAN_SHAPE,
      reasoningEffort: state.planningReasoningEffort,
    },
    options.signal,
  );
  for (let attempt = 0; attempt < SAVE_ATTEMPTS; attempt += 1) {
    const latest = currentProgress(state, messages);
    const now = options.now?.() ?? new Date().toISOString();
    const next: RoleplayCampaignState = {
      ...state,
      plan: mergeReplan(state, latest, replan),
      lastReplanTurn: latest.turn,
      updatedAt: now,
    };
    if (await saveIfUnchanged(storage, chatId, storedValue(chat), next)) return next;
    // A read landed while the replan was being written: merge onto it instead.
    chat = await loadChat(storage, chatId);
    state = chat ? readCampaign(chat.metadata) : null;
    if (!chat || !state || state.status !== "playing") return null;
    messages = await loadMessages(storage, chatId);
  }
  console.warn("[campaign] the campaign kept changing while its replan was being saved; it was dropped");
  return null;
}

const running = new WeakMap<StorageGateway, Map<string, { again: boolean }>>();

/**
 * After a reply is saved: read it in the background. The next send waits for the read (bounded by the generation's
 * post-reply wait) so its pacing comes from this reply. A replan, when due, runs after the read without holding the
 * next send. One read per chat at a time; a reply saved during a read is read right after it.
 */
export function scheduleCampaignTick(capabilities: CampaignCapabilities, chatId: string): void {
  const chats = running.get(capabilities.storage) ?? new Map<string, { again: boolean }>();
  running.set(capabilities.storage, chats);
  const active = chats.get(chatId);
  if (active) {
    active.again = true;
    return;
  }
  const job = { again: true };
  chats.set(chatId, job);
  const finishTracking = trackPostReplyWork(capabilities.storage, chatId);
  setTimeout(() => {
    void (async () => {
      let replanWhy: string | null = null;
      try {
        while (job.again) {
          job.again = false;
          try {
            const result = await runCampaignTick(capabilities, chatId);
            if (result.status === "ticked" && result.replan.due) replanWhy = result.replan.why;
          } catch (error) {
            console.warn("[campaign] reading the last reply failed; the next reply's read covers it", error);
          }
        }
      } finally {
        finishTracking();
        if (chats.get(chatId) === job) chats.delete(chatId);
        if (chats.size === 0) running.delete(capabilities.storage);
      }
      if (replanWhy !== null) {
        await runCampaignReplan(capabilities, chatId, replanWhy).catch((error: unknown) =>
          console.warn("[campaign] replanning failed; the plan stays as it was", error),
        );
      }
    })();
  }, 0);
}

/** Whether saving a reply in this chat should start a campaign read. */
export function chatHasPlayingCampaign(chat: JsonRecord): boolean {
  if (readString(chat.mode || chat.chatMode).trim() !== "roleplay") return false;
  return readCampaign(chat.metadata)?.status === "playing";
}
