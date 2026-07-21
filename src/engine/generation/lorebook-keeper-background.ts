import type { StorageGateway } from "../capabilities/storage";

export interface ScheduleLorebookKeeperBackfillInput {
  storage: StorageGateway;
  chatId: string;
  run: () => Promise<void>;
}

interface ScheduledLorebookKeeperBackfill {
  pendingRun: (() => Promise<void>) | null;
}

const scheduledByStorage = new WeakMap<StorageGateway, Map<string, ScheduledLorebookKeeperBackfill>>();

function failureMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Lorebook Keeper backfill failed.";
}

export function scheduleLorebookKeeperBackfill(input: ScheduleLorebookKeeperBackfillInput): boolean {
  const chatId = input.chatId.trim();
  if (!chatId) return false;

  const scheduled = scheduledByStorage.get(input.storage) ?? new Map<string, ScheduledLorebookKeeperBackfill>();
  scheduledByStorage.set(input.storage, scheduled);
  const active = scheduled.get(chatId);
  if (active) {
    active.pendingRun = input.run;
    return true;
  }

  const state: ScheduledLorebookKeeperBackfill = { pendingRun: null };
  scheduled.set(chatId, state);
  void runScheduledLorebookKeeperBackfills(input.storage, chatId, input.run, state, scheduled);
  return true;
}

async function runScheduledLorebookKeeperBackfills(
  storage: StorageGateway,
  chatId: string,
  initialRun: () => Promise<void>,
  state: ScheduledLorebookKeeperBackfill,
  scheduled: Map<string, ScheduledLorebookKeeperBackfill>,
): Promise<void> {
  let run: (() => Promise<void>) | null = initialRun;
  try {
    while (run) {
      try {
        await run();
        console.debug("[generation] lorebook keeper backfill completed", { chatId });
      } catch (error) {
        console.warn("[generation] lorebook keeper backfill failed", { chatId, error: failureMessage(error) });
      }
      run = state.pendingRun;
      state.pendingRun = null;
    }
  } finally {
    scheduled.delete(chatId);
    if (scheduled.size === 0) scheduledByStorage.delete(storage);
  }
}
