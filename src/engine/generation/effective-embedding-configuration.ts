import type { StorageGateway } from "../capabilities/storage";
import { LOCAL_SIDECAR_CONNECTION_ID } from "../contracts/types/sidecar";
import { isRecord, readString, type JsonRecord } from "./runtime-records";

export type EmbeddingUnavailableReason = "missing_connection" | "missing_model" | "unsupported_provider";

export type EffectiveEmbeddingConfiguration =
  | {
      available: true;
      connectionId: string;
      connectionName: string;
      model: string | null;
      semanticConnectionId: string | null;
    }
  | {
      available: false;
      connectionId: string | null;
      connectionName: string;
      reason: EmbeddingUnavailableReason;
    };

interface EffectiveEmbeddingConfigurationInput {
  connection: JsonRecord;
  chatEmbeddingConnectionId?: string | null;
  embeddingConnection?: JsonRecord | null;
}

const EMBEDDING_UNSUPPORTED_PROVIDERS = new Set(["openai_chatgpt", "claude_subscription"]);

function connectionLabel(connection: JsonRecord, fallback = "Selected connection"): string {
  return readString(connection.name).trim() || readString(connection.id).trim() || fallback;
}

function selectedEmbeddingConnectionId(
  connection: JsonRecord,
  chatEmbeddingConnectionId?: string | null,
): string | null {
  return (
    readString(chatEmbeddingConnectionId).trim() ||
    readString(connection.embeddingConnectionId).trim() ||
    readString(connection.id).trim() ||
    null
  );
}

export function classifyEffectiveEmbeddingConfiguration(
  input: EffectiveEmbeddingConfigurationInput,
): EffectiveEmbeddingConfiguration {
  const connectionId = readString(input.connection.id).trim();
  const targetId = selectedEmbeddingConnectionId(input.connection, input.chatEmbeddingConnectionId);
  const usesSeparateConnection = !!targetId && targetId !== connectionId;
  const target = usesSeparateConnection ? input.embeddingConnection : input.connection;

  if (targetId === LOCAL_SIDECAR_CONNECTION_ID) {
    return {
      available: true,
      connectionId: LOCAL_SIDECAR_CONNECTION_ID,
      connectionName: isRecord(target) ? connectionLabel(target, "Local Model") : "Local Model",
      model: null,
      semanticConnectionId: LOCAL_SIDECAR_CONNECTION_ID,
    };
  }

  if (!target || !isRecord(target)) {
    return {
      available: false,
      connectionId: targetId,
      connectionName: connectionLabel(input.connection),
      reason: "missing_connection",
    };
  }

  const targetName = connectionLabel(target, connectionLabel(input.connection));
  const provider = readString(target.provider).trim();
  if (EMBEDDING_UNSUPPORTED_PROVIDERS.has(provider)) {
    return {
      available: false,
      connectionId: targetId,
      connectionName: targetName,
      reason: "unsupported_provider",
    };
  }

  const model =
    readString(target.embeddingModel).trim() ||
    (usesSeparateConnection ? readString(input.connection.embeddingModel).trim() : "");
  if (!model) {
    return {
      available: false,
      connectionId: targetId,
      connectionName: targetName,
      reason: "missing_model",
    };
  }

  if (!targetId) {
    return {
      available: false,
      connectionId: null,
      connectionName: targetName,
      reason: "missing_connection",
    };
  }

  return {
    available: true,
    connectionId: targetId,
    connectionName: targetName,
    model,
    semanticConnectionId: readString(target.embeddingModel).trim() ? targetId : null,
  };
}

export async function resolveEffectiveEmbeddingConfiguration(
  storage: StorageGateway,
  chat: JsonRecord,
  connection: JsonRecord,
): Promise<EffectiveEmbeddingConfiguration> {
  const chatEmbeddingConnectionId = readString(chat.embeddingConnectionId).trim() || null;
  const connectionId = readString(connection.id).trim();
  const targetId = selectedEmbeddingConnectionId(connection, chatEmbeddingConnectionId);
  const embeddingConnection =
    targetId && targetId !== connectionId && targetId !== LOCAL_SIDECAR_CONNECTION_ID
      ? await storage.get<unknown>("connections", targetId).then((value) => (isRecord(value) ? value : null))
      : null;

  return classifyEffectiveEmbeddingConfiguration({
    connection,
    chatEmbeddingConnectionId,
    embeddingConnection,
  });
}
