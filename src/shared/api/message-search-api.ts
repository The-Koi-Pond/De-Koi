import { invokeTauri } from "./tauri-client";

export type MessageSearchMode = "conversation" | "roleplay" | "fanfic";

export interface MessageSearchQuery {
  query: string;
  mode?: MessageSearchMode;
  chatId?: string;
  limit?: number;
}

export interface MessageSearchResult {
  chatId: string;
  chatName: string;
  chatMode: string;
  messageId: string;
  role: "user" | "assistant" | "narrator";
  characterId: string | null;
  createdAt: string;
  /** A short window of the message around the first match, with "…" where it was cut. */
  snippet: string;
  /** Character offsets of each matched term inside `snippet`, as [start, length]. */
  highlights: Array<[number, number]>;
}

export interface MessageSearchResponse {
  results: MessageSearchResult[];
  totalMatches: number;
  truncated: boolean;
}

/** Text search over saved chat messages (embedded or hosted runtime), newest match first. */
export const messageSearchApi = {
  search: (query: MessageSearchQuery, signal?: AbortSignal) =>
    invokeTauri<MessageSearchResponse>("chat_messages_search", { body: query }, { signal }),
};
