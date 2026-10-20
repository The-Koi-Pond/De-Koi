// ──────────────────────────────────────────────
// Generation runner: characters who text first
// ──────────────────────────────────────────────
// Server-side version of the tab's background polling (use-background-autonomous.ts): every 30 seconds, for each
// Conversation chat with "characters can message you first" on, ask the engine whether a character should text
// now; if so, run that reply as a normal runner job (so an open tab streams it), mark the chat unread, and send a
// phone notification. Runs with no tab open at all.
import {
  checkConversationAutonomous,
  clearGenerationInProgress,
  getConversationBusyDelay,
  markGenerationInProgress,
  recordAssistantActivity,
} from "../engine/modes/chat/autonomous/autonomous.service";
import { chatCommandApi } from "../shared/api/chat-command-api";
import { storageApi } from "../shared/api/storage-api";
import type { RunnerJob } from "./jobs";

export type PresenceStatus = "active" | "idle" | "dnd";

export interface AutonomousSchedulerDeps {
  startJob: (input: Record<string, unknown>) => RunnerJob;
  runningForChat: (chatId: string) => RunnerJob | null;
  /** Resolves when the job ends, with whether it saved a reply. */
  waitForJob: (job: RunnerJob) => Promise<boolean>;
  /** The user's status as last reported by any open app ("idle" when none has reported recently). */
  presence: () => PresenceStatus;
  /** Called after a character texted first. */
  onTexted: (chat: { id: string; name: string }, character: { id: string; name: string }) => Promise<void>;
}

const POLL_INTERVAL_MS = 30_000;
const FIRST_POLL_DELAY_MS = 20_000;

interface ChatRow {
  id?: unknown;
  name?: unknown;
  mode?: unknown;
  metadata?: unknown;
}

function metadataOf(chat: ChatRow): Record<string, unknown> {
  if (typeof chat.metadata === "string") {
    try {
      return JSON.parse(chat.metadata) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  return chat.metadata && typeof chat.metadata === "object" ? (chat.metadata as Record<string, unknown>) : {};
}

async function characterName(characterId: string): Promise<string> {
  const row = await storageApi.get<{ name?: unknown; data?: { name?: unknown } }>("characters", characterId);
  const name = row?.data?.name ?? row?.name;
  return typeof name === "string" && name.trim() ? name.trim() : "A character";
}

export function startAutonomousScheduler(deps: AutonomousSchedulerDeps): () => void {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const pending = new Set<string>();

  const runFor = async (chat: { id: string; name: string }, characterId: string, lockedAt: number) => {
    let saved = false;
    try {
      if (stopped || deps.runningForChat(chat.id)) return;
      const job = deps.startJob({ chatId: chat.id, connectionId: null, forCharacterId: characterId, streaming: true });
      saved = await deps.waitForJob(job);
      if (saved) {
        // Count the send so the next poll waits out the follow-up cooldown instead of texting again.
        recordAssistantActivity(chat.id, characterId);
        await chatCommandApi.markAutonomousUnread(chat.id, { characterId });
        await deps.onTexted(chat, { id: characterId, name: await characterName(characterId) });
      }
    } catch (error) {
      console.warn(`[runner] texting first in chat ${chat.id} failed`, error);
    } finally {
      if (!saved) recordAssistantActivity(chat.id);
      clearGenerationInProgress(chat.id, lockedAt);
      pending.delete(chat.id);
    }
  };

  const poll = async () => {
    if (stopped) return;
    try {
      const userStatus = deps.presence();
      if (userStatus !== "dnd") {
        const chats = (await storageApi.list<ChatRow>("chats", { filters: { mode: "conversation" } })).filter(
          (chat) => typeof chat.id === "string" && metadataOf(chat).autonomousMessages === true,
        );
        for (const row of chats) {
          if (stopped) return;
          const chat = { id: row.id as string, name: typeof row.name === "string" ? row.name : "" };
          if (pending.has(chat.id) || deps.runningForChat(chat.id)) continue;
          const result = await checkConversationAutonomous(storageApi, { chatId: chat.id, userStatus });
          const characterId = result.shouldTrigger ? result.characterIds[0] : undefined;
          if (!characterId) continue;
          const lockedAt = markGenerationInProgress(chat.id);
          pending.add(chat.id);
          const delay = await getConversationBusyDelay(storageApi, { chatId: chat.id, characterId });
          setTimeout(() => void runFor(chat, characterId, lockedAt), Math.max(0, delay.delayMs));
        }
      }
    } catch (error) {
      console.warn("[runner] texting-first check failed; will retry", error);
    }
    if (!stopped) timer = setTimeout(() => void poll(), POLL_INTERVAL_MS);
  };

  timer = setTimeout(() => void poll(), FIRST_POLL_DELAY_MS);
  return () => {
    stopped = true;
    clearTimeout(timer);
  };
}
