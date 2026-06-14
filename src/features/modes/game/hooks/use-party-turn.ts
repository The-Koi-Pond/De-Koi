// ──────────────────────────────────────────────
// Hook: usePartyTurn
//
// Generates party member reactions to the GM narration.
// ──────────────────────────────────────────────

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { parsePartyDialogue } from "../lib/party-dialogue-parser";
import { useUIStore } from "../../../../shared/stores/ui.store";
import { gameApi } from "../api/game-api";
import { chatKeys } from "../../../catalog/chats/index";
import { lorebookKeys } from "../../../catalog/lorebooks/index";
import { useGameModeStore } from "../stores/game-mode.store";
import type { GameNpc, PartyDialogueLine } from "../../../../engine/contracts/types/game";

interface PartyTurnInput {
  chatId: string;
  narration: string;
  playerAction?: string;
  connectionId?: string;
  debugMode?: boolean;
}

interface PartyTurnResult {
  raw: string;
  lines: PartyDialogueLine[];
  messageId: string | null;
  npcs?: GameNpc[];
}

async function generatePartyTurn(input: PartyTurnInput): Promise<PartyTurnResult> {
  const debugMode = useUIStore.getState().debugMode;
  const res = await gameApi.partyTurn({ ...input, debugMode });
  const lines = parsePartyDialogue(res.raw);
  return { raw: res.raw, lines, messageId: res.messageId ?? null, npcs: res.npcs };
}

export function usePartyTurn() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: generatePartyTurn,
    onSuccess: (result, variables) => {
      if (result.npcs) {
        const store = useGameModeStore.getState();
        if (store.activeSessionChatId === variables.chatId) {
          store.setNpcs(result.npcs);
        }
        qc.invalidateQueries({ queryKey: chatKeys.detail(variables.chatId) });
      }
      qc.invalidateQueries({ queryKey: chatKeys.messages(variables.chatId) });
      qc.invalidateQueries({ queryKey: chatKeys.messageCount(variables.chatId) });
      qc.invalidateQueries({ queryKey: lorebookKeys.active(variables.chatId) });
    },
  });
}
