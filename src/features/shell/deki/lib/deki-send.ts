import {
  runDekiEntry,
  type DekiAttachment,
  type DekiChatAccessGrant,
  type DekiEntryAction,
  type DekiGateway,
  type DekiMessage,
  type DekiPersonaContext,
  type DekiWebResearchGrant,
} from "../../../../engine/deki/deki-entry";
import {
  compactDekiHistory,
  dekiContextMessages,
  type DekiCompactionConnection,
  type DekiCompactionState,
} from "../../../../engine/deki/deki-history";
import type { LlmGateway } from "../../../../engine/capabilities/llm";

type DekiHistoryWriter = {
  appendMessage(message: {
    sessionId?: string | null;
    role: "user" | "assistant";
    content: string;
    action?: DekiEntryAction | null;
  }): Promise<DekiMessage>;
  saveCompaction(sessionId: string | null | undefined, compaction: DekiCompactionState): Promise<DekiCompactionState>;
};

export type DetachedDekiSendInput = {
  sessionId: string | null;
  userMessage: string;
  existingUser?: DekiMessage;
  messages: DekiMessage[];
  compaction: DekiCompactionState;
  connection: DekiCompactionConnection;
  persona: DekiPersonaContext | null;
  attachments: DekiAttachment[];
  chatAccessGrants?: DekiChatAccessGrant[];
  webResearchGrants?: DekiWebResearchGrant[];
  history: DekiHistoryWriter;
  llm: LlmGateway;
  gateway: DekiGateway;
  onUserMessagePersisted?: (user: DekiMessage, messagesWithUser: DekiMessage[]) => void | Promise<void>;
  onCompactionSaved?: (compaction: DekiCompactionState) => void | Promise<void>;
  onAssistantMessagePersisted?: (
    assistant: DekiMessage,
    messagesWithAssistant: DekiMessage[],
  ) => void | Promise<void>;
};

export type DetachedDekiSendResult = {
  user: DekiMessage;
  assistant: DekiMessage;
  messagesWithUser: DekiMessage[];
  messagesWithAssistant: DekiMessage[];
  compaction: DekiCompactionState;
};

export async function runDetachedDekiSend(input: DetachedDekiSendInput): Promise<DetachedDekiSendResult> {
  const user =
    input.existingUser ??
    (await input.history.appendMessage({
      sessionId: input.sessionId,
      role: "user",
      content: input.userMessage,
    }));
  const messagesWithUser = input.existingUser ? input.messages : [...input.messages, user];
  await input.onUserMessagePersisted?.(user, messagesWithUser);
  const compactionResult = await compactDekiHistory({
    messages: messagesWithUser,
    compaction: input.compaction,
    connection: input.connection,
    llm: input.llm,
  });
  const nextCompaction = compactionResult.compaction;
  const savedCompaction = compactionResult.compacted
    ? await input.history.saveCompaction(input.sessionId, nextCompaction)
    : nextCompaction;
  await input.onCompactionSaved?.(savedCompaction);
  const contextMessages = dekiContextMessages(messagesWithUser, savedCompaction).filter(
    (message) => message.id !== user.id,
  );
  const response = await runDekiEntry(
    {
      userMessage: input.userMessage,
      messages: contextMessages,
      compactedSummary: savedCompaction.compactedSummary,
      connectionId: input.connection.id ?? null,
      persona: input.persona,
      attachments: input.attachments,
      chatAccessGrants: input.chatAccessGrants ?? [],
      webResearchGrants: input.webResearchGrants ?? [],
    },
    input.gateway,
  );
  const assistant = await input.history.appendMessage({
    sessionId: input.sessionId,
    role: "assistant",
    content: response.content,
    action: response.action,
  });
  const messagesWithAssistant = [...messagesWithUser, assistant];
  await input.onAssistantMessagePersisted?.(assistant, messagesWithAssistant);
  return {
    user,
    assistant,
    messagesWithUser,
    messagesWithAssistant,
    compaction: savedCompaction,
  };
}
