import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  Check,
  ChevronUp,
  CircleUser,
  FileText,
  Link,
  Loader2,
  Plus,
  Send,
  Sparkles,
  X,
} from "lucide-react";
import {
  DEKI_CHAT_ACCESS_MAX_MESSAGE_COUNT,
  type DekiActionEntity,
  type DekiAttachment,
  type DekiChatAccessGrant,
  type DekiChatAccessMode,
  type DekiChatAccessScope,
  type DekiChatAccessWindow,
  type DekiEntryAction,
  type DekiMessage,
  type DekiWebResearchGrant,
} from "../../../../engine/deki/deki-entry";
import {
  EMPTY_DEKI_COMPACTION,
  DEKI_CHAT_ID,
  isDekiResetCommand,
  type DekiCompactionState,
} from "../../../../engine/deki/deki-history";
import { llmApi } from "../../../../shared/api/llm-api";
import { dekiApi, type DekiPreferences } from "../../../../shared/api/deki-api";
import { useConnections } from "../../../catalog/connections/index";
import { PersonaAvatarImage, usePersonaSummaries } from "../../../catalog/personas/index";
import { ConversationMessage } from "../../../modes/conversation/message-shell";
import type { CharacterMap, PersonaInfo } from "../../../modes/shared/chat-ui/types";
import type { Message } from "../../../../engine/contracts/types/chat";
import { filterLanguageGenerationConnections } from "../../../../shared/lib/connection-filters";
import { isSendShortcut } from "../../../../shared/lib/send-shortcuts";
import { toUserMessage } from "../../../../shared/lib/error-message";
import { cn, normalizeAvatarCropValue } from "../../../../shared/lib/utils";
import { useUIStore } from "../../../../shared/stores/ui.store";
import { runDetachedDekiSend } from "../lib/deki-send";
import { DEKI_SCENE_POSES, getDekiSceneMood, type DekiSceneMood } from "../lib/deki-scene";
import { createDekiActionDiffRows, type DekiActionDiffPart, type DekiActionDiffRow } from "../lib/deki-action-diff";

const DEKI_AVATAR_URL = "/koi-mark.svg";
const DEKI_CHARACTER_ID = "__deki_shell__";
const DEKI_WELCOME_CONTENT =
  "Howdy, welcome to De-Koi!\n\nThe pond is calm, and I'm Deki-senpai. Feeling a little lost? It's not a skill issue yet! Ask me anything about how the app works, or have me edit it to fit what you need. Am I not the best? 😎";
const DEKI_CONNECTION_SETUP_CONTENT =
  "Oh, whoops! Looks like you're trying to talk to Deki-senpai without having a model connection set up yet. I'm afraid I need the sweet GPU juice to run. Let me take you to the Connections tab first…";
const DEKI_NO_CONNECTION_SELECTED_ERROR =
  'No connection set for Deki-senpai! Click the "chains" icon in the input box to select one.';
const DEKI_INPUT_PLACEHOLDER = "Message Deki-senpai";
const DEKI_ATTACHMENT_CLIENT_TEXT_BYTES = 64 * 1024;
const DEKI_IMAGE_ATTACHMENT_EXTENSIONS = new Set(["avif", "gif", "jpeg", "jpg", "png", "webp"]);
const DEKI_ACTION_ENTITY_LABELS: Record<DekiActionEntity, string> = {
  characters: "character",
  "character-groups": "character group",
  personas: "persona",
  "persona-groups": "persona group",
  lorebooks: "lorebook",
  "lorebook-entries": "lorebook entry",
  prompts: "prompt preset",
  "prompt-sections": "prompt section",
  "prompt-groups": "prompt group",
  "prompt-variables": "prompt variable",
};
const DEKI_ACTION_QUERY_KEYS: Record<DekiActionEntity, readonly (readonly unknown[])[]> = {
  characters: [["characters"]],
  "character-groups": [["character-groups"], ["characters"]],
  personas: [["personas"]],
  "persona-groups": [["persona-groups"], ["personas"]],
  lorebooks: [["lorebooks"]],
  "lorebook-entries": [["lorebooks"]],
  prompts: [["presets"]],
  "prompt-sections": [["presets"]],
  "prompt-groups": [["presets"]],
  "prompt-variables": [["presets"]],
};
const DEKI_CREATIVE_LIBRARY_QUERY_KEYS: readonly (readonly unknown[])[] = [
  ["characters"],
  ["character-groups"],
  ["personas"],
  ["persona-groups"],
  ["lorebooks"],
  ["presets"],
];

type ClientDekiAttachment = DekiAttachment & { id: string };
type DekiChatAccessRequestAction = Extract<DekiEntryAction, { type: "request_chat_access" }>;
type DekiWebResearchDecision = { type: "web_research_decision"; approve: boolean };
type DekiChatAccessScopeOption = {
  id: string;
  label: string;
  scope: DekiChatAccessScope;
};
type DekiChatAccessWindowOption = {
  id: string;
  label: string;
  window: DekiChatAccessWindow;
};

type DekiConnection = {
  id: string;
  name?: string;
  provider?: string;
  model?: string | null;
  maxContext?: unknown;
};

type DekiPersona = {
  id: string;
  name: string;
  avatarPath?: string | null;
  avatarFilePath?: string | null;
  avatarFilename?: string | null;
  avatarCrop?: unknown;
  comment?: string | null;
  description?: string | null;
  personality?: string | null;
  scenario?: string | null;
  backstory?: string | null;
  appearance?: string | null;
};

type DekiActionCurrentRecordState = {
  status: "idle" | "loading" | "loaded" | "error";
  record: Record<string, unknown> | null;
  error: string | null;
};

