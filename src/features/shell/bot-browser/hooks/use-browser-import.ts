import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { toast } from "sonner";

import { isRecord } from "../../../../engine/shared/value-readers";
import { toUserMessage } from "../../../../shared/lib/error-message";
import { importRegexScriptsForCharacter } from "../../../../shared/lib/regex-script-import";
import {
  cacheCharacterListRecordFromResult,
  invalidateCharacterCollectionQueries,
  offerCardLintReview,
} from "../../../catalog/characters/index";
import { lorebookKeys } from "../../../catalog/lorebooks/index";
import { importBrowserCharacter, warningReason, type BrowserImportRequest } from "../lib/importing";

/**
 * Import with everything that follows a successful one: the toast, the character lists, the lorebook lists, and
 * (in the background) the card check and the card's regex scripts. Only one import runs at a time.
 */
export function useBrowserImport() {
  const queryClient = useQueryClient();
  const [importing, setImporting] = useState(false);

  const runImport = useCallback(
    async (request: BrowserImportRequest) => {
      setImporting(true);
      try {
        const { result, name, warnings } = await importBrowserCharacter(request);
        toast.success(`Imported "${name}" successfully!`);
        if (!cacheCharacterListRecordFromResult(queryClient, result)) invalidateCharacterCollectionQueries(queryClient);
        if (result.lorebook) void queryClient.invalidateQueries({ queryKey: lorebookKeys.all });
        for (const warning of warnings) toast.warning(warning);

        void offerCardLintReview(result).catch((error: unknown) => {
          toast.warning(`Couldn't check the card: ${warningReason(error)}`);
        });
        const character = result.character;
        const characterId = result.characterId || (isRecord(character) ? character.id : undefined);
        if (isRecord(character) && isRecord(character.data) && characterId) {
          void importRegexScriptsForCharacter({ characterId, character }).catch((error: unknown) => {
            toast.warning(`Couldn't import its regex scripts: ${warningReason(error)}`);
          });
        }
      } catch (error) {
        toast.error(
          toUserMessage(error, {
            fallback: "Couldn't import this character. Check your internet connection, then try again.",
          }),
        );
      } finally {
        setImporting(false);
      }
    },
    [queryClient],
  );

  return { importing, runImport };
}
