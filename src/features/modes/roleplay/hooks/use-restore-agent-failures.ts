import { useEffect } from "react";
import { agentApi } from "../../../../shared/api/agent-api";
import { latestTurnAgentFailures } from "../../../../shared/lib/agent-failures";
import { useAgentStore } from "../../../../shared/stores/agent.store";
import { useChatStore } from "../../../../shared/stores/chat.store";
import { normalizeAgentRunRow, type AgentRunRow } from "../../../catalog/agents/index";

/**
 * Agent failures live in memory and vanish on reload, while the runs that produced them are
 * persisted. Rebuild the latest turn's failures when a chat opens so the HUD badge and
 * "Retry Failed Agents" survive a reload. Live state always wins over the restored copy.
 */
export function useRestoreAgentFailures(chatId: string, enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;
    let stale = false;
    // Any failure write, store reset (chat switch, Clear Trackers) or generation start while the
    // runs load means the restored copy would be out of date, so drop it.
    const unsubscribe = useAgentStore.subscribe((state, previous) => {
      if (state.failedAgentFailures !== previous.failedAgentFailures || state.isProcessing !== previous.isProcessing) {
        stale = true;
      }
    });
    agentApi
      .listRunsForChat<Record<string, unknown>>(chatId)
      .then((rawRuns) => {
        if (stale || useChatStore.getState().activeChatId !== chatId) return;
        const store = useAgentStore.getState();
        if (store.isProcessing || store.failedAgentFailures.length > 0) return;
        const runs = rawRuns.map((raw) => normalizeAgentRunRow(raw)).filter((run): run is AgentRunRow => run !== null);
        const failures = latestTurnAgentFailures(runs);
        if (failures.length > 0) store.setFailedAgentFailures(failures);
      })
      .catch((error: unknown) => {
        // The HUD still works without the restored badge; the live path reports new failures.
        console.warn("[agents] Could not restore agent failures for chat", chatId, error);
      })
      .finally(unsubscribe);
    return () => {
      stale = true;
      unsubscribe();
    };
  }, [chatId, enabled]);
}
