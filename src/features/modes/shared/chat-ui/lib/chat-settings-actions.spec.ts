import { describe, expect, it, vi } from "vitest";

import type { Chat } from "../../../../../engine/contracts/types/chat";
import {
  buildModePromptMetadataPatch,
  hasSecretPlotMemory,
  toggleChatAgent,
} from "./chat-settings-actions";

function chatWithAgents(activeAgentIds: string[]): Chat {
  return {
    id: "chat-1",
    name: "Test Chat",
    mode: "roleplay",
    metadata: { activeAgentIds },
  } as Chat;
}

describe("chat settings actions", () => {
  it("adds an inactive agent through the metadata mutation", async () => {
    const updateMeta = { mutateAsync: vi.fn().mockResolvedValue(undefined) };
    const showMutationFailure = vi.fn();

    await toggleChatAgent({
      agentId: "lorebook-keeper",
      chat: chatWithAgents([]),
      activeAgentIds: [],
      readLatestChat: () => undefined,
      updateMeta,
      agentMemory: { getMemory: vi.fn(), clearMemory: vi.fn() },
      confirmSecretPlotRemoval: vi.fn(),
      showMutationFailure,
    });

    expect(updateMeta.mutateAsync).toHaveBeenCalledWith(
      { id: "chat-1", activeAgentIds: ["lorebook-keeper"] },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
    expect(showMutationFailure).not.toHaveBeenCalled();
  });

  it("rolls Secret Plot Driver back when memory cleanup fails after metadata success", async () => {
    let latestChat = chatWithAgents(["secret-plot-driver"]);
    const updateMeta = {
      mutateAsync: vi.fn(async (_patch: unknown, options?: { onSuccess?: () => Promise<void> | void }) => {
        latestChat = chatWithAgents([]);
        if (options?.onSuccess) await options.onSuccess();
      }),
    };
    const showMutationFailure = vi.fn();
    const clearMemory = vi.fn().mockRejectedValue(new Error("clear failed"));

    await toggleChatAgent({
      agentId: "secret-plot-driver",
      chat: chatWithAgents(["secret-plot-driver"]),
      activeAgentIds: ["secret-plot-driver"],
      readLatestChat: () => latestChat,
      updateMeta,
      agentMemory: {
        getMemory: vi.fn().mockResolvedValue({ memory: { overarchingArc: "Arc" } }),
        clearMemory,
      },
      confirmSecretPlotRemoval: vi.fn().mockResolvedValue(true),
      showMutationFailure,
    });

    expect(updateMeta.mutateAsync).toHaveBeenNthCalledWith(
      1,
      { id: "chat-1", activeAgentIds: [] },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
    expect(updateMeta.mutateAsync).toHaveBeenNthCalledWith(2, {
      id: "chat-1",
      activeAgentIds: ["secret-plot-driver"],
    });
    expect(clearMemory).toHaveBeenCalledWith("secret-plot-driver", "chat-1");
    expect(showMutationFailure).toHaveBeenCalledWith({ removing: true, message: "clear failed" });
  });

  it("keeps removal intent when latest metadata changes before mutation", async () => {
    let latestChat = chatWithAgents(["secret-plot-driver"]);
    const updateMeta = { mutateAsync: vi.fn().mockResolvedValue(undefined) };

    await toggleChatAgent({
      agentId: "secret-plot-driver",
      chat: chatWithAgents(["secret-plot-driver"]),
      activeAgentIds: ["secret-plot-driver"],
      readLatestChat: () => latestChat,
      updateMeta,
      agentMemory: {
        getMemory: vi.fn().mockImplementation(async () => {
          latestChat = chatWithAgents([]);
          return { memory: { overarchingArc: "Arc" } };
        }),
        clearMemory: vi.fn(),
      },
      confirmSecretPlotRemoval: vi.fn().mockResolvedValue(true),
      showMutationFailure: vi.fn(),
    });

    expect(updateMeta.mutateAsync).toHaveBeenCalledWith(
      { id: "chat-1", activeAgentIds: [] },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
  });

  it("preserves mode-specific prompt persistence semantics", () => {
    expect(
      buildModePromptMetadataPatch({
        field: "narratorStyleInstructions",
        draft: "  lyrical ",
        stored: "lyrical",
      }),
    ).toBeNull();
    expect(
      buildModePromptMetadataPatch({
        field: "narratorStyleInstructions",
        draft: "   ",
        stored: "old",
      }),
    ).toEqual({ narratorStyleInstructions: null });
    expect(
      buildModePromptMetadataPatch({
        field: "gameExtraPrompt",
        draft: "  keep spaces  ",
        stored: "",
      }),
    ).toEqual({ gameExtraPrompt: "  keep spaces  " });
    expect(
      buildModePromptMetadataPatch({
        field: "sceneSystemPrompt",
        draft: "",
        stored: "scene",
      }),
    ).toEqual({ sceneSystemPrompt: "" });
  });

  it("detects non-empty Secret Plot Driver memory shapes", () => {
    expect(hasSecretPlotMemory({ sceneDirections: [{ direction: "Reveal clue" }] })).toBe(true);
    expect(hasSecretPlotMemory({ overarchingArc: { completed: true } })).toBe(true);
    expect(hasSecretPlotMemory({ sceneDirections: ["  "], recentlyFulfilled: [] })).toBe(false);
  });
});
