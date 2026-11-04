// ──────────────────────────────────────────────
// Layout: Chat Sidebar (polished with rich buttons)
// ──────────────────────────────────────────────
import {
  MessageSquare,
  Trash2,
  BookOpen,
  GitBranch,
  AlertTriangle,
  FolderOpen,
  FolderPlus,
  ChevronDown,
  ChevronRight,
  GripVertical,
  CheckSquare,
  Square as SquareIcon,
  Tag,
  Pencil,
  Upload,
  X,
  Star,
  Loader2,
  ListChecks,
  Feather,
} from "lucide-react";
import {
  useBulkExportChats,
  useChatSummaries,
  useDeleteChat,
  useDeleteChatGroup,
  useDeleteChats,
  useUpdateChatMetadata,
  confirmChatDeletion,
  type BulkChatExportFormat,
} from "../../features/catalog/chats/sidebar";
import {
  useChatFolders,
  useCreateFolder,
  useUpdateFolder,
  useDeleteFolder,
  useReorderFolders,
  useMoveChat,
} from "../../features/catalog/chats/sidebar";
import { useChatSurfaceCharacterSummariesByIds } from "../../features/catalog/characters/index";
import { useChatStore } from "../../shared/stores/chat.store";
import { useSetupJourneyStore } from "../../shared/stores/setup-journey.store";
import { revealSetupJourney } from "../../shared/lib/setup-journey-reveal";
import { showConfirmDialog } from "../../shared/lib/app-dialogs";
import { confirmDiscardPendingAppWork } from "../../shared/lib/app-close-guard";
import { useUIStore } from "../../shared/stores/ui.store";
import { cn, copyToClipboard } from "../../shared/lib/utils";
import { AvatarImage } from "../../shared/components/ui/AvatarImage";
import { TagInput } from "../../shared/components/ui/TagInput";
import { useState, useCallback, useMemo, useRef, useEffect, type CSSProperties, type DragEvent } from "react";
import { toast } from "sonner";
import { CHAT_MODES } from "../../engine/contracts/constants/chat-modes";
import type { ChatFolder } from "../../engine/contracts/types/chat";
import { Modal } from "../../shared/components/ui/Modal";
import { parseChatMetadata, normalizeChatCharacterIds } from "../../shared/lib/chat-display";
import { isNewChatJourneyPending, useStartNewChat } from "./useStartNewChat";
import { ColumnCollapseButton } from "./ColumnCollapseButton";
import { UserStatusBar } from "./UserStatusBar";
import {
  CatalogActionBar,
  CatalogFilterPill,
  CatalogFilterRow,
  CatalogRowActions,
  CatalogSearchStrip,
  TagFilterChip,
  TagFilterClear,
  catalogRowActionsRowProps,
  tagFilterSummary,
  type CatalogRowAction,
} from "../../features/catalog/components/CatalogPanelControls";
import { ModeIcon } from "../../shared/components/ModeIcon";
import { CHAT_MODE_LUCIDE_ICONS, ChatModeSwitch, type ChatSidebarTab } from "./ChatModeSwitch";
import { chatRowCharacterNames, formatChatLastActive } from "./chat-sidebar-meta";
import {
  NO_TAG_FILTERS,
  cycleTagFilter,
  hasTagFilters,
  keepExistingTagFilters,
  matchesTagFilters,
  type TagFilters,
} from "../../features/catalog/lib/tag-filters";
import { predictiveChatIntentHandlers } from "./predictive-chat-preload";
import { usePredictiveChatPreload } from "./use-predictive-chat-preload";
import {
  ChatSidebarVirtualList,
  buildChatSidebarListRows,
  type ChatSidebarRowMeasure,
} from "./chat-sidebar-virtual-list";
import { ChatSidebarMessageResults } from "./ChatSidebarMessageResults";
import { MESSAGE_SEARCH_MIN_CHARS } from "../../features/catalog/chats/sidebar";
import type { MessageSearchResult } from "../../shared/api/message-search-api";
import { useMessageJumpStore } from "../../shared/stores/message-jump.store";
import {
  deleteSingleChatWithConfirmation,
  deleteSelectedChatsSequentially,
  formatDeleteSelectedChatsError,
} from "./chat-sidebar-batch-actions";
import {
  deriveChatSidebarRows,
  type ChatSidebarRow as DerivedChatSidebarRow,
  type ChatSidebarSortOption,
} from "./chat-sidebar-rows";
import { buildChatSidebarCharacterLookup, type ChatSidebarCharacterAvatar } from "./chat-sidebar-character-avatars";
import { CHAT_ROW_TITLE_CLASS_NAME } from "./chat-sidebar-row-layout";
import {
  chatSidebarRetryNote,
  getChatSidebarRecovery,
  type ChatSidebarRecovery,
  type ChatSidebarRecoveryActionId,
} from "./chat-sidebar-recovery";
import { buildSupportReportText } from "../../shared/lib/support-report";
import { toUserMessage } from "../../shared/lib/error-message";
import { presenceDotClass } from "../../shared/lib/status-shapes";
type ChatSortOption = ChatSidebarSortOption;
export type { ChatSidebarTab };
type ChatSidebarRow = DerivedChatSidebarRow<NonNullable<ReturnType<typeof useChatSummaries>["data"]>[number]>;
type ChatDropTarget = { folderId: string | null } | null;

export function runChatSidebarNewChatAction({
  mode,
  isMobile,
  closeSidebar,
  startNewChat,
}: {
  mode: ChatSidebarTab;
  isMobile: boolean;
  closeSidebar: () => void;
  startNewChat: (mode: ChatSidebarTab) => void;
}) {
  if (isMobile) closeSidebar();
  startNewChat(mode);
}

export function runChatSidebarRevealSetupAction({
  isMobile,
  closeSidebar,
  revealSetup,
}: {
  isMobile: boolean;
  closeSidebar: () => void;
  revealSetup: () => boolean;
}) {
  // On phones the sidebar drawer covers the checklist, so get it out of the way first.
  if (isMobile) closeSidebar();
  revealSetup();
}

export type ChatSidebarRecoveryActionDependencies = {
  retry: () => void;
  create: () => void;
  clearFilters: () => void;
  connectServer: () => void;
  openConnections: () => void;
  viewHealth: () => void;
  copySupportDetails: () => void;
};

export function runChatSidebarRecoveryAction(
  actionId: ChatSidebarRecoveryActionId,
  actions: ChatSidebarRecoveryActionDependencies,
) {
  const actionById: Record<ChatSidebarRecoveryActionId, () => void> = {
    retry: actions.retry,
    create: actions.create,
    "clear-filters": actions.clearFilters,
    "connect-server": actions.connectServer,
    "open-connections": actions.openConnections,
    "view-health": actions.viewHealth,
    "copy-support-details": actions.copySupportDetails,
  };
  actionById[actionId]();
}

export function ChatSidebarRecoveryView({
  recovery,
  isFetching = false,
  onAction,
}: {
  recovery: ChatSidebarRecovery;
  isFetching?: boolean;
  onAction: (actionId: ChatSidebarRecoveryActionId) => void;
}) {
  const renderAction = (action: ChatSidebarRecovery["primaryAction"], primary: boolean) => (
    <button
      type="button"
      onClick={() => onAction(action.id)}
      disabled={action.id === "retry" && isFetching}
      className={cn(
        "min-h-9 rounded-lg px-3 py-1.5 text-[0.6875rem] font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--ring)] disabled:cursor-not-allowed disabled:opacity-60",
        primary
          ? "bg-[var(--primary)]/15 text-[var(--primary)] hover:bg-[var(--primary)]/25"
          : "bg-[var(--secondary)] text-[var(--foreground)] hover:bg-[var(--sidebar-accent)]",
      )}
    >
      {action.id === "retry" && isFetching ? "Checking..." : action.label}
    </button>
  );
  return (
    <>
      <p className="text-xs font-semibold text-[var(--foreground)]">{recovery.title}</p>
      <p className="max-w-[16rem] text-[0.6875rem] leading-relaxed text-[var(--muted-foreground)]">
        {recovery.description}
      </p>
      <div className="mt-1 flex flex-wrap items-center justify-center gap-2">
        {renderAction(recovery.primaryAction, true)}
        {recovery.secondaryAction && renderAction(recovery.secondaryAction, false)}
      </div>
    </>
  );
}

type ChatSidebarProps = {
  activeTab: ChatSidebarTab;
  onActiveTabChange: (tab: ChatSidebarTab) => void;
  onRequestClose: () => void;
  /** In the Pond rail layout: the header's fold-away "‹" (see ColumnCollapseButton). */
  onCollapse?: () => void;
  /** The status bar is the strip along the window's bottom, so the chat list leaves its own out. */
  statusInStrip?: boolean;
};

const CHAT_DRAG_MIME = "application/x-de-koi-chat-id";
const FOLDER_DRAG_MIME = "application/x-de-koi-folder-id";

function hasDataTransferType(event: DragEvent<HTMLElement>, type: string) {
  return Array.from(event.dataTransfer.types).includes(type);
}

function getChatTags(chat: { metadata?: { tags?: unknown } | null }): string[] {
  return Array.isArray(chat.metadata?.tags)
    ? chat.metadata.tags.filter((tag): tag is string => typeof tag === "string" && tag.trim().length > 0)
    : [];
}

