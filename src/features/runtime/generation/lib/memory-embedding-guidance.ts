import {
  classifyEffectiveEmbeddingConfiguration,
  type EffectiveEmbeddingConfiguration,
} from "../../../../engine/generation/effective-embedding-configuration";
import { isRecord, readString, type JsonRecord } from "../../../../engine/generation/runtime-records";

export const MEMORY_EMBEDDING_UNAVAILABLE_TITLE = "Memory is matching by keywords";
export const MEMORY_EMBEDDING_UNAVAILABLE_DESCRIPTION =
  "Characters still remember things, but they find them by matching words, not meaning. Optional: to match by meaning, open the connection and set an Embedding Model, or pick an Embedding Connection that has one.";

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
