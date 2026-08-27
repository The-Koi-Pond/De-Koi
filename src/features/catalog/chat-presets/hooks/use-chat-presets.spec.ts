import { describe, expect, it, vi } from "vitest";
import { resolveRoleplayWorkflowProfile } from "../../../../engine/modes/roleplay/workflow-profiles";

import {
  applyRoleplayWorkflowProfile,
  buildChatPresetApplicationPatch,
  createChatPresetExportEnvelope,
  parseChatPresetImportEnvelope,
  revertRoleplayWorkflowProfile,
  sanitizeChatPresetSettings,
} from "./use-chat-presets";

describe("chat preset workflow profile serialization", () => {
  it("round-trips override maps but excludes the chat-scoped workflow receipt and identity/history metadata", () => {
    const settings = sanitizeChatPresetSettings(
      {
        connectionId: "writer-cloud",
        promptPresetId: "preset_universal_v2",
        metadata: {
          agentConnectionOverrides: { "world-state": "sidecar:local" },
          agentRunIntervalOverrides: { "chat-summary": 5 },
          roleplayWorkflowApplication: {
            profileId: "local-assist",
            profileVersion: 1,
            appliedAt: "2026-08-26T12:00:00.000Z",
            selectedItemIds: ["connection:world-state"],
            changes: [],
          },
          summary: "chat-owned history",
          tags: ["chat-owned identity"],
          spriteCharacterIds: ["character-1"],
        },
      },
      "roleplay",
    );

    expect(settings).toEqual({
      connectionId: "writer-cloud",
      promptPresetId: "preset_universal_v2",
      metadata: {
        agentConnectionOverrides: { "world-state": "sidecar:local" },
        agentRunIntervalOverrides: { "chat-summary": 5 },
      },
    });
  });

  it("clears both workflow override maps when applying an older preset that does not contain them", () => {
    const patch = buildChatPresetApplicationPatch(
      {
        id: "older-preset",
        name: "Older preset",
        mode: "roleplay",
        isDefault: false,
        isActive: false,
        settings: { metadata: { activeAgentIds: ["continuity"] } },
        createdAt: "2026-08-26T12:00:00.000Z",
        updatedAt: "2026-08-26T12:00:00.000Z",
      },
      {
        mode: "roleplay",
        connectionId: "writer-cloud",
        promptPresetId: "custom-prompt",
        metadata: {
          agentOverrides: {},
          activeAgentIds: ["world-state"],
          activeToolIds: [],
          presetChoices: {},
          summary: null,
          tags: [],
          agentConnectionOverrides: { "world-state": "sidecar:local" },
          agentRunIntervalOverrides: { "chat-summary": 5 },
        },
      },
    );

    expect(patch.metadata).toMatchObject({
      activeAgentIds: ["continuity"],
      agentConnectionOverrides: {},
      agentRunIntervalOverrides: {},
      appliedChatPresetId: "older-preset",
    });
  });

  it("round-trips exported presets through the import seam without exporting a workflow receipt", () => {
    const envelope = createChatPresetExportEnvelope({
      id: "preset-1",
      name: "Workflow preset",
      mode: "roleplay",
      isDefault: false,
      isActive: false,
      settings: {
        metadata: {
          agentConnectionOverrides: { "world-state": "sidecar:local" },
          agentRunIntervalOverrides: { "chat-summary": 5 },
          roleplayWorkflowApplication: {
            profileId: "local-assist",
            profileVersion: 1,
            appliedAt: "2026-08-26T12:00:00.000Z",
            selectedItemIds: ["connection:world-state"],
            changes: [],
          },
        },
      },
      createdAt: "2026-08-26T12:00:00.000Z",
      updatedAt: "2026-08-26T12:00:00.000Z",
    });

    expect(parseChatPresetImportEnvelope(envelope)).toMatchObject({
      name: "Workflow preset",
      mode: "roleplay",
      settings: {
        metadata: {
          agentConnectionOverrides: { "world-state": "sidecar:local" },
          agentRunIntervalOverrides: { "chat-summary": 5 },
        },
      },
    });
  });
});

