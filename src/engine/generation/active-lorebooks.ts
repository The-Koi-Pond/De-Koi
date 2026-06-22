import type { StorageGateway } from "../capabilities/storage";
import {
  lorebookActivatedEntryForEvent,
  scanActiveLorebooks,
  type BudgetSkippedLorebookEntry,
  type LorebookSemanticScanStatus,
} from "./active-lorebook-scanner";
import { loadChatMessages, requireRecord } from "./context";
import { loadCharacters, loadPersona } from "./prompt-assembly";
import { hiddenFromAi, readString, type JsonRecord } from "./runtime-records";
import { resolveVisibleGameStateAnchor } from "./generate-route-utils";
import { selectTrackerSnapshotForGeneration } from "./tracker-snapshots";

export interface ActiveLorebookScanResult {
  entries: Array<{
    id: string;
    name: string;
    content: string;
    keys: string[];
    lorebookId: string;
    order: number;
    constant: boolean;
  }>;
  budgetSkippedEntries: BudgetSkippedLorebookEntry[];
  totalTokens: number;
  totalEntries: number;
  semanticStatus: LorebookSemanticScanStatus;
}

interface ActiveLorebookScanOptions {
  includeTestScanTrigger?: boolean;
}

function selectMessagesForLastGenerationScan(messages: JsonRecord[]): JsonRecord[] {
  const visibleMessages = messages.filter((message) => !hiddenFromAi(message));
  let lastGeneratedIndex = -1;
  for (let index = visibleMessages.length - 1; index >= 0; index--) {
    const role = readString(visibleMessages[index]?.role);
    if (role === "assistant" || role === "narrator") {
      lastGeneratedIndex = index;
      break;
    }
  }
  return lastGeneratedIndex >= 0 ? visibleMessages.slice(0, lastGeneratedIndex) : visibleMessages;
}

function activeInfoGenerationTriggers(chat: JsonRecord, options: ActiveLorebookScanOptions): string[] {
  const mode = readString(chat.mode || chat.chatMode).trim();
  const modeTrigger = mode === "game" ? "game" : mode || "roleplay";
  const triggers = options.includeTestScanTrigger ? ["test_scan", modeTrigger, "chat"] : [modeTrigger, "chat"];
  return Array.from(new Set(triggers));
}

export async function scanActiveLorebookEntries(
  storage: StorageGateway,
  chatId: string,
  options: ActiveLorebookScanOptions = {},
): Promise<ActiveLorebookScanResult> {
  const rawChat = requireRecord(await storage.get("chats", chatId), "Chat");
  const storedMessages = await loadChatMessages(storage, chatId);
  const chatMode = readString(rawChat.mode || rawChat.chatMode).trim();

  // For game-mode chats, resolve the visible-anchor game state snapshot
  // so the preview matches what generation actually sees.
  let chat = rawChat;
  if (chatMode === "game") {
    try {
      const visibleAnchor = resolveVisibleGameStateAnchor(storedMessages);
      if (visibleAnchor) {
        const snapshot = await selectTrackerSnapshotForGeneration(storage, chatId, {
          preferLatestVisible: true,
          visibleAnchor,
        });
        if (snapshot) {
          chat = { ...rawChat, gameState: snapshot as unknown as JsonRecord };
        }
      }
    } catch {
      // Fall through to raw chat.gameState
    }
  }

  const characters = await loadCharacters(storage, chat);
  const persona = await loadPersona(storage, chat);
  const scan = await scanActiveLorebooks({
    storage,
    chat,
    characters,
    persona,
    storedMessages: selectMessagesForLastGenerationScan(storedMessages),
    request: {},
    latestUserInput: "",
    generationTriggers: activeInfoGenerationTriggers(chat, options),
    embeddingSource: null,
  });
  const entries = scan.processedLore.includedEntries.map((entry) => {
    const event = lorebookActivatedEntryForEvent(entry);
    return {
      id: event.id,
      name: event.name,
      content: event.content,
      keys: event.matchedKeys,
      lorebookId: event.lorebookId,
      order: event.order,
      constant: event.constant,
    };
  });
  return {
    entries,
    budgetSkippedEntries: scan.budgetSkippedLorebookEntries,
    totalTokens: Math.ceil(entries.reduce((sum, entry) => sum + entry.content.length, 0) / 4),
    totalEntries: entries.length,
    semanticStatus: scan.semanticStatus,
  };
}
