import {
  classifyEffectiveEmbeddingConfiguration,
  type EffectiveEmbeddingConfiguration,
} from "../../../../engine/generation/effective-embedding-configuration";
import { isRecord, readString, type JsonRecord } from "../../../../engine/generation/runtime-records";

// Read as an error by first-timers ("did I break something?"), so it leads with what works and keeps setup words for
// the screen it opens (#1783).
export const MEMORY_EMBEDDING_UNAVAILABLE_TITLE = "Memory is on";
export const MEMORY_EMBEDDING_UNAVAILABLE_DESCRIPTION =
  "Characters remember this chat by matching words. Optional: for memory that matches meaning too, add an embedding model to your connection.";

export function resolveMemoryEmbeddingGuidance(
  chat: JsonRecord,
  connections: readonly unknown[],
): EffectiveEmbeddingConfiguration {
  const connectionId = readString(chat.connectionId).trim();
  const connection = connections.find(
    (candidate) => isRecord(candidate) && readString(candidate.id).trim() === connectionId,
  );
  if (!connection || !isRecord(connection)) {
    return {
      available: false,
      connectionId: connectionId || null,
      connectionName: "Selected connection",
      reason: "missing_connection",
    };
  }

  const chatEmbeddingConnectionId = readString(chat.embeddingConnectionId).trim() || null;
  const embeddingConnectionId =
    chatEmbeddingConnectionId || readString(connection.embeddingConnectionId).trim() || connectionId;
  const embeddingConnection =
    embeddingConnectionId && embeddingConnectionId !== connectionId
      ? connections.find(
          (candidate) => isRecord(candidate) && readString(candidate.id).trim() === embeddingConnectionId,
        )
      : null;

  return classifyEffectiveEmbeddingConfiguration({
    connection,
    chatEmbeddingConnectionId,
    embeddingConnection: isRecord(embeddingConnection) ? embeddingConnection : null,
  });
}
