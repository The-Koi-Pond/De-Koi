// ──────────────────────────────────────────────
// Chat Mode Definitions
// ──────────────────────────────────────────────
import type { ChatMode } from "../types/chat.js";

export interface ChatModeDefinition {
  id: ChatMode;
  name: string;
  description: string;
  icon: string;
  /** Which agents are enabled by default for this mode */
  defaultAgents: string[];
}

export function defaultBackgroundAgentIdsForNewChat(mode: ChatMode): string[] {
  void mode;
  return [];
}

export const CHAT_MODES: Record<ChatMode, ChatModeDefinition> = {
  conversation: {
    id: "conversation",
    name: "Conversation",
    description: "A straightforward AI conversation — no roleplay elements.",
    icon: "💬",
    defaultAgents: ["schedule-planner", "response-orchestrator", "autonomous-messenger"],
  },
  roleplay: {
    id: "roleplay",
    name: "Roleplay",
    description: "Immersive roleplay with characters, story state tracking, and world simulation.",
    icon: "🎭",
    defaultAgents: ["world-state", "continuity", "expression"],
  },
  fanfic: {
    id: "fanfic",
    name: "Fanfic",
    description: "Request a fanfic: pick the fandom, ships, rating, and tropes, then read it chapter by chapter.",
    icon: "📖",
    defaultAgents: [],
  },
};
