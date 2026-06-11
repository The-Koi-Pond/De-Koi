import * as g from "./game-api-support";

export function journalFromMeta(meta: Record<string, unknown>): g.Journal {
  const raw = g.asRecord(meta.gameJournal);
  return {
    entries: Array.isArray(raw.entries) ? (raw.entries as g.Journal["entries"]) : [],
    quests: Array.isArray(raw.quests) ? (raw.quests as g.Journal["quests"]) : [],
    locations: Array.isArray(raw.locations) ? (raw.locations as string[]) : [],
    npcLog: Array.isArray(raw.npcLog) ? (raw.npcLog as g.Journal["npcLog"]) : [],
    inventoryLog: Array.isArray(raw.inventoryLog) ? (raw.inventoryLog as g.Journal["inventoryLog"]) : [],
  };
}

export function journalFromChat(
  chat: g.Chat,
  meta: Record<string, unknown> = g.chatMeta(chat),
  options: { includeCurrentLocation?: boolean; syncInventory?: boolean } = {},
): g.Journal {
  const gameState = g.asRecord((chat as { gameState?: unknown }).gameState);
  const playerStats = gameState.playerStats == null ? null : g.clonePlayerStats(gameState.playerStats);
  return g.syncJournalFromGameState(journalFromMeta(meta), {
    gameNpcs: Array.isArray(meta.gameNpcs) ? (meta.gameNpcs as g.GameNpc[]) : [],
    playerStats,
    currentLocation:
      options.includeCurrentLocation === true && typeof gameState.location === "string" ? gameState.location : null,
    syncInventory: options.syncInventory,
  });
}
