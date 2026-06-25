import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { Check, ChevronUp, CircleUser, FileText, Link, Loader2, Plus, Send, Sparkles, X } from "lucide-react";
import {
  type DekiActionEntity,
  type DekiAttachment,
  type DekiEntryAction,
  type DekiMessage,
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
import { cn, normalizeAvatarCropValue } from "../../../../shared/lib/utils";
import { useUIStore } from "../../../../shared/stores/ui.store";
import { runDetachedDekiSend } from "../lib/deki-send";

const DEKI_AVATAR_URL = "/icon-192.png";
const DEKI_CHIBI_URL = "/logo.png";
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

function newId(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
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
  return {};
}

function actionTitle(action: DekiEntryAction) {
  if (action.type === "none") return "Deki-senpai action";
  if (action.label?.trim()) return action.label.trim();
  const verb = action.type === "create_record" ? "Create" : "Update";
  return `${verb} ${DEKI_ACTION_ENTITY_LABELS[action.entity]}`;
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

function formatActionPayload(action: DekiEntryAction): string {
  const payload = actionPayload(action);
  try {
    return JSON.stringify(payload, null, 2);
  } catch {
    return String(payload);
  }
}

function actionPreviewRows(action: DekiEntryAction): Array<{ label: string; value: string }> {
  if (action.type === "none") return [];
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
  if (action.type === "none") return;
  await Promise.all(
    uniqueQueryKeys([...DEKI_CREATIVE_LIBRARY_QUERY_KEYS, ...DEKI_ACTION_QUERY_KEYS[action.entity]]).map((queryKey) =>
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
};

export function DekiSurface({ sessionId, onCreateSession, onSessionsChanged }: DekiSurfaceProps) {
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
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [applyingActionMessageId, setApplyingActionMessageId] = useState<string | null>(null);
  const [actionErrors, setActionErrors] = useState<Record<string, string>>({});
  const fileInputRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const persistedConnectionIdRef = useRef<DekiPreferences["selectedConnectionId"] | undefined>(undefined);
  const persistedPersonaIdRef = useRef<DekiPreferences["selectedPersonaId"] | undefined>(undefined);
  const mountedRef = useRef(false);
  const connectionSelectionTouchedRef = useRef(false);
  const personaSelectionTouchedRef = useRef(false);
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
    void dekiApi.history
      .get(sessionId)
      .then((history) => {
        if (!active) return;
        setMessages(history.messages);
        setCompaction(history.compaction);
        setSendError(null);
      })
      .catch((error) => {
        if (!active) return;
        setSendError(error instanceof Error ? error.message : "Deki-senpai history could not be loaded.");
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
        setSendError(error instanceof Error ? error.message : "Deki-senpai preferences could not be loaded.");
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
        setSendError(error instanceof Error ? error.message : "Deki-senpai preferences could not be saved.");
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

  const send = async () => {
    const userMessage = draft.trim() || (attachments.length > 0 ? "[attachments]" : "");
    if (!userMessage || sending || !historyLoaded || !preferencesReady) return;
    if (isDekiResetCommand(userMessage)) {
      setDraft("");
      setAttachments([]);
      setSendError(null);
      setSending(true);
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
        setSendError(error instanceof Error ? error.message : "Deki-senpai chat could not be created.");
      } finally {
        setSending(false);
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
    const currentAttachments = attachments;
    setDraft("");
    setAttachments([]);
    setSendError(null);
    setSending(true);
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
        persona: selectedPersona
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
          : null,
        attachments: currentAttachments.map((attachment) => ({
          id: attachment.id,
          name: attachment.name,
          type: attachment.type,
          size: attachment.size,
          content: attachment.content,
        })),
        onUserMessagePersisted: (_user, messagesWithUser) => {
          if (mountedRef.current) setMessages(messagesWithUser);
          void onSessionsChanged?.();
        },
        onCompactionSaved: (nextCompaction) => {
          if (mountedRef.current) setCompaction(nextCompaction);
        },
        onAssistantMessagePersisted: (_assistant, messagesWithAssistant) => {
          if (mountedRef.current) setMessages(messagesWithAssistant);
          void onSessionsChanged?.();
        },
      });
    } catch (error) {
      if (mountedRef.current) {
        setSendError(error instanceof Error ? error.message : "Deki-senpai failed to respond.");
        setSending(false);
      }
      return;
    }
    if (mountedRef.current) {
      setSending(false);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  };

  const applyDekiAction = async (message: DekiMessage) => {
    const action = message.action;
    if (!action || action.type === "none" || message.actionApplication?.status === "applied") return;
    setApplyingActionMessageId(message.id);
    setActionErrors((current) => {
      const { [message.id]: _removed, ...rest } = current;
      return rest;
    });
    try {
      const result = await dekiApi.actions.apply(action, { actionId: message.id, messageId: message.id, sessionId });
      if (result.messages && result.compaction) {
        setMessages(result.messages);
        setCompaction(result.compaction);
        void onSessionsChanged?.();
      } else if (result.application) {
        setMessages((current) =>
          current.map((item) =>
            item.id === message.id ? { ...item, actionApplication: result.application } : item,
          ),
        );
      }
      await invalidateDekiActionQueries(queryClient, action).catch((error) => {
        setActionErrors((current) => ({
          ...current,
          [message.id]:
            error instanceof Error
              ? `The action was applied, but catalog refresh failed: ${error.message}`
              : "The action was applied, but catalog refresh failed.",
        }));
      });
    } catch (error) {
      setActionErrors((current) => ({
        ...current,
        [message.id]: error instanceof Error ? error.message : "Deki-senpai could not apply that action.",
      }));
    } finally {
      setApplyingActionMessageId(null);
      requestAnimationFrame(() => inputRef.current?.focus());
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
          <DekiPixelScene active={sending || !historyLoaded} />
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
                  isStreaming={false}
                  isGrouped={isGrouped}
                  hideActions
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
  onApply: (message: DekiMessage) => void;
}) {
  const action = message?.action;
  if (!message || !action || action.type === "none") return null;
  const applied = message.actionApplication?.status === "applied";
  const rows = actionPreviewRows(action);
  const payloadText = formatActionPayload(action);
  return (
    <div className="mx-4 mb-3 ml-14 max-w-[min(42rem,calc(100%-4rem))] rounded-xl border border-sky-400/30 bg-[var(--card)] px-3 py-3 text-xs text-[var(--foreground)] shadow-lg shadow-sky-500/10">
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-sky-500/10 text-sky-400">
          <Sparkles size="0.875rem" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate font-semibold">{actionTitle(action)}</div>
          <div className="text-[0.6875rem] text-[var(--muted-foreground)]">
            {action.type === "create_record" ? "Create" : "Update"} {DEKI_ACTION_ENTITY_LABELS[action.entity]}
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
      <div className="mt-3 rounded-lg border border-[var(--border)]/70 bg-[var(--secondary)]/55">
        <div className="border-b border-[var(--border)]/70 px-2.5 py-1.5 text-[0.6875rem] font-semibold text-[var(--muted-foreground)]">
          Full payload to apply
        </div>
        <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words px-2.5 py-2 font-mono text-[0.6875rem] leading-relaxed text-[var(--foreground)]/85">
          {payloadText}
        </pre>
      </div>
      {error && <div className="mt-2 rounded-lg bg-red-500/10 px-2 py-1.5 text-[0.6875rem] text-red-500">{error}</div>}
      <div className="mt-3 flex justify-end">
        <button
          type="button"
          disabled={applied || applying}
          onClick={() => onApply(message)}
          className={cn(
            "inline-flex h-8 items-center gap-1.5 rounded-lg px-3 font-semibold transition-all active:scale-95",
            applied
              ? "cursor-default bg-emerald-500/10 text-emerald-500"
              : "bg-sky-500 text-white hover:bg-sky-400 disabled:cursor-wait disabled:bg-sky-500/60",
          )}
        >
          {applying ? <Loader2 size="0.8125rem" className="animate-spin" /> : <Check size="0.8125rem" />}
          {applied ? "Applied" : "Apply"}
        </button>
      </div>
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

function DekiPixelScene({ active }: { active: boolean }) {
  return (
    <div className={cn("deki-pixel-scene", active ? "deki-pixel-scene-active" : "deki-pixel-scene-idle")}>
      <div className="deki-pixel-glow" aria-hidden />
      <div className="deki-pixel-desk" aria-hidden />
      <img src={DEKI_CHIBI_URL} alt="Deki-senpai" className="deki-pixel-sprite" draggable={false} />
      <div className="deki-laptop" aria-hidden>
        <div className="deki-laptop-screen">
          <span />
          <span />
          <span />
        </div>
        <div className="deki-laptop-base">
          <i />
          <i />
          <i />
          <i />
          <i />
          <i />
        </div>
      </div>
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
