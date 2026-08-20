// ──────────────────────────────────────────────
// Zustand Store: Combat Encounter
// ──────────────────────────────────────────────
import { create } from "zustand";
import type {
  CombatInitState,
  CombatPartyMember,
  CombatEnemy,
  CombatPlayerActions,
  CombatEnemyAction,
  CombatPartyAction,
  EncounterLogEntry,
  EncounterSettings,
  CombatStyleNotes,
} from "../../engine/contracts/types/combat-encounter";

interface EncounterState {
  chatId: string | null;
  requestId: number;
  // ── State ──
  active: boolean;
  initialized: boolean;
  isLoading: boolean;
  isProcessing: boolean;
  error: string | null;

  // ── Combat data ──
  party: CombatPartyMember[];
  enemies: CombatEnemy[];
  environment: string;
  styleNotes: CombatStyleNotes | null;
  playerActions: CombatPlayerActions | null;
  encounterLog: EncounterLogEntry[];

  // ── Pending log entries for sequential animation ──
  pendingLogs: Array<{ message: string; type: string }>;

  // ── Settings ──
  settings: EncounterSettings;

  // ── Config modal ──
  showConfigModal: boolean;

  // ── Selected spellbook ──
  spellbookId: string | null;

  // ── Combat result ──
  combatResult: "victory" | "defeat" | "fled" | "interrupted" | null;
  summaryStatus: "idle" | "generating" | "done" | "error";

  // ── Actions ──
  openConfigModal: (chatId: string) => void;
  closeConfigModal: () => void;
  updateSettings: (settings: Partial<EncounterSettings>) => void;
  setSpellbookId: (id: string | null) => void;
  cancelInactiveRequest: (activeChatId: string | null) => void;

  beginRequest: (
    chatId: string,
    patch: Partial<
      Pick<EncounterState, "active" | "isLoading" | "isProcessing" | "error" | "combatResult" | "summaryStatus">
    >,
  ) => number | null;
  setRequestState: (
    chatId: string,
    requestId: number,
    patch: Partial<
      Pick<EncounterState, "active" | "isLoading" | "isProcessing" | "error" | "combatResult" | "summaryStatus">
    >,
  ) => void;

  initCombat: (chatId: string, requestId: number, state: CombatInitState) => void;
  updateCombat: (data: {
    party: CombatPartyMember[];
    enemies: CombatEnemy[];
    playerActions: CombatPlayerActions;
    enemyActions: CombatEnemyAction[];
    partyActions: CombatPartyAction[];
    narrative: string;
  }) => void;
  addLogEntry: (action: string, result: string) => void;
  setPendingLogs: (logs: Array<{ message: string; type: string }>) => void;
  clearPendingLogs: () => void;

  endCombat: (result: "victory" | "defeat" | "fled" | "interrupted") => void;
  reset: () => void;
}

const defaultSettings: EncounterSettings = {
  combatNarrative: {
    tense: "present",
    person: "third",
    narration: "omniscient",
    pov: "narrator",
  },
  summaryNarrative: {
    tense: "past",
    person: "third",
    narration: "omniscient",
    pov: "narrator",
  },
  historyDepth: 8,
};

