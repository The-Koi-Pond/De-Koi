import { QueryClient } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { chatKeys } from "../../../catalog/chats/index";
import { useChatStore } from "../../../../shared/stores/chat.store";
import { useUIStore } from "../../../../shared/stores/ui.store";
import { generateAndApplyBackgroundRequest, runGenerationWithUi } from "./use-generate";
import type { AgentResult } from "../../../../engine/contracts/types/agent";
import type { Chat, StreamEvent } from "../../../../engine/contracts/types/chat";

afterEach(() => {
  vi.restoreAllMocks();
  useChatStore.getState().reset();
  useUIStore.getState().setEnableStreaming(true);
  useUIStore.getState().setStreamingSpeed(50);
});

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

describe("runGenerationWithUi", () => {
  it("flushes pending typewriter text when the page loses focus", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const chatId = "chat-background-flush";
    queryClient.setQueryData(chatKeys.detail(chatId), {
      id: chatId,
      mode: "conversation",
      metadata: {},
    } as Chat);
    useChatStore.getState().setActiveChatId(chatId);
    useUIStore.getState().setEnableStreaming(true);
    useUIStore.getState().setStreamingSpeed(1);

    const requestAnimationFrame = vi.spyOn(window, "requestAnimationFrame").mockImplementation(() => 1);
    const cancelAnimationFrame = vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => undefined);
    const visibilityState = vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    const hasFocus = vi.spyOn(document, "hasFocus").mockReturnValue(true);
    let releaseStream: (() => void) | undefined;

    async function* stream(): AsyncGenerator<StreamEvent> {
      yield { type: "token", data: "hello" } as StreamEvent;
      await new Promise<void>((resolve) => {
        releaseStream = resolve;
      });
    }

    const run = runGenerationWithUi(queryClient, { chatId }, stream);
    for (let i = 0; i < 10 && requestAnimationFrame.mock.calls.length === 0; i += 1) {
      await Promise.resolve();
    }
    for (let i = 0; i < 10 && !releaseStream; i += 1) {
      await Promise.resolve();
    }

    expect(requestAnimationFrame).toHaveBeenCalledTimes(1);
    expect(useChatStore.getState().streamBuffer).toBe("");

    visibilityState.mockReturnValue("hidden");
    hasFocus.mockReturnValue(false);
    document.dispatchEvent(new Event("visibilitychange"));

    expect(useChatStore.getState().streamBuffer).toBe("hello");
    expect(releaseStream).toEqual(expect.any(Function));
    releaseStream?.();
    await run;
    expect(cancelAnimationFrame).toHaveBeenCalledWith(1);
    queryClient.clear();
  });
});
