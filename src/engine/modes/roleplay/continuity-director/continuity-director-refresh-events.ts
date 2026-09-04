export interface ContinuityDirectorRefreshCompletion {
  chatId: string;
}

type ContinuityDirectorRefreshCompletionListener = (completion: ContinuityDirectorRefreshCompletion) => void;

const completionListeners = new Set<ContinuityDirectorRefreshCompletionListener>();

export function subscribeContinuityDirectorRefreshCompletions(
  listener: ContinuityDirectorRefreshCompletionListener,
): () => void {
  completionListeners.add(listener);
  return () => completionListeners.delete(listener);
}

export function publishContinuityDirectorRefreshCompletion(
  completion: ContinuityDirectorRefreshCompletion,
): void {
  for (const listener of completionListeners) {
    try {
      listener(completion);
    } catch {
      // UI observers cannot affect a refresh that has already settled.
    }
  }
}
