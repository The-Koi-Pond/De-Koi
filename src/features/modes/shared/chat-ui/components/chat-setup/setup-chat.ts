import type { Chat } from "../../../../../../engine/contracts/types/chat";
import { deriveChatTitle } from "../../../../../../engine/entities/chat-title";
import { normalizeChatCharacterIds, parseChatMetadata } from "../../../../../../shared/lib/chat-display";
import { isConnectionReadyToReply } from "../../../../../../shared/lib/connection-filters";

/** What setup reads from the draft chat: its own fields plus parsed metadata (stored either as text or an object). */
export interface SetupChatFields {
  id: string;
  isConversation: boolean;
  characterIds: string[];
  personaId: string | null;
  connectionId: string | null;
  promptPresetId: string | null;
  metadata: Record<string, unknown>;
}

function optionalId(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function readSetupChat(chat: Chat): SetupChatFields {
  return {
    id: chat.id,
    isConversation: chat.mode === "conversation",
    characterIds: normalizeChatCharacterIds(chat.characterIds),
    personaId: optionalId(chat.personaId),
    connectionId: optionalId(chat.connectionId),
    promptPresetId: optionalId(chat.promptPresetId),
    metadata: parseChatMetadata(chat.metadata),
  };
}

/**
 * The name setup gives a chat while it names itself: the picked characters, or the mode's blank name. It's the app's
 * own title rule, so later automatic retitles still recognize the name as automatic.
 */
export function setupChatName(isConversation: boolean, names: readonly string[]): string {
  return deriveChatTitle(isConversation ? "conversation" : "roleplay", names);
}

/** Storage keeps some flags as booleans and some as "true" strings, under a new and a legacy name. */
export function flagIsSet(...values: unknown[]): boolean {
  return values.some((value) => value === true || value === "true");
}

type ConnectionLike = {
  id: string;
  name?: string | null;
  provider?: string | null;
  model?: string | null;
  hasApiKey?: boolean | null;
  synthetic?: boolean;
  isDefault?: unknown;
  default?: unknown;
};

/**
 * A chat without a connection replies through the app's default connection, else the first one saved (decision 6),
 * so the no-connection option names that connection. The Local Model entry isn't a saved connection.
 */
export function defaultConnectionLabel(connections: readonly ConnectionLike[]): string {
  const saved = connections.filter((connection) => !connection.synthetic);
  const fallback = saved.find((connection) => flagIsSet(connection.isDefault, connection.default)) ?? saved[0];
  const name = fallback?.name?.trim();
  return name ? `Default (${name})` : "Default";
}

/** A new conversation starts on a connection that can reply, not on a half-finished one listed first. */
export function firstUsableConnectionId(connections: readonly ConnectionLike[]): string | null {
  return (connections.find((connection) => isConnectionReadyToReply(connection)) ?? connections[0])?.id ?? null;
}
