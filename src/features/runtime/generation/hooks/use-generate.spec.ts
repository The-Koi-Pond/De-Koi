import { QueryClient } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { chatKeys } from "../../../catalog/chats/index";
import { getRecentClientDiagnostics } from "../../../../shared/lib/client-diagnostics";
import { MUSIC_PLAYBACK_EVENT, type MusicPlaybackEventDetail } from "../../../../shared/lib/music-playback-events";
import { useChatStore } from "../../../../shared/stores/chat.store";
import { useUIStore } from "../../../../shared/stores/ui.store";
import {
  generateAndApplyBackgroundRequest,
  handleGenerationDiagnosticEvent,
  handleSceneCreatedGenerationEvent,
  isTrackerPatchRetryRequest,
  runGenerationWithUi,
  showAgentWarningToast,
} from "./use-generate";
import type { AgentResult } from "../../../../engine/contracts/types/agent";
import type { Chat, StreamEvent } from "../../../../engine/contracts/types/chat";

vi.mock("sonner", () => {
  const base = vi.fn();
  return {
    toast: Object.assign(base, {
      error: vi.fn(),
      info: vi.fn(),
      success: vi.fn(),
      warning: vi.fn(),
    }),
  };
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.clearAllMocks();
  window.localStorage.clear();
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

  it("does not generate over a background that is already set", async () => {
    const imageGenerate = vi.fn();
    const upload = vi.fn();
    const applyChoice = vi.fn();

    const chosen = await generateAndApplyBackgroundRequest(
      "chat-1",
      backgroundResult({
        location: "Moonlit Archive",
        prompt: "Wide background of a moonlit archive, empty, no characters.",
      }),
      {
        storage: {
          async get(entity: string) {
            if (entity === "chats") return { metadata: { background: "library/castle.png" } };
            if (entity === "agents") return { settings: { imageConnectionId: "image-conn" } };
            return null;
          },
          async list() {
            return [];
          },
        } as never,
        backgrounds: { upload: upload as never },
        image: { generate: imageGenerate as never },
        applyChoice,
      },
    );

    expect(chosen).toBeNull();
    expect(imageGenerate).not.toHaveBeenCalled();
    expect(upload).not.toHaveBeenCalled();
    expect(applyChoice).not.toHaveBeenCalled();
  });

  it("does not apply a generated background when one is selected during generation", async () => {
    let backgroundWasSelected = false;
    const upload = vi.fn();
    const applyChoice = vi.fn();
    const imageGenerate = vi.fn(async () => {
      backgroundWasSelected = true;
      return { base64: "iVBORw0KGgo=", mimeType: "image/png", ext: "png" };
    });

    const chosen = await generateAndApplyBackgroundRequest(
      "chat-1",
      backgroundResult({
        location: "Moonlit Archive",
        prompt: "Wide background of a moonlit archive, empty, no characters.",
      }),
      {
        storage: {
          async get(entity: string) {
            if (entity === "chats") {
              return { metadata: backgroundWasSelected ? { background: "library/castle.png" } : {} };
            }
            if (entity === "agents") return { settings: { imageConnectionId: "image-conn" } };
            return null;
          },
          async list() {
            return [];
          },
        } as never,
        backgrounds: { upload: upload as never },
        image: { generate: imageGenerate as never },
        applyChoice,
      },
    );

    expect(chosen).toBeNull();
    expect(imageGenerate).toHaveBeenCalledTimes(1);
    expect(upload).not.toHaveBeenCalled();
    expect(applyChoice).not.toHaveBeenCalled();
  });
});

