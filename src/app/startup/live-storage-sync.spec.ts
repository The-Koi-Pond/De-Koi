import { describe, expect, it } from "vitest";
import { chatKeys } from "../../features/catalog/chats/query-keys";
import { isTranscriptCollection, queryPrefixesForCollections, reconnectDelayMs } from "./live-storage-sync";

describe("live storage sync", () => {
  it("refreshes the open transcript and the chat list for message and chat writes", () => {
    const prefixes = queryPrefixesForCollections(["messages", "chats", "messages"]);
    // The prefixes must match the real query keys, or other devices silently stop refreshing.
    const messagesKey = chatKeys.messages("chat-1");
    const listKey = chatKeys.list();
    expect(prefixes?.some((prefix) => prefix.every((part, index) => messagesKey[index] === part))).toBe(true);
    expect(prefixes?.some((prefix) => prefix.every((part, index) => listKey[index] === part))).toBe(true);
    expect(new Set(prefixes?.map((prefix) => prefix.join("/"))).size).toBe(prefixes?.length);
  });

  it("refreshes everything after the server says this client fell behind, and nothing for unknown collections", () => {
    expect(queryPrefixesForCollections(["messages", "*"])).toBeNull();
    expect(queryPrefixesForCollections(["background-jobs"])).toEqual([]);
  });

  it("holds message refreshes during a reply and backs off reconnects", () => {
    expect(isTranscriptCollection("messages")).toBe(true);
    expect(isTranscriptCollection("chats")).toBe(false);
    expect([1, 2, 3, 10].map(reconnectDelayMs)).toEqual([1000, 2000, 4000, 15000]);
  });
});
