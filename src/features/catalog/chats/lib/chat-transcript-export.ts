import type { Chat, Message } from "../../../../engine/contracts/types/chat";
import type { StoredZipFile } from "../../../../shared/lib/zip";

export type ChatTranscriptExportFormat = "jsonl" | "text";
export type BulkChatExportFormat = ChatTranscriptExportFormat | "native";

/** Display names for an export: character id → name, and the user's persona name. */
export type ChatExportNames = {
  characters: Record<string, string>;
  user?: string | null;
};

const NO_NAMES: ChatExportNames = { characters: {} };

/**
 * The `.jsonl` export uses SillyTavern's chat file shape, so SillyTavern opens it as-is:
 * a header line, then one line per message. De-Koi's own fields sit under `deKoi` keys,
 * which SillyTavern keeps but ignores.
 */
type SillyTavernSwipeInfo = {
  send_date: string;
  extra: { reasoning?: string };
};

type ChatTranscriptHeaderRow = {
  user_name: string;
  character_name: string;
  create_date: string;
  chat_metadata: {
    note_prompt?: string;
    note_depth?: number;
    deKoi: {
      format: "de-koi-chat-transcript-jsonl";
      version: 2;
      chatId: string;
      chatName: string;
      mode: Chat["mode"];
      groupId: string | null;
      characterIds: string[];
      personaId: string | null;
      connectionId: string | null;
      promptPresetId: string | null;
      branchName: string | null;
    };
  };
};

type ChatTranscriptMessageRow = {
  name: string;
  is_user: boolean;
  is_system: boolean;
  send_date: string;
  mes: string;
  extra: {
    reasoning?: string;
    type?: "narrator" | "comment";
    /** De-Koi's own hidden flag; SillyTavern's `is_system` also covers system notes. */
    hiddenFromAI: boolean;
  };
  swipe_id?: number;
  swipes?: string[];
  swipe_info?: SillyTavernSwipeInfo[];
  role?: Message["role"];
  characterId?: string | null;
};

type ExportedSwipe = { content?: unknown; extra?: Record<string, unknown> | null; createdAt?: unknown };

function getChatNameForExport(chat: Chat) {
  const metadata = chat.metadata;
  if (metadata && typeof metadata === "object" && "branchName" in metadata) {
    const branchName = (metadata as { branchName?: unknown }).branchName;
    if (typeof branchName === "string" && branchName.trim()) return branchName.trim();
  }
  return typeof chat.name === "string" ? chat.name.trim() : "";
}

function getBranchName(chat: Chat): string | null {
  const metadata = chat.metadata;
  if (metadata && typeof metadata === "object" && "branchName" in metadata) {
    const branchName = (metadata as { branchName?: unknown }).branchName;
    if (typeof branchName === "string" && branchName.trim()) return branchName.trim();
  }
  return null;
}

function userName(message: Message | null, names: ChatExportNames): string {
  return message?.extra?.personaSnapshot?.name?.trim() || names.user?.trim() || "You";
}

function speakerNameForMessage(message: Message, names: ChatExportNames): string {
  if (message.role === "user") return userName(message, names);
  if (message.role === "system") return "System";
  const characterName = message.characterId ? names.characters[message.characterId]?.trim() : "";
  if (characterName) return characterName;
  if (message.role === "narrator") return "Narrator";
  return "Assistant";
}

function isHiddenFromAI(message: Message): boolean {
  const extra = message.extra as unknown as Record<string, unknown> | undefined;
  return extra?.hiddenFromAI === true || extra?.hiddenFromAi === true;
}

function reasoningOf(extra: Record<string, unknown> | null | undefined): string | undefined {
  const thinking = extra?.thinking;
  return typeof thinking === "string" && thinking.trim() ? thinking : undefined;
}

