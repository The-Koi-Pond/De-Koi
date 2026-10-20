// Wires the app's own generation engine to the hosted runtime API for the runner process.
import { startGeneration } from "../engine/generation/start-generation";
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

export async function* runGenerationJob(
  input: Record<string, unknown>,
  signal: AbortSignal,
): AsyncGenerator<RunnerEvent> {
  const runInput = { ...input };
  for (const key of TAB_ONLY_INPUT_KEYS) delete runInput[key];
  // No image-prompt review dialog on the server: it needs a person at the screen.
  const deps = { storage: storageApi, llm: llmApi, integrations: integrationGateway, visuals: visualAssetsApi };
  for await (const event of startGeneration(deps, runInput as Parameters<typeof startGeneration>[1], signal)) {
    yield { type: event.type, ...("data" in event ? { data: event.data } : {}) };
  }
}