describe("handleGenerationDiagnosticEvent", () => {
  it("records generation timing diagnostics for troubleshooting", () => {
    handleGenerationDiagnosticEvent({
      kind: "timing",
      name: "assemble-prompt",
      durationMs: 42,
      chatId: "chat-1",
      chatMode: "roleplay",
      groupChatMode: "merged",
      characterCount: 3,
      targetCharacterId: null,
      messageCount: 12,
      promptMessageCount: 8,
    });

    expect(getRecentClientDiagnostics()[0]).toEqual(
      expect.objectContaining({
        level: "info",
        source: "generation-timing",
        message: "assemble-prompt completed in 42ms",
        details: expect.objectContaining({
          chatId: "chat-1",
          chatMode: "roleplay",
          groupChatMode: "merged",
          characterCount: 3,
          messageCount: 12,
          promptMessageCount: 8,
        }),
      }),
    );
  });
});
describe("isTrackerPatchRetryRequest", () => {
  it("only classifies retry requests for agents that should return tracker patches", () => {
    expect(isTrackerPatchRetryRequest(["world-state", "character-tracker", "persona-stats", "custom-tracker"])).toBe(
      true,
    );
    expect(isTrackerPatchRetryRequest(["background"])).toBe(false);
    expect(isTrackerPatchRetryRequest(["expression"])).toBe(false);
    expect(isTrackerPatchRetryRequest(["quest"])).toBe(false);
    expect(isTrackerPatchRetryRequest(["world-state", "background"])).toBe(false);
    expect(isTrackerPatchRetryRequest([])).toBe(false);
  });
});

