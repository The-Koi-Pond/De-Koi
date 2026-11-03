// Wires the app's own generation engine to the hosted runtime API for the runner process.
import { startGeneration } from "../engine/generation/start-generation";
import { startFanficGeneration, type StartFanficGenerationInput } from "../engine/modes/fanfic/chapters";
import { fanficFollowUpInput, fanficFollowUpWrite, fanficWriteSavedFinishedId } from "../engine/modes/fanfic/batch";
import { FANFIC_GENERATION_KINDS } from "../engine/modes/fanfic/chapters";
import { integrationGateway } from "../shared/api/integration-gateway";
import { llmApi } from "../shared/api/llm-api";
import { storageApi } from "../shared/api/storage-api";
import { visualAssetsApi } from "../shared/api/visual-assets-api";
import { useUIStore } from "../shared/stores/ui.store";
import type { RunnerEvent } from "./jobs";

/** Points the shared runtime adapters at the de-koi-server API (credentials may ride in the URL). */
export function configureRuntime(runtimeUrl: string): void {
  useUIStore.setState({ remoteRuntimeUrl: runtimeUrl });
}

/** Input fields that only make sense inside a browser tab. */
const TAB_ONLY_INPUT_KEYS = ["debugSink", "onUserMessageAccepted"];
/** Marks a fanfic chapter write as one step of "write all"; the job keeps it, the engine never sees it. */
const FANFIC_BATCH_KEY = "fanficBatch";

/** A fanfic chapter write (the reader sends `fanficKind`); everything else is a chat reply. */
export function isFanficJobInput(input: Record<string, unknown>): boolean {
  return typeof input.fanficKind === "string" && input.fanficKind.length > 0;
}

export async function* runGenerationJob(
  input: Record<string, unknown>,
  signal: AbortSignal,
): AsyncGenerator<RunnerEvent> {
  const runInput = { ...input };
  for (const key of [...TAB_ONLY_INPUT_KEYS, FANFIC_BATCH_KEY]) delete runInput[key];
  // No image-prompt review dialog on the server: it needs a person at the screen.
  const deps = { storage: storageApi, llm: llmApi, integrations: integrationGateway, visuals: visualAssetsApi };
  const events = isFanficJobInput(runInput)
    ? startFanficGeneration(deps, runInput as unknown as StartFanficGenerationInput, signal)
    : startGeneration(deps, runInput as Parameters<typeof startGeneration>[1], signal);
  for await (const event of events) {
    yield { type: event.type, ...("data" in event ? { data: event.data } : {}) };
  }
}

/**
 * The job to start after one that ended normally: the polish of the chapter a fanfic write finished, or the next
 * chapter of a "write all" run, while their rules say so (see fanficFollowUpWrite). Null for everything else.
 */
export async function nextRunnerJobInput(
  input: Record<string, unknown>,
  events: readonly RunnerEvent[],
): Promise<Record<string, unknown> | null> {
  const kind = FANFIC_GENERATION_KINDS.find((entry) => entry === input.fanficKind);
  const chatId = typeof input.chatId === "string" ? input.chatId.trim() : "";
  if (!kind || !chatId) return null;
  const followUp = await fanficFollowUpWrite(storageApi, {
    chatId,
    kind,
    batch: input[FANFIC_BATCH_KEY] === true,
    finishedId: fanficWriteSavedFinishedId(events),
  });
  return followUp ? fanficFollowUpInput(input, followUp) : null;
}
