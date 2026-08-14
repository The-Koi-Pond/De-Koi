import type { GenerationPromptSnapshotMessage } from "../contracts/types/chat";

export type CompactPromptPreviewEntry = { messageIndex: number } | { message: GenerationPromptSnapshotMessage };

function serializedMessage(message: GenerationPromptSnapshotMessage): string {
  return JSON.stringify(message);
}

/** Encode preview order using canonical request messages wherever the payload is identical. */
export function compactPromptSnapshotPreview(
  messages: GenerationPromptSnapshotMessage[],
  previewMessages: GenerationPromptSnapshotMessage[] | null | undefined,
): CompactPromptPreviewEntry[] | undefined {
  if (!previewMessages?.length) return undefined;
  if (
    previewMessages.length === messages.length &&
    previewMessages.every((message, index) => serializedMessage(message) === serializedMessage(messages[index]!))
  ) {
    return undefined;
  }

  const availableIndices = new Map<string, number[]>();
  messages.forEach((message, index) => {
    const key = serializedMessage(message);
    const indices = availableIndices.get(key) ?? [];
    indices.push(index);
    availableIndices.set(key, indices);
  });

  return previewMessages.map((message) => {
    const indices = availableIndices.get(serializedMessage(message));
    const messageIndex = indices?.shift();
    return messageIndex === undefined ? { message } : { messageIndex };
  });
}

/** Rebuild a prompt-inspector preview from compact refs, falling back to legacy full arrays. */
export function reconstructPromptSnapshotPreview(
  messagesValue: unknown,
  refsValue: unknown,
  legacyPreviewValue: unknown,
): GenerationPromptSnapshotMessage[] {
  const messages = Array.isArray(messagesValue) ? messagesValue : [];
  if (Array.isArray(refsValue)) {
    return refsValue.flatMap((value) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) return [];
      const entry = value as Record<string, unknown>;
      if (Number.isInteger(entry.messageIndex)) {
        const message = messages[Number(entry.messageIndex)];
        return message && typeof message === "object" && !Array.isArray(message)
          ? [message as GenerationPromptSnapshotMessage]
          : [];
      }
      return entry.message && typeof entry.message === "object" && !Array.isArray(entry.message)
        ? [entry.message as GenerationPromptSnapshotMessage]
        : [];
    });
  }
  return Array.isArray(legacyPreviewValue) ? (legacyPreviewValue as GenerationPromptSnapshotMessage[]) : [];
}
