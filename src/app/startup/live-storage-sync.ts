/** Query-key prefixes to refresh when another client changed a storage collection. */
const COLLECTION_QUERY_PREFIXES: Record<string, ReadonlyArray<readonly string[]>> = {
  messages: [
    ["chats", "messages"],
    ["chats", "messageCount"],
  ],
  "message-swipes": [["chats", "messages"]],
  chats: [
    ["chats", "list"],
    ["chats", "detail"],
    ["chats", "group"],
  ],
  characters: [["characters"]],
  personas: [["personas"]],
  lorebooks: [["lorebooks"]],
  connections: [["connections"]],
  agents: [["agents"]],
};

/** Message collections: refreshing them mid-reply would fight this tab's own streaming text. */
const TRANSCRIPT_COLLECTIONS = new Set(["messages", "message-swipes"]);

export const ALL_COLLECTIONS = "*";

/**
 * Query-key prefixes for a set of changed collections; `null` means refresh everything (the server reported
 * that this client fell behind). Unknown collections refresh nothing: their screens load fresh when opened.
 */
export function queryPrefixesForCollections(collections: Iterable<string>): Array<readonly string[]> | null {
  const prefixes = new Map<string, readonly string[]>();
  for (const collection of collections) {
    if (collection === ALL_COLLECTIONS) return null;
    for (const prefix of COLLECTION_QUERY_PREFIXES[collection] ?? []) prefixes.set(prefix.join("\u0000"), prefix);
  }
  return [...prefixes.values()];
}

export function isTranscriptCollection(collection: string): boolean {
  return TRANSCRIPT_COLLECTIONS.has(collection);
}

/** Wait before reconnecting after the stream dropped: 1s, 2s, 4s ... capped at 15s. */
export function reconnectDelayMs(failures: number): number {
  return Math.min(15_000, 1_000 * 2 ** Math.max(0, failures - 1));
}