describe("showAgentWarningToast", () => {
  it("shows image delivery warnings as visible toasts", () => {
    showAgentWarningToast(
      {
        code: "image_attachment_delivery",
        severity: "warning",
        message: "large.png could not be delivered to the model.",
        agentNames: [],
      },
      new Set(),
    );

    expect(vi.mocked(toast.warning)).toHaveBeenCalledWith(
      "large.png could not be delivered to the model.",
      expect.objectContaining({ duration: 10_000 }),
    );
  });

  it("dismisses default agent connection warnings per connection key", () => {
    const firstWarning = {
      code: "default_agent_connection_active",
      severity: "warning",
      message: "One agent is using the default agent connection.",
      agentNames: ["One"],
      connectionId: "conn-paid",
      connectionName: "Paid API",
      model: "gpt-paid",
      dismissalKey: "default_agent_connection_active:conn-paid",
    };
    const otherWarning = {
      ...firstWarning,
      message: "Two agent is using the other default agent connection.",
      connectionId: "conn-other",
      connectionName: "Other API",
      dismissalKey: "default_agent_connection_active:conn-other",
    };

    showAgentWarningToast(firstWarning, new Set());
    const options = vi.mocked(toast.warning).mock.calls[0]?.[1] as
      | { action?: { label?: string; onClick?: () => void } }
      | undefined;
    expect(options?.action?.label).toBe("Don't warn again");

    options?.action?.onClick?.();
    showAgentWarningToast(firstWarning, new Set());
    showAgentWarningToast(otherWarning, new Set());

    expect(vi.mocked(toast.warning)).toHaveBeenCalledTimes(2);
    expect(vi.mocked(toast.warning).mock.calls[1]?.[0]).toBe(otherWarning.message);
  });
});
describe("runGenerationWithUi", () => {
  it("does not force a fresh Music Player pick for automatic roleplay cues", async () => {
    vi.useFakeTimers();
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const chatId = "chat-music-cadence";
    queryClient.setQueryData(chatKeys.detail(chatId), {
      id: chatId,
      mode: "roleplay",
      metadata: {},
    } as Chat);
    const playbackEvents: MusicPlaybackEventDetail[] = [];
    const onPlaybackEvent = (event: Event) => {
      playbackEvents.push((event as CustomEvent<MusicPlaybackEventDetail>).detail);
    };
    window.addEventListener(MUSIC_PLAYBACK_EVENT, onPlaybackEvent);

    async function* stream(): AsyncGenerator<StreamEvent> {
      yield {
        type: "agent_result",
        data: {
          agentId: "music-dj",
          agentType: "music-dj",
          type: "music_control",
          success: true,
          data: {
            action: "play",
            mood: "quiet wounded intimacy",
            setting: "forest cabin",
            intensity: "low",
            constraints: ["instrumental", "ambient", "no vocals"],
            volume: 35,
            reason: "The scene remains quiet and intimate.",
          },
        },
      } as StreamEvent;
      yield {
        type: "assistant_message",
        data: { id: "message-1", chatId, role: "assistant", content: "The cabin stays quiet." },
      } as StreamEvent;
      yield { type: "done" } as StreamEvent;
    }

    try {
      await runGenerationWithUi(queryClient, { chatId }, stream);
      await vi.advanceTimersByTimeAsync(20);
    } finally {
      window.removeEventListener(MUSIC_PLAYBACK_EVENT, onPlaybackEvent);
      queryClient.clear();
    }

    expect(playbackEvents).toContainEqual(
      expect.objectContaining({
        type: "cue",
        query: "quiet wounded intimacy forest cabin low instrumental ambient no vocals instrumental ambience",
        volume: 35,
        fresh: false,
      }),
    );
  });

  it("keeps the origin conversation active when a character-created scene is ready", () => {
    vi.useFakeTimers();
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");
    useChatStore.getState().setActiveChatId("conversation-1");

    handleSceneCreatedGenerationEvent(queryClient, "conversation-1", {
      chatId: "scene-1",
      chatName: "Moonlit Library",
      originChatId: "conversation-1",
    });

    expect(useChatStore.getState().activeChatId).toBe("conversation-1");

    vi.advanceTimersByTime(75);

    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: chatKeys.messages("conversation-1") });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: chatKeys.messages("scene-1") });
    queryClient.clear();
  });

  it("records diagnostic stream events without disrupting generation", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const chatId = "chat-diagnostic-stream";
    queryClient.setQueryData(chatKeys.detail(chatId), {
      id: chatId,
      mode: "roleplay",
      metadata: { groupChatMode: "merged" },
    } as Chat);
    useChatStore.getState().setActiveChatId(chatId);

    async function* stream(): AsyncGenerator<StreamEvent> {
      yield {
        type: "diagnostic",
        data: {
          kind: "timing",
          name: "model-call",
          durationMs: 100,
          chatId,
          chatMode: "roleplay",
          groupChatMode: "merged",
          characterCount: 2,
          targetCharacterId: null,
        },
      } as StreamEvent;
      yield { type: "done" } as StreamEvent;
    }

    await runGenerationWithUi(queryClient, { chatId }, stream);

    expect(getRecentClientDiagnostics()[0]).toEqual(
      expect.objectContaining({
        source: "generation-timing",
        message: "model-call completed in 100ms",
      }),
    );
    expect(toast.error).not.toHaveBeenCalled();
    queryClient.clear();
  });
  it("labels image provider failures as attachment delivery failures", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const chatId = "chat-image-failure";
    queryClient.setQueryData(chatKeys.detail(chatId), {
      id: chatId,
      mode: "conversation",
      metadata: {},
    } as Chat);

    async function* stream(): AsyncGenerator<StreamEvent> {
      yield {
        type: "diagnostic",
        data: {
          kind: "timing",
          name: "image-provider-call",
          durationMs: 1,
          chatId,
          chatMode: "conversation",
          groupChatMode: null,
          characterCount: 1,
          targetCharacterId: null,
        },
      } as StreamEvent;
      throw new Error("Provider API error: Unable to process input image.");
    }

    await expect(
      runGenerationWithUi(
        queryClient,
        {
          chatId,
          userMessage: "describe this",
          attachments: [{ type: "image/png", data: "data:image/png;base64,abc", filename: "tiny.png" }],
        },
        stream,
      ),
    ).rejects.toThrow("Unable to process input image");

    expect(toast.error).toHaveBeenCalledWith(
      "Image attachment could not be delivered: Provider API error: Unable to process input image.",
      expect.objectContaining({
        description: "Your message was kept. Fix the connection or provider issue, then retry.",
      }),
    );
    queryClient.clear();
  });
  it("flushes pending typewriter text when the page becomes hidden", async () => {
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
    document.dispatchEvent(new Event("visibilitychange"));

    expect(useChatStore.getState().streamBuffer).toBe("hello");
    expect(releaseStream).toEqual(expect.any(Function));
    releaseStream?.();
    await run;
    expect(cancelAnimationFrame).toHaveBeenCalledWith(1);
    queryClient.clear();
  });

  it("keeps typewriter pacing when the window blurs but the page remains visible", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const chatId = "chat-window-blur";
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
    vi.spyOn(document, "hasFocus").mockReturnValue(false);
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
    window.dispatchEvent(new Event("blur"));

    expect(useChatStore.getState().streamBuffer).toBe("");
    expect(cancelAnimationFrame).not.toHaveBeenCalledWith(1);
    visibilityState.mockReturnValue("hidden");
    document.dispatchEvent(new Event("visibilitychange"));

    releaseStream?.();
    await run;
    queryClient.clear();
  });
});
