import { describe, expect, it, vi } from "vitest";
import type { StorageGateway } from "../capabilities/storage";
import {
  classifyEffectiveEmbeddingConfiguration,
  resolveEffectiveEmbeddingConfiguration,
} from "./effective-embedding-configuration";

describe("effective embedding configuration", () => {
  it("uses a model configured directly on the generation connection", () => {
    expect(
      classifyEffectiveEmbeddingConfiguration({
        connection: {
          id: "chat-connection",
          name: "Chat Connection",
          provider: "custom",
          embeddingModel: "text-embedding-3-small",
        },
        chatEmbeddingConnectionId: null,
        embeddingConnection: null,
      }),
    ).toEqual({
      available: true,
      connectionId: "chat-connection",
      connectionName: "Chat Connection",
      model: "text-embedding-3-small",
      semanticConnectionId: "chat-connection",
    });
  });

  it("uses a dedicated embedding connection and its model", () => {
    expect(
      classifyEffectiveEmbeddingConfiguration({
        connection: {
          id: "chat-connection",
          name: "Chat Connection",
          provider: "openai_chatgpt",
          embeddingModel: "",
          embeddingConnectionId: "embedding-connection",
        },
        chatEmbeddingConnectionId: null,
        embeddingConnection: {
          id: "embedding-connection",
          name: "Embedding Connection",
          provider: "openai",
          embeddingModel: "text-embedding-3-small",
        },
      }),
    ).toEqual({
      available: true,
      connectionId: "embedding-connection",
      connectionName: "Embedding Connection",
      model: "text-embedding-3-small",
      semanticConnectionId: "embedding-connection",
    });
  });

  it("uses the explicit model from the generation connection with a dedicated embedding transport", () => {
    expect(
      classifyEffectiveEmbeddingConfiguration({
        connection: {
          id: "chat-connection",
          name: "Chat Connection",
          provider: "custom",
          embeddingModel: "embed-v1",
          embeddingConnectionId: "embedding-connection",
        },
        chatEmbeddingConnectionId: null,
        embeddingConnection: {
          id: "embedding-connection",
          name: "Embedding Connection",
          provider: "custom",
          embeddingModel: "",
        },
      }),
    ).toMatchObject({
      available: true,
      connectionId: "embedding-connection",
      model: "embed-v1",
      semanticConnectionId: null,
    });
  });

  it("reports missing models instead of treating lexical fallback as an error", () => {
    expect(
      classifyEffectiveEmbeddingConfiguration({
        connection: {
          id: "chat-connection",
          name: "Chat Connection",
          provider: "custom",
          embeddingModel: "",
        },
        chatEmbeddingConnectionId: null,
        embeddingConnection: null,
      }),
    ).toEqual({
      available: false,
      connectionId: "chat-connection",
      connectionName: "Chat Connection",
      reason: "missing_model",
    });
  });

  it("reports unsupported subscription providers without a dedicated connection", () => {
    expect(
      classifyEffectiveEmbeddingConfiguration({
        connection: {
          id: "chatgpt-connection",
          name: "ChatGPT",
          provider: "openai_chatgpt",
          embeddingModel: "text-embedding-3-small",
        },
        chatEmbeddingConnectionId: null,
        embeddingConnection: null,
      }),
    ).toMatchObject({ available: false, reason: "unsupported_provider" });
  });

  it("reports a stale dedicated connection and loads only that record", async () => {
    const get = vi.fn(async () => null);
    const storage = { get } as unknown as StorageGateway;

    await expect(
      resolveEffectiveEmbeddingConfiguration(
        storage,
        {},
        {
          id: "chat-connection",
          name: "Chat Connection",
          provider: "custom",
          embeddingConnectionId: "missing-connection",
        },
      ),
    ).resolves.toEqual({
      available: false,
      connectionId: "missing-connection",
      connectionName: "Chat Connection",
      reason: "missing_connection",
    });
    expect(get).toHaveBeenCalledWith("connections", "missing-connection");
  });

  it("keeps the runtime-only Local Model available as a dedicated embedding connection", async () => {
    const get = vi.fn(async () => null);
    const storage = { get } as unknown as StorageGateway;

    await expect(
      resolveEffectiveEmbeddingConfiguration(
        storage,
        {},
        {
          id: "chat-connection",
          name: "Chat Connection",
          provider: "custom",
          embeddingConnectionId: "sidecar:local",
        },
      ),
    ).resolves.toEqual({
      available: true,
      connectionId: "sidecar:local",
      connectionName: "Local Model",
      model: null,
      semanticConnectionId: "sidecar:local",
    });
    expect(get).not.toHaveBeenCalled();
  });

  it("gives a chat-level embedding override precedence", async () => {
    const get = vi.fn(async (_entity: string, id: string) => ({
      id,
      name: "Chat Embeddings",
      provider: "openai",
      embeddingModel: "chat-embed-v2",
    }));
    const storage = { get } as unknown as StorageGateway;

    await expect(
      resolveEffectiveEmbeddingConfiguration(
        storage,
        { embeddingConnectionId: "chat-embedding" },
        {
          id: "chat-connection",
          name: "Chat Connection",
          provider: "custom",
          embeddingModel: "default-embed",
          embeddingConnectionId: "connection-embedding",
        },
      ),
    ).resolves.toEqual({
      available: true,
      connectionId: "chat-embedding",
      connectionName: "Chat Embeddings",
      model: "chat-embed-v2",
      semanticConnectionId: "chat-embedding",
    });
    expect(get).toHaveBeenCalledWith("connections", "chat-embedding");
  });
});
