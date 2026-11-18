import { describe, expect, it, vi } from "vitest";
import type { IntegrationGateway } from "../capabilities/integrations";
import type { StorageGateway } from "../capabilities/storage";
import { regenerateSelfieAttachment } from "./connected-commands";
import { isSelfieAttachment } from "../modes/chat/selfies/selfie-attachment";
import type { JsonRecord } from "./runtime-records";

const OLD_SELFIE = {
  type: "image",
  url: "/api/assets/gallery/chat-1/selfie_harlequin-8.png",
  filename: "selfie_harlequin-8.png",
  prompt: "harlequin (the freak circus), selfie, wagon",
  galleryId: "gallery-8",
  description: "lounging in his wagon",
};

function setup(overrides: { metadata?: JsonRecord; attachment?: JsonRecord } = {}) {
  const chat: JsonRecord = {
    id: "chat-1",
    mode: "conversation",
    characterIds: ["harlequin"],
    metadata: {
      imageGenConnectionId: "comfy-harlequin",
      selfieResolution: "832x1216",
      selfieNegativePrompt: "pink skin",
      ...overrides.metadata,
    },
  };
  const character: JsonRecord = {
    id: "harlequin",
    name: "Harlequin",
    data: { name: "Harlequin", extensions: { selfieAvoidTags: "blush" } },
  };
  const message: JsonRecord = {
    id: "m-1",
    chatId: "chat-1",
    role: "assistant",
    characterId: "harlequin",
    content: "Here.",
    extra: { attachments: [overrides.attachment ?? OLD_SELFIE] },
  };
  const gallery: JsonRecord[] = [];
  const storage = {
    async get<T>(entity: string, id: string): Promise<T | null> {
      if (entity === "chats" && id === chat.id) return chat as T;
      if (entity === "characters" && id === character.id) return character as T;
      if (entity === "connections") return { id, provider: "image_generation" } as T;
      return null;
    },
    async getChatMessage<T>(id: string): Promise<T | null> {
      return (id === message.id ? structuredClone(message) : null) as T | null;
    },
    async create<T>(entity: string, value: JsonRecord): Promise<T> {
      const row = { id: `gallery-new-${gallery.length + 1}`, ...value, url: "/api/assets/gallery/chat-1/new.png" };
      if (entity === "gallery") gallery.push(row);
      return row as T;
    },
    async patchChatMessageExtra<T>(id: string, patch: JsonRecord): Promise<T> {
      if (id === message.id) message.extra = { ...(message.extra as JsonRecord), ...patch };
      return message as T;
    },
  } as unknown as StorageGateway;
  const generate = vi.fn(async () => ({ base64: "AAAA", mimeType: "image/png", provider: "comfyui" }));
  const integrations = { image: { generate } } as unknown as IntegrationGateway;
  const regenerate = () =>
    regenerateSelfieAttachment({
      storage,
      integrations,
      chatId: "chat-1",
      messageId: "m-1",
      attachment: { galleryId: "gallery-8", url: OLD_SELFIE.url },
    });
  return { message, gallery, generate, regenerate };
}

describe("regenerating a selfie", () => {
  it("makes it again as a selfie with the chat's selfie connection, then swaps the picture on the message", async () => {
    const { message, gallery, generate, regenerate } = setup();

    await regenerate();

    expect(generate).toHaveBeenCalledWith(
      expect.objectContaining({
        connectionId: "comfy-harlequin",
        kind: "selfie",
        prompt: OLD_SELFIE.prompt,
        negativePrompt: "pink skin, blush",
        width: 832,
        height: 1216,
      }),
    );
    expect(gallery).toHaveLength(1);
    expect((message.extra as JsonRecord).attachments).toEqual([
      expect.objectContaining({
        kind: "selfie",
        galleryId: "gallery-new-1",
        url: "/api/assets/gallery/chat-1/new.png",
        prompt: OLD_SELFIE.prompt,
        description: "lounging in his wagon",
        characterId: "harlequin",
      }),
    ]);
  });

  it("keeps the old picture when the new one fails", async () => {
    const { message, gallery, generate, regenerate } = setup();
    generate.mockRejectedValueOnce(new Error("ComfyUI is not reachable"));

    await expect(regenerate()).rejects.toThrow("ComfyUI is not reachable");

    expect(gallery).toHaveLength(0);
    expect((message.extra as JsonRecord).attachments).toEqual([OLD_SELFIE]);
  });

  it("says what to set up when the chat has no selfie connection, and leaves the picture alone", async () => {
    const { message, generate, regenerate } = setup({ metadata: { imageGenConnectionId: "" } });

    await expect(regenerate()).rejects.toThrow("Choose an image connection for selfies");

    expect(generate).not.toHaveBeenCalled();
    expect((message.extra as JsonRecord).attachments).toEqual([OLD_SELFIE]);
  });

  it("reuses the selfie's own saved negatives and size when it has them", async () => {
    const { generate, regenerate } = setup({
      attachment: { ...OLD_SELFIE, kind: "selfie", negativePrompt: "saved negatives", width: 512, height: 768 },
    });

    await regenerate();

    expect(generate).toHaveBeenCalledWith(
      expect.objectContaining({ negativePrompt: "saved negatives", width: 512, height: 768 }),
    );
  });
});

describe("isSelfieAttachment", () => {
  it("knows marked selfies and selfies saved before the mark, but not other pictures", () => {
    expect(isSelfieAttachment({ type: "image", kind: "selfie", url: "x" })).toBe(true);
    expect(isSelfieAttachment(OLD_SELFIE)).toBe(true);
    expect(isSelfieAttachment({ type: "image", filename: "illustration_1.png", prompt: "a scene" })).toBe(false);
    expect(isSelfieAttachment({ type: "image/jpeg", filename: "PXL_20261114.jpg" })).toBe(false);
    expect(isSelfieAttachment({ type: "audio", kind: "selfie" })).toBe(false);
  });
});