/** SillyTavern's `create_date` style, `2026-06-01@12h00m00s`, in UTC. */
function sillyTavernCreateDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}@${pad(
    date.getUTCHours(),
  )}h${pad(date.getUTCMinutes())}m${pad(date.getUTCSeconds())}s`;
}

function primaryCharacterName(chat: Chat, names: ChatExportNames): string {
  const first = chat.characterIds.map((id) => names.characters[id]?.trim()).find(Boolean);
  return first || getChatNameForExport(chat) || chat.name || "Assistant";
}

export function chatExportFilename(chat: Chat, format: ChatTranscriptExportFormat) {
  const ext = format === "text" ? ".txt" : ".jsonl";
  const sourceName = getChatNameForExport(chat) || chat.id;
  const safeName = sourceName.replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^_+|_+$/g, "");
  return `${safeName || `chat-${chat.id}`}${ext}`;
}

function chatTranscriptHeaderRow(chat: Chat, messages: Message[], names: ChatExportNames): ChatTranscriptHeaderRow {
  const metadata = (chat.metadata ?? {}) as Record<string, unknown>;
  const note = typeof metadata.authorNotes === "string" ? metadata.authorNotes.trim() : "";
  const depth = typeof metadata.authorNotesDepth === "number" ? metadata.authorNotesDepth : 4;
  return {
    user_name: userName(messages.find((message) => message.role === "user") ?? null, names),
    character_name: primaryCharacterName(chat, names),
    create_date: sillyTavernCreateDate(chat.createdAt),
    chat_metadata: {
      ...(note ? { note_prompt: note, note_depth: depth } : {}),
      deKoi: {
        format: "de-koi-chat-transcript-jsonl",
        version: 2,
        chatId: chat.id,
        chatName: chat.name,
        mode: chat.mode,
        groupId: chat.groupId,
        characterIds: chat.characterIds,
        personaId: chat.personaId,
        connectionId: chat.connectionId,
        promptPresetId: chat.promptPresetId,
        branchName: getBranchName(chat),
      },
    },
  };
}

function chatTranscriptMessageRow(message: Message, names: ChatExportNames): ChatTranscriptMessageRow {
  const content = message.content ?? "";
  const reasoning = reasoningOf(message.extra as unknown as Record<string, unknown>);
  const row: ChatTranscriptMessageRow = {
    name: speakerNameForMessage(message, names),
    is_user: message.role === "user",
    // SillyTavern marks both hidden messages and its own system notes with is_system.
    is_system: message.role === "system" || isHiddenFromAI(message),
    send_date: message.createdAt,
    mes: content,
    extra: {
      ...(reasoning ? { reasoning } : {}),
      ...(message.role === "narrator" ? { type: "narrator" as const } : {}),
      ...(message.role === "system" ? { type: "comment" as const } : {}),
      hiddenFromAI: isHiddenFromAI(message),
    },
    role: message.role,
    characterId: message.characterId,
  };
  const swipes = (message as Message & { swipes?: ExportedSwipe[] }).swipes;
  if (Array.isArray(swipes) && swipes.length > 1) {
    const active = Math.min(Math.max(0, message.activeSwipeIndex ?? 0), swipes.length - 1);
    row.swipe_id = active;
    row.swipes = swipes.map((swipe, index) =>
      index === active ? content : typeof swipe.content === "string" ? swipe.content : "",
    );
    row.swipe_info = swipes.map((swipe, index) => {
      const swipeReasoning = index === active ? reasoning : reasoningOf(swipe.extra);
      return {
        send_date: typeof swipe.createdAt === "string" ? swipe.createdAt : message.createdAt,
        extra: swipeReasoning ? { reasoning: swipeReasoning } : {},
      };
    });
  }
  return row;
}

export function formatChatText(chat: Chat, messages: Message[], names: ChatExportNames = NO_NAMES) {
  const title = getChatNameForExport(chat) || chat.name || chat.id;
  const header = [
    `Chat: ${title}`,
    `Mode: ${chat.mode}`,
    `Created: ${chat.createdAt}`,
    `Updated: ${chat.updatedAt}`,
    chat.groupId ? `Group: ${chat.groupId}` : null,
    getBranchName(chat) ? `Branch: ${getBranchName(chat)}` : null,
  ].filter(Boolean);

  const body = messages.map((message) => {
    const timestamp = message.createdAt ? ` [${message.createdAt}]` : "";
    return `${speakerNameForMessage(message, names)}${timestamp}\n${message.content ?? ""}`;
  });

  return [...header, "", ...body].join("\n\n");
}

export function formatChatJsonl(chat: Chat, messages: Message[], names: ChatExportNames = NO_NAMES) {
  const rows = [
    chatTranscriptHeaderRow(chat, messages, names),
    ...messages.map((message) => chatTranscriptMessageRow(message, names)),
  ];
  return `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`;
}

function chatTranscriptManifest(chats: Array<{ chat: Chat; messages: Message[] }>) {
  return {
    format: "marinara-chat-transcripts",
    version: 1,
    chats: chats.map(({ chat, messages }) => ({
      id: chat.id,
      name: chat.name,
      mode: chat.mode,
      groupId: chat.groupId,
      branchName: getBranchName(chat),
      characterIds: chat.characterIds,
      personaId: chat.personaId,
      connectionId: chat.connectionId,
      promptPresetId: chat.promptPresetId,
      messageCount: messages.length,
    })),
  };
}

export function buildChatTranscriptZipFiles(
  chats: Array<{ chat: Chat; messages: Message[]; names?: ChatExportNames }>,
  format: ChatTranscriptExportFormat,
): StoredZipFile[] {
  return [
    {
      name: "manifest.json",
      data: JSON.stringify(chatTranscriptManifest(chats), null, 2),
    },
    ...chats.map(({ chat, messages, names }) => ({
      name: chatExportFilename(chat, format),
      data: format === "text" ? formatChatText(chat, messages, names) : formatChatJsonl(chat, messages, names),
    })),
  ];
}