describe("roleplay workflow profile persistence", () => {
  const roleplayMode = "roleplay" as const;
  const capabilities = {
    hasUniversalPreset: true,
    localSidecarReady: true,
    hasImageConnection: true,
    hasUsableBackgroundAssets: true,
    musicModuleEnabled: true,
    ttsReady: true,
  };

  it("rejects a freshly loaded non-Roleplay chat before resolving capabilities or writing", async () => {
    const preview = resolveRoleplayWorkflowProfile("minimal-clean", {
      chat: { mode: "roleplay", promptPresetId: null, metadata: { activeAgentIds: [] } },
      capabilities,
    });
    const currentChat = {
      id: "chat-1",
      mode: "conversation",
      promptPresetId: null,
      metadata: { activeAgentIds: [] },
    };
    const resolveCapabilities = vi.fn(async () => capabilities);
    const update = vi.fn();

    await expect(
      applyRoleplayWorkflowProfile({
        chatId: "chat-1",
        profileId: "minimal-clean",
        preview,
        selectedItemIds: ["memory-recall"],
        resolveCapabilities,
        storage: { get: async () => currentChat, update },
      } as never),
    ).rejects.toThrow("Roleplay workflow profiles can only be applied to Roleplay chats");
    expect(resolveCapabilities).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it("rejects a stale preview without writing", async () => {
    const preview = resolveRoleplayWorkflowProfile("minimal-clean", {
      chat: { mode: roleplayMode, promptPresetId: null, metadata: { enableMemoryRecall: undefined, activeAgentIds: [] } },
      capabilities,
    });
    const currentChat = {
      id: "chat-1",
      mode: roleplayMode,
      promptPresetId: null,
      metadata: { enableMemoryRecall: true, activeAgentIds: [], tags: ["keep-me"] },
    };
    const update = vi.fn();

    const resolveCapabilities = vi.fn(async () => capabilities);
    const result = await applyRoleplayWorkflowProfile({
      chatId: "chat-1",
      profileId: "minimal-clean",
      preview,
      selectedItemIds: ["memory-recall"],
      resolveCapabilities,
      storage: { get: async () => currentChat, update },
    } as never);

    expect(result).toMatchObject({ outcome: "stale" });
    expect(resolveCapabilities).toHaveBeenCalledWith(currentChat);
    expect(update).not.toHaveBeenCalled();
  });

  it("writes selected changes atomically, preserves unrelated metadata, and replaces the receipt", async () => {
    let currentChat = {
      id: "chat-1",
      mode: roleplayMode,
      promptPresetId: "custom-prompt",
      metadata: {
        enableMemoryRecall: false,
        activeAgentIds: [],
        tags: ["keep-me"],
        roleplayWorkflowApplication: {
          profileId: "old",
          profileVersion: 1,
          appliedAt: "old",
          selectedItemIds: [],
          changes: [],
        },
      },
    };
    const preview = resolveRoleplayWorkflowProfile("longform-continuity", { chat: currentChat, capabilities });
    const update = vi.fn(async (_entity: string, _id: string, patch: Record<string, unknown>) => {
      currentChat = {
        ...currentChat,
        ...patch,
        metadata: { ...currentChat.metadata, ...(patch.metadata as Record<string, unknown>) },
      } as typeof currentChat;
      return currentChat;
    });

    const result = await applyRoleplayWorkflowProfile({
      chatId: "chat-1",
      profileId: "longform-continuity",
      preview,
      selectedItemIds: ["memory-recall", "enable-automatic-agents", "agent:continuity", "cadence:chat-summary"],
      resolveCapabilities: async () => capabilities,
      storage: { get: async () => currentChat, update } as never,
      now: () => "2026-08-26T12:00:00.000Z",
    });

    expect(result).toMatchObject({
      outcome: "applied",
      selectedItemIds: ["memory-recall", "enable-automatic-agents", "agent:continuity", "cadence:chat-summary"],
    });
    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith(
      "chats",
      "chat-1",
      expect.objectContaining({
        metadata: expect.objectContaining({
          tags: ["keep-me"],
          enableMemoryRecall: true,
          enableAgents: true,
          activeAgentIds: ["continuity"],
          agentRunIntervalOverrides: { "chat-summary": 5 },
          roleplayWorkflowApplication: expect.objectContaining({
            profileId: "longform-continuity",
            appliedAt: "2026-08-26T12:00:00.000Z",
          }),
        }),
      }),
    );
    expect(currentChat.promptPresetId).toBe("custom-prompt");
    expect(currentChat.metadata.roleplayWorkflowApplication).toMatchObject({
      profileId: "longform-continuity",
      changes: expect.arrayContaining([
        expect.objectContaining({ field: "metadata.enableMemoryRecall", before: false, after: true }),
      ]),
    });
  });

  it("omits a Local Assist assignment that became unavailable without enabling that agent through a paid fallback", async () => {
    let currentChat = {
      id: "chat-1",
      mode: roleplayMode,
      promptPresetId: null,
      metadata: { activeAgentIds: [], tags: ["keep-me"] },
    };
    const preview = resolveRoleplayWorkflowProfile("local-assist", { chat: currentChat, capabilities });
    const update = vi.fn(async (_entity: string, _id: string, patch: Record<string, unknown>) => {
      currentChat = {
        ...currentChat,
        ...patch,
        metadata: { ...currentChat.metadata, ...(patch.metadata as Record<string, unknown>) },
      } as typeof currentChat;
      return currentChat;
    });

    const result = await applyRoleplayWorkflowProfile({
      chatId: "chat-1",
      profileId: "local-assist",
      preview,
      selectedItemIds: [
        "enable-automatic-agents",
        "agent:world-state",
        "connection:world-state",
        "agent:expression",
        "connection:expression",
      ],
      resolveCapabilities: async () => capabilities,
      isLocalSidecarAssignmentReady: async (agentId) => agentId !== "world-state",
      storage: { get: async () => currentChat, update } as never,
    });

    expect(result).toMatchObject({
      outcome: "applied",
      selectedItemIds: ["enable-automatic-agents", "agent:expression", "connection:expression"],
      omittedLocalAgentIds: ["world-state"],
    });
    expect(update).toHaveBeenCalledTimes(1);
    expect(currentChat.metadata).toMatchObject({
      activeAgentIds: ["expression"],
      enableAgents: true,
      agentConnectionOverrides: { expression: "sidecar:local" },
      tags: ["keep-me"],
    });
  });

  it("rejects an unpaired Local Assist agent selection without writing", async () => {
    const currentChat = {
      id: "chat-1",
      mode: roleplayMode,
      promptPresetId: null,
      metadata: { activeAgentIds: [] },
    };
    const preview = resolveRoleplayWorkflowProfile("local-assist", { chat: currentChat, capabilities });
    const update = vi.fn();

    await expect(
      applyRoleplayWorkflowProfile({
        chatId: "chat-1",
        profileId: "local-assist",
        preview,
        selectedItemIds: ["agent:world-state"],
        resolveCapabilities: async () => capabilities,
        isLocalSidecarAssignmentReady: async () => true,
        storage: { get: async () => currentChat, update } as never,
      }),
    ).rejects.toThrow("needs its local sidecar route selected");
    expect(update).not.toHaveBeenCalled();
  });

  it("allows an active Local Assist agent to add only its missing local route", async () => {
    let currentChat = {
      id: "chat-1",
      mode: roleplayMode,
      promptPresetId: null,
      metadata: { activeAgentIds: ["world-state"], agentConnectionOverrides: {} },
    };
    const preview = resolveRoleplayWorkflowProfile("local-assist", { chat: currentChat, capabilities });
    const update = vi.fn(async (_entity: string, _id: string, patch: Record<string, unknown>) => {
      currentChat = { ...currentChat, ...patch, metadata: patch.metadata as typeof currentChat.metadata };
      return currentChat;
    });

    const result = await applyRoleplayWorkflowProfile({
      chatId: "chat-1",
      profileId: "local-assist",
      preview,
      selectedItemIds: ["connection:world-state"],
      resolveCapabilities: async () => capabilities,
      isLocalSidecarAssignmentReady: async () => true,
      storage: { get: async () => currentChat, update } as never,
    });

    expect(result).toMatchObject({ outcome: "applied", selectedItemIds: ["connection:world-state"] });
    expect(currentChat.metadata).toMatchObject({
      activeAgentIds: ["world-state"],
      agentConnectionOverrides: { "world-state": "sidecar:local" },
    });
  });

  it("reports a skipped local route without claiming an already-active agent was omitted", async () => {
    let currentChat = {
      id: "chat-1",
      mode: roleplayMode,
      promptPresetId: null,
      metadata: {
        activeAgentIds: ["world-state"],
        agentConnectionOverrides: { "world-state": "writer-cloud" },
      },
    };
    const preview = resolveRoleplayWorkflowProfile("local-assist", { chat: currentChat, capabilities });
    const update = vi.fn(async (_entity: string, _id: string, patch: Record<string, unknown>) => {
      currentChat = { ...currentChat, ...patch, metadata: patch.metadata as typeof currentChat.metadata };
      return currentChat;
    });

    const result = await applyRoleplayWorkflowProfile({
      chatId: "chat-1",
      profileId: "local-assist",
      preview,
      selectedItemIds: ["connection:world-state"],
      resolveCapabilities: async () => capabilities,
      isLocalSidecarAssignmentReady: async () => false,
      storage: { get: async () => currentChat, update } as never,
    });

    expect(result).toMatchObject({
      outcome: "applied",
      selectedItemIds: [],
      omittedLocalAgentIds: [],
      skippedLocalRoutingAgentIds: ["world-state"],
    });
    expect(currentChat.metadata).toMatchObject({
      activeAgentIds: ["world-state"],
      agentConnectionOverrides: { "world-state": "writer-cloud" },
    });
  });

  it("allows an already-routed Local Assist agent to add only its missing activation", async () => {
    let currentChat = {
      id: "chat-1",
      mode: roleplayMode,
      promptPresetId: null,
      metadata: { activeAgentIds: [], agentConnectionOverrides: { "world-state": "sidecar:local" } },
    };
    const preview = resolveRoleplayWorkflowProfile("local-assist", { chat: currentChat, capabilities });
    const update = vi.fn(async (_entity: string, _id: string, patch: Record<string, unknown>) => {
      currentChat = { ...currentChat, ...patch, metadata: patch.metadata as typeof currentChat.metadata };
      return currentChat;
    });

    const result = await applyRoleplayWorkflowProfile({
      chatId: "chat-1",
      profileId: "local-assist",
      preview,
      selectedItemIds: ["enable-automatic-agents", "agent:world-state"],
      resolveCapabilities: async () => capabilities,
      isLocalSidecarAssignmentReady: async () => true,
      storage: { get: async () => currentChat, update } as never,
    });

    expect(result).toMatchObject({
      outcome: "applied",
      selectedItemIds: ["enable-automatic-agents", "agent:world-state"],
    });
    expect(currentChat.metadata).toMatchObject({
      activeAgentIds: ["world-state"],
      enableAgents: true,
      agentConnectionOverrides: { "world-state": "sidecar:local" },
    });
  });

  it("requires a Local Assist readiness resolver before accepting any selected local assignment", async () => {
    const currentChat = {
      id: "chat-1",
      mode: roleplayMode,
      promptPresetId: null,
      metadata: { activeAgentIds: [] },
    };
    const preview = resolveRoleplayWorkflowProfile("local-assist", { chat: currentChat, capabilities });
    const update = vi.fn();

    await expect(
      applyRoleplayWorkflowProfile({
        chatId: "chat-1",
        profileId: "local-assist",
        preview,
        selectedItemIds: ["enable-automatic-agents", "agent:world-state", "connection:world-state"],
        resolveCapabilities: async () => capabilities,
        storage: { get: async () => currentChat, update } as never,
      }),
    ).rejects.toThrow("readiness resolver");
    expect(update).not.toHaveBeenCalled();
  });

  it("allows a Local Assist memory-only application without a sidecar readiness resolver", async () => {
    const currentChat = {
      id: "chat-1",
      mode: roleplayMode,
      promptPresetId: null,
      metadata: { activeAgentIds: [] },
    };
    const preview = resolveRoleplayWorkflowProfile("local-assist", { chat: currentChat, capabilities });
    const update = vi.fn(async () => currentChat);

    const result = await applyRoleplayWorkflowProfile({
      chatId: "chat-1",
      profileId: "local-assist",
      preview,
      selectedItemIds: ["memory-recall"],
      resolveCapabilities: async () => capabilities,
      storage: { get: async () => currentChat, update } as never,
    });

    expect(result).toMatchObject({ outcome: "applied", selectedItemIds: ["memory-recall"] });
    expect(update).toHaveBeenCalledTimes(1);
  });

  it("propagates an atomic storage failure without reporting an application", async () => {
    const currentChat = {
      id: "chat-1",
      mode: roleplayMode,
      promptPresetId: null,
      metadata: { activeAgentIds: [] },
    };
    const preview = resolveRoleplayWorkflowProfile("minimal-clean", { chat: currentChat, capabilities });
    const update = vi.fn(async () => {
      throw new Error("disk unavailable");
    });

    await expect(
      applyRoleplayWorkflowProfile({
        chatId: "chat-1",
        profileId: "minimal-clean",
        preview,
        selectedItemIds: ["memory-recall"],
        resolveCapabilities: async () => capabilities,
        storage: { get: async () => currentChat, update } as never,
      }),
    ).rejects.toThrow("disk unavailable");
    expect(update).toHaveBeenCalledTimes(1);
  });

  it("reverts matching receipt fields in one write, keeps later edits, and clears the receipt", async () => {
    let currentChat = {
      id: "chat-1",
      mode: roleplayMode,
      promptPresetId: "custom-prompt",
      metadata: {
        enableMemoryRecall: true,
        activeAgentIds: ["later-edit"],
        tags: ["keep-me"],
        roleplayWorkflowApplication: {
          profileId: "longform-continuity",
          profileVersion: 1,
          appliedAt: "2026-08-26T12:00:00.000Z",
          selectedItemIds: ["memory-recall", "agent:continuity"],
          changes: [
            { itemIds: ["memory-recall"], field: "metadata.enableMemoryRecall", before: false, after: true },
            { itemIds: ["agent:continuity"], field: "metadata.activeAgentIds", before: [], after: ["continuity"] },
          ],
        },
      },
    };
    const update = vi.fn(async (_entity: string, _id: string, patch: Record<string, unknown>) => {
      currentChat = {
        ...currentChat,
        ...patch,
        metadata: { ...currentChat.metadata, ...(patch.metadata as Record<string, unknown>) },
      } as typeof currentChat;
      return currentChat;
    });

    const result = await revertRoleplayWorkflowProfile({
      chatId: "chat-1",
      storage: { get: async () => currentChat, update } as never,
    });

    expect(result).toMatchObject({ outcome: "reverted", skippedConflicts: ["agent:continuity"] });
    expect(update).toHaveBeenCalledTimes(1);
    expect(currentChat.metadata).toMatchObject({
      enableMemoryRecall: false,
      activeAgentIds: ["later-edit"],
      tags: ["keep-me"],
      roleplayWorkflowApplication: null,
    });
  });

  it("does not write when there is no workflow receipt to revert", async () => {
    const update = vi.fn();
    const result = await revertRoleplayWorkflowProfile({
      chatId: "chat-1",
      storage: {
        get: async () => ({ id: "chat-1", promptPresetId: null, metadata: { activeAgentIds: [] } }),
        update,
      } as never,
    });

    expect(result).toEqual({
      outcome: "not_applied",
      chat: { id: "chat-1", promptPresetId: null, metadata: { activeAgentIds: [] } },
      skippedConflicts: [],
    });
    expect(update).not.toHaveBeenCalled();
  });
});
