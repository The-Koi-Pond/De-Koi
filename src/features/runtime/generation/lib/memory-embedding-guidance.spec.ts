import { describe, expect, it } from "vitest";

import { resolveMemoryEmbeddingGuidance } from "./memory-embedding-guidance";

describe("resolveMemoryEmbeddingGuidance", () => {
  it("flags an active connection with no embedding model", () => {
    expect(
      resolveMemoryEmbeddingGuidance(
        { connectionId: "chat-connection" },
        [{ id: "chat-connection", name: "Chat API", provider: "custom", embeddingModel: "" }],
      ),
    ).toEqual({
      available: false,
      connectionId: "chat-connection",
      connectionName: "Chat API",
      reason: "missing_model",
    });
  });

  it("accepts a configured dedicated embedding connection", () => {
    expect(
      resolveMemoryEmbeddingGuidance(
        { connectionId: "chat-connection" },
        [
          {
            id: "chat-connection",
            name: "ChatGPT",
            provider: "openai_chatgpt",
            embeddingConnectionId: "embedding-connection",
          },
          {
            id: "embedding-connection",
            name: "OpenAI Embeddings",
            provider: "openai",
            embeddingModel: "text-embedding-3-small",
          },
        ],
      ),
    ).toMatchObject({ available: true, connectionId: "embedding-connection" });
  });

  it("points a stale dedicated selection at the missing connection id", () => {
    expect(
      resolveMemoryEmbeddingGuidance({ connectionId: "chat-connection", embeddingConnectionId: "deleted-connection" }, [
        { id: "chat-connection", name: "Chat API", provider: "custom", embeddingModel: "embed-v1" },
      ]),
    ).toMatchObject({ available: false, connectionId: "deleted-connection", reason: "missing_connection" });
  });
});
