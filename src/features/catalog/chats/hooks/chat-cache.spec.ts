import { QueryClient } from "@tanstack/react-query";
import { afterEach, describe, expect, it } from "vitest";

import type { Chat } from "../../../../engine/contracts/types/chat";
import { useChatStore } from "../../../../shared/stores/chat.store";
import { chatKeys } from "../query-keys";
import {
  applyChatMetadataPatch,
  setChatCacheRecord,
  syncBranchedChatCacheRecord,
  syncChatBranchCacheRows,
  upsertChatCacheRecord,
  upsertChatCacheRows,
  type ChatCacheRecord,
} from "./chat-cache";

function record(id: string, groupId: string | null = null): ChatCacheRecord {
  return { id, name: id, groupId };
}

afterEach(() => {
  useChatStore.getState().reset();
});

describe("chat cache helpers", () => {
  it("propagates metadata patches into loaded chat summaries", () => {
    const qc = new QueryClient();
    qc.setQueryData(chatKeys.summaries(), [
      { ...record("chat-1"), metadata: { autonomousMessages: false, pinned: true } },
    ]);

    setChatCacheRecord(qc, "chat-1", (chat) => applyChatMetadataPatch(chat, { autonomousMessages: true }));

    expect(qc.getQueryData<ChatCacheRecord[]>(chatKeys.summaries())).toEqual([
      { ...record("chat-1"), metadata: { autonomousMessages: true, pinned: true } },
    ]);
  });

  it("upserts created chats into loaded list, group, and detail caches", () => {
    const qc = new QueryClient();
    const chat = record("new-chat", "group-1");
    qc.setQueryData(chatKeys.list(), [record("existing")]);
    qc.setQueryData(chatKeys.summaries(), [record("summary")]);
    qc.setQueryData(chatKeys.recentSummaries(2), [record("recent-1"), record("recent-2")]);
    qc.setQueryData(chatKeys.group("group-1"), [record("source", "group-1")]);

    upsertChatCacheRecord(qc, chat);

    expect(qc.getQueryData(chatKeys.detail("new-chat"))).toEqual(chat);
    expect(qc.getQueryData<ChatCacheRecord[]>(chatKeys.list())?.map((row) => row.id)).toEqual(["new-chat", "existing"]);
    expect(qc.getQueryData<ChatCacheRecord[]>(chatKeys.summaries())?.map((row) => row.id)).toEqual([
      "new-chat",
      "summary",
    ]);
    expect(qc.getQueryData<ChatCacheRecord[]>(chatKeys.recentSummaries(2))?.map((row) => row.id)).toEqual([
      "new-chat",
      "recent-1",
    ]);
    expect(qc.getQueryData<ChatCacheRecord[]>(chatKeys.group("group-1"))?.map((row) => row.id)).toEqual([
      "new-chat",
      "source",
    ]);
  });

  it("syncs a branched chat into loaded caches and patches the source chat group", () => {
    const qc = new QueryClient();
    const source = record("source", null);
    const branch = record("branch", "group-1");
    qc.setQueryData(chatKeys.detail("source"), source);
    qc.setQueryData(chatKeys.list(), [source, record("other")]);
    qc.setQueryData(chatKeys.summaries(), [source, record("summary")]);
    qc.setQueryData(chatKeys.recentSummaries(2), [source, record("recent")]);
    qc.setQueryData(chatKeys.group("group-1"), [source]);
    useChatStore.getState().setActiveChat(source as unknown as Chat);

    syncBranchedChatCacheRecord(qc, "source", branch);

    expect(qc.getQueryData(chatKeys.detail("branch"))).toEqual(branch);
    expect(qc.getQueryData(chatKeys.detail("source"))).toMatchObject({ id: "source", groupId: "group-1" });
    expect(qc.getQueryData<ChatCacheRecord[]>(chatKeys.list())).toEqual([
      branch,
      { ...source, groupId: "group-1" },
      record("other"),
    ]);
    expect(qc.getQueryData<ChatCacheRecord[]>(chatKeys.summaries())).toEqual([
      branch,
      { ...source, groupId: "group-1" },
      record("summary"),
    ]);
    expect(qc.getQueryData<ChatCacheRecord[]>(chatKeys.recentSummaries(2))).toEqual([
      branch,
      { ...source, groupId: "group-1" },
    ]);
    expect(qc.getQueryData<ChatCacheRecord[]>(chatKeys.group("group-1"))).toEqual([
      branch,
      { ...source, groupId: "group-1" },
    ]);
    expect(useChatStore.getState().activeChat).toMatchObject({ id: "source", groupId: "group-1" });
  });

  it("adds the patched source to a loaded target group cache that did not contain it", () => {
    const qc = new QueryClient();
    const source = record("source", null);
    const branch = record("branch", "group-1");
    qc.setQueryData(chatKeys.detail("source"), source);
    qc.setQueryData(chatKeys.list(), [source]);
    qc.setQueryData(chatKeys.summaries(), [source]);
    qc.setQueryData(chatKeys.group("group-1"), [record("sibling", "group-1")]);
    useChatStore.getState().setActiveChat(source as unknown as Chat);

    syncBranchedChatCacheRecord(qc, "source", branch);

    expect(qc.getQueryData<ChatCacheRecord[]>(chatKeys.group("group-1"))).toEqual([
      branch,
      { ...source, groupId: "group-1" },
      record("sibling", "group-1"),
    ]);
    expect(qc.getQueryData(chatKeys.detail("source"))).toMatchObject({ id: "source", groupId: "group-1" });
    expect(qc.getQueryData<ChatCacheRecord[]>(chatKeys.list())).toEqual([branch, { ...source, groupId: "group-1" }]);
    expect(qc.getQueryData<ChatCacheRecord[]>(chatKeys.summaries())).toEqual([
      branch,
      { ...source, groupId: "group-1" },
    ]);
    expect(useChatStore.getState().activeChat).toMatchObject({ id: "source", groupId: "group-1" });
  });

  it("uses the loaded group source row when no other source cache is loaded", () => {
    const qc = new QueryClient();
    const source = record("source", null);
    const branch = record("branch", "group-1");
    qc.setQueryData(chatKeys.group("group-1"), [source]);

    syncBranchedChatCacheRecord(qc, "source", branch);

    expect(qc.getQueryData<ChatCacheRecord[]>(chatKeys.group("group-1"))).toEqual([
      branch,
      { ...source, groupId: "group-1" },
    ]);
    expect(qc.getQueryData(chatKeys.detail("source"))).toBeUndefined();
  });

  it("keeps unloaded query caches unloaded", () => {
    const qc = new QueryClient();

    upsertChatCacheRecord(qc, record("new-chat", "group-1"));

    expect(qc.getQueryData(chatKeys.detail("new-chat"))).toEqual(record("new-chat", "group-1"));
    expect(qc.getQueryData(chatKeys.list())).toBeUndefined();
    expect(qc.getQueryData(chatKeys.summaries())).toBeUndefined();
    expect(qc.getQueryData(chatKeys.group("group-1"))).toBeUndefined();
  });

  it("updates row arrays without requiring a query client", () => {
    expect(upsertChatCacheRows([record("existing")], record("created"))).toEqual([
      record("created"),
      record("existing"),
    ]);
    expect(syncChatBranchCacheRows([record("source"), record("other")], "source", record("branch", "group-1"))).toEqual(
      [record("branch", "group-1"), record("source", "group-1"), record("other")],
    );
  });
});
