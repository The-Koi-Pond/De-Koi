import { useEffect, useMemo, useRef, type CSSProperties, type ReactNode } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";

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
      /** "FOLDERS (n)" with its create button, and a hint while there are none. */
      type: "section";
      key: string;
      section: "folders";
      label: string;
      folderCount: number;
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
  pinnedOnly = false,
}: {
  pinnedChats: TEntry[];
  localFolderOrder: string[];
  modeFolders: TFolder[];
  folderChatsMap: Map<string, TEntry[]>;
  unfiledChats: TEntry[];
  includeUnfiledDropZone?: boolean;
  /** The Pinned filter: pinned chats only live in the Pinned section, so folders would all show empty. */
  pinnedOnly?: boolean;
}): ChatSidebarVirtualRow<TFolder, TEntry>[] {
  const rows: ChatSidebarVirtualRow<TFolder, TEntry>[] = [];
  const foldersById = new Map(modeFolders.map((folder) => [folder.id, folder]));

  if (pinnedChats.length > 0) {
    rows.push({ type: "section", key: "section:pinned", section: "pinned", label: "Pinned" });
    for (const entry of pinnedChats) {
      rows.push({ type: "chat", key: `chat:${entry.chat.groupId ?? entry.chat.id}`, entry, folderId: null, depth: 0 });
    }
  }

  // With no folders yet the heading would only repeat the Folder button above the list, so it waits for the first one.
  if (!pinnedOnly && modeFolders.length > 0) {
    rows.push({
      type: "section",
      key: "section:folders",
      section: "folders",
      label: "Folders",
      folderCount: modeFolders.length,
    });
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
  }

  if (includeUnfiledDropZone) {
    rows.push({ type: "section", key: "section:unfiled", section: "unfiled", label: "Unfiled" });
  }
  for (const entry of unfiledChats) {
    rows.push({ type: "chat", key: `chat:${entry.chat.groupId ?? entry.chat.id}`, entry, folderId: null, depth: 0 });
  }

  return rows;
}

/** Spread on a row's outer element so the list measures its real height (rows grow with text size and layout). */
export type ChatSidebarRowMeasure = {
  ref: ((node: Element | null) => void) | undefined;
  "data-index": number;
};

// First guesses only: every row is measured once it renders.
function estimateSidebarRowSize(row: ChatSidebarVirtualRow<FolderLike, ChatEntryLike>): number {
  switch (row.type) {
    case "section":
      if (row.section === "folders") return row.folderCount > 0 ? 32 : 80;
      return row.section === "pinned" ? 26 : 12;
    case "folder":
      return 36;
    case "chat":
    default:
      return 74;
  }
}

export function ChatSidebarVirtualList<TFolder extends FolderLike, TEntry extends ChatEntryLike>({
  rows,
  activeChatId,
  activeGroupId,
  renderChatRow,
  renderFolderHeader,
  renderSectionHeader,
}: {
  rows: ChatSidebarVirtualRow<TFolder, TEntry>[];
  activeChatId: string | null;
  activeGroupId: string | null;
  renderChatRow: (entry: TEntry, row: Extract<ChatSidebarVirtualRow<TFolder, TEntry>, { type: "chat" }>) => ReactNode;
  renderFolderHeader: (
    row: Extract<ChatSidebarVirtualRow<TFolder, TEntry>, { type: "folder" }>,
    style: CSSProperties,
    measure: ChatSidebarRowMeasure,
  ) => ReactNode;
  renderSectionHeader: (
    row: Extract<ChatSidebarVirtualRow<TFolder, TEntry>, { type: "section" }>,
    style: CSSProperties,
    measure: ChatSidebarRowMeasure,
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
      <div className="relative" style={{ height: rowVirtualizer.getTotalSize() }}>
        {rowVirtualizer.getVirtualItems().map((virtualRow) => {
          const row = rows[virtualRow.index];
          if (!row) return null;
          const style: CSSProperties = {
            position: "absolute",
            left: 0,
            top: virtualRow.start,
            width: "100%",
          };
          const measure: ChatSidebarRowMeasure = {
            ref: rowVirtualizer.measureElement,
            "data-index": virtualRow.index,
          };

          if (row.type === "folder") {
            return renderFolderHeader(row, style, measure);
          }

          if (row.type === "section") {
            return renderSectionHeader(row, style, measure);
          }

          return (
            <div key={row.key} {...measure} style={style} className="pb-0.5">
              {renderChatRow(row.entry, row)}
            </div>
          );
        })}
      </div>
    </div>
  );
}
