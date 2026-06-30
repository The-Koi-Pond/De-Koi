// ──────────────────────────────────────────────
// Chat: Settings Drawer — per-chat configuration
// ──────────────────────────────────────────────
import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { createPortal } from "react-dom";
import { useQuery, useQueryClient, useQueries } from "@tanstack/react-query";
import {
  X,
  Users,
  User,
  BookOpen,
  ChevronDown,
  ChevronUp,
  Check,
  Plus,
  Trash2,
  Wrench,
  MessageSquare,
  Sparkles,
  Image,
  Pencil,
  Clock,
  AlertTriangle,
  GripVertical,
  MessageCircle,
  Bot,
  CalendarClock,
  RefreshCw,
  Settings2,
  Link,
  ArrowRightLeft,
  Unlink,
  Brain,
  Globe,
  Maximize2,
  Languages,
  Feather,
  Activity,
  Puzzle,
  FilePlus2,
  Drama,
  Music2,
  Code2,
  Paintbrush,
} from "lucide-react";
import { toast } from "sonner";
import { cn, type AvatarCrop } from "../../../../../shared/lib/utils";
import { AvatarImage } from "../../../../../shared/components/ui/AvatarImage";
import { extractCreatorNotesCss } from "../../../../../shared/lib/creator-notes-css";
import { showAlertDialog, showConfirmDialog, showPromptDialog } from "../../../../../shared/lib/app-dialogs";
import { HelpTooltip } from "../../../../../shared/components/ui/HelpTooltip";
import { ExpandedTextarea } from "../../../../../shared/components/ui/ExpandedTextarea";
import { Modal } from "../../../../../shared/components/ui/Modal";
import { ChoiceSelectionModal } from "../../../../catalog/presets/index";
import { PersonaAvatarImage } from "../../../../catalog/personas/index";
import { SummariesEditorModal } from "./SummariesEditorModal";
import { AdvancedParametersSection } from "./settings/AdvancedParametersSection";
import { ChatBasicSettingsSections } from "./settings/ChatBasicSettingsSections";
import { ConversationNotesSection } from "./settings/ConversationNotesSection";
import { ConversationPromptSection } from "./settings/ConversationPromptSection";
import { ImpersonateSettingsContent } from "./settings/ImpersonateSettingsContent";
import { MemoryRecallMemoriesModal } from "./settings/MemoryRecallMemoriesModal";
import { ModePromptSettingsSections } from "./settings/ModePromptSettingsSections";
import { ChatPresetBar } from "./settings/ChatPresetBar";
import { ContinuityOverviewPanel } from "./settings/ContinuityOverviewPanel";
import { ScheduleEditor, SelfiePromptControls } from "./settings/ScheduleEditor";
import {
  ScopedRegexCharacterGroups,
  ScopedRegexModeSelector,
  CardCssModeSelector,
} from "./settings/ScopedRegexControls";
import { SpriteDisplayModeToggle, SpriteToggleButton } from "./settings/SpriteDisplayControls";
import {
  metadataCharacterRoutines,
  metadataCharacterSchedules,
  metadataChoiceSelections,
  metadataNumber,
  metadataScopedRegexMode,
  metadataString,
  metadataStringArray,
  metadataTranslationProvider,
} from "../lib/chat-settings-metadata";
import { toggleChatAgent, toggleConversationStatusMessages } from "../lib/chat-settings-actions";
import { resolveConversationStatusMessagesEnabled } from "../../../../../engine/modes/chat/status/conversation-status-settings";
import { buildContinuityOverviewViewModel } from "../lib/continuity-overview";
import {
  AgentCategorySection,
  ChatSettingsSection as Section,
  PickerDropdown,
  SpriteRangeSlider,
} from "./settings/ChatSettingsSections";
import {
  characterAvatarUrl,
  CharacterPublicProfileCard,
  resolveCharacterPublicProfile,
  useCharacterSummaries,
  useCharacterSummariesByIds,
  useCharacterGroups,
  invalidateCharacterCollectionQueries,
} from "../../../../catalog/characters/index";
import { spriteKeys, type SpriteInfo } from "../../../../catalog/sprites/index";
import { usePersonaSummaries } from "../../../../catalog/personas/index";
import { useLorebooks } from "../../../../catalog/lorebooks/index";
import { usePresetFull, usePresetSummaries } from "../../../../catalog/presets/index";
import { useConnections } from "../../../../catalog/connections/index";
import { useGenerate } from "../../../../runtime/generation/index";
import {
  useUpdateChat,
  useUpdateChatMetadata,
  useCreateMessage,
  useChatSummaries,
  useConnectChat,
  useDisconnectChat,
  chatKeys,
} from "../../../../catalog/chats/index";
import { generateConversationSchedules as runGenerateConversationSchedules } from "../../../../../engine/modes/chat/schedules/schedule.service";
import { maybeRefreshConversationStatusMessages } from "../../../../../engine/modes/chat/status/status-message.service";
import { conversationSettingsApi, conversationSettingsKeys } from "../../../../../shared/api/conversation-settings-api";
import { conversationCommandPromptEnabled } from "../../../../../engine/modes/chat/commands/activation";
import { agentApi } from "../../../../../shared/api/agent-api";
import { llmApi } from "../../../../../shared/api/llm-api";
import { storageApi } from "../../../../../shared/api/storage-api";
import { spotifyApi } from "../../../../../shared/api/integration-utility-api";
import { spriteApi } from "../../../../../shared/api/image-generation-api";
import { toastExportError, triggerDownloadWithToast } from "../../../../shared/lib/export-feedback";
import { filterLanguageGenerationConnections } from "../../../../../shared/lib/connection-filters";
import { getConnectedChatDisplayName, normalizeChatCharacterIds } from "../../../../../shared/lib/chat-display";
import {
  getAgentRunIntervalMeta,
  getCadenceInputValue,
  parseCadenceInputValue,
  stepCadenceValue,
} from "../../../../../shared/lib/agent-cadence";
import { getCharacterTitle, parseCharacterDisplayData } from "../../../../../shared/lib/character-display";
import { useUIStore } from "../../../../../shared/stores/ui.store";
import {
  useChatPresets,
  useCreateChatPreset,
  useSaveChatPresetSettings,
  useDuplicateChatPreset,
  useUpdateChatPreset,
  useDeleteChatPreset,
  useApplyChatPreset,
  useImportChatPreset,
  useSetActiveChatPreset,
  sanitizeChatPresetSettings,
  createChatPresetExportEnvelope,
} from "../../../../catalog/chat-presets/index";
import type { AgentPhase } from "../../../../../engine/contracts/types/agent";
import type { Chat, ChatMetadata, ChatMode } from "../../../../../engine/contracts/types/chat";
import type { ChatPreset, ChatPresetSettings } from "../../../../../engine/contracts/types/chat-preset";
import { useAgentConfigs, useCreateAgent, useUpdateAgent, type AgentConfigRow } from "../../../../catalog/agents/index";
import { isRegexScriptScoped, useRegexScripts, useUpdateRegexScript } from "../../../../catalog/regex-scripts/index";
import { useAgentStore } from "../../../../../shared/stores/agent.store";
import { DEFAULT_AGENT_PROMPTS } from "../../../../../engine/contracts/constants/agent-prompts";
import { LIMITS } from "../../../../../engine/contracts/constants/defaults";
import {
  BUILT_IN_AGENTS,
  BUILT_IN_TOOLS,
  DEFAULT_AGENT_CONTEXT_SIZE,
  DEFAULT_AGENT_TOOLS,
  DEFAULT_AGENT_MAX_TOKENS,
  MAX_AGENT_MAX_TOKENS,
  MIN_AGENT_MAX_TOKENS,
  enabledChatAgentIds,
  getDefaultBuiltInAgentSettings,
  isBuiltInAgentHiddenFromChatSettingsPicker,
} from "../../../../../engine/contracts/types/agent";
import {
  estimateAgentLoadCost,
  AGENT_COST_HIGH_CALLS,
  AGENT_COST_HIGH_TOKENS,
} from "../../../../../engine/shared/scoring/agent-cost";
import { boolish as isEnabledFlag } from "../../../../../engine/generation/runtime-records";
import type { CharacterGroup } from "../../../../../engine/contracts/types/character";
import type { Lorebook } from "../../../../../engine/contracts/types/lorebook";
import {
  activeLorebookScopeReasonLabels,
  lorebookCanBeSelectedForContext,
  resolveActiveLorebookScopeReasons,
  type ActiveLorebookScopeReasonLabel,
} from "../../../../../engine/generation-core/lorebooks/active-lorebook-scope";
import { resolveGameLorebookScopeExclusions } from "../../../../../engine/generation-core/lorebooks/game-lorebook-scope";
import {
  isCustomToolSelectable,
  useCustomToolCapabilities,
  useCustomTools,
  type CustomToolRow,
} from "../../../../catalog/agents/index";
import { normalizeSpritePlacements } from "../../../../runtime/visuals/sprite-placement";
import {
  getCharacterIdFromSpriteOwnerKey,
  getSpriteOwnerKeysForCharacterId,
  getSpriteOwnerKind,
  makeSpriteOwnerKey,
} from "../../../../runtime/visuals/sprite-owner-keys";
import {
  DEFAULT_SPRITE_DISPLAY_MODES,
  normalizeSpriteDisplayModes,
  type SpriteDisplayMode,
} from "../../../../runtime/visuals/sprite-display-modes";

interface ChatSettingsDrawerProps {
  chat: Chat;
  open: boolean;
  onClose: () => void;
  spriteArrangeMode?: boolean;
  onToggleSpriteArrange?: () => void;
  onResetSpritePlacements?: () => void;
  onSpriteSideChange?: (side: "left" | "right") => void;
}

type SpotifySourceType = "liked" | "playlist" | "artist" | "any";

const SPOTIFY_SOURCE_OPTIONS: Array<{ id: SpotifySourceType; label: string; description: string }> = [
  { id: "liked", label: "Liked Songs", description: "Pick from the user's saved tracks first." },
  { id: "playlist", label: "Playlist", description: "Keep choices inside one Spotify playlist." },
  { id: "artist", label: "Artist", description: "Search only around a named artist, like HOYO-MiX." },
  { id: "any", label: "Any Spotify", description: "Let the DJ use Spotify search when it fits." },
];

const GAME_SPOTIFY_SOURCE_OPTIONS = SPOTIFY_SOURCE_OPTIONS;
const GENERIC_CHAT_TOOL_PICKER_HIDDEN_NAMES = new Set(["save_lorebook_entry"]);

function normalizeSpotifySourceType(value: unknown): SpotifySourceType {
  return value === "playlist" || value === "artist" || value === "any" ? value : "liked";
}

function normalizeGameSpotifySourceType(value: unknown): SpotifySourceType {
  return normalizeSpotifySourceType(value);
}

const MODE_INTROS: Record<ChatMode, string> = {
  conversation:
    "Plain chat — no roleplay or game systems built in; autonomous messaging and other tools are optional below.",
  roleplay:
    "Plain roleplay surface — no built-in dice, combat, or GM pipeline; sprites, world-state tracking, and other helpers are available as optional agents below.",
  game: "Full Game Master with built-in dice, combat, encounters, world state, and session/map tracking — the Scene Analysis toggle below adds optional cinematic visuals (backgrounds, music, weather).",
};

type AvailableAgent = {
  id: string;
  name: string;
  description: string;
  category: string;
  phase: AgentPhase;
  builtIn: boolean;
};

type LorebookActiveReason = ActiveLorebookScopeReasonLabel;

type ActiveLorebookView = Lorebook & {
  activeReasons: LorebookActiveReason[];
  isPinned: boolean;
};

type DrawerPersona = {
  id: string;
  name: string;
  comment: string;
  avatarPath: string | null;
  avatarFilePath?: string | null;
  avatarFilename?: string | null;
  avatarCrop?: AvatarCrop | string | null;
};

type AgentAddPreview = {
  mode: "add" | "edit";
  agent: AvailableAgent;
  config: AgentConfigRow | null;
  contextSize: number;
  maxTokens: number;
  runInterval: number | null;
};

type DrawerCharacter = {
  id: string;
  data?: unknown;
  comment?: string | null;
  avatarPath?: string | null;
  avatarFilePath?: string | null;
  avatarFilename?: string | null;
};

type ChatSpriteSubject =
  | { kind: "character"; id: string; ownerKey: string; character: DrawerCharacter }
  | { kind: "persona"; id: string; ownerKey: string; persona: DrawerPersona };

function useDebouncedValue(value: string, delayMs: number): string {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    if (value === "") {
      setDebounced("");
      return;
    }
    const handle = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(handle);
  }, [delayMs, value]);
  return debounced;
}

function mergeDrawerCharacters(
  ...sources: Array<Array<DrawerCharacter | undefined> | null | undefined>
): DrawerCharacter[] {
  const byId = new Map<string, DrawerCharacter>();
  for (const source of sources) {
    for (const character of source ?? []) {
      if (!character?.id) continue;
      byId.set(character.id, {
        ...character,
        avatarPath: characterAvatarUrl(character),
      });
    }
  }
  return Array.from(byId.values());
}

function characterSearchValues(character: { id?: string; data?: unknown; comment?: string | null }): string[] {
  const info = parseCharacterDisplayData({ data: character.data, comment: character.comment });
  const data = character.data && typeof character.data === "object" ? (character.data as Record<string, unknown>) : {};
  const tags = Array.isArray(data.tags) ? data.tags.map(String) : [];
  return [
    character.id,
    info.name,
    info.comment,
    data.creator,
    data.creator_notes,
    data.character_version,
    ...tags,
  ].filter((value): value is string => typeof value === "string" && value.trim().length > 0);
}

function splitSearchTerms(value: string): string[] {
  return value.trim().toLowerCase().split(/\s+/).filter(Boolean);
}

function searchValuesMatchTerms(values: string[], terms: string[]): boolean {
  if (terms.length === 0) return true;
  return terms.every((term) => values.some((value) => value.includes(term)));
}

function useDeferredDrawerContent(open: boolean, contentKey: string): boolean {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!open) {
      setReady(false);
      return;
    }

    setReady(false);
    const scheduler = typeof window !== "undefined" ? window : null;
    if (!scheduler) {
      setReady(true);
      return;
    }

    type IdleWindow = Window & {
      requestIdleCallback?: (callback: () => void, options?: { timeout?: number }) => number;
      cancelIdleCallback?: (handle: number) => void;
    };

    const idleWindow = scheduler as IdleWindow;
    let idleHandle: number | null = null;
    const frameHandle = scheduler.requestAnimationFrame(() => {
      if (idleWindow.requestIdleCallback) {
        idleHandle = idleWindow.requestIdleCallback(() => setReady(true), { timeout: 120 });
      } else {
        idleHandle = scheduler.setTimeout(() => setReady(true), 32);
      }
    });

    return () => {
      scheduler.cancelAnimationFrame(frameHandle);
      if (idleHandle != null) {
        if (idleWindow.cancelIdleCallback) idleWindow.cancelIdleCallback(idleHandle);
        else scheduler.clearTimeout(idleHandle);
      }
    };
  }, [contentKey, open]);

  return ready;
}

function ChatSettingsDrawerLoadingShell({ onClose }: { onClose: () => void }) {
  return (
    <>
      <div className="absolute inset-0 z-40 bg-black/30 backdrop-blur-[2px]" onClick={onClose} />
      <div className="absolute right-0 top-0 z-50 flex h-full w-80 max-md:w-full flex-col border-l border-[var(--border)] bg-[var(--background)] shadow-2xl animate-fade-in-up max-md:pt-[env(safe-area-inset-top)]">
        <div className="flex h-12 flex-shrink-0 items-center justify-between border-b border-[var(--border)] px-4">
          <h3 className="text-sm font-bold">Chat Settings</h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-[var(--muted-foreground)] transition-all hover:bg-[var(--accent)]"
          >
            <X size="1rem" />
          </button>
        </div>
        <div className="flex flex-1 items-center justify-center px-6 text-center text-xs text-[var(--muted-foreground)]">
          Preparing settings...
        </div>
      </div>
    </>
  );
}

function parseAgentSettings(raw: unknown): Record<string, unknown> {
  if (!raw) return {};
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }
  return typeof raw === "object" ? (raw as Record<string, unknown>) : {};
}

function normalizePositiveInteger(value: unknown, fallback: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(1, Math.min(max, Math.trunc(value)));
}

function normalizeAgentMaxTokens(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_AGENT_MAX_TOKENS;
  return Math.max(MIN_AGENT_MAX_TOKENS, Math.min(MAX_AGENT_MAX_TOKENS, Math.trunc(value)));
}

function normalizeAgentMaxTokensInputValue(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 1;
  return Math.max(1, Math.min(MAX_AGENT_MAX_TOKENS, Math.trunc(value)));
}

function normalizeSpriteDisplayValue(value: unknown, fallback: number, min: number, max: number): number {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(min, Math.min(max, numeric));
}

