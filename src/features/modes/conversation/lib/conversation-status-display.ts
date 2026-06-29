type ConversationStatus = "online" | "idle" | "dnd" | "offline";

export interface ConversationCharacterStatusDisplay {
  name: string;
  conversationStatus?: ConversationStatus;
  conversationStatusMessage?: string | null;
  conversationActivity?: string | null;
  conversationAvailabilityExplanation?: string | null;
}

const NO_SCHEDULE_DETAIL_RE = /^unknown\s*\(no schedule\)\.?$/i;

function normalizeDetail(value: string | null | undefined): string | null {
  const detail = value?.trim();
  return detail ? detail : null;
}

function isNoSchedulePlaceholder(value: string): boolean {
  if (NO_SCHEDULE_DETAIL_RE.test(value)) return true;
  const afterLabel = value.replace(/^[^:]+:\s*/, "");
  return NO_SCHEDULE_DETAIL_RE.test(afterLabel);
}

function statusFallbackLabel(status: ConversationStatus | undefined): string | null {
  switch (status) {
    case "offline":
      return "Offline";
    case "dnd":
      return "Busy";
    case "idle":
      return "Away";
    default:
      return null;
  }
}

export function getConversationCharacterStatusDetail(
  character: ConversationCharacterStatusDisplay,
): string | null {
  const statusMessage = normalizeDetail(character.conversationStatusMessage);
  if (statusMessage && !isNoSchedulePlaceholder(statusMessage)) return statusMessage;

  const explanation = normalizeDetail(character.conversationAvailabilityExplanation);
  if (explanation && !isNoSchedulePlaceholder(explanation)) return explanation;

  const activity = normalizeDetail(character.conversationActivity);
  if (activity && !isNoSchedulePlaceholder(activity)) return activity;

  return statusFallbackLabel(character.conversationStatus);
}

export function getConversationCharacterStatusTitle(
  character: ConversationCharacterStatusDisplay,
  fallback: string,
): string {
  return getConversationCharacterStatusDetail(character) ?? fallback;
}

export function getConversationCharacterStatusLabel(character: ConversationCharacterStatusDisplay): string {
  const detail = getConversationCharacterStatusDetail(character);
  return detail ? `${character.name}: ${detail}` : character.name;
}