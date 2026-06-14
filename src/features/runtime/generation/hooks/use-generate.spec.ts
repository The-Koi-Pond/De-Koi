import { describe, expect, it, vi } from "vitest";
import { generateAndApplyBackgroundRequest } from "./use-generate";
import type { AgentResult } from "../../../../engine/contracts/types/agent";

function backgroundResult(generate: Record<string, unknown>): AgentResult {
  return {
    agentId: "background-agent",
    agentType: "background",
    type: "background_change",
    success: true,
    data: {
      chosen: null,
      generate,
    },
  } as AgentResult;
}

describe("generateAndApplyBackgroundRequest", () => {
  it("executes valid background-agent generate requests and applies the uploaded background", async () => {
    const imageGenerate = vi.fn();
    const image = {
      generate: async <T = unknown>(input: Record<string, unknown>): Promise<T> => {
        imageGenerate(input);
        return {
          base64: "iVBORw0KGgo=",
          mimeType: "image/png",
          ext: "png",
        } as T;
      },
    };
    const upload = vi.fn();
    const backgrounds = {
      upload: async <T = unknown>(file: File): Promise<T> => {
        upload(file);
        return {
          filename: file.name,
          url: "asset://generated",
        } as T;
      },
    };
    const applyChoice = vi.fn(async () => undefined);

    const chosen = await generateAndApplyBackgroundRequest(
      "chat-1",
      backgroundResult({
        location: "Moonlit Archive",
        prompt: "Wide background of a moonlit archive, empty, no characters.",
        reason: "No listed background matches the new location.",
      }),
      {
        storage: {
          async get(entity: string) {
            if (entity === "agents") return { settings: { imageConnectionId: "image-conn" } };
            if (entity === "chats") return { metadata: {} };
            return null;
          },
          async list() {
            return [];
          },
        } as never,
        backgrounds,
        image,
        applyChoice,
      },
    );

    expect(imageGenerate).toHaveBeenCalledWith(
      expect.objectContaining({
        connectionId: "image-conn",
        kind: "background",
        prompt: "Wide background of a moonlit archive, empty, no characters.",
        width: 1280,
        height: 720,
      }),
    );
    expect(upload).toHaveBeenCalledTimes(1);
    expect(upload.mock.calls[0]?.[0].name).toBe("moonlit-archive.png");
    expect(applyChoice).toHaveBeenCalledWith("chat-1", "moonlit-archive.png");
    expect(chosen).toBe("moonlit-archive.png");
  });

  it("ignores malformed generate payloads without calling providers", async () => {
    const imageGenerate = vi.fn();
    const upload = vi.fn();
    const image = {
      generate: async <T = unknown>(input: Record<string, unknown>): Promise<T> => {
        imageGenerate(input);
        return undefined as T;
      },
    };
    const backgrounds = {
      upload: async <T = unknown>(file: File): Promise<T> => {
        upload(file);
        return undefined as T;
      },
    };
    const applyChoice = vi.fn();

    const chosen = await generateAndApplyBackgroundRequest("chat-1", backgroundResult({ location: "Nowhere" }), {
      storage: {
        async get() {
          return null;
        },
        async list() {
          return [];
        },
      } as never,
      backgrounds,
      image,
      applyChoice,
    });

    expect(chosen).toBeNull();
    expect(imageGenerate).not.toHaveBeenCalled();
    expect(upload).not.toHaveBeenCalled();
    expect(applyChoice).not.toHaveBeenCalled();
  });
});
