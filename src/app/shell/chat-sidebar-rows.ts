export type ChatSidebarSortOption = "newest" | "oldest" | "name-asc" | "name-desc";

export type ChatSidebarRowInput = {
  id: string;
  name?: unknown;
  groupId?: string | null;
  updatedAt: string | number | Date;
};

export type ChatSidebarRow<TChat extends ChatSidebarRowInput = ChatSidebarRowInput> = {
  chat: TChat;
  branchCount: number;
};

type PreparedChat<TChat extends ChatSidebarRowInput> = {
  chat: TChat;
  updatedAtMs: number;
};

type DeriveChatSidebarRowsOptions<TChat extends ChatSidebarRowInput> = {
  allChats: readonly TChat[];
  filteredChats: readonly TChat[];
  activeChatId: string | null;
  lastActiveChatIdsByGroup: ReadonlyMap<string, string>;
  sort: ChatSidebarSortOption;
};

function toSearchText(value: unknown): string {
  return typeof value === "string" ? value : value == null ? "" : String(value);
}

function comparePreparedChats<TChat extends ChatSidebarRowInput>(
  sort: ChatSidebarSortOption,
  a: PreparedChat<TChat>,
  b: PreparedChat<TChat>,
): number {
  switch (sort) {
    case "oldest":
      return a.updatedAtMs - b.updatedAtMs;
    case "name-asc":
      return toSearchText(a.chat.name).localeCompare(toSearchText(b.chat.name));
    case "name-desc":
      return toSearchText(b.chat.name).localeCompare(toSearchText(a.chat.name));
    case "newest":
    default:
      return b.updatedAtMs - a.updatedAtMs;
  }
}

export function deriveChatSidebarRows<TChat extends ChatSidebarRowInput>({
  allChats,
  filteredChats,
  activeChatId,
  lastActiveChatIdsByGroup,
  sort,
}: DeriveChatSidebarRowsOptions<TChat>): ChatSidebarRow<TChat>[] {
  const totalGroupSizes = new Map<string, number>();
  let activeChatExists = activeChatId === null;

  for (const chat of allChats) {
    if (chat.id === activeChatId) activeChatExists = true;
    if (chat.groupId) {
      totalGroupSizes.set(chat.groupId, (totalGroupSizes.get(chat.groupId) ?? 0) + 1);
    }
  }

  const prepared = filteredChats.map((chat) => ({
    chat,
    updatedAtMs: new Date(chat.updatedAt).getTime(),
  }));
  prepared.sort((a, b) => comparePreparedChats(sort, a, b));

  const sortedChatById = new Map<string, PreparedChat<TChat>>();
  for (const item of prepared) {
    sortedChatById.set(item.chat.id, item);
  }

  const activeFilteredChat = activeChatId && activeChatExists ? sortedChatById.get(activeChatId)?.chat : undefined;
  const seenGroups = new Set<string>();
  const result: ChatSidebarRow<TChat>[] = [];

  for (const item of prepared) {
    const { chat } = item;
    const groupId = chat.groupId;
    if (groupId) {
      if (seenGroups.has(groupId)) continue;
      seenGroups.add(groupId);
      const rememberedChatId = lastActiveChatIdsByGroup.get(groupId);
      const rememberedChat = rememberedChatId ? sortedChatById.get(rememberedChatId)?.chat : undefined;
      const representative =
        activeFilteredChat?.groupId === groupId
          ? activeFilteredChat
          : rememberedChat?.groupId === groupId
            ? rememberedChat
            : chat;
      result.push({ chat: representative, branchCount: totalGroupSizes.get(groupId) ?? 1 });
      continue;
    }

    result.push({ chat, branchCount: 1 });
  }

  return result;
}
