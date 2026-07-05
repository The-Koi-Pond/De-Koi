import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ChatSidebarVirtualList, buildChatSidebarListRows, type ChatSidebarVirtualRow } from "./chat-sidebar-virtual-list";

const virtualIndexes = Array.from({ length: 12 }, (_, index) => index);
const scrollToIndex = vi.fn();

vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: vi.fn(({ count }: { count: number }) => ({
    getTotalSize: () => count * 44,
    getVirtualItems: () =>
      virtualIndexes
        .filter((index) => index < count)
        .map((index) => ({
          index,
          key: `virtual-${index}`,
          start: index * 44,
          size: 44,
        })),
    scrollToIndex,
  })),
}));

type TestChat = {
  id: string;
  folderId?: string | null;
  metadata?: { pinned?: boolean };
};

type TestFolder = {
  id: string;
  name: string;
  collapsed?: boolean;
};

function chat(id: string, folderId: string | null = null): { chat: TestChat; branchCount: number } {
  return {
    chat: {
      id,
      folderId,
      metadata: {},
    },
    branchCount: 1,
  };
}

describe("chat sidebar virtual list", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  beforeEach(() => {
    container = document.createElement("div");
    Object.defineProperty(container, "clientHeight", { configurable: true, value: 420 });
    document.body.appendChild(container);
    scrollToIndex.mockClear();
  });

  afterEach(() => {
    act(() => root?.unmount());
    root = null;
    container?.remove();
    container = null;
  });

  it("flattens pinned, folder, and unfiled rows while honoring collapsed folders", () => {
    const folder: TestFolder = { id: "folder-a", name: "Folder A", collapsed: false };
    const collapsed: TestFolder = { id: "folder-b", name: "Folder B", collapsed: true };
    const rows = buildChatSidebarListRows({
      pinnedChats: [chat("pinned")],
      localFolderOrder: [folder.id, collapsed.id],
      modeFolders: [folder, collapsed],
      folderChatsMap: new Map([
        [folder.id, [chat("folder-chat", folder.id)]],
        [collapsed.id, [chat("hidden-chat", collapsed.id)]],
      ]),
      unfiledChats: [chat("unfiled")],
    });

    expect(rows.map((row) => row.key)).toEqual([
      "section:pinned",
      "chat:pinned",
      "folder:folder-a",
      "chat:folder-chat",
      "folder:folder-b",
      "section:unfiled",
      "chat:unfiled",
    ]);
  });

  it("mounts only virtualized rows from large chat lists and scrolls active chat into view", () => {
    const rows: ChatSidebarVirtualRow<TestFolder, ReturnType<typeof chat>>[] = buildChatSidebarListRows({
      pinnedChats: [],
      localFolderOrder: [],
      modeFolders: [],
      folderChatsMap: new Map(),
      unfiledChats: Array.from({ length: 1_000 }, (_, index) => chat(`chat-${index}`)),
    });

    act(() => {
      root = createRoot(container!);
      root.render(
        <ChatSidebarVirtualList
          rows={rows}
          activeChatId="chat-900"
          activeGroupId={null}
          localFolderOrder={[]}
          onFolderReorder={() => undefined}
          renderChatRow={(entry) => <div data-chat-row data-chat-id={entry.chat.id} />}
          renderFolderHeader={() => <div data-folder-row />}
          renderSectionHeader={(row) => <div data-section-row>{row.label}</div>}
        />,
      );
    });

    expect(container!.querySelectorAll("[data-chat-row]").length).toBeLessThan(20);
    expect(container!.querySelector('[data-chat-id="chat-999"]')).toBeNull();
    expect(scrollToIndex).toHaveBeenCalledWith(901, { align: "auto" });
  });

  it("keeps folder rows vertically offset when reorder items own transform", () => {
    const folderA: TestFolder = { id: "folder-a", name: "DBD", collapsed: true };
    const folderB: TestFolder = { id: "folder-b", name: "Freak Circus", collapsed: true };
    const rows: ChatSidebarVirtualRow<TestFolder, ReturnType<typeof chat>>[] = buildChatSidebarListRows({
      pinnedChats: [],
      localFolderOrder: [folderA.id, folderB.id],
      modeFolders: [folderA, folderB],
      folderChatsMap: new Map(),
      unfiledChats: [],
      includeUnfiledDropZone: false,
    });

    act(() => {
      root = createRoot(container!);
      root.render(
        <ChatSidebarVirtualList
          rows={rows}
          activeChatId={null}
          activeGroupId={null}
          localFolderOrder={[folderA.id, folderB.id]}
          onFolderReorder={() => undefined}
          renderChatRow={(entry) => <div data-chat-row data-chat-id={entry.chat.id} />}
          renderFolderHeader={(row, style) => (
            <div data-folder-row={row.folder.name} style={{ ...style, transform: "none" }} />
          )}
          renderSectionHeader={(row) => <div data-section-row>{row.label}</div>}
        />,
      );
    });

    const folderRows = Array.from(container!.querySelectorAll<HTMLElement>("[data-folder-row]"));
    expect(folderRows).toHaveLength(2);
    expect(folderRows.map((row) => row.style.top)).toEqual(["0px", "44px"]);
  });
});
