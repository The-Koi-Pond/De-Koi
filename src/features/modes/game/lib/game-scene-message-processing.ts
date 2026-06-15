export type SceneAssistantMessage = {
  id: string;
  content?: string | null;
};

export type SceneAssistantProcessStatus =
  | "missing-message"
  | "missing-content"
  | "duplicate"
  | "restored-skip"
  | "processed";

export type SceneAssistantProcessOutcome<TMessage extends SceneAssistantMessage = SceneAssistantMessage> = {
  messageToProcess: (TMessage & { content: string }) | null;
  messageId: string | null;
  status: SceneAssistantProcessStatus;
};

export type ProcessLatestSceneAssistantMessageParams<TMessage extends SceneAssistantMessage> = {
  isRestored: boolean;
  lastProcessedMessageId: string | null;
  latestMessage: TMessage | null | undefined;
  markProcessed: (messageId: string) => void;
  processMessage: (message: TMessage & { content: string }) => void;
};

export function processLatestSceneAssistantMessage<TMessage extends SceneAssistantMessage>({
  isRestored,
  lastProcessedMessageId,
  latestMessage,
  markProcessed,
  processMessage,
}: ProcessLatestSceneAssistantMessageParams<TMessage>): SceneAssistantProcessOutcome<TMessage> {
  if (!latestMessage) {
    return { messageId: null, messageToProcess: null, status: "missing-message" };
  }
  if (!latestMessage.content) {
    return { messageId: latestMessage.id, messageToProcess: null, status: "missing-content" };
  }
  if (lastProcessedMessageId === latestMessage.id) {
    return { messageId: latestMessage.id, messageToProcess: null, status: "duplicate" };
  }

  markProcessed(latestMessage.id);
  if (isRestored) {
    return { messageId: latestMessage.id, messageToProcess: null, status: "restored-skip" };
  }

  const messageToProcess = latestMessage as TMessage & { content: string };
  processMessage(messageToProcess);
  return { messageId: latestMessage.id, messageToProcess, status: "processed" };
}

export type SceneAssistantProcessingTimeout = {
  attempts: number;
  latestMessageHadContent: boolean;
  latestMessageId: string | null;
};

export type ScheduleSceneAssistantProcessingParams<TMessage extends SceneAssistantMessage> = {
  getLastProcessedMessageId: () => string | null;
  getLatestMessage: () => TMessage | null | undefined;
  maxAttempts?: number;
  onTimeout?: (timeout: SceneAssistantProcessingTimeout) => void;
  processLatestMessage: () => void;
  requestFrame: (callback: () => void) => void;
  retryAlreadyProcessed?: boolean;
  retryDelayMs?: number;
  setDelay: (callback: () => void, delayMs: number) => unknown;
};

export function scheduleSceneAssistantProcessing<TMessage extends SceneAssistantMessage>({
  getLastProcessedMessageId,
  getLatestMessage,
  maxAttempts = 10,
  onTimeout,
  processLatestMessage,
  requestFrame,
  retryAlreadyProcessed = false,
  retryDelayMs = 200,
  setDelay,
}: ScheduleSceneAssistantProcessingParams<TMessage>) {
  let cancelled = false;

  const tryProcess = (attempt: number) => {
    if (cancelled) return;

    const message = getLatestMessage();
    if (message?.content) {
      if (getLastProcessedMessageId() === message.id) {
        if (retryAlreadyProcessed && attempt < maxAttempts) {
          setDelay(() => tryProcess(attempt + 1), retryDelayMs);
        }
        return;
      }
      processLatestMessage();
      return;
    }

    if (attempt < maxAttempts) {
      setDelay(() => tryProcess(attempt + 1), retryDelayMs);
      return;
    }

    onTimeout?.({
      attempts: attempt + 1,
      latestMessageHadContent: !!message?.content,
      latestMessageId: message?.id ?? null,
    });
  };

  requestFrame(() => tryProcess(0));

  return {
    cancel: () => {
      cancelled = true;
    },
  };
}
