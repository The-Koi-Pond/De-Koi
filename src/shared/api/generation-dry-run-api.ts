import {
  dryRunGeneration,
  type GenerationDryRunEvent,
  type GenerationDryRunInput,
} from "../../engine/generation/start-generation";
import { integrationGateway } from "./integration-gateway";
import { llmApi } from "./llm-api";
import { storageApi } from "./storage-api";
import { visualAssetsApi } from "./visual-assets-api";

export type { GenerationDryRunEvent, GenerationDryRunInput };

const activeDryRuns = new Map<string, AbortController>();

function createRunId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `generation-dry-run-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function abortError(): DOMException {
  return new DOMException("The operation was aborted.", "AbortError");
}

export async function* streamGenerationDryRun(
  input: GenerationDryRunInput,
  options: { runId?: string | null; signal?: AbortSignal } = {},
): AsyncGenerator<GenerationDryRunEvent> {
  const runId = (options.runId ?? input.runId ?? createRunId()).trim() || createRunId();
  const controller = new AbortController();
  const abort = () => controller.abort();
  activeDryRuns.get(runId)?.abort();
  activeDryRuns.set(runId, controller);
  options.signal?.addEventListener("abort", abort, { once: true });
  if (options.signal?.aborted) controller.abort();

  try {
    if (controller.signal.aborted) throw abortError();
    yield* dryRunGeneration(
      { storage: storageApi, llm: llmApi, integrations: integrationGateway, visuals: visualAssetsApi },
      { ...input, runId },
      controller.signal,
    );
  } finally {
    options.signal?.removeEventListener("abort", abort);
    if (activeDryRuns.get(runId) === controller) activeDryRuns.delete(runId);
  }
}

export function abortGenerationDryRun(runId: string): boolean {
  const controller = activeDryRuns.get(runId.trim());
  if (!controller) return false;
  controller.abort();
  activeDryRuns.delete(runId.trim());
  return true;
}