function normalizeNonNegativeInteger(value: unknown, fallback: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(0, Math.min(max, Math.trunc(value)));
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

const isLiteBuild = import.meta.env.VITE_DE_KOI_LITE === "true" || import.meta.env.VITE_MARINARA_LITE === "true";

export function ChatSettingsDrawer(props: ChatSettingsDrawerProps) {
  const contentReady = useDeferredDrawerContent(props.open, props.chat.id);

  if (!props.open) return null;
  if (!contentReady) return <ChatSettingsDrawerLoadingShell onClose={props.onClose} />;
  return <ChatSettingsDrawerInner {...props} />;
}

function ChatSettingsDrawerInner({
  chat,
  open,
  onClose,
  spriteArrangeMode = false,
  onToggleSpriteArrange,
  onResetSpritePlacements,
  onSpriteSideChange,
}: ChatSettingsDrawerProps) {
  const qc = useQueryClient();
  const updateChat = useUpdateChat();
  const updateMeta = useUpdateChatMetadata();
  const updateAgentConfig = useUpdateAgent();
  const createAgent = useCreateAgent();
  const createMessage = useCreateMessage(chat.id);
  const connectChat = useConnectChat();
  const disconnectChat = useDisconnectChat();
  const { retryAgents } = useGenerate();
  const agentProcessing = useAgentStore((s) => s.isProcessing);
  const scheduleGenerationPreferences = useUIStore((s) => s.scheduleGenerationPreferences);
  const setScheduleGenerationPreferences = useUIStore((s) => s.setScheduleGenerationPreferences);
  const roleplaySpriteScale = useUIStore((s) => s.roleplaySpriteScale);

  const [showCharPicker, setShowCharPicker] = useState(false);
  const [profilePopoverCharacterId, setProfilePopoverCharacterId] = useState<string | null>(null);
  const [charSearch, setCharSearch] = useState("");
  const debouncedCharSearch = useDebouncedValue(charSearch, 180);
  const chatCharIds: string[] = useMemo(
    () => normalizeChatCharacterIds(chat.characterIds as unknown),
    [chat.characterIds],
  );
  const { data: selectedCharacters, isLoading: selectedCharactersLoading } = useCharacterSummariesByIds(
    chatCharIds,
    chatCharIds.length > 0,
  );
  const {
    data: searchedCharacters,
    isFetching: searchedCharactersFetching,
    isError: searchedCharactersError,
  } = useCharacterSummaries(showCharPicker, debouncedCharSearch);
  const { data: characterGroups } = useCharacterGroups();
  const { data: lorebooks } = useLorebooks();
  const { data: presets, isLoading: presetsLoading } = usePresetSummaries();
  const { data: connections, isLoading: connectionsLoading } = useConnections();
  const chatMode: ChatMode =
    chat.mode === "conversation" || chat.mode === "roleplay" || chat.mode === "game" ? chat.mode : "roleplay";
  const isConversation = chatMode === "conversation";
  const isGame = chatMode === "game";
  const isRoleplayMode = chatMode === "roleplay";
  const chatPromptPresetId = nonEmptyString(chat.promptPresetId);
  const activeTextConnection = useMemo(() => {
    if (!chat.connectionId || chat.connectionId === "random") return null;
    return connections?.find((connection) => connection.id === chat.connectionId) ?? null;
  }, [chat.connectionId, connections]);
  const connectionPromptPresetId = isRoleplayMode ? nonEmptyString(activeTextConnection?.promptPresetId) : null;
  const defaultPromptPresetId = useMemo(
    () =>
      isRoleplayMode
        ? (presets?.find((preset) => isEnabledFlag(preset.isDefault ?? preset.default, false))?.id ?? null)
        : null,
    [isRoleplayMode, presets],
  );
  // The chat's selected prompt preset is the user's scene-level choice; connection presets are a fallback.
  const advancedPromptPresetId = isRoleplayMode
    ? (chatPromptPresetId ?? connectionPromptPresetId ?? defaultPromptPresetId)
    : null;
  const { data: currentPromptPresetFull } = usePresetFull(isConversation ? null : chatPromptPresetId);
  const { data: advancedPromptPresetFull, isLoading: advancedPromptPresetLoading } =
    usePresetFull(advancedPromptPresetId);
  const connectionInheritancePending =
    !isConversation && !!chat.connectionId && chat.connectionId !== "random" && connectionsLoading;
  const defaultPromptPresetPending =
    isRoleplayMode && !connectionPromptPresetId && !chatPromptPresetId && presetsLoading;
  const inheritedGenerationParametersPending =
    connectionInheritancePending ||
    defaultPromptPresetPending ||
    (isRoleplayMode && !!advancedPromptPresetId && advancedPromptPresetLoading);
  const imageConnectionsList = useMemo(
    () =>
      ((connections as Array<{ id: string; name: string; model?: string; provider?: string }>) ?? []).filter(
        (c) => c.provider === "image_generation",
      ),
    [connections],
  );
  const textConnectionsList = useMemo(
    () =>
      filterLanguageGenerationConnections(
        (connections as Array<{ id: string; name: string; model?: string; provider?: string }>) ?? [],
      ),
    [connections],
  );
  const { data: allPersonas } = usePersonaSummaries();
  const { data: agentConfigs } = useAgentConfigs();
  const { data: customTools } = useCustomTools();
  const { data: customToolCapabilities } = useCustomToolCapabilities();
  const { data: allChats } = useChatSummaries();
  const personas = useMemo(() => (allPersonas ?? []) as DrawerPersona[], [allPersonas]);

  const metadata = useMemo<Record<string, unknown>>(
    () => (chat.metadata && typeof chat.metadata === "object" && !Array.isArray(chat.metadata) ? chat.metadata : {}),
    [chat.metadata],
  );
  const characterSchedules = useMemo(
    () => metadataCharacterSchedules(metadata.characterSchedules),
    [metadata.characterSchedules],
  );
  const characterRoutines = useMemo(
    () => metadataCharacterRoutines(metadata.characterRoutines),
    [metadata.characterRoutines],
  );
  const isSceneChat = metadata.sceneStatus === "active" || typeof metadata.sceneOriginChatId === "string";
  const hasGeneratedConversationSchedules = Object.keys(characterSchedules).length > 0;
  const hasGeneratedConversationRoutines = Object.keys(characterRoutines).length > 0;
  const hasGeneratedConversationAvailability = hasGeneratedConversationRoutines || hasGeneratedConversationSchedules;
  const conversationSchedulesEnabled =
    metadata.conversationSchedulesEnabled === true ||
    (metadata.conversationSchedulesEnabled == null && hasGeneratedConversationAvailability);
  const conversationSettingsQuery = useQuery({
    queryKey: conversationSettingsKeys.settings,
    queryFn: conversationSettingsApi.settings.get,
  });
  const conversationStatusMessagesDefaultEnabled =
    conversationSettingsQuery.data?.statusMessagesEnabledByDefault === true;
  const conversationStatusMessagesOverride =
    metadata.conversationStatusMessagesEnabled === true || metadata.conversationStatusMessagesEnabled === false
      ? metadata.conversationStatusMessagesEnabled
      : null;
  const conversationStatusMessagesEnabled = resolveConversationStatusMessagesEnabled(
    metadata,
    conversationStatusMessagesDefaultEnabled,
  );
  const activeLorebookIds = useMemo<string[]>(
    () => metadataStringArray(metadata.activeLorebookIds),
    [metadata.activeLorebookIds],
  );
  const gameLorebookKeeperEnabled = metadata.gameLorebookKeeperEnabled === true;
  const gameLorebookKeeperLorebookId =
    typeof metadata.gameLorebookKeeperLorebookId === "string" ? metadata.gameLorebookKeeperLorebookId : null;
  const activeLorebookScopeContext = useMemo(
    () => ({
      chat,
      characters: chatCharIds.map((id) => ({ id })),
      persona: chat.personaId ? { id: chat.personaId } : null,
      scopeExclusions: resolveGameLorebookScopeExclusions(chatMode, metadata),
    }),
    [chat, chatCharIds, chatMode, metadata],
  );
  const activeLorebooks = useMemo<ActiveLorebookView[]>(() => {
    const lorebookList = (lorebooks ?? []) as Lorebook[];

    return lorebookList.flatMap((lorebook) => {
      const reasons = activeLorebookScopeReasonLabels(
        resolveActiveLorebookScopeReasons(lorebook, activeLorebookScopeContext),
      );
      const isPinned = activeLorebookIds.includes(lorebook.id);

      return reasons.length > 0 ? [{ ...lorebook, activeReasons: reasons, isPinned }] : [];
    });
  }, [activeLorebookIds, activeLorebookScopeContext, lorebooks]);
  const activeLorebookIdSet = useMemo(() => new Set(activeLorebooks.map((lorebook) => lorebook.id)), [activeLorebooks]);
  const selectableLorebooks = useMemo(
    () =>
      ((lorebooks ?? []) as Lorebook[]).filter((lorebook) =>
        lorebookCanBeSelectedForContext(lorebook, activeLorebookScopeContext),
      ),
    [activeLorebookScopeContext, lorebooks],
  );
  const lorebookTokenBudget =
    typeof metadata.lorebookTokenBudget === "number" && Number.isFinite(metadata.lorebookTokenBudget)
      ? Math.max(0, Math.floor(metadata.lorebookTokenBudget))
      : LIMITS.DEFAULT_LOREBOOK_TOKEN_BUDGET;
  const activeAgentIds = useMemo<string[]>(() => enabledChatAgentIds(metadata, chatMode), [chatMode, metadata]);
  const continuityOverviewModel = useMemo(
    () =>
      buildContinuityOverviewViewModel({
        chatMode,
        metadata: metadata as Partial<ChatMetadata>,
        activeLorebookCount: activeLorebooks.length,
      }),
    [activeLorebooks.length, chatMode, metadata],
  );
  const continuityOverviewActiveCount = useMemo(
    () => continuityOverviewModel.sections.filter((section) => section.status === "active").length,
    [continuityOverviewModel],
  );
  const inactiveCharacterIds = useMemo<string[]>(
    () =>
      Array.isArray(metadata.inactiveCharacterIds)
        ? metadata.inactiveCharacterIds.filter(
            (id: unknown): id is string => typeof id === "string" && id.trim().length > 0,
          )
        : [],
    [metadata.inactiveCharacterIds],
  );
  const inactiveCharacterIdSet = useMemo(() => new Set(inactiveCharacterIds), [inactiveCharacterIds]);
  const activeChatCharacterCount = useMemo(
    () => chatCharIds.filter((id) => !inactiveCharacterIdSet.has(id)).length,
    [chatCharIds, inactiveCharacterIdSet],
  );
  const activeToolIds = metadataStringArray(metadata.activeToolIds);
  const agentsEnabled = activeAgentIds.length > 0;
  const toolsEnabled = isEnabledFlag(metadata.enableTools, false);
  const manualTrackersEnabled = isEnabledFlag(metadata.manualTrackers, false);
  const spriteGenerationEnabled = isEnabledFlag(metadata.enableSpriteGeneration, false);
  const autonomousMessagesEnabled = isEnabledFlag(metadata.autonomousMessages, false);
  const characterExchangesEnabled = isEnabledFlag(metadata.characterExchanges, false);
  const groupSpeakerColorsEnabled = isEnabledFlag(metadata.groupSpeakerColors, false);
  const groupSpeakerNamesInHistoryEnabled = isEnabledFlag(metadata.groupSpeakerNamesInHistory, false);
  const autoTranslateEnabled = isEnabledFlag(metadata.autoTranslate, false);
  const translateInputEnabled = isEnabledFlag(metadata.translateInput, false);
  const inputTranslateButtonVisible = isEnabledFlag(metadata.showInputTranslateButton, false);
  const contextMessageLimit = metadataNumber(metadata.contextMessageLimit, 0);
  const hasContextMessageLimit = contextMessageLimit > 0;
  const discordWebhookUrl = metadataString(metadata.discordWebhookUrl);
  const translationProvider = metadataTranslationProvider(metadata.translationProvider);
  const translationTargetLang = metadataString(metadata.translationTargetLang, "en");
  const translationConnectionId = metadataString(metadata.translationConnectionId);
  const translationDeeplApiKey = metadataString(metadata.translationDeeplApiKey);
  const translationDeeplxUrl = metadataString(metadata.translationDeeplxUrl);
  const sceneSystemPrompt = metadataString(metadata.sceneSystemPrompt);
  const narratorStyleInstructions = metadataString(metadata.narratorStyleInstructions);
  const groupScenarioText = metadataString(metadata.groupScenarioText);
  const gameExtraPrompt = metadataString(metadata.gameExtraPrompt);
  const gameImagePromptInstructions = metadataString(metadata.gameImagePromptInstructions);
  const presetChoices = metadataChoiceSelections(metadata.presetChoices);
  const { data: allRegexScripts } = useRegexScripts(chatCharIds);
  const updateRegexScript = useUpdateRegexScript();
  const scopedRegexScripts = useMemo(() => (allRegexScripts ?? []).filter(isRegexScriptScoped), [allRegexScripts]);
  const scopedRegexCount = scopedRegexScripts.length;
  const spotifyActive = activeAgentIds.includes("spotify");
  const gameLorebookKeeperLorebook = gameLorebookKeeperLorebookId
    ? ((lorebooks ?? []) as Array<{ id: string; name: string }>).find(
        (book) => book.id === gameLorebookKeeperLorebookId,
      )
    : null;
  const spotifySourceType = normalizeSpotifySourceType(metadata.spotifySourceType);
  const spotifyPlaylistId = typeof metadata.spotifyPlaylistId === "string" ? metadata.spotifyPlaylistId : "";
  const spotifyArtist = typeof metadata.spotifyArtist === "string" ? metadata.spotifyArtist : "";
  const gameUseSpotifyMusic = metadata.gameUseSpotifyMusic === true;
  const gameSpotifySourceType = normalizeGameSpotifySourceType(metadata.gameSpotifySourceType);
  const gameSpotifyPlaylistId =
    typeof metadata.gameSpotifyPlaylistId === "string" ? metadata.gameSpotifyPlaylistId : "";
  const gameSpotifyArtist = typeof metadata.gameSpotifyArtist === "string" ? metadata.gameSpotifyArtist : "";
  const gameAgentFeatureCount =
    activeAgentIds.length + (gameLorebookKeeperEnabled ? 1 : 0) + (gameUseSpotifyMusic ? 1 : 0);
  const spriteCharacterIds = useMemo<string[]>(
    () => (Array.isArray(metadata.spriteCharacterIds) ? metadata.spriteCharacterIds : []),
    [metadata.spriteCharacterIds],
  );
  const spriteDisplayModes = normalizeSpriteDisplayModes(metadata.spriteDisplayModes);
  const expressionAvatarsEnabled = metadata.expressionAvatarsEnabled === true;
  const spritePosition: "left" | "right" = metadata.spritePosition === "right" ? "right" : "left";
  const spriteScale = normalizeSpriteDisplayValue(metadata.spriteScale, roleplaySpriteScale, 0.5, 1.75);
  const spriteOpacity = normalizeSpriteDisplayValue(metadata.spriteOpacity, 1, 0.15, 1);
  const [spriteScalePercent, setSpriteScalePercent] = useState(() => Math.round(spriteScale * 100));
  const [spriteOpacityPercent, setSpriteOpacityPercent] = useState(() => Math.round(spriteOpacity * 100));
  const hasCustomSpritePlacements = Object.keys(normalizeSpritePlacements(metadata.spritePlacements)).length > 0;
  const spotifyPlaylistsQuery = useQuery({
    queryKey: ["spotify", "playlists", 50],
    queryFn: () =>
      spotifyApi.playlists<{
        playlists: Array<{
          id: string;
          name: string;
          uri: string;
          trackCount: number | null;
          owned: boolean | null;
        }>;
      }>({ limit: 50 }),
    enabled:
      open &&
      ((isGame && gameUseSpotifyMusic && gameSpotifySourceType === "playlist") ||
        (isRoleplayMode && agentsEnabled && spotifyActive && spotifySourceType === "playlist")),
    staleTime: 60_000,
    retry: false,
  });

  useEffect(() => {
    setSpriteScalePercent(Math.round(spriteScale * 100));
  }, [spriteScale]);

  useEffect(() => {
    setSpriteOpacityPercent(Math.round(spriteOpacity * 100));
  }, [spriteOpacity]);

  const agentConfigsByType = useMemo(() => {
    const map = new Map<string, AgentConfigRow>();
    for (const config of (agentConfigs ?? []) as AgentConfigRow[]) {
      map.set(config.type, config);
    }
    return map;
  }, [agentConfigs]);
  const conversationCommandsEnabled = conversationCommandPromptEnabled(chat);

  // Build the available agent list: built-in + custom agents from DB
  // In roleplay mode, hide agents that are either automatic or handled internally.
  const availableAgents = useMemo(() => {
    const agents: AvailableAgent[] = [];
    for (const a of BUILT_IN_AGENTS) {
      if (isBuiltInAgentHiddenFromChatSettingsPicker(chatMode, a.id)) continue;
      const existing = agentConfigsByType.get(a.id);
      agents.push({
        id: a.id,
        name: existing?.name ?? a.name,
        description: existing?.description ?? a.description,
        category: a.category,
        phase: a.phase,
        builtIn: true,
      });
    }
    // Custom agents from DB
    if (agentConfigs) {
      for (const c of agentConfigs as AgentConfigRow[]) {
        if (!BUILT_IN_AGENTS.some((b) => b.id === c.type)) {
          agents.push({
            id: c.type,
            name: c.name,
            description: c.description,
            category: "custom",
            phase: c.phase as AgentPhase,
            builtIn: false,
          });
        }
      }
    }
    return agents;
  }, [agentConfigs, agentConfigsByType, chatMode]);

  // Estimate the per-turn cost of the active agent loadout — feeds the readout
  // in the agents picker header and the per-row token badges. Approximate; see
  // `estimateAgentLoadCost` doc comment for what's counted vs not.
  const agentLoadCost = useMemo(() => {
    const inputs = activeAgentIds.flatMap((id) => {
      const meta = availableAgents.find((a) => a.id === id);
      if (!meta) return [];
      const cfg = agentConfigsByType.get(id);
      // `||` (not `??`) — custom configs often have an empty-string promptTemplate
      // meaning "no override", and we still want to count the built-in default.
      const promptTemplate = cfg?.promptTemplate || DEFAULT_AGENT_PROMPTS[id] || "";
      return [
        {
          type: id,
          phase: meta.phase,
          connectionId: cfg?.connectionId ?? null,
          promptTemplate,
        },
      ];
    });
    const tokensByType = new Map<string, number>(inputs.map((i) => [i.type, Math.ceil(i.promptTemplate.length / 4)]));
    return {
      cost: estimateAgentLoadCost(inputs, chat.connectionId ?? null),
      tokensByType,
    };
  }, [activeAgentIds, availableAgents, agentConfigsByType, chat.connectionId]);

  const lorebookKeeperActive = activeAgentIds.includes("lorebook-keeper");
  const expressionActive = activeAgentIds.includes("expression");
  const lorebookKeeperTargetLorebookId =
    typeof metadata.lorebookKeeperTargetLorebookId === "string" ? metadata.lorebookKeeperTargetLorebookId : "";
  const lorebookKeeperReadBehindMessages = normalizeNonNegativeInteger(
    metadata.lorebookKeeperReadBehindMessages,
    0,
    100,
  );
  const memoryRecallReadBehindMessages = normalizeNonNegativeInteger(metadata.memoryRecallReadBehindMessages, 1, 100);
  const lorebookKeeperReviewRequired = metadata.lorebookKeeperReviewRequired !== false;

  // Build the available tool list: built-in + custom tools from DB
  const availableTools = useMemo(() => {
    const tools: Array<{ id: string; name: string; description: string }> = [];
    for (const t of BUILT_IN_TOOLS) {
      if (GENERIC_CHAT_TOOL_PICKER_HIDDEN_NAMES.has(t.name)) continue;
      tools.push({ id: t.name, name: t.name, description: t.description });
    }
    if (customTools) {
      for (const ct of customTools as CustomToolRow[]) {
        if (isCustomToolSelectable(ct, customToolCapabilities)) {
          tools.push({ id: ct.name, name: ct.name, description: ct.description });
        }
      }
    }
    return tools;
  }, [customToolCapabilities, customTools]);

  // ── Helpers ──
  const characters = useMemo<DrawerCharacter[]>(
    () =>
      mergeDrawerCharacters(
        selectedCharacters as DrawerCharacter[] | undefined,
        searchedCharacters as DrawerCharacter[] | undefined,
      ),
    [searchedCharacters, selectedCharacters],
  );
  const characterSearchPending =
    showCharPicker && (searchedCharactersFetching || charSearch.trim() !== debouncedCharSearch.trim());
  const characterSearchFailed = showCharPicker && searchedCharactersError;
  const availableCharacters = useMemo(() => {
    const selectedIds = new Set(chatCharIds);
    return characters.filter((character) => !selectedIds.has(character.id));
  }, [characters, chatCharIds]);
  const availableCharacterSearchEntries = useMemo(
    () =>
      availableCharacters.map((character) => ({
        character,
        searchValues: characterSearchValues(character).map((value) => value.toLowerCase()),
      })),
    [availableCharacters],
  );
  const characterSearchTerms = useMemo(() => splitSearchTerms(charSearch), [charSearch]);
  const filteredAvailableCharacters = useMemo(
    () =>
      availableCharacterSearchEntries
        .filter(({ searchValues }) => searchValuesMatchTerms(searchValues, characterSearchTerms))
        .map(({ character }) => character),
    [availableCharacterSearchEntries, characterSearchTerms],
  );

  const chatCharacters = useMemo(
    () =>
      chatCharIds
        .map((characterId) => characters.find((character) => character.id === characterId))
        .filter((character): character is DrawerCharacter => !!character),
    [chatCharIds, characters],
  );

  const profilePopoverCharacter = useMemo(
    () =>
      profilePopoverCharacterId
        ? (chatCharacters.find((character) => character.id === profilePopoverCharacterId) ??
          characters.find((character) => character.id === profilePopoverCharacterId) ??
          null)
        : null,
    [characters, chatCharacters, profilePopoverCharacterId],
  );

  const openCharacterProfilePreview = useCallback((characterId: string) => {
    setProfilePopoverCharacterId((current) => (current === characterId ? null : characterId));
  }, []);

  const openCharacterDetailFromProfile = useCallback(
    (characterId: string) => {
      setProfilePopoverCharacterId(null);
      onClose();
      useUIStore.getState().openCharacterDetail(characterId);
    },
    [onClose],
  );

  useEffect(() => {
    if (!profilePopoverCharacterId) return undefined;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setProfilePopoverCharacterId(null);
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [profilePopoverCharacterId]);

  const activePersona = useMemo(
    () => (chat.personaId ? (personas.find((persona) => persona.id === chat.personaId) ?? null) : null),
    [chat.personaId, personas],
  );
  const activePersonaOwnerKey = chat.personaId ? makeSpriteOwnerKey("persona", chat.personaId) : null;

  const chatSpriteSubjects = useMemo<ChatSpriteSubject[]>(
    () => [
      ...chatCharacters.map((character) => ({
        kind: "character" as const,
        id: character.id,
        ownerKey: makeSpriteOwnerKey("character", character.id),
        character,
      })),
      ...(activePersona
        ? [
            {
              kind: "persona" as const,
              id: activePersona.id,
              ownerKey: makeSpriteOwnerKey("persona", activePersona.id),
              persona: activePersona,
            },
          ]
        : []),
    ],
    [activePersona, chatCharacters],
  );

  useEffect(() => {
    const isStalePersonaOwnerKey = (ownerKey: string) =>
      getSpriteOwnerKind(ownerKey) === "persona" && ownerKey !== activePersonaOwnerKey;
    const nextSpriteCharacterIds = spriteCharacterIds.filter((ownerKey) => !isStalePersonaOwnerKey(ownerKey));
    const nextSpritePlacements = { ...normalizeSpritePlacements(metadata.spritePlacements) };
    let changed = nextSpriteCharacterIds.length !== spriteCharacterIds.length;

    for (const ownerKey of Object.keys(nextSpritePlacements)) {
      if (isStalePersonaOwnerKey(ownerKey)) {
        delete nextSpritePlacements[ownerKey];
        changed = true;
      }
    }

    if (!changed) return;
    updateMeta.mutate({
      id: chat.id,
      spriteCharacterIds: nextSpriteCharacterIds,
      spritePlacements: nextSpritePlacements,
    });
  }, [activePersonaOwnerKey, chat.id, metadata.spritePlacements, spriteCharacterIds, updateMeta]);

  const chatSpriteQueries = useQueries({
    queries: chatSpriteSubjects.map((subject) => ({
      queryKey: spriteKeys.list(subject.id, subject.kind),
      queryFn: () => spriteApi.list<SpriteInfo[]>(subject.id, { ownerType: subject.kind }),
      enabled: !!subject.id,
      staleTime: 5 * 60_000,
    })),
  });

  const chatSpriteSubjectsWithSprites = chatSpriteSubjects.filter((_subject, index) => {
    const sprites = chatSpriteQueries[index]?.data;
    return Array.isArray(sprites) && sprites.length > 0;
  });
  const chatSpriteSubjectsLoading =
    (chatCharIds.length > 0 && selectedCharactersLoading) || (!!chat.personaId && allPersonas == null);
  const chatSpriteChoicesLoading =
    chatSpriteSubjects.length > 0 &&
    chatSpriteSubjectsWithSprites.length === 0 &&
    chatSpriteQueries.some((query) => query.isLoading);

  // Memoize character name parsing — avoids repeated JSON.parse per render
  const charInfoMap = useMemo(() => {
    const map = new Map<string, ReturnType<typeof parseCharacterDisplayData>>();
    for (const c of characters) {
      map.set(c.id, parseCharacterDisplayData({ data: c.data, comment: c.comment }));
    }
    return map;
  }, [characters]);

  const charNameMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const [id, info] of charInfoMap) {
      map.set(id, info.name);
    }
    return map;
  }, [charInfoMap]);

  const cardCssCharacters = useMemo(() => {
    const result: Array<{ id: string; name: string }> = [];
    for (const id of chatCharIds) {
      const char = characters.find((c) => c.id === id);
      if (!char) continue;
      try {
        const parsed = typeof char.data === "string" ? JSON.parse(char.data) : char.data;
        const notes: string = parsed?.creator_notes ?? "";
        if (!notes) continue;
        const { css } = extractCreatorNotesCss(notes);
        if (css.trim()) result.push({ id, name: charNameMap.get(id) ?? "Unknown" });
      } catch {
        /* skip */
      }
    }
    return result;
  }, [chatCharIds, characters, charNameMap]);

  const cardCssMode = useMemo(() => {
    const mode = metadata.cardCssMode;
    if (mode === "disabled" || mode === "exclusive") return mode;
    return "chat";
  }, [metadata.cardCssMode]);

  const getCharacterInfo = useCallback(
    (c: { id?: string; data?: unknown; comment?: string | null }) => {
      if (c.id && charInfoMap.has(c.id)) return charInfoMap.get(c.id)!;
      return parseCharacterDisplayData({ data: c.data, comment: c.comment });
    },
    [charInfoMap],
  );

  const charName = useCallback(
    (c: { id?: string; data?: unknown; comment?: string | null }) => getCharacterInfo(c).name,
    [getCharacterInfo],
  );

  const charTitle = useCallback(
    (c: { id?: string; data?: unknown; comment?: string | null }) => getCharacterTitle(getCharacterInfo(c)),
    [getCharacterInfo],
  );

  const charAvatarCrop = useCallback((c: { data?: unknown }) => {
    return (
      ((c.data as { extensions?: { avatarCrop?: AvatarCrop | null } } | null)?.extensions?.avatarCrop as
        | AvatarCrop
        | null
        | undefined) ?? null
    );
  }, []);

  // ── First message confirm state ──
  const [firstMesConfirm, setFirstMesConfirm] = useState<{
    charId: string;
    charName: string;
    message: string;
    alternateGreetings: string[];
  } | null>(null);

  const handleFirstMesConfirm = useCallback(async () => {
    if (!firstMesConfirm) return;
    const msg = await createMessage.mutateAsync({
      role: "assistant",
      content: firstMesConfirm.message,
      characterId: firstMesConfirm.charId,
    });
    // Add alternate greetings as swipes on the first message
    if (msg?.id && firstMesConfirm.alternateGreetings.length > 0) {
      for (const greeting of firstMesConfirm.alternateGreetings) {
        if (greeting.trim()) {
          await storageApi.addChatMessageSwipe(chat.id, msg.id, greeting, { activate: false });
        }
      }
      qc.invalidateQueries({ queryKey: chatKeys.messages(chat.id) });
    }
    setFirstMesConfirm(null);
  }, [firstMesConfirm, createMessage, chat.id, qc]);

  // ── Mutations ──
  const syncGamePartyMetadata = (nextCharacterIds: string[]) => {
    if (!isGame) return;
    const storedPartyIds: unknown[] = Array.isArray(metadata.gamePartyCharacterIds)
      ? metadata.gamePartyCharacterIds
      : Array.isArray((metadata.gameSetupConfig as { partyCharacterIds?: unknown[] } | undefined)?.partyCharacterIds)
        ? (metadata.gameSetupConfig as { partyCharacterIds: unknown[] }).partyCharacterIds
        : [];
    const npcPartyIds = storedPartyIds.filter((id): id is string => typeof id === "string" && id.startsWith("npc:"));
    const nextPartyIds = Array.from(new Set([...nextCharacterIds, ...npcPartyIds]));
    const gameSetupConfig =
      metadata.gameSetupConfig && typeof metadata.gameSetupConfig === "object"
        ? { ...(metadata.gameSetupConfig as Record<string, unknown>), partyCharacterIds: nextPartyIds }
        : metadata.gameSetupConfig;
    updateMeta.mutate({
      id: chat.id,
      gamePartyCharacterIds: nextPartyIds,
      ...(gameSetupConfig ? { gameSetupConfig } : {}),
    });
  };

  const toggleCharacter = (charId: string) => {
    const current = [...chatCharIds];
    const idx = current.indexOf(charId);
    if (idx >= 0) {
      current.splice(idx, 1);
      updateChat.mutate(
        { id: chat.id, characterIds: current },
        {
          onSuccess: () => syncGamePartyMetadata(current),
        },
      );
      const nextInactiveCharacterIds = inactiveCharacterIds.filter((id) => id !== charId);
      if (nextInactiveCharacterIds.length !== inactiveCharacterIds.length) {
        updateMeta.mutate({ id: chat.id, inactiveCharacterIds: nextInactiveCharacterIds });
      }
      const removedSpriteOwnerKeys = new Set(getSpriteOwnerKeysForCharacterId(charId));
      const nextSpriteCharacterIds = spriteCharacterIds.filter((id) => !removedSpriteOwnerKeys.has(id));
      if (nextSpriteCharacterIds.length !== spriteCharacterIds.length) {
        const nextSpritePlacements = { ...normalizeSpritePlacements(metadata.spritePlacements) };
        for (const ownerKey of removedSpriteOwnerKeys) {
          delete nextSpritePlacements[ownerKey];
        }
        updateMeta.mutate({
          id: chat.id,
          spriteCharacterIds: nextSpriteCharacterIds,
          spritePlacements: nextSpritePlacements,
        });
      }
    } else {
      current.push(charId);
      updateChat.mutate(
        { id: chat.id, characterIds: current },
        {
          onSuccess: async () => {
            syncGamePartyMetadata(current);
            // Skip auto-greeting for conversation mode
            if (isConversation) return;
            const charSummary = characters.find((c) => c.id === charId);
            const fullCharacter = await storageApi.get<DrawerCharacter>("characters", charId).catch(() => null);
            const parsed =
              fullCharacter?.data && typeof fullCharacter.data === "object"
                ? (fullCharacter.data as { first_mes?: string; alternate_greetings?: string[] })
                : {};
            const firstMes = parsed.first_mes;
            const altGreetings = parsed.alternate_greetings ?? [];
            if (firstMes) {
              setFirstMesConfirm({
                charId,
                charName: charSummary ? charName(charSummary) : "Character",
                message: firstMes,
                alternateGreetings: altGreetings,
              });
            }
          },
        },
      );
    }
  };

  const toggleCharacterGenerationActive = (charId: string) => {
    const isInactive = inactiveCharacterIdSet.has(charId);
    if (!isInactive && activeChatCharacterCount <= 1) {
      toast.info("At least one character must stay active.");
      return;
    }
    const next = isInactive
      ? inactiveCharacterIds.filter((id) => id !== charId)
      : Array.from(new Set([...inactiveCharacterIds, charId]));
    updateMeta.mutate({ id: chat.id, inactiveCharacterIds: next });
  };

  const isSpriteSubjectActive = useCallback(
    (subject: ChatSpriteSubject) => {
      if (subject.kind === "persona") return spriteCharacterIds.includes(subject.ownerKey);
      return spriteCharacterIds.some((ownerKey) => getCharacterIdFromSpriteOwnerKey(ownerKey) === subject.id);
    },
    [spriteCharacterIds],
  );

  const toggleSprite = (subject: ChatSpriteSubject) => {
    const current = [...spriteCharacterIds];
    if (subject.kind === "character") {
      const ownerKeys = new Set(getSpriteOwnerKeysForCharacterId(subject.id));
      const next = current.filter((ownerKey) => !ownerKeys.has(ownerKey));
      if (next.length !== current.length) {
        const nextSpritePlacements = { ...normalizeSpritePlacements(metadata.spritePlacements) };
        for (const ownerKey of ownerKeys) {
          delete nextSpritePlacements[ownerKey];
        }
        updateMeta.mutate({ id: chat.id, spriteCharacterIds: next, spritePlacements: nextSpritePlacements });
        return;
      }
    } else {
      const idx = current.indexOf(subject.ownerKey);
      if (idx >= 0) {
        current.splice(idx, 1);
        const nextSpritePlacements = { ...normalizeSpritePlacements(metadata.spritePlacements) };
        delete nextSpritePlacements[subject.ownerKey];
        updateMeta.mutate({ id: chat.id, spriteCharacterIds: current, spritePlacements: nextSpritePlacements });
        return;
      }
    }

    if (current.length >= 3) return; // max 3
    current.push(subject.ownerKey);
    updateMeta.mutate({ id: chat.id, spriteCharacterIds: current });
  };

  const toggleSpriteDisplayMode = (mode: SpriteDisplayMode) => {
    const current = normalizeSpriteDisplayModes(metadata.spriteDisplayModes);
    const active = current.includes(mode);
    const next = active ? current.filter((value) => value !== mode) : [...current, mode];
    updateMeta.mutate({
      id: chat.id,
      spriteDisplayModes: next.length > 0 ? next : [...DEFAULT_SPRITE_DISPLAY_MODES],
    });
  };

  const setSpriteSide = useCallback(
    (nextSide: "left" | "right") => {
      if (nextSide === spritePosition) return;
      if (onSpriteSideChange) {
        onSpriteSideChange(nextSide);
        return;
      }
      updateMeta.mutate({ id: chat.id, spritePosition: nextSide });
    },
    [chat.id, onSpriteSideChange, spritePosition, updateMeta],
  );

  const resetSpritePlacements = useCallback(() => {
    if (onResetSpritePlacements) {
      onResetSpritePlacements();
      return;
    }
    updateMeta.mutate({ id: chat.id, spritePlacements: {} });
  }, [chat.id, onResetSpritePlacements, updateMeta]);

  const setSpriteScale = useCallback(
    (nextPercent: number) => {
      const clampedPercent = Math.max(50, Math.min(175, nextPercent));
      setSpriteScalePercent(clampedPercent);
      updateMeta.mutate({
        id: chat.id,
        spriteScale: clampedPercent / 100,
      });
    },
    [chat.id, updateMeta],
  );

  const setSpriteOpacity = useCallback(
    (nextPercent: number) => {
      const clampedPercent = Math.max(15, Math.min(100, nextPercent));
      setSpriteOpacityPercent(clampedPercent);
      updateMeta.mutate({
        id: chat.id,
        spriteOpacity: clampedPercent / 100,
      });
    },
    [chat.id, updateMeta],
  );

  // ── Character drag-and-drop reordering ──
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dropIdx, setDropIdx] = useState<number | null>(null);

  const handleCharDragStart = (idx: number, e: React.DragEvent) => {
    setDragIdx(idx);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", String(idx));
  };

  const handleCharDragOver = (cardIdx: number, e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    const rect = e.currentTarget.getBoundingClientRect();
    const midY = rect.top + rect.height / 2;
    setDropIdx(e.clientY < midY ? cardIdx : cardIdx + 1);
  };

  const handleCharDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const src = dragIdx;
    const tgt = dropIdx;
    setDragIdx(null);
    setDropIdx(null);
    if (src === null || tgt === null) return;
    let insertAt = tgt;
    if (src < insertAt) insertAt--;
    if (src === insertAt) return;
    const ids = [...chatCharIds];
    const [moved] = ids.splice(src, 1);
    ids.splice(insertAt, 0, moved!);
    updateChat.mutate({ id: chat.id, characterIds: ids });
  };

  const handleCharDragEnd = () => {
    setDragIdx(null);
    setDropIdx(null);
  };

  const toggleLorebook = (lbId: string) => {
    const current = [...activeLorebookIds];
    const idx = current.indexOf(lbId);
    if (idx >= 0) current.splice(idx, 1);
    else current.push(lbId);
    updateMeta.mutate({ id: chat.id, activeLorebookIds: current });
  };

  const pinLorebookToChat = (lbId: string) => {
    if (activeLorebookIds.includes(lbId)) return;
    updateMeta.mutate({ id: chat.id, activeLorebookIds: [...activeLorebookIds, lbId] });
  };

  const toggleAgent = async (agentId: string) => {
    await toggleChatAgent({
      agentId,
      chat,
      activeAgentIds,
      readLatestChat: () => qc.getQueryData<Chat>(chatKeys.detail(chat.id)),
      updateMeta,
      agentMemory: agentApi,
      confirmSecretPlotRemoval: (message) =>
        showConfirmDialog({
          title: "Remove Secret Plot Driver",
          message,
          confirmLabel: "Remove Agent",
          tone: "destructive",
        }),
      showMutationFailure: ({ removing, message }) =>
        showAlertDialog({
          title: removing ? "Couldn't Remove Agent" : "Couldn't Add Agent",
          message,
        }),
    });
  };

  const handleLorebookKeeperBackfill = useCallback(async () => {
    await retryAgents(chat.id, ["lorebook-keeper"], { lorebookKeeperBackfill: true });
  }, [chat.id, retryAgents]);

  const toggleTool = (toolId: string) => {
    const current = [...activeToolIds];
    const idx = current.indexOf(toolId);
    if (idx >= 0) current.splice(idx, 1);
    else current.push(toolId);
    updateMeta.mutate({ id: chat.id, activeToolIds: current });
  };

  const currentPromptPresetHasVariables = (currentPromptPresetFull?.choiceBlocks?.length ?? 0) > 0;
  const currentPromptPresetHasLorebookMarker = useMemo(() => {
    const sections = currentPromptPresetFull?.sections ?? [];
    return sections.some((section) => {
      const enabled = (section as { enabled?: boolean | string }).enabled;
      const isMarker = (section as { isMarker?: boolean | string }).isMarker;
      if (enabled === false || enabled === "false") return false;
      if (isMarker !== true && isMarker !== "true") return false;
      try {
        const config =
          typeof section.markerConfig === "string" ? JSON.parse(section.markerConfig) : section.markerConfig;
        return (
          config?.type === "lorebook" || config?.type === "world_info_before" || config?.type === "world_info_after"
        );
      } catch {
        return false;
      }
    });
  }, [currentPromptPresetFull?.sections]);
  const showLorebookMarkerWarning =
    !!chat.promptPresetId && activeLorebooks.length > 0 && !currentPromptPresetHasLorebookMarker;

  const setPreset = (presetId: string | null) => {
    updateChat.mutate(
      { id: chat.id, promptPresetId: presetId },
      {
        onSuccess: async () => {
          if (!presetId) {
            setChoiceModalPresetId(null);
            return;
          }

          try {
            const choiceBlocks = await storageApi.list("prompt-variables", { filters: { presetId } });
            if ((choiceBlocks?.length ?? 0) > 0) {
              setChoiceModalPresetId(presetId);
            } else {
              setChoiceModalPresetId(null);
            }
          } catch {
            setChoiceModalPresetId(null);
          }
        },
      },
    );
  };

  const setConnection = (connectionId: string | null) => {
    updateChat.mutate({ id: chat.id, connectionId });
  };

  const [editingName, setEditingName] = useState(false);
  const [nameVal, setNameVal] = useState(chat.name);
  const [showGroupPicker, setShowGroupPicker] = useState(false);
  const [showLbPicker, setShowLbPicker] = useState(false);
  const [showToolPicker, setShowToolPicker] = useState(false);
  const [showPersonaPicker, setShowPersonaPicker] = useState(false);
  const [showConnectionPicker, setShowConnectionPicker] = useState(false);
  const [showSummariesModal, setShowSummariesModal] = useState(false);
  const [showMemoriesModal, setShowMemoriesModal] = useState(false);
  // Session-ephemeral: did the user change Day Rollover Hour in this drawer mount?
  // Used to gate the "transitional duplication" warning so it only appears
  // immediately after a change (when the warning is operationally useful) and
  // doesn't permanently clutter chats that already have summaries.
  const [rolloverTouchedThisSession, setRolloverTouchedThisSession] = useState(false);
  useEffect(() => {
    setRolloverTouchedThisSession(false);
  }, [chat.id]);
  const [connectionSearch, setConnectionSearch] = useState("");
  const [personaSearch, setPersonaSearch] = useState("");
  const [pendingToolIds, setPendingToolIds] = useState<string[]>([]);
  const [lbSearch, setLbSearch] = useState("");
  const [toolSearch, setToolSearch] = useState("");
  const [choiceModalPresetId, setChoiceModalPresetId] = useState<string | null>(null);
  const [agentAddPreview, setAgentAddPreview] = useState<AgentAddPreview | null>(null);
  const [agentAddCadenceInputFocused, setAgentAddCadenceInputFocused] = useState(false);
  const [savingAgentSettings, setSavingAgentSettings] = useState(false);
  const [isRegeneratingSchedules, setIsRegeneratingSchedules] = useState(false);
  // Synchronous lock to close the re-entry gap: React state commits are async, so two
  // fast clicks can both pass the `isRegeneratingSchedules` check before the state updates.
  const isRegeneratingSchedulesRef = useRef(false);
  const generateConversationSchedules = useCallback(
    async (forceRefresh = false) => {
      if (isRegeneratingSchedulesRef.current) return;
      isRegeneratingSchedulesRef.current = true;
      setIsRegeneratingSchedules(true);
      try {
        const scheduleGenerationPreferences = useUIStore.getState().scheduleGenerationPreferences;
        const result = await runGenerateConversationSchedules(
          { storage: storageApi, llm: llmApi },
          {
            chatId: chat.id,
            characterIds: chatCharIds,
            forceRefresh,
            scheduleGenerationPreferences,
          },
        );
        const generatedCount = Object.values(result.schedules).filter(Boolean).length;
        toast.success(`Generated ${generatedCount} conversation schedule${generatedCount === 1 ? "" : "s"}.`);
        qc.invalidateQueries({ queryKey: chatKeys.detail(chat.id) });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Schedule generation failed.";
        toast.error(message);
      } finally {
        isRegeneratingSchedulesRef.current = false;
        setIsRegeneratingSchedules(false);
      }
    },
    [chat.id, chatCharIds, qc],
  );
  const handleToggleConversationStatusMessagesDefault = useCallback(() => {
    const nextEnabled = !conversationStatusMessagesDefaultEnabled;
    void (async () => {
      try {
        await conversationSettingsApi.settings.setStatusMessagesEnabledByDefault(nextEnabled);
        await qc.invalidateQueries({ queryKey: conversationSettingsKeys.settings });
        if (!nextEnabled || conversationStatusMessagesOverride === false) return;

        const result = await maybeRefreshConversationStatusMessages(
          { storage: storageApi, llm: llmApi },
          { chatId: chat.id },
        );
        if (result.refreshed.length > 0) {
          invalidateCharacterCollectionQueries(qc);
          await qc.invalidateQueries({ queryKey: chatKeys.detail(chat.id) });
        }
      } catch (error) {
        await conversationSettingsApi.settings
          .setStatusMessagesEnabledByDefault(conversationStatusMessagesDefaultEnabled)
          .catch(() => undefined);
        await qc.invalidateQueries({ queryKey: conversationSettingsKeys.settings });
        toast.error(error instanceof Error ? error.message : "Status blurb generation failed.");
      }
    })();
  }, [chat.id, conversationStatusMessagesDefaultEnabled, conversationStatusMessagesOverride, qc]);
  const handleToggleConversationStatusMessages = useCallback(() => {
    const nextEnabled = !conversationStatusMessagesEnabled;
    void toggleConversationStatusMessages({
      chat,
      enabled: conversationStatusMessagesEnabled,
      nextEnabled,
      rollbackEnabled: conversationStatusMessagesOverride === true,
      updateMeta,
      refreshStatusMessages: (chatId) =>
        maybeRefreshConversationStatusMessages({ storage: storageApi, llm: llmApi }, { chatId }),
      invalidateCharacters: () => invalidateCharacterCollectionQueries(qc),
      invalidateChat: () => qc.invalidateQueries({ queryKey: chatKeys.detail(chat.id) }),
      showRefreshFailure: (message) => {
        toast.error(message);
      },
    });
  }, [chat, conversationStatusMessagesEnabled, conversationStatusMessagesOverride, qc, updateMeta]);

  const [scenePromptExpanded, setScenePromptExpanded] = useState(false);
  const [scenePromptDraft, setScenePromptDraft] = useState(sceneSystemPrompt);
  const [narratorStyleDraft, setNarratorStyleDraft] = useState(narratorStyleInstructions);
  const [narratorStyleExpanded, setNarratorStyleExpanded] = useState(false);
  const [groupScenarioDraft, setGroupScenarioDraft] = useState(groupScenarioText);
  const [groupScenarioExpanded, setGroupScenarioExpanded] = useState(false);
  const gameAgentPool = useMemo(
    () => Array.from(new Set(activeAgentIds.filter((id) => id !== "spotify" && id !== "lorebook-keeper"))),
    [activeAgentIds],
  );
  const [extraPromptDraft, setExtraPromptDraft] = useState(gameExtraPrompt);
  const [extraPromptExpanded, setExtraPromptExpanded] = useState(false);
  const [gameImagePromptInstructionsDraft, setGameImagePromptInstructionsDraft] = useState(gameImagePromptInstructions);
  const [spotifyArtistDraft, setSpotifyArtistDraft] = useState(spotifyArtist);
  const [gameSpotifyArtistDraft, setGameSpotifyArtistDraft] = useState(gameSpotifyArtist);

  // ── Chat Settings Presets ──
  const presetMode = chatMode;
  const { data: chatPresets } = useChatPresets(presetMode);
  const createChatPreset = useCreateChatPreset();
  const saveChatPreset = useSaveChatPresetSettings();
  const duplicateChatPreset = useDuplicateChatPreset();
  const renameChatPreset = useUpdateChatPreset();
  const deleteChatPreset = useDeleteChatPreset();
  const applyChatPreset = useApplyChatPreset();
  const importChatPreset = useImportChatPreset();
  const setActiveChatPreset = useSetActiveChatPreset();
  const presetList = useMemo(() => (chatPresets ?? []) as ChatPreset[], [chatPresets]);
  const appliedPresetId = (metadata.appliedChatPresetId as string | undefined) ?? null;
  const selectedChatPreset = useMemo(() => {
    if (appliedPresetId) {
      const match = presetList.find((p) => p.id === appliedPresetId);
      if (match) return match;
    }
    return presetList.find((p) => isEnabledFlag(p.isDefault ?? p.default, false)) ?? null;
  }, [presetList, appliedPresetId]);
  const selectedChatPresetIsDefault = isEnabledFlag(
    selectedChatPreset?.isDefault ?? selectedChatPreset?.default,
    false,
  );
  const selectedChatPresetIsActive = isEnabledFlag(selectedChatPreset?.isActive ?? selectedChatPreset?.active, false);
  const [renamingPreset, setRenamingPreset] = useState(false);
  const [renamePresetVal, setRenamePresetVal] = useState("");
  const presetFileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) {
      setAgentAddPreview(null);
      setSavingAgentSettings(false);
    }
  }, [open]);

  useEffect(() => {
    setScenePromptDraft(sceneSystemPrompt);
    setNarratorStyleDraft(narratorStyleInstructions);
    setGroupScenarioDraft(groupScenarioText);
    setExtraPromptDraft(gameExtraPrompt);
    setGameImagePromptInstructionsDraft(gameImagePromptInstructions);
  }, [
    chat.id,
    sceneSystemPrompt,
    narratorStyleInstructions,
    groupScenarioText,
    gameExtraPrompt,
    gameImagePromptInstructions,
  ]);

  useEffect(() => {
    setSpotifyArtistDraft(spotifyArtist);
  }, [chat.id, spotifyArtist]);

  useEffect(() => {
    setGameSpotifyArtistDraft(gameSpotifyArtist);
  }, [chat.id, gameSpotifyArtist]);

  const openAgentConfigModal = (agent: AvailableAgent, mode: AgentAddPreview["mode"]) => {
    setAgentAddCadenceInputFocused(false);
    const config = agentConfigsByType.get(agent.id) ?? null;
    const mergedSettings = {
      ...getDefaultBuiltInAgentSettings(agent.id),
      ...parseAgentSettings(config?.settings),
    };
    const intervalMeta = getAgentRunIntervalMeta(agent.id, agent.builtIn);
    setAgentAddPreview({
      mode,
      agent,
      config,
      contextSize: normalizePositiveInteger(mergedSettings.contextSize, DEFAULT_AGENT_CONTEXT_SIZE, 200),
      maxTokens: normalizeAgentMaxTokens(mergedSettings.maxTokens),
      runInterval: intervalMeta
        ? normalizePositiveInteger(mergedSettings.runInterval, intervalMeta.defaultValue, intervalMeta.max)
        : null,
    });
  };

  const openAgentAddModal = (agent: AvailableAgent) => openAgentConfigModal(agent, "add");
  const openAgentSettingsModal = (agent: AvailableAgent) => openAgentConfigModal(agent, "edit");

  const confirmAgentSettings = async () => {
    if (!agentAddPreview) return;

    const { mode, agent, config, contextSize, maxTokens, runInterval } = agentAddPreview;
    const normalizedMaxTokens = normalizeAgentMaxTokens(maxTokens);
    const builtInMeta = BUILT_IN_AGENTS.find((entry) => entry.id === agent.id) ?? null;
    const nextSettings: Record<string, unknown> = {
      ...getDefaultBuiltInAgentSettings(agent.id),
      ...parseAgentSettings(config?.settings),
      contextSize,
      maxTokens: normalizedMaxTokens,
    };
    const intervalMeta = getAgentRunIntervalMeta(agent.id, !!builtInMeta);
    if (intervalMeta && runInterval != null) {
      nextSettings.runInterval = runInterval;
    }
    if (
      builtInMeta &&
      (!Array.isArray(nextSettings.enabledTools) || (agent.id === "spotify" && nextSettings.enabledTools.length === 0))
    ) {
      nextSettings.enabledTools = DEFAULT_AGENT_TOOLS[agent.id] ?? [];
    }

    setSavingAgentSettings(true);
    try {
      if (config) {
        await updateAgentConfig.mutateAsync({ id: config.id, enabled: true, settings: nextSettings });
      } else if (builtInMeta) {
        await createAgent.mutateAsync({
          type: builtInMeta.id,
          name: agent.name,
          description: agent.description,
          phase: agent.phase,
          enabled: true,
          connectionId: null,
          promptTemplate: "",
          settings: nextSettings,
        });
      }

      if (mode === "add") {
        await updateMeta.mutateAsync({
          id: chat.id,
          activeAgentIds: Array.from(new Set([...activeAgentIds, agent.id])),
          ...(agent.id === "secret-plot-driver"
            ? {
                showSecretPlotPanel: true,
              }
            : {}),
        });
      }
      setAgentAddPreview(null);
    } catch (error) {
      await showAlertDialog({
        title: mode === "add" ? "Couldn’t Add Agent" : "Couldn’t Update Agent",
        message:
          error instanceof Error
            ? error.message
            : mode === "add"
              ? "Failed to add the agent to this chat."
              : "Failed to update this agent's settings.",
      });
    } finally {
      setSavingAgentSettings(false);
    }
  };

  const ensureSpotifyAgent = useCallback(async () => {
    const builtInMeta = BUILT_IN_AGENTS.find((entry) => entry.id === "spotify");
    if (!builtInMeta) throw new Error("Spotify DJ agent metadata is missing.");
    const config = agentConfigsByType.get("spotify") ?? null;
    const nextSettings: Record<string, unknown> = {
      ...getDefaultBuiltInAgentSettings("spotify"),
      ...parseAgentSettings(config?.settings),
      enabledTools: DEFAULT_AGENT_TOOLS.spotify ?? [],
    };

    if (config) {
      await updateAgentConfig.mutateAsync({ id: config.id, enabled: true, settings: nextSettings });
      return;
    }

    await createAgent.mutateAsync({
      type: builtInMeta.id,
      name: builtInMeta.name,
      description: builtInMeta.description,
      phase: builtInMeta.phase,
      enabled: true,
      connectionId: null,
      promptTemplate: "",
      settings: nextSettings,
    });
  }, [agentConfigsByType, createAgent, updateAgentConfig]);

  const toggleGameSpotifyMusic = useCallback(async () => {
    if (gameUseSpotifyMusic) {
      await updateMeta.mutateAsync({
        id: chat.id,
        gameUseSpotifyMusic: false,
        activeAgentIds: activeAgentIds.filter((id) => id !== "spotify"),
      });
      return;
    }

    try {
      await ensureSpotifyAgent();
      await updateMeta.mutateAsync({
        id: chat.id,
        gameUseSpotifyMusic: true,
        gameSpotifySourceType,
        activeAgentIds: Array.from(new Set([...activeAgentIds, "spotify"])),
      });
    } catch (error) {
      await showAlertDialog({
        title: "Couldn't Enable Spotify DJ",
        message:
          error instanceof Error
            ? error.message
            : "Spotify DJ could not be enabled for this game. Check the Spotify agent setup and try again.",
      });
    }
  }, [activeAgentIds, chat.id, ensureSpotifyAgent, gameSpotifySourceType, gameUseSpotifyMusic, updateMeta]);

  const toggleGameLorebookKeeper = useCallback(() => {
    const nextActiveAgentIds = activeAgentIds.filter((id) => id !== "lorebook-keeper");
    if (gameLorebookKeeperEnabled) {
      const keeperLorebookIds = new Set(
        ((lorebooks ?? []) as Lorebook[])
          .filter((lorebook) => lorebook.sourceAgentId === "game-lorebook-keeper")
          .map((lorebook) => lorebook.id),
      );
      if (gameLorebookKeeperLorebookId) keeperLorebookIds.add(gameLorebookKeeperLorebookId);
      updateMeta.mutate({
        id: chat.id,
        gameLorebookKeeperEnabled: false,
        activeAgentIds: nextActiveAgentIds,
        activeLorebookIds: activeLorebookIds.filter((id) => !keeperLorebookIds.has(id)),
      });
      return;
    }

    updateMeta.mutate({
      id: chat.id,
      gameLorebookKeeperEnabled: true,
      activeAgentIds: nextActiveAgentIds,
    });
  }, [
    activeAgentIds,
    activeLorebookIds,
    chat.id,
    gameLorebookKeeperEnabled,
    gameLorebookKeeperLorebookId,
    lorebooks,
    updateMeta,
  ]);

  const agentAddIntervalMeta = agentAddPreview
    ? getAgentRunIntervalMeta(agentAddPreview.agent.id, agentAddPreview.agent.builtIn)
    : null;

  const snapshotCurrentPresetSettings = useCallback((): ChatPresetSettings => {
    return sanitizeChatPresetSettings(
      {
        connectionId: chat.connectionId ?? null,
        promptPresetId: isConversation ? null : (chat.promptPresetId ?? null),
        metadata: { ...metadata },
      },
      chatMode,
    );
  }, [chat.connectionId, chat.promptPresetId, chatMode, isConversation, metadata]);

  const handleSelectPreset = (id: string) => {
    if (!id || id === selectedChatPreset?.id) return;
    applyChatPreset.mutate({ presetId: id, chatId: chat.id });
  };

  const handleToggleDefaultPreset = () => {
    if (!selectedChatPreset || isEnabledFlag(selectedChatPreset.isActive ?? selectedChatPreset.active, false)) return;
    setActiveChatPreset.mutate(selectedChatPreset.id);
  };

  const handleSaveIntoPreset = () => {
    if (!selectedChatPreset || isEnabledFlag(selectedChatPreset.isDefault ?? selectedChatPreset.default, false)) return;
    saveChatPreset.mutate({ id: selectedChatPreset.id, settings: snapshotCurrentPresetSettings() });
  };

  const handleStartRenamePreset = () => {
    if (!selectedChatPreset || isEnabledFlag(selectedChatPreset.isDefault ?? selectedChatPreset.default, false)) return;
    setRenamePresetVal(selectedChatPreset.name);
    setRenamingPreset(true);
  };

  const handleCommitRenamePreset = () => {
    if (!selectedChatPreset || isEnabledFlag(selectedChatPreset.isDefault ?? selectedChatPreset.default, false)) {
      setRenamingPreset(false);
      return;
    }
    const next = renamePresetVal.trim();
    if (next && next !== selectedChatPreset.name) {
      renameChatPreset.mutate({ id: selectedChatPreset.id, name: next });
    }
    setRenamingPreset(false);
  };

  const handleSaveAsPreset = async () => {
    const baseName = await showPromptDialog({
      title: "Duplicate Preset",
      message: "Name for the new preset:",
      defaultValue: selectedChatPreset ? `${selectedChatPreset.name} Copy` : "New Preset",
      confirmLabel: "Create",
    });
    if (!baseName?.trim()) return;
    const trimmed = baseName.trim().slice(0, 120);
    if (!selectedChatPreset) {
      createChatPreset.mutate(
        { name: trimmed, mode: chatMode, settings: snapshotCurrentPresetSettings() },
        {
          onSuccess: (created) => {
            if (created?.id) applyChatPreset.mutate({ presetId: created.id, chatId: chat.id });
          },
        },
      );
      return;
    }
    duplicateChatPreset.mutate(
      { id: selectedChatPreset.id, name: trimmed },
      {
        onSuccess: (created) => {
          if (!created) return;
          // Save the current chat settings into the new preset, then apply it
          // (which records appliedChatPresetId on the chat so the dropdown follows).
          saveChatPreset.mutate(
            { id: created.id, settings: snapshotCurrentPresetSettings() },
            {
              onSuccess: () => applyChatPreset.mutate({ presetId: created.id, chatId: chat.id }),
            },
          );
        },
      },
    );
  };

  const handleDeletePreset = async () => {
    if (!selectedChatPreset || isEnabledFlag(selectedChatPreset.isDefault ?? selectedChatPreset.default, false)) return;
    const ok = await showConfirmDialog({
      title: "Delete Preset",
      message: `Delete preset "${selectedChatPreset.name}"? This cannot be undone.`,
      confirmLabel: "Delete",
      tone: "destructive",
    });
    if (!ok) return;
    const wasApplied = selectedChatPreset.id === appliedPresetId;
    const defaultPreset = presetList.find((p) => isEnabledFlag(p.isDefault ?? p.default, false));
    deleteChatPreset.mutate(selectedChatPreset.id, {
      onSuccess: () => {
        // If the chat was using the preset we just deleted, fall back to the
        // Default preset's settings — without this, the chat would visually
        // show "Default" but keep the deleted preset's actual values.
        if (wasApplied && defaultPreset) {
          applyChatPreset.mutate({ presetId: defaultPreset.id, chatId: chat.id });
        }
      },
    });
  };

  const handleExportPreset = () => {
    if (!selectedChatPreset) return;
    const envelope = createChatPresetExportEnvelope(selectedChatPreset);
    try {
      triggerDownloadWithToast(
        {
          blob: new Blob([JSON.stringify(envelope, null, 2)], { type: "application/json" }),
          filename: `${selectedChatPreset.name}.marinara-chat-preset.json`,
        },
        "Chat preset exported.",
      );
    } catch (error) {
      toastExportError(error, "Failed to export chat preset.");
    }
  };

  const handleImportClick = () => {
    presetFileInputRef.current?.click();
  };

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-importing the same file
    if (!file) return;
    try {
      const text = await file.text();
      const envelope = JSON.parse(text);
      const created = await importChatPreset.mutateAsync(envelope);
      if (created?.id) applyChatPreset.mutate({ presetId: created.id, chatId: chat.id });
    } catch (err) {
      await showAlertDialog({
        title: "Import Failed",
        message: `Failed to import preset: ${err instanceof Error ? err.message : "Invalid file"}`,
        tone: "destructive",
      });
    }
  };

  const saveName = () => {
    if (nameVal.trim() && nameVal !== chat.name) {
      updateChat.mutate({ id: chat.id, name: nameVal.trim() });
    }
    setEditingName(false);
  };

  const renderMemoryRecallControls = (defaultOn: boolean) => {
    const effectiveValue = metadata.enableMemoryRecall !== undefined ? metadata.enableMemoryRecall === true : defaultOn;
    return (
      <div className="space-y-2">
        <button
          onClick={() => {
            updateMeta.mutate({ id: chat.id, enableMemoryRecall: !effectiveValue });
          }}
          className={cn(
            "flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left transition-all",
            effectiveValue
              ? "bg-[var(--primary)]/10 ring-1 ring-[var(--primary)]/30"
              : "bg-[var(--secondary)] hover:bg-[var(--accent)]",
          )}
        >
          <div className="flex-1 min-w-0">
            <span className="text-[0.6875rem] font-medium">Enable Memory Recall</span>
            <p className="text-[0.625rem] text-[var(--muted-foreground)]">
              Recall earlier chat fragments with provider embeddings when configured, otherwise local lexical matching.
            </p>
          </div>
          <div
            className={cn(
              "h-5 w-9 shrink-0 rounded-full p-0.5 transition-colors",
              effectiveValue ? "bg-[var(--primary)]" : "bg-[var(--muted-foreground)]/50",
            )}
          >
            <div
              className={cn(
                "h-4 w-4 rounded-full bg-white shadow-sm transition-transform",
                effectiveValue && "translate-x-3.5",
              )}
            />
          </div>
        </button>
        <label className="flex min-w-0 flex-col gap-1 text-[0.625rem] text-[var(--muted-foreground)]">
          <span className="font-medium text-[var(--foreground)]">Read Behind</span>
          <input
            type="number"
            min={0}
            max={100}
            step={1}
            value={memoryRecallReadBehindMessages}
            onChange={(e) => {
              const nextValue = e.target.value === "" ? 1 : Number.parseInt(e.target.value, 10);
              updateMeta.mutate({
                id: chat.id,
                memoryRecallReadBehindMessages: Number.isFinite(nextValue) ? Math.max(0, Math.min(100, nextValue)) : 1,
              });
            }}
            className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-2.5 py-2 text-xs text-[var(--foreground)]"
          />
          <span>
            Ignore memory chunks from the newest messages. 1 protects the latest generated reply during swipes.
          </span>
        </label>
        <button
          type="button"
          onClick={() => setShowMemoriesModal(true)}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-[var(--secondary)] px-3 py-2 text-[0.6875rem] font-medium text-[var(--foreground)] transition-colors hover:bg-[var(--accent)]"
        >
          <Brain size="0.75rem" />
          Access memories for this chat
        </button>
      </div>
    );
  };

  if (!open) return null;

  return (
    <>
      {/* Backdrop */}
      <div className="absolute inset-0 z-40 bg-black/30 backdrop-blur-[2px]" onClick={onClose} />

      {/* Drawer */}
      <div className="absolute right-0 top-0 z-50 flex h-full w-80 max-md:w-full flex-col border-l border-[var(--border)] bg-[var(--background)] shadow-2xl animate-fade-in-up max-md:pt-[env(safe-area-inset-top)]">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3">
          <h3 className="text-sm font-bold">Chat Settings</h3>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-[var(--muted-foreground)] transition-all hover:bg-[var(--accent)]"
          >
            <X size="1rem" />
          </button>
        </div>

        {/* Chat Settings Preset bar — hidden in Game Mode and scene chats. */}
        {!isGame && !isSceneChat && (
          <ChatPresetBar
            fileInputRef={presetFileInputRef}
            isConversation={isConversation}
            presetList={presetList}
            selectedChatPreset={selectedChatPreset}
            selectedChatPresetIsActive={selectedChatPresetIsActive}
            selectedChatPresetIsDefault={selectedChatPresetIsDefault}
            renamingPreset={renamingPreset}
            renamePresetVal={renamePresetVal}
            defaultTogglePending={setActiveChatPreset.isPending}
            onImportFile={handleImportFile}
            onRenamePresetValChange={setRenamePresetVal}
            onCommitRenamePreset={handleCommitRenamePreset}
            onCancelRenamePreset={() => setRenamingPreset(false)}
            onSelectPreset={handleSelectPreset}
            onToggleDefaultPreset={handleToggleDefaultPreset}
            onSaveIntoPreset={handleSaveIntoPreset}
            onStartRenamePreset={handleStartRenamePreset}
            onSaveAsPreset={handleSaveAsPreset}
            onImportClick={handleImportClick}
            onExportPreset={handleExportPreset}
            onDeletePreset={handleDeletePreset}
          />
        )}

        <div className="flex-1 overflow-y-auto">
          {/* Hardcoded — CHAT_MODES.defaultAgents looks like the source of truth but is currently
              unused, and wouldn't cover non-agent built-ins (GM pipeline, autonomous messaging, etc.) anyway. */}
          {MODE_INTROS[chatMode as ChatMode] && (
            <div className="border-b border-[var(--border)] px-4 py-2.5">
              <p className="text-[0.625rem] leading-relaxed text-[var(--muted-foreground)]">
                {MODE_INTROS[chatMode as ChatMode]}
              </p>
            </div>
          )}

          <Section
            label="Continuity"
            icon={<Brain size="0.875rem" />}
            count={continuityOverviewActiveCount}
            help="Overview of the memory, summary, world-info, and tracker context this chat can carry forward."
          >
            <ContinuityOverviewPanel
              model={continuityOverviewModel}
              onOpenMemories={() => setShowMemoriesModal(true)}
              onOpenSummaries={() => setShowSummariesModal(true)}
            />
          </Section>

          <ChatBasicSettingsSections
            chat={chat}
            isConversation={isConversation}
            isGame={isGame}
            sceneSystemPrompt={sceneSystemPrompt}
            editingName={editingName}
            nameVal={nameVal}
            textConnectionsList={textConnectionsList}
            presets={(presets ?? []) as ChatPreset[]}
            currentPromptPresetHasVariables={currentPromptPresetHasVariables}
            showLorebookMarkerWarning={showLorebookMarkerWarning}
            onNameValChange={setNameVal}
            onEditName={() => {
              setNameVal(chat.name);
              setEditingName(true);
            }}
            onSaveName={saveName}
            onConnectionChange={setConnection}
            onPresetChange={setPreset}
            onEditPresetChoices={() => {
              if (chat.promptPresetId) setChoiceModalPresetId(chat.promptPresetId);
            }}
          />

          <ModePromptSettingsSections
            isRoleplayMode={isRoleplayMode}
            isGame={isGame}
            sceneSystemPrompt={sceneSystemPrompt}
            narratorStyleDraft={narratorStyleDraft}
            narratorStyleInstructions={narratorStyleInstructions}
            narratorStyleExpanded={narratorStyleExpanded}
            extraPromptDraft={extraPromptDraft}
            gameExtraPrompt={gameExtraPrompt}
            extraPromptExpanded={extraPromptExpanded}
            scenePromptDraft={scenePromptDraft}
            scenePromptExpanded={scenePromptExpanded}
            onNarratorStyleDraftChange={setNarratorStyleDraft}
            onNarratorStyleExpandedChange={setNarratorStyleExpanded}
            onExtraPromptDraftChange={setExtraPromptDraft}
            onExtraPromptExpandedChange={setExtraPromptExpanded}
            onScenePromptDraftChange={setScenePromptDraft}
            onScenePromptExpandedChange={setScenePromptExpanded}
            onMetadataPatch={(patch) => updateMeta.mutate({ id: chat.id, ...patch })}
          />

          {/* Party (game mode) */}
          {isGame && (
            <Section
              label="Party"
              icon={<Users size="0.875rem" />}
              count={chatCharIds.length + (chat.personaId ? 1 : 0)}
              help="Your in-game party. Pick a persona to play as and manage which characters join the adventure."
            >
              <div className="space-y-1.5">
                <label className="text-[0.6875rem] font-medium text-[var(--muted-foreground)]">Persona</label>
                {chat.personaId ? (
                  <div className="flex items-center gap-2.5 rounded-lg bg-[var(--primary)]/10 px-2.5 py-2 ring-1 ring-[var(--primary)]/30">
                    {(() => {
                      const p = personas.find((persona) => persona.id === chat.personaId);
                      return p ? (
                        <>
                          {p.avatarPath ? (
                            <PersonaAvatarImage
                              persona={p}
                              alt={p.name}
                              className="h-7 w-7 shrink-0 rounded-full object-cover"
                              thumbnailSize={64}
                            />
                          ) : (
                            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-emerald-400 to-teal-500 text-white">
                              <User size="0.75rem" />
                            </div>
                          )}
                          <div className="min-w-0 flex-1">
                            <span className="block truncate text-xs">{p.name}</span>
                            {p.comment && (
                              <span className="block truncate text-[0.625rem] italic text-[var(--muted-foreground)]">
                                {p.comment}
                              </span>
                            )}
                          </div>
                        </>
                      ) : (
                        <span className="flex-1 truncate text-xs text-[var(--muted-foreground)]">Unknown persona</span>
                      );
                    })()}
                    <button
                      onClick={() => updateChat.mutate({ id: chat.id, personaId: null })}
                      className="ml-auto shrink-0 rounded p-0.5 text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)]"
                      title="Remove persona"
                    >
                      <X size="0.75rem" />
                    </button>
                  </div>
                ) : (
                  <p className="text-[0.6875rem] text-[var(--muted-foreground)]">No persona selected.</p>
                )}

                {!showPersonaPicker ? (
                  <button
                    onClick={() => {
                      setShowPersonaPicker(true);
                      setPersonaSearch("");
                    }}
                    className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-[var(--border)] px-3 py-2 text-xs text-[var(--muted-foreground)] transition-colors hover:border-[var(--primary)]/40 hover:text-[var(--primary)]"
                  >
                    <Plus size="0.75rem" /> {chat.personaId ? "Change" : "Choose"} Persona
                  </button>
                ) : (
                  <PickerDropdown
                    search={personaSearch}
                    onSearchChange={setPersonaSearch}
                    onClose={() => setShowPersonaPicker(false)}
                    placeholder="Search personas..."
                  >
                    <button
                      onClick={() => {
                        updateChat.mutate({ id: chat.id, personaId: null });
                        setShowPersonaPicker(false);
                      }}
                      className={cn(
                        "flex items-center gap-2.5 rounded-lg px-3 py-2 text-left transition-all hover:bg-[var(--accent)]",
                        !chat.personaId && "bg-[var(--primary)]/10",
                      )}
                    >
                      <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--accent)] text-[var(--muted-foreground)]">
                        <X size="0.625rem" />
                      </div>
                      <span className="flex-1 truncate text-xs">None</span>
                      {!chat.personaId && <Check size="0.625rem" className="ml-auto shrink-0 text-[var(--primary)]" />}
                    </button>
                    {personas
                      .filter(
                        (p) =>
                          p.name.toLowerCase().includes(personaSearch.toLowerCase()) ||
                          (p.comment && p.comment.toLowerCase().includes(personaSearch.toLowerCase())),
                      )
                      .map((p) => (
                        <button
                          key={p.id}
                          onClick={() => {
                            updateChat.mutate({ id: chat.id, personaId: p.id });
                            setShowPersonaPicker(false);
                          }}
                          className={cn(
                            "flex items-center gap-2.5 rounded-lg px-3 py-2 text-left transition-all hover:bg-[var(--accent)]",
                            chat.personaId === p.id && "bg-[var(--primary)]/10",
                          )}
                        >
                          {p.avatarPath ? (
                            <PersonaAvatarImage
                              persona={p}
                              alt={p.name}
                              className="h-6 w-6 shrink-0 rounded-full object-cover"
                              thumbnailSize={64}
                            />
                          ) : (
                            <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-emerald-400 to-teal-500 text-white">
                              <User size="0.625rem" />
                            </div>
                          )}
                          <div className="min-w-0 flex-1">
                            <span className="block truncate text-xs">{p.name}</span>
                            {p.comment && (
                              <span className="block truncate text-[0.625rem] italic text-[var(--muted-foreground)]">
                                {p.comment}
                              </span>
                            )}
                          </div>
                          {chat.personaId === p.id && (
                            <Check size="0.625rem" className="ml-auto shrink-0 text-[var(--primary)]" />
                          )}
                        </button>
                      ))}
                    {personas.filter(
                      (p) =>
                        p.name.toLowerCase().includes(personaSearch.toLowerCase()) ||
                        (p.comment && p.comment.toLowerCase().includes(personaSearch.toLowerCase())),
                    ).length === 0 && (
                      <p className="px-3 py-2 text-[0.6875rem] text-[var(--muted-foreground)]">
                        {personas.length === 0 ? "No personas created yet." : "No matches."}
                      </p>
                    )}
                  </PickerDropdown>
                )}
              </div>

              <div className="mt-2 space-y-1.5">
                <label className="text-[0.6875rem] font-medium text-[var(--muted-foreground)]">Party Characters</label>
                {chatCharIds.length === 0 ? (
                  <p className="text-[0.6875rem] text-[var(--muted-foreground)]">No characters in party yet.</p>
                ) : (
                  <div className="flex flex-col gap-1">
                    {chatCharIds.map((cid) => {
                      const c = characters.find((ch) => ch.id === cid);
                      if (!c) return null;
                      const name = charName(c);
                      const title = charTitle(c);
                      return (
                        <div
                          key={c.id}
                          className="flex items-center gap-2.5 rounded-lg bg-[var(--primary)]/10 px-3 py-2 ring-1 ring-[var(--primary)]/30"
                        >
                          <button
                            onClick={() => openCharacterProfilePreview(c.id)}
                            className="flex min-w-0 flex-1 items-center gap-2.5 text-left transition-colors hover:opacity-80"
                            title="Preview public profile"
                          >
                            {c.avatarPath ? (
                              <span className="relative block h-7 w-7 shrink-0 overflow-hidden rounded-full">
                                <AvatarImage src={c.avatarPath} alt={name} crop={charAvatarCrop(c)} />
                              </span>
                            ) : (
                              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--accent)] text-[0.625rem] font-bold">
                                {name[0]}
                              </div>
                            )}
                            <div className="min-w-0 flex-1">
                              <span className="block truncate text-xs">{name}</span>
                              {title && (
                                <span className="block truncate text-[0.625rem] italic text-[var(--muted-foreground)]">
                                  {title}
                                </span>
                              )}
                            </div>
                          </button>
                          <button
                            onClick={() => toggleCharacter(c.id)}
                            className="flex h-5 w-5 items-center justify-center rounded-md text-[var(--muted-foreground)] transition-colors hover:bg-[var(--destructive)]/15 hover:text-[var(--destructive)]"
                            title="Remove from party"
                          >
                            <Trash2 size="0.6875rem" />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {!showCharPicker ? (
                <button
                  onClick={() => {
                    setShowCharPicker(true);
                    setCharSearch("");
                  }}
                  className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-[var(--border)] px-3 py-2 text-xs text-[var(--muted-foreground)] transition-colors hover:border-[var(--primary)]/40 hover:text-[var(--primary)]"
                >
                  <Plus size="0.75rem" /> Add Character to Party
                </button>
              ) : (
                <PickerDropdown
                  search={charSearch}
                  onSearchChange={setCharSearch}
                  onClose={() => setShowCharPicker(false)}
                  placeholder="Search characters…"
                >
                  {filteredAvailableCharacters.map((c) => {
                    const name = charName(c);
                    const title = charTitle(c);
                    return (
                      <button
                        key={c.id}
                        onClick={() => {
                          toggleCharacter(c.id);
                          setShowCharPicker(false);
                        }}
                        className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-left transition-all hover:bg-[var(--accent)]"
                      >
                        <div className="min-w-0 flex-1">
                          <span className="block truncate text-xs">{name}</span>
                          {title && (
                            <span className="block truncate text-[0.625rem] italic text-[var(--muted-foreground)]">
                              {title}
                            </span>
                          )}
                        </div>
                        <Plus size="0.75rem" className="text-[var(--muted-foreground)]" />
                      </button>
                    );
                  })}
                  {filteredAvailableCharacters.length === 0 && (
                    <p className="px-3 py-2 text-[0.6875rem] text-[var(--muted-foreground)]">
                      {characterSearchFailed
                        ? "Characters could not be loaded."
                        : characterSearchPending
                          ? "Loading characters..."
                          : availableCharacters.length === 0
                            ? "All characters already added."
                            : "No matches."}
                    </p>
                  )}
                </PickerDropdown>
              )}
            </Section>
          )}

          {/* Persona */}
          {!isGame && (
            <Section
              label="Persona"
              icon={<User size="0.875rem" />}
              help="Your persona defines who you are in this chat. The AI will address you by this persona's name and use its details for context."
            >
              {/* Currently selected persona */}
              {chat.personaId ? (
                <div className="flex items-center gap-2.5 rounded-lg bg-[var(--primary)]/10 px-2.5 py-2">
                  {(() => {
                    const p = personas.find((p) => p.id === chat.personaId);
                    return p ? (
                      <>
                        {p.avatarPath ? (
                          <PersonaAvatarImage
                            persona={p}
                            alt={p.name}
                            className="h-7 w-7 shrink-0 rounded-full object-cover"
                            thumbnailSize={64}
                          />
                        ) : (
                          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-emerald-400 to-teal-500 text-white">
                            <User size="0.75rem" />
                          </div>
                        )}
                        <div className="min-w-0 flex-1">
                          <span className="block truncate text-xs">{p.name}</span>
                          {p.comment && (
                            <span className="block truncate text-[0.625rem] italic text-[var(--muted-foreground)]">
                              {p.comment}
                            </span>
                          )}
                        </div>
                      </>
                    ) : (
                      <span className="flex-1 truncate text-xs text-[var(--muted-foreground)]">Unknown persona</span>
                    );
                  })()}
                  <button
                    onClick={() => updateChat.mutate({ id: chat.id, personaId: null })}
                    className="ml-auto shrink-0 rounded p-0.5 text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)]"
                    title="Remove persona"
                  >
                    <X size="0.75rem" />
                  </button>
                </div>
              ) : (
                <p className="text-[0.6875rem] text-[var(--muted-foreground)]">No persona selected.</p>
              )}

              {/* Persona picker */}
              {!showPersonaPicker ? (
                <button
                  onClick={() => {
                    setShowPersonaPicker(true);
                    setPersonaSearch("");
                  }}
                  className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-[var(--border)] px-3 py-2 text-xs text-[var(--muted-foreground)] transition-colors hover:border-[var(--primary)]/40 hover:text-[var(--primary)]"
                >
                  <Plus size="0.75rem" /> {chat.personaId ? "Change" : "Choose"} Persona
                </button>
              ) : (
                <PickerDropdown
                  search={personaSearch}
                  onSearchChange={setPersonaSearch}
                  onClose={() => setShowPersonaPicker(false)}
                  placeholder="Search personas..."
                >
                  {/* None option */}
                  <button
                    onClick={() => {
                      updateChat.mutate({ id: chat.id, personaId: null });
                      setShowPersonaPicker(false);
                    }}
                    className={cn(
                      "flex items-center gap-2.5 rounded-lg px-3 py-2 text-left transition-all hover:bg-[var(--accent)]",
                      !chat.personaId && "bg-[var(--primary)]/10",
                    )}
                  >
                    <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--accent)] text-[var(--muted-foreground)]">
                      <X size="0.625rem" />
                    </div>
                    <span className="flex-1 truncate text-xs">None</span>
                    {!chat.personaId && <Check size="0.625rem" className="ml-auto shrink-0 text-[var(--primary)]" />}
                  </button>
                  {personas
                    .filter(
                      (p) =>
                        p.name.toLowerCase().includes(personaSearch.toLowerCase()) ||
                        (p.comment && p.comment.toLowerCase().includes(personaSearch.toLowerCase())),
                    )
                    .map((p) => (
                      <button
                        key={p.id}
                        onClick={() => {
                          updateChat.mutate({ id: chat.id, personaId: p.id });
                          setShowPersonaPicker(false);
                        }}
                        className={cn(
                          "flex items-center gap-2.5 rounded-lg px-3 py-2 text-left transition-all hover:bg-[var(--accent)]",
                          chat.personaId === p.id && "bg-[var(--primary)]/10",
                        )}
                      >
                        {p.avatarPath ? (
                          <PersonaAvatarImage
                            persona={p}
                            alt={p.name}
                            className="h-6 w-6 shrink-0 rounded-full object-cover"
                            thumbnailSize={64}
                          />
                        ) : (
                          <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-emerald-400 to-teal-500 text-white">
                            <User size="0.625rem" />
                          </div>
                        )}
                        <div className="min-w-0 flex-1">
                          <span className="block truncate text-xs">{p.name}</span>
                          {p.comment && (
                            <span className="block truncate text-[0.625rem] italic text-[var(--muted-foreground)]">
                              {p.comment}
                            </span>
                          )}
                        </div>
                        {chat.personaId === p.id && (
                          <Check size="0.625rem" className="ml-auto shrink-0 text-[var(--primary)]" />
                        )}
                      </button>
                    ))}
                  {personas.filter(
                    (p) =>
                      p.name.toLowerCase().includes(personaSearch.toLowerCase()) ||
                      (p.comment && p.comment.toLowerCase().includes(personaSearch.toLowerCase())),
                  ).length === 0 && (
                    <p className="px-3 py-2 text-[0.6875rem] text-[var(--muted-foreground)]">
                      {personas.length === 0 ? "No personas created yet." : "No matches."}
                    </p>
                  )}
                </PickerDropdown>
              )}
            </Section>
          )}

          {/* Characters — only show added ones + add button */}
          {!isGame && (
            <Section
              label="Characters"
              icon={<Users size="0.875rem" />}
              count={chatCharIds.length}
              help="Characters in this chat. Each character has their own personality that the AI roleplays as."
            >
              {/* Active characters */}
              {chatCharIds.length === 0 ? (
                <p className="text-[0.6875rem] text-[var(--muted-foreground)]">No characters added to this chat.</p>
              ) : (
                <div
                  className="flex flex-col gap-1"
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDropIdx(chatCharIds.length);
                  }}
                  onDrop={handleCharDrop}
                >
                  {chatCharIds.map((cid, i) => {
                    const c = characters.find((ch) => ch.id === cid);
                    if (!c) return null;
                    const name = charName(c);
                    const title = charTitle(c);
                    const isInactive = inactiveCharacterIdSet.has(c.id);
                    const canDeactivate = !isInactive && activeChatCharacterCount <= 1;
                    return (
                      <div key={c.id}>
                        {dropIdx === i && dragIdx !== null && dragIdx !== i && (
                          <div className="h-0.5 rounded-full bg-[var(--primary)] mx-2 mb-1" />
                        )}
                        <div
                          draggable
                          onDragStart={(e) => handleCharDragStart(i, e)}
                          onDragOver={(e) => {
                            e.stopPropagation();
                            handleCharDragOver(i, e);
                          }}
                          onDragEnd={handleCharDragEnd}
                          className={cn(
                            "flex items-center gap-2 rounded-lg px-2 py-2 ring-1 transition-opacity",
                            isInactive
                              ? "bg-[var(--secondary)] text-[var(--muted-foreground)] ring-[var(--border)]"
                              : "bg-[var(--primary)]/10 ring-[var(--primary)]/30",
                            dragIdx === i && "opacity-40",
                          )}
                        >
                          <div
                            className="cursor-grab text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors active:cursor-grabbing"
                            title="Drag to reorder"
                          >
                            <GripVertical size="0.75rem" />
                          </div>
                          <button
                            onClick={() => openCharacterProfilePreview(c.id)}
                            className="flex items-center gap-2.5 min-w-0 flex-1 text-left transition-colors hover:opacity-80"
                            title="Preview public profile"
                          >
                            {c.avatarPath ? (
                              <span className="relative block h-7 w-7 shrink-0 overflow-hidden rounded-full">
                                <AvatarImage src={c.avatarPath} alt={name} crop={charAvatarCrop(c)} />
                              </span>
                            ) : (
                              <div className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--accent)] text-[0.625rem] font-bold">
                                {name[0]}
                              </div>
                            )}
                            <div className="min-w-0 flex-1">
                              <span className="block truncate text-xs">{name}</span>
                              {title && (
                                <span className="block truncate text-[0.625rem] italic text-[var(--muted-foreground)]">
                                  {title}
                                </span>
                              )}
                            </div>
                          </button>
                          <button
                            type="button"
                            onClick={() => toggleCharacterGenerationActive(c.id)}
                            disabled={canDeactivate}
                            className={cn(
                              "rounded-md px-2 py-1 text-[0.625rem] font-medium transition-colors",
                              isInactive
                                ? "bg-[var(--muted)] text-[var(--muted-foreground)] hover:bg-[var(--accent)] hover:text-[var(--foreground)]"
                                : "bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500/15",
                              canDeactivate && "cursor-not-allowed opacity-50",
                            )}
                            title={
                              isInactive
                                ? "Mark active for generation"
                                : canDeactivate
                                  ? "At least one character must stay active"
                                  : "Mark inactive for generation"
                            }
                          >
                            {isInactive ? "Inactive" : "Active"}
                          </button>
                          <button
                            onClick={() => toggleCharacter(c.id)}
                            className="flex h-5 w-5 items-center justify-center rounded-md text-[var(--muted-foreground)] transition-colors hover:bg-[var(--destructive)]/15 hover:text-[var(--destructive)]"
                            title="Remove from chat"
                          >
                            <Trash2 size="0.6875rem" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                  {dropIdx === chatCharIds.length && dragIdx !== null && (
                    <div className="h-0.5 rounded-full bg-[var(--primary)] mx-2 mt-1" />
                  )}
                </div>
              )}

              {/* Add character picker */}
              {!showCharPicker ? (
                <button
                  onClick={() => {
                    setShowCharPicker(true);
                    setCharSearch("");
                  }}
                  className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-[var(--border)] px-3 py-2 text-xs text-[var(--muted-foreground)] transition-colors hover:border-[var(--primary)]/40 hover:text-[var(--primary)]"
                >
                  <Plus size="0.75rem" /> Add Character
                </button>
              ) : (
                <PickerDropdown
                  search={charSearch}
                  onSearchChange={setCharSearch}
                  onClose={() => setShowCharPicker(false)}
                  placeholder="Search characters…"
                >
                  {filteredAvailableCharacters.map((c) => {
                    const name = charName(c);
                    const title = charTitle(c);
                    return (
                      <button
                        key={c.id}
                        onClick={() => {
                          toggleCharacter(c.id);
                          setShowCharPicker(false);
                        }}
                        className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-left transition-all hover:bg-[var(--accent)]"
                      >
                        {c.avatarPath ? (
                          <span className="relative block h-6 w-6 shrink-0 overflow-hidden rounded-full">
                            <AvatarImage src={c.avatarPath} alt={name} crop={charAvatarCrop(c)} />
                          </span>
                        ) : (
                          <div className="flex h-6 w-6 items-center justify-center rounded-full bg-[var(--accent)] text-[0.5625rem] font-bold">
                            {name[0]}
                          </div>
                        )}
                        <div className="min-w-0 flex-1">
                          <span className="block truncate text-xs">{name}</span>
                          {title && (
                            <span className="block truncate text-[0.625rem] italic text-[var(--muted-foreground)]">
                              {title}
                            </span>
                          )}
                        </div>
                        <Plus size="0.75rem" className="text-[var(--muted-foreground)]" />
                      </button>
                    );
                  })}
                  {filteredAvailableCharacters.length === 0 && (
                    <p className="px-3 py-2 text-[0.6875rem] text-[var(--muted-foreground)]">
                      {characterSearchFailed
                        ? "Characters could not be loaded."
                        : characterSearchPending
                          ? "Loading characters..."
                          : availableCharacters.length === 0
                            ? "All characters already added."
                            : "No matches."}
                    </p>
                  )}
                </PickerDropdown>
              )}

              {/* Add from Group picker */}
              {((characterGroups ?? []) as CharacterGroup[]).length > 0 &&
                (!showGroupPicker ? (
                  <button
                    onClick={() => setShowGroupPicker(true)}
                    className="mt-1 flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-[var(--border)] px-3 py-2 text-xs text-[var(--muted-foreground)] transition-colors hover:border-[var(--primary)]/40 hover:text-[var(--primary)]"
                  >
                    <Users size="0.75rem" /> Add from Group
                  </button>
                ) : (
                  <PickerDropdown
                    search=""
                    onSearchChange={() => {}}
                    onClose={() => setShowGroupPicker(false)}
                    placeholder="Select a group…"
                  >
                    {((characterGroups ?? []) as CharacterGroup[]).map((group) => {
                      const rawIds = group.characterIds ?? [];
                      const groupCharIds: string[] = Array.isArray(rawIds)
                        ? rawIds
                        : typeof rawIds === "string"
                          ? JSON.parse(rawIds)
                          : [];
                      const newIds = groupCharIds.filter((id) => !chatCharIds.includes(id));
                      return (
                        <button
                          key={group.id}
                          onClick={() => {
                            if (newIds.length > 0) {
                              updateChat.mutate({ id: chat.id, characterIds: [...chatCharIds, ...newIds] });
                            }
                            setShowGroupPicker(false);
                          }}
                          className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-left transition-all hover:bg-[var(--accent)]"
                        >
                          {group.avatarPath ? (
                            <img
                              src={group.avatarPath}
                              alt={group.name}
                              loading="lazy"
                              className="h-6 w-6 rounded-full object-cover"
                            />
                          ) : (
                            <div className="flex h-6 w-6 items-center justify-center rounded-full bg-[var(--accent)] text-[0.5625rem] font-bold">
                              {group.name[0]}
                            </div>
                          )}
                          <div className="flex-1 min-w-0">
                            <span className="block truncate text-xs">{group.name}</span>
                            <span className="block truncate text-[0.625rem] text-[var(--muted-foreground)]">
                              {groupCharIds.length} characters
                              {newIds.length > 0 ? ` (· ${newIds.length} new)` : " (all added)"}
                            </span>
                          </div>
                          {newIds.length > 0 && <Plus size="0.75rem" className="text-[var(--muted-foreground)]" />}
                        </button>
                      );
                    })}
                  </PickerDropdown>
                ))}
            </Section>
          )}

          {isConversation && <ConversationPromptSection chat={chat} metadata={metadata} updateMeta={updateMeta} />}

          {isConversation && (
            <Section
              label="Manual Replies"
              icon={<MessageCircle size="0.875rem" />}
              help="When enabled, conversation messages are saved without auto-generating a reply unless you @mention a character or trigger one from the input bar."
            >
              <button
                onClick={() =>
                  updateMeta.mutate({
                    id: chat.id,
                    groupResponseOrder: metadata.groupResponseOrder === "manual" ? "smart" : "manual",
                  })
                }
                className={cn(
                  "flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left transition-all",
                  metadata.groupResponseOrder === "manual"
                    ? "bg-[var(--primary)]/10 ring-1 ring-[var(--primary)]/30"
                    : "bg-[var(--secondary)] hover:bg-[var(--accent)]",
                )}
              >
                <div className="min-w-0 flex-1">
                  <span className="text-[0.6875rem] font-medium">Only Reply When Mentioned</span>
                  <p className="mt-0.5 text-[0.625rem] leading-relaxed text-[var(--muted-foreground)]">
                    {metadata.groupResponseOrder === "manual"
                      ? "Characters will stay quiet until you type @Name or use the character picker."
                      : "Characters reply automatically; @mentions focus the response on the mentioned character."}
                  </p>
                </div>
                <div
                  className={cn(
                    "ml-3 h-5 w-9 shrink-0 rounded-full p-0.5 transition-colors",
                    metadata.groupResponseOrder === "manual"
                      ? "bg-[var(--primary)]"
                      : "bg-[var(--muted-foreground)]/50",
                  )}
                >
                  <div
                    className={cn(
                      "h-4 w-4 rounded-full bg-white shadow-sm transition-transform",
                      metadata.groupResponseOrder === "manual" && "translate-x-3.5",
                    )}
                  />
                </div>
              </button>
            </Section>
          )}

          {/* Group Chat Settings — only when 2+ characters, game mode handles it internally */}
          {chatCharIds.length > 1 && !isGame && !isConversation && (
            <Section
              label="Group Chat"
              icon={<Users size="0.875rem" />}
              help={
                isConversation
                  ? "Configure whether group conversations reply automatically or wait for a manually triggered character response."
                  : "Configure how multiple characters interact. Merged mode combines all characters into one narrator; Individual mode has each character respond separately."
              }
            >
              {/* Mode selector */}
              {!isConversation && (
                <div className="space-y-2">
                  <label className="text-[0.6875rem] font-medium text-[var(--muted-foreground)]">Mode</label>
                  <div className="flex rounded-lg ring-1 ring-[var(--border)]">
                    <button
                      onClick={() => updateMeta.mutate({ id: chat.id, groupChatMode: "merged" })}
                      className={cn(
                        "flex-1 px-3 py-2 text-[0.6875rem] font-medium transition-colors rounded-l-lg",
                        (metadata.groupChatMode ?? "merged") === "merged"
                          ? "bg-[var(--primary)] text-white"
                          : "text-[var(--muted-foreground)] hover:bg-[var(--accent)]",
                      )}
                    >
                      Merged (Narrator)
                    </button>
                    <button
                      onClick={() => updateMeta.mutate({ id: chat.id, groupChatMode: "individual" })}
                      className={cn(
                        "flex-1 px-3 py-2 text-[0.6875rem] font-medium transition-colors rounded-r-lg",
                        metadata.groupChatMode === "individual"
                          ? "bg-[var(--primary)] text-white"
                          : "text-[var(--muted-foreground)] hover:bg-[var(--accent)]",
                      )}
                    >
                      Individual
                    </button>
                  </div>
                </div>
              )}

              {/* Merged mode: speaker color option */}
              {!isConversation && (metadata.groupChatMode ?? "merged") === "merged" && (
                <div className="mt-2">
                  <button
                    onClick={() => updateMeta.mutate({ id: chat.id, groupSpeakerColors: !groupSpeakerColorsEnabled })}
                    className={cn(
                      "flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left transition-all",
                      groupSpeakerColorsEnabled
                        ? "bg-[var(--primary)]/10 ring-1 ring-[var(--primary)]/30"
                        : "bg-[var(--secondary)] hover:bg-[var(--accent)]",
                    )}
                  >
                    <div className="flex-1 min-w-0">
                      <span className="text-[0.6875rem] font-medium">Color Dialogues</span>
                      <p className="text-[0.625rem] text-[var(--muted-foreground)]">
                        Color character dialogues differently using the special tags. The colors are assigned based on
                        what you chose in the Color tab for your Character.
                      </p>
                    </div>
                    <div
                      className={cn(
                        "h-5 w-9 shrink-0 rounded-full p-0.5 transition-colors",
                        groupSpeakerColorsEnabled ? "bg-[var(--primary)]" : "bg-[var(--muted-foreground)]/50",
                      )}
                    >
                      <div
                        className={cn(
                          "h-4 w-4 rounded-full bg-white shadow-sm transition-transform",
                          groupSpeakerColorsEnabled && "translate-x-3.5",
                        )}
                      />
                    </div>
                  </button>
                </div>
              )}

              {/* Individual mode: response order */}
              {!isConversation && metadata.groupChatMode === "individual" && (
                <div className="mt-2 space-y-2">
                  <label className="text-[0.6875rem] font-medium text-[var(--muted-foreground)]">Response Order</label>
                  <div className="flex rounded-lg ring-1 ring-[var(--border)]">
                    <button
                      onClick={() => updateMeta.mutate({ id: chat.id, groupResponseOrder: "sequential" })}
                      className={cn(
                        "flex-1 px-3 py-2 text-[0.6875rem] font-medium transition-colors rounded-l-lg",
                        metadata.groupResponseOrder === "sequential"
                          ? "bg-[var(--primary)] text-white"
                          : "text-[var(--muted-foreground)] hover:bg-[var(--accent)]",
                      )}
                    >
                      Sequential
                    </button>
                    <button
                      onClick={() => updateMeta.mutate({ id: chat.id, groupResponseOrder: "smart" })}
                      className={cn(
                        "flex-1 px-3 py-2 text-[0.6875rem] font-medium transition-colors",
                        (metadata.groupResponseOrder ?? "smart") === "smart"
                          ? "bg-[var(--primary)] text-white"
                          : "text-[var(--muted-foreground)] hover:bg-[var(--accent)]",
                      )}
                    >
                      Smart
                    </button>
                    <button
                      onClick={() => updateMeta.mutate({ id: chat.id, groupResponseOrder: "manual" })}
                      className={cn(
                        "flex-1 px-3 py-2 text-[0.6875rem] font-medium transition-colors rounded-r-lg",
                        metadata.groupResponseOrder === "manual"
                          ? "bg-[var(--primary)] text-white"
                          : "text-[var(--muted-foreground)] hover:bg-[var(--accent)]",
                      )}
                    >
                      Manual
                    </button>
                  </div>
                  <p className="text-[0.625rem] text-[var(--muted-foreground)]">
                    {metadata.groupResponseOrder === "manual"
                      ? "No automatic responses — use the character picker in the input bar to trigger responses one at a time."
                      : (metadata.groupResponseOrder ?? "smart") === "smart"
                        ? "An AI agent decides which characters should respond based on the scene context."
                        : "Characters respond one by one in their listed order."}
                  </p>
                  <button
                    onClick={() =>
                      updateMeta.mutate({
                        id: chat.id,
                        groupSpeakerNamesInHistory: !groupSpeakerNamesInHistoryEnabled,
                      })
                    }
                    className={cn(
                      "flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left transition-all",
                      groupSpeakerNamesInHistoryEnabled
                        ? "bg-[var(--primary)]/10 ring-1 ring-[var(--primary)]/30"
                        : "bg-[var(--secondary)] hover:bg-[var(--accent)]",
                    )}
                  >
                    <div className="min-w-0 flex-1">
                      <span className="text-[0.6875rem] font-medium">Name History Speakers</span>
                      <p className="mt-0.5 text-[0.625rem] leading-relaxed text-[var(--muted-foreground)]">
                        {groupSpeakerNamesInHistoryEnabled
                          ? "Past turns include character and persona names in the prompt history."
                          : "Past turns keep their stored text without extra speaker names."}
                      </p>
                    </div>
                    <div
                      className={cn(
                        "ml-3 h-5 w-9 shrink-0 rounded-full p-0.5 transition-colors",
                        groupSpeakerNamesInHistoryEnabled ? "bg-[var(--primary)]" : "bg-[var(--muted-foreground)]/50",
                      )}
                    >
                      <div
                        className={cn(
                          "h-4 w-4 rounded-full bg-white shadow-sm transition-transform",
                          groupSpeakerNamesInHistoryEnabled && "translate-x-3.5",
                        )}
                      />
                    </div>
                  </button>
                  <button
                    onClick={() =>
                      updateMeta.mutate({
                        id: chat.id,
                        groupTurnPromptEnabled: metadata.groupTurnPromptEnabled === false,
                      })
                    }
                    className={cn(
                      "flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left transition-all",
                      metadata.groupTurnPromptEnabled !== false
                        ? "bg-[var(--primary)]/10 ring-1 ring-[var(--primary)]/30"
                        : "bg-[var(--secondary)] hover:bg-[var(--accent)]",
                    )}
                  >
                    <div className="min-w-0 flex-1">
                      <span className="text-[0.6875rem] font-medium">Add Turn To Prompt</span>
                      <p className="mt-0.5 text-[0.625rem] leading-relaxed text-[var(--muted-foreground)]">
                        {metadata.groupTurnPromptEnabled !== false
                          ? "Each individual turn includes a short responding-character instruction."
                          : "Individual turns rely on context without adding a turn instruction."}
                      </p>
                    </div>
                    <div
                      className={cn(
                        "ml-3 h-5 w-9 shrink-0 rounded-full p-0.5 transition-colors",
                        metadata.groupTurnPromptEnabled !== false
                          ? "bg-[var(--primary)]"
                          : "bg-[var(--muted-foreground)]/50",
                      )}
                    >
                      <div
                        className={cn(
                          "h-4 w-4 rounded-full bg-white shadow-sm transition-transform",
                          metadata.groupTurnPromptEnabled !== false && "translate-x-3.5",
                        )}
                      />
                    </div>
                  </button>
                </div>
              )}

              {/* Scenario Override */}
              {!isConversation && (
                <div className="mt-2 space-y-1.5">
                  <label className="text-[0.6875rem] font-medium text-[var(--muted-foreground)]">
                    Scenario Override
                  </label>
                  <div className="relative">
                    <textarea
                      value={groupScenarioDraft}
                      onChange={(e) => setGroupScenarioDraft(e.target.value)}
                      onBlur={() => {
                        if (groupScenarioDraft !== groupScenarioText) {
                          updateMeta.mutate({ id: chat.id, groupScenarioText: groupScenarioDraft });
                        }
                      }}
                      placeholder="Replace individual character scenarios with a shared scenario for this group chat or leave empty to keep them…"
                      rows={4}
                      className="w-full resize-y rounded-lg bg-[var(--secondary)] px-3 py-2 pr-8 text-xs leading-relaxed outline-none ring-1 ring-transparent transition-shadow focus:ring-[var(--primary)]/40"
                    />
                    <button
                      onClick={() => setGroupScenarioExpanded(true)}
                      className="absolute right-1.5 top-1.5 rounded p-1 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)] hover:text-[var(--foreground)]"
                      title="Expand editor"
                    >
                      <Maximize2 size="0.75rem" />
                    </button>
                  </div>
                  <ExpandedTextarea
                    open={groupScenarioExpanded}
                    onClose={() => {
                      setGroupScenarioExpanded(false);
                      if (groupScenarioDraft !== groupScenarioText) {
                        updateMeta.mutate({ id: chat.id, groupScenarioText: groupScenarioDraft });
                      }
                    }}
                    title="Group Scenario Override"
                    value={groupScenarioDraft}
                    onChange={setGroupScenarioDraft}
                    placeholder="Replace individual character scenarios with a shared scenario for this group chat or leave empty to keep them…"
                  />
                </div>
              )}
            </Section>
          )}

          {/* Autonomous Messaging — conversation mode only */}
          {isConversation && (
            <Section
              label="Autonomous Messaging"
              icon={<Bot size="0.875rem" />}
              help="Characters can message you unprompted based on their personality and schedule. Chatty characters will reach out sooner when you're inactive."
            >
              <div className="space-y-2">
                {/* Enable autonomous messages toggle */}
                <button
                  onClick={() => {
                    updateMeta.mutate({ id: chat.id, autonomousMessages: !autonomousMessagesEnabled });
                  }}
                  className={cn(
                    "flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left transition-all",
                    autonomousMessagesEnabled
                      ? "bg-[var(--primary)]/10 ring-1 ring-[var(--primary)]/30"
                      : "bg-[var(--secondary)] hover:bg-[var(--accent)]",
                  )}
                >
                  <div className="flex-1 min-w-0">
                    <span className="text-xs font-medium">Autonomous Messages</span>
                    <p className="text-[0.625rem] text-[var(--muted-foreground)]">
                      Characters message you when you&apos;re inactive
                    </p>
                  </div>
                  <div
                    className={cn(
                      "h-5 w-9 shrink-0 rounded-full p-0.5 transition-colors",
                      autonomousMessagesEnabled ? "bg-[var(--primary)]" : "bg-[var(--muted-foreground)]/50",
                    )}
                  >
                    <div
                      className={cn(
                        "h-4 w-4 rounded-full bg-white shadow-sm transition-transform",
                        autonomousMessagesEnabled && "translate-x-3.5",
                      )}
                    />
                  </div>
                </button>

                {/* Character exchanges toggle (group chats only) */}
                {chatCharIds.length > 1 && (
                  <button
                    onClick={() => {
                      updateMeta.mutate({ id: chat.id, characterExchanges: !characterExchangesEnabled });
                    }}
                    className={cn(
                      "flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left transition-all",
                      characterExchangesEnabled
                        ? "bg-[var(--primary)]/10 ring-1 ring-[var(--primary)]/30"
                        : "bg-[var(--secondary)] hover:bg-[var(--accent)]",
                    )}
                  >
                    <div className="flex-1 min-w-0">
                      <span className="text-xs font-medium">Character Exchanges</span>
                      <p className="text-[0.625rem] text-[var(--muted-foreground)]">
                        Characters chat with each other in group chats
                      </p>
                    </div>
                    <div
                      className={cn(
                        "h-5 w-9 shrink-0 rounded-full p-0.5 transition-colors",
                        characterExchangesEnabled ? "bg-[var(--primary)]" : "bg-[var(--muted-foreground)]/50",
                      )}
                    >
                      <div
                        className={cn(
                          "h-4 w-4 rounded-full bg-white shadow-sm transition-transform",
                          characterExchangesEnabled && "translate-x-3.5",
                        )}
                      />
                    </div>
                  </button>
                )}

                {/* Conversation availability toggle */}
                <button
                  onClick={() => {
                    const nextEnabled = !conversationSchedulesEnabled;
                    updateMeta.mutate({ id: chat.id, conversationSchedulesEnabled: nextEnabled });
                    if (nextEnabled && !hasGeneratedConversationAvailability) {
                      void generateConversationSchedules(false);
                    }
                  }}
                  className={cn(
                    "flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left transition-all",
                    conversationSchedulesEnabled
                      ? "bg-[var(--primary)]/10 ring-1 ring-[var(--primary)]/30"
                      : "bg-[var(--secondary)] hover:bg-[var(--accent)]",
                  )}
                >
                  <div className="flex-1 min-w-0">
                    <span className="text-xs font-medium">Availability</span>
                    <p className="text-[0.625rem] text-[var(--muted-foreground)]">
                      Fuzzy character routines and response timing
                    </p>
                  </div>
                  <div
                    className={cn(
                      "h-5 w-9 shrink-0 rounded-full p-0.5 transition-colors",
                      conversationSchedulesEnabled ? "bg-[var(--primary)]" : "bg-[var(--muted-foreground)]/50",
                    )}
                  >
                    <div
                      className={cn(
                        "h-4 w-4 rounded-full bg-white shadow-sm transition-transform",
                        conversationSchedulesEnabled && "translate-x-3.5",
                      )}
                    />
                  </div>
                </button>

                <button
                  onClick={handleToggleConversationStatusMessagesDefault}
                  className={cn(
                    "flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left transition-all",
                    conversationStatusMessagesDefaultEnabled
                      ? "bg-[var(--primary)]/10 ring-1 ring-[var(--primary)]/30"
                      : "bg-[var(--secondary)] hover:bg-[var(--accent)]",
                  )}
                >
                  <div className="flex-1 min-w-0">
                    <span className="text-xs font-medium">Auto-enable Status Blurbs</span>
                    <p className="text-[0.625rem] text-[var(--muted-foreground)]">Default for conversation chats</p>
                  </div>
                  <div
                    className={cn(
                      "h-5 w-9 shrink-0 rounded-full p-0.5 transition-colors",
                      conversationStatusMessagesDefaultEnabled
                        ? "bg-[var(--primary)]"
                        : "bg-[var(--muted-foreground)]/50",
                    )}
                  >
                    <div
                      className={cn(
                        "h-4 w-4 rounded-full bg-white shadow-sm transition-transform",
                        conversationStatusMessagesDefaultEnabled && "translate-x-3.5",
                      )}
                    />
                  </div>
                </button>
                <button
                  onClick={handleToggleConversationStatusMessages}
                  className={cn(
                    "flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left transition-all",
                    conversationStatusMessagesEnabled
                      ? "bg-[var(--primary)]/10 ring-1 ring-[var(--primary)]/30"
                      : "bg-[var(--secondary)] hover:bg-[var(--accent)]",
                  )}
                >
                  <div className="flex-1 min-w-0">
                    <span className="text-xs font-medium">This Chat</span>
                    <p className="text-[0.625rem] text-[var(--muted-foreground)]">
                      {conversationStatusMessagesOverride === null
                        ? `Using global default (${conversationStatusMessagesDefaultEnabled ? "on" : "off"})`
                        : conversationStatusMessagesEnabled
                          ? "Explicitly on for this chat"
                          : "Explicitly off for this chat"}
                    </p>
                  </div>
                  <div
                    className={cn(
                      "h-5 w-9 shrink-0 rounded-full p-0.5 transition-colors",
                      conversationStatusMessagesEnabled ? "bg-[var(--primary)]" : "bg-[var(--muted-foreground)]/50",
                    )}
                  >
                    <div
                      className={cn(
                        "h-4 w-4 rounded-full bg-white shadow-sm transition-transform",
                        conversationStatusMessagesEnabled && "translate-x-3.5",
                      )}
                    />
                  </div>
                </button>

                {/* Availability status */}
                <div className="flex items-center gap-2 rounded-lg bg-[var(--secondary)] px-3 py-2.5">
                  <CalendarClock size="0.875rem" className="text-[var(--muted-foreground)]" />
                  <div className="flex-1 min-w-0">
                    <span className="text-[0.6875rem] leading-snug text-[var(--muted-foreground)]">
                      {!conversationSchedulesEnabled
                        ? "Availability is off - autonomous messages will not use routines."
                        : hasGeneratedConversationRoutines
                          ? "Routines generated - status uses character habits."
                          : hasGeneratedConversationSchedules
                            ? "Legacy schedules found - regenerate to replace them with routines."
                            : "Availability enabled - generate routines when you're ready."}
                    </span>
                    <p className="text-[0.59375rem] text-[var(--muted-foreground)]/60 mt-0.5">
                      {conversationSchedulesEnabled
                        ? "Routines refresh only after you enable or regenerate them."
                        : "Turn availability on if you want character timing to matter."}
                    </p>
                  </div>
                  <button
                    onClick={async () => {
                      if (!conversationSchedulesEnabled) {
                        updateMeta.mutate({ id: chat.id, conversationSchedulesEnabled: true });
                      }
                      await generateConversationSchedules(true);
                    }}
                    disabled={isRegeneratingSchedules || chatCharIds.length === 0}
                    className={cn(
                      "flex items-center gap-1 rounded-md px-2 py-1 text-[0.625rem] font-medium transition-colors",
                      isRegeneratingSchedules || chatCharIds.length === 0
                        ? "cursor-not-allowed text-[var(--muted-foreground)]/60"
                        : "text-[var(--muted-foreground)] hover:bg-[var(--accent)] hover:text-[var(--foreground)]",
                    )}
                    title={isRegeneratingSchedules ? "Regenerating availability..." : "Generate character routines"}
                  >
                    <RefreshCw size="0.6875rem" className={cn(isRegeneratingSchedules && "animate-spin")} />
                    {isRegeneratingSchedules
                      ? "Regenerating..."
                      : hasGeneratedConversationAvailability
                        ? "Regenerate"
                        : "Generate"}
                  </button>
                </div>

                {/* Availability editor per character */}
                {conversationSchedulesEnabled && hasGeneratedConversationAvailability && (
                  <ScheduleEditor
                    characterRoutines={characterRoutines}
                    characterSchedules={characterSchedules}
                    chatCharIds={chatCharIds}
                    charNameMap={charNameMap}
                    onSave={(updated) => {
                      updateMeta.mutate({ id: chat.id, characterSchedules: updated });
                    }}
                  />
                )}
              </div>
            </Section>
          )}

          {/* Commands — conversation mode only */}
          {isConversation && (
            <Section
              label="Commands"
              icon={<Sparkles size="0.875rem" />}
              help="Allow characters to use hidden command tags for actions that happen outside the visible message."
            >
              <div className="space-y-3">
                <button
                  onClick={() => {
                    updateMeta.mutate({ id: chat.id, characterCommands: !conversationCommandsEnabled });
                  }}
                  className={cn(
                    "flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left transition-all",
                    conversationCommandsEnabled
                      ? "bg-[var(--primary)]/10 ring-1 ring-[var(--primary)]/30"
                      : "bg-[var(--secondary)] hover:bg-[var(--accent)]",
                  )}
                >
                  <div className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5 text-xs font-medium">
                      <Sparkles size="0.75rem" className="text-[var(--primary)]" />
                      Commands
                    </span>
                    <p className="text-[0.625rem] text-[var(--muted-foreground)]">
                      Allow models to interact with you via commands. This way, they can send you selfies, play songs
                      for you, change their schedules, start scenes, and do much more!
                    </p>
                  </div>
                  <div
                    className={cn(
                      "h-5 w-9 shrink-0 rounded-full p-0.5 transition-colors",
                      conversationCommandsEnabled ? "bg-[var(--primary)]" : "bg-[var(--muted-foreground)]/50",
                    )}
                  >
                    <div
                      className={cn(
                        "h-4 w-4 rounded-full bg-white shadow-sm transition-transform",
                        conversationCommandsEnabled && "translate-x-3.5",
                      )}
                    />
                  </div>
                </button>

                {/* Selfie Connection — connection picker for character selfies */}
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2">
                    <Image size="0.75rem" className="text-[var(--primary)]" />
                    <span className="text-xs font-medium">Selfie Connection</span>
                  </div>
                  <select
                    value={(metadata.imageGenConnectionId as string) ?? ""}
                    onChange={(e) => updateMeta.mutate({ id: chat.id, imageGenConnectionId: e.target.value || null })}
                    className="w-full rounded-lg bg-[var(--secondary)] px-3 py-2 text-xs outline-none ring-1 ring-transparent transition-shadow focus:ring-[var(--primary)]/40"
                  >
                    <option value="">None (selfies disabled)</option>
                    {imageConnectionsList.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} ({c.provider})
                      </option>
                    ))}
                  </select>
                  <p className="text-[0.55rem] text-[var(--muted-foreground)]">
                    Used for character selfies when Commands are enabled. The Illustrator agent uses its own connection
                    from the Agents tab.
                  </p>

                  {/* Selfie resolution picker */}
                  {(metadata.imageGenConnectionId as string) && (
                    <div className="mt-2 space-y-1">
                      <span className="text-[0.6875rem] font-medium text-[var(--muted-foreground)]">Resolution</span>
                      <div className="flex flex-wrap gap-1.5">
                        {[
                          { label: "512x512", w: 512, h: 512 },
                          { label: "512x768", w: 512, h: 768 },
                          { label: "768x768", w: 768, h: 768 },
                          { label: "768x1024", w: 768, h: 1024 },
                          { label: "1024x1024", w: 1024, h: 1024 },
                        ].map((opt) => {
                          const current = (metadata.selfieResolution as string) ?? "512x768";
                          const val = `${opt.w}x${opt.h}`;
                          const active = current === val;
                          return (
                            <button
                              key={val}
                              type="button"
                              onClick={() => updateMeta.mutate({ id: chat.id, selfieResolution: val })}
                              className={`rounded-md px-2 py-1 text-[0.625rem] font-medium transition-colors ${
                                active
                                  ? "bg-[var(--primary)] text-[var(--primary-foreground)]"
                                  : "bg-[var(--secondary)] text-[var(--muted-foreground)] hover:bg-[var(--accent)]"
                              }`}
                            >
                              {opt.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Selfie prompt controls */}
                  {(metadata.imageGenConnectionId as string) && (
                    <SelfiePromptControls
                      promptTemplate={metadata.selfiePrompt as string | null | undefined}
                      positivePrompt={metadata.selfiePositivePrompt as string | undefined}
                      negativePrompt={(metadata.selfieNegativePrompt as string) ?? ""}
                      onCommitPromptTemplate={(selfiePrompt) => updateMeta.mutate({ id: chat.id, selfiePrompt })}
                      onCommitPositivePrompt={(selfiePositivePrompt) =>
                        updateMeta.mutate({ id: chat.id, selfiePositivePrompt })
                      }
                      onCommitNegativePrompt={(selfieNegativePrompt) =>
                        updateMeta.mutate({ id: chat.id, selfieNegativePrompt })
                      }
                    />
                  )}
                </div>

                {/* Schedule generation preferences — free-form authorial guidance */}
                <label className="flex flex-col gap-1.5">
                  <span className="inline-flex items-center gap-1.5 text-xs font-medium">
                    <Sparkles size="0.75rem" className="text-[var(--primary)]" />
                    Schedule generation preferences
                    <HelpTooltip text="Free-form guidance that steers how character schedules are generated. Both directives ('no characters past midnight') and factual constraints ('I work 9-5') work. This setting is global, it applies to every conversation chat." />
                  </span>
                  <textarea
                    value={scheduleGenerationPreferences}
                    onChange={(e) => setScheduleGenerationPreferences(e.target.value)}
                    placeholder="e.g. Make everyone go to sleep before midnight. Give characters free time 10am-noon. I work 9-5 on weekdays."
                    className="min-h-[5rem] resize-y rounded-lg border border-[var(--border)] bg-[var(--secondary)] p-2.5 text-[0.6875rem] text-[var(--foreground)] outline-none transition-colors focus:border-[var(--primary)]/50 placeholder:text-[var(--muted-foreground)]/40"
                  />
                  <p className="text-[0.59375rem] text-[var(--muted-foreground)]/70">
                    Global setting. Applies to every conversation chat&apos;s next schedule regeneration, manual or
                    weekly auto.
                  </p>
                </label>

                {/* Active schedule-generation preference indicator */}
                {scheduleGenerationPreferences.trim() && (
                  <div
                    className="flex items-start gap-2 rounded-lg border border-[var(--primary)]/30 bg-[var(--primary)]/10 px-3 py-2.5"
                    title={scheduleGenerationPreferences.trim()}
                  >
                    <Sparkles size="0.875rem" className="mt-0.5 shrink-0 text-[var(--primary)]" />
                    <div className="min-w-0 flex-1">
                      <span className="block text-[0.6875rem] font-medium leading-snug text-[var(--foreground)]">
                        Schedule generation preference active
                      </span>
                      <p className="mt-0.5 truncate text-[0.625rem] italic text-[var(--muted-foreground)]">
                        "{scheduleGenerationPreferences.trim()}"
                      </p>
                      <p className="mt-1 text-[0.59375rem] text-[var(--muted-foreground)]/70">
                        Will be applied the next time schedules are regenerated.
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </Section>
          )}

          {/* Cross-Chat Awareness — conversation mode only */}
          {isConversation && (
            <Section
              label="Cross-Chat Awareness"
              icon={<Link size="0.875rem" />}
              help="Characters remember and reference conversations from other chats they're in. Pulls recent messages from sibling chats and injects them as context."
            >
              <button
                onClick={() => {
                  updateMeta.mutate({
                    id: chat.id,
                    crossChatAwareness: metadata.crossChatAwareness === false ? true : false,
                  });
                }}
                className={cn(
                  "flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left transition-all",
                  metadata.crossChatAwareness !== false
                    ? "bg-[var(--primary)]/10 ring-1 ring-[var(--primary)]/30"
                    : "bg-[var(--secondary)] hover:bg-[var(--accent)]",
                )}
              >
                <div className="flex-1 min-w-0">
                  <span className="text-xs font-medium">Cross-Chat Awareness</span>
                  <p className="text-[0.625rem] text-[var(--muted-foreground)]">
                    Characters know what happens in their other chats
                  </p>
                </div>
                <div
                  className={cn(
                    "h-5 w-9 shrink-0 rounded-full p-0.5 transition-colors",
                    metadata.crossChatAwareness !== false ? "bg-[var(--primary)]" : "bg-[var(--muted-foreground)]/50",
                  )}
                >
                  <div
                    className={cn(
                      "h-4 w-4 rounded-full bg-white shadow-sm transition-transform",
                      metadata.crossChatAwareness !== false && "translate-x-3.5",
                    )}
                  />
                </div>
              </button>
            </Section>
          )}

          {/* Connected Chat — conversation mode: link to a roleplay or game chat */}
          {isConversation && (
            <Section
              label="Connected Chat"
              icon={<ArrowRightLeft size="0.875rem" />}
              help="Link this conversation to a roleplay or game. Recent messages from the linked chat are pulled into context here automatically. To send something the other direction, the character uses `<influence>` (steers the next linked turn, one-shot) or `<note>` (persists on every future linked turn until cleared)."
            >
              {chat.connectedChatId ? (
                (() => {
                  const linked = (allChats ?? []).find((c) => c.id === chat.connectedChatId);
                  return (
                    <div className="flex items-center gap-2.5 rounded-lg bg-[var(--primary)]/10 px-3 py-2 ring-1 ring-[var(--primary)]/30">
                      <ArrowRightLeft size="0.875rem" className="text-[var(--primary)]" />
                      <div className="flex-1 min-w-0">
                        <span className="truncate text-xs font-medium">
                          {linked ? getConnectedChatDisplayName(linked) : "Unknown chat"}
                        </span>
                        <p className="text-[0.625rem] text-[var(--muted-foreground)]">
                          {linked ? (linked.mode === "roleplay" ? "Roleplay" : linked.mode) : "Deleted"}
                        </p>
                      </div>
                      <button
                        onClick={() => disconnectChat.mutate(chat.id)}
                        className="flex h-5 w-5 items-center justify-center rounded-md text-[var(--muted-foreground)] transition-colors hover:bg-[var(--destructive)]/15 hover:text-[var(--destructive)]"
                        title="Disconnect"
                      >
                        <Unlink size="0.6875rem" />
                      </button>
                    </div>
                  );
                })()
              ) : !showConnectionPicker ? (
                <button
                  onClick={() => {
                    setShowConnectionPicker(true);
                    setConnectionSearch("");
                  }}
                  className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-[var(--border)] px-3 py-2 text-xs text-[var(--muted-foreground)] transition-colors hover:border-[var(--primary)]/40 hover:text-[var(--primary)]"
                >
                  <Plus size="0.75rem" /> Link to Roleplay or Game
                </button>
              ) : (
                <PickerDropdown
                  search={connectionSearch}
                  onSearchChange={setConnectionSearch}
                  onClose={() => setShowConnectionPicker(false)}
                  placeholder="Search roleplay or game chats…"
                >
                  {(allChats ?? [])
                    .filter(
                      (c) =>
                        c.id !== chat.id &&
                        (c.mode === "roleplay" || c.mode === "game") &&
                        !c.connectedChatId &&
                        getConnectedChatDisplayName(c).toLowerCase().includes(connectionSearch.toLowerCase()),
                    )
                    .map((c) => (
                      <button
                        key={c.id}
                        onClick={() => {
                          connectChat.mutate({ chatId: chat.id, targetChatId: c.id });
                          setShowConnectionPicker(false);
                        }}
                        className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-xs transition-colors hover:bg-[var(--accent)]"
                      >
                        <MessageSquare size="0.75rem" className="shrink-0 text-[var(--muted-foreground)]" />
                        <span className="truncate">{getConnectedChatDisplayName(c)}</span>
                      </button>
                    ))}
                </PickerDropdown>
              )}
            </Section>
          )}

          {/* Connected Conversation — roleplay mode: linked OOC chat + optional in-world DM command */}
          {isRoleplayMode && (
            <Section
              label="Connected Conversation"
              icon={<ArrowRightLeft size="0.875rem" />}
              help={
                'Link to an OOC conversation, and optionally let roleplay characters open direct-message conversations with `[dm: character="Name" message="text"]` when it naturally fits the scene.'
              }
            >
              <div className="space-y-2">
                {chat.connectedChatId ? (
                  (() => {
                    const linked = (allChats ?? []).find((c) => c.id === chat.connectedChatId);
                    return (
                      <div className="flex items-center gap-2.5 rounded-lg bg-[var(--primary)]/10 px-3 py-2 ring-1 ring-[var(--primary)]/30">
                        <MessageCircle size="0.875rem" className="text-[var(--primary)]" />
                        <div className="flex-1 min-w-0">
                          <span className="truncate text-xs font-medium">
                            {linked ? getConnectedChatDisplayName(linked) : "Unknown chat"}
                          </span>
                          <p className="text-[0.625rem] text-[var(--muted-foreground)]">Conversation</p>
                        </div>
                        <button
                          onClick={() => disconnectChat.mutate(chat.id)}
                          className="flex h-5 w-5 items-center justify-center rounded-md text-[var(--muted-foreground)] transition-colors hover:bg-[var(--destructive)]/15 hover:text-[var(--destructive)]"
                          title="Disconnect"
                        >
                          <Unlink size="0.6875rem" />
                        </button>
                      </div>
                    );
                  })()
                ) : (
                  <p className="rounded-lg bg-[var(--secondary)]/50 px-3 py-2 text-[0.625rem] leading-relaxed text-[var(--muted-foreground)]">
                    No OOC conversation is linked. Direct-message commands can still create new Conversation DMs.
                  </p>
                )}

                <button
                  type="button"
                  onClick={() =>
                    updateMeta.mutate({
                      id: chat.id,
                      roleplayDmCommandsEnabled: metadata.roleplayDmCommandsEnabled !== true,
                    })
                  }
                  className={cn(
                    "flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-left transition-all",
                    metadata.roleplayDmCommandsEnabled === true
                      ? "bg-[var(--primary)]/10 ring-1 ring-[var(--primary)]/30"
                      : "bg-[var(--secondary)] hover:bg-[var(--accent)]",
                  )}
                >
                  <div className="flex-1 min-w-0">
                    <span className="text-[0.6875rem] font-medium">Allow character DMs</span>
                    <p className="text-[0.625rem] leading-relaxed text-[var(--muted-foreground)]">
                      Adds a short hidden command reminder so characters can open a new DM conversation when they text
                      the user in-world.
                    </p>
                  </div>
                  <div
                    className={cn(
                      "h-5 w-9 shrink-0 rounded-full p-0.5 transition-colors",
                      metadata.roleplayDmCommandsEnabled === true
                        ? "bg-[var(--primary)]"
                        : "bg-[var(--muted-foreground)]/50",
                    )}
                  >
                    <div
                      className={cn(
                        "h-4 w-4 rounded-full bg-white shadow-sm transition-transform",
                        metadata.roleplayDmCommandsEnabled === true && "translate-x-3.5",
                      )}
                    />
                  </div>
                </button>
              </div>
            </Section>
          )}

          {/* Connected Conversation — game mode: show linked OOC chat */}
          {isGame && chat.connectedChatId && (
            <Section
              label="Connected Conversation"
              icon={<ArrowRightLeft size="0.875rem" />}
              help="Linked to a conversation. `<influence>` tags from the conversation steer the next turn here (one-shot, then consumed). `<note>` tags persist on every turn until cleared. Raw conversation messages are not injected — use `<note>` for facts this chat should keep remembering."
            >
              {(() => {
                const linked = (allChats ?? []).find((c) => c.id === chat.connectedChatId);
                return (
                  <div className="flex items-center gap-2.5 rounded-lg bg-[var(--primary)]/10 px-3 py-2 ring-1 ring-[var(--primary)]/30">
                    <MessageCircle size="0.875rem" className="text-[var(--primary)]" />
                    <div className="flex-1 min-w-0">
                      <span className="truncate text-xs font-medium">
                        {linked ? getConnectedChatDisplayName(linked) : "Unknown chat"}
                      </span>
                      <p className="text-[0.625rem] text-[var(--muted-foreground)]">Conversation</p>
                    </div>
                    <button
                      onClick={() => disconnectChat.mutate(chat.id)}
                      className="flex h-5 w-5 items-center justify-center rounded-md text-[var(--muted-foreground)] transition-colors hover:bg-[var(--destructive)]/15 hover:text-[var(--destructive)]"
                      title="Disconnect"
                    >
                      <Unlink size="0.6875rem" />
                    </button>
                  </div>
                );
              })()}
            </Section>
          )}

          {/* Notes from Conversation — durable notes saved by the connected conversation's character */}
          {!isConversation && chat.connectedChatId && <ConversationNotesSection chatId={chat.id} />}

          {/* Connect to Conversation — game mode without existing link */}
          {chatMode === "game" && !chat.connectedChatId && (
            <Section
              label="Connected Conversation"
              icon={<ArrowRightLeft size="0.875rem" />}
              help="Link this game to an OOC conversation. The conversation character uses `<influence>` (one-shot) or `<note>` (durable) to bridge content into the game; raw conversation messages are not injected. Game events and roleplay moments flow back into the conversation automatically."
            >
              {!showConnectionPicker ? (
                <button
                  onClick={() => {
                    setShowConnectionPicker(true);
                    setConnectionSearch("");
                  }}
                  className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-[var(--border)] px-3 py-2 text-xs text-[var(--muted-foreground)] transition-colors hover:border-[var(--primary)]/40 hover:text-[var(--primary)]"
                >
                  <Plus size="0.75rem" /> Link to Conversation
                </button>
              ) : (
                <PickerDropdown
                  search={connectionSearch}
                  onSearchChange={setConnectionSearch}
                  onClose={() => setShowConnectionPicker(false)}
                  placeholder="Search conversation chats…"
                >
                  {(allChats ?? [])
                    .filter(
                      (c) =>
                        c.id !== chat.id &&
                        c.mode === "conversation" &&
                        !c.connectedChatId &&
                        getConnectedChatDisplayName(c).toLowerCase().includes(connectionSearch.toLowerCase()),
                    )
                    .map((c) => (
                      <button
                        key={c.id}
                        onClick={() => {
                          connectChat.mutate({ chatId: chat.id, targetChatId: c.id });
                          setShowConnectionPicker(false);
                        }}
                        className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-xs transition-colors hover:bg-[var(--accent)]"
                      >
                        <MessageSquare size="0.75rem" className="shrink-0 text-[var(--muted-foreground)]" />
                        <span className="truncate">{getConnectedChatDisplayName(c)}</span>
                      </button>
                    ))}
                </PickerDropdown>
              )}
            </Section>
          )}

          {/* Lorebooks */}
          <Section
            id="chat-settings-lorebooks"
            label="Lorebooks"
            icon={<BookOpen size="0.875rem" />}
            count={activeLorebooks.length}
            help="Lorebooks contain world info, character backstories, and lore that gets injected into the AI's context when relevant keywords appear."
          >
            <div className="mb-2 rounded-lg bg-[var(--secondary)]/70 p-3 ring-1 ring-[var(--border)]">
              <label className="mb-1.5 flex items-center gap-1 text-xs font-medium">
                Lorebook Token Budget{" "}
                <HelpTooltip
                  text={`Context cap for activated lorebook retrievals in this chat. Default: ${LIMITS.DEFAULT_LOREBOOK_TOKEN_BUDGET}. Set to 0 for unlimited.`}
                />
              </label>
              <input
                type="number"
                min={0}
                value={lorebookTokenBudget}
                onChange={(event) => {
                  const next = Math.max(0, Math.floor(Number(event.target.value) || 0));
                  updateMeta.mutate({ id: chat.id, lorebookTokenBudget: next });
                }}
                className="w-full rounded-lg bg-[var(--background)] px-3 py-2 text-xs ring-1 ring-[var(--border)] focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
              />
            </div>

            {/* Active lorebooks */}
            {activeLorebooks.length === 0 ? (
              <p className="text-[0.6875rem] text-[var(--muted-foreground)]">No lorebooks active in this chat.</p>
            ) : (
              <div className="flex flex-col gap-1">
                {activeLorebooks.map((lb) => {
                  return (
                    <div
                      key={lb.id}
                      className="flex items-center gap-2.5 rounded-lg bg-[var(--primary)]/10 px-3 py-2 ring-1 ring-[var(--primary)]/30"
                    >
                      <BookOpen size="0.875rem" className="text-[var(--primary)]" />
                      <div className="min-w-0 flex-1">
                        <span className="block truncate text-xs">{lb.name}</span>
                        <div className="mt-1 flex flex-wrap gap-1">
                          {lb.activeReasons.map((reason) => (
                            <span
                              key={reason}
                              className="rounded-full bg-[var(--background)]/70 px-1.5 py-0.5 text-[0.5625rem] font-medium text-[var(--muted-foreground)] ring-1 ring-[var(--border)]"
                            >
                              {reason}
                            </span>
                          ))}
                        </div>
                      </div>
                      {lb.isPinned ? (
                        <button
                          onClick={() => toggleLorebook(lb.id)}
                          className="flex h-5 w-5 items-center justify-center rounded-md text-[var(--muted-foreground)] transition-colors hover:bg-[var(--destructive)]/15 hover:text-[var(--destructive)]"
                          title="Remove from chat"
                        >
                          <Trash2 size="0.6875rem" />
                        </button>
                      ) : (
                        <button
                          onClick={() => pinLorebookToChat(lb.id)}
                          className="flex h-5 w-5 items-center justify-center rounded-md text-[var(--muted-foreground)] transition-colors hover:bg-[var(--primary)]/15 hover:text-[var(--primary)]"
                          title="Add to chat"
                        >
                          <Plus size="0.6875rem" />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Add lorebook picker */}
            {!showLbPicker ? (
              <button
                onClick={() => {
                  setShowLbPicker(true);
                  setLbSearch("");
                }}
                className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-[var(--border)] px-3 py-2 text-xs text-[var(--muted-foreground)] transition-colors hover:border-[var(--primary)]/40 hover:text-[var(--primary)]"
              >
                <Plus size="0.75rem" /> Add Lorebook
              </button>
            ) : (
              <PickerDropdown
                search={lbSearch}
                onSearchChange={setLbSearch}
                onClose={() => setShowLbPicker(false)}
                placeholder="Search lorebooks…"
              >
                {selectableLorebooks
                  .filter((lb) => !activeLorebookIdSet.has(lb.id))
                  .filter((lb) => lb.name.toLowerCase().includes(lbSearch.toLowerCase()))
                  .map((lb) => (
                    <button
                      key={lb.id}
                      onClick={() => {
                        toggleLorebook(lb.id);
                        setShowLbPicker(false);
                      }}
                      className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-left transition-all hover:bg-[var(--accent)]"
                    >
                      <BookOpen size="0.875rem" className="text-[var(--muted-foreground)]" />
                      <span className="flex-1 truncate text-xs">{lb.name}</span>
                      <Plus size="0.75rem" className="text-[var(--muted-foreground)]" />
                    </button>
                  ))}
                {selectableLorebooks
                  .filter((lb) => !activeLorebookIdSet.has(lb.id))
                  .filter((lb) => lb.name.toLowerCase().includes(lbSearch.toLowerCase())).length === 0 && (
                  <p className="px-3 py-2 text-[0.6875rem] text-[var(--muted-foreground)]">
                    {selectableLorebooks.filter((lb) => !activeLorebookIdSet.has(lb.id)).length === 0
                      ? "All available lorebooks are already active here."
                      : "No matches."}
                  </p>
                )}
              </PickerDropdown>
            )}
          </Section>

          {/* Scoped Regex Scripts */}
          <Section
            label="Scoped Regex Scripts"
            icon={<Code2 size="0.875rem" />}
            count={scopedRegexCount}
            help="Character-scoped regex scripts imported from ST cards. Control how they interact with global regex scripts."
          >
            <ScopedRegexModeSelector
              mode={metadataScopedRegexMode(metadata.scopedRegexMode)}
              onChange={(mode) => updateMeta.mutate({ id: chat.id, scopedRegexMode: mode })}
            />
            <ScopedRegexCharacterGroups
              scripts={scopedRegexScripts}
              charInfoMap={charInfoMap}
              onToggle={(id, enabled) => updateRegexScript.mutate({ id, enabled })}
            />
          </Section>

          {/* Card Theming — creator-notes CSS mode selector */}
          {cardCssCharacters.length > 0 && (
            <Section
              label="Card Theming"
              icon={<Paintbrush size="0.875rem" />}
              count={cardCssMode !== "disabled" ? cardCssCharacters.length : 0}
              help="Characters can embed custom CSS in their creator notes to theme the chat. Choose how broadly their styles are applied."
            >
              <div className="space-y-1.5">
                <CardCssModeSelector
                  mode={cardCssMode}
                  onChange={(mode) => updateMeta.mutate({ id: chat.id, cardCssMode: mode })}
                />
                <p className="px-1 text-[0.625rem] text-[var(--muted-foreground)]">
                  {cardCssMode === "disabled"
                    ? "Card CSS is disabled — no character styling is applied."
                    : cardCssMode === "exclusive"
                      ? "Each character's CSS only affects their own messages."
                      : "All card CSS affects the entire chat area, including UI elements."}
                </p>
                {cardCssMode !== "disabled" && (
                  <div className="space-y-1">
                    <span className="block px-1 text-[0.625rem] font-medium text-[var(--muted-foreground)]">
                      Characters with CSS:
                    </span>
                    {cardCssCharacters.map((char) => (
                      <div
                        key={char.id}
                        className="flex items-center gap-2 rounded-lg px-3 py-1.5 ring-1 ring-[var(--border)] bg-[var(--card)]"
                      >
                        <span className="flex-1 text-[0.6875rem] font-medium text-[var(--foreground)] truncate">
                          {char.name}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </Section>
          )}

          {/* Agents — hidden for conversation mode */}
          {!isConversation && (
            <Section
              label="Agents"
              icon={<Sparkles size="0.875rem" />}
              count={isGame ? gameAgentFeatureCount : activeAgentIds.length}
              help="Agents added to this chat run automatically during generation to enrich the chat with world state tracking, expression detection, and more."
            >
              <div className="space-y-2">
                <p className="rounded-lg bg-[var(--secondary)] px-3 py-2 text-[0.625rem] text-[var(--muted-foreground)]">
                  Agents run only when they are added to this chat. Add or remove individual agents below.
                </p>
                {isGame && agentsEnabled && (
                  <div className="mt-1.5 px-3">
                    <select
                      value={(metadata.gameSceneConnectionId as string) ?? ""}
                      onChange={(e) =>
                        updateMeta.mutate({ id: chat.id, gameSceneConnectionId: e.target.value || null })
                      }
                      className="w-full rounded-lg border border-[var(--border)] bg-[var(--secondary)] px-2.5 py-1.5 text-xs text-[var(--foreground)]"
                    >
                      <option value="">Chat/default connection</option>
                      {((connections ?? []) as Array<{ id: string; name: string; model?: string }>)
                        .filter((c) => (c as { provider?: string }).provider !== "image_generation")
                        .map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                            {c.model ? ` — ${c.model}` : ""}
                          </option>
                        ))}
                    </select>
                  </div>
                )}

                {isGame && (
                  <button
                    onClick={toggleGameLorebookKeeper}
                    className={cn(
                      "flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left transition-all",
                      gameLorebookKeeperEnabled
                        ? "bg-[var(--primary)]/10 ring-1 ring-[var(--primary)]/30"
                        : "bg-[var(--secondary)] hover:bg-[var(--accent)]",
                    )}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 text-xs font-medium">
                        <BookOpen size="0.75rem" className="text-[var(--primary)]" />
                        <span>Game Lorebook Keeper</span>
                      </div>
                      <p className="mt-0.5 text-[0.625rem] text-[var(--muted-foreground)]">
                        Updates a game-scoped lorebook after End Session finishes and attaches it only to this game.
                      </p>
                      {gameLorebookKeeperLorebook && (
                        <p className="mt-0.5 truncate text-[0.55rem] text-[var(--primary)]/70">
                          Target: {gameLorebookKeeperLorebook.name}
                        </p>
                      )}
                    </div>
                    <div
                      className={cn(
                        "h-5 w-9 shrink-0 rounded-full p-0.5 transition-colors",
                        gameLorebookKeeperEnabled ? "bg-[var(--primary)]" : "bg-[var(--muted-foreground)]/50",
                      )}
                    >
                      <div
                        className={cn(
                          "h-4 w-4 rounded-full bg-white shadow-sm transition-transform",
                          gameLorebookKeeperEnabled && "translate-x-3.5",
                        )}
                      />
                    </div>
                  </button>
                )}

                {isGame && (
                  <div className="space-y-2">
                    <button
                      type="button"
                      onClick={() => void toggleGameSpotifyMusic()}
                      className={cn(
                        "flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left transition-all",
                        gameUseSpotifyMusic
                          ? "bg-[var(--primary)]/10 ring-1 ring-[var(--primary)]/30"
                          : "bg-[var(--secondary)] hover:bg-[var(--accent)]",
                      )}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 text-xs font-medium">
                          <Music2 size="0.75rem" className="text-[var(--primary)]" />
                          <span>Spotify DJ Music</span>
                        </div>
                        <p className="mt-0.5 text-[0.625rem] text-[var(--muted-foreground)]">
                          Use Spotify instead of the built-in Game Mode music library.
                        </p>
                      </div>
                      <div
                        className={cn(
                          "h-5 w-9 shrink-0 rounded-full p-0.5 transition-colors",
                          gameUseSpotifyMusic ? "bg-[var(--primary)]" : "bg-[var(--muted-foreground)]/50",
                        )}
                      >
                        <div
                          className={cn(
                            "h-4 w-4 rounded-full bg-white shadow-sm transition-transform",
                            gameUseSpotifyMusic && "translate-x-3.5",
                          )}
                        />
                      </div>
                    </button>

                    {gameUseSpotifyMusic && (
                      <div className="space-y-2 rounded-lg bg-[var(--background)]/55 p-3 ring-1 ring-[var(--border)]">
                        <label className="flex flex-col gap-1">
                          <span className="text-[0.625rem] font-medium text-[var(--muted-foreground)]">
                            Music source
                          </span>
                          <select
                            value={gameSpotifySourceType}
                            onChange={(event) => {
                              const next = normalizeGameSpotifySourceType(event.target.value);
                              updateMeta.mutate({
                                id: chat.id,
                                gameSpotifySourceType: next,
                                gameSpotifyPlaylistId: next === "playlist" ? gameSpotifyPlaylistId || null : null,
                                gameSpotifyPlaylistName:
                                  next === "playlist" ? (metadata.gameSpotifyPlaylistName as string) || null : null,
                                gameSpotifyArtist: next === "artist" ? gameSpotifyArtistDraft.trim() || null : null,
                              });
                            }}
                            className="w-full rounded-lg border border-[var(--border)] bg-[var(--secondary)] px-2.5 py-1.5 text-xs text-[var(--foreground)]"
                          >
                            {GAME_SPOTIFY_SOURCE_OPTIONS.map((option) => (
                              <option key={option.id} value={option.id}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                          <span className="text-[0.5625rem] text-[var(--muted-foreground)]">
                            {GAME_SPOTIFY_SOURCE_OPTIONS.find((option) => option.id === gameSpotifySourceType)
                              ?.description ?? ""}
                          </span>
                        </label>

                        {gameSpotifySourceType === "playlist" && (
                          <label className="flex flex-col gap-1">
                            <span className="text-[0.625rem] font-medium text-[var(--muted-foreground)]">Playlist</span>
                            {spotifyPlaylistsQuery.data?.playlists.length ? (
                              <select
                                value={gameSpotifyPlaylistId}
                                onChange={(event) => {
                                  const playlist = spotifyPlaylistsQuery.data?.playlists.find(
                                    (entry) => entry.id === event.target.value,
                                  );
                                  updateMeta.mutate({
                                    id: chat.id,
                                    gameSpotifyPlaylistId: event.target.value || null,
                                    gameSpotifyPlaylistName: playlist?.name ?? null,
                                  });
                                }}
                                className="w-full rounded-lg border border-[var(--border)] bg-[var(--secondary)] px-2.5 py-1.5 text-xs text-[var(--foreground)]"
                              >
                                <option value="">Choose playlist...</option>
                                {spotifyPlaylistsQuery.data.playlists.map((playlist) => {
                                  const suffix =
                                    typeof playlist.trackCount === "number"
                                      ? ` (${playlist.trackCount})`
                                      : playlist.owned === false
                                        ? " (followed — unavailable)"
                                        : "";
                                  return (
                                    <option key={playlist.id} value={playlist.id}>
                                      {playlist.name}
                                      {suffix}
                                    </option>
                                  );
                                })}
                              </select>
                            ) : (
                              <input
                                key={`${chat.id}-${gameSpotifyPlaylistId}`}
                                defaultValue={gameSpotifyPlaylistId}
                                onBlur={(event) =>
                                  updateMeta.mutate({
                                    id: chat.id,
                                    gameSpotifyPlaylistId: event.target.value.trim() || null,
                                    gameSpotifyPlaylistName: null,
                                  })
                                }
                                placeholder={
                                  spotifyPlaylistsQuery.isFetching ? "Loading playlists..." : "Paste playlist ID"
                                }
                                className="w-full rounded-lg border border-[var(--border)] bg-[var(--secondary)] px-2.5 py-1.5 text-xs text-[var(--foreground)] placeholder:text-[var(--muted-foreground)]/50"
                              />
                            )}
                            {spotifyPlaylistsQuery.isError && (
                              <span className="text-[0.5625rem] text-amber-400/90">
                                Connect Spotify in the Spotify DJ agent to load playlist names.
                              </span>
                            )}
                          </label>
                        )}

                        {gameSpotifySourceType === "artist" && (
                          <label className="flex flex-col gap-1">
                            <span className="text-[0.625rem] font-medium text-[var(--muted-foreground)]">Artist</span>
                            <input
                              value={gameSpotifyArtistDraft}
                              onChange={(event) => setGameSpotifyArtistDraft(event.target.value)}
                              onBlur={() =>
                                updateMeta.mutate({
                                  id: chat.id,
                                  gameSpotifyArtist: gameSpotifyArtistDraft.trim() || null,
                                })
                              }
                              placeholder="HOYO-MiX"
                              className="w-full rounded-lg border border-[var(--border)] bg-[var(--secondary)] px-2.5 py-1.5 text-xs text-[var(--foreground)] placeholder:text-[var(--muted-foreground)]/50"
                            />
                          </label>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {lorebookKeeperActive && !isGame && (
                  <div className="space-y-2 rounded-xl border border-[var(--border)] bg-[var(--secondary)]/70 p-3">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 text-[0.6875rem] font-medium">
                          <BookOpen size="0.75rem" className="text-[var(--primary)]" />
                          <span>Lorebook Keeper</span>
                        </div>
                        <p className="mt-1 text-[0.625rem] text-[var(--muted-foreground)]">
                          Pick a chat-specific target lorebook. If blank, Keeper uses a scoped active lorebook and skips
                          writing when none is available.
                        </p>
                      </div>
                      <button
                        onClick={handleLorebookKeeperBackfill}
                        disabled={agentProcessing || !lorebookKeeperActive}
                        className={cn(
                          "inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-[0.6875rem] font-medium transition-colors",
                          agentProcessing || !lorebookKeeperActive
                            ? "cursor-not-allowed bg-[var(--muted)] text-[var(--muted-foreground)]"
                            : "bg-[var(--primary)]/10 text-[var(--primary)] hover:bg-[var(--primary)]/15",
                        )}
                      >
                        <RefreshCw size="0.75rem" className={cn(agentProcessing && "animate-spin")} />
                        <span>Backfill Unprocessed</span>
                      </button>
                    </div>

                    <div className="grid gap-2 sm:grid-cols-2">
                      <label className="flex min-w-0 flex-col gap-1 text-[0.625rem] text-[var(--muted-foreground)]">
                        <span className="font-medium text-[var(--foreground)]">Target Lorebook</span>
                        <select
                          value={lorebookKeeperTargetLorebookId}
                          onChange={(e) =>
                            updateMeta.mutate({
                              id: chat.id,
                              lorebookKeeperTargetLorebookId: e.target.value || null,
                            })
                          }
                          className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-2.5 py-2 text-xs text-[var(--foreground)]"
                        >
                          <option value="">Use scoped active lorebook</option>
                          {((lorebooks ?? []) as Array<{ id: string; name: string }>).map((lorebook) => (
                            <option key={lorebook.id} value={lorebook.id}>
                              {lorebook.name}
                            </option>
                          ))}
                        </select>
                      </label>

                      <label className="flex min-w-0 flex-col gap-1 text-[0.625rem] text-[var(--muted-foreground)]">
                        <span className="font-medium text-[var(--foreground)]">Read Behind</span>
                        <input
                          type="number"
                          min={0}
                          max={100}
                          step={1}
                          value={lorebookKeeperReadBehindMessages}
                          onChange={(e) => {
                            const nextValue = e.target.value === "" ? 0 : Number.parseInt(e.target.value, 10);
                            updateMeta.mutate({
                              id: chat.id,
                              lorebookKeeperReadBehindMessages: Number.isFinite(nextValue)
                                ? Math.max(0, Math.min(100, nextValue))
                                : 0,
                            });
                          }}
                          className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-2.5 py-2 text-xs text-[var(--foreground)]"
                        />
                      </label>

                      <div className="flex min-w-0 items-center justify-between gap-3 rounded-lg border border-[var(--border)] bg-[var(--background)] px-2.5 py-2 sm:col-span-2">
                        <div className="min-w-0">
                          <p className="text-[0.6875rem] font-medium text-[var(--foreground)]">Review before saving</p>
                          <p className="text-[0.625rem] text-[var(--muted-foreground)]">
                            Queue Lorebook Keeper proposals for approve/reject instead of committing them immediately.
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() =>
                            updateMeta.mutate({
                              id: chat.id,
                              lorebookKeeperReviewRequired: !lorebookKeeperReviewRequired,
                            })
                          }
                          className={cn(
                            "relative h-5 w-9 shrink-0 rounded-full transition-colors",
                            lorebookKeeperReviewRequired ? "bg-[var(--primary)]" : "bg-[var(--muted-foreground)]/50",
                          )}
                          aria-pressed={lorebookKeeperReviewRequired}
                        >
                          <span
                            className={cn(
                              "absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform",
                              lorebookKeeperReviewRequired && "translate-x-4",
                            )}
                          />
                        </button>
                      </div>
                    </div>

                    <p className="text-[0.625rem] text-[var(--muted-foreground)]">
                      Read-behind uses assistant messages: 0 means the newest eligible reply, 1 waits one reply, and
                      backfill only processes messages Lorebook Keeper has not already saved.
                    </p>
                  </div>
                )}

                {expressionActive && !isGame && (
                  <div className="space-y-2 rounded-xl border border-[var(--border)] bg-[var(--secondary)]/70 p-3">
                    <div className="flex items-start gap-2">
                      <Image size="0.75rem" className="mt-0.5 text-[var(--primary)]" />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 text-[0.6875rem] font-medium">
                          <span>Expression Engine Sprites</span>
                          {spriteCharacterIds.length > 0 && (
                            <span className="rounded-full bg-[var(--primary)]/10 px-1.5 py-0.5 text-[0.5625rem] font-medium text-[var(--primary)]">
                              {spriteCharacterIds.length}/3 enabled
                            </span>
                          )}
                        </div>
                        <p className="mt-1 text-[0.625rem] text-[var(--muted-foreground)]">
                          Choose which added characters or the active persona can appear as VN sprites and control the
                          sprite layout for this chat.
                        </p>
                      </div>
                    </div>

                    <SpriteDisplayModeToggle modes={spriteDisplayModes} onToggle={toggleSpriteDisplayMode} />

                    <button
                      type="button"
                      onClick={() =>
                        updateMeta.mutate({ id: chat.id, expressionAvatarsEnabled: !expressionAvatarsEnabled })
                      }
                      className={cn(
                        "flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-left transition-all",
                        expressionAvatarsEnabled
                          ? "bg-[var(--primary)]/10 ring-1 ring-[var(--primary)]/30"
                          : "bg-[var(--background)]/75 ring-1 ring-[var(--border)] hover:bg-[var(--accent)]",
                      )}
                    >
                      <div className="min-w-0 flex-1">
                        <span className="text-[0.6875rem] font-medium">Expression Avatars</span>
                        <p className="mt-0.5 text-[0.625rem] text-[var(--muted-foreground)]">
                          Replace message avatars with the selected expression sprite and hide duplicate portrait
                          sprites.
                        </p>
                      </div>
                      <div
                        className={cn(
                          "h-5 w-9 shrink-0 rounded-full p-0.5 transition-colors",
                          expressionAvatarsEnabled ? "bg-[var(--primary)]" : "bg-[var(--muted-foreground)]/50",
                        )}
                      >
                        <div
                          className={cn(
                            "h-4 w-4 rounded-full bg-white shadow-sm transition-transform",
                            expressionAvatarsEnabled && "translate-x-3.5",
                          )}
                        />
                      </div>
                    </button>

                    {chatSpriteSubjects.length === 0 ? (
                      <p className="text-[0.625rem] text-[var(--muted-foreground)]">
                        Add characters to this chat or choose a persona first to enable sprite selection.
                      </p>
                    ) : chatSpriteSubjectsLoading ? (
                      <p className="text-[0.625rem] text-[var(--muted-foreground)]">Loading sprite owners...</p>
                    ) : chatSpriteSubjectsWithSprites.length > 0 ? (
                      <div className="space-y-1.5">
                        {chatSpriteSubjectsWithSprites.map((subject) => {
                          const isPersona = subject.kind === "persona";
                          const name = isPersona ? subject.persona.name : charName(subject.character);
                          const title = isPersona ? subject.persona.comment || "Persona" : charTitle(subject.character);
                          const avatarPath = isPersona ? subject.persona.avatarPath : subject.character.avatarPath;
                          const avatarCrop = isPersona ? null : charAvatarCrop(subject.character);
                          const spriteActive = isSpriteSubjectActive(subject);

                          return (
                            <div
                              key={`${subject.kind}:${subject.id}`}
                              className="flex items-center gap-2.5 rounded-lg bg-[var(--background)]/75 px-3 py-2 ring-1 ring-[var(--border)]"
                            >
                              <button
                                onClick={() => {
                                  onClose();
                                  if (isPersona) {
                                    useUIStore.getState().openPersonaDetail(subject.id);
                                  } else {
                                    useUIStore.getState().openCharacterDetail(subject.id);
                                  }
                                }}
                                className="flex min-w-0 flex-1 items-center gap-2.5 text-left transition-colors hover:opacity-80"
                                title={isPersona ? "Open persona" : "Open character card"}
                              >
                                {avatarPath ? (
                                  <span className="relative block h-8 w-8 shrink-0 overflow-hidden rounded-full">
                                    <AvatarImage src={avatarPath} alt={name} crop={avatarCrop} />
                                  </span>
                                ) : (
                                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--accent)] text-[0.625rem] font-bold">
                                    {name[0]}
                                  </div>
                                )}
                                <div className="min-w-0 flex-1">
                                  <span className="block truncate text-xs font-medium">{name}</span>
                                  {title && (
                                    <span className="block truncate text-[0.625rem] italic text-[var(--muted-foreground)]">
                                      {title}
                                    </span>
                                  )}
                                  <span className="block text-[0.625rem] text-[var(--muted-foreground)]">
                                    {isPersona ? "Persona sprites available" : "Uploaded sprites available"}
                                  </span>
                                </div>
                              </button>

                              <SpriteToggleButton
                                active={spriteActive}
                                disabled={!spriteActive && spriteCharacterIds.length >= 3}
                                onToggle={() => toggleSprite(subject)}
                              />
                            </div>
                          );
                        })}
                      </div>
                    ) : chatSpriteChoicesLoading ? (
                      <p className="text-[0.625rem] text-[var(--muted-foreground)]">
                        Checking added characters for uploaded sprites...
                      </p>
                    ) : (
                      <p className="text-[0.625rem] text-[var(--muted-foreground)]">
                        None of the added characters or the active persona have uploaded sprites yet. Open their card to
                        add sprites first.
                      </p>
                    )}

                    <p className="text-[0.625rem] text-[var(--muted-foreground)]">
                      {expressionActive
                        ? "Only added characters and the active persona with uploaded sprites appear here. You can enable up to 3 at a time."
                        : activeAgentIds.length === 0
                          ? "Expression Engine is not currently enabled in this chat. These sprite choices will apply once it is enabled."
                          : "Expression Engine is not in this chat's active agent list. Add it below to show sprites during roleplay."}
                    </p>

                    {spriteCharacterIds.length > 0 && (
                      <div className="rounded-lg bg-[var(--background)]/75 px-3 py-2 ring-1 ring-[var(--border)]">
                        <div className="flex items-center gap-2">
                          <Image size="0.75rem" className="text-[var(--muted-foreground)]" />
                          <span className="flex-1 text-[0.6875rem] text-[var(--muted-foreground)]">Sprite Layout</span>
                          <button
                            onClick={() => onToggleSpriteArrange?.()}
                            className={cn(
                              "rounded-md px-2.5 py-1 text-[0.625rem] font-medium transition-colors ring-1 ring-[var(--border)]",
                              spriteArrangeMode
                                ? "bg-[var(--primary)] text-white"
                                : "text-[var(--muted-foreground)] hover:bg-[var(--accent)]",
                            )}
                          >
                            {spriteArrangeMode ? "Done" : "Arrange"}
                          </button>
                          <button
                            onClick={resetSpritePlacements}
                            disabled={!hasCustomSpritePlacements}
                            className={cn(
                              "rounded-md px-2.5 py-1 text-[0.625rem] font-medium transition-colors ring-1 ring-[var(--border)]",
                              hasCustomSpritePlacements
                                ? "text-[var(--muted-foreground)] hover:bg-[var(--accent)]"
                                : "cursor-not-allowed opacity-40 text-[var(--muted-foreground)]",
                            )}
                          >
                            Reset
                          </button>
                        </div>

                        <div className="mt-2 flex items-center gap-2">
                          <span className="text-[0.625rem] font-medium text-[var(--muted-foreground)]">
                            Default Side
                          </span>
                          <div className="flex rounded-md ring-1 ring-[var(--border)]">
                            <button
                              onClick={() => setSpriteSide("left")}
                              className={cn(
                                "rounded-l-md px-2.5 py-1 text-[0.625rem] font-medium transition-colors",
                                spritePosition === "left"
                                  ? "bg-[var(--primary)] text-white"
                                  : "text-[var(--muted-foreground)] hover:bg-[var(--accent)]",
                              )}
                            >
                              Left
                            </button>
                            <button
                              onClick={() => setSpriteSide("right")}
                              className={cn(
                                "rounded-r-md px-2.5 py-1 text-[0.625rem] font-medium transition-colors",
                                spritePosition === "right"
                                  ? "bg-[var(--primary)] text-white"
                                  : "text-[var(--muted-foreground)] hover:bg-[var(--accent)]",
                              )}
                            >
                              Right
                            </button>
                          </div>
                        </div>

                        <div className="mt-3 grid gap-3 sm:grid-cols-2">
                          <SpriteRangeSlider
                            label="Size"
                            value={spriteScalePercent}
                            min={50}
                            max={175}
                            step={5}
                            suffix="%"
                            onChange={setSpriteScale}
                          />
                          <SpriteRangeSlider
                            label="Opacity"
                            value={spriteOpacityPercent}
                            min={15}
                            max={100}
                            step={5}
                            suffix="%"
                            onChange={setSpriteOpacity}
                          />
                        </div>

                        <p className="mt-2 text-[0.5625rem] leading-relaxed text-[var(--muted-foreground)]">
                          Arrange mode lets you drag sprites anywhere in the chat area. Reset clears saved positions.
                          Changing the side flips the current layout.
                        </p>
                      </div>
                    )}
                  </div>
                )}

                {agentsEnabled && isRoleplayMode && spotifyActive && (
                  <div className="space-y-2 rounded-xl border border-[var(--border)] bg-[var(--secondary)]/70 p-3">
                    <div className="flex items-start gap-2">
                      <Music2 size="0.75rem" className="mt-0.5 text-[var(--primary)]" />
                      <div className="min-w-0 flex-1">
                        <div className="text-[0.6875rem] font-medium">Spotify DJ</div>
                        <p className="mt-1 text-[0.625rem] text-[var(--muted-foreground)]">
                          Choose where the DJ should look for roleplay music when it reacts to the scene.
                        </p>
                      </div>
                    </div>

                    <label className="flex flex-col gap-1">
                      <span className="text-[0.625rem] font-medium text-[var(--muted-foreground)]">Music source</span>
                      <select
                        value={spotifySourceType}
                        onChange={(event) => {
                          const next = normalizeSpotifySourceType(event.target.value);
                          updateMeta.mutate({
                            id: chat.id,
                            spotifySourceType: next,
                            spotifyPlaylistId: next === "playlist" ? spotifyPlaylistId || null : null,
                            spotifyPlaylistName:
                              next === "playlist" ? (metadata.spotifyPlaylistName as string) || null : null,
                            spotifyArtist: next === "artist" ? spotifyArtistDraft.trim() || null : null,
                          });
                        }}
                        className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-2.5 py-2 text-xs text-[var(--foreground)]"
                      >
                        {SPOTIFY_SOURCE_OPTIONS.map((option) => (
                          <option key={option.id} value={option.id}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                      <span className="text-[0.5625rem] text-[var(--muted-foreground)]">
                        {SPOTIFY_SOURCE_OPTIONS.find((option) => option.id === spotifySourceType)?.description ?? ""}
                      </span>
                    </label>

                    {spotifySourceType === "playlist" && (
                      <label className="flex flex-col gap-1">
                        <span className="text-[0.625rem] font-medium text-[var(--muted-foreground)]">Playlist</span>
                        {spotifyPlaylistsQuery.data?.playlists.length ? (
                          <select
                            value={spotifyPlaylistId}
                            onChange={(event) => {
                              const playlist = spotifyPlaylistsQuery.data?.playlists.find(
                                (entry) => entry.id === event.target.value,
                              );
                              updateMeta.mutate({
                                id: chat.id,
                                spotifyPlaylistId: event.target.value || null,
                                spotifyPlaylistName: playlist?.name ?? null,
                              });
                            }}
                            className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-2.5 py-2 text-xs text-[var(--foreground)]"
                          >
                            <option value="">Choose playlist...</option>
                            {spotifyPlaylistsQuery.data.playlists.map((playlist) => {
                              const suffix =
                                typeof playlist.trackCount === "number"
                                  ? ` (${playlist.trackCount})`
                                  : playlist.owned === false
                                    ? " (followed, unavailable)"
                                    : "";
                              return (
                                <option key={playlist.id} value={playlist.id}>
                                  {playlist.name}
                                  {suffix}
                                </option>
                              );
                            })}
                          </select>
                        ) : (
                          <input
                            key={`${chat.id}-${spotifyPlaylistId}`}
                            defaultValue={spotifyPlaylistId}
                            onBlur={(event) =>
                              updateMeta.mutate({
                                id: chat.id,
                                spotifyPlaylistId: event.target.value.trim() || null,
                                spotifyPlaylistName: null,
                              })
                            }
                            placeholder={
                              spotifyPlaylistsQuery.isFetching ? "Loading playlists..." : "Paste playlist ID"
                            }
                            className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-2.5 py-2 text-xs text-[var(--foreground)] placeholder:text-[var(--muted-foreground)]/50"
                          />
                        )}
                        {spotifyPlaylistsQuery.isError && (
                          <span className="text-[0.5625rem] text-amber-400/90">
                            Connect Spotify in the Spotify DJ agent to load playlist names.
                          </span>
                        )}
                      </label>
                    )}

                    {spotifySourceType === "artist" && (
                      <label className="flex flex-col gap-1">
                        <span className="text-[0.625rem] font-medium text-[var(--muted-foreground)]">Artist</span>
                        <input
                          value={spotifyArtistDraft}
                          onChange={(event) => setSpotifyArtistDraft(event.target.value)}
                          onBlur={() =>
                            updateMeta.mutate({
                              id: chat.id,
                              spotifyArtist: spotifyArtistDraft.trim() || null,
                            })
                          }
                          placeholder="HOYO-MiX"
                          className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-2.5 py-2 text-xs text-[var(--foreground)] placeholder:text-[var(--muted-foreground)]/50"
                        />
                      </label>
                    )}

                    <p className="text-[0.625rem] text-[var(--muted-foreground)]">
                      Roleplay DJ queues several fitting tracks when it changes music. Spotify Premium, a connected
                      account, and an active Spotify device are still required.
                    </p>
                  </div>
                )}

                {/* Manual trackers toggle - roleplay only */}
                {agentsEnabled && isRoleplayMode && (
                  <button
                    onClick={() => updateMeta.mutate({ id: chat.id, manualTrackers: !manualTrackersEnabled })}
                    className={cn(
                      "flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left transition-all",
                      manualTrackersEnabled
                        ? "bg-[var(--primary)]/10 ring-1 ring-[var(--primary)]/30"
                        : "bg-[var(--secondary)] hover:bg-[var(--accent)]",
                    )}
                  >
                    <div>
                      <span className="text-[0.6875rem] font-medium">Manual Trackers</span>
                      <p className="text-[0.625rem] text-[var(--muted-foreground)]">
                        {manualTrackersEnabled
                          ? "Trackers won't run automatically — use the button in the HUD to trigger them."
                          : "Trackers run automatically after every generation."}
                      </p>
                    </div>
                    <div
                      className={cn(
                        "h-5 w-9 overflow-hidden rounded-full p-0.5 transition-colors shrink-0",
                        manualTrackersEnabled ? "bg-[var(--primary)]" : "bg-[var(--muted-foreground)]/50",
                      )}
                    >
                      <div
                        className={cn(
                          "h-4 w-4 rounded-full bg-white shadow-sm transition-transform",
                          manualTrackersEnabled && "translate-x-3.5",
                        )}
                      />
                    </div>
                  </button>
                )}

                {/* Image Generation — game mode only */}
                {isGame && (
                  <div>
                    <button
                      onClick={() =>
                        updateMeta.mutate({ id: chat.id, enableSpriteGeneration: !spriteGenerationEnabled })
                      }
                      className={cn(
                        "flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left transition-all",
                        spriteGenerationEnabled
                          ? "bg-[var(--primary)]/10 ring-1 ring-[var(--primary)]/30"
                          : "bg-[var(--secondary)] hover:bg-[var(--accent)]",
                      )}
                    >
                      <div className="flex-1 min-w-0">
                        <span className="text-[0.6875rem] font-medium flex items-center gap-1.5">
                          <Image size="0.75rem" /> Image Generation
                        </span>
                        <p className="text-[0.625rem] text-[var(--muted-foreground)]">
                          Auto-generate NPC portraits and location backgrounds during gameplay.
                        </p>
                      </div>
                      <div
                        className={cn(
                          "h-5 w-9 shrink-0 rounded-full p-0.5 transition-colors",
                          spriteGenerationEnabled ? "bg-[var(--primary)]" : "bg-[var(--muted-foreground)]/50",
                        )}
                      >
                        <div
                          className={cn(
                            "h-4 w-4 rounded-full bg-white shadow-sm transition-transform",
                            spriteGenerationEnabled && "translate-x-3.5",
                          )}
                        />
                      </div>
                    </button>
                    {spriteGenerationEnabled && (
                      <div className="mt-1.5 space-y-2 px-3">
                        <select
                          value={(metadata.gameImageConnectionId as string) ?? ""}
                          onChange={(e) =>
                            updateMeta.mutate({ id: chat.id, gameImageConnectionId: e.target.value || null })
                          }
                          className="w-full rounded-lg border border-[var(--border)] bg-[var(--secondary)] px-2.5 py-1.5 text-xs text-[var(--foreground)]"
                        >
                          <option value="">Select image connection…</option>
                          {(imageConnectionsList ?? []).map((c: { id: string; name: string; model?: string }) => (
                            <option key={c.id} value={c.id}>
                              {c.name}
                              {c.model ? ` — ${c.model}` : ""}
                            </option>
                          ))}
                        </select>
                        <label className="flex flex-col gap-1">
                          <span className="text-[0.625rem] font-medium text-[var(--muted-foreground)]">
                            Scene image instructions
                          </span>
                          <textarea
                            value={gameImagePromptInstructionsDraft}
                            onChange={(e) => setGameImagePromptInstructionsDraft(e.target.value)}
                            onBlur={() => {
                              const stored = (metadata.gameImagePromptInstructions as string) ?? "";
                              if (gameImagePromptInstructionsDraft !== stored) {
                                updateMeta.mutate({
                                  id: chat.id,
                                  gameImagePromptInstructions: gameImagePromptInstructionsDraft.trim() || null,
                                });
                              }
                            }}
                            placeholder="e.g. Dottore's mask completely covers his eyes; never render visible eyes behind it."
                            rows={3}
                            maxLength={1200}
                            className="min-h-[4.75rem] w-full resize-y rounded-lg border border-[var(--border)] bg-[var(--secondary)] px-2.5 py-2 text-xs leading-relaxed text-[var(--foreground)] outline-none transition-colors placeholder:text-[var(--muted-foreground)]/40 focus:border-[var(--primary)]/50"
                          />
                        </label>
                      </div>
                    )}
                  </div>
                )}

                {/* Categorized agent sub-sections */}
                {availableAgents.length > 0 && (
                  <>
                    {isGame ? (
                      <div className="space-y-1">
                        {gameAgentPool.map((agentId) => {
                          const agent =
                            availableAgents.find((a) => a.id === agentId) ??
                            ({ id: agentId, name: agentId, description: "", category: "misc" } as const);
                          const active = activeAgentIds.includes(agentId);
                          return (
                            <button
                              key={agentId}
                              onClick={() => {
                                if (active) {
                                  updateMeta.mutate({
                                    id: chat.id,
                                    activeAgentIds: activeAgentIds.filter((id) => id !== agentId),
                                  });
                                } else {
                                  updateMeta.mutate({ id: chat.id, activeAgentIds: [...activeAgentIds, agentId] });
                                }
                              }}
                              className={cn(
                                "flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left transition-all",
                                active
                                  ? "bg-[var(--primary)]/10 ring-1 ring-[var(--primary)]/30"
                                  : "bg-[var(--secondary)] hover:bg-[var(--accent)]",
                              )}
                            >
                              <div className="min-w-0 flex-1">
                                <span className="block truncate text-xs font-medium">{agent.name}</span>
                                {agent.description ? (
                                  <span className="block truncate text-[0.625rem] text-[var(--muted-foreground)]">
                                    {agent.description}
                                  </span>
                                ) : null}
                              </div>
                              <div
                                className={cn(
                                  "h-5 w-9 shrink-0 rounded-full p-0.5 transition-colors",
                                  active ? "bg-[var(--primary)]" : "bg-[var(--muted-foreground)]/50",
                                )}
                              >
                                <div
                                  className={cn(
                                    "h-4 w-4 rounded-full bg-white shadow-sm transition-transform",
                                    active && "translate-x-3.5",
                                  )}
                                />
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    ) : (
                      <>
                        {/* Approximate per-turn cost of the active agent loadout. */}
                        <div
                          className={cn(
                            "flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-[0.6875rem] ring-1",
                            agentLoadCost.cost.level === "high"
                              ? "bg-amber-400/10 text-amber-400/90 ring-amber-400/30"
                              : "bg-[var(--secondary)]/60 text-[var(--muted-foreground)] ring-[var(--border)]",
                          )}
                          title={`Approximate. Each call also carries chat context (recent messages, characters, persona, lorebook), so real per-turn token use is higher. Smaller models may slow down or fail past ~${AGENT_COST_HIGH_CALLS} calls or ~${AGENT_COST_HIGH_TOKENS.toLocaleString()} instruction tokens.`}
                        >
                          <span className="flex min-w-0 items-center gap-1.5">
                            {agentLoadCost.cost.level === "high" && (
                              <AlertTriangle size="0.75rem" className="shrink-0" />
                            )}
                            <span className="truncate">
                              ~{agentLoadCost.cost.instructionTokens.toLocaleString()} tokens of agent instructions
                              {" · "}~{agentLoadCost.cost.extraCalls} extra call
                              {agentLoadCost.cost.extraCalls === 1 ? "" : "s"}/turn
                            </span>
                          </span>
                          <span className="shrink-0 cursor-help text-[0.625rem] opacity-70">ⓘ</span>
                        </div>

                        {activeAgentIds.length === 0 && (
                          <p className="text-[0.6875rem] text-[var(--muted-foreground)] px-1">
                            No agents are active in this chat. Add one below to run it during generation.
                          </p>
                        )}

                        {/* Agent category sub-sections */}
                        {(
                          [
                            {
                              key: "writer",
                              label: "Writer Agents",
                              icon: <Feather size="0.75rem" />,
                              description:
                                "Improve prose quality, maintain continuity, and shape the narrative direction of your roleplay.",
                            },
                            {
                              key: "tracker",
                              label: "Tracker Agents",
                              icon: <Activity size="0.75rem" />,
                              description:
                                "Automatically track world state, character stats, quests, expressions, and other data that changes over time.",
                            },
                            {
                              key: "misc",
                              label: "Misc Agents",
                              icon: <Puzzle size="0.75rem" />,
                              description:
                                "Specialized utilities — image generation, combat systems, music, summaries, and other extras.",
                            },
                          ] as const
                        ).map((cat) => {
                          const catAgents = availableAgents.filter((a) => a.category === cat.key);
                          const activeInCat = catAgents.filter((a) => activeAgentIds.includes(a.id));
                          const inactiveInCat = catAgents.filter((a) => !activeAgentIds.includes(a.id));
                          if (catAgents.length === 0) return null;
                          return (
                            <AgentCategorySection
                              key={cat.key}
                              label={cat.label}
                              icon={cat.icon}
                              description={cat.description}
                              count={activeInCat.length}
                            >
                              {cat.key === "writer" && (
                                <div className="ml-auto flex w-fit max-w-full flex-wrap justify-end gap-1">
                                  <button
                                    type="button"
                                    onClick={() =>
                                      updateMeta.mutate({
                                        id: chat.id,
                                        reviewWriterAgentOutputs: metadata.reviewWriterAgentOutputs !== true,
                                      })
                                    }
                                    aria-pressed={metadata.reviewWriterAgentOutputs === true}
                                    className="flex max-w-full items-center gap-2 rounded-md bg-[var(--background)]/20 px-1.5 py-1 text-left text-[0.5625rem] text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)]/35 hover:text-[var(--foreground)]"
                                    title={
                                      metadata.reviewWriterAgentOutputs === true
                                        ? "Stop pausing before the main reply to review writer agent output."
                                        : "Pause before the main reply so Prose Guardian, Narrative Director, and similar writer outputs can be reviewed and edited."
                                    }
                                  >
                                    <span className="flex min-w-0 items-center gap-1.5">
                                      <Pencil size="0.625rem" className="shrink-0 text-[var(--primary)]" />
                                      <span className="truncate font-medium">Review outputs</span>
                                    </span>
                                    <span
                                      className={cn(
                                        "h-3.5 w-6 shrink-0 rounded-full p-0.5 transition-colors",
                                        metadata.reviewWriterAgentOutputs === true
                                          ? "bg-[var(--primary)]"
                                          : "bg-[var(--muted-foreground)]/50",
                                      )}
                                    >
                                      <span
                                        className={cn(
                                          "block h-2.5 w-2.5 rounded-full bg-white shadow-sm transition-transform",
                                          metadata.reviewWriterAgentOutputs === true && "translate-x-2.5",
                                        )}
                                      />
                                    </span>
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      updateMeta.mutate({
                                        id: chat.id,
                                        showInjectionsPanel: metadata.showInjectionsPanel !== true,
                                      })
                                    }
                                    aria-pressed={metadata.showInjectionsPanel === true}
                                    className="flex max-w-full items-center gap-2 rounded-md bg-[var(--background)]/20 px-1.5 py-1 text-left text-[0.5625rem] text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)]/35 hover:text-[var(--foreground)]"
                                    title={
                                      metadata.showInjectionsPanel === true
                                        ? "Hide the Injections tab in the roleplay Agents menu. This is mainly for troubleshooting Prose Guardian, Narrative Director, or custom injected text before regenerating the current reply."
                                        : "Show the Injections tab in the roleplay Agents menu. This is mainly for troubleshooting Prose Guardian, Narrative Director, or custom injected text before regenerating the current reply."
                                    }
                                  >
                                    <span className="flex min-w-0 items-center gap-1.5">
                                      <FilePlus2 size="0.625rem" className="shrink-0 text-[var(--primary)]" />
                                      <span className="truncate font-medium">Injections tab</span>
                                    </span>
                                    <span
                                      className={cn(
                                        "h-3.5 w-6 shrink-0 rounded-full p-0.5 transition-colors",
                                        metadata.showInjectionsPanel === true
                                          ? "bg-[var(--primary)]"
                                          : "bg-[var(--muted-foreground)]/50",
                                      )}
                                    >
                                      <span
                                        className={cn(
                                          "block h-2.5 w-2.5 rounded-full bg-white shadow-sm transition-transform",
                                          metadata.showInjectionsPanel === true && "translate-x-2.5",
                                        )}
                                      />
                                    </span>
                                  </button>
                                </div>
                              )}
                              {/* Active agents in this category */}
                              {activeInCat.length > 0 && (
                                <div className="flex flex-col gap-1 mb-1.5">
                                  {activeInCat.map((agent) => {
                                    const tokenEst = agentLoadCost.tokensByType.get(agent.id);
                                    const isSecretPlotDriver = agent.id === "secret-plot-driver";
                                    return (
                                      <div
                                        key={agent.id}
                                        role="button"
                                        tabIndex={0}
                                        onClick={() => openAgentSettingsModal(agent)}
                                        onKeyDown={(event) => {
                                          if (event.key !== "Enter" && event.key !== " ") return;
                                          event.preventDefault();
                                          openAgentSettingsModal(agent);
                                        }}
                                        className="rounded-lg bg-[var(--primary)]/10 px-3 py-2 text-left ring-1 ring-[var(--primary)]/30 transition-colors hover:bg-[var(--primary)]/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
                                        title={`Open ${agent.name} settings`}
                                      >
                                        <div className="flex items-start gap-2.5">
                                          <Sparkles size="0.875rem" className="mt-0.5 shrink-0 text-[var(--primary)]" />
                                          <div className="min-w-0 flex-1">
                                            <div className="flex min-w-0 items-center gap-1.5">
                                              <span className="block min-w-0 truncate text-xs">{agent.name}</span>
                                              {tokenEst != null ? (
                                                <span
                                                  className="shrink-0 tabular-nums text-[0.625rem] text-[var(--muted-foreground)]"
                                                  title={`~${tokenEst.toLocaleString()} tokens of agent instructions (estimated)`}
                                                >
                                                  ~{tokenEst.toLocaleString()}
                                                </span>
                                              ) : null}
                                            </div>
                                            <span className="mt-0.5 block text-[0.625rem] leading-tight text-[var(--muted-foreground)] line-clamp-2">
                                              {agent.description}
                                            </span>
                                          </div>
                                          <button
                                            onClick={(event) => {
                                              event.stopPropagation();
                                              void toggleAgent(agent.id);
                                            }}
                                            onKeyDown={(event) => event.stopPropagation()}
                                            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[var(--muted-foreground)] transition-colors hover:bg-[var(--destructive)]/15 hover:text-[var(--destructive)]"
                                            title="Remove from chat"
                                          >
                                            <Trash2 size="0.6875rem" />
                                          </button>
                                        </div>
                                        {isSecretPlotDriver && (
                                          <button
                                            type="button"
                                            onClick={(event) => {
                                              event.stopPropagation();
                                              updateMeta.mutate({
                                                id: chat.id,
                                                showSecretPlotPanel: metadata.showSecretPlotPanel !== true,
                                              });
                                            }}
                                            aria-pressed={metadata.showSecretPlotPanel === true}
                                            className="ml-auto mt-1.5 flex w-fit max-w-full items-center gap-2 rounded-md bg-[var(--background)]/20 px-1.5 py-1 text-left text-[0.5625rem] text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)]/35 hover:text-[var(--foreground)]"
                                            title={
                                              metadata.showSecretPlotPanel === true
                                                ? "Hide the Secret Plot tab in the roleplay Agents menu. That tab lets you inspect and edit the Secret Plot Driver's hidden arc memory and scene directions for this chat."
                                                : "Show the Secret Plot tab in the roleplay Agents menu. Use it to inspect and edit the Secret Plot Driver's hidden arc memory and scene directions for this chat."
                                            }
                                          >
                                            <span className="flex min-w-0 items-center gap-1.5">
                                              <Brain size="0.625rem" className="shrink-0 text-[var(--primary)]" />
                                              <span className="truncate font-medium">Secret Plot tab</span>
                                            </span>
                                            <span
                                              className={cn(
                                                "h-3.5 w-6 shrink-0 rounded-full p-0.5 transition-colors",
                                                metadata.showSecretPlotPanel === true
                                                  ? "bg-[var(--primary)]"
                                                  : "bg-[var(--muted-foreground)]/50",
                                              )}
                                            >
                                              <span
                                                className={cn(
                                                  "block h-2.5 w-2.5 rounded-full bg-white shadow-sm transition-transform",
                                                  metadata.showSecretPlotPanel === true && "translate-x-2.5",
                                                )}
                                              />
                                            </span>
                                          </button>
                                        )}
                                      </div>
                                    );
                                  })}
                                </div>
                              )}
                              {/* Available agents to add */}
                              {inactiveInCat.length > 0 ? (
                                <div className="flex flex-col gap-1">
                                  {inactiveInCat.map((agent) => (
                                    <button
                                      key={agent.id}
                                      onClick={() => openAgentAddModal(agent)}
                                      className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-left transition-all hover:bg-[var(--accent)] bg-[var(--secondary)]"
                                    >
                                      <Plus size="0.75rem" className="shrink-0 text-[var(--muted-foreground)]" />
                                      <div className="flex-1 min-w-0">
                                        <span className="block truncate text-xs">{agent.name}</span>
                                        <span className="mt-0.5 block text-[0.625rem] leading-tight text-[var(--muted-foreground)] line-clamp-2">
                                          {agent.description}
                                        </span>
                                      </div>
                                    </button>
                                  ))}
                                </div>
                              ) : (
                                <p className="text-[0.625rem] text-[var(--muted-foreground)] px-1">
                                  All agents in this category are active.
                                </p>
                              )}
                            </AgentCategorySection>
                          );
                        })}

                        {/* Custom agents */}
                        {(() => {
                          const customAgents = availableAgents.filter((a) => a.category === "custom");
                          if (customAgents.length === 0) return null;
                          const activeCustom = customAgents.filter((a) => activeAgentIds.includes(a.id));
                          const inactiveCustom = customAgents.filter((a) => !activeAgentIds.includes(a.id));
                          return (
                            <AgentCategorySection
                              label="Custom Agents"
                              icon={<Settings2 size="0.75rem" />}
                              description="Your custom-created agents."
                              count={activeCustom.length}
                            >
                              {activeCustom.length > 0 && (
                                <div className="flex flex-col gap-1 mb-1.5">
                                  {activeCustom.map((agent) => {
                                    const tokenEst = agentLoadCost.tokensByType.get(agent.id);
                                    return (
                                      <div
                                        key={agent.id}
                                        role="button"
                                        tabIndex={0}
                                        onClick={() => openAgentSettingsModal(agent)}
                                        onKeyDown={(event) => {
                                          if (event.key !== "Enter" && event.key !== " ") return;
                                          event.preventDefault();
                                          openAgentSettingsModal(agent);
                                        }}
                                        className="flex items-center gap-2.5 rounded-lg bg-[var(--primary)]/10 px-3 py-2 text-left ring-1 ring-[var(--primary)]/30 transition-colors hover:bg-[var(--primary)]/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
                                        title={`Open ${agent.name} settings`}
                                      >
                                        <Sparkles size="0.875rem" className="text-[var(--primary)]" />
                                        <div className="flex-1 min-w-0">
                                          <span className="block truncate text-xs">{agent.name}</span>
                                        </div>
                                        {tokenEst != null ? (
                                          <span
                                            className="shrink-0 tabular-nums text-[0.625rem] text-[var(--muted-foreground)]"
                                            title={`~${tokenEst.toLocaleString()} tokens of agent instructions (estimated)`}
                                          >
                                            ~{tokenEst.toLocaleString()}
                                          </span>
                                        ) : null}
                                        <button
                                          onClick={(event) => {
                                            event.stopPropagation();
                                            void toggleAgent(agent.id);
                                          }}
                                          onKeyDown={(event) => event.stopPropagation()}
                                          className="flex h-5 w-5 items-center justify-center rounded-md text-[var(--muted-foreground)] transition-colors hover:bg-[var(--destructive)]/15 hover:text-[var(--destructive)]"
                                          title="Remove from chat"
                                        >
                                          <Trash2 size="0.6875rem" />
                                        </button>
                                      </div>
                                    );
                                  })}
                                </div>
                              )}
                              {inactiveCustom.length > 0 && (
                                <div className="flex flex-col gap-1">
                                  {inactiveCustom.map((agent) => (
                                    <button
                                      key={agent.id}
                                      onClick={() => openAgentAddModal(agent)}
                                      className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-left transition-all hover:bg-[var(--accent)] bg-[var(--secondary)]"
                                    >
                                      <Plus size="0.75rem" className="shrink-0 text-[var(--muted-foreground)]" />
                                      <div className="flex-1 min-w-0">
                                        <span className="block truncate text-xs">{agent.name}</span>
                                        <span className="mt-0.5 block text-[0.625rem] leading-tight text-[var(--muted-foreground)] line-clamp-2">
                                          {agent.description}
                                        </span>
                                      </div>
                                    </button>
                                  ))}
                                </div>
                              )}
                            </AgentCategorySection>
                          );
                        })()}
                      </>
                    )}
                  </>
                )}
              </div>
            </Section>
          )}

          {/* Memory Recall — conversation mode: show here; roleplay: shown after Function Calling */}
          {isConversation && !isLiteBuild && (
            <Section
              label="Memory Recall"
              icon={<Brain size="0.875rem" />}
              help="When enabled, relevant fragments from this chat are recalled with provider embeddings when configured, otherwise local lexical matching, then injected into the prompt as memories."
            >
              {renderMemoryRecallControls(true)}
            </Section>
          )}

          {/* Automatic Summarization — conversation mode only. Opens a modal to edit per-day and per-week summaries. */}
          {isConversation && (
            <Section
              label="Automatic Summarization"
              icon={<CalendarClock size="0.875rem" />}
              help="To help keep the request context low, the conversation is automatically summarized. Each day is wrapped up into a day summary. Likewise, day summaries are combined into week summaries. Chat messages that have been summarized are not added to context. Only the week summaries, the day summaries of the current week and today's messages are added to the context. This feature currently can't be disabled."
            >
              <div className="space-y-2.5">
                <button
                  onClick={() => setShowSummariesModal(true)}
                  className="flex w-full items-center justify-between rounded-lg bg-[var(--secondary)] px-3 py-2.5 text-left transition-all hover:bg-[var(--accent)]"
                >
                  <div className="flex-1 min-w-0">
                    <span className="text-[0.6875rem] font-medium">Edit Summaries</span>
                    <p className="text-[0.625rem] text-[var(--muted-foreground)]">
                      Review and edit what characters remember from this chat.
                    </p>
                  </div>
                  <Pencil size="0.875rem" className="shrink-0 text-[var(--muted-foreground)]" />
                </button>

                {/* Day rollover hour */}
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2">
                    <Clock size="0.75rem" className="text-[var(--primary)]" />
                    <span className="text-xs font-medium">Day Rollover Hour</span>
                  </div>
                  <select
                    value={(metadata.dayRolloverHour as number | undefined) ?? 4}
                    onChange={(e) => {
                      setRolloverTouchedThisSession(true);
                      updateMeta.mutate({ id: chat.id, dayRolloverHour: Number(e.target.value) });
                    }}
                    className="w-full rounded-lg bg-[var(--secondary)] px-3 py-2 text-xs outline-none ring-1 ring-transparent transition-shadow focus:ring-[var(--primary)]/40"
                  >
                    {Array.from({ length: 12 }, (_, h) => {
                      const label = h === 0 ? "12 AM (midnight)" : `${h} AM`;
                      return (
                        <option key={h} value={h}>
                          {label}
                        </option>
                      );
                    })}
                  </select>
                  <p className="text-[0.625rem] text-[var(--muted-foreground)]">
                    Messages sent before this hour count as part of the previous day. Pick a time you&apos;re never
                    chatting, so a late-night session doesn&apos;t get cut off mid-conversation.
                  </p>
                  {rolloverTouchedThisSession &&
                    (((metadata.daySummaries as Record<string, unknown> | undefined) &&
                      Object.keys(metadata.daySummaries as Record<string, unknown>).length > 0) ||
                      ((metadata.weekSummaries as Record<string, unknown> | undefined) &&
                        Object.keys(metadata.weekSummaries as Record<string, unknown>).length > 0)) && (
                      <div className="flex items-start gap-1.5 rounded-md bg-amber-400/10 px-2 py-1.5 ring-1 ring-amber-400/20">
                        <AlertTriangle size="0.75rem" className="mt-[0.125rem] shrink-0 text-amber-400/80" />
                        <p className="text-[0.625rem] text-amber-400/80 leading-snug">
                          Existing summaries were built with the previous setting. For today, messages near the rollover
                          hour may be duplicated or missing from the prompt. From tomorrow onward, new day summaries
                          will line up correctly. To adjust an older summary, use{" "}
                          <span className="font-medium">Edit Summaries</span> above.
                        </p>
                      </div>
                    )}
                </div>

                {/* Recent message tail */}
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2">
                    <MessageCircle size="0.75rem" className="text-[var(--primary)]" />
                    <span className="text-xs font-medium">Recent Message Tail</span>
                  </div>
                  <input
                    type="number"
                    min={0}
                    max={50}
                    step={1}
                    value={(metadata.summaryTailMessages as number | undefined) ?? 10}
                    onChange={(e) => {
                      const raw = Number(e.target.value);
                      const clamped = Number.isFinite(raw) ? Math.max(0, Math.min(50, Math.floor(raw))) : 10;
                      updateMeta.mutate({ id: chat.id, summaryTailMessages: clamped });
                    }}
                    className="w-full rounded-lg bg-[var(--secondary)] px-3 py-2 text-xs outline-none ring-1 ring-transparent transition-shadow focus:ring-[var(--primary)]/40"
                  />
                  <p className="text-[0.625rem] text-[var(--muted-foreground)]">
                    How many recent messages to keep word-for-word, even once they&apos;re summarized. Helps characters
                    pick up the actual flow of last night&apos;s conversation instead of just the gist. Set to{" "}
                    <span className="font-medium">0</span> to disable.
                  </p>
                </div>
              </div>
            </Section>
          )}

          {/* Discord Webhook */}
          <Section
            label="Discord Mirror"
            icon={<Globe size="0.875rem" />}
            help="Mirror messages from this chat to a Discord channel via webhook. Character messages appear under the character's name, and Game mode system narration uses narrator-style labels where needed."
          >
            <div className="space-y-2">
              <p className="text-[0.625rem] text-[var(--muted-foreground)]">
                Paste a Discord webhook URL to mirror this chat's messages to a channel. Character messages appear under
                their name, and game narration/party messages use simple speaker labels.
              </p>
              <input
                type="url"
                placeholder="https://discord.com/api/webhooks/..."
                value={discordWebhookUrl}
                onChange={(e) => {
                  updateMeta.mutate({ id: chat.id, discordWebhookUrl: e.target.value.trim() || undefined });
                }}
                className="w-full rounded-lg bg-[var(--secondary)] px-3 py-2.5 text-[0.6875rem] text-[var(--foreground)] placeholder:text-[var(--muted-foreground)]/50 ring-1 ring-transparent focus:ring-[var(--primary)]/40 focus:outline-none transition-all"
              />
              {discordWebhookUrl &&
                !/^https:\/\/discord(?:app)?\.com\/api\/webhooks\/\d+\/[\w-]+$/.test(discordWebhookUrl.trim()) && (
                  <p className="text-[0.625rem] text-red-400">Invalid webhook URL format</p>
                )}
            </div>
          </Section>

          {/* Function Calling */}
          <Section
            id="chat-settings-agents"
            label="Function Calling"
            icon={<Wrench size="0.875rem" />}
            count={activeToolIds.length}
            help="When enabled, the AI can call built-in tools like dice rolls, game state updates, and lorebook searches during conversation."
          >
            <div className="space-y-2">
              <button
                onClick={() => {
                  updateMeta.mutate({ id: chat.id, enableTools: !toolsEnabled });
                }}
                className={cn(
                  "flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left transition-all",
                  toolsEnabled
                    ? "bg-[var(--primary)]/10 ring-1 ring-[var(--primary)]/30"
                    : "bg-[var(--secondary)] hover:bg-[var(--accent)]",
                )}
              >
                <div>
                  <span className="text-xs font-medium">Enable Tool Use</span>
                  <p className="text-[0.625rem] text-[var(--muted-foreground)]">
                    Allow AI to call functions (dice rolls, game state, etc.)
                  </p>
                </div>
                <div
                  className={cn(
                    "h-5 w-9 overflow-hidden rounded-full p-0.5 transition-colors",
                    toolsEnabled ? "bg-[var(--primary)]" : "bg-[var(--muted-foreground)]/50",
                  )}
                >
                  <div
                    className={cn(
                      "h-4 w-4 rounded-full bg-white shadow-sm transition-transform",
                      toolsEnabled && "translate-x-3.5",
                    )}
                  />
                </div>
              </button>
              <p className="text-[0.625rem] text-[var(--muted-foreground)] px-1">
                {toolsEnabled
                  ? "If enabled, this chat can use globally enabled tools (or any tools you add below)."
                  : "If disabled, no functions will be available."}
              </p>

              {/* Per-chat tool list */}
              {toolsEnabled && (
                <>
                  {activeToolIds.length === 0 ? (
                    <p className="text-[0.6875rem] text-[var(--muted-foreground)] px-1">
                      All globally enabled tools are available to this chat. Add tools below to restrict this chat to a
                      specific set.
                    </p>
                  ) : (
                    <div className="flex max-h-40 flex-col gap-1 overflow-y-auto">
                      {activeToolIds.map((toolId) => {
                        const tool = availableTools.find((t) => t.id === toolId);
                        if (!tool) return null;
                        return (
                          <div
                            key={tool.id}
                            className="flex items-center gap-2.5 rounded-lg bg-[var(--primary)]/10 px-3 py-2 ring-1 ring-[var(--primary)]/30"
                          >
                            <Wrench size="0.875rem" className="text-[var(--primary)]" />
                            <div className="flex-1 min-w-0">
                              <span className="block truncate text-xs">{tool.name}</span>
                            </div>
                            <button
                              onClick={() => toggleTool(tool.id)}
                              className="flex h-5 w-5 items-center justify-center rounded-md text-[var(--muted-foreground)] transition-colors hover:bg-[var(--destructive)]/15 hover:text-[var(--destructive)]"
                              title="Remove from chat"
                            >
                              <Trash2 size="0.6875rem" />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* Add tool picker */}
                  {!showToolPicker ? (
                    <button
                      onClick={() => {
                        setShowToolPicker(true);
                        setToolSearch("");
                        setPendingToolIds([]);
                      }}
                      className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-[var(--border)] px-3 py-2 text-xs text-[var(--muted-foreground)] transition-colors hover:border-[var(--primary)]/40 hover:text-[var(--primary)]"
                    >
                      <Plus size="0.75rem" /> Add Functions
                    </button>
                  ) : (
                    <PickerDropdown
                      search={toolSearch}
                      onSearchChange={setToolSearch}
                      onClose={() => setShowToolPicker(false)}
                      placeholder="Search functions…"
                      footer={
                        pendingToolIds.length > 0 ? (
                          <div className="border-t border-[var(--border)] px-3 py-2">
                            <button
                              onClick={() => {
                                const next = [...activeToolIds, ...pendingToolIds];
                                updateMeta.mutate({ id: chat.id, activeToolIds: next });
                                setPendingToolIds([]);
                                setShowToolPicker(false);
                              }}
                              className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-[var(--primary)] px-3 py-2 text-xs font-medium text-[var(--primary-foreground)] transition-opacity hover:opacity-90"
                            >
                              <Plus size="0.75rem" /> Add {pendingToolIds.length} Function
                              {pendingToolIds.length > 1 ? "s" : ""}
                            </button>
                          </div>
                        ) : undefined
                      }
                    >
                      {availableTools
                        .filter((t) => !activeToolIds.includes(t.id))
                        .filter((t) => t.name.toLowerCase().includes(toolSearch.toLowerCase()))
                        .map((t) => {
                          const selected = pendingToolIds.includes(t.id);
                          return (
                            <button
                              key={t.id}
                              onClick={() =>
                                setPendingToolIds((prev) =>
                                  prev.includes(t.id) ? prev.filter((id) => id !== t.id) : [...prev, t.id],
                                )
                              }
                              className={cn(
                                "flex items-center gap-2.5 rounded-lg px-3 py-2 text-left transition-all hover:bg-[var(--accent)]",
                                selected && "bg-[var(--primary)]/10 ring-1 ring-[var(--primary)]/30",
                              )}
                            >
                              <div
                                className={cn(
                                  "flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors",
                                  selected
                                    ? "border-[var(--primary)] bg-[var(--primary)] text-white"
                                    : "border-[var(--border)]",
                                )}
                              >
                                {selected && <Check size="0.625rem" />}
                              </div>
                              <div className="flex-1 min-w-0">
                                <span className="block truncate text-xs">{t.name}</span>
                                <span className="block truncate text-[0.625rem] text-[var(--muted-foreground)]">
                                  {t.description}
                                </span>
                              </div>
                            </button>
                          );
                        })}
                      {availableTools
                        .filter((t) => !activeToolIds.includes(t.id))
                        .filter((t) => t.name.toLowerCase().includes(toolSearch.toLowerCase())).length === 0 && (
                        <p className="px-3 py-2 text-[0.6875rem] text-[var(--muted-foreground)]">
                          {availableTools.filter((t) => !activeToolIds.includes(t.id)).length === 0
                            ? "All functions already added."
                            : "No matches."}
                        </p>
                      )}
                    </PickerDropdown>
                  )}
                </>
              )}
            </div>
          </Section>

          {/* Memory Recall — roleplay/game modes: show after Function Calling */}
          {!isConversation && !isLiteBuild && (
            <Section
              label="Memory Recall"
              icon={<Brain size="0.875rem" />}
              help="When enabled, relevant fragments from this chat are recalled with provider embeddings when configured, otherwise local lexical matching, then injected into the prompt as memories."
            >
              {renderMemoryRecallControls(metadata.sceneStatus === "active")}
            </Section>
          )}

          {/* Translation */}
          <Section
            label="Translation"
            icon={<Languages size="0.875rem" />}
            help="Configure translation for this chat here, including provider, target language, and automatic response translation for Game mode."
          >
            <div className="space-y-3">
              {/* Provider */}
              <div>
                <label className="text-[0.6875rem] font-medium text-[var(--muted-foreground)]">Provider</label>
                <select
                  value={translationProvider}
                  onChange={(e) => updateMeta.mutate({ id: chat.id, translationProvider: e.target.value })}
                  className="mt-0.5 w-full rounded-lg bg-[var(--secondary)] px-3 py-2 text-xs outline-none ring-1 ring-transparent transition-shadow focus:ring-[var(--primary)]/40"
                >
                  <option value="google">Google Translate</option>
                  <option value="deepl">DeepL API</option>
                  <option value="deeplx">DeepLX (self-hosted)</option>
                  <option value="ai">AI (via connection)</option>
                </select>
              </div>

              {/* Target Language */}
              <div>
                <label className="text-[0.6875rem] font-medium text-[var(--muted-foreground)]">
                  Target Language
                  <HelpTooltip
                    text={
                      translationProvider === "ai"
                        ? "Language name (e.g. English, Japanese, Spanish)"
                        : "Language code (e.g. en, ja, es, de, fr, zh, ko)"
                    }
                    size="0.625rem"
                  />
                </label>
                <input
                  type="text"
                  value={translationTargetLang}
                  onChange={(e) => updateMeta.mutate({ id: chat.id, translationTargetLang: e.target.value })}
                  placeholder={translationProvider === "ai" ? "English" : "en"}
                  className="mt-0.5 w-full rounded-lg bg-[var(--secondary)] px-3 py-2 text-xs outline-none ring-1 ring-transparent transition-shadow focus:ring-[var(--primary)]/40"
                />
              </div>

              {/* AI-specific: connection selector */}
              {translationProvider === "ai" && (
                <div>
                  <label className="text-[0.6875rem] font-medium text-[var(--muted-foreground)]">
                    Connection
                    <HelpTooltip text="Which AI connection to use for translation" size="0.625rem" />
                  </label>
                  <select
                    value={translationConnectionId}
                    onChange={(e) =>
                      updateMeta.mutate({ id: chat.id, translationConnectionId: e.target.value || undefined })
                    }
                    className="mt-0.5 w-full rounded-lg bg-[var(--secondary)] px-3 py-2 text-xs outline-none ring-1 ring-transparent transition-shadow focus:ring-[var(--primary)]/40"
                  >
                    <option value="">Select connection…</option>
                    {textConnectionsList.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* DeepL API key */}
              {translationProvider === "deepl" && (
                <div>
                  <label className="text-[0.6875rem] font-medium text-[var(--muted-foreground)]">DeepL API Key</label>
                  <input
                    type="password"
                    value={translationDeeplApiKey}
                    onChange={(e) => updateMeta.mutate({ id: chat.id, translationDeeplApiKey: e.target.value })}
                    placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx:fx"
                    className="mt-0.5 w-full rounded-lg bg-[var(--secondary)] px-3 py-2 text-xs outline-none ring-1 ring-transparent transition-shadow focus:ring-[var(--primary)]/40"
                  />
                </div>
              )}

              {/* DeepLX URL */}
              {translationProvider === "deeplx" && (
                <div>
                  <label className="text-[0.6875rem] font-medium text-[var(--muted-foreground)]">
                    DeepLX URL
                    <HelpTooltip
                      text="URL of your self-hosted DeepLX instance (e.g. http://localhost:1188)"
                      size="0.625rem"
                    />
                  </label>
                  <input
                    type="text"
                    value={translationDeeplxUrl}
                    onChange={(e) => updateMeta.mutate({ id: chat.id, translationDeeplxUrl: e.target.value })}
                    placeholder="http://localhost:1188"
                    className="mt-0.5 w-full rounded-lg bg-[var(--secondary)] px-3 py-2 text-xs outline-none ring-1 ring-transparent transition-shadow focus:ring-[var(--primary)]/40"
                  />
                </div>
              )}

              {/* Auto-translate toggle */}
              <button
                onClick={() => {
                  updateMeta.mutate({ id: chat.id, autoTranslate: !autoTranslateEnabled });
                }}
                className={cn(
                  "flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left transition-all",
                  autoTranslateEnabled
                    ? "bg-[var(--primary)]/10 ring-1 ring-[var(--primary)]/30"
                    : "bg-[var(--secondary)] hover:bg-[var(--accent)]",
                )}
              >
                <div className="flex-1 min-w-0">
                  <span className="text-[0.6875rem] font-medium">Auto-Translate Responses</span>
                  <p className="text-[0.625rem] text-[var(--muted-foreground)]">
                    Automatically translate AI responses after generation.
                  </p>
                </div>
                <div
                  className={cn(
                    "h-5 w-9 shrink-0 rounded-full p-0.5 transition-colors",
                    autoTranslateEnabled ? "bg-[var(--primary)]" : "bg-[var(--muted-foreground)]/50",
                  )}
                >
                  <div
                    className={cn(
                      "h-4 w-4 rounded-full bg-white shadow-sm transition-transform",
                      autoTranslateEnabled && "translate-x-3.5",
                    )}
                  />
                </div>
              </button>

              {/* Translate input toggle */}
              <button
                onClick={() => {
                  updateMeta.mutate({ id: chat.id, translateInput: !translateInputEnabled });
                }}
                className={cn(
                  "flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left transition-all",
                  translateInputEnabled
                    ? "bg-[var(--primary)]/10 ring-1 ring-[var(--primary)]/30"
                    : "bg-[var(--secondary)] hover:bg-[var(--accent)]",
                )}
              >
                <div className="flex-1 min-w-0">
                  <span className="text-[0.6875rem] font-medium">Translate My Messages</span>
                  <p className="text-[0.625rem] text-[var(--muted-foreground)]">
                    Translate your messages to the target language before sending.
                  </p>
                </div>
                <div
                  className={cn(
                    "h-5 w-9 shrink-0 rounded-full p-0.5 transition-colors",
                    translateInputEnabled ? "bg-[var(--primary)]" : "bg-[var(--muted-foreground)]/50",
                  )}
                >
                  <div
                    className={cn(
                      "h-4 w-4 rounded-full bg-white shadow-sm transition-transform",
                      translateInputEnabled && "translate-x-3.5",
                    )}
                  />
                </div>
              </button>

              {/* Draft translate button toggle */}
              <button
                onClick={() => {
                  updateMeta.mutate({ id: chat.id, showInputTranslateButton: !inputTranslateButtonVisible });
                }}
                className={cn(
                  "flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left transition-all",
                  inputTranslateButtonVisible
                    ? "bg-[var(--primary)]/10 ring-1 ring-[var(--primary)]/30"
                    : "bg-[var(--secondary)] hover:bg-[var(--accent)]",
                )}
              >
                <div className="flex-1 min-w-0">
                  <span className="text-[0.6875rem] font-medium">Show Draft Translate Button</span>
                  <p className="text-[0.625rem] text-[var(--muted-foreground)]">
                    Add a translate button beside Send so you can translate and edit your message before sending it.
                  </p>
                </div>
                <div
                  className={cn(
                    "h-5 w-9 shrink-0 rounded-full p-0.5 transition-colors",
                    inputTranslateButtonVisible ? "bg-[var(--primary)]" : "bg-[var(--muted-foreground)]/50",
                  )}
                >
                  <div
                    className={cn(
                      "h-4 w-4 rounded-full bg-white shadow-sm transition-transform",
                      inputTranslateButtonVisible && "translate-x-3.5",
                    )}
                  />
                </div>
              </button>
            </div>
          </Section>

          {/* Advanced Parameters */}
          <AdvancedParametersSection
            chat={chat}
            metadata={metadata}
            updateMeta={updateMeta}
            isConversation={isConversation}
            connectionId={chat.connectionId ?? null}
            connections={connections ?? []}
            promptPresetParameters={advancedPromptPresetFull?.preset?.parameters ?? null}
            inheritedGenerationParametersPending={inheritedGenerationParametersPending}
          />

          {/* Context Message Limit */}
          <Section
            label="Context Limit"
            icon={<MessageSquare size="0.875rem" />}
            help="Limit how many messages are included in the context sent to the AI model. When off, all messages are sent (up to the model's context window). When on, only the last N messages are included."
          >
            <div className="space-y-2">
              <button
                onClick={() => {
                  if (hasContextMessageLimit) {
                    updateMeta.mutate({ id: chat.id, contextMessageLimit: null });
                  } else {
                    updateMeta.mutate({ id: chat.id, contextMessageLimit: 50 });
                  }
                }}
                className={cn(
                  "flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left transition-all",
                  hasContextMessageLimit
                    ? "bg-[var(--primary)]/10 ring-1 ring-[var(--primary)]/30"
                    : "bg-[var(--secondary)] hover:bg-[var(--accent)]",
                )}
              >
                <div>
                  <span className="text-xs font-medium">Limit Context Messages</span>
                  <p className="text-[0.625rem] text-[var(--muted-foreground)]">
                    Only send the last N messages to the model
                  </p>
                </div>
                <div
                  className={cn(
                    "h-5 w-9 overflow-hidden rounded-full p-0.5 transition-colors",
                    hasContextMessageLimit ? "bg-[var(--primary)]" : "bg-[var(--muted-foreground)]/50",
                  )}
                >
                  <div
                    className={cn(
                      "h-4 w-4 rounded-full bg-white shadow-sm transition-transform",
                      hasContextMessageLimit && "translate-x-3.5",
                    )}
                  />
                </div>
              </button>
              {hasContextMessageLimit && (
                <div className="flex items-center gap-2 px-1">
                  <input
                    type="number"
                    min={1}
                    max={9999}
                    value={contextMessageLimit}
                    onChange={(e) => {
                      const val = parseInt(e.target.value, 10);
                      if (val > 0) {
                        updateMeta.mutate({ id: chat.id, contextMessageLimit: val });
                      }
                    }}
                    className="w-20 rounded-lg bg-[var(--secondary)] px-3 py-1.5 text-xs outline-none ring-1 ring-transparent transition-shadow focus:ring-[var(--primary)]/40"
                  />
                  <span className="text-[0.625rem] text-[var(--muted-foreground)]">messages</span>
                </div>
              )}
              <button
                onClick={() => {
                  const enabled = metadata.excludePastReasoning !== false;
                  updateMeta.mutate({ id: chat.id, excludePastReasoning: !enabled });
                }}
                className={cn(
                  "flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left transition-all",
                  metadata.excludePastReasoning !== false
                    ? "bg-[var(--primary)]/10 ring-1 ring-[var(--primary)]/30"
                    : "bg-[var(--secondary)] hover:bg-[var(--accent)]",
                )}
              >
                <div>
                  <span className="text-xs font-medium">Exclude Past Reasoning</span>
                  <p className="text-[0.625rem] text-[var(--muted-foreground)]">
                    Keep stored thinking/reasoning metadata out of future prompts.
                  </p>
                </div>
                <div
                  className={cn(
                    "h-5 w-9 overflow-hidden rounded-full p-0.5 transition-colors",
                    metadata.excludePastReasoning !== false ? "bg-[var(--primary)]" : "bg-[var(--muted-foreground)]/50",
                  )}
                >
                  <div
                    className={cn(
                      "h-4 w-4 rounded-full bg-white shadow-sm transition-transform",
                      metadata.excludePastReasoning !== false && "translate-x-3.5",
                    )}
                  />
                </div>
              </button>
            </div>
          </Section>

          {/* Impersonate (global settings applied to /impersonate generations) */}
          <Section
            label="Impersonate"
            icon={<Drama size="0.875rem" />}
            help="Global settings applied to every /impersonate generation across all chats."
          >
            <ImpersonateSettingsContent
              presets={(presets ?? []) as Array<{ id: string; name: string }>}
              connections={textConnectionsList}
            />
          </Section>
        </div>
      </div>

      {/* Choice selection modal for preset variables */}
      <ChoiceSelectionModal
        open={!!choiceModalPresetId}
        onClose={() => setChoiceModalPresetId(null)}
        presetId={choiceModalPresetId}
        chatId={chat.id}
        existingChoices={presetChoices}
      />

      {/* Automatic summarization editor */}
      <SummariesEditorModal chat={chat} open={showSummariesModal} onClose={() => setShowSummariesModal(false)} />

      {/* Memory recall chunk viewer */}
      <MemoryRecallMemoriesModal
        chatId={chat.id}
        open={showMemoriesModal}
        onClose={() => setShowMemoriesModal(false)}
      />

      <Modal
        open={!!agentAddPreview}
        onClose={() => {
          if (!savingAgentSettings) setAgentAddPreview(null);
        }}
        title={
          agentAddPreview
            ? agentAddPreview.mode === "add"
              ? `Add ${agentAddPreview.agent.name}`
              : `${agentAddPreview.agent.name} Settings`
            : "Agent Settings"
        }
        width="max-w-lg"
      >
        {agentAddPreview && (
          <div className="space-y-4">
            <div className="rounded-xl bg-[var(--secondary)]/80 px-4 py-3 ring-1 ring-[var(--border)]">
              <div className="flex items-start gap-3">
                <Sparkles size="1rem" className="mt-0.5 shrink-0 text-[var(--primary)]" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold text-[var(--foreground)]">{agentAddPreview.agent.name}</p>
                    <span className="rounded-full bg-[var(--accent)] px-2 py-0.5 text-[0.5625rem] uppercase tracking-wide text-[var(--muted-foreground)]">
                      {agentAddPreview.agent.builtIn ? agentAddPreview.agent.category : "custom"}
                    </span>
                  </div>
                  <p className="mt-2 whitespace-pre-wrap text-xs leading-5 text-[var(--muted-foreground)]">
                    {agentAddPreview.agent.description || "No description available."}
                  </p>
                </div>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="block text-[0.6875rem] font-semibold text-[var(--foreground)]">Agent Budget</label>
              <div className="grid gap-3 sm:grid-cols-2">
                {agentAddPreview.agent.id !== "chat-summary" ? (
                  <div>
                    <label className="mb-1 block text-[0.625rem] font-medium text-[var(--muted-foreground)]">
                      Context Size
                    </label>
                    <div className="flex items-center gap-3">
                      <input
                        type="number"
                        min={1}
                        max={200}
                        value={agentAddPreview.contextSize}
                        onChange={(e) => {
                          const value = parseInt(e.target.value, 10);
                          setAgentAddPreview((current) =>
                            current
                              ? {
                                  ...current,
                                  contextSize: Number.isFinite(value)
                                    ? Math.max(1, Math.min(200, value))
                                    : DEFAULT_AGENT_CONTEXT_SIZE,
                                }
                              : current,
                          );
                        }}
                        disabled={savingAgentSettings}
                        className="w-28 rounded-xl bg-[var(--secondary)] px-3 py-2.5 text-sm tabular-nums ring-1 ring-[var(--border)] focus:outline-none focus:ring-2 focus:ring-[var(--ring)] disabled:cursor-not-allowed disabled:opacity-60"
                      />
                      <span className="text-[0.6875rem] text-[var(--muted-foreground)]">messages</span>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-xl bg-[var(--accent)]/50 px-3 py-2.5 text-[0.6875rem] text-[var(--muted-foreground)] ring-1 ring-[var(--border)]">
                    Chat Summary context size is managed in the Chat Summary panel after you add the agent.
                  </div>
                )}
                <div>
                  <label className="mb-1 block text-[0.625rem] font-medium text-[var(--muted-foreground)]">
                    Max Output Tokens
                  </label>
                  <div className="flex items-center gap-3">
                    <input
                      type="number"
                      min={MIN_AGENT_MAX_TOKENS}
                      max={MAX_AGENT_MAX_TOKENS}
                      value={agentAddPreview.maxTokens}
                      onChange={(e) => {
                        const value = parseInt(e.target.value, 10);
                        setAgentAddPreview((current) =>
                          current
                            ? {
                                ...current,
                                maxTokens: normalizeAgentMaxTokensInputValue(
                                  Number.isFinite(value) ? value : undefined,
                                ),
                              }
                            : current,
                        );
                      }}
                      onBlur={() => {
                        setAgentAddPreview((current) =>
                          current ? { ...current, maxTokens: normalizeAgentMaxTokens(current.maxTokens) } : current,
                        );
                      }}
                      disabled={savingAgentSettings}
                      className="w-32 rounded-xl bg-[var(--secondary)] px-3 py-2.5 text-sm tabular-nums ring-1 ring-[var(--border)] focus:outline-none focus:ring-2 focus:ring-[var(--ring)] disabled:cursor-not-allowed disabled:opacity-60"
                    />
                    <span className="text-[0.6875rem] text-[var(--muted-foreground)]">tokens</span>
                  </div>
                </div>
              </div>
              <p className="text-[0.625rem] text-[var(--muted-foreground)]">
                Context size controls recent chat messages. Max output reserves completion room; lower it on small local
                contexts if logs show the prompt budget collapsing.
              </p>
            </div>

            {agentAddIntervalMeta && agentAddPreview.runInterval != null && (
              <div className="space-y-1.5">
                <label className="block text-[0.6875rem] font-semibold text-[var(--foreground)]">
                  {agentAddIntervalMeta.label}
                </label>
                <div className="flex items-center gap-3">
                  {agentAddPreview.agent.builtIn ? (
                    <input
                      type="number"
                      min={1}
                      max={agentAddIntervalMeta.max}
                      value={agentAddPreview.runInterval}
                      onChange={(e) => {
                        setAgentAddPreview((current) =>
                          current
                            ? {
                                ...current,
                                runInterval: parseCadenceInputValue(
                                  e.target.value,
                                  agentAddIntervalMeta.defaultValue,
                                  agentAddIntervalMeta.max,
                                ),
                              }
                            : current,
                        );
                      }}
                      disabled={savingAgentSettings}
                      className="w-28 rounded-xl bg-[var(--secondary)] px-3 py-2.5 text-sm tabular-nums ring-1 ring-[var(--border)] focus:outline-none focus:ring-2 focus:ring-[var(--ring)] disabled:cursor-not-allowed disabled:opacity-60"
                    />
                  ) : (
                    <div className="relative w-28">
                      <input
                        type="text"
                        inputMode="numeric"
                        value={
                          agentAddCadenceInputFocused
                            ? String(agentAddPreview.runInterval)
                            : getCadenceInputValue(agentAddPreview.runInterval)
                        }
                        onFocus={(e) => {
                          setAgentAddCadenceInputFocused(true);
                          e.target.select();
                        }}
                        onBlur={() => setAgentAddCadenceInputFocused(false)}
                        onKeyDown={(e) => {
                          if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
                          e.preventDefault();
                          const delta = e.key === "ArrowUp" ? 1 : -1;
                          setAgentAddPreview((current) =>
                            current
                              ? {
                                  ...current,
                                  runInterval: stepCadenceValue(
                                    current.runInterval ?? 1,
                                    delta,
                                    agentAddIntervalMeta.max,
                                  ),
                                }
                              : current,
                          );
                        }}
                        onChange={(e) => {
                          setAgentAddPreview((current) =>
                            current
                              ? {
                                  ...current,
                                  runInterval: parseCadenceInputValue(
                                    e.target.value,
                                    current.runInterval ?? 1,
                                    agentAddIntervalMeta.max,
                                  ),
                                }
                              : current,
                          );
                        }}
                        disabled={savingAgentSettings}
                        className="w-full rounded-xl bg-[var(--secondary)] px-3 py-2.5 pr-8 text-sm tabular-nums ring-1 ring-[var(--border)] focus:outline-none focus:ring-2 focus:ring-[var(--ring)] disabled:cursor-not-allowed disabled:opacity-60"
                      />
                      <div className="absolute right-1 top-1/2 flex -translate-y-1/2 flex-col overflow-hidden rounded-md">
                        <button
                          type="button"
                          aria-label="Increase trigger cadence"
                          disabled={savingAgentSettings}
                          onClick={() => {
                            setAgentAddPreview((current) =>
                              current
                                ? {
                                    ...current,
                                    runInterval: stepCadenceValue(
                                      current.runInterval ?? 1,
                                      1,
                                      agentAddIntervalMeta.max,
                                    ),
                                  }
                                : current,
                            );
                          }}
                          className="flex h-4 w-5 items-center justify-center text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)] hover:text-[var(--foreground)] disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          <ChevronUp size="0.6875rem" />
                        </button>
                        <button
                          type="button"
                          aria-label="Decrease trigger cadence"
                          disabled={savingAgentSettings}
                          onClick={() => {
                            setAgentAddPreview((current) =>
                              current
                                ? {
                                    ...current,
                                    runInterval: stepCadenceValue(
                                      current.runInterval ?? 1,
                                      -1,
                                      agentAddIntervalMeta.max,
                                    ),
                                  }
                                : current,
                            );
                          }}
                          className="flex h-4 w-5 items-center justify-center text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)] hover:text-[var(--foreground)] disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          <ChevronDown size="0.6875rem" />
                        </button>
                      </div>
                    </div>
                  )}
                  <span className="text-[0.6875rem] text-[var(--muted-foreground)]">{agentAddIntervalMeta.unit}</span>
                </div>
                <p className="text-[0.625rem] text-[var(--muted-foreground)]">{agentAddIntervalMeta.help}</p>
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                onClick={() => setAgentAddPreview(null)}
                disabled={savingAgentSettings}
                className="rounded-lg px-3 py-2 text-xs font-medium text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                onClick={confirmAgentSettings}
                disabled={savingAgentSettings}
                className="rounded-lg bg-[var(--primary)] px-3 py-2 text-xs font-semibold text-[var(--primary-foreground)] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {savingAgentSettings ? "Saving..." : agentAddPreview.mode === "add" ? "Add" : "Update Settings"}
              </button>
            </div>
          </div>
        )}
      </Modal>

      {profilePopoverCharacter &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            className="fixed inset-0 z-[90] flex items-start justify-end bg-transparent px-3 pt-16 max-sm:justify-center max-sm:px-2 max-sm:pt-14"
            onClick={() => setProfilePopoverCharacterId(null)}
          >
            <div
              data-profile-popover
              className="max-h-[calc(100vh-4.5rem)] w-[min(20rem,calc(100vw-1rem))] overflow-y-auto"
              onClick={(event) => event.stopPropagation()}
            >
              <CharacterPublicProfileCard
                profile={resolveCharacterPublicProfile({
                  data: profilePopoverCharacter.data as Record<string, unknown>,
                  comment: profilePopoverCharacter.comment,
                })}
                avatarUrl={profilePopoverCharacter.avatarPath}
                compact
                onOpenFullProfile={() => openCharacterDetailFromProfile(profilePopoverCharacter.id)}
              />
            </div>
          </div>,
          document.body,
        )}

      {/* First message confirmation dialog */}
      {firstMesConfirm && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 max-md:pt-[env(safe-area-inset-top)]"
          onClick={() => setFirstMesConfirm(null)}
        >
          <div
            className="relative mx-4 flex w-full max-w-sm flex-col rounded-xl bg-[var(--card)] shadow-2xl ring-1 ring-[var(--border)]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 border-b border-[var(--border)] px-4 py-3">
              <MessageCircle size="0.875rem" className="text-[var(--muted-foreground)]" />
              <span className="text-sm font-semibold text-[var(--foreground)]">First Message</span>
            </div>
            <div className="px-4 py-3">
              <p className="text-sm text-[var(--foreground)]">
                Add <strong>{firstMesConfirm.charName}</strong>'s first message to the chat?
              </p>
              <p className="mt-2 max-h-32 overflow-y-auto rounded-lg bg-[var(--accent)]/50 px-3 py-2 text-xs leading-relaxed text-[var(--muted-foreground)]">
                {firstMesConfirm.message.length > 300
                  ? firstMesConfirm.message.slice(0, 300) + "\u2026"
                  : firstMesConfirm.message}
              </p>
            </div>
            <div className="flex justify-end gap-2 border-t border-[var(--border)] px-4 py-3">
              <button
                onClick={() => setFirstMesConfirm(null)}
                className="rounded-lg px-3 py-1.5 text-xs font-medium text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)]"
              >
                Skip
              </button>
              <button
                onClick={handleFirstMesConfirm}
                className="rounded-lg bg-[var(--primary)] px-3 py-1.5 text-xs font-medium text-[var(--primary-foreground)] transition-colors hover:opacity-90"
              >
                Add Message
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
