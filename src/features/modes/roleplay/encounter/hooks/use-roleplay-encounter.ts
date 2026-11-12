// Runs an encounter's model calls through the engine and settles the encounter store with their answers.
// The store decides whether an answer is still current; a stale one changes nothing. A saved summary always
// refreshes its chat's messages, since it is in the chat whatever happened to the encounter.
import { useMemo } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import {
  ENCOUNTER_TURN_INVALID_MESSAGE,
  resolveEncounterTurn,
  startEncounterFight,
  writeEncounterSummary,
  type EncounterCapabilities,
} from "../../../../../engine/modes/roleplay/encounter/encounter-calls";
import type { EncounterSettings } from "../../../../../engine/modes/roleplay/encounter/encounter-types";
import { llmApi } from "../../../../../shared/api/llm-api";
import { storageApi } from "../../../../../shared/api/storage-api";
import { toUserMessage } from "../../../../../shared/lib/error-message";
import { useAgentStore } from "../../../../../shared/stores/agent.store";
import { useRoleplayEncounterStore } from "../../../../../shared/stores/roleplay-encounter.store";
import { useUIStore } from "../../../../../shared/stores/ui.store";
import { chatKeys } from "../../../../catalog/chats/index";

const capabilities: EncounterCapabilities = { storage: storageApi, llm: llmApi };

const START_FAILED_FALLBACK = "Couldn't start the encounter. Try again.";

async function runStart(settings: EncounterSettings): Promise<void> {
  const store = useRoleplayEncounterStore.getState();
  const chatId = store.encounter?.chatId;
  const ticket = store.beginStart(settings);
  if (!chatId || !ticket) return;
  const debugSink = useUIStore.getState().debugMode ? useAgentStore.getState().addDebugEntry : undefined;
  try {
    const fight = await startEncounterFight(capabilities, { chatId, settings, signal: ticket.signal, debugSink });
    useRoleplayEncounterStore.getState().finishStart(ticket.id, fight);
  } catch (error) {
    // Missing connections, provider errors and junk output are already worded for the user (decision 10).
    useRoleplayEncounterStore
      .getState()
      .failStart(ticket.id, toUserMessage(error, { fallback: START_FAILED_FALLBACK }));
  }
}

async function runSummary(queryClient: QueryClient): Promise<void> {
  const store = useRoleplayEncounterStore.getState();
  const encounter = store.encounter;
  if (!encounter?.result || !encounter.settings) return;
  const ticket = store.beginSummary();
  if (!ticket) return;
  try {
    await writeEncounterSummary(capabilities, {
      chatId: encounter.chatId,
      settings: encounter.settings,
      result: encounter.result,
      rounds: encounter.rounds,
      signal: ticket.signal,
      onSaveStart: () => useRoleplayEncounterStore.getState().startSummarySave(ticket.id),
    });
  } catch {
    // The end screen offers Try again; a cancelled call was already settled by whoever cancelled it.
    useRoleplayEncounterStore.getState().failSummary(ticket.id);
    return;
  }
  useRoleplayEncounterStore.getState().finishSummary(ticket.id);
  // The message is saved even if the encounter was closed meanwhile; an inactive chat refetches when it's reopened.
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: chatKeys.messages(encounter.chatId) }),
    queryClient.invalidateQueries({ queryKey: chatKeys.messageCount(encounter.chatId) }),
  ]);
}

async function runTurn(action: string, queryClient: QueryClient): Promise<void> {
  const store = useRoleplayEncounterStore.getState();
  const encounter = store.encounter;
  const ticket = store.beginTurn(action);
  if (!encounter?.fight || !encounter.settings || !ticket) return;
  let ended = false;
  try {
    const outcome = await resolveEncounterTurn(capabilities, {
      chatId: encounter.chatId,
      settings: encounter.settings,
      fight: encounter.fight,
      rounds: encounter.rounds,
      action,
      signal: ticket.signal,
    });
    ended = useRoleplayEncounterStore.getState().isCurrent(ticket.id) && outcome.result !== null;
    useRoleplayEncounterStore.getState().finishTurn(ticket.id, outcome);
  } catch {
    // A failed call and junk output read the same to the player: nothing changed, try again.
    useRoleplayEncounterStore.getState().failTurn(ticket.id, ENCOUNTER_TURN_INVALID_MESSAGE);
  }
  if (ended) await runSummary(queryClient);
}

export function useRoleplayEncounter() {
  const queryClient = useQueryClient();
  return useMemo(
    () => ({
      openSetup: (chatId: string) => useRoleplayEncounterStore.getState().openSetup(chatId),
      begin: (settings: EncounterSettings) => runStart(settings),
      retryStart: () => {
        const settings = useRoleplayEncounterStore.getState().encounter?.settings;
        return settings ? runStart(settings) : Promise.resolve();
      },
      sendAction: (action: string) => {
        const text = action.trim();
        return text ? runTurn(text, queryClient) : Promise.resolve();
      },
      conclude: () => {
        useRoleplayEncounterStore.getState().conclude();
        return runSummary(queryClient);
      },
      retrySummary: () => runSummary(queryClient),
      close: () => useRoleplayEncounterStore.getState().close(),
    }),
    [queryClient],
  );
}
