import { describe, expect, it, vi } from "vitest";
import type { SetupJourneyIntent } from "../../../../engine/onboarding";
import { createSetupChatLaunchOrchestrator } from "./setup-chat-launch";

const intent = (overrides: Partial<SetupJourneyIntent> = {}): SetupJourneyIntent => ({
  mode: "game",
  originCharacterId: null,
  selectedConnectionId: "conn-1",
  dismissed: false,
  completed: false,
  ...overrides,
});

describe("setup chat launch orchestration", () => {
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

    expect(launch.claimSetupLaunch({ intent: intent({ mode: "conversation" }), ready: true, usableConnectionIds: ["conn-1"] })?.mode).toBe("conversation");
    expect(launch.claimSetupLaunch({ intent: intent({ mode: "roleplay" }), ready: true, usableConnectionIds: ["conn-1"] })?.mode).toBe("roleplay");
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
});
