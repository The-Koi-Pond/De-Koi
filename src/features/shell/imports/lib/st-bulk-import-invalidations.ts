import type { QueryClient } from "@tanstack/react-query";
import { invalidateCharacterCollectionQueries } from "../../../catalog/characters/index";
import { chatKeys } from "../../../catalog/chats/index";
import { lorebookKeys } from "../../../catalog/lorebooks/index";
import { invalidatePersonaCollectionQueries } from "../../../catalog/personas/index";
import { presetKeys } from "../../../catalog/presets/index";
import { hasSTBulkImported, type STBulkImportedCounts } from "./st-bulk-import-model";

export type STBulkImportInvalidationClient = Pick<QueryClient, "invalidateQueries">;

export function applySTBulkImportInvalidations(
  queryClient: STBulkImportInvalidationClient,
  imported: STBulkImportedCounts,
): void {
  if (hasSTBulkImported(imported, "characters")) {
    invalidateCharacterCollectionQueries(queryClient);
  }
  if (hasSTBulkImported(imported, "chats") || hasSTBulkImported(imported, "groupChats")) {
    queryClient.invalidateQueries({ queryKey: chatKeys.list() });
  }
  if (hasSTBulkImported(imported, "lorebooks")) {
    queryClient.invalidateQueries({ queryKey: lorebookKeys.all });
  }
  if (hasSTBulkImported(imported, "presets")) {
    queryClient.invalidateQueries({ queryKey: presetKeys.all });
  }
  if (hasSTBulkImported(imported, "personas")) {
    invalidatePersonaCollectionQueries(queryClient);
  }
  if (hasSTBulkImported(imported, "backgrounds")) {
    queryClient.invalidateQueries({ queryKey: ["backgrounds"] });
    queryClient.invalidateQueries({ queryKey: ["background-tags"] });
  }
}
