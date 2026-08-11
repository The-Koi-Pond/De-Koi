import {
  classifyEffectiveEmbeddingConfiguration,
  type EffectiveEmbeddingConfiguration,
} from "../../../../engine/generation/effective-embedding-configuration";
import { isRecord, readString, type JsonRecord } from "../../../../engine/generation/runtime-records";

export const MEMORY_EMBEDDING_UNAVAILABLE_TITLE = "Memory Recall is using local matching";
export const MEMORY_EMBEDDING_UNAVAILABLE_DESCRIPTION =
  "Semantic recall is off because no usable Embedding Model is configured. Memory Recall still works with local matching. Open the connection and fill in Embedding Model, or choose an embedding-capable Embedding Connection.";

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
