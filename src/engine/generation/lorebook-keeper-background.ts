import type { StorageGateway } from "../capabilities/storage";

export interface ScheduleLorebookKeeperBackfillInput {
  storage: StorageGateway;
  chatId: string;
  run: () => Promise<void>;
}

const scheduledByStorage = new WeakMap<StorageGateway, Map<string, Promise<void>>>();

function failureMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Lorebook Keeper backfill failed.";
}

export function scheduleLorebookKeeperBackfill(input: ScheduleLorebookKeeperBackfillInput): boolean {
  const chatId = input.chatId.trim();
  if (!chatId) return false;

  const scheduled = scheduledByStorage.get(input.storage) ?? new Map<string, Promise<void>>();
  scheduledByStorage.set(input.storage, scheduled);
  if (scheduled.has(chatId)) return false;

  const work = Promise.resolve()
    .then(input.run)
    .then(() => {
      console.debug("[generation] lorebook keeper backfill completed", { chatId });
    })
    .catch((error: unknown) => {
      console.warn("[generation] lorebook keeper backfill failed", { chatId, error: failureMessage(error) });
    })
    .finally(() => {
      scheduled.delete(chatId);
      if (scheduled.size === 0) scheduledByStorage.delete(input.storage);
    });
  scheduled.set(chatId, work);
  return true;
}
