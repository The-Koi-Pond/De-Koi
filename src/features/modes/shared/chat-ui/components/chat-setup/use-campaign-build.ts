import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useSyncExternalStore } from "react";
import { toast } from "sonner";

import {
  buildCampaign,
  type BuildCampaignInput,
  type CampaignBuildStep,
} from "../../../../../../engine/modes/roleplay/campaign/campaign-build";
import { CampaignCallError } from "../../../../../../engine/modes/roleplay/campaign/campaign-calls";
import { llmApi } from "../../../../../../shared/api/llm-api";
import { storageApi } from "../../../../../../shared/api/storage-api";
import { toUserMessage } from "../../../../../../shared/lib/error-message";
import { useChatStore } from "../../../../../../shared/stores/chat.store";
import { chatKeys } from "../../../../../catalog/chats/index";

export const CAMPAIGN_STEP_LABELS: Record<CampaignBuildStep, string> = {
  planning: "Dreaming up the world and its people",
  situations: "Laying out what could happen",
  reviewing: "Checking the plan for weak spots",
  writing: "Writing the opening",
  saving: "Setting the table",
};

export const CAMPAIGN_STEPS: readonly CampaignBuildStep[] = [
  "planning",
  "situations",
  "reviewing",
  "writing",
  "saving",
];

interface RunningBuild {
  step: CampaignBuildStep;
  controller: AbortController;
}

// One build at a time, and it outlives the card that started it: closing setup doesn't throw minutes of work away.
let running: RunningBuild | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
const currentStep = () => running?.step ?? null;

/**
 * Builds a campaign from the setup card: the four planning calls, then the narrator card, lorebook and chat. The new
 * chat opens when it's ready, wherever the player is in the app. `step` is the running build's step, else null.
 */
export function useCampaignBuild() {
  const queryClient = useQueryClient();
  const step = useSyncExternalStore(subscribe, currentStep, currentStep);

  const start = useCallback(
    async (input: BuildCampaignInput): Promise<boolean> => {
      if (running) return false;
      const controller = new AbortController();
      running = { step: "planning", controller };
      notify();
      try {
        const built = await buildCampaign({ storage: storageApi, llm: llmApi }, input, {
          signal: controller.signal,
          onStep: (next) => {
            if (running) running = { ...running, step: next };
            notify();
          },
        });
        await queryClient.invalidateQueries({ queryKey: chatKeys.list() });
        useChatStore.getState().setActiveChatId(built.chatId);
        toast.success(built.pitch ? `${built.title} is ready. ${built.pitch}` : `${built.title} is ready. Good luck.`, {
          duration: 12_000,
        });
        return true;
      } catch (error) {
        if (!controller.signal.aborted) {
          const details =
            error instanceof CampaignCallError && error.details.length > 0 ? ` (${error.details[0]})` : "";
          toast.error(`${toUserMessage(error, { fallback: "Couldn't build the campaign. Try again." })}${details}`);
        }
        return false;
      } finally {
        running = null;
        notify();
      }
    },
    [queryClient],
  );
  const stop = useCallback(() => running?.controller.abort(), []);
  return { start, stop, step };
}
