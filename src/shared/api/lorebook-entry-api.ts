import type { LorebookEntry } from "../../engine/contracts/types/lorebook";
import { invokeTauri } from "./tauri-client";

export const lorebookEntryApi = {
  reorder: (input: { lorebookId: string; entryIds: string[]; folderId: string | null }) =>
    invokeTauri<LorebookEntry[]>("lorebook_entry_reorder", {
      lorebookId: input.lorebookId,
      orderedIds: input.entryIds,
      folderId: input.folderId,
    }),
};