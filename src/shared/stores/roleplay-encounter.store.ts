// The one Roleplay combat encounter, app-wide and memory-only: reload, logout and profile switch drop it.
// Every model call gets a ticket; only the current ticket may settle state, so late answers change nothing.
// Behavior spec: docs/provenance/roleplay-encounters.md ("Leaving, reloading, errors").
import { create } from "zustand";
import {
  DEFAULT_COMBAT_NARRATION,
  DEFAULT_SUMMARY_NARRATION,
} from "../../engine/modes/roleplay/encounter/encounter-defaults";
import type {
  EncounterCallKind,
  EncounterFight,
  EncounterLogLine,
  EncounterNarrationStyle,
  EncounterResult,
  EncounterRound,
  EncounterSettings,
  EncounterTurnOutcome,
} from "../../engine/modes/roleplay/encounter/encounter-types";

export type EncounterStage = "setup" | "starting" | "start-failed" | "fighting" | "ended";

export type EncounterSummaryStatus = "idle" | "generating" | "written" | "failed";

export interface EncounterLogEntry extends EncounterLogLine {
  id: number;
}

export interface Encounter {
  chatId: string;
  stage: EncounterStage;
  settings: EncounterSettings | null;
  fight: EncounterFight | null;
  rounds: EncounterRound[];
  /** The visible log; only appended to, so it survives the overlay remounting (decision 9). */
  log: EncounterLogEntry[];
  result: EncounterResult | null;
  startError: string | null;
  turnError: string | null;
  summaryStatus: EncounterSummaryStatus;
  /** Why the summary failed, when trying again can't help (a broken Encounters helper route). */
  summaryError: string | null;
}

export interface EncounterNarrationChoices {
  combat: EncounterNarrationStyle;
  summary: EncounterNarrationStyle;
}

export interface EncounterCallTicket {
  id: number;
  signal: AbortSignal;
}

interface PendingCall {
  id: number;
  kind: EncounterCallKind;
  controller: AbortController;
  /** The summary message is being saved; leaving the chat can't stop that, so it no longer cancels the call. */
  saving: boolean;
}

export const ENCOUNTER_LEFT_CHAT_MESSAGE = "Encounter action canceled when you left this chat.";

interface EncounterStoreState {
  encounter: Encounter | null;
  pending: PendingCall | null;
  /** Lasts until reload; a new encounter starts from the last choices. */
  narration: EncounterNarrationChoices;
  openSetup: (chatId: string) => void;
  setNarration: (narration: EncounterNarrationChoices) => void;
  close: () => void;
  beginStart: (settings: EncounterSettings) => EncounterCallTicket | null;
  finishStart: (callId: number, fight: EncounterFight) => void;
  failStart: (callId: number, message: string) => void;
  beginTurn: (action: string) => EncounterCallTicket | null;
  finishTurn: (callId: number, outcome: EncounterTurnOutcome) => void;
  failTurn: (callId: number, message: string) => void;
  conclude: () => void;
  beginSummary: () => EncounterCallTicket | null;
  startSummarySave: (callId: number) => void;
  finishSummary: (callId: number) => void;
  failSummary: (callId: number, message: string | null) => void;
  isCurrent: (callId: number) => boolean;
  /**
   * Called on every chat switch: a pending call of an encounter in another chat is cancelled and settled, except a
   * summary already being saved, which finishes as written.
   */
  leaveChat: (activeChatId: string | null) => void;
  reset: () => void;
}

let lastCallId = 0;
let lastLogId = 0;

function logEntries(lines: EncounterLogLine[]): EncounterLogEntry[] {
  return lines.map((line) => ({ ...line, id: ++lastLogId }));
}

function freshEncounter(chatId: string): Encounter {
  return {
    chatId,
    stage: "setup",
    settings: null,
    fight: null,
    rounds: [],
    log: [],
    result: null,
    startError: null,
    turnError: null,
    summaryStatus: "idle",
    summaryError: null,
  };
}

function defaultNarration(): EncounterNarrationChoices {
  return { combat: { ...DEFAULT_COMBAT_NARRATION }, summary: { ...DEFAULT_SUMMARY_NARRATION } };
}

