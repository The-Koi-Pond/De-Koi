import { boolish, parseRecord, readString, type JsonRecord } from "../../../generation/runtime-records";

interface ChatCommandActivationInput {
  mode?: unknown;
  chatMode?: unknown;
  metadata?: unknown;
  capabilities?: unknown;
}

function conversationCommandsEnabledForMetadata(metadata: unknown): boolean {
  return boolish(parseRecord(metadata).characterCommands, true);
}

export function conversationCommandPromptEnabled(chat: ChatCommandActivationInput): boolean {
  const mode = readString(chat.mode || chat.chatMode).trim();
  return mode === "conversation" && conversationCommandsEnabledForMetadata(chat.metadata);
}

export function conversationCommandCapabilities(
  chat: ChatCommandActivationInput,
  meta = parseRecord(chat.metadata),
): JsonRecord {
  return {
    ...parseRecord(meta.commandCapabilities),
    ...parseRecord(meta.capabilities),
    ...parseRecord(chat.capabilities),
  };
}

export function commandCapabilityEnabled(capabilities: JsonRecord, keys: string[], fallback = true): boolean {
  for (const key of keys) {
    if (capabilities[key] === false) return false;
    if (capabilities[key] === true) return true;
  }
  return fallback;
}

export function conversationSelfieCommandEnabled(chat: ChatCommandActivationInput): boolean {
  if (!conversationCommandPromptEnabled(chat)) return false;
  return commandCapabilityEnabled(conversationCommandCapabilities(chat), [
    "selfie",
    "canSelfie",
    "imageGeneration",
    "canGenerateImages",
  ]);
}
