// ──────────────────────────────────────────────
// Zustand Store: Agent Slice
// ──────────────────────────────────────────────
import { create } from "zustand";
import type { AgentDebugEntry, AgentResult, CharacterCardFieldUpdate } from "../../engine/contracts/types/agent";
import type { AgentFailure } from "../lib/agent-failures";

/**
 * A character_card_update result awaiting user confirmation.
 *
 * Character cards are sensitive (they define the character's identity) so
 * the Card Evolution Auditor never writes them automatically — each batch
 * of proposed edits sits here until the user approves or rejects it.
 */
export interface PendingCardUpdate {
  /** Client-generated ID, used as key for dismissal. */
  id: string;
  characterId: string;
  characterName: string;
  updates: CharacterCardFieldUpdate[];
  agentName: string;
  /** ms since epoch — used for stable ordering. */
  timestamp: number;
}

export interface PendingLorebookUpdate {
  id: string;
  chatId: string;
  lorebookId: string;
  lorebookName: string;
  action: "create" | "update" | "delete";
  entryId: string | null;
  entryName: string;
  content: string;
  newFacts: string[];
  keys: string[];
  tag: string;
  reason: string;
  agentName: string;
  timestamp: number;
}

interface AgentState {
  activeAgents: string[];
  lastResults: Map<string, AgentResult>;
  debugLog: AgentDebugEntry[];
  isProcessing: boolean;
  /** Agent types that failed even after auto-retry — manual retry available */
  failedAgentTypes: string[];
  /** Rich failure details for the retry UI and troubleshooting copy */
  failedAgentFailures: AgentFailure[];
  thoughtBubbles: Array<{
    agentId: string;
    agentName: string;
    content: string;
    timestamp: number;
  }>;
  echoMessages: Array<{
    characterName: string;
    reaction: string;
    timestamp: number;
  }>;
  /** How many echo messages are currently revealed (stagger counter) */
  echoVisibleCount: number;
  /** Baseline: messages at or below this count are shown without stagger */
  echoBaseline: number;
  /** Chat ID whose echo messages have been loaded — prevents redundant fetches across remounts */
  echoLoadedChatId: string | null;
  cyoaChoices: Array<{
    label: string;
    text: string;
  }>;
  cyoaChoicesChatId: string | null;
  pendingCardUpdates: PendingCardUpdate[];
  pendingLorebookUpdates: PendingLorebookUpdate[];

  // Actions
  setActiveAgents: (agents: string[]) => void;
  setProcessing: (processing: boolean) => void;
  addResult: (agentId: string, result: AgentResult) => void;
  addDebugEntry: (entry: Omit<AgentDebugEntry, "timestamp"> & { timestamp?: number }) => void;
  clearDebugLog: () => void;
  setFailedAgentTypes: (types: string[]) => void;
  setFailedAgentFailures: (failures: AgentFailure[]) => void;
  addFailedAgentFailure: (failure: AgentFailure) => void;
  clearFailedAgentTypes: () => void;
  addThoughtBubble: (agentId: string, agentName: string, content: string) => void;
  dismissThoughtBubble: (index: number) => void;
  clearThoughtBubbles: () => void;
  addEchoMessage: (characterName: string, reaction: string) => void;
  setEchoMessages: (messages: Array<{ characterName: string; reaction: string; timestamp: number }>) => void;
  clearEchoMessages: () => void;
  setEchoVisibleCount: (count: number) => void;
  setEchoBaseline: (count: number) => void;
  setEchoLoadedChatId: (chatId: string | null) => void;
  setCyoaChoices: (choices: Array<{ label: string; text: string }>, chatId?: string | null) => void;
  clearCyoaChoices: () => void;
  enqueuePendingCardUpdate: (entry: PendingCardUpdate) => void;
  dismissPendingCardUpdate: (id: string) => void;
  clearPendingCardUpdates: () => void;
  enqueuePendingLorebookUpdate: (entry: PendingLorebookUpdate) => void;
  dismissPendingLorebookUpdate: (id: string) => void;
  clearPendingLorebookUpdates: () => void;
  reset: () => void;
}

