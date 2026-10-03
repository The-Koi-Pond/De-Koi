// Kept apart from the capture queue so the app shell can listen without
// loading the capture engine at startup.
export interface AutomaticMemoryCaptureCompletion {
  chatId: string;
  assistantMessageId: string;
  operation: "created" | "updated";
  memory: { id: string; content: string };
}

export interface AutomaticMemoryCaptureStatus {
  chatId: string;
  assistantMessageId: string;
  status: "processing" | "retryable" | "failed" | "completed";
}

type AutomaticMemoryCaptureCompletionListener = (completion: AutomaticMemoryCaptureCompletion) => void;
type AutomaticMemoryCaptureStatusListener = (status: AutomaticMemoryCaptureStatus) => void;

const completionListeners = new Set<AutomaticMemoryCaptureCompletionListener>();
const statusListeners = new Set<AutomaticMemoryCaptureStatusListener>();

export function subscribeAutomaticMemoryCaptureCompletions(
  listener: AutomaticMemoryCaptureCompletionListener,
): () => void {
  completionListeners.add(listener);
  return () => completionListeners.delete(listener);
}

export function subscribeAutomaticMemoryCaptureStatuses(listener: AutomaticMemoryCaptureStatusListener): () => void {
  statusListeners.add(listener);
  return () => statusListeners.delete(listener);
}

export function publishMemoryCaptureCompletion(completion: AutomaticMemoryCaptureCompletion): void {
  for (const listener of completionListeners) {
    try {
      listener(completion);
    } catch {
      // UI observers cannot invalidate a capture that is already durable.
    }
  }
}

export function publishMemoryCaptureStatus(status: AutomaticMemoryCaptureStatus): void {
  for (const listener of statusListeners) {
    try {
      listener(status);
    } catch {
      // UI observers cannot invalidate a lifecycle state that is already durable.
    }
  }
}