export const useRoleplayEncounterStore = create<EncounterStoreState>((set, get) => {
  function abortPending() {
    get().pending?.controller.abort();
  }

  function begin(kind: EncounterCallKind, encounter: Encounter): EncounterCallTicket {
    abortPending();
    const pending = { id: ++lastCallId, kind, controller: new AbortController(), saving: false };
    set({ pending, encounter });
    return { id: pending.id, signal: pending.controller.signal };
  }

  /** Applies `change` to the encounter only while `callId` is the current call, then clears the call. */
  function settle(callId: number, change: (encounter: Encounter) => Partial<Encounter>) {
    const { encounter, pending } = get();
    if (!encounter || pending?.id !== callId) return;
    set({ encounter: { ...encounter, ...change(encounter) }, pending: null });
  }

  return {
    encounter: null,
    pending: null,
    narration: defaultNarration(),
    openSetup: (chatId) => {
      abortPending();
      set({ encounter: freshEncounter(chatId), pending: null });
    },
    setNarration: (narration) => set({ narration }),
    close: () => {
      abortPending();
      set({ encounter: null, pending: null });
    },
    beginStart: (settings) => {
      const { encounter } = get();
      if (!encounter || (encounter.stage !== "setup" && encounter.stage !== "start-failed")) return null;
      return begin("setup", { ...encounter, stage: "starting", settings, startError: null });
    },
    finishStart: (callId, fight) =>
      settle(callId, () => ({
        stage: "fighting",
        fight,
        rounds: [],
        log: logEntries([{ kind: "system", text: "Combat begins!" }]),
      })),
    failStart: (callId, message) => settle(callId, () => ({ stage: "start-failed", startError: message })),
    beginTurn: (action) => {
      const { encounter, pending } = get();
      if (!encounter?.fight || encounter.stage !== "fighting" || pending) return null;
      return begin("turn", {
        ...encounter,
        turnError: null,
        log: [...encounter.log, ...logEntries([{ kind: "player", text: `You: ${action}` }])],
      });
    },
    finishTurn: (callId, outcome) =>
      settle(callId, (encounter) => ({
        fight: outcome.fight,
        rounds: [...encounter.rounds, outcome.round],
        log: [...encounter.log, ...logEntries(outcome.log)],
        ...(outcome.result ? { stage: "ended" as const, result: outcome.result } : {}),
      })),
    failTurn: (callId, message) => settle(callId, () => ({ turnError: message })),
    conclude: () => {
      const { encounter } = get();
      if (encounter?.stage !== "fighting") return;
      abortPending();
      set({ encounter: { ...encounter, stage: "ended", result: "interrupted", turnError: null }, pending: null });
    },
    beginSummary: () => {
      const { encounter, pending } = get();
      if (encounter?.stage !== "ended" || pending || encounter.summaryStatus === "written") return null;
      return begin("summary", { ...encounter, summaryStatus: "generating", summaryError: null });
    },
    startSummarySave: (callId) => {
      const { pending } = get();
      if (pending?.id === callId && pending.kind === "summary") set({ pending: { ...pending, saving: true } });
    },
    finishSummary: (callId) => settle(callId, () => ({ summaryStatus: "written" })),
    failSummary: (callId, message) => settle(callId, () => ({ summaryStatus: "failed", summaryError: message })),
    isCurrent: (callId) => get().pending?.id === callId,
    leaveChat: (activeChatId) => {
      const { encounter, pending } = get();
      if (!encounter || !pending || pending.saving || encounter.chatId === activeChatId) return;
      pending.controller.abort();
      if (pending.kind === "setup") {
        set({ encounter: null, pending: null });
        return;
      }
      const change: Partial<Encounter> =
        pending.kind === "turn" ? { turnError: ENCOUNTER_LEFT_CHAT_MESSAGE } : { summaryStatus: "failed" };
      set({ encounter: { ...encounter, ...change }, pending: null });
    },
    reset: () => {
      abortPending();
      set({ encounter: null, pending: null, narration: defaultNarration() });
    },
  };
});