export const useAgentStore = create<AgentState>((set) => ({
  activeAgents: [],
  lastResults: new Map(),
  debugLog: [],
  isProcessing: false,
  failedAgentTypes: [],
  failedAgentFailures: [],
  thoughtBubbles: [],
  echoMessages: [],
  echoVisibleCount: 0,
  echoBaseline: 0,
  echoLoadedChatId: null,
  cyoaChoices: [],
  cyoaChoicesChatId: null,
  pendingCardUpdates: [],
  pendingLorebookUpdates: [],

  setActiveAgents: (agents) => set({ activeAgents: agents }),
  setProcessing: (processing) => set({ isProcessing: processing }),

  addResult: (agentId, result) =>
    set((s) => {
      const results = new Map(s.lastResults);
      results.set(agentId, result);
      // Cap at 50 entries — evict oldest
      if (results.size > 50) {
        const first = results.keys().next().value;
        if (first !== undefined) results.delete(first);
      }
      return { lastResults: results };
    }),

  addDebugEntry: (entry) =>
    set((s) => ({
      debugLog: [...s.debugLog, { ...entry, timestamp: entry.timestamp ?? Date.now() }].slice(-100),
    })),

  clearDebugLog: () => set({ debugLog: [] }),

  setFailedAgentTypes: (types) =>
    set({
      failedAgentTypes: types,
      failedAgentFailures: types.map((agentType) => ({
        agentType,
        agentName: agentType,
        error: null,
        reasonLabel: null,
      })),
    }),
  setFailedAgentFailures: (failures) =>
    set({
      failedAgentTypes: failures.map((failure) => failure.agentType),
      failedAgentFailures: failures,
    }),
  addFailedAgentFailure: (failure) =>
    set((s) => {
      const withoutSameType = s.failedAgentFailures.filter((f) => f.agentType !== failure.agentType);
      const failures = [...withoutSameType, failure];
      return {
        failedAgentFailures: failures,
        failedAgentTypes: failures.map((f) => f.agentType),
      };
    }),
  clearFailedAgentTypes: () => set({ failedAgentTypes: [], failedAgentFailures: [] }),

  addThoughtBubble: (agentId, agentName, content) =>
    set((s) => ({
      thoughtBubbles: [...s.thoughtBubbles, { agentId, agentName, content, timestamp: Date.now() }].slice(-50),
    })),

  dismissThoughtBubble: (index) =>
    set((s) => ({
      thoughtBubbles: s.thoughtBubbles.filter((_, i) => i !== index),
    })),

  clearThoughtBubbles: () => set({ thoughtBubbles: [] }),

  addEchoMessage: (characterName, reaction) =>
    set((s) => ({
      echoMessages: [...s.echoMessages, { characterName, reaction, timestamp: Date.now() }].slice(-500),
    })),

  setEchoMessages: (messages) => set({ echoMessages: messages.slice(-500) }),

  clearEchoMessages: () => set({ echoMessages: [], echoVisibleCount: 0, echoBaseline: 0, echoLoadedChatId: null }),

  setEchoVisibleCount: (count) => set({ echoVisibleCount: count }),
  setEchoBaseline: (count) => set({ echoBaseline: count }),
  setEchoLoadedChatId: (chatId) => set({ echoLoadedChatId: chatId }),

  setCyoaChoices: (choices, chatId = null) => set({ cyoaChoices: choices, cyoaChoicesChatId: chatId }),
  clearCyoaChoices: () => set({ cyoaChoices: [], cyoaChoicesChatId: null }),

  enqueuePendingCardUpdate: (entry) =>
    set((s) => ({ pendingCardUpdates: [...s.pendingCardUpdates, entry].slice(-20) })),
  dismissPendingCardUpdate: (id) =>
    set((s) => ({ pendingCardUpdates: s.pendingCardUpdates.filter((e) => e.id !== id) })),
  clearPendingCardUpdates: () => set({ pendingCardUpdates: [] }),
  enqueuePendingLorebookUpdate: (entry) =>
    set((s) => ({ pendingLorebookUpdates: [...s.pendingLorebookUpdates, entry].slice(-50) })),
  dismissPendingLorebookUpdate: (id) =>
    set((s) => ({ pendingLorebookUpdates: s.pendingLorebookUpdates.filter((e) => e.id !== id) })),
  clearPendingLorebookUpdates: () => set({ pendingLorebookUpdates: [] }),

  reset: () =>
    set({
      activeAgents: [],
      lastResults: new Map(),
      debugLog: [],
      isProcessing: false,
      failedAgentTypes: [],
      failedAgentFailures: [],
      thoughtBubbles: [],
      echoMessages: [],
      echoVisibleCount: 0,
      echoBaseline: 0,
      echoLoadedChatId: null,
      cyoaChoices: [],
      cyoaChoicesChatId: null,
      pendingCardUpdates: [],
      pendingLorebookUpdates: [],
    }),
}));
