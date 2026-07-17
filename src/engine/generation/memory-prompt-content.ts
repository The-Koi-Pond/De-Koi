const SERIALIZED_MEMORY_FIELD = /["']?(?:message|content|memory|summary)["']?\s*:/i;
const RESERVED_MEMORY_TAG =
  /<\/?(?:memories|canonical_memories|durable_facts|relationship_state|scene_continuity|other_memory)\b[^>]*>/gi;

function isFencedCode(value: string): boolean {
  return /^```[\s\S]*```$/.test(value);
}

function isValidJson(value: string): boolean {
  try {
    JSON.parse(value);
    return true;
  } catch {
    return false;
  }
}

function hasMalformedSerializationWrapper(value: string): boolean {
  if (!SERIALIZED_MEMORY_FIELD.test(value)) return false;
  if (isFencedCode(value) || isValidJson(value)) return false;
  return /[{}()[\]]/.test(value);
}

function escapeReservedMemoryTags(value: string): string {
  return value.replace(RESERVED_MEMORY_TAG, (tag) => tag.replaceAll("<", "&lt;").replaceAll(">", "&gt;"));
}

export function prepareMemoryPromptContent(content: string): string | null {
  const trimmed = content.trim();
  if (!trimmed || hasMalformedSerializationWrapper(trimmed)) return null;
  return escapeReservedMemoryTags(trimmed);
}