function isChatPinned(chat: { metadata?: unknown }): boolean {
  return parseChatMetadata(chat.metadata).pinned === true;
}

function getNextUnnamedChatFolderName(folders: ChatFolder[]): string {
  const names = new Set(folders.map((folder) => folder.name.trim().toLowerCase()).filter(Boolean));
  if (!names.has("new folder")) return "New Folder";
  let index = 2;
  while (names.has(`new folder ${index}`)) index += 1;
  return `New Folder ${index}`;
}

function toSearchText(value: unknown): string {
  return typeof value === "string" ? value : value == null ? "" : String(value);
}

const MODE_CONFIG: Record<
  string,
  {
    icon: React.ReactNode;
    label: string;
    shortLabel: string;
    bg: string;
    iconForeground: string;
    description: string;
    comingSoon?: boolean;
  }
> = {
  conversation: {
    icon: <MessageSquare size="0.75rem" />,
    label: CHAT_MODES.conversation.name,
    shortLabel: CHAT_MODES.conversation.name,
    bg: "linear-gradient(135deg, #ff9a66 0%, #ff7a4a 54%, #9c3c27 100%)",
    iconForeground: "#fff4e8",
    description: CHAT_MODES.conversation.description,
  },
  roleplay: {
    icon: <BookOpen size="0.75rem" />,
    label: CHAT_MODES.roleplay.name,
    shortLabel: CHAT_MODES.roleplay.name,
    bg: "linear-gradient(135deg, #5ce7df 0%, #22b8b5 52%, #086873 100%)",
    iconForeground: "#f4eadb",
    description: CHAT_MODES.roleplay.description,
  },
  fanfic: {
    icon: <Feather size="0.75rem" />,
    label: CHAT_MODES.fanfic.name,
    shortLabel: CHAT_MODES.fanfic.name,
    bg: "linear-gradient(135deg, #ffb7c9 0%, #e0607e 55%, #7a2a40 100%)",
    iconForeground: "#fff4f6",
    description: CHAT_MODES.fanfic.description,
  },
};

const SIDEBAR_TAB_NOUNS: Record<ChatSidebarTab, { plural: string; newLabel: string }> = {
  conversation: { plural: "conversations", newLabel: "chat" },
  roleplay: { plural: "roleplays", newLabel: "RP" },
  fanfic: { plural: "fics", newLabel: "fic" },
};

// "Active" is the chat's last change (its updatedAt), the same time the row's second line shows.
const CHAT_SORT_OPTIONS: ReadonlyArray<{ value: ChatSortOption; label: string; short: string }> = [
  { value: "newest", label: "Recently active first", short: "Newest" },
  { value: "oldest", label: "Least recently active first", short: "Oldest" },
  { value: "name-asc", label: "Name, A to Z", short: "A-Z" },
  { value: "name-desc", label: "Name, Z to A", short: "Z-A" },
];

const NO_UNREAD_BY_TAB: Record<ChatSidebarTab, number> = { conversation: 0, roleplay: 0, fanfic: 0 };