export const useEncounterStore = create<EncounterState>((set) => ({
  chatId: null,
  requestId: 0,
  active: false,
  initialized: false,
  isLoading: false,
  isProcessing: false,
  error: null,

  party: [],
  enemies: [],
  environment: "",
  styleNotes: null,
  playerActions: null,
  encounterLog: [],
  pendingLogs: [],

  settings: defaultSettings,
  showConfigModal: false,
  spellbookId: null,

  combatResult: null,
  summaryStatus: "idle",

  openConfigModal: (chatId) =>
    set((current) => ({
      chatId,
      requestId: current.requestId + 1,
      active: false,
      initialized: false,
      isLoading: false,
      isProcessing: false,
      error: null,
      party: [],
      enemies: [],
      environment: "",
      styleNotes: null,
      playerActions: null,
      encounterLog: [],
      pendingLogs: [],
      showConfigModal: true,
      spellbookId: null,
      combatResult: null,
      summaryStatus: "idle",
    })),
  closeConfigModal: () => set({ showConfigModal: false }),
  updateSettings: (partial) => set((s) => ({ settings: { ...s.settings, ...partial } })),
  setSpellbookId: (id) => set({ spellbookId: id }),
  cancelInactiveRequest: (activeChatId) =>
    set((current) => {
      if (!current.chatId || current.chatId === activeChatId) return {};
      const initializationPending = current.isLoading && !current.initialized;
      const actionPending = current.isProcessing;
      const summaryPending = current.summaryStatus === "generating";
      if (!initializationPending && !actionPending && !summaryPending) return {};
      return {
        requestId: current.requestId + 1,
        isLoading: false,
        isProcessing: false,
        ...(initializationPending ? { active: false, error: null } : {}),
        ...(actionPending ? { error: "Encounter action canceled when you left this chat." } : {}),
        ...(summaryPending ? { summaryStatus: "error" as const } : {}),
      };
    }),

  beginRequest: (chatId, patch) => {
    let nextRequestId: number | null = null;
    set((current) => {
      if (current.chatId !== chatId) return {};
      nextRequestId = current.requestId + 1;
      return { ...patch, requestId: nextRequestId };
    });
    return nextRequestId;
  },
  setRequestState: (chatId, requestId, patch) =>
    set((current) => (current.chatId === chatId && current.requestId === requestId ? patch : {})),

  initCombat: (chatId, requestId, state) =>
    set((current) =>
      current.chatId === chatId && current.requestId === requestId
        ? {
            active: true,
            initialized: true,
            isLoading: false,
            error: null,
            party: state.party,
            enemies: state.enemies,
            environment: state.environment,
            styleNotes: state.styleNotes,
            playerActions: {
              attacks: state.party.find((m) => m.isPlayer)?.attacks ?? [],
              items: state.party.find((m) => m.isPlayer)?.items ?? [],
            },
            encounterLog: [],
            pendingLogs: [],
            combatResult: null,
            summaryStatus: "idle" as const,
          }
        : {},
    ),

  updateCombat: (data) =>
    set((s) => {
      // Sanitize playerActions — AI may return attacks/items as non-arrays
      let pa: CombatPlayerActions | null = data.playerActions ?? s.playerActions;
      if (pa && typeof pa === "object") {
        pa = {
          attacks: Array.isArray(pa.attacks) ? pa.attacks : (s.playerActions?.attacks ?? []),
          items: Array.isArray(pa.items) ? pa.items : (s.playerActions?.items ?? []),
        };
      } else {
        pa = s.playerActions;
      }
      return {
        party: Array.isArray(data.party) && data.party.length > 0 ? data.party : s.party,
        enemies: Array.isArray(data.enemies) && data.enemies.length > 0 ? data.enemies : s.enemies,
        playerActions: pa,
        isProcessing: false,
      };
    }),

  addLogEntry: (action, result) =>
    set((s) => ({
      encounterLog: [...s.encounterLog, { timestamp: Date.now(), action, result }],
    })),

  setPendingLogs: (logs) => set({ pendingLogs: logs }),
  clearPendingLogs: () => set({ pendingLogs: [] }),

  endCombat: (result) => set({ combatResult: result }),

  reset: () =>
    set((current) => ({
      chatId: null,
      requestId: current.requestId + 1,
      active: false,
      initialized: false,
      isLoading: false,
      isProcessing: false,
      error: null,
      party: [],
      enemies: [],
      environment: "",
      styleNotes: null,
      playerActions: null,
      encounterLog: [],
      pendingLogs: [],
      showConfigModal: false,
      spellbookId: null,
      combatResult: null,
      summaryStatus: "idle",
    })),
}));
