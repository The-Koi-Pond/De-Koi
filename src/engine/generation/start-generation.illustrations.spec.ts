import { describe, expect, it } from "vitest";

import {
  buildIllustrationNegativePrompt,
  ILLUSTRATOR_TEXT_NEGATIVE_PROMPT,
  resolveIllustrationImageConnectionId,
} from "./start-generation";
import type { StorageEntity, StorageGateway } from "../capabilities/storage";
import type { JsonRecord } from "./runtime-records";

function testStorage(args: { agents?: JsonRecord[]; connections?: JsonRecord[] }): StorageGateway {
  return {
    async list<T = unknown>(entity: StorageEntity): Promise<T[]> {
      if (entity === "agents") return (args.agents ?? []) as T[];
      if (entity === "connections") return (args.connections ?? []) as T[];
      return [];
    },
    async get<T = unknown>(entity: StorageEntity, id: string): Promise<T | null> {
      if (entity === "agents") return ((args.agents ?? []).find((item) => item.id === id) ?? null) as T | null;
      return null;
    },
  } as unknown as StorageGateway;
}

describe("buildIllustrationNegativePrompt", () => {
  it("keeps caller negative prompts and appends the Illustrator text guard", () => {
    const negativePrompt = buildIllustrationNegativePrompt({
      itemNegativePrompt: "bad hands",
      agentNegativePrompt: "low quality",
      chatIllustrationNegativePrompt: "blurry",
      chatSelfieNegativePrompt: "extra fingers",
    });

    expect(negativePrompt).toBe(`bad hands, low quality, blurry, extra fingers, ${ILLUSTRATOR_TEXT_NEGATIVE_PROMPT}`);
    expect(negativePrompt).toContain("speech bubbles");
    expect(negativePrompt).toContain("readable text");
  });

  it("deduplicates whole prompt fragments while preserving the text guard", () => {
    const negativePrompt = buildIllustrationNegativePrompt({
      itemNegativePrompt: "low quality",
      agentNegativePrompt: "LOW QUALITY",
      chatIllustrationNegativePrompt: ILLUSTRATOR_TEXT_NEGATIVE_PROMPT,
    });

    expect(negativePrompt).toBe(`low quality, ${ILLUSTRATOR_TEXT_NEGATIVE_PROMPT}`);
  });
});

describe("resolveIllustrationImageConnectionId", () => {
  it("uses the Default for Illustrator connection instead of the chat selfie connection", async () => {
    const connectionId = await resolveIllustrationImageConnectionId({
      storage: testStorage({
        agents: [{ id: "illustrator", type: "illustrator", settings: {} }],
        connections: [
          {
            id: "agent-default",
            provider: "openai",
            defaultForAgents: true,
          },
          {
            id: "selfie-connection",
            provider: "image_generation",
          },
          {
            id: "illustrator-default",
            provider: "image_generation",
            defaultForAgents: true,
          },
        ],
      }),
      chat: {
        id: "chat-1",
        mode: "roleplay",
        characterIds: ["char-1"],
        metadata: { imageGenConnectionId: "selfie-connection" },
      },
      agentId: "illustrator",
    });

    expect(connectionId).toBe("illustrator-default");
  });
});