export function ChatSidebar({
  activeTab,
  onActiveTabChange,
  onRequestClose,
  onCollapse,
  statusInStrip = false,
}: ChatSidebarProps) {
  const {
    data: chats,
    error: chatsLoadError,
    isError: chatsError,
    isLoading,
    isFetching,
    failureCount: chatsFailureCount,
    failureReason: chatsFailureReason,
    refetch: refetchChats,
  } = useChatSummaries();
  const deleteChat = useDeleteChat();
  const deleteChats = useDeleteChats();
  const deleteChatGroup = useDeleteChatGroup();
  const updateChatMetadata = useUpdateChatMetadata();
  const bulkExportChats = useBulkExportChats();
  const activeChatId = useChatStore((s) => s.activeChatId);
  const requestChatPreload = usePredictiveChatPreload({ chats: chats ?? [], activeChatId });
  const setActiveChatId = useChatStore((s) => s.setActiveChatId);
  const unreadCounts = useChatStore((s) => s.unreadCounts);
  const hydrateUnread = useChatStore((s) => s.hydrateUnread);
  const hasAnyDetailOpen = useUIStore((s) => s.hasAnyDetailOpen);
  const closeAllDetails = useUIStore((s) => s.closeAllDetails);
  const openRightPanel = useUIStore((s) => s.openRightPanel);
  const setSettingsTab = useUIStore((s) => s.setSettingsTab);
  const startNewChat = useStartNewChat();
  const newChatJourneyPending = useSetupJourneyStore((state) => isNewChatJourneyPending(state.intent));

  // Folder hooks
  const { data: folders } = useChatFolders();
  const createFolderMut = useCreateFolder();
  const updateFolderMut = useUpdateFolder();
  const deleteFolderMut = useDeleteFolder();
  const reorderFoldersMut = useReorderFolders();
  const moveChatMut = useMoveChat();

  const sidebarCharacterIds = useMemo(() => {
    const ids = new Set<string>();
    for (const chat of chats ?? []) {
      for (const id of normalizeChatCharacterIds((chat as { characterIds?: unknown }).characterIds)) {
        ids.add(id);
      }
      const metadata = parseChatMetadata(chat.metadata);
      if (Array.isArray(metadata.autonomousUnreadCharacterIds)) {
        for (const id of metadata.autonomousUnreadCharacterIds) {
          if (typeof id === "string" && id.trim()) ids.add(id.trim());
        }
      }
    }
    return Array.from(ids);
  }, [chats]);
  const { data: allCharacters } = useChatSurfaceCharacterSummariesByIds(
    sidebarCharacterIds,
    sidebarCharacterIds.length > 0,
  );
  const charLookup = useMemo(() => buildChatSidebarCharacterLookup(allCharacters), [allCharacters]);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchScope, setSearchScope] = useState<"chats" | "messages">("chats");
  const [sort, setSort] = useState<ChatSortOption>("newest");
  const [tagFilters, setTagFilters] = useState<TagFilters>(NO_TAG_FILTERS);
  const [tagsExpanded, setTagsExpanded] = useState(false);
  const [pinnedOnly, setPinnedOnly] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{
    chatId: string;
    groupId: string | null;
    branchCount: number;
  } | null>(null);
  // The rows' "2h ago" moves on by itself.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  // Folder UI state
  const [tagEditingChatId, setTagEditingChatId] = useState<string | null>(null);
  const [tagDraftTags, setTagDraftTags] = useState<string[]>([]);
  const [tagDraftInput, setTagDraftInput] = useState("");
  const [draggedChatId, setDraggedChatId] = useState<string | null>(null);
  const [chatDropTarget, setChatDropTarget] = useState<ChatDropTarget>(null);
  const [draggedFolderId, setDraggedFolderId] = useState<string | null>(null);
  const [folderDropTargetId, setFolderDropTargetId] = useState<string | null>(null);

  // Multi-select state
  const [multiSelectMode, setMultiSelectMode] = useState(false);
  const [selectedChatIds, setSelectedChatIds] = useState<Set<string>>(new Set());
  const [lastActiveChatIdsByGroup, setLastActiveChatIdsByGroup] = useState<Map<string, string>>(() => new Map());
  const [batchExportMenuOpen, setBatchExportMenuOpen] = useState(false);
  const [batchDeleteProgress, setBatchDeleteProgress] = useState<{ done: number; total: number } | null>(null);
  const batchDeleteRunningRef = useRef(false);

  const toggleSelectChat = useCallback((chatId: string) => {
    setSelectedChatIds((prev) => {
      const next = new Set(prev);
      if (next.has(chatId)) next.delete(chatId);
      else next.add(chatId);
      return next;
    });
  }, []);

  const exitMultiSelect = useCallback(() => {
    setMultiSelectMode(false);
    setSelectedChatIds(new Set());
    setBatchExportMenuOpen(false);
  }, []);

  // Exit multi-select when switching tabs
  useEffect(() => {
    exitMultiSelect();
    setTagFilters(NO_TAG_FILTERS);
    setTagsExpanded(false);
    setPinnedOnly(false);
  }, [activeTab, exitMultiSelect]);

  const modeChats = useMemo(() => (chats ?? []).filter((chat) => chat.mode === activeTab), [chats, activeTab]);

  const unreadByTab = useMemo(() => {
    const counts = { ...NO_UNREAD_BY_TAB };
    for (const chat of chats ?? []) {
      if (chat.mode in counts) counts[chat.mode as ChatSidebarTab] += unreadCounts.get(chat.id) || 0;
    }
    return counts;
  }, [chats, unreadCounts]);

  const allTags = useMemo(() => {
    const tags = new Set<string>();
    for (const chat of modeChats) {
      for (const tag of getChatTags(chat)) tags.add(tag);
    }
    return [...tags].sort((a, b) => a.localeCompare(b));
  }, [modeChats]);

  // A filter on a tag no chat has any more would quietly hide the whole list.
  useEffect(() => {
    setTagFilters((filters) => keepExistingTagFilters(filters, allTags));
  }, [allTags]);

  // Detect if active chat belongs to a group (so its group row highlights)
  const activeChat = useMemo(() => chats?.find((c) => c.id === activeChatId), [chats, activeChatId]);
  const activeGroupId = activeChat?.groupId ?? null;

  useEffect(() => {
    if (!activeChat?.groupId) return;
    const groupId = activeChat.groupId;
    setLastActiveChatIdsByGroup((previous) => {
      if (previous.get(groupId) === activeChat.id) return previous;
      const next = new Map(previous);
      next.set(groupId, activeChat.id);
      return next;
    });
  }, [activeChat?.groupId, activeChat?.id]);

  const filtered = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();

    return modeChats.filter((chat) => {
      if (pinnedOnly && !isChatPinned(chat)) return false;
      const tags = getChatTags(chat);
      if (!matchesTagFilters(tags, tagFilters)) return false;
      if (!query) return true;

      const characterNames = normalizeChatCharacterIds((chat as { characterIds?: unknown }).characterIds)
        .map((characterId) => charLookup.get(characterId)?.name ?? "")
        .filter(Boolean);

      return (
        toSearchText(chat.name).toLowerCase().includes(query) ||
        tags.some((tag) => tag.toLowerCase().includes(query)) ||
        characterNames.some((name) => name.toLowerCase().includes(query))
      );
    });
  }, [modeChats, pinnedOnly, searchQuery, tagFilters, charLookup]);

  // Message text search runs for Conversation and Roleplay; the Chats/Messages switch shows once the query is long enough.
  const messageSearchAvailable = activeTab !== "fanfic" && searchQuery.trim().length >= MESSAGE_SEARCH_MIN_CHARS;
  const showMessageResults = messageSearchAvailable && searchScope === "messages";

  // ── Collapse chats that share a groupId into one entry ──
  const displayChats = useMemo(
    () =>
      deriveChatSidebarRows({
        allChats: chats ?? [],
        filteredChats: filtered,
        activeChatId,
        lastActiveChatIdsByGroup,
        sort,
      }),
    [activeChatId, chats, filtered, lastActiveChatIdsByGroup, sort],
  );

  // ── Folder grouping ──
  const modeFolders = useMemo(() => {
    if (!folders) return [] as ChatFolder[];
    return folders.filter((f) => f.mode === activeTab).sort((a, b) => a.sortOrder - b.sortOrder);
  }, [folders, activeTab]);

  const { pinnedChats, unfiledChats, folderChatsMap } = useMemo(() => {
    if (!displayChats.length) {
      return {
        pinnedChats: [] as typeof displayChats,
        unfiledChats: displayChats,
        folderChatsMap: new Map<string, typeof displayChats>(),
      };
    }
    const pinned: typeof displayChats = [];
    const unfiled: typeof displayChats = [];
    const map = new Map<string, typeof displayChats>();
    for (const entry of displayChats) {
      if (isChatPinned(entry.chat)) {
        pinned.push(entry);
        continue;
      }
      const fid = entry.chat.folderId;
      if (!fid) {
        unfiled.push(entry);
        continue;
      }
      if (!map.has(fid)) map.set(fid, []);
      map.get(fid)!.push(entry);
    }
    return { pinnedChats: pinned, unfiledChats: unfiled, folderChatsMap: map };
  }, [displayChats]);

  const [localFolderOrder, setLocalFolderOrder] = useState<string[]>([]);
  useEffect(() => {
    setLocalFolderOrder(modeFolders.map((f) => f.id));
  }, [modeFolders]);

  const sidebarRows = useMemo(
    () =>
      buildChatSidebarListRows({
        pinnedChats,
        localFolderOrder,
        modeFolders,
        folderChatsMap,
        unfiledChats,
        includeUnfiledDropZone: unfiledChats.length > 0 || draggedChatId !== null,
      }),
    [draggedChatId, folderChatsMap, localFolderOrder, modeFolders, pinnedChats, unfiledChats],
  );

  useEffect(() => {
    const allChats = chats ?? [];
    const unread = allChats
      .map((chat) => {
        const metadata = parseChatMetadata(chat.metadata);
        const count = typeof metadata.autonomousUnreadCount === "number" ? metadata.autonomousUnreadCount : 0;
        if (count <= 0) return null;
        const characterId =
          (Array.isArray(metadata.autonomousUnreadCharacterIds)
            ? metadata.autonomousUnreadCharacterIds.find((id): id is string => typeof id === "string")
            : null) ?? normalizeChatCharacterIds(chat.characterIds)[0];
        const character = characterId ? charLookup.get(characterId) : null;
        return {
          chatId: chat.id,
          count,
          characterName: character?.name ?? "Someone",
          avatarUrl: character?.avatarUrl ?? null,
          avatarCrop: character?.avatarCrop ?? null,
        };
      })
      .filter((item): item is NonNullable<typeof item> => item !== null);
    hydrateUnread(
      unread,
      allChats.map((chat) => chat.id),
    );
  }, [chats, charLookup, hydrateUnread]);

  // ── Sync sidebar tab + folder with the currently active chat ──
  // Covers: recent-chat clicks, page refresh, connected-chat switch,
  // scene navigation, notification bubbles, branch switch, import, etc.
  //
  // Uses a structured ref so each concern (tab, folder, scroll) resolves
  // independently — folder expansion retries when folders load late, and
  // scroll waits until both tab and folder are settled.
  const syncRef = useRef<{ chatId: string | null; tabSynced: boolean; folderSynced: boolean }>({
    chatId: null,
    tabSynced: false,
    folderSynced: false,
  });
  // When true the next sync skips clearing the search query — set by
  // the sidebar's own click handler so clicking a search result doesn't
  // wipe the filter the user is actively browsing.
  const internalNavRef = useRef(false);
  useEffect(() => {
    if (!activeChatId || !chats?.length) return;

    const chat = chats.find((c) => c.id === activeChatId);
    if (!chat) return;

    const s = syncRef.current;
    const isNewChat = s.chatId !== activeChatId;
    let needsScroll = false;

    if (isNewChat) {
      s.chatId = activeChatId;
      s.tabSynced = false;
      s.folderSynced = false;
    }

    // 1. Tab sync — once per chat switch
    if (!s.tabSynced) {
      const chatMode = chat.mode as ChatSidebarTab;
      if (chatMode === "conversation" || chatMode === "roleplay" || chatMode === "fanfic") {
        onActiveTabChange(chatMode);
      }
      // Clear search so the active chat isn't hidden by a stale filter.
      // Skip when the navigation originated from a sidebar click (the
      // user is actively browsing search results and shouldn't lose them).
      if (!internalNavRef.current) {
        setSearchQuery("");
        setTagFilters(NO_TAG_FILTERS);
        setTagsExpanded(false);
        setPinnedOnly(false);
      }
      internalNavRef.current = false;
      s.tabSynced = true;
      needsScroll = true;
    }

    // 2. Folder expansion — waits for folders data; if the folder is
    //    collapsed we fire a mutation and stay !folderSynced so the effect
    //    re-runs after the query delivers the expanded state.
    if (!s.folderSynced) {
      if (!chat.folderId) {
        s.folderSynced = true;
      } else if (folders) {
        const folder = folders.find((f) => f.id === chat.folderId);
        if (folder?.collapsed) {
          updateFolderMut.mutate({ id: folder.id, collapsed: false });
          // folderSynced stays false — re-runs after query invalidation
        } else {
          s.folderSynced = true;
          needsScroll = true;
        }
      }
      // else: folders not loaded yet — effect re-runs when they arrive
    }

    // 3. Scroll active chat row into view once both tab + folder are settled
    if (needsScroll && s.tabSynced && s.folderSynced) {
      const timer = setTimeout(() => {
        const el = document.querySelector(`[data-chat-id="${activeChatId}"]`);
        el?.scrollIntoView({ block: "nearest", behavior: "smooth" });
      }, 200);
      return () => clearTimeout(timer);
    }
  }, [activeChatId, chats, folders, onActiveTabChange, updateFolderMut]);

  const handleNewChatFromTab = useCallback(() => {
    runChatSidebarNewChatAction({
      mode: activeTab,
      isMobile: window.innerWidth < 768,
      closeSidebar: onRequestClose,
      startNewChat,
    });
  }, [activeTab, onRequestClose, startNewChat]);
  const handleRevealSetup = useCallback(() => {
    runChatSidebarRevealSetupAction({
      isMobile: window.innerWidth < 768,
      closeSidebar: onRequestClose,
      revealSetup: revealSetupJourney,
    });
  }, [onRequestClose]);

  const clearChatFilters = useCallback(() => {
    setSearchQuery("");
    setTagFilters(NO_TAG_FILTERS);
    setTagsExpanded(false);
    setPinnedOnly(false);
  }, []);

  const selectTab = useCallback(
    async (tab: ChatSidebarTab) => {
      if (tab === activeTab) return true;
      if (
        !(await confirmDiscardPendingAppWork({
          purpose: "navigation",
          title: "Switch chat modes?",
          confirmLabel: "Switch anyway",
        }))
      ) {
        return false;
      }
      onActiveTabChange(tab);
      return true;
    },
    [activeTab, onActiveTabChange],
  );

  const openSettingsTab = useCallback(
    (tab: "advanced" | "health") => {
      openRightPanel("settings");
      setSettingsTab(tab);
    },
    [openRightPanel, setSettingsTab],
  );

  const recoveryActions: ChatSidebarRecoveryActionDependencies = {
    retry: () => void refetchChats(),
    create: newChatJourneyPending ? handleRevealSetup : handleNewChatFromTab,
    clearFilters: clearChatFilters,
    connectServer: () => openSettingsTab("advanced"),
    openConnections: () => openRightPanel("connections"),
    viewHealth: () => openSettingsTab("health"),
    copySupportDetails: () => {
      const report = buildSupportReportText({
        source: "query-error",
        reportText: "The chat list request failed with an unknown error.",
      });
      void copyToClipboard(report).then((copied) => {
        if (copied) toast.success("Support details copied.");
        else toast.error("Couldn't copy the support details. Try again, or copy them from Health.");
      });
    },
  };

  const errorRecovery = getChatSidebarRecovery(chatsLoadError, { mode: activeTab, state: "error" });
  const emptyRecovery = getChatSidebarRecovery(null, {
    mode: activeTab,
    state: "empty",
    hasFilters: Boolean(searchQuery.trim()) || hasTagFilters(tagFilters) || pinnedOnly,
  });

  const runRecoveryAction = (actionId: ChatSidebarRecoveryActionId) =>
    runChatSidebarRecoveryAction(actionId, recoveryActions);

  // ── Folder handlers ──
  const handleCreateFolder = useCallback(() => {
    createFolderMut.mutate({ name: getNextUnnamedChatFolderName(modeFolders), mode: activeTab });
  }, [activeTab, createFolderMut, modeFolders]);

  const handleToggleCollapse = useCallback(
    (folder: ChatFolder) => {
      updateFolderMut.mutate({ id: folder.id, collapsed: !folder.collapsed });
    },
    [updateFolderMut],
  );

  const handleRenameFolder = useCallback(
    (id: string, name: string) => {
      if (!name.trim()) return;
      updateFolderMut.mutate({ id, name: name.trim() });
    },
    [updateFolderMut],
  );

  const handleDeleteFolder = useCallback(
    async (id: string) => {
      if (
        await showConfirmDialog({
          title: "Delete Folder",
          message: "Delete this folder? Chats will be moved to the top level.",
          confirmLabel: "Delete",
          tone: "destructive",
        })
      ) {
        deleteFolderMut.mutate(id);
      }
    },
    [deleteFolderMut],
  );

  const handleFolderReorder = useCallback(
    (newOrder: string[]) => {
      setLocalFolderOrder(newOrder);
      reorderFoldersMut.mutate({ mode: activeTab, orderedIds: newOrder });
    },
    [activeTab, reorderFoldersMut],
  );

  const clearFolderDragState = useCallback(() => {
    setDraggedFolderId(null);
    setFolderDropTargetId(null);
  }, []);

  const handleFolderDragStart = useCallback(
    (event: DragEvent<HTMLDivElement>, folderId: string) => {
      if (modeFolders.length < 2) {
        event.preventDefault();
        return;
      }
      setDraggedFolderId(folderId);
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData(FOLDER_DRAG_MIME, folderId);
      event.dataTransfer.setData("text/plain", folderId);
    },
    [modeFolders.length],
  );

  const handleFolderDragOver = useCallback(
    (event: DragEvent<HTMLDivElement>, targetFolderId: string) => {
      if (!draggedFolderId || draggedFolderId === targetFolderId) return;
      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = "move";
      setFolderDropTargetId((current) => (current === targetFolderId ? current : targetFolderId));
    },
    [draggedFolderId],
  );

  const handleFolderDrop = useCallback(
    (event: DragEvent<HTMLDivElement>, targetFolderId: string) => {
      const folderId = draggedFolderId || event.dataTransfer.getData(FOLDER_DRAG_MIME);
      if (!folderId || folderId === targetFolderId) {
        clearFolderDragState();
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      const withoutDragged = localFolderOrder.filter((id) => id !== folderId);
      const targetIndex = withoutDragged.indexOf(targetFolderId);
      if (targetIndex < 0 || withoutDragged.length === localFolderOrder.length) {
        clearFolderDragState();
        return;
      }
      const nextOrder = [...withoutDragged];
      nextOrder.splice(targetIndex, 0, folderId);
      handleFolderReorder(nextOrder);
      clearFolderDragState();
    },
    [clearFolderDragState, draggedFolderId, handleFolderReorder, localFolderOrder],
  );
  const tagEditingChat = useMemo(
    () => chats?.find((chat) => chat.id === tagEditingChatId) ?? null,
    [chats, tagEditingChatId],
  );

  const openTagEditor = useCallback((chat: ChatSidebarRow["chat"]) => {
    setTagEditingChatId(chat.id);
    setTagDraftTags(getChatTags(chat));
    setTagDraftInput("");
  }, []);

  const closeTagEditor = useCallback(() => {
    setTagEditingChatId(null);
    setTagDraftTags([]);
    setTagDraftInput("");
  }, []);

  const saveTagEditor = useCallback(() => {
    if (!tagEditingChatId) return;
    updateChatMetadata.mutate(
      { id: tagEditingChatId, tags: tagDraftTags },
      {
        onSuccess: () => {
          toast.success("Chat tags updated.");
        },
      },
    );
    closeTagEditor();
  }, [closeTagEditor, tagDraftTags, tagEditingChatId, updateChatMetadata]);

  const clearChatDragState = useCallback(() => {
    setDraggedChatId(null);
    setChatDropTarget(null);
  }, []);

  const handleChatDragStart = useCallback(
    (event: DragEvent<HTMLDivElement>, chatId: string) => {
      if (multiSelectMode || modeFolders.length === 0) {
        event.preventDefault();
        return;
      }
      setDraggedChatId(chatId);
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData(CHAT_DRAG_MIME, chatId);
      event.dataTransfer.setData("text/plain", chatId);
    },
    [modeFolders.length, multiSelectMode],
  );

  const handleChatDragOver = useCallback(
    (event: DragEvent<HTMLDivElement>, folderId: string | null) => {
      if (!draggedChatId) return;
      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = "move";
      setChatDropTarget((current) => (current?.folderId === folderId ? current : { folderId }));
    },
    [draggedChatId],
  );

  const handleChatDragLeave = useCallback((event: DragEvent<HTMLDivElement>) => {
    const nextTarget = event.relatedTarget;
    if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) return;
    setChatDropTarget(null);
  }, []);

  const handleChatDrop = useCallback(
    (event: DragEvent<HTMLDivElement>, folderId: string | null) => {
      event.preventDefault();
      event.stopPropagation();
      const chatId = draggedChatId || event.dataTransfer.getData(CHAT_DRAG_MIME);
      if (!chatId) {
        clearChatDragState();
        return;
      }
      const currentFolderId = chats?.find((chat) => chat.id === chatId)?.folderId ?? null;
      if (currentFolderId !== folderId) {
        moveChatMut.mutate({ chatId, folderId });
      }
      clearChatDragState();
    },
    [chats, clearChatDragState, draggedChatId, moveChatMut],
  );

  // ── Batch actions ──
  const [batchMovingFolder, setBatchMovingFolder] = useState(false);

  const handleSingleChatDelete = useCallback(
    async (chatId: string) => {
      try {
        return await deleteSingleChatWithConfirmation({
          chatId,
          activeChatId,
          confirmDeletion: () => confirmChatDeletion(1),
          deleteChat: deleteChat.mutateAsync,
          setActiveChatId,
        });
      } catch (error) {
        toast.error(toUserMessage(error, { fallback: "Couldn't delete chat. Try again." }));
        return false;
      }
    },
    [activeChatId, deleteChat, setActiveChatId],
  );

  const selectAllDisplayedChats = useCallback(() => {
    setSelectedChatIds(new Set(displayChats.map((row) => row.chat.id)));
  }, [displayChats]);

  const handleBatchDelete = useCallback(async () => {
    // Deletes run one chat at a time and can take seconds each on a remote runtime;
    // a second click must not start a second pass over the same chats.
    if (batchDeleteRunningRef.current || selectedChatIds.size === 0) return;
    batchDeleteRunningRef.current = true;
    try {
      const deletableIds = Array.from(selectedChatIds);
      const confirmation = await confirmChatDeletion(deletableIds.length);
      if (!confirmation.confirmed) return;
      setBatchDeleteProgress({ done: 0, total: deletableIds.length });
      const deletedCount = await deleteSelectedChatsSequentially({
        chatIds: deletableIds,
        activeChatId,
        deleteMemories: confirmation.deleteMemories,
        deleteChats: deleteChats.mutateAsync,
        setActiveChatId,
        exitMultiSelect,
        onProgress: (done, total) => setBatchDeleteProgress({ done, total }),
      });
      toast.success(`Deleted ${deletedCount} chat${deletedCount === 1 ? "" : "s"}`);
    } catch (error) {
      toast.error(formatDeleteSelectedChatsError(error));
    } finally {
      batchDeleteRunningRef.current = false;
      setBatchDeleteProgress(null);
    }
  }, [selectedChatIds, deleteChats, activeChatId, setActiveChatId, exitMultiSelect]);

  const handleBatchExport = useCallback(
    async (format: BulkChatExportFormat) => {
      if (selectedChatIds.size === 0) return;
      await bulkExportChats.mutateAsync({ chatIds: Array.from(selectedChatIds), format });
      exitMultiSelect();
    },
    [selectedChatIds, bulkExportChats, exitMultiSelect],
  );

  const handleBatchMoveToFolder = useCallback(
    (folderId: string | null) => {
      for (const id of selectedChatIds) {
        moveChatMut.mutate({ chatId: id, folderId });
      }
      setBatchMovingFolder(false);
      exitMultiSelect();
    },
    [selectedChatIds, moveChatMut, exitMultiSelect],
  );

  const handleDeleteEntireGroup = useCallback(async () => {
    if (!deleteTarget?.groupId || deleteChatGroup.isPending) return;
    const confirmation = await confirmChatDeletion(deleteTarget.branchCount);
    if (!confirmation.confirmed) return;
    const deletingGroupId = deleteTarget.groupId;
    deleteChatGroup.mutate(
      { groupId: deletingGroupId, deleteMemories: confirmation.deleteMemories },
      {
        onSuccess: () => {
          if (activeGroupId === deletingGroupId) setActiveChatId(null);
          setDeleteTarget(null);
        },
      },
    );
  }, [activeGroupId, deleteChatGroup, deleteTarget, setActiveChatId]);

  const openMessageResult = async (result: MessageSearchResult) => {
    if (
      result.chatId !== activeChatId &&
      !(await confirmDiscardPendingAppWork({
        purpose: "navigation",
        title: "Switch chats?",
        confirmLabel: "Switch anyway",
      }))
    ) {
      return;
    }
    if (hasAnyDetailOpen()) {
      closeAllDetails();
    }
    internalNavRef.current = true;
    setActiveChatId(result.chatId);
    useMessageJumpStore.getState().requestJump(result.chatId, result.messageId);
    useUIStore.getState().setMobileChatToolsOpen(false);
    if (window.innerWidth < 768) onRequestClose();
  };

  // ── Chat row renderer (shared between unfiled + folder sections) ──
  const renderChatRow = ({ chat, branchCount }: ChatSidebarRow) => {
    const cfg = MODE_CONFIG[chat.mode] ?? MODE_CONFIG.conversation;
    const isActive = activeChatId === chat.id || (chat.groupId != null && chat.groupId === activeGroupId);
    const isSelected = selectedChatIds.has(chat.id);
    const pinned = isChatPinned(chat);
    const activateChatRow = async () => {
      if (multiSelectMode) {
        toggleSelectChat(chat.id);
        return;
      }
      if (
        chat.id !== activeChatId &&
        !(await confirmDiscardPendingAppWork({
          purpose: "navigation",
          title: "Switch chats?",
          confirmLabel: "Switch anyway",
        }))
      ) {
        return;
      }
      if (hasAnyDetailOpen()) {
        closeAllDetails();
      }
      internalNavRef.current = true;
      setActiveChatId(chat.id);
      useUIStore.getState().setMobileChatToolsOpen(false);
      if (window.innerWidth < 768) onRequestClose();
    };

    // Second line: when it was last active, then who's in it (unless the name already says).
    const lastActive = formatChatLastActive(chat.updatedAt, now);
    const characterNames = chatRowCharacterNames(
      toSearchText(chat.name),
      normalizeChatCharacterIds((chat as { characterIds?: unknown }).characterIds).map(
        (characterId) => charLookup.get(characterId)?.name ?? "",
      ),
    );
    const metaLine = [lastActive, characterNames].filter(Boolean).join(" · ");
    const metaId = `chat-row-meta-${chat.id}`;

    // Tags, pin and delete, stacked down the row's right edge. Moving to a folder is by dragging or Select's Move.
    const rowActions: CatalogRowAction[] = [
      {
        key: "tags",
        title: "Edit tags",
        label: `Edit tags for ${chat.name}`,
        icon: <Tag size="0.75rem" aria-hidden="true" />,
        className: "text-[var(--muted-foreground)] hover:bg-[var(--accent)] hover:text-[var(--primary)]",
        onClick: () => openTagEditor(chat),
      },
      {
        key: "pin",
        title: pinned ? "Unpin chat" : "Pin chat",
        label: pinned ? `Unpin ${chat.name}` : `Pin ${chat.name}`,
        icon: <Star size="0.75rem" className={pinned ? "fill-current" : undefined} aria-hidden="true" />,
        className: pinned
          ? "text-amber-400 hover:bg-amber-400/10"
          : "text-[var(--muted-foreground)] hover:bg-amber-400/10 hover:text-amber-400",
        onClick: () => {
          if (!updateChatMetadata.isPending) updateChatMetadata.mutate({ id: chat.id, pinned: !pinned });
        },
      },
      {
        key: "delete",
        title: "Delete chat",
        label: `Delete ${chat.name}`,
        icon: <Trash2 size="0.75rem" aria-hidden="true" />,
        className: "text-[var(--destructive)] hover:bg-[var(--destructive)]/15",
        onClick: () => {
          if (branchCount > 1 && chat.groupId) {
            setDeleteTarget({ chatId: chat.id, groupId: chat.groupId, branchCount });
          } else {
            void handleSingleChatDelete(chat.id);
          }
        },
      },
    ];
    const rowActionsProps = catalogRowActionsRowProps(rowActions.length);

    return (
      <div
        key={chat.groupId ?? chat.id}
        data-chat-id={chat.id}
        {...(!multiSelectMode ? predictiveChatIntentHandlers(chat, requestChatPreload) : {})}
        draggable={!multiSelectMode && modeFolders.length > 0}
        onDragStart={(event) => handleChatDragStart(event, chat.id)}
        onDragEnd={clearChatDragState}
        onClick={() => void activateChatRow()}
        style={multiSelectMode ? undefined : rowActionsProps.style}
        className={cn(
          "group relative flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left transition-all duration-150",
          !multiSelectMode && rowActionsProps.className,
          "has-[[data-row-action]:focus-visible]:ring-2 has-[[data-row-action]:focus-visible]:ring-[var(--primary)]/45",
          multiSelectMode && isSelected
            ? "bg-[var(--primary)]/10 ring-1 ring-[var(--primary)]/30"
            : isActive
              ? "bg-[var(--sidebar-accent)] shadow-sm"
              : "hover:bg-[var(--sidebar-accent)]/60",
          draggedChatId === chat.id && "opacity-55 ring-1 ring-[var(--primary)]/30",
        )}
      >
        {/* Multi-select checkbox */}
        {multiSelectMode && (
          <div className="shrink-0 text-[var(--primary)]">
            {isSelected ? (
              <CheckSquare size="0.875rem" />
            ) : (
              <SquareIcon size="0.875rem" className="text-[var(--muted-foreground)]" />
            )}
          </div>
        )}

        {/* Active indicator */}
        {isActive && (
          <span
            className="absolute -left-0.5 top-1/2 h-5 w-1 -translate-y-1/2 rounded-full"
            style={{ background: cfg.bg }}
          />
        )}

        {/* Chat avatar(s) or mode icon fallback — with unread badge overlay */}
        <div className="relative flex-shrink-0">
          {(() => {
            const charIds = normalizeChatCharacterIds((chat as { characterIds?: unknown }).characterIds);
            const avatars = charIds
              .slice(0, 3)
              .map((id) => charLookup.get(id))
              .filter((avatar): avatar is ChatSidebarCharacterAvatar => Boolean(avatar));

            const isConvoMode = chat.mode === "conversation";
            const statusDot = (status?: string) => {
              if (!isConvoMode) return null;
              return (
                <span
                  className={`absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full ring-[1.5px] ring-[var(--sidebar-background)] [--cb-cutout:var(--sidebar-background)] ${presenceDotClass(status)}`}
                />
              );
            };

            if (avatars.length === 0) {
              return (
                <div
                  className={cn(
                    "flex h-7 w-7 items-center justify-center rounded-lg text-xs transition-transform group-active:scale-90",
                    isActive ? "shadow-sm" : "bg-[var(--secondary)] text-[var(--muted-foreground)]",
                  )}
                  style={isActive ? { background: cfg.bg, color: cfg.iconForeground } : undefined}
                >
                  {cfg.icon}
                </div>
              );
            }

            if (avatars.length === 1) {
              const a = avatars[0]!;
              return a.hasAvatarSource ? (
                <div className="relative h-7 w-7 flex-shrink-0 transition-transform group-active:scale-90">
                  <span className="relative block h-7 w-7 overflow-hidden rounded-full">
                    <AvatarImage
                      src={a.avatarUrl}
                      avatarFilePath={a.avatarFilePath}
                      avatarFilename={a.avatarFilename}
                      alt={a.name}
                      crop={a.avatarCrop}
                      thumbnailSize={64}
                    />
                  </span>
                  {statusDot(a.conversationStatus)}
                </div>
              ) : (
                <div className="relative h-7 w-7 flex-shrink-0 transition-transform group-active:scale-90">
                  <div className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--secondary)] text-[0.625rem] font-bold text-[var(--muted-foreground)]">
                    {a.name[0]}
                  </div>
                  {statusDot(a.conversationStatus)}
                </div>
              );
            }

            // Multiple characters — stacked avatars
            return (
              <div className="relative h-7 w-7 flex-shrink-0 transition-transform group-active:scale-90">
                {avatars.slice(0, 2).map((a, i) =>
                  a.hasAvatarSource ? (
                    <span
                      key={i}
                      className={cn(
                        "absolute h-5 w-5 overflow-hidden rounded-full ring-2 ring-[var(--sidebar-background)]",
                        i === 0 ? "top-0 left-0 z-10" : "bottom-0 right-0",
                      )}
                    >
                      <AvatarImage
                        src={a.avatarUrl}
                        avatarFilePath={a.avatarFilePath}
                        avatarFilename={a.avatarFilename}
                        alt={a.name}
                        crop={a.avatarCrop}
                        thumbnailSize={64}
                      />
                    </span>
                  ) : (
                    <div
                      key={i}
                      className={cn(
                        "absolute flex h-5 w-5 items-center justify-center rounded-full bg-[var(--secondary)] text-[0.5625rem] font-bold text-[var(--muted-foreground)] ring-2 ring-[var(--sidebar-background)]",
                        i === 0 ? "top-0 left-0 z-10" : "bottom-0 right-0",
                      )}
                    >
                      {a.name[0]}
                    </div>
                  ),
                )}
              </div>
            );
          })()}

          {/* Unread count badge */}
          {(() => {
            const count = unreadCounts.get(chat.id) || 0;
            if (count === 0 || isActive) return null;
            return (
              <span className="absolute -top-1 -right-1 z-20 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[0.5625rem] font-bold leading-none text-white shadow-sm ring-2 ring-[var(--sidebar-background)]">
                {count > 99 ? "99+" : count}
              </span>
            );
          })()}
        </div>

        {/* Name: the row's button. The row's own action buttons sit outside it. */}
        <div
          role="button"
          tabIndex={0}
          data-row-action
          aria-label={chat.name}
          aria-describedby={metaLine ? metaId : undefined}
          aria-current={isActive ? "true" : undefined}
          aria-pressed={multiSelectMode ? isSelected : undefined}
          onKeyDown={(event) => {
            if (event.target !== event.currentTarget) return;
            if (event.key !== "Enter" && event.key !== " ") return;
            event.preventDefault();
            // Holding the key auto-repeats keydown; activate once.
            if (event.repeat) return;
            void activateChatRow();
          }}
          className={cn(CHAT_ROW_TITLE_CLASS_NAME, "outline-none")}
        >
          <span
            className={cn(
              "block truncate text-sm",
              isActive ? "font-medium text-[var(--sidebar-accent-foreground)]" : "text-[var(--sidebar-foreground)]",
            )}
          >
            {chat.name}
          </span>
          {metaLine && (
            <span id={metaId} className="block truncate text-[0.6875rem] text-[var(--muted-foreground)]">
              {/* Pinned rows sit under the "Pinned" heading; the star keeps them recognisable while the pin button hides. */}
              {pinned && (
                <Star
                  size="0.5625rem"
                  className="mr-1 inline fill-amber-400 align-[-0.0625rem] text-amber-400"
                  aria-hidden="true"
                />
              )}
              {metaLine}
            </span>
          )}
        </div>

        {/* Branch count badge */}
        {branchCount > 1 && (
          <span className="flex shrink-0 items-center gap-0.5 rounded-full bg-[var(--secondary)] px-1.5 py-0.5 text-[0.625rem] font-medium text-[var(--muted-foreground)]">
            <GitBranch size="0.625rem" />
            {branchCount}
          </span>
        )}

        {!multiSelectMode && <CatalogRowActions actions={rowActions} />}
      </div>
    );
  };

  return (
    <nav data-component="ChatSidebar" aria-label="Chat navigation" className="mari-chat-sidebar flex h-full flex-col">
      {/* Header: the mode switch takes the title's place, like Characters | Personas. The fold-away tab
          sits against the left edge; on phones the ✕ is a flush cell at the right edge. */}
      <div
        className={cn(
          "mari-sidebar-header relative flex h-12 flex-shrink-0 items-center gap-1 bg-[var(--card)]/80 backdrop-blur-sm",
          onCollapse ? "pr-1" : "pl-1 md:pr-1",
        )}
      >
        <div className="absolute inset-x-0 bottom-0 h-px bg-[var(--border)]/30" />
        {onCollapse && <ColumnCollapseButton onCollapse={onCollapse} />}
        <h2 className="sr-only">Chats</h2>
        <ChatModeSwitch activeTab={activeTab} unreadByTab={unreadByTab} onSelect={selectTab} />
        <button
          type="button"
          onClick={onRequestClose}
          className="flex w-12 shrink-0 items-center justify-center self-stretch border-l border-[var(--border)]/40 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)] hover:text-[var(--primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--ring)] md:hidden"
          title="Back to chat"
          aria-label="Back to chat"
        >
          <X size="1rem" aria-hidden="true" />
        </button>
      </div>

      {/* The panel's tools, strips touching its edges (like the library panels): New chat · Folder · Select.
          While the setup checklist is open, New points back at it instead of showing a spinner for minutes. */}
      <CatalogActionBar
        tone="koi"
        selectionMode={multiSelectMode}
        onCreate={newChatJourneyPending ? handleRevealSetup : handleNewChatFromTab}
        createLabel={newChatJourneyPending ? "Finish setup" : `New ${SIDEBAR_TAB_NOUNS[activeTab].newLabel}`}
        createTitle={newChatJourneyPending ? "Your new chat opens once setup is finished" : undefined}
        createIcon={
          newChatJourneyPending ? <ListChecks size="0.8125rem" className="shrink-0" aria-hidden="true" /> : undefined
        }
        extraAction={{
          label: "Folder",
          title: "New folder",
          icon: <FolderPlus size="0.8125rem" className="shrink-0" aria-hidden="true" />,
          onClick: handleCreateFolder,
          disabled: createFolderMut.isPending,
        }}
        onToggleSelectionMode={() => (multiSelectMode ? exitMultiSelect() : setMultiSelectMode(true))}
        selectDisabled={batchDeleteProgress !== null || (!multiSelectMode && displayChats.length === 0)}
      />

      {/* Search joined to its sort box; the sort doesn't apply to message results, so it steps aside for them. */}
      {showMessageResults ? (
        <CatalogSearchStrip
          search={searchQuery}
          onSearchChange={setSearchQuery}
          placeholder={`Search ${SIDEBAR_TAB_NOUNS[activeTab].plural}...`}
        />
      ) : (
        <CatalogSearchStrip
          search={searchQuery}
          onSearchChange={setSearchQuery}
          placeholder={`Search ${SIDEBAR_TAB_NOUNS[activeTab].plural}...`}
          sort={sort}
          sortOptions={CHAT_SORT_OPTIONS}
          onSortChange={setSort}
        />
      )}
      {messageSearchAvailable && (
        <div role="tablist" aria-label="Search in" className="grid h-8 grid-cols-2 border-b border-[var(--border)]/60">
          {(["chats", "messages"] as const).map((scope, index) => (
            <button
              key={scope}
              type="button"
              role="tab"
              aria-selected={searchScope === scope}
              onClick={() => setSearchScope(scope)}
              className={cn(
                "text-[0.6875rem] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--ring)]",
                index > 0 && "border-l border-[var(--border)]/60",
                searchScope === scope
                  ? "bg-[var(--primary)]/12 text-[var(--primary)]"
                  : "text-[var(--muted-foreground)] hover:bg-[var(--accent)] hover:text-[var(--foreground)]",
              )}
            >
              {scope === "chats" ? "Chats" : "Messages"}
            </button>
          ))}
        </div>
      )}

      <CatalogFilterRow label="Filter chats">
        <CatalogFilterPill
          active={!pinnedOnly}
          pressed={!pinnedOnly}
          title={`All ${SIDEBAR_TAB_NOUNS[activeTab].plural}`}
          onClick={() => setPinnedOnly(false)}
        >
          All
        </CatalogFilterPill>
        <CatalogFilterPill
          active={pinnedOnly}
          pressed={pinnedOnly}
          title={`Only pinned ${SIDEBAR_TAB_NOUNS[activeTab].plural}`}
          onClick={() => setPinnedOnly(true)}
        >
          <Star size="0.5625rem" className="shrink-0" aria-hidden="true" />
          Pinned
        </CatalogFilterPill>
        {allTags.length > 0 && (
          <CatalogFilterPill
            active={hasTagFilters(tagFilters) || tagsExpanded}
            expanded={tagsExpanded}
            title={tagsExpanded ? "Hide tags" : "Show tags"}
            onClick={() => setTagsExpanded((prev) => !prev)}
          >
            <Tag size="0.625rem" aria-hidden="true" />
            Tags ({allTags.length})
            {tagFilterSummary(tagFilters) && (
              <span className="ml-0.5 opacity-70">· {tagFilterSummary(tagFilters)}</span>
            )}
            <ChevronDown size="0.625rem" className={cn("transition-transform", tagsExpanded && "rotate-180")} />
          </CatalogFilterPill>
        )}
      </CatalogFilterRow>

      {/* Hidden until the Tags pill opens them. Clicking a tag cycles off → include → exclude → off. */}
      {allTags.length > 0 && tagsExpanded && (
        <div className="flex flex-wrap gap-1 border-b border-[var(--border)]/60 p-2">
          {hasTagFilters(tagFilters) && <TagFilterClear onClear={() => setTagFilters(NO_TAG_FILTERS)} />}
          {allTags.map((tag) => (
            <TagFilterChip
              key={tag}
              tag={tag}
              mode={tagFilters[tag]}
              onCycle={() => setTagFilters((filters) => cycleTagFilter(filters, tag))}
            />
          ))}
        </div>
      )}

      {/* Chat list */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-2 py-1">
        {showMessageResults && (
          <ChatSidebarMessageResults
            query={searchQuery}
            mode={activeTab}
            characterName={(characterId) => charLookup.get(characterId)?.name}
            activeMessageChatId={activeChatId}
            onOpen={(result) => void openMessageResult(result)}
          />
        )}
        {!showMessageResults && isLoading && (
          <div className="flex flex-col gap-2 px-2 py-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="shimmer h-10 rounded-lg" />
            ))}
            {chatsFailureCount > 0 && (
              <p role="status" className="px-1 text-[0.6875rem] leading-relaxed text-[var(--muted-foreground)]">
                {chatSidebarRetryNote(chatsFailureReason)}
              </p>
            )}
          </div>
        )}

        {!showMessageResults && chatsError && !isLoading && (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 px-3 py-6 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--destructive)]/10">
              <AlertTriangle size="1.25rem" className="text-[var(--destructive)]" />
            </div>
            <ChatSidebarRecoveryView recovery={errorRecovery} isFetching={isFetching} onAction={runRecoveryAction} />
          </div>
        )}

        {!showMessageResults && displayChats.length === 0 && !isLoading && !chatsError && (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 px-3 py-6 text-center">
            <div className="animate-float flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--secondary)] text-[var(--muted-foreground)]">
              <ModeIcon mode={activeTab} size="1.5rem" fallback={CHAT_MODE_LUCIDE_ICONS[activeTab]("1.25rem")} />
            </div>
            <ChatSidebarRecoveryView recovery={emptyRecovery} onAction={runRecoveryAction} />
          </div>
        )}

        {!showMessageResults && displayChats.length > 0 && !isLoading && !chatsError && (
          <ChatSidebarVirtualList
            rows={sidebarRows}
            activeChatId={activeChatId}
            activeGroupId={activeGroupId}
            renderChatRow={(entry, row) => (
              <div
                data-chat-folder-root={row.folderId === null ? "" : undefined}
                onDragOver={row.folderId === null ? (event) => handleChatDragOver(event, null) : undefined}
                onDragLeave={row.folderId === null ? handleChatDragLeave : undefined}
                onDrop={row.folderId === null ? (event) => handleChatDrop(event, null) : undefined}
                className={cn(
                  row.depth === 1 && "ml-4 border-l border-[var(--border)]/20 pl-1",
                  row.folderId === null && "rounded-lg transition-colors",
                  row.folderId === null && draggedChatId && "min-h-8",
                  row.folderId === null &&
                    chatDropTarget &&
                    chatDropTarget.folderId === null &&
                    "bg-[var(--sidebar-accent)]/45 ring-1 ring-[var(--primary)]/25",
                )}
              >
                {renderChatRow(entry)}
              </div>
            )}
            renderFolderHeader={(row, style, measure) => (
              <FolderHeaderRow
                key={row.key}
                folder={row.folder}
                entriesCount={row.entriesCount}
                style={style}
                measure={measure}
                isDropTarget={chatDropTarget?.folderId === row.folder.id}
                isFolderDropTarget={folderDropTargetId === row.folder.id}
                draggedChatId={draggedChatId}
                draggedFolderId={draggedFolderId}
                onToggleCollapse={handleToggleCollapse}
                onRename={handleRenameFolder}
                onDelete={handleDeleteFolder}
                onChatDragOver={handleChatDragOver}
                onChatDragLeave={handleChatDragLeave}
                onChatDrop={handleChatDrop}
                onFolderDragStart={handleFolderDragStart}
                onFolderDragOver={handleFolderDragOver}
                onFolderDrop={handleFolderDrop}
                onFolderDragEnd={clearFolderDragState}
              />
            )}
            renderSectionHeader={(row, style, measure) =>
              row.section === "pinned" ? (
                <div
                  key={row.key}
                  {...measure}
                  style={style}
                  className="flex items-center gap-1 px-2 py-1 text-[0.5625rem] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]"
                >
                  <Star size="0.625rem" className="fill-amber-400 text-amber-400" />
                  {row.label}
                </div>
              ) : row.section === "folders" ? (
                // Like the library panels' folders heading: its button makes a folder, the same as the Folder cell.
                <div key={row.key} {...measure} style={style} className="px-1 pb-1">
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-1.5 px-1 py-1 text-[0.6875rem] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
                      <FolderOpen size="0.6875rem" aria-hidden="true" />
                      {row.label} ({row.folderCount})
                    </span>
                    <button
                      type="button"
                      onClick={handleCreateFolder}
                      disabled={createFolderMut.isPending}
                      className="rounded-lg p-1 text-[var(--muted-foreground)] transition-all hover:bg-[var(--accent)] hover:text-[var(--primary)] disabled:cursor-wait disabled:opacity-60"
                      title="Create folder"
                      aria-label="Create folder"
                    >
                      <FolderPlus size="0.8125rem" aria-hidden="true" />
                    </button>
                  </div>
                  {row.folderCount === 0 && (
                    <div className="mt-1 rounded-lg border border-dashed border-[var(--border)] px-3 py-2.5 text-center text-[0.625rem] text-[var(--muted-foreground)]">
                      No folders yet - click <FolderPlus size="0.625rem" className="inline" aria-hidden="true" /> to
                      create one
                    </div>
                  )}
                </div>
              ) : (
                <div
                  key={row.key}
                  {...measure}
                  style={style}
                  data-chat-folder-root
                  onDragOver={(event) => handleChatDragOver(event, null)}
                  onDragLeave={handleChatDragLeave}
                  onDrop={(event) => handleChatDrop(event, null)}
                  className={cn(
                    // A small gap under the folders that's also where chats drop out of a folder.
                    "h-3 rounded-lg transition-colors",
                    chatDropTarget &&
                      chatDropTarget.folderId === null &&
                      "bg-[var(--sidebar-accent)]/45 ring-1 ring-[var(--primary)]/25",
                  )}
                />
              )
            }
          />
        )}
      </div>
      {/* ── Multi-select action bar ── */}
      {multiSelectMode && (
        <div className="mari-sidebar-footer border-t border-[var(--border)]/30 bg-[var(--card)]/95 px-3 py-2.5 backdrop-blur-sm">
          <div className="mb-2 flex items-center justify-center gap-2 text-[0.6875rem] font-medium text-[var(--muted-foreground)]">
            {batchDeleteProgress ? (
              <span role="status" className="inline-flex items-center gap-1.5">
                <Loader2 size="0.75rem" className="animate-spin" />
                Deleting… {batchDeleteProgress.done} of {batchDeleteProgress.total} done
              </span>
            ) : (
              <>
                <span>{selectedChatIds.size} selected</span>
                <button
                  type="button"
                  onClick={selectAllDisplayedChats}
                  disabled={displayChats.length === 0 || selectedChatIds.size === displayChats.length}
                  className="rounded-md px-2 py-0.5 text-[var(--primary)] transition-colors hover:bg-[var(--accent)] disabled:opacity-40"
                >
                  Select all
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedChatIds(new Set())}
                  disabled={selectedChatIds.size === 0}
                  className="rounded-md px-2 py-0.5 transition-colors hover:bg-[var(--accent)] hover:text-[var(--foreground)] disabled:opacity-40"
                >
                  Clear
                </button>
              </>
            )}
          </div>
          <div className="flex gap-2">
            {modeFolders.length > 0 && (
              <button
                onClick={() => setBatchMovingFolder(true)}
                disabled={selectedChatIds.size === 0 || batchDeleteProgress !== null}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-[var(--secondary)] px-3 py-2 text-xs font-medium transition-all hover:bg-[var(--accent)] disabled:opacity-40"
              >
                <FolderOpen size="0.75rem" />
                Move
              </button>
            )}
            <div className="relative flex flex-1">
              <button
                onClick={() => setBatchExportMenuOpen((open) => !open)}
                disabled={selectedChatIds.size === 0 || bulkExportChats.isPending || batchDeleteProgress !== null}
                className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-[var(--secondary)] px-3 py-2 text-xs font-medium transition-all hover:bg-[var(--accent)] disabled:opacity-40"
              >
                <Upload size="0.75rem" />
                Export
              </button>
              {batchExportMenuOpen && (
                <div className="absolute bottom-full left-0 z-20 mb-2 w-40 overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--popover)] p-1 shadow-xl">
                  {[
                    ["jsonl", "Transcript JSONL ZIP"],
                    ["text", "Text ZIP"],
                    ["native", "Native JSON"],
                  ].map(([format, label]) => (
                    <button
                      key={format}
                      type="button"
                      onClick={() => void handleBatchExport(format as BulkChatExportFormat)}
                      className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-xs text-[var(--foreground)] transition-colors hover:bg-[var(--accent)]"
                    >
                      {label}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button
              onClick={() => void handleBatchDelete()}
              disabled={selectedChatIds.size === 0 || batchDeleteProgress !== null}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-[var(--destructive)]/10 px-3 py-2 text-xs font-medium text-[var(--destructive)] transition-all hover:bg-[var(--destructive)]/20 disabled:opacity-40"
            >
              {batchDeleteProgress ? <Loader2 size="0.75rem" className="animate-spin" /> : <Trash2 size="0.75rem" />}
              {batchDeleteProgress ? "Deleting…" : "Delete"}
            </button>
          </div>
        </div>
      )}

      {/* ── User Status Selector (in the Pond rail layout it's the strip along the window's bottom instead) ── */}
      {!statusInStrip && <UserStatusBar variant="sidebar" />}

      {/* ── Delete Branch Modal ── */}
      <Modal
        open={deleteTarget !== null}
        onClose={() => {
          if (!deleteChatGroup.isPending) setDeleteTarget(null);
        }}
        title="Delete Chat"
        width="max-w-sm"
      >
        {deleteTarget && (
          <div className="flex flex-col gap-4">
            <div className="flex items-start gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--destructive)]/10">
                <AlertTriangle size="1.125rem" className="text-[var(--destructive)]" />
              </div>
              <p className="text-sm text-[var(--muted-foreground)]">
                This group contains{" "}
                <strong className="text-[var(--foreground)]">{deleteTarget.branchCount} chats</strong>. What would you
                like to delete?
              </p>
            </div>
            <div className="flex flex-col gap-2">
              <button
                onClick={async () => {
                  if (await handleSingleChatDelete(deleteTarget.chatId)) setDeleteTarget(null);
                }}
                disabled={deleteChatGroup.isPending}
                className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-[var(--secondary)] px-3 py-2.5 text-xs font-medium ring-1 ring-[var(--border)] transition-all hover:bg-[var(--accent)] active:scale-[0.98]"
              >
                <Trash2 size="0.8125rem" />
                Delete This Chat Only
              </button>
              <button
                onClick={() => void handleDeleteEntireGroup()}
                disabled={deleteChatGroup.isPending}
                className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-[var(--destructive)]/10 px-3 py-2.5 text-xs font-medium text-[var(--destructive)] ring-1 ring-[var(--destructive)]/20 transition-all hover:bg-[var(--destructive)]/20 active:scale-[0.98] disabled:cursor-wait disabled:opacity-70"
              >
                {deleteChatGroup.isPending ? (
                  <Loader2 size="0.8125rem" className="animate-spin" />
                ) : (
                  <Trash2 size="0.8125rem" />
                )}
                {deleteChatGroup.isPending ? "Deleting group..." : "Delete Entire Group"}
              </button>
            </div>
          </div>
        )}
      </Modal>

      <Modal open={tagEditingChatId !== null} onClose={closeTagEditor} title="Edit Tags" width="max-w-sm">
        {tagEditingChat && (
          <div className="flex flex-col gap-3">
            <TagInput
              label="Tags"
              tags={tagDraftTags}
              inputValue={tagDraftInput}
              onInputChange={setTagDraftInput}
              onTagsChange={setTagDraftTags}
              suggestions={allTags}
              inputAriaLabel={`Tags for ${tagEditingChat.name}`}
              separatorPattern={/[,.\n]/}
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setTagDraftTags([]);
                  setTagDraftInput("");
                }}
                className="rounded-lg bg-[var(--secondary)] px-3 py-2 text-xs font-medium transition-all hover:bg-[var(--accent)]"
              >
                Clear
              </button>
              <button
                type="button"
                onClick={saveTagEditor}
                disabled={updateChatMetadata.isPending}
                className="rounded-lg bg-[var(--primary)] px-3 py-2 text-xs font-semibold text-[var(--primary-foreground)] transition-all hover:opacity-90 disabled:cursor-wait disabled:opacity-60"
              >
                {updateChatMetadata.isPending ? "Saving..." : "Save tags"}
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* ── Batch Move to Folder Modal ── */}
      <Modal
        open={batchMovingFolder}
        onClose={() => setBatchMovingFolder(false)}
        title={`Move ${selectedChatIds.size} Chat${selectedChatIds.size !== 1 ? "s" : ""} to Folder`}
        width="max-w-xs"
      >
        <div className="flex flex-col gap-1">
          <button
            onClick={() => handleBatchMoveToFolder(null)}
            className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-xs transition-all hover:bg-[var(--accent)]"
          >
            <MessageSquare size="0.75rem" className="text-[var(--muted-foreground)]" />
            Unfiled
          </button>
          {modeFolders.map((f) => (
            <button
              key={f.id}
              onClick={() => handleBatchMoveToFolder(f.id)}
              className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-xs transition-all hover:bg-[var(--accent)]"
            >
              <div className="h-2 w-2 rounded-full flex-shrink-0" style={{ backgroundColor: f.color || "#6b7280" }} />
              {f.name}
            </button>
          ))}
        </div>
      </Modal>
    </nav>
  );
}

// FolderHeaderRow keeps folder actions and drag-to-reorder while child chats live in the virtual row model.
export function FolderHeaderRow({
  folder,
  entriesCount,
  style,
  measure,
  isDropTarget,
  isFolderDropTarget,
  draggedChatId,
  draggedFolderId,
  onToggleCollapse,
  onRename,
  onDelete,
  onChatDragOver,
  onChatDragLeave,
  onChatDrop,
  onFolderDragStart,
  onFolderDragOver,
  onFolderDrop,
  onFolderDragEnd,
}: {
  folder: ChatFolder;
  entriesCount: number;
  style: CSSProperties;
  /** From the chat list, so it measures the row's real height. */
  measure?: ChatSidebarRowMeasure;
  isDropTarget: boolean;
  isFolderDropTarget: boolean;
  draggedChatId: string | null;
  draggedFolderId: string | null;
  onToggleCollapse: (folder: ChatFolder) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  onChatDragOver: (event: DragEvent<HTMLDivElement>, folderId: string | null) => void;
  onChatDragLeave: (event: DragEvent<HTMLDivElement>) => void;
  onChatDrop: (event: DragEvent<HTMLDivElement>, folderId: string | null) => void;
  onFolderDragStart: (event: DragEvent<HTMLDivElement>, folderId: string) => void;
  onFolderDragOver: (event: DragEvent<HTMLDivElement>, folderId: string) => void;
  onFolderDrop: (event: DragEvent<HTMLDivElement>, folderId: string) => void;
  onFolderDragEnd: () => void;
}) {
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(folder.name);

  return (
    <div
      key={folder.id}
      {...measure}
      style={style}
      onDragOver={(event) => {
        if (draggedFolderId || hasDataTransferType(event, FOLDER_DRAG_MIME)) {
          onFolderDragOver(event, folder.id);
          return;
        }
        onChatDragOver(event, folder.id);
      }}
      onDragLeave={onChatDragLeave}
      onDrop={(event) => {
        if (draggedFolderId || hasDataTransferType(event, FOLDER_DRAG_MIME)) {
          onFolderDrop(event, folder.id);
          return;
        }
        onChatDrop(event, folder.id);
      }}
      className={cn(
        "rounded-lg transition-colors",
        draggedChatId && "ring-inset",
        draggedFolderId === folder.id && "opacity-60",
        (isDropTarget || isFolderDropTarget) && "bg-[var(--sidebar-accent)]/45 ring-1 ring-[var(--primary)]/25",
      )}
    >
      <div className="group relative flex min-w-0 items-center gap-1.5 rounded-lg px-2 py-1.5 hover:bg-[var(--sidebar-accent)]/40">
        <div
          draggable={!renaming}
          onDragStart={(event) => onFolderDragStart(event, folder.id)}
          onDragEnd={onFolderDragEnd}
          className="flex shrink-0 cursor-grab touch-none items-center justify-center opacity-0 transition-opacity active:cursor-grabbing group-hover:opacity-100"
        >
          <GripVertical size="0.625rem" className="text-[var(--muted-foreground)]" />
        </div>
        <div
          role="button"
          tabIndex={0}
          aria-expanded={!folder.collapsed}
          aria-label={`${folder.collapsed ? "Expand" : "Collapse"} folder ${folder.name}`}
          onClick={(e) => {
            e.stopPropagation();
            onToggleCollapse(folder);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              e.stopPropagation();
              onToggleCollapse(folder);
            }
          }}
          className="flex min-w-0 flex-1 items-center gap-1.5"
        >
          <ChevronRight
            size="0.75rem"
            className={cn(
              "text-[var(--muted-foreground)] transition-transform shrink-0",
              !folder.collapsed && "rotate-90",
            )}
          />
          <div
            className="h-2 w-2 flex-shrink-0 cursor-pointer rounded-full"
            style={{ backgroundColor: folder.color || "#6b7280" }}
            title={folder.name}
          />
          {renaming ? (
            <input
              autoFocus
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === "Enter") {
                  onRename(folder.id, renameValue);
                  setRenaming(false);
                }
                if (e.key === "Escape") {
                  setRenaming(false);
                  setRenameValue(folder.name);
                }
              }}
              onBlur={(e) => {
                e.stopPropagation();
                onRename(folder.id, renameValue);
                setRenaming(false);
              }}
              className="min-w-0 flex-1 bg-transparent text-xs font-medium text-[var(--foreground)] outline-none"
            />
          ) : (
            <span className="min-w-0 flex-1 cursor-pointer truncate text-xs font-medium text-[var(--muted-foreground)]">
              {folder.name}
            </span>
          )}
        </div>
        {entriesCount > 0 && (
          <span className="shrink-0 text-[0.5625rem] text-[var(--muted-foreground)]">{entriesCount}</span>
        )}
        <button
          onClick={(e) => {
            e.stopPropagation();
            setRenameValue(folder.name);
            setRenaming(true);
          }}
          className="shrink-0 rounded-md p-1 opacity-0 transition-all hover:bg-[var(--accent)] group-hover:opacity-100 max-md:opacity-100"
          title="Rename folder"
        >
          <Pencil size="0.75rem" className="text-[var(--muted-foreground)]" />
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDelete(folder.id);
          }}
          className="shrink-0 rounded-md p-1 opacity-0 transition-all hover:bg-[var(--destructive)]/20 group-hover:opacity-100 max-md:opacity-100"
        >
          <Trash2 size="0.75rem" className="text-[var(--destructive)]" />
        </button>
      </div>
    </div>
  );
}
