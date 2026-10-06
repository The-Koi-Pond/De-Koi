import { useEffect } from "react";
import { agentApi } from "../../../../shared/api/agent-api";
import { latestTurnAgentFailures, type PersistedAgentRun } from "../../../../shared/lib/agent-failures";
import { useAgentStore } from "../../../../shared/stores/agent.store";

/**
 * Agent failures live in memory and vanish on reload, while the runs that produced them are
 * persisted. Rebuild the latest turn's failures when a chat opens so the HUD badge and
 * "Retry Failed Agents" survive a reload. Live state always wins over the restored copy.
 */
export function useRestoreAgentFailures(chatId: string, enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    agentApi
      .listRunsForChat<PersistedAgentRun>(chatId)
      .then((runs) => {
        if (cancelled) return;
        const store = useAgentStore.getState();
        if (store.isProcessing || store.failedAgentFailures.length > 0) return;
        const failures = latestTurnAgentFailures(runs);
        if (failures.length > 0) store.setFailedAgentFailures(failures);
      })
      .catch((error: unknown) => {
        // The HUD still works without the restored badge; the live path reports new failures.
        console.warn("[agents] Could not restore agent failures for chat", chatId, error);
      });
    return () => {
      cancelled = true;
    };
  }, [chatId, enabled]);
}