function newId(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function dekiSessionRunKey(sessionId: string | null | undefined) {
  return sessionId ?? "__active-deki-session__";
}

function isDekiImageFile(file: File) {
  if (file.type.startsWith("image/")) return true;
  const extension = file.name.includes(".") ? file.name.split(".").pop()?.toLowerCase() : null;
  return !!extension && DEKI_IMAGE_ATTACHMENT_EXTENSIONS.has(extension);
}

function formatDaySeparator(value: string) {
  const date = new Date(value);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const messageDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diffDays = Math.floor((today.getTime() - messageDay.getTime()) / 86400000);
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  return date.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" });
}

function getDayKey(value: string) {
  const date = new Date(value);
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function toConversationMessage(message: DekiMessage): Message {
  return {
    id: message.id,
    chatId: DEKI_CHAT_ID,
    role: message.role,
    characterId: message.role === "assistant" ? DEKI_CHARACTER_ID : null,
    content: message.content,
    activeSwipeIndex: 0,
    swipeCount: 1,
    createdAt: message.createdAt,
    extra: {
      displayText: null,
      isGenerated: message.role === "assistant",
      tokenCount: null,
      generationInfo: null,
    },
  };
}

function actionPayload(action: DekiEntryAction): Record<string, unknown> {
  if (action.type === "create_record") return action.draft;
  if (action.type === "edit_record") return action.patch;
  if (action.type === "apply_lorebook_redraft") return { lorebook: action.lorebook, entries: action.entries };
  return {};
}

function actionTitle(action: DekiEntryAction) {
  if (action.type === "none") return "Deki-senpai action";
  if (action.type === "request_chat_access") return action.label?.trim() || "Grant Deki chat access";
  if (action.type === "request_web_research") return action.label?.trim() || "Search the web";
  if (action.label?.trim()) return action.label.trim();
  if (action.type === "apply_lorebook_redraft") return "Apply lorebook redraft";
  const verb = action.type === "create_record" ? "Create" : "Update";
  return `${verb} ${DEKI_ACTION_ENTITY_LABELS[action.entity]}`;
}

function chatModeLabel(mode: DekiChatAccessMode): string {
  if (mode === "conversation") return "conversation";
  if (mode === "roleplay") return "roleplay";
  return "game";
}

function chatAccessScopeLabel(scope: DekiChatAccessScope): string {
  if (scope.type === "specific_chats") {
    const count = scope.chatIds.filter((id) => id.trim()).length;
    return `${count} selected chat${count === 1 ? "" : "s"}`;
  }
  if (scope.type === "character" || scope.type === "latest_character") {
    const prefix = scope.type === "latest_character" ? "Latest chat involving" : "Chats involving";
    return `${prefix} ${scope.characterName?.trim() || scope.characterId?.trim() || "selected character"}`;
  }
  return `${scope.modes.map(chatModeLabel).join(", ")} chats`;
}

function normalizeDekiChatAccessWindow(window: DekiChatAccessWindow | null | undefined): DekiChatAccessWindow {
  const messageCount = window?.messageCount;
  if (messageCount === null) return { messageCount: DEKI_CHAT_ACCESS_MAX_MESSAGE_COUNT };
  if (typeof messageCount === "number" && Number.isFinite(messageCount)) {
    return { messageCount: Math.max(1, Math.min(DEKI_CHAT_ACCESS_MAX_MESSAGE_COUNT, Math.floor(messageCount))) };
  }
  return { messageCount: 50 };
}

function normalizeDekiChatAccessRequestAction(action: DekiChatAccessRequestAction): DekiChatAccessRequestAction {
  return {
    ...action,
    window: normalizeDekiChatAccessWindow(action.window),
  };
}

function normalizeDekiChatAccessMessage(message: DekiMessage): DekiMessage {
  if (message.action?.type !== "request_chat_access") return message;
  return {
    ...message,
    action: normalizeDekiChatAccessRequestAction(message.action),
  };
}

function chatAccessWindowLabel(action: DekiChatAccessRequestAction): string {
  const messageCount = normalizeDekiChatAccessWindow(action.window).messageCount;
  if (typeof messageCount === "number" && Number.isFinite(messageCount)) {
    return `Up to ${Math.max(1, Math.floor(messageCount))} recent messages per chat`;
  }
  return "Up to 50 recent messages per chat";
}

function createDekiChatAccessGrant(message: DekiMessage, action: DekiChatAccessRequestAction): DekiChatAccessGrant {
  return {
    id: `chat-grant-${message.id}`,
    actionMessageId: message.id,
    scope: action.scope,
    window: normalizeDekiChatAccessWindow(action.window),
    grantedAt: new Date().toISOString(),
    expiresAt: null,
  };
}

function createDekiWebResearchGrant(
  message: DekiMessage,
  action: Extract<DekiEntryAction, { type: "request_web_research" }>,
): DekiWebResearchGrant {
  const grantedAt = new Date().toISOString();
  return {
    id: newId("deki-web-research-grant"),
    actionMessageId: message.id,
    scope: action.scope,
    grantedAt,
    expiresAt: null,
  };
}

function characterScopeParts(
  scope: DekiChatAccessScope,
): { characterId?: string | null; characterName?: string | null } | null {
  if (scope.type !== "character" && scope.type !== "latest_character") return null;
  if (!scope.characterId && !scope.characterName) return null;
  return {
    characterId: scope.characterId ?? null,
    characterName: scope.characterName ?? null,
  };
}

function scopeOptionKey(scope: DekiChatAccessScope): string {
  if (scope.type === "specific_chats") return `specific:${scope.chatIds.join(",")}`;
  if (scope.type === "character" || scope.type === "latest_character") {
    return `${scope.type}:${scope.characterId ?? ""}:${scope.characterName ?? ""}`;
  }
  return `mode:${scope.modes.join(",")}`;
}

function mergeSuggestedChatAccessOption<TOption>(
  suggestedOption: TOption,
  fixedOptions: TOption[],
  optionKey: (option: TOption) => string,
): TOption[] {
  const suggestedKey = optionKey(suggestedOption);
  const matchingFixedOptionIndex = fixedOptions.findIndex((option) => optionKey(option) === suggestedKey);
  if (matchingFixedOptionIndex === -1) return [suggestedOption, ...fixedOptions];
  return fixedOptions.map((option, index) => (index === matchingFixedOptionIndex ? suggestedOption : option));
}

function chatAccessScopeOptions(action: DekiChatAccessRequestAction): DekiChatAccessScopeOption[] {
  const suggestedOption: DekiChatAccessScopeOption = {
    id: "suggested",
    label: `Deki's suggestion: ${chatAccessScopeLabel(action.scope)}`,
    scope: action.scope,
  };
  const fixedOptions: DekiChatAccessScopeOption[] = [];
  const character = characterScopeParts(action.scope);
  if (character) {
    fixedOptions.push(
      {
        id: "all-character",
        label: `All chats featuring ${character.characterName || character.characterId || "character"}`,
        scope: {
          type: "character",
          ...character,
        },
      },
      {
        id: "latest-character",
        label: `Latest chat with ${character.characterName || character.characterId || "character"}`,
        scope: {
          type: "latest_character",
          ...character,
        },
      },
    );
  }
  return mergeSuggestedChatAccessOption(suggestedOption, fixedOptions, (option) => scopeOptionKey(option.scope));
}

function windowOptionKey(window: DekiChatAccessWindow): string {
  return String(normalizeDekiChatAccessWindow(window).messageCount);
}

function chatAccessWindowOptions(action: DekiChatAccessRequestAction): DekiChatAccessWindowOption[] {
  const suggestedWindow = normalizeDekiChatAccessWindow(action.window);
  const suggestedOption: DekiChatAccessWindowOption = {
    id: "suggested",
    label: `Deki's suggestion: ${chatAccessWindowLabel({ ...action, window: suggestedWindow })}`,
    window: suggestedWindow,
  };
  const fixedOptions: DekiChatAccessWindowOption[] = [
    { id: "10", label: "10 recent messages per chat", window: { messageCount: 10 } },
    { id: "25", label: "25 recent messages per chat", window: { messageCount: 25 } },
    { id: "50", label: "50 recent messages per chat", window: { messageCount: 50 } },
    { id: "100", label: "100 recent messages per chat", window: { messageCount: 100 } },
    {
      id: "max",
      label: `${DEKI_CHAT_ACCESS_MAX_MESSAGE_COUNT} recent messages per chat`,
      window: { messageCount: DEKI_CHAT_ACCESS_MAX_MESSAGE_COUNT },
    },
  ];
  return mergeSuggestedChatAccessOption(suggestedOption, fixedOptions, (option) => windowOptionKey(option.window));
}

function defaultChatAccessOptionId(options: Array<{ id: string }>): string {
  return options.find((option) => option.id === "suggested")?.id ?? options[0]?.id ?? "suggested";
}

function approvedDekiChatAccessGrants(messages: DekiMessage[]): DekiChatAccessGrant[] {
  return messages.flatMap((message) => {
    const action = message.action;
    const application = message.actionApplication;
    if (!action || action.type !== "request_chat_access" || application?.status !== "applied") return [];
    const normalizedAction = normalizeDekiChatAccessRequestAction(action);
    return [
      {
        id: application.resultId ?? `chat-grant-${message.id}`,
        actionMessageId: message.id,
        scope: normalizedAction.scope,
        window: normalizeDekiChatAccessWindow(normalizedAction.window),
        grantedAt: application.appliedAt,
        expiresAt: null,
      },
    ];
  });
}

function dekiChatAccessResumePrompt(originalUserMessage: string): string {
  return [
    "The user approved the requested scoped chat access.",
    "Resume the original task now using the approved chat context.",
    "Do not greet the user, ask what to work on, or repeat the access request.",
    "Original user request:",
    originalUserMessage,
  ].join("\n");
}

function previewValue(value: unknown): string | null {
  if (typeof value === "string") return value.trim() || null;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    const text = value
      .filter(
        (item): item is string | number | boolean =>
          typeof item === "string" || typeof item === "number" || typeof item === "boolean",
      )
      .slice(0, 4)
      .join(", ");
    return text || null;
  }
  return null;
}

function actionPreviewRows(action: DekiEntryAction): Array<{ label: string; value: string }> {
  if (action.type === "none" || action.type === "request_chat_access") return [];
  if (action.type === "request_web_research") {
    const fields: Array<[string, unknown]> = [
      ["Query", action.scope.query],
      ["Sources", action.sources],
      ["Domains", action.scope.allowedDomains],
    ];
    return fields
      .map(([label, value]) => ({ label, value: previewValue(value) }))
      .filter((row): row is { label: string; value: string } => !!row.value)
      .slice(0, 4);
  }
  if (action.type === "apply_lorebook_redraft") {
    const fields: Array<[string, unknown]> = [
      ["Name", action.lorebook.name],
      ["Description", action.lorebook.description],
      ["Entries", action.entries.length],
      ["Record", action.id],
    ];
    return fields
      .map(([label, value]) => ({ label, value: previewValue(value) }))
      .filter((row): row is { label: string; value: string } => !!row.value)
      .slice(0, 4);
  }
  const payload = actionPayload(action);
  const nestedData =
    payload.data && typeof payload.data === "object" && !Array.isArray(payload.data)
      ? (payload.data as Record<string, unknown>)
      : null;
  const fields: Array<[string, unknown]> = [
    ["Name", payload.name ?? nestedData?.name],
    ["Description", payload.description ?? nestedData?.description],
    ["Preset", payload.presetId],
    ["Lorebook", payload.lorebookId],
    ["Content", payload.content ?? nestedData?.personality ?? nestedData?.scenario],
    ["Tags", payload.tags ?? nestedData?.tags],
  ];
  if (action.type === "edit_record") fields.unshift(["Record", action.id]);
  return fields
    .map(([label, value]) => ({ label, value: previewValue(value) }))
    .filter((row): row is { label: string; value: string } => !!row.value)
    .slice(0, 4);
}

function stableJsonKey(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function dekiActionPreviewKey(
  messageId: string | null | undefined,
  action: DekiEntryAction | null | undefined,
): string {
  if (!action) return `${messageId ?? "no-message"}:no-action`;
  if (action.type === "edit_record") {
    return [messageId ?? "no-message", action.type, action.entity, action.id, stableJsonKey(action.patch)].join(":");
  }
  if (action.type === "create_record") {
    return [messageId ?? "no-message", action.type, action.entity, stableJsonKey(action.draft)].join(":");
  }
  return [messageId ?? "no-message", action.type].join(":");
}

function uniqueQueryKeys(queryKeys: readonly (readonly unknown[])[]): readonly (readonly unknown[])[] {
  const seen = new Set<string>();
  return queryKeys.filter((queryKey) => {
    const key = JSON.stringify(queryKey);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function invalidateDekiActionQueries(queryClient: QueryClient, action: DekiEntryAction) {
  if (action.type === "none" || action.type === "request_chat_access" || action.type === "request_web_research") return;
  const actionQueryKeys =
    action.type === "apply_lorebook_redraft" ? DEKI_ACTION_QUERY_KEYS.lorebooks : DEKI_ACTION_QUERY_KEYS[action.entity];
  await Promise.all(
    uniqueQueryKeys([...DEKI_CREATIVE_LIBRARY_QUERY_KEYS, ...actionQueryKeys]).map((queryKey) =>
      queryClient.invalidateQueries({
        queryKey,
      }),
    ),
  );
}

type DekiSurfaceProps = {
  sessionId: string | null;
  onCreateSession?: () => void | Promise<void>;
  onSessionsChanged?: () => void | Promise<void>;
  onAssistantMessagePersisted?: (assistant: DekiMessage) => void;
};

export function DekiSurface({
  sessionId,
  onCreateSession,
  onSessionsChanged,
  onAssistantMessagePersisted,
}: DekiSurfaceProps) {
  const queryClient = useQueryClient();
  const { data: rawConnections } = useConnections();
  const { data: rawPersonas } = usePersonaSummaries();
  const convoGradient = useUIStore((s) => s.convoGradient);
  const theme = useUIStore((s) => s.theme);
  const openRightPanel = useUIStore((s) => s.openRightPanel);
  const [messages, setMessages] = useState<DekiMessage[]>([]);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [compaction, setCompaction] = useState<DekiCompactionState>(EMPTY_DEKI_COMPACTION);
  const [draft, setDraft] = useState("");
  const [attachments, setAttachments] = useState<ClientDekiAttachment[]>([]);
  const [selectedConnectionId, setSelectedConnectionId] = useState<string | null>(null);
  const [preferencesLoaded, setPreferencesLoaded] = useState(false);
  const [selectedPersonaId, setSelectedPersonaId] = useState<string | null>(null);
  const [connectionMenuOpen, setConnectionMenuOpen] = useState(false);
  const [personaMenuOpen, setPersonaMenuOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [connectionSetupPromptOpen, setConnectionSetupPromptOpen] = useState(false);
  const [sendingSessionKeys, setSendingSessionKeys] = useState<ReadonlySet<string>>(() => new Set());
  const [regeneratingMessageId, setRegeneratingMessageId] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [applyingActionMessageId, setApplyingActionMessageId] = useState<string | null>(null);
  const [actionErrors, setActionErrors] = useState<Record<string, string>>({});
  const [chatAccessGrants, setChatAccessGrants] = useState<DekiChatAccessGrant[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const persistedConnectionIdRef = useRef<DekiPreferences["selectedConnectionId"] | undefined>(undefined);
  const persistedPersonaIdRef = useRef<DekiPreferences["selectedPersonaId"] | undefined>(undefined);
  const mountedRef = useRef(false);
  const sessionIdRef = useRef(sessionId);
  sessionIdRef.current = sessionId;
  const connectionSelectionTouchedRef = useRef(false);
  const personaSelectionTouchedRef = useRef(false);
  const currentSessionRunKey = dekiSessionRunKey(sessionId);
  const sending = sendingSessionKeys.has(currentSessionRunKey);
  const markSessionSending = (targetSessionId: string | null | undefined, active: boolean) => {
    const key = dekiSessionRunKey(targetSessionId);
    setSendingSessionKeys((current) => {
      const next = new Set(current);
      if (active) next.add(key);
      else next.delete(key);
      return next;
    });
  };
  const isVisibleSession = (targetSessionId: string | null | undefined) =>
    mountedRef.current && sessionIdRef.current === (targetSessionId ?? null);
  const preferencesReady = preferencesLoaded;
  const canSend = (draft.trim().length > 0 || attachments.length > 0) && !sending && historyLoaded && preferencesReady;
  const connections = useMemo(
    () =>
      filterLanguageGenerationConnections((rawConnections ?? []) as DekiConnection[]).sort((a, b) =>
        (a.name || a.id).localeCompare(b.name || b.id),
      ),
    [rawConnections],
  );
  const personas = useMemo(
    () => ((rawPersonas ?? []) as DekiPersona[]).slice().sort((a, b) => a.name.localeCompare(b.name)),
    [rawPersonas],
  );
  const selectedConnection = connections.find((connection) => connection.id === selectedConnectionId) ?? null;
  const hasModelConnections = connections.length > 0;
  const selectedPersona = personas.find((persona) => persona.id === selectedPersonaId) ?? null;
  const gradientStyle = useMemo(() => {
    const gradient = convoGradient[theme];
    const isDefaultDark = convoGradient.dark.from === "#0a0a0e" && convoGradient.dark.to === "#1c2133";
    const isDefaultLight = convoGradient.light.from === "#f2eff7" && convoGradient.light.to === "#eae6f0";
    if ((theme === "dark" && isDefaultDark) || (theme === "light" && isDefaultLight)) {
      return { background: "var(--secondary)" };
    }
    return { background: `linear-gradient(135deg, ${gradient.from}, ${gradient.to})` };
  }, [convoGradient, theme]);
  const characterMap: CharacterMap = useMemo(
    () =>
      new Map([
        [
          DEKI_CHARACTER_ID,
          {
            name: "Deki-senpai",
            avatarUrl: DEKI_AVATAR_URL,
            conversationStatus: "online",
          },
        ],
      ]),
    [],
  );
  const personaInfo: PersonaInfo | undefined = useMemo(() => {
    if (!selectedPersona) return undefined;
    return {
      id: selectedPersona.id,
      name: selectedPersona.name,
      description: selectedPersona.description ?? undefined,
      avatarUrl: selectedPersona.avatarPath ?? undefined,
      avatarFilePath: selectedPersona.avatarFilePath ?? null,
      avatarFilename: selectedPersona.avatarFilename ?? null,
      avatarCrop: normalizeAvatarCropValue(selectedPersona.avatarCrop),
    };
  }, [selectedPersona]);
  const welcomeMessage = useMemo<DekiMessage>(
    () => ({
      id: "deki-welcome",
      role: "assistant",
      content: DEKI_WELCOME_CONTENT,
      createdAt: new Date().toISOString(),
    }),
    [],
  );
  const visibleMessages = useMemo(() => {
    if (!historyLoaded) return [];
    return messages.length > 0 ? messages : [welcomeMessage];
  }, [historyLoaded, messages, welcomeMessage]);
  const conversationMessages = useMemo(() => visibleMessages.map(toConversationMessage), [visibleMessages]);
  const dekiSceneMood = getDekiSceneMood({ historyLoaded, sending });

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length, sendError]);

  useEffect(() => {
    let active = true;
    setHistoryLoaded(false);
    setChatAccessGrants([]);
    void dekiApi.history
      .get(sessionId)
      .then((history) => {
        if (!active) return;
        const normalizedMessages = history.messages.map(normalizeDekiChatAccessMessage);
        setMessages(normalizedMessages);
        setCompaction(history.compaction);
        setChatAccessGrants(approvedDekiChatAccessGrants(normalizedMessages));
        setSendError(null);
      })
      .catch((error) => {
        if (!active) return;
        setSendError(toUserMessage(error, "dekiHistoryLoad"));
      })
      .finally(() => {
        if (active) setHistoryLoaded(true);
      });
    return () => {
      active = false;
    };
  }, [sessionId]);

  useEffect(() => {
    let active = true;
    void dekiApi.preferences
      .get()
      .then((preferences) => {
        if (!active) return;
        persistedConnectionIdRef.current = preferences.selectedConnectionId;
        persistedPersonaIdRef.current = preferences.selectedPersonaId;
        if (!connectionSelectionTouchedRef.current) {
          setSelectedConnectionId(preferences.selectedConnectionId);
        }
        if (!personaSelectionTouchedRef.current) {
          setSelectedPersonaId(preferences.selectedPersonaId);
        }
      })
      .catch((error) => {
        if (!active) return;
        persistedConnectionIdRef.current = null;
        persistedPersonaIdRef.current = null;
        setSendError(toUserMessage(error, "dekiPreferencesLoad"));
      })
      .finally(() => {
        if (active) setPreferencesLoaded(true);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (
      !preferencesLoaded ||
      (persistedConnectionIdRef.current === selectedConnectionId && persistedPersonaIdRef.current === selectedPersonaId)
    ) {
      return;
    }
    const nextConnectionId = selectedConnectionId;
    const nextPersonaId = selectedPersonaId;
    persistedConnectionIdRef.current = nextConnectionId;
    persistedPersonaIdRef.current = nextPersonaId;
    void dekiApi.preferences
      .save({ selectedConnectionId: nextConnectionId, selectedPersonaId: nextPersonaId })
      .catch((error) => {
        persistedConnectionIdRef.current = undefined;
        persistedPersonaIdRef.current = undefined;
        setSendError(toUserMessage(error, "dekiPreferencesSave"));
      });
  }, [preferencesLoaded, selectedConnectionId, selectedPersonaId]);

  useEffect(() => {
    if (!preferencesLoaded || rawConnections === undefined || !selectedConnectionId) return;
    if (!connections.some((connection) => connection.id === selectedConnectionId)) {
      setSelectedConnectionId(null);
    }
  }, [connections, preferencesLoaded, rawConnections, selectedConnectionId]);

  useEffect(() => {
    if (!preferencesLoaded || rawPersonas === undefined || !selectedPersonaId) return;
    if (!personas.some((persona) => persona.id === selectedPersonaId)) {
      setSelectedPersonaId(null);
    }
  }, [personas, preferencesLoaded, rawPersonas, selectedPersonaId]);

  useEffect(() => {
    if (hasModelConnections) setConnectionSetupPromptOpen(false);
  }, [hasModelConnections]);

  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.style.height = "0px";
    input.style.height = `${Math.min(input.scrollHeight, 160)}px`;
  }, [draft]);

  const readFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    const nextAttachments = await Promise.all(
      Array.from(files).map(
        (file) =>
          new Promise<ClientDekiAttachment>((resolve, reject) => {
            const finish = (content: string) =>
              resolve({
                id: newId("deki-file"),
                name: file.name,
                type: file.type || "application/octet-stream",
                size: file.size,
                content,
              });
            if (isDekiImageFile(file)) {
              finish("");
              return;
            }
            file
              .slice(0, DEKI_ATTACHMENT_CLIENT_TEXT_BYTES)
              .text()
              .then((content) => {
                if (file.size <= DEKI_ATTACHMENT_CLIENT_TEXT_BYTES) {
                  finish(content);
                  return;
                }
                finish(
                  `${content}\n\n[Attachment truncated in the browser after ${DEKI_ATTACHMENT_CLIENT_TEXT_BYTES} bytes.]`,
                );
              })
              .catch(reject);
          }),
      ),
    );
    setAttachments((current) => [...current, ...nextAttachments]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const preparePrompting = () => {
    if (!hasModelConnections) {
      setConnectionSetupPromptOpen(true);
      setSendError(null);
      setConnectionMenuOpen(false);
      setPersonaMenuOpen(false);
      setMobileMenuOpen(false);
      requestAnimationFrame(() => inputRef.current?.focus());
      return false;
    }
    if (!selectedConnection) {
      setConnectionSetupPromptOpen(false);
      setSendError(DEKI_NO_CONNECTION_SELECTED_ERROR);
      setConnectionMenuOpen(true);
      setPersonaMenuOpen(false);
      setMobileMenuOpen(false);
      requestAnimationFrame(() => inputRef.current?.focus());
      return false;
    }
    return true;
  };

  const selectedPersonaRequest = () =>
    selectedPersona
      ? {
          id: selectedPersona.id,
          name: selectedPersona.name,
          comment: selectedPersona.comment ?? null,
          description: selectedPersona.description ?? null,
          personality: selectedPersona.personality ?? null,
          scenario: selectedPersona.scenario ?? null,
          backstory: selectedPersona.backstory ?? null,
          appearance: selectedPersona.appearance ?? null,
        }
      : null;

  const findUserTurnForRetry = (messageId: string) => {
    const targetIndex = messages.findIndex((message) => message.id === messageId);
    if (targetIndex < 0) return null;
    const target = messages[targetIndex]!;
    if (target.role === "user") {
      return { user: target, retainedMessages: messages.slice(0, targetIndex + 1) };
    }
    for (let index = targetIndex - 1; index >= 0; index -= 1) {
      const candidate = messages[index]!;
      if (candidate.role === "user") {
        return { user: candidate, retainedMessages: messages.slice(0, targetIndex) };
      }
    }
    return null;
  };

  const handleRegenerate = async (messageId: string) => {
    if (sending || !historyLoaded || !preferencesReady) return;
    if (!preparePrompting()) return;
    const retryTurn = findUserTurnForRetry(messageId);
    if (!retryTurn) {
      setSendError("Deki-senpai needs a user message before retrying.");
      return;
    }
    markSessionSending(sessionId, true);
    setRegeneratingMessageId(messageId);
    setSendError(null);
    try {
      const replaced = await dekiApi.history.replaceMessages({
        sessionId,
        messages: retryTurn.retainedMessages,
        compaction,
      });
      setMessages(replaced.messages);
      setCompaction(replaced.compaction);
      void onSessionsChanged?.();
      await runDetachedDekiSend({
        sessionId,
        userMessage: retryTurn.user.content,
        existingUser: retryTurn.user,
        messages: replaced.messages,
        compaction: replaced.compaction,
        connection: selectedConnection!,
        llm: llmApi,
        gateway: dekiApi,
        history: dekiApi.history,
        persona: selectedPersonaRequest(),
        attachments: [],
        chatAccessGrants,
        onUserMessagePersisted: (_user, messagesWithUser) => {
          if (isVisibleSession(sessionId)) setMessages(messagesWithUser);
          void onSessionsChanged?.();
        },
        onCompactionSaved: (nextCompaction) => {
          if (isVisibleSession(sessionId)) setCompaction(nextCompaction);
        },
        onAssistantMessagePersisted: (assistant, messagesWithAssistant) => {
          if (isVisibleSession(sessionId)) setMessages(messagesWithAssistant);
          void onSessionsChanged?.();
          onAssistantMessagePersisted?.(assistant);
        },
      });
    } catch (error) {
      if (mountedRef.current) {
        setSendError(toUserMessage(error, "dekiRetry"));
      }
    } finally {
      if (mountedRef.current) {
        markSessionSending(sessionId, false);
        setRegeneratingMessageId(null);
        requestAnimationFrame(() => inputRef.current?.focus());
      }
    }
  };

  const handleEditMessage = async (messageId: string, content: string) => {
    const updated = await dekiApi.history.updateMessage({ sessionId, messageId, content });
    setMessages((current) => current.map((message) => (message.id === messageId ? updated : message)));
    void onSessionsChanged?.();
  };
  const send = async () => {
    const userMessage = draft.trim() || (attachments.length > 0 ? "[attachments]" : "");
    if (!userMessage || sending || !historyLoaded || !preferencesReady) return;
    if (isDekiResetCommand(userMessage)) {
      setDraft("");
      setAttachments([]);
      setSendError(null);
      markSessionSending(sessionId, true);
      try {
        if (onCreateSession) {
          await onCreateSession();
        } else {
          await dekiApi.history.reset(sessionId);
          await onSessionsChanged?.();
        }
        setMessages([]);
        setCompaction(EMPTY_DEKI_COMPACTION);
      } catch (error) {
        setSendError(toUserMessage(error, "createDekiChat"));
      } finally {
        markSessionSending(sessionId, false);
        requestAnimationFrame(() => inputRef.current?.focus());
      }
      return;
    }
    if (!hasModelConnections) {
      setConnectionSetupPromptOpen(true);
      setSendError(null);
      setConnectionMenuOpen(false);
      setPersonaMenuOpen(false);
      setMobileMenuOpen(false);
      requestAnimationFrame(() => inputRef.current?.focus());
      return;
    }
    if (!selectedConnection) {
      setConnectionSetupPromptOpen(false);
      setSendError(DEKI_NO_CONNECTION_SELECTED_ERROR);
      setConnectionMenuOpen(true);
      setPersonaMenuOpen(false);
      setMobileMenuOpen(false);
      requestAnimationFrame(() => inputRef.current?.focus());
      return;
    }
    const submittedDraft = draft;
    const currentAttachments = attachments;
    setDraft("");
    setAttachments([]);
    setSendError(null);
    markSessionSending(sessionId, true);
    requestAnimationFrame(() => inputRef.current?.focus());
    try {
      await runDetachedDekiSend({
        sessionId,
        userMessage,
        messages,
        compaction,
        connection: selectedConnection,
        llm: llmApi,
        gateway: dekiApi,
        history: dekiApi.history,
        persona: selectedPersonaRequest(),
        attachments: currentAttachments.map((attachment) => ({
          id: attachment.id,
          name: attachment.name,
          type: attachment.type,
          size: attachment.size,
          content: attachment.content,
        })),
        chatAccessGrants,
        onUserMessagePersisted: (_user, messagesWithUser) => {
          if (isVisibleSession(sessionId)) setMessages(messagesWithUser);
          void onSessionsChanged?.();
        },
        onCompactionSaved: (nextCompaction) => {
          if (isVisibleSession(sessionId)) setCompaction(nextCompaction);
        },
        onAssistantMessagePersisted: (assistant, messagesWithAssistant) => {
          if (isVisibleSession(sessionId)) setMessages(messagesWithAssistant);
          void onSessionsChanged?.();
          onAssistantMessagePersisted?.(assistant);
        },
      });
    } catch (error) {
      if (mountedRef.current) {
        setDraft(submittedDraft);
        setAttachments(currentAttachments);
        setSendError(toUserMessage(error, "dekiSend"));
        markSessionSending(sessionId, false);
      }
      return;
    }
    if (mountedRef.current) {
      markSessionSending(sessionId, false);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  };

  const applyDekiAction = async (
    message: DekiMessage,
    approvedAction?: DekiChatAccessRequestAction | DekiWebResearchDecision,
  ) => {
    const webResearchDecision: DekiWebResearchDecision | null =
      approvedAction?.type === "web_research_decision" ? approvedAction : null;
    const chatAccessAction: DekiChatAccessRequestAction | null =
      approvedAction && approvedAction.type === "request_chat_access" && message.action?.type === "request_chat_access"
        ? approvedAction
        : null;
    const action: DekiEntryAction | null | undefined = chatAccessAction ?? message.action;
    if (!action || action.type === "none" || message.actionApplication?.status === "applied") return;
    setApplyingActionMessageId(message.id);
    setActionErrors((current) => {
      const { [message.id]: _removed, ...rest } = current;
      return rest;
    });
    try {
      if (action.type === "request_web_research") {
        if (webResearchDecision?.approve && (sending || !historyLoaded || !preferencesReady)) return;
        if (webResearchDecision?.approve && !preparePrompting()) return;
        const retryTurn = findUserTurnForRetry(message.id);
        if (!retryTurn) {
          setActionErrors((current) => ({
            ...current,
            [message.id]: "Deki-senpai needs the original user message before searching the web.",
          }));
          return;
        }
        const grant = createDekiWebResearchGrant(message, action);
        const application = {
          status: "applied" as const,
          appliedAt: grant.grantedAt,
          resultId: webResearchDecision?.approve ? grant.id : "web-research-declined",
        };
        const messagesWithDecision = messages.map((item) =>
          item.id === message.id ? { ...item, actionApplication: application } : item,
        );
        await dekiApi.history.replaceMessages({
          sessionId,
          messages: messagesWithDecision,
          compaction,
        });
        await dekiApi.history.markActionApplied(message.id, application, sessionId);
        setMessages(messagesWithDecision);
        void onSessionsChanged?.();
        if (!webResearchDecision?.approve) return;
        markSessionSending(sessionId, true);
        await runDetachedDekiSend({
          sessionId,
          userMessage: retryTurn.user.content,
          existingUser: retryTurn.user,
          messages: messagesWithDecision,
          compaction,
          connection: selectedConnection!,
          llm: llmApi,
          gateway: dekiApi,
          history: dekiApi.history,
          persona: selectedPersonaRequest(),
          attachments: [],
          chatAccessGrants,
          webResearchGrants: [grant],
          onUserMessagePersisted: (_user, messagesWithUser) => {
            if (isVisibleSession(sessionId)) setMessages(messagesWithUser);
            void onSessionsChanged?.();
          },
          onCompactionSaved: (nextCompaction) => {
            if (isVisibleSession(sessionId)) setCompaction(nextCompaction);
          },
          onAssistantMessagePersisted: (assistant, messagesWithAssistant) => {
            if (isVisibleSession(sessionId)) setMessages(messagesWithAssistant);
            void onSessionsChanged?.();
            onAssistantMessagePersisted?.(assistant);
          },
        });
        return;
      }
      if (action.type === "request_chat_access") {
        if (sending || !historyLoaded || !preferencesReady) return;
        if (!preparePrompting()) return;
        const retryTurn = findUserTurnForRetry(message.id);
        if (!retryTurn) {
          setActionErrors((current) => ({
            ...current,
            [message.id]: "Deki-senpai needs the original user message before resuming.",
          }));
          return;
        }
        const grant = createDekiChatAccessGrant(message, action);
        const application = {
          status: "applied" as const,
          appliedAt: grant.grantedAt,
          resultId: grant.id,
        };
        const nextGrants = [...chatAccessGrants.filter((item) => item.actionMessageId !== message.id), grant];
        const messagesWithGrant = messages.map((item) =>
          item.id === message.id
            ? {
                ...item,
                action,
                actionApplication: application,
              }
            : item,
        );
        await dekiApi.history.replaceMessages({
          sessionId,
          messages: messagesWithGrant,
          compaction,
        });
        await dekiApi.history.markActionApplied(message.id, application, sessionId);
        setChatAccessGrants(nextGrants);
        setMessages(messagesWithGrant);
        markSessionSending(sessionId, true);
        await runDetachedDekiSend({
          sessionId,
          userMessage: dekiChatAccessResumePrompt(retryTurn.user.content),
          existingUser: retryTurn.user,
          messages: messagesWithGrant,
          compaction,
          connection: selectedConnection!,
          llm: llmApi,
          gateway: dekiApi,
          history: dekiApi.history,
          persona: selectedPersonaRequest(),
          attachments: [],
          chatAccessGrants: nextGrants,
          onUserMessagePersisted: (_user, messagesWithUser) => {
            if (isVisibleSession(sessionId)) setMessages(messagesWithUser);
            void onSessionsChanged?.();
          },
          onCompactionSaved: (nextCompaction) => {
            if (isVisibleSession(sessionId)) setCompaction(nextCompaction);
          },
          onAssistantMessagePersisted: (assistant, messagesWithAssistant) => {
            if (isVisibleSession(sessionId)) setMessages(messagesWithAssistant);
            void onSessionsChanged?.();
            onAssistantMessagePersisted?.(assistant);
          },
        });
        return;
      }
      const result = await dekiApi.actions.apply(action, { actionId: message.id, messageId: message.id, sessionId });
      if (result.messages && result.compaction) {
        setMessages(result.messages);
        setCompaction(result.compaction);
        void onSessionsChanged?.();
      } else if (result.application) {
        setMessages((current) =>
          current.map((item) => (item.id === message.id ? { ...item, actionApplication: result.application } : item)),
        );
      }
      await invalidateDekiActionQueries(queryClient, action).catch((error) => {
        setActionErrors((current) => ({
          ...current,
          [message.id]: toUserMessage(error, "catalogRefreshAfterDekiAction"),
        }));
      });
    } catch (error) {
      setActionErrors((current) => ({
        ...current,
        [message.id]: toUserMessage(error, "applyDekiAction"),
      }));
    } finally {
      if (mountedRef.current) {
        if (action.type === "request_chat_access" || action.type === "request_web_research")
          markSessionSending(sessionId, false);
        setApplyingActionMessageId(null);
        requestAnimationFrame(() => inputRef.current?.focus());
      }
    }
  };

  const openConnectionsPanel = () => {
    setConnectionSetupPromptOpen(false);
    setConnectionMenuOpen(false);
    setPersonaMenuOpen(false);
    setMobileMenuOpen(false);
    openRightPanel("connections");
  };

  const selectConnection = (id: string | null) => {
    connectionSelectionTouchedRef.current = true;
    setSelectedConnectionId(id);
    setConnectionMenuOpen(false);
    setMobileMenuOpen(false);
  };
  const selectPersona = (id: string | null) => {
    personaSelectionTouchedRef.current = true;
    setSelectedPersonaId(id);
    setPersonaMenuOpen(false);
    setMobileMenuOpen(false);
  };
  const inputIconButtonClass =
    "flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-foreground/60 transition-all hover:bg-foreground/10 hover:text-foreground active:scale-90";
  const activeInputIconButtonClass = "bg-foreground/10 text-foreground";

  return (
    <section
      className="mari-chat-area relative flex h-full flex-col overflow-hidden"
      style={gradientStyle}
      aria-busy={!historyLoaded || sending}
    >
      <div className="mari-messages-scroll flex-1 overflow-y-auto overflow-x-hidden">
        <div className="deki-hero mx-auto flex w-full max-w-3xl justify-center px-4 pb-2 pt-5 sm:pt-7">
          <DekiPondScene mood={dekiSceneMood} />
        </div>

        <div className="mx-auto w-full max-w-3xl px-0 pb-4 pt-1">
          {!historyLoaded && <DekiLoadingState />}
          {conversationMessages.map((message, index) => {
            const previous = conversationMessages[index - 1];
            const showSeparator = !previous || getDayKey(previous.createdAt) !== getDayKey(message.createdAt);
            const isGrouped =
              !!previous &&
              previous.role === message.role &&
              previous.characterId === message.characterId &&
              getDayKey(previous.createdAt) === getDayKey(message.createdAt) &&
              new Date(message.createdAt).getTime() - new Date(previous.createdAt).getTime() <= 5 * 60 * 1000;
            const isWelcomeMessage = message.id === welcomeMessage.id;
            const isRegenerating = regeneratingMessageId === message.id;
            return (
              <div key={message.id}>
                {showSeparator && (
                  <div className="relative my-4 flex items-center px-4">
                    <div className="flex-1 border-t border-[var(--border)]/40" />
                    <span className="mx-4 text-[0.6875rem] font-semibold text-[var(--muted-foreground)]">
                      {formatDaySeparator(message.createdAt)}
                    </span>
                    <div className="flex-1 border-t border-[var(--border)]/40" />
                  </div>
                )}
                <ConversationMessage
                  message={message}
                  isStreaming={sending && isRegenerating}
                  isGrouped={isGrouped}
                  hideActions={isWelcomeMessage}
                  forceCanRegenerate={!isWelcomeMessage && message.role === "user"}
                  regenerateButtonTitle={message.role === "user" ? "Resend" : undefined}
                  onRegenerate={!isWelcomeMessage ? handleRegenerate : undefined}
                  onEdit={!isWelcomeMessage ? handleEditMessage : undefined}
                  characterMap={characterMap}
                  personaInfo={personaInfo}
                  chatCharacterIds={[DEKI_CHARACTER_ID]}
                  messageIndex={index + 1}
                  messageOrderIndex={index}
                />
                <DekiActionCard
                  message={visibleMessages[index]}
                  applying={applyingActionMessageId === visibleMessages[index]?.id}
                  error={visibleMessages[index] ? actionErrors[visibleMessages[index].id] : undefined}
                  onApply={applyDekiAction}
                />
              </div>
            );
          })}
          {sending && (
            <div className="px-4 py-2 text-xs text-[var(--muted-foreground)]">Deki-senpai is thinking...</div>
          )}
          {sendError && <div className="px-4 py-2 text-xs text-red-500">{sendError}</div>}
          <div ref={messagesEndRef} className="h-1" />
        </div>
      </div>

      <div className="mari-chat-input chat-input-container relative z-10 px-3 pb-3 md:px-[12%]">
        {(connectionMenuOpen || personaMenuOpen || mobileMenuOpen) && (
          <div className="pointer-events-none absolute inset-x-3 bottom-full z-30 mb-2 md:inset-x-[12%]">
            <DekiContextMenu
              connections={connections}
              personas={personas}
              selectedConnectionId={selectedConnectionId}
              selectedPersonaId={selectedPersonaId}
              mode={mobileMenuOpen ? "both" : connectionMenuOpen ? "connections" : "personas"}
              onSelectConnection={selectConnection}
              onSelectPersona={selectPersona}
            />
          </div>
        )}

        {connectionSetupPromptOpen && (
          <div className="mx-auto mb-2 flex max-w-3xl flex-col gap-2 rounded-xl border border-sky-400/30 bg-[var(--card)] px-3 py-2.5 text-xs text-[var(--foreground)] shadow-xl shadow-sky-500/10 sm:flex-row sm:items-center sm:justify-between">
            <p className="min-w-0 leading-relaxed text-[var(--foreground)]/85">{DEKI_CONNECTION_SETUP_CONTENT}</p>
            <button
              type="button"
              onClick={openConnectionsPanel}
              className="inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-lg bg-sky-500 px-3 text-xs font-semibold text-white transition-all hover:bg-sky-400 active:scale-95"
            >
              <Link size="0.8125rem" />
              Take me there!
            </button>
          </div>
        )}

        {attachments.length > 0 && (
          <div className="mx-auto mb-2 flex max-w-3xl flex-wrap gap-2">
            {attachments.map((attachment) => (
              <div
                key={attachment.id}
                className="group flex items-center gap-1.5 rounded-lg bg-foreground/10 px-2 py-1 text-xs text-foreground/70"
              >
                <FileText size="0.875rem" className="shrink-0 text-foreground/50" />
                <span className="max-w-[9rem] truncate">{attachment.name}</span>
                <button
                  type="button"
                  onClick={() => setAttachments((current) => current.filter((item) => item.id !== attachment.id))}
                  className="rounded-full p-0.5 opacity-60 transition-opacity hover:opacity-100"
                  title="Remove attachment"
                  aria-label={`Remove ${attachment.name}`}
                >
                  <X size="0.75rem" />
                </button>
              </div>
            ))}
          </div>
        )}

        <div
          className={cn(
            "mari-chat-input-box relative mx-auto flex max-w-3xl items-center gap-1.5 rounded-2xl border-2 px-2.5 py-2.5 transition-all duration-200 sm:gap-2 sm:px-4",
            "bg-[var(--card)]",
            canSend ? "border-blue-400/30 shadow-md shadow-blue-500/5" : "border-foreground/25",
          )}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,.txt,.md,.markdown,.json,.jsonl,.csv,.log,.xml,.yaml,.yml"
            multiple
            className="hidden"
            onChange={(event) => void readFiles(event.target.files)}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className={inputIconButtonClass}
            title="Attach files"
            aria-label="Attach files"
          >
            <Plus size="1rem" />
          </button>

          <button
            type="button"
            onClick={() => {
              if (!hasModelConnections) {
                setConnectionSetupPromptOpen(true);
                setConnectionMenuOpen(false);
                setPersonaMenuOpen(false);
                setMobileMenuOpen(false);
                return;
              }
              setConnectionMenuOpen((open) => !open);
              setPersonaMenuOpen(false);
              setMobileMenuOpen(false);
            }}
            className={cn(
              inputIconButtonClass,
              selectedConnection && activeInputIconButtonClass,
              !hasModelConnections && "ring-1 ring-foreground/20",
            )}
            title={
              selectedConnection
                ? selectedConnection.name || selectedConnection.id
                : hasModelConnections
                  ? "Quick Connection Switcher"
                  : "Set up a model connection"
            }
            aria-label={hasModelConnections ? "Quick Connection Switcher" : "Set up a model connection"}
          >
            <Link size="1rem" />
          </button>

          <button
            type="button"
            onClick={() => {
              setPersonaMenuOpen((open) => !open);
              setConnectionMenuOpen(false);
              setMobileMenuOpen(false);
            }}
            className={cn(
              inputIconButtonClass,
              "relative hidden overflow-hidden sm:flex",
              selectedPersona && activeInputIconButtonClass,
            )}
            title={selectedPersona ? selectedPersona.name : "Quick Persona Switcher"}
            aria-label="Quick Persona Switcher"
          >
            {selectedPersona?.avatarPath ? (
              <PersonaAvatarImage
                persona={selectedPersona}
                alt=""
                className="h-full w-full rounded-lg object-cover"
                draggable={false}
              />
            ) : (
              <CircleUser size="1rem" />
            )}
          </button>

          <button
            type="button"
            onClick={() => {
              setMobileMenuOpen((open) => !open);
              setConnectionMenuOpen(false);
              setPersonaMenuOpen(false);
            }}
            className={cn(inputIconButtonClass, "sm:hidden", mobileMenuOpen && activeInputIconButtonClass)}
            title="Quick Switcher"
            aria-label="Quick Switcher"
          >
            <ChevronUp size="1rem" className={cn("transition-transform", mobileMenuOpen && "rotate-180")} />
          </button>

          <textarea
            ref={inputRef}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (isSendShortcut(event, true)) {
                event.preventDefault();
                void send();
              }
            }}
            rows={1}
            spellCheck
            autoCorrect="on"
            placeholder={DEKI_INPUT_PLACEHOLDER}
            className="mari-chat-input-textarea max-h-[12.5rem] min-w-0 flex-1 resize-none bg-transparent py-0 text-sm leading-normal text-foreground/90 placeholder:text-foreground/30 outline-none"
          />

          <button
            type="button"
            onClick={() => void send()}
            disabled={!canSend}
            className={cn(
              "mari-chat-send-btn",
              inputIconButtonClass,
              canSend ? "text-foreground hover:text-foreground/80 active:scale-90" : "text-foreground/20",
            )}
            title="Send"
            aria-label="Send"
          >
            <Send size="0.9375rem" className={cn(canSend && "translate-x-[1px]")} />
          </button>
        </div>
      </div>
    </section>
  );
}

function DekiActionCard({
  message,
  applying,
  error,
  onApply,
}: {
  message?: DekiMessage;
  applying: boolean;
  error?: string;
  onApply: (message: DekiMessage, approvedAction?: DekiChatAccessRequestAction | DekiWebResearchDecision) => void;
}) {
  const action = message?.action;
  const applied = message?.actionApplication?.status === "applied";
  const webResearchStatusLabel =
    applied && message?.actionApplication?.resultId === "web-research-declined" ? "Declined" : "Approved";
  const actionPreviewKey = dekiActionPreviewKey(message?.id, action);
  const [currentRecordState, setCurrentRecordState] = useState<DekiActionCurrentRecordState>({
    status: "idle",
    record: null,
    error: null,
  });

  useEffect(() => {
    let active = true;
    if (!action || action.type !== "edit_record" || applied) {
      setCurrentRecordState({ status: "idle", record: null, error: null });
      return () => {
        active = false;
      };
    }

    setCurrentRecordState({ status: "loading", record: null, error: null });
    void dekiApi.actions
      .currentRecord(action)
      .then((result) => {
        if (!active) return;
        setCurrentRecordState({ status: "loaded", record: result?.record ?? null, error: null });
      })
      .catch((recordError) => {
        if (!active) return;
        setCurrentRecordState({
          status: "error",
          record: null,
          error: recordError instanceof Error ? recordError.message : "Current record could not be loaded.",
        });
      });

    return () => {
      active = false;
    };
  }, [action, actionPreviewKey, applied]);

  const diffRows = useMemo(() => {
    if (
      !action ||
      action.type === "none" ||
      action.type === "request_chat_access" ||
      action.type === "apply_lorebook_redraft" ||
      applied
    )
      return [];
    return createDekiActionDiffRows(action, currentRecordState.record);
  }, [action, actionPreviewKey, applied, currentRecordState.record]);

  if (!message || !action || action.type === "none") return null;
  const rows = actionPreviewRows(action);
  if (action.type === "request_web_research") {
    return (
      <DekiWebResearchCard
        message={message}
        action={action}
        handled={applied}
        statusLabel={webResearchStatusLabel}
        applying={applying}
        error={error}
        rows={rows}
        onApply={onApply}
      />
    );
  }
  if (action.type === "request_chat_access") {
    return (
      <DekiChatAccessCard
        message={message}
        action={action}
        granted={applied}
        applying={applying}
        error={error}
        onApply={onApply}
      />
    );
  }
  const diffWarning =
    action.type === "edit_record" && currentRecordState.status === "loaded" && !currentRecordState.record
      ? "Current record was not found."
      : currentRecordState.error;
  return (
    <div className="mb-3 ml-[4.5rem] mr-4 mt-2 rounded-xl border border-sky-400/30 bg-[var(--card)] px-3 py-3 text-xs text-[var(--foreground)] shadow-lg shadow-sky-500/10">
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-sky-500/10 text-sky-400">
          <Sparkles size="0.875rem" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate font-semibold">{actionTitle(action)}</div>
          <div className="text-[0.6875rem] text-[var(--muted-foreground)]">
            {action.type === "apply_lorebook_redraft"
              ? "Apply lorebook redraft"
              : `${action.type === "create_record" ? "Create" : "Update"} ${DEKI_ACTION_ENTITY_LABELS[action.entity]}`}
          </div>
        </div>
        {applied && (
          <span className="inline-flex h-6 shrink-0 items-center gap-1 rounded-lg bg-emerald-500/10 px-2 font-semibold text-emerald-500">
            <Check size="0.75rem" />
            Applied
          </span>
        )}
      </div>
      {action.rationale && <p className="mt-2 leading-relaxed text-[var(--foreground)]/75">{action.rationale}</p>}
      {!applied && rows.length > 0 && (
        <dl className="mt-2 grid gap-1.5">
          {rows.map((row) => (
            <div key={row.label} className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-2">
              <dt className="text-[0.6875rem] font-semibold text-[var(--muted-foreground)]">{row.label}</dt>
              <dd className="min-w-0 truncate text-[var(--foreground)]/85">{row.value}</dd>
            </div>
          ))}
        </dl>
      )}
      {!applied && (
        <DekiActionDiffView
          action={action}
          rows={diffRows}
          loading={action.type === "edit_record" && currentRecordState.status === "loading"}
          warning={diffWarning}
        />
      )}
      {error && <div className="mt-2 rounded-lg bg-red-500/10 px-2 py-1.5 text-[0.6875rem] text-red-500">{error}</div>}
      {!applied && (
        <div className="mt-3 flex justify-end">
          <button
            type="button"
            disabled={applying}
            onClick={() => onApply(message)}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-sky-500 px-3 font-semibold text-white transition-all hover:bg-sky-400 active:scale-95 disabled:cursor-wait disabled:bg-sky-500/60"
          >
            {applying ? <Loader2 size="0.8125rem" className="animate-spin" /> : <Check size="0.8125rem" />}
            Apply
          </button>
        </div>
      )}
    </div>
  );
}

function DekiActionDiffView({
  action,
  rows,
  loading,
  warning,
}: {
  action: Exclude<DekiEntryAction, { type: "none" }>;
  rows: DekiActionDiffRow[];
  loading: boolean;
  warning?: string | null;
}) {
  const changedRows = rows.filter((row) => row.status !== "unchanged").length;
  return (
    <div className="mt-3 overflow-hidden rounded-lg border border-[var(--border)]/70 bg-[var(--secondary)]/55">
      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--border)]/70 px-2.5 py-1.5">
        <div className="min-w-0 flex-1 text-[0.6875rem] font-semibold text-[var(--muted-foreground)]">Diff preview</div>
        <span className="rounded-full bg-[var(--card)] px-2 py-0.5 text-[0.625rem] font-semibold text-[var(--muted-foreground)]">
          {action.type === "create_record" ? `${rows.length} added` : `${changedRows} changed`}
        </span>
      </div>
      {warning && (
        <div className="flex items-center gap-1.5 border-b border-[var(--border)]/70 px-2.5 py-1.5 text-[0.6875rem] text-amber-500">
          <AlertCircle size="0.75rem" className="shrink-0" />
          <span className="min-w-0">{warning}</span>
        </div>
      )}
      {loading ? (
        <div className="flex items-center gap-2 px-2.5 py-3 text-[0.6875rem] text-[var(--muted-foreground)]">
          <Loader2 size="0.75rem" className="animate-spin" />
          Loading current record...
        </div>
      ) : rows.length > 0 ? (
        <div className="max-h-80 overflow-auto">
          {rows.map((row) => (
            <DekiActionDiffRowView key={row.path} row={row} create={action.type === "create_record"} />
          ))}
        </div>
      ) : (
        <div className="px-2.5 py-3 text-[0.6875rem] text-[var(--muted-foreground)]">No payload fields.</div>
      )}
    </div>
  );
}

function DekiWebResearchCard({
  message,
  action,
  handled,
  statusLabel,
  applying,
  error,
  rows,
  onApply,
}: {
  message: DekiMessage;
  action: Extract<DekiEntryAction, { type: "request_web_research" }>;
  handled: boolean;
  statusLabel: string;
  applying: boolean;
  error?: string;
  rows: Array<{ label: string; value: string }>;
  onApply: (message: DekiMessage, approvedAction?: DekiChatAccessRequestAction | DekiWebResearchDecision) => void;
}) {
  return (
    <div className="mb-3 ml-[4.5rem] mr-4 mt-2 rounded-xl border border-cyan-400/30 bg-[var(--card)] px-3 py-3 text-xs text-[var(--foreground)] shadow-lg shadow-cyan-500/10">
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-cyan-500/10 text-cyan-500">
          <Link size="0.875rem" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate font-semibold">{actionTitle(action)}</div>
          <div className="text-[0.6875rem] text-[var(--muted-foreground)]">
            Search the web and read public source pages with your approval
          </div>
        </div>
        {handled && (
          <span className="inline-flex h-6 shrink-0 items-center gap-1 rounded-lg bg-emerald-500/10 px-2 font-semibold text-emerald-500">
            <Check size="0.75rem" />
            {statusLabel}
          </span>
        )}
      </div>
      <p className="mt-2 leading-relaxed text-[var(--foreground)]/75">{action.reason}</p>
      {rows.length > 0 && (
        <dl className="mt-2 grid gap-1.5">
          {rows.map((row) => (
            <div key={row.label} className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-2">
              <dt className="text-[0.6875rem] font-semibold text-[var(--muted-foreground)]">{row.label}</dt>
              <dd className="min-w-0 truncate text-[var(--foreground)]/85">{row.value}</dd>
            </div>
          ))}
        </dl>
      )}
      {error && <div className="mt-2 rounded-lg bg-red-500/10 px-2 py-1.5 text-[0.6875rem] text-red-500">{error}</div>}
      {!handled && (
        <div className="mt-3 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            disabled={applying}
            onClick={() => onApply(message, { type: "web_research_decision", approve: false })}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 font-semibold text-[var(--foreground)]/75 transition-all hover:bg-[var(--accent)] active:scale-95 disabled:cursor-default disabled:opacity-60"
          >
            Not now
          </button>
          <button
            type="button"
            disabled={applying}
            onClick={() => onApply(message, { type: "web_research_decision", approve: true })}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-cyan-500 px-3 font-semibold text-white transition-all hover:bg-cyan-400 active:scale-95 disabled:cursor-wait disabled:bg-cyan-500/60"
          >
            {applying ? <Loader2 size="0.8125rem" className="animate-spin" /> : <Link size="0.8125rem" />}
            Search web
          </button>
        </div>
      )}
    </div>
  );
}
function DekiChatAccessCard({
  message,
  action,
  granted,
  applying,
  error,
  onApply,
}: {
  message: DekiMessage;
  action: DekiChatAccessRequestAction;
  granted: boolean;
  applying: boolean;
  error?: string;
  onApply: (message: DekiMessage, approvedAction?: DekiChatAccessRequestAction | DekiWebResearchDecision) => void;
}) {
  const normalizedAction = useMemo(() => normalizeDekiChatAccessRequestAction(action), [action]);
  const scopeOptions = useMemo(() => chatAccessScopeOptions(normalizedAction), [normalizedAction]);
  const windowOptions = useMemo(() => chatAccessWindowOptions(normalizedAction), [normalizedAction]);
  const [scopeOptionId, setScopeOptionId] = useState(defaultChatAccessOptionId(scopeOptions));
  const [windowOptionId, setWindowOptionId] = useState(defaultChatAccessOptionId(windowOptions));
  const selectedScope = scopeOptions.find((option) => option.id === scopeOptionId)?.scope ?? normalizedAction.scope;
  const selectedWindow =
    windowOptions.find((option) => option.id === windowOptionId)?.window ?? normalizedAction.window;
  const approvedAction: DekiChatAccessRequestAction = {
    ...normalizedAction,
    scope: selectedScope,
    window: normalizeDekiChatAccessWindow(selectedWindow),
  };

  useEffect(() => {
    setScopeOptionId(defaultChatAccessOptionId(scopeOptions));
  }, [scopeOptions]);

  useEffect(() => {
    setWindowOptionId(defaultChatAccessOptionId(windowOptions));
  }, [windowOptions]);

  return (
    <div className="mb-3 ml-[4.5rem] mr-4 mt-2 rounded-xl border border-amber-400/30 bg-[var(--card)] px-3 py-3 text-xs text-[var(--foreground)] shadow-lg shadow-amber-500/10">
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-amber-500/10 text-amber-500">
          <FileText size="0.875rem" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate font-semibold">{actionTitle(action)}</div>
          <div className="text-[0.6875rem] text-[var(--muted-foreground)]">Read-only chat context</div>
        </div>
        {granted && (
          <span className="inline-flex h-6 shrink-0 items-center gap-1 rounded-lg bg-emerald-500/10 px-2 font-semibold text-emerald-500">
            <Check size="0.75rem" />
            Granted
          </span>
        )}
      </div>
      {action.rationale && <p className="mt-2 leading-relaxed text-[var(--foreground)]/75">{action.rationale}</p>}
      <dl className="mt-2 grid gap-1.5">
        <div className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-2">
          <dt className="text-[0.6875rem] font-semibold text-[var(--muted-foreground)]">Scope</dt>
          <dd className="min-w-0 text-[var(--foreground)]/85">
            {granted ? (
              <span className="block truncate">{chatAccessScopeLabel(action.scope)}</span>
            ) : (
              <select
                value={scopeOptionId}
                onChange={(event) => setScopeOptionId(event.target.value)}
                className="h-8 w-full rounded-lg border border-[var(--border)] bg-[var(--secondary)] px-2 text-xs text-[var(--foreground)] outline-none transition-colors focus:border-amber-400"
                aria-label="Chat access scope"
              >
                {scopeOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            )}
          </dd>
        </div>
        <div className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-2">
          <dt className="text-[0.6875rem] font-semibold text-[var(--muted-foreground)]">Window</dt>
          <dd className="min-w-0 text-[var(--foreground)]/85">
            {granted ? (
              <span className="block truncate">{chatAccessWindowLabel(normalizedAction)}</span>
            ) : (
              <select
                value={windowOptionId}
                onChange={(event) => setWindowOptionId(event.target.value)}
                className="h-8 w-full rounded-lg border border-[var(--border)] bg-[var(--secondary)] px-2 text-xs text-[var(--foreground)] outline-none transition-colors focus:border-amber-400"
                aria-label="Chat access window"
              >
                {windowOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            )}
          </dd>
        </div>
        <div className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-2">
          <dt className="text-[0.6875rem] font-semibold text-[var(--muted-foreground)]">Expires</dt>
          <dd className="min-w-0 truncate text-[var(--foreground)]/85">Current Deki session</dd>
        </div>
      </dl>
      {error && <div className="mt-2 rounded-lg bg-red-500/10 px-2 py-1.5 text-[0.6875rem] text-red-500">{error}</div>}
      {!granted && (
        <div className="mt-3 flex justify-end">
          <button
            type="button"
            disabled={applying}
            onClick={() => onApply(message, approvedAction)}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-amber-500 px-3 font-semibold text-white transition-all hover:bg-amber-400 active:scale-95 disabled:cursor-wait disabled:bg-amber-500/60"
          >
            {applying ? <Loader2 size="0.8125rem" className="animate-spin" /> : <Check size="0.8125rem" />}
            Grant access
          </button>
        </div>
      )}
    </div>
  );
}

function DekiActionDiffRowView({ row, create }: { row: DekiActionDiffRow; create: boolean }) {
  return (
    <div className="border-b border-[var(--border)]/60 px-2.5 py-2 last:border-b-0">
      <div className="mb-1.5 flex flex-wrap items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-[0.6875rem] font-semibold text-[var(--foreground)]/85">
          {formatDekiActionDiffLabel(row.path)}
        </span>
        <span
          className={cn(
            "rounded-full px-2 py-0.5 text-[0.625rem] font-semibold",
            row.status === "added" && "bg-emerald-500/10 text-emerald-500",
            row.status === "changed" && "bg-sky-500/10 text-sky-500",
            row.status === "unchanged" && "bg-[var(--card)] text-[var(--muted-foreground)]",
          )}
        >
          {row.status}
        </span>
      </div>
      <DekiActionInlineDiff parts={create ? [{ text: row.after, kind: "added" }] : row.inlineDiff} />
    </div>
  );
}

function formatDekiActionDiffLabel(path: string): string {
  const label = path
    .split(".")
    .filter((segment) => segment !== "data")
    .at(-1);
  const fallback = label || path;
  return fallback
    .replace(/[_-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function DekiActionInlineDiff({ parts }: { parts: DekiActionDiffPart[] }) {
  return (
    <div className="min-h-9 whitespace-pre-wrap break-words rounded-md bg-[var(--card)]/70 px-2.5 py-2 text-[0.75rem] leading-relaxed text-[var(--foreground)]/85">
      {parts.length > 0
        ? parts.map((part, index) => (
            <span
              key={index}
              className={cn(
                part.kind === "added" && "rounded-sm bg-emerald-500/15 font-semibold text-emerald-400",
                part.kind === "removed" &&
                  "rounded-sm bg-red-500/10 text-red-400 line-through decoration-red-400/80 decoration-2",
              )}
            >
              {part.text}
            </span>
          ))
        : "-"}
    </div>
  );
}

function DekiLoadingState() {
  return (
    <div className="flex justify-center px-4 py-6">
      <div className="inline-flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-xs font-medium text-[var(--muted-foreground)] shadow-sm">
        <span className="relative flex h-2.5 w-2.5" aria-hidden>
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-sky-400/60" />
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-sky-400" />
        </span>
        Restoring Deki-senpai...
      </div>
    </div>
  );
}

function DekiPondScene({ mood }: { mood: DekiSceneMood }) {
  const poseUrl = DEKI_SCENE_POSES[mood];

  return (
    <div className={cn("deki-pond-scene", `deki-pond-scene-${mood}`)}>
      <div className="deki-pond-aura" aria-hidden />
      <div className="deki-pond-water" aria-hidden>
        <span className="deki-pond-ripple deki-pond-ripple-one" />
        <span className="deki-pond-ripple deki-pond-ripple-two" />
        <span className="deki-pond-ripple deki-pond-ripple-three" />
      </div>
      <div className="deki-pond-lilypad deki-pond-lilypad-left" aria-hidden />
      <div className="deki-pond-lilypad deki-pond-lilypad-right" aria-hidden />
      <img src={poseUrl} alt="Koi fish" className="deki-pond-sprite" draggable={false} />
    </div>
  );
}

function DekiContextMenu({
  connections,
  personas,
  selectedConnectionId,
  selectedPersonaId,
  mode,
  onSelectConnection,
  onSelectPersona,
}: {
  connections: DekiConnection[];
  personas: DekiPersona[];
  selectedConnectionId: string | null;
  selectedPersonaId: string | null;
  mode: "connections" | "personas" | "both";
  onSelectConnection: (id: string | null) => void;
  onSelectPersona: (id: string | null) => void;
}) {
  return (
    <div className="pointer-events-auto mx-auto grid max-h-[min(26rem,48dvh)] max-w-3xl overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--card)] shadow-2xl backdrop-blur-xl sm:w-fit sm:min-w-[20rem]">
      {(mode === "connections" || mode === "both") && (
        <div className="min-w-0 border-b border-[var(--border)] last:border-b-0">
          <div className="border-b border-[var(--border)] px-3 py-2 text-[0.6875rem] font-semibold text-[var(--muted-foreground)]">
            Connections
          </div>
          <div className="max-h-56 overflow-y-auto p-1">
            <button
              type="button"
              onClick={() => onSelectConnection(null)}
              className={cn(
                "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs transition-colors hover:bg-[var(--accent)]",
                selectedConnectionId === null && "font-semibold text-[var(--foreground)]",
              )}
            >
              <span className="flex-1 truncate">No connection selected</span>
              {selectedConnectionId === null && <Check size="0.75rem" />}
            </button>
            {connections.map((connection) => {
              const active = connection.id === selectedConnectionId;
              return (
                <button
                  key={connection.id}
                  type="button"
                  onClick={() => onSelectConnection(connection.id)}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs transition-colors hover:bg-[var(--accent)]",
                    active && "font-semibold text-[var(--foreground)]",
                  )}
                >
                  <span className="min-w-0 flex-1 truncate">{connection.name || connection.id}</span>
                  {connection.provider && (
                    <span className="shrink-0 text-[0.625rem] text-[var(--muted-foreground)]">
                      {connection.provider}
                    </span>
                  )}
                  {active && <Check size="0.75rem" />}
                </button>
              );
            })}
            {connections.length === 0 && (
              <div className="px-3 py-4 text-center text-[0.6875rem] italic text-[var(--muted-foreground)]">
                No connections found.
              </div>
            )}
          </div>
        </div>
      )}

      {(mode === "personas" || mode === "both") && (
        <div className="min-w-0">
          <div className="border-b border-[var(--border)] px-3 py-2 text-[0.6875rem] font-semibold text-[var(--muted-foreground)]">
            Personas
          </div>
          <div className="max-h-56 overflow-y-auto p-1">
            <button
              type="button"
              onClick={() => onSelectPersona(null)}
              className={cn(
                "flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-[var(--accent)]",
                selectedPersonaId === null && "text-[var(--foreground)]",
              )}
            >
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--secondary)] text-xs font-semibold text-[var(--muted-foreground)]">
                ?
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-xs font-semibold">No persona selected</div>
              </div>
              {selectedPersonaId === null && <Check size="0.75rem" />}
            </button>
            {personas.map((persona) => {
              const active = persona.id === selectedPersonaId;
              return (
                <button
                  key={persona.id}
                  type="button"
                  onClick={() => onSelectPersona(persona.id)}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-[var(--accent)]",
                    active && "text-[var(--foreground)]",
                  )}
                >
                  {persona.avatarPath ? (
                    <div className="h-8 w-8 shrink-0 overflow-hidden rounded-full border border-[var(--border)]">
                      <PersonaAvatarImage
                        persona={persona}
                        alt=""
                        className="h-full w-full object-cover"
                        draggable={false}
                        thumbnailSize={64}
                      />
                    </div>
                  ) : (
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--secondary)] text-xs font-semibold text-[var(--muted-foreground)]">
                      {(persona.name || "?")[0].toUpperCase()}
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs font-semibold">{persona.name || persona.id}</div>
                    {persona.comment && (
                      <div className="truncate text-[0.625rem] text-[var(--muted-foreground)]">{persona.comment}</div>
                    )}
                  </div>
                  {active && <Check size="0.75rem" />}
                </button>
              );
            })}
            {personas.length === 0 && (
              <div className="px-3 py-4 text-center text-[0.6875rem] italic text-[var(--muted-foreground)]">
                No personas found.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
