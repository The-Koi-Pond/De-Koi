export type ConversationStatusAngleId = "activity" | "social" | "aside" | "interest" | "minimal" | "continuity";

export interface ConversationStatusAngle {
  id: ConversationStatusAngleId;
  instruction: string;
  includeContinuity: boolean;
}

export interface StatusMessageVarietyState {
  recentMessages: string[];
  previousAngle: ConversationStatusAngleId | null;
}

const STATUS_MESSAGE_HISTORY_LIMIT = 6;

const STATUS_ANGLES: readonly ConversationStatusAngle[] = [
  {
    id: "activity",
    instruction: "Write a casual fragment shaped by what they are doing now without restating the activity label.",
    includeContinuity: false,
  },
  {
    id: "social",
    instruction: "Signal availability, a boundary, or openness to company in the character's own casual voice.",
    includeContinuity: false,
  },
  {
    id: "aside",
    instruction: "Write a throwaway joke, complaint, or mundane observation instead of summarizing recent events.",
    includeContinuity: false,
  },
  {
    id: "interest",
    instruction: "Mention a small current interest, craving, or preoccupation supported by the supplied context.",
    includeContinuity: false,
  },
  {
    id: "minimal",
    instruction: "Write a deliberately low-effort fragment, dry aside, or character-appropriate tiny reaction.",
    includeContinuity: false,
  },
  {
    id: "continuity",
    instruction:
      "Make an oblique callback to recent continuity without recapping it or using retrospective clichés like 'thinking about yesterday'.",
    includeContinuity: true,
  },
];

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function compactMessage(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function comparisonText(value: string): string {
  const compact = value.toLowerCase().replace(/\s+/g, " ").trim();
  const words = compact
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  return words || compact;
}

function validAngle(value: unknown): value is ConversationStatusAngleId {
  return typeof value === "string" && STATUS_ANGLES.some((angle) => angle.id === value);
}

function characterHash(characterId: string): number {
  let hash = 0;
  for (const char of characterId) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return hash;
}

export function readStatusMessageVarietyState(extensions: Record<string, unknown>): StatusMessageVarietyState {
  const meta = readRecord(extensions.conversationStatusMessageMeta);
  const storedHistory = Array.isArray(meta.recentMessages)
    ? meta.recentMessages.map(compactMessage).filter(Boolean)
    : [];
  const currentMessage = compactMessage(extensions.conversationStatusMessage);
  const recentMessages = currentMessage
    ? appendAcceptedStatusMessage(storedHistory, currentMessage)
    : storedHistory.slice(-STATUS_MESSAGE_HISTORY_LIMIT);
  return {
    recentMessages,
    previousAngle: validAngle(meta.angle) ? meta.angle : null,
  };
}

export function nextStatusAngle(
  characterId: string,
  previousAngle: ConversationStatusAngleId | null,
): ConversationStatusAngle {
  const previousIndex = previousAngle ? STATUS_ANGLES.findIndex((angle) => angle.id === previousAngle) : -1;
  const index =
    previousIndex >= 0 ? (previousIndex + 1) % STATUS_ANGLES.length : characterHash(characterId) % STATUS_ANGLES.length;
  return STATUS_ANGLES[index]!;
}

export function appendAcceptedStatusMessage(recentMessages: string[], message: string): string[] {
  const compact = compactMessage(message);
  if (!compact) return recentMessages.map(compactMessage).filter(Boolean).slice(-STATUS_MESSAGE_HISTORY_LIMIT);
  const key = comparisonText(compact);
  return [
    ...recentMessages
      .map(compactMessage)
      .filter(Boolean)
      .filter((item) => comparisonText(item) !== key),
    compact,
  ].slice(-STATUS_MESSAGE_HISTORY_LIMIT);
}

export function isRepeatedStatusMessage(candidate: string, recentMessages: string[]): boolean {
  const normalizedCandidate = comparisonText(candidate);
  if (!normalizedCandidate) return false;
  const candidateTokens = new Set(normalizedCandidate.split(" ").filter(Boolean));

  return recentMessages.some((recentMessage) => {
    const normalizedRecent = comparisonText(recentMessage);
    if (!normalizedRecent) return false;
    if (normalizedCandidate === normalizedRecent) return true;

    const shorterLength = Math.min(normalizedCandidate.length, normalizedRecent.length);
    if (
      shorterLength >= 6 &&
      (normalizedCandidate.includes(normalizedRecent) || normalizedRecent.includes(normalizedCandidate))
    ) {
      return true;
    }

    const recentTokens = new Set(normalizedRecent.split(" ").filter(Boolean));
    if (candidateTokens.size < 3 || recentTokens.size < 3) return false;
    const intersection = [...candidateTokens].filter((token) => recentTokens.has(token)).length;
    const union = new Set([...candidateTokens, ...recentTokens]).size;
    return union > 0 && intersection / union >= 0.6;
  });
}
