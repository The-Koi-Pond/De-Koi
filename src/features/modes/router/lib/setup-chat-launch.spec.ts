import { describe, expect, it, vi } from "vitest";
import type { SetupJourneyIntent } from "../../../../engine/onboarding";
import { createSetupChatLaunchOrchestrator } from "./setup-chat-launch";

const intent = (overrides: Partial<SetupJourneyIntent> = {}): SetupJourneyIntent => ({
  journeyId: "journey-1",
  mode: "game",
  originCharacterId: null,
  selectedConnectionId: "conn-1",
  dismissed: false,
  completed: false,
  ...overrides,
});

describe("setup chat launch orchestration", () => {
  it("resumes a post-create failure in the same orchestrator without creating twice", async () => {
    let recovery = null as import("../../../../engine/onboarding").SetupJourneyRecovery | null;
    const createChat = vi.fn().mockResolvedValue({ id: "chat-1" });
    const complete = vi.fn().mockRejectedValueOnce(new Error("finalize failed")).mockResolvedValueOnce(undefined);
    const launch = createSetupChatLaunchOrchestrator({
      createChat,
      applyStarredPreset: vi.fn(),
      complete,
      getRecovery: () => recovery,
      recordRecovery: (next) => { recovery = next; },
      clearRecovery: () => { recovery = null; },
    });
    const request = { intent: intent(), ready: true, usableConnectionIds: ["conn-1"] };

    await expect(launch.launch(request)).rejects.toThrow("finalize failed");
    await expect(launch.launch(request)).resolves.toEqual({ id: "chat-1" });

    expect(createChat).toHaveBeenCalledOnce();
    expect(complete).toHaveBeenCalledTimes(2);
  });
  it("does not claim or create before readiness", async () => {
    const createChat = vi.fn();
    const launch = createSetupChatLaunchOrchestrator({ createChat, applyStarredPreset: vi.fn(), complete: vi.fn() });

    expect(launch.claimSetupLaunch({ intent: intent(), ready: false, usableConnectionIds: ["conn-1"] })).toBeNull();
    await launch.launch({ intent: intent(), ready: false, usableConnectionIds: ["conn-1"] });

    expect(createChat).not.toHaveBeenCalled();
  });

  it("atomically claims the selected connection once", () => {
    const launch = createSetupChatLaunchOrchestrator({ createChat: vi.fn(), applyStarredPreset: vi.fn(), complete: vi.fn() });
    const request = { intent: intent(), ready: true, usableConnectionIds: ["conn-1"] };

    expect(launch.claimSetupLaunch(request)).toEqual(expect.objectContaining({ mode: "game", connectionId: "conn-1" }));
    expect(launch.claimSetupLaunch(request)).toBeNull();
  });

  it("releases an identified failed creation for a safe retry", async () => {
    const createChat = vi.fn().mockRejectedValueOnce(new Error("create failed")).mockResolvedValueOnce({ id: "chat-1" });
    const complete = vi.fn();
    const launch = createSetupChatLaunchOrchestrator({ createChat, applyStarredPreset: vi.fn(), complete });
    const request = { intent: intent(), ready: true, usableConnectionIds: ["conn-1"] };

    await expect(launch.launch(request)).rejects.toThrow("create failed");
    await expect(launch.launch(request)).resolves.toEqual({ id: "chat-1" });

    expect(createChat).toHaveBeenCalledTimes(2);
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it("lets the latest mode replace an older uncompleted intent", () => {
    const launch = createSetupChatLaunchOrchestrator({ createChat: vi.fn(), applyStarredPreset: vi.fn(), complete: vi.fn() });

    expect(launch.claimSetupLaunch({ intent: intent({ journeyId: "journey-1", mode: "conversation" }), ready: true, usableConnectionIds: ["conn-1"] })?.mode).toBe("conversation");
    expect(launch.claimSetupLaunch({ intent: intent({ journeyId: "journey-2", mode: "roleplay" }), ready: true, usableConnectionIds: ["conn-1"] })?.mode).toBe("roleplay");
  });

  it("preserves character origin, selected connection, and applies the starred preset once", async () => {
    const createChat = vi.fn().mockResolvedValue({ id: "chat-1" });
    const applyStarredPreset = vi.fn().mockResolvedValue(undefined);
    const complete = vi.fn();
    const launch = createSetupChatLaunchOrchestrator({ createChat, applyStarredPreset, complete });
    const request = {
      intent: intent({ mode: "roleplay", originCharacterId: "character-1", selectedConnectionId: "conn-2" }),
      ready: true,
      usableConnectionIds: ["conn-1", "conn-2"],
    };

    await launch.launch(request);
    await launch.launch(request);

    expect(createChat).toHaveBeenCalledWith(expect.objectContaining({
      mode: "roleplay",
      characterIds: ["character-1"],
      connectionId: "conn-2",
    }));
    expect(applyStarredPreset).toHaveBeenCalledOnce();
    expect(applyStarredPreset).toHaveBeenCalledWith({ mode: "roleplay", chatId: "chat-1" });
    expect(complete).toHaveBeenCalledOnce();
  });

  it("launches two sequential identical journeys once each", async () => {
    const createChat = vi.fn().mockResolvedValueOnce({ id: "chat-1" }).mockResolvedValueOnce({ id: "chat-2" });
    const complete = vi.fn();
    const launch = createSetupChatLaunchOrchestrator({ createChat, applyStarredPreset: vi.fn(), complete });

    await launch.launch({ intent: intent({ journeyId: "journey-1" }), ready: true, usableConnectionIds: ["conn-1"] });
    await launch.launch({ intent: intent({ journeyId: "journey-2" }), ready: true, usableConnectionIds: ["conn-1"] });

    expect(createChat).toHaveBeenCalledTimes(2);
    expect(complete).toHaveBeenCalledTimes(2);
  });

  it("single-flights concurrent launch calls and finalizes the successful chat", async () => {
    let resolveCreate!: (chat: { id: string }) => void;
    const createChat = vi.fn(() => new Promise<{ id: string }>((resolve) => { resolveCreate = resolve; }));
    const applyStarredPreset = vi.fn().mockResolvedValue(undefined);
    const complete = vi.fn();
    const launch = createSetupChatLaunchOrchestrator({ createChat, applyStarredPreset, complete });
    const request = { intent: intent(), ready: true, usableConnectionIds: ["conn-1"] };

    const first = launch.launch(request);
    const duplicate = launch.launch(request);
    expect(createChat).toHaveBeenCalledOnce();
    resolveCreate({ id: "chat-1" });
    await expect(Promise.all([first, duplicate])).resolves.toEqual([{ id: "chat-1" }, { id: "chat-1" }]);

    expect(applyStarredPreset).toHaveBeenCalledOnce();
    expect(complete).toHaveBeenCalledOnce();
  });

  it("coalesces an intent replacement while creation is in flight without orphaning the chat", async () => {
    let resolveCreate!: (chat: { id: string }) => void;
    const createChat = vi.fn(() => new Promise<{ id: string }>((resolve) => { resolveCreate = resolve; }));
    const applyStarredPreset = vi.fn().mockResolvedValue(undefined);
    const complete = vi.fn();
    const launch = createSetupChatLaunchOrchestrator({ createChat, applyStarredPreset, complete });

    const first = launch.launch({ intent: intent({ journeyId: "journey-1", mode: "conversation" }), ready: true, usableConnectionIds: ["conn-1"] });
    const replacement = launch.launch({ intent: intent({ journeyId: "journey-2", mode: "roleplay" }), ready: true, usableConnectionIds: ["conn-1"] });
    expect(createChat).toHaveBeenCalledOnce();
    resolveCreate({ id: "chat-1" });
    await Promise.all([first, replacement]);
    await launch.launch({ intent: intent({ journeyId: "journey-2", mode: "roleplay" }), ready: true, usableConnectionIds: ["conn-1"] });

    expect(createChat).toHaveBeenCalledOnce();
    expect(applyStarredPreset).toHaveBeenCalledOnce();
    expect(complete).toHaveBeenCalledOnce();
  });

  it("rebases an in-flight created draft to the latest store intent before finalization", async () => {
    let resolveCreate!: (chat: { id: string }) => void;
    let currentRequest = {
      intent: intent({ journeyId: "journey-1", mode: "conversation", selectedConnectionId: "conn-1" }),
      ready: true,
      usableConnectionIds: ["conn-1", "conn-2"],
    };
    const reconcileChat = vi.fn().mockResolvedValue({ id: "chat-1" });
    const applyStarredPreset = vi.fn().mockResolvedValue(undefined);
    const complete = vi.fn();
    const launch = createSetupChatLaunchOrchestrator({
      createChat: vi.fn(() => new Promise<{ id: string }>((resolve) => { resolveCreate = resolve; })),
      reconcileChat,
      getCurrentLaunchRequest: () => currentRequest,
      resolveCharacterLaunchContext: vi.fn().mockResolvedValue({ characterName: "Mira", firstMessage: "Hello" }),
      initializeCharacterChat: vi.fn(),
      applyStarredPreset,
      complete,
    });

    const pending = launch.launch(currentRequest);
    currentRequest = {
      intent: intent({ journeyId: "journey-2", mode: "roleplay", originCharacterId: "character-1", selectedConnectionId: "conn-2" }),
      ready: true,
      usableConnectionIds: ["conn-1", "conn-2"],
    };
    resolveCreate({ id: "chat-1" });
    await pending;

    expect(reconcileChat).toHaveBeenCalledWith({ id: "chat-1" }, {
      name: "Mira - Roleplay",
      mode: "roleplay",
      characterIds: ["character-1"],
      connectionId: "conn-2",
    });
    expect(applyStarredPreset).toHaveBeenCalledWith({ mode: "roleplay", chatId: "chat-1" });
    expect(complete).toHaveBeenCalledWith({ id: "chat-1" }, expect.objectContaining({ journeyId: "journey-2", mode: "roleplay" }));
  });

  it("resolves current character metadata and initializes resumed character chat like the direct path", async () => {
    const createChat = vi.fn().mockResolvedValue({ id: "chat-1" });
    const context = { characterName: "Mira", firstMessage: "Hello", alternateGreetings: ["Hi", "Hey"] };
    const resolveCharacterLaunchContext = vi.fn().mockResolvedValue(context);
    const initializeCharacterChat = vi.fn().mockResolvedValue(undefined);
    const launch = createSetupChatLaunchOrchestrator({
      createChat,
      applyStarredPreset: vi.fn(),
      complete: vi.fn(),
      resolveCharacterLaunchContext,
      initializeCharacterChat,
    });

    await launch.launch({
      intent: intent({ mode: "roleplay", originCharacterId: "character-1" }),
      ready: true,
      usableConnectionIds: ["conn-1"],
    });

    expect(resolveCharacterLaunchContext).toHaveBeenCalledWith("character-1");
    expect(createChat).toHaveBeenCalledWith(expect.objectContaining({ name: "Mira - Roleplay", characterIds: ["character-1"] }));
    expect(initializeCharacterChat).toHaveBeenCalledWith(
      "chat-1",
      "character-1",
      context,
      expect.objectContaining({ mode: "roleplay" }),
    );
  });

  it("still finalizes a created chat when optional character greeting initialization fails", async () => {
    const complete = vi.fn();
    const launch = createSetupChatLaunchOrchestrator({
      createChat: vi.fn().mockResolvedValue({ id: "chat-1" }),
      applyStarredPreset: vi.fn(),
      complete,
      resolveCharacterLaunchContext: vi.fn().mockResolvedValue({ characterName: "Mira", firstMessage: "Hello" }),
      initializeCharacterChat: vi.fn().mockRejectedValue(new Error("message failed")),
    });

    await expect(launch.launch({
      intent: intent({ mode: "roleplay", originCharacterId: "character-1" }),
      ready: true,
      usableConnectionIds: ["conn-1"],
    })).resolves.toEqual({ id: "chat-1" });
    expect(complete).toHaveBeenCalledOnce();
  });

  it("does not create another chat after required finalization fails post-create", async () => {
    const createChat = vi.fn().mockResolvedValue({ id: "chat-1" });
    const launch = createSetupChatLaunchOrchestrator({
      createChat,
      applyStarredPreset: vi.fn(),
      complete: vi.fn().mockRejectedValue(new Error("activation failed")),
    });
    const request = { intent: intent(), ready: true, usableConnectionIds: ["conn-1"] };

    await expect(launch.launch(request)).rejects.toThrow("activation failed");
    await expect(launch.launch(request)).rejects.toThrow("activation failed");
    expect(createChat).toHaveBeenCalledOnce();
  });

  it("resumes finalization without replaying completed preset or greeting stages", async () => {
    let recovery: {
      createdChatId: string;
      journeyId: string;
      stage: "created" | "reconciled" | "preset-applied" | "greeting-initialized" | "finalizing";
    } | null = null;
    const createChat = vi.fn().mockResolvedValue({ id: "chat-1" });
    const request = {
      intent: intent({ mode: "roleplay", originCharacterId: "character-1" }),
      ready: true,
      usableConnectionIds: ["conn-1"],
    };
    const applyStarredPreset = vi.fn().mockResolvedValue(undefined);
    const initializeCharacterChat = vi.fn().mockResolvedValue(undefined);
    const resolveCharacterLaunchContext = vi.fn().mockResolvedValue({ characterName: "Mira", firstMessage: "Hello" });
    const first = createSetupChatLaunchOrchestrator({
      createChat,
      applyStarredPreset,
      resolveCharacterLaunchContext,
      initializeCharacterChat,
      complete: vi.fn().mockRejectedValue(new Error("activation failed")),
      getRecovery: () => recovery,
      recordRecovery: (next) => { recovery = next; },
      clearRecovery: () => { recovery = null; },
    });
    await expect(first.launch(request)).rejects.toThrow("activation failed");
    expect(recovery).toEqual({ createdChatId: "chat-1", journeyId: "journey-1", stage: "finalizing" });

    const reconcileChat = vi.fn().mockResolvedValue({ id: "chat-1" });
    const complete = vi.fn().mockResolvedValue(undefined);
    const secondCreate = vi.fn();
    const second = createSetupChatLaunchOrchestrator({
      createChat: secondCreate,
      reconcileChat,
      applyStarredPreset,
      resolveCharacterLaunchContext,
      initializeCharacterChat,
      complete,
      getRecovery: () => recovery,
      recordRecovery: (next) => { recovery = next; },
      clearRecovery: () => { recovery = null; },
    });

    await expect(second.launch(request)).resolves.toEqual({ id: "chat-1" });
    expect(secondCreate).not.toHaveBeenCalled();
    expect(reconcileChat).not.toHaveBeenCalled();
    expect(complete).toHaveBeenCalledWith({ id: "chat-1" }, expect.objectContaining({ journeyId: "journey-1" }));
    expect(applyStarredPreset).toHaveBeenCalledOnce();
    expect(initializeCharacterChat).toHaveBeenCalledOnce();
    expect(recovery).toBeNull();
    expect(createChat).toHaveBeenCalledOnce();
  });

  it("reconciles to a replacement that arrives while preset application is awaited", async () => {
    let resolvePreset!: () => void;
    let currentRequest = {
      intent: intent({ journeyId: "journey-1", mode: "conversation" }),
      ready: true,
      usableConnectionIds: ["conn-1"],
    };
    const reconcileChat = vi.fn().mockResolvedValue({ id: "chat-1" });
    const complete = vi.fn();
    const launch = createSetupChatLaunchOrchestrator({
      createChat: vi.fn().mockResolvedValue({ id: "chat-1" }),
      reconcileChat,
      getCurrentLaunchRequest: () => currentRequest,
      applyStarredPreset: vi.fn()
        .mockImplementationOnce(() => new Promise<void>((resolve) => { resolvePreset = resolve; }))
        .mockResolvedValue(undefined),
      complete,
    });

    const pending = launch.launch(currentRequest);
    await vi.waitFor(() => expect(resolvePreset).toBeTypeOf("function"));
    currentRequest = {
      intent: intent({ journeyId: "journey-2", mode: "roleplay", originCharacterId: "character-2" }),
      ready: true,
      usableConnectionIds: ["conn-1"],
    };
    resolvePreset();
    await pending;

    expect(reconcileChat).toHaveBeenCalledWith({ id: "chat-1" }, expect.objectContaining({
      mode: "roleplay",
      characterIds: ["character-2"],
    }));
    expect(complete).toHaveBeenCalledWith({ id: "chat-1" }, expect.objectContaining({
      journeyId: "journey-2",
      mode: "roleplay",
    }));
  });

  it("removes stale greeting initialization when intent changes during the awaited initializer", async () => {
    let resolveGreeting!: (result: { cleanup: () => Promise<void> }) => void;
    let currentRequest = {
      intent: intent({ journeyId: "journey-1", mode: "roleplay", originCharacterId: "character-1" }),
      ready: true,
      usableConnectionIds: ["conn-1"],
    };
    const cleanup = vi.fn().mockResolvedValue(undefined);
    const reconcileChat = vi.fn().mockResolvedValue({ id: "chat-1" });
    const complete = vi.fn();
    const launch = createSetupChatLaunchOrchestrator({
      createChat: vi.fn().mockResolvedValue({ id: "chat-1" }),
      reconcileChat,
      getCurrentLaunchRequest: () => currentRequest,
      resolveCharacterLaunchContext: vi.fn().mockResolvedValue({ characterName: "Old", firstMessage: "Old hello" }),
      initializeCharacterChat: vi.fn(() => new Promise<{ cleanup: () => Promise<void> }>((resolve) => {
        resolveGreeting = resolve;
      })),
      applyStarredPreset: vi.fn(),
      complete,
    });

    const pending = launch.launch(currentRequest);
    await vi.waitFor(() => expect(resolveGreeting).toBeTypeOf("function"));
    currentRequest = {
      intent: intent({ journeyId: "journey-2", mode: "conversation", originCharacterId: null }),
      ready: true,
      usableConnectionIds: ["conn-1"],
    };
    resolveGreeting({ cleanup });
    await pending;

    expect(cleanup).toHaveBeenCalledOnce();
    expect(reconcileChat).toHaveBeenCalledWith({ id: "chat-1" }, expect.objectContaining({
      mode: "conversation",
      characterIds: [],
    }));
    expect(complete).toHaveBeenCalledWith({ id: "chat-1" }, expect.objectContaining({
      journeyId: "journey-2",
      mode: "conversation",
    }));
  });
});
