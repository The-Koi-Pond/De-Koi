export type AutonomousClientPresenceStatus = "active" | "idle" | "dnd";

export interface ChatActivityState {
  lastUserMessageAt: number;
  lastAssistantMessageAt: number;
  autonomousMessages: Map<string, { count: number; lastSentAt: number }>;
  generationInProgressSince: number | null;
  clientPresence?: { status: AutonomousClientPresenceStatus; updatedAt: number };
}

const activityStates = new Map<string, ChatActivityState>();

export function getChatActivityState(chatId: string): ChatActivityState | undefined {
  return activityStates.get(chatId);
}

export function setChatActivityState(chatId: string, state: ChatActivityState): void {
  activityStates.set(chatId, state);
}

export function hasChatActivityState(chatId: string): boolean {
  return activityStates.has(chatId);
}

export function clearChatActivity(chatId: string): void {
  activityStates.delete(chatId);
}
