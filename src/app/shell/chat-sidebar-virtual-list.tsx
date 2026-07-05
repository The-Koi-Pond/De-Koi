import { useEffect, useMemo, useRef, type CSSProperties, type ReactNode } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Reorder } from "framer-motion";

type ChatEntryLike = {
  chat: {
    id: string;
    groupId?: string | null;
  };
};

type FolderLike = {
  id: string;
  collapsed?: boolean;
};

export type ChatSidebarVirtualRow<TFolder extends FolderLike, TEntry extends ChatEntryLike> =
  | {
      type: "section";
      key: string;
      section: "pinned" | "unfiled";
      label: string;
    }
  | {
      type: "folder";
      key: string;
      folder: TFolder;
      entriesCount: number;
    }
  | {
      type: "chat";
      key: string;
      entry: TEntry;
      folderId: string | null;
      depth: 0 | 1;
    };

export function buildChatSidebarListRows<TFolder extends FolderLike, TEntry extends ChatEntryLike>({
  pinnedChats,
  localFolderOrder,
  modeFolders,
  folderChatsMap,
  unfiledChats,
  includeUnfiledDropZone = unfiledChats.length > 0,
}: {
  pinnedChats: TEntry[];
  localFolderOrder: string[];
  modeFolders: TFolder[];
  folderChatsMap: Map<string, TEntry[]>;
  unfiledChats: TEntry[];
  includeUnfiledDropZone?: boolean;
}): ChatSidebarVirtualRow<TFolder, TEntry>[] {
  const rows: ChatSidebarVirtualRow<TFolder, TEntry>[] = [];
  const foldersById = new Map(modeFolders.map((folder) => [folder.id, folder]));

  if (pinnedChats.length > 0) {
    rows.push({ type: "section", key: "section:pinned", section: "pinned", label: "Pinned" });
    for (const entry of pinnedChats) {
      rows.push({ type: "chat", key: `chat:${entry.chat.groupId ?? entry.chat.id}`, entry, folderId: null, depth: 0 });
    }
  }

  for (const folderId of localFolderOrder) {
    const folder = foldersById.get(folderId);
    if (!folder) continue;
    const entries = folderChatsMap.get(folderId) ?? [];
    rows.push({ type: "folder", key: `folder:${folder.id}`, folder, entriesCount: entries.length });
    if (!folder.collapsed) {
      for (const entry of entries) {
        rows.push({ type: "chat", key: `chat:${entry.chat.groupId ?? entry.chat.id}`, entry, folderId, depth: 1 });
      }
    }
  }

  if (includeUnfiledDropZone) {
    rows.push({ type: "section", key: "section:unfiled", section: "unfiled", label: "Unfiled" });
  }
  for (const entry of unfiledChats) {
    rows.push({ type: "chat", key: `chat:${entry.chat.groupId ?? entry.chat.id}`, entry, folderId: null, depth: 0 });
  }

  return rows;
}

function estimateSidebarRowSize(row: ChatSidebarVirtualRow<FolderLike, ChatEntryLike>): number {
  switch (row.type) {
    case "section":
      return row.section === "pinned" ? 26 : 12;
    case "folder":
      return 36;
    case "chat":
    default:
      return 50;
  }
}

export function ChatSidebarVirtualList<TFolder extends FolderLike, TEntry extends ChatEntryLike>({
  rows,
  activeChatId,
  activeGroupId,
  localFolderOrder,
  onFolderReorder,
  renderChatRow,
  renderFolderHeader,
  renderSectionHeader,
}: {
  rows: ChatSidebarVirtualRow<TFolder, TEntry>[];
  activeChatId: string | null;
  activeGroupId: string | null;
  localFolderOrder: string[];
  onFolderReorder: (folderIds: string[]) => void;
  renderChatRow: (entry: TEntry, row: Extract<ChatSidebarVirtualRow<TFolder, TEntry>, { type: "chat" }>) => ReactNode;
  renderFolderHeader: (
    row: Extract<ChatSidebarVirtualRow<TFolder, TEntry>, { type: "folder" }>,
    style: CSSProperties,
  ) => ReactNode;
  renderSectionHeader: (
    row: Extract<ChatSidebarVirtualRow<TFolder, TEntry>, { type: "section" }>,
    style: CSSProperties,
  ) => ReactNode;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) => estimateSidebarRowSize(rows[index] ?? rows[0]!),
    getItemKey: (index) => rows[index]?.key ?? index,
    overscan: 8,
    useAnimationFrameWithResizeObserver: true,
  });

  const activeRowIndex = useMemo(() => {
    if (!activeChatId && !activeGroupId) return -1;
    return rows.findIndex((row) => {
      if (row.type !== "chat") return false;
      return row.entry.chat.id === activeChatId || (!!activeGroupId && row.entry.chat.groupId === activeGroupId);
    });
  }, [activeChatId, activeGroupId, rows]);

  useEffect(() => {
    if (activeRowIndex >= 0) {
      rowVirtualizer.scrollToIndex(activeRowIndex, { align: "auto" });
    }
  }, [activeRowIndex, rowVirtualizer]);

  return (
    <div ref={scrollRef} className="stagger-children min-h-0 flex-1 overflow-y-auto pr-1">
      <Reorder.Group
        axis="y"
        values={localFolderOrder}
        onReorder={onFolderReorder}
        as="div"
        className="relative"
        style={{ height: rowVirtualizer.getTotalSize() }}
      >
        {rowVirtualizer.getVirtualItems().map((virtualRow) => {
          const row = rows[virtualRow.index];
          if (!row) return null;
          const style: CSSProperties = {
            position: "absolute",
            left: 0,
            top: virtualRow.start,
            width: "100%",
          };

          if (row.type === "folder") {
            return renderFolderHeader(row, style);
          }

          if (row.type === "section") {
            return renderSectionHeader(row, style);
          }

          return (
            <div key={row.key} data-index={virtualRow.index} style={style} className="pb-0.5">
              {renderChatRow(row.entry, row)}
            </div>
          );
        })}
      </Reorder.Group>
    </div>
  );
}
