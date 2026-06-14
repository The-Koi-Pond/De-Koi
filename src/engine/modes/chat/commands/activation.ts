import { boolish, parseRecord, readString } from "../../../generation/runtime-records";

interface ChatCommandActivationInput {
  mode?: unknown;
  chatMode?: unknown;
  metadata?: unknown;
}

function conversationCommandsEnabledForMetadata(metadata: unknown): boolean {
  return boolish(parseRecord(metadata).characterCommands, true);
}

export function conversationCommandPromptEnabled(chat: ChatCommandActivationInput): boolean {
  const mode = readString(chat.mode || chat.chatMode).trim();
  return mode === "conversation" && conversationCommandsEnabledForMetadata(chat.metadata);
}
