import { describe, expect, it, vi } from "vitest";

import type { StorageGateway } from "../capabilities/storage";
import type { AgentResult } from "../contracts/types/agent";
import { generateBackgroundForAgentResult, type BackgroundGenerationDeps } from "./background-generation";

type Row = Record<string, unknown>;

const GENERATED = {
  image: "",
  base64: "iVBORw0KGgo=",
  mimeType: "image/png",
  ext: "png",
  provider: "test",
  model: "test",
};

const result = {
  agentId: "agent-background",
  agentType: "background",
  type: "background_change",
  success: true,
  data: { chosen: null, generate: { location: "Rainy harbor", prompt: "Wide shot of a rainy harbor, empty." } },
} as AgentResult;

/** One chat with no background, behind a compare-and-set like the runtime's `chat_update_if_unchanged`. */
function emptyChatStorage() {
  const chat: Row = { id: "chat-1", metadata: {} };
  const storage = {
    async get<T = unknown>(entity: string): Promise<T | null> {
      if (entity === "chats") return structuredClone(chat) as T;
      if (entity === "agents") return { settings: { imageConnectionId: "image-conn" } } as T;
      return null;
    },
    async list<T = unknown>(): Promise<T[]> {
      return [];
    },
    async updateChatIfUnchanged<T = unknown>(_chatId: string, expected: Row, patch: Row) {
      const metadata = chat.metadata as Row;
      const current = { metadata: { background: metadata.background ?? null } };
      if (JSON.stringify(current) !== JSON.stringify(expected)) return { updated: false, chat: chat as T };
      chat.metadata = { ...metadata, ...(patch.metadata as Row) };
      return { updated: true, chat: chat as T };
    },
  } as unknown as BackgroundGenerationDeps["storage"] & Pick<StorageGateway, "get">;
  return { chat, storage };
}

describe("generateBackgroundForAgentResult", () => {
  it("lets only one of two clients generating for the same empty chat set the background", async () => {
    const { chat, storage } = emptyChatStorage();
    let uploads = 0;
    const discard = vi.fn(async () => undefined);
    const onApplied = vi.fn();
    const deps = (): BackgroundGenerationDeps => ({
      storage,
      image: { generate: async () => GENERATED },
      // The library never overwrites: a second upload of the same name is stored under its own name.
      upload: async (image) => ({ filename: uploads++ === 0 ? image.filename : "rainy-harbor-1.png" }),
      onApplied,
      discard,
    });

    const outcomes = await Promise.all([
      generateBackgroundForAgentResult("chat-1", result, deps()),
      generateBackgroundForAgentResult("chat-1", result, deps()),
    ]);

    const winner = outcomes.find((outcome) => outcome !== null);
    expect(outcomes.filter((outcome) => outcome !== null)).toHaveLength(1);
    expect((chat.metadata as Row).background).toBe(winner);
    expect(onApplied).toHaveBeenCalledOnce();
    expect(onApplied).toHaveBeenCalledWith("chat-1", winner);
    // The loser removes only its own upload.
    expect(discard).toHaveBeenCalledOnce();
    expect(discard).not.toHaveBeenCalledWith(winner);
  });

  it("refuses to apply without the runtime's conditional chat write, removing its upload", async () => {
    const { storage } = emptyChatStorage();
    const discard = vi.fn(async () => undefined);

    await expect(
      generateBackgroundForAgentResult("chat-1", result, {
        storage: { get: storage.get, list: storage.list } as BackgroundGenerationDeps["storage"],
        image: { generate: async () => GENERATED },
        upload: async (image) => ({ filename: image.filename }),
        discard,
      }),
    ).rejects.toThrow("cannot set a chat background only if it is unset");
    expect(discard).toHaveBeenCalledWith("rainy-harbor.png");
  });
});
