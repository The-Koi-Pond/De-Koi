import { describe, expect, it } from "vitest";

import { deriveChatSidebarRows, type ChatSidebarRowInput, type ChatSidebarSortOption } from "./chat-sidebar-rows";

type LegacyRow = {
  chat: ChatSidebarRowInput;
  branchCount: number;
};

function toSearchText(value: unknown): string {
  return typeof value === "string" ? value : value == null ? "" : String(value);
}

function deriveLegacyRows({
  allChats,
  filteredChats,
  activeChatId,
  lastActiveChatIdsByGroup,
  sort,
}: {
  allChats: ChatSidebarRowInput[];
  filteredChats: ChatSidebarRowInput[];
  activeChatId: string | null;
  lastActiveChatIdsByGroup: ReadonlyMap<string, string>;
  sort: ChatSidebarSortOption;
}): LegacyRow[] {
  const totalGroupSizes = new Map<string, number>();
  for (const chat of allChats) {
    if (chat.groupId) {
      totalGroupSizes.set(chat.groupId, (totalGroupSizes.get(chat.groupId) ?? 0) + 1);
    }
  }

  const sorted = [...filteredChats].sort((a, b) => {
    switch (sort) {
      case "oldest":
        return new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime();
      case "name-asc":
        return toSearchText(a.name).localeCompare(toSearchText(b.name));
      case "name-desc":
        return toSearchText(b.name).localeCompare(toSearchText(a.name));
      case "newest":
      default:
        return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    }
  });

  const activeChat = activeChatId ? allChats.find((chat) => chat.id === activeChatId) : undefined;
  const activeFilteredChat = activeChat ? sorted.find((chat) => chat.id === activeChat.id) : undefined;
  const seenGroups = new Set<string>();
  const result: LegacyRow[] = [];

  for (const chat of sorted) {
    if (chat.groupId) {
      if (seenGroups.has(chat.groupId)) continue;
      seenGroups.add(chat.groupId);
      const rememberedChatId = lastActiveChatIdsByGroup.get(chat.groupId);
      const rememberedChat = rememberedChatId ? sorted.find((item) => item.id === rememberedChatId) : undefined;
      const representative =
        activeFilteredChat?.groupId === chat.groupId
          ? activeFilteredChat
          : rememberedChat?.groupId === chat.groupId
            ? rememberedChat
            : chat;
      result.push({ chat: representative, branchCount: totalGroupSizes.get(chat.groupId) ?? 1 });
    } else {
      result.push({ chat, branchCount: 1 });
    }
  }

  return result;
}

function makeChat(index: number, overrides: Partial<ChatSidebarRowInput> = {}): ChatSidebarRowInput {
  const updatedAt = new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString();
  return {
    id: `chat-${index}`,
    name: `Chat ${String(index).padStart(4, "0")}`,
    groupId: null,
    updatedAt,
    ...overrides,
  };
}

function buildLargeChatList(): ChatSidebarRowInput[] {
  const chats: ChatSidebarRowInput[] = [];
  for (let groupIndex = 0; groupIndex < 360; groupIndex += 1) {
    const groupId = `group-${groupIndex}`;
    for (let branchIndex = 0; branchIndex < 3; branchIndex += 1) {
      const index = groupIndex * 4 + branchIndex;
      chats.push(
        makeChat(index, {
          id: `${groupId}-branch-${branchIndex}`,
          name: `Grouped ${String(groupIndex).padStart(3, "0")} branch ${branchIndex}`,
          groupId,
          updatedAt: new Date(Date.UTC(2026, 0, 1, 0, groupIndex, branchIndex)).toISOString(),
        }),
      );
    }
    chats.push(makeChat(groupIndex * 4 + 3));
  }
  return chats;
}

function signature(rows: LegacyRow[]): Array<{ id: string; branchCount: number }> {
  return rows.map((row) => ({ id: row.chat.id, branchCount: row.branchCount }));
}

describe("deriveChatSidebarRows", () => {
  it("matches the legacy grouped output for a large filtered chat list", () => {
    const allChats = buildLargeChatList();
    const hiddenIds = new Set(["group-12-branch-1", "group-99-branch-2", "chat-203"]);
    const filteredChats = allChats.filter((chat) => !hiddenIds.has(chat.id));
    const lastActiveChatIdsByGroup = new Map([
      ["group-12", "group-12-branch-2"],
      ["group-99", "group-99-branch-2"],
      ["group-144", "group-144-branch-1"],
    ]);

    for (const sort of ["newest", "oldest", "name-asc", "name-desc"] satisfies ChatSidebarSortOption[]) {
      const legacyRows = deriveLegacyRows({
        allChats,
        filteredChats,
        activeChatId: "group-144-branch-2",
        lastActiveChatIdsByGroup,
        sort,
      });
      const optimizedRows = deriveChatSidebarRows({
        allChats,
        filteredChats,
        activeChatId: "group-144-branch-2",
        lastActiveChatIdsByGroup,
        sort,
      });

      expect(signature(optimizedRows)).toEqual(signature(legacyRows));
    }
  });
});
