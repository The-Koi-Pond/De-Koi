import { describe, expect, it } from "vitest";

import {
  buildIllustrationNegativePrompt,
  generateIllustrationAttachments,
  ILLUSTRATOR_TEXT_NEGATIVE_PROMPT,
  illustratorPromptData,
  resolveIllustrationImageConnectionId,
} from "./start-generation";
import type { AgentResult } from "../contracts/types/agent";
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

describe("illustratorPromptData", () => {
  it("accepts common LLM image prompt shapes from manual Illustrator retries", () => {
    const result: AgentResult = {
      agentId: "illustrator",
      agentType: "illustrator",
      type: "image_prompt",
      data: {
        should_generate: "true",
        image_prompt: "cinematic koi pond at sunset",
        negative_prompt: "text, watermark",
        visible_characters: ["Deki"],
      },
      tokensUsed: 0,
      durationMs: 0,
      success: true,
      error: null,
    };

    expect(illustratorPromptData(result)).toEqual({
      agentId: "illustrator",
      prompt: "cinematic koi pond at sunset",
      reason: "",
      negativePrompt: "text, watermark",
      characterNames: ["Deki"],
    });
  });

  it("rejects prompt-shaped data without an explicit affirmative generate flag", () => {
    const result: AgentResult = {
      agentId: "illustrator",
      agentType: "illustrator",
      type: "image_prompt",
      data: {
        image_prompt: "cinematic koi pond at sunset",
      },
      tokensUsed: 0,
      durationMs: 0,
      success: true,
      error: null,
    };

    expect(illustratorPromptData(result)).toBeNull();
  });

  it("rejects generic nested result envelopes", () => {
    const result: AgentResult = {
      agentId: "illustrator",
      agentType: "illustrator",
      type: "image_prompt",
      data: {
        output: {
          should_generate: "true",
          image_prompt: "cinematic koi pond at sunset",
        },
      },
      tokensUsed: 0,
      durationMs: 0,
      success: true,
      error: null,
    };

    expect(illustratorPromptData(result)).toBeNull();
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

describe("generateIllustrationAttachments", () => {
  const illustrationResult: AgentResult = {
    agentId: "illustrator",
    agentType: "illustrator",
    type: "image_prompt",
    data: { shouldGenerate: true, prompt: "A quiet library at dusk." },
    tokensUsed: 0,
    durationMs: 0,
    success: true,
    error: null,
  };

  it("does not toast for an automatic illustration when no image connection exists", async () => {
    const result = await generateIllustrationAttachments({
      deps: {
        storage: testStorage({ connections: [] }),
        integrations: { image: { generate: async () => ({}) } },
      } as never,
      chat: { id: "chat-1", metadata: {} },
      results: [illustrationResult],
      reportUnavailable: false,
    });

    expect(result).toEqual({ attachments: [], events: [] });
  });

  it("still reports a missing image connection for an explicit illustration request", async () => {
    const result = await generateIllustrationAttachments({
      deps: {
        storage: testStorage({ connections: [] }),
        integrations: { image: { generate: async () => ({}) } },
      } as never,
      chat: { id: "chat-1", metadata: {} },
      results: [illustrationResult],
      reportUnavailable: true,
    });

    expect(result.events).toEqual([
      {
        type: "illustration_error",
        data: { error: "No image generation connection configured for the Illustrator agent." },
      },
    ]);
  });
});
