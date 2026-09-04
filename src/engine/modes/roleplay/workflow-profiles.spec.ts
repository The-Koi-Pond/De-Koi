import { describe, expect, it } from "vitest";

import {
  ROLEPLAY_WORKFLOW_PROFILE_RECIPES,
  buildRoleplayWorkflowProfilePatch as buildRequiredRoleplayWorkflowProfilePatch,
  buildRoleplayWorkflowProfileRevertPatch,
  resolveRoleplayWorkflowProfile,
} from "./workflow-profiles";
import {
  applyContinuityDirectorCommand,
  applyContinuityDirectorConfiguration,
  createDefaultContinuityDirectorState,
} from "./continuity-director/continuity-director-state";

function buildRoleplayWorkflowProfilePatch(
  resolution: Parameters<typeof buildRequiredRoleplayWorkflowProfilePatch>[0],
  itemIds: readonly string[],
  appliedAt: string,
  currentDirectorValue?: unknown,
) {
  return buildRequiredRoleplayWorkflowProfilePatch(resolution, itemIds, appliedAt, currentDirectorValue);
}

const capabilities = {
  hasUniversalPreset: true,
  localSidecarReady: true,
  hasImageConnection: true,
  hasUsableBackgroundAssets: true,
  musicModuleEnabled: true,
  ttsReady: true,
};

const chat = {
  mode: "roleplay" as const,
  promptPresetId: null,
  metadata: {
    agentOverrides: {},
    activeAgentIds: [],
    activeToolIds: [],
    presetChoices: {},
    summary: null,
    tags: [],
  },
};

const NOW = "2026-09-03T12:00:00.000Z";

function directorCommandOptions() {
  let id = 0;
  return {
    now: () => NOW,
    createId: (prefix: string) => `${prefix}-${++id}`,
  };
}

describe("roleplay workflow profile recipes", () => {
  it("rejects non-Roleplay chats at the resolver boundary", () => {
    expect(() =>
      resolveRoleplayWorkflowProfile("minimal-clean", {
        chat: { ...chat, mode: "game" },
        capabilities,
      }),
    ).toThrow("Roleplay workflow profiles can only be resolved for Roleplay chats");
  });

  it("defines versioned recipes and their expected extra calls", () => {
    expect(ROLEPLAY_WORKFLOW_PROFILE_RECIPES).toEqual({
      "minimal-clean": { version: 1, agentIds: [] },
      "longform-continuity": {
        version: 2,
        agentIds: ["continuity", "world-state", "chat-summary"],
        runIntervalOverrides: { "chat-summary": 5 },
        continuityDirector: { enabled: true, mode: "cadence", everyAssistantTurns: 10 },
      },
      cinematic: {
        version: 1,
        agentIds: ["expression", "background"],
        optionalAgentIds: ["illustrator", "music-dj"],
      },
      "local-assist": {
        version: 1,
        agentIds: ["world-state", "expression", "character-tracker"],
        connectionOverrides: {
          "world-state": "sidecar:local",
          expression: "sidecar:local",
          "character-tracker": "sidecar:local",
        },
      },
    });

    const longform = resolveRoleplayWorkflowProfile("longform-continuity", { chat, capabilities });
    expect(longform.rows.filter((row) => row.kind === "change").map((row) => [row.id, row.expectedExtraCalls])).toEqual(
      [
        ["prompt-preset", 0],
        ["memory-recall", 0],
        ["enable-automatic-agents", 0],
        ["agent:continuity", 1],
        ["agent:world-state", 1],
        ["agent:chat-summary", 1],
        ["cadence:chat-summary", 0],
        ["continuity-director", 1],
        ["continuity-director-cadence", 1],
      ],
    );
  });

  it("adds selected-by-default Director configuration to Longform version 2", () => {
    const resolution = resolveRoleplayWorkflowProfile("longform-continuity", { chat, capabilities });

    expect(resolution.version).toBe(2);
    expect(resolution.rows.find((row) => row.id === "continuity-director")).toMatchObject({
      before: false,
      after: true,
      selectedByDefault: true,
      expectedExtraCalls: 1,
      modelUse:
        "One immediate background planning call only when applying this workflow newly enables Director and no saved plan exists",
    });
    expect(resolution.rows.find((row) => row.id === "continuity-director-cadence")).toMatchObject({
      after: { mode: "cadence", everyAssistantTurns: 10 },
      selectedByDefault: true,
      expectedExtraCalls: 1,
      modelUse: "One non-blocking planning call every 10 assistant replies",
    });
    expect(() =>
      buildRoleplayWorkflowProfilePatch(resolution, ["continuity-director-cadence"], NOW),
    ).toThrow("requires Continuity Director to be enabled");
  });

  it("preserves an explicit Director choice", () => {
    const resolution = resolveRoleplayWorkflowProfile("longform-continuity", {
      chat: {
        ...chat,
        metadata: {
          ...chat.metadata,
          roleplayContinuityDirector: {
            ...createDefaultContinuityDirectorState(NOW),
            enabled: false,
          },
        },
      },
      capabilities,
    });
    expect(resolution.rows.find((row) => row.id === "continuity-director")).toMatchObject({
      selectedByDefault: false,
    });
    expect(resolution.rows.find((row) => row.id === "continuity-director-cadence")).toMatchObject({
      selectedByDefault: false,
    });
  });

  it("does not claim an immediate call when a disabled Director already has a user-authored plan", () => {
    const existing = applyContinuityDirectorCommand(
      createDefaultContinuityDirectorState(NOW),
      { type: "edit_arc", text: "Keep this plan" },
      directorCommandOptions(),
    );
    const resolution = resolveRoleplayWorkflowProfile("longform-continuity", {
      chat: {
        ...chat,
        metadata: { ...chat.metadata, roleplayContinuityDirector: existing },
      },
      capabilities,
    });

    expect(resolution.rows.find((row) => row.id === "continuity-director")).toMatchObject({
      expectedExtraCalls: 0,
      modelUse:
        "One immediate background planning call only when applying this workflow newly enables Director and no saved plan exists",
    });
  });

  it("applies and reverts Director configuration without storing plan content in the receipt", () => {
    const existing = applyContinuityDirectorCommand(
      createDefaultContinuityDirectorState(NOW),
      {
        type: "replace_director_proposals",
        arc: "Recover the archive",
        threads: ["Who changed the map?"],
        beats: ["The map reveals a sealed stair."],
      },
      directorCommandOptions(),
    );
    const resolution = resolveRoleplayWorkflowProfile("longform-continuity", {
      chat: { ...chat, metadata: { ...chat.metadata, roleplayContinuityDirector: existing } },
      capabilities,
    });
    const patch = buildRoleplayWorkflowProfilePatch(
      resolution,
      ["continuity-director", "continuity-director-cadence"],
      NOW,
      existing,
    );

    expect(patch.metadata.roleplayContinuityDirector).toMatchObject({
      enabled: true,
      refreshMode: "cadence",
      refreshEveryAssistantTurns: 10,
      beats: existing.beats,
    });
    expect(JSON.stringify(patch.metadata.roleplayWorkflowApplication)).not.toContain(existing.beats[0]!.text);
  });

  it("rejects Director changes when callers omit the full current state", () => {
    const existing = applyContinuityDirectorCommand(
      createDefaultContinuityDirectorState(NOW),
      {
        type: "replace_director_proposals",
        arc: "Recover the archive",
        threads: ["Who changed the map?"],
        beats: ["The map reveals a sealed stair."],
      },
      directorCommandOptions(),
    );
    const resolution = resolveRoleplayWorkflowProfile("longform-continuity", {
      chat: { ...chat, metadata: { ...chat.metadata, roleplayContinuityDirector: existing } },
      capabilities,
    });

    expect(() =>
      Reflect.apply(buildRequiredRoleplayWorkflowProfilePatch, undefined, [
        resolution,
        ["continuity-director", "continuity-director-cadence"],
        NOW,
      ]),
    ).toThrow("full current Continuity Director state");
  });

  it("defaults only absent matching values and keeps Minimal agent disabling opt-in for existing agents", () => {
    const longform = resolveRoleplayWorkflowProfile("longform-continuity", {
      chat: {
        ...chat,
        promptPresetId: "custom-roleplay-preset",
        metadata: {
          ...chat.metadata,
          enableMemoryRecall: false,
          activeAgentIds: ["world-state"],
        },
      },
      capabilities,
    });

    expect(
      Object.fromEntries(
        longform.rows.filter((row) => row.kind === "change").map((row) => [row.id, row.selectedByDefault]),
      ),
    ).toEqual({
      "prompt-preset": false,
      "memory-recall": false,
      "enable-automatic-agents": true,
      "agent:continuity": true,
      "agent:world-state": false,
      "agent:chat-summary": true,
      "cadence:chat-summary": true,
      "continuity-director": true,
      "continuity-director-cadence": true,
    });

    const minimal = resolveRoleplayWorkflowProfile("minimal-clean", {
      chat: { ...chat, metadata: { ...chat.metadata, activeAgentIds: ["continuity"] } },
      capabilities,
    });
    expect(minimal.rows.find((row) => row.id === "disable-automatic-agents")).toMatchObject({
      selectedByDefault: false,
      selectable: true,
    });

    const minimalWithExplicitAgentsEnabled = resolveRoleplayWorkflowProfile("minimal-clean", {
      chat: { ...chat, metadata: { ...chat.metadata, enableAgents: true, activeAgentIds: [] } },
      capabilities,
    });
    expect(minimalWithExplicitAgentsEnabled.rows.find((row) => row.id === "disable-automatic-agents")).toMatchObject({
      selectedByDefault: false,
      selectable: true,
    });
  });

  it("discloses unavailable model and media prerequisites without making informational rows changes", () => {
    const cinematic = resolveRoleplayWorkflowProfile("cinematic", {
      chat,
      capabilities: {
        ...capabilities,
        hasUniversalPreset: false,
        hasImageConnection: false,
        hasUsableBackgroundAssets: false,
        musicModuleEnabled: false,
        ttsReady: false,
      },
    });

    expect(cinematic.rows.find((row) => row.id === "prompt-preset")).toMatchObject({ selectable: false });
    expect(cinematic.rows.find((row) => row.id === "agent:background")).toMatchObject({
      selectable: false,
      prerequisites: [expect.stringContaining("background")],
    });
    expect(cinematic.rows.find((row) => row.id === "agent:illustrator")).toMatchObject({
      selectable: false,
      selectedByDefault: false,
      prerequisites: [expect.stringContaining("image")],
    });
    expect(cinematic.rows.find((row) => row.id === "agent:music-dj")).toMatchObject({
      selectable: false,
      selectedByDefault: false,
      destination: expect.stringContaining("YouTube"),
      prerequisites: [expect.stringContaining("Music module")],
    });
    expect(cinematic.rows.filter((row) => row.kind === "information").map((row) => row.id)).toEqual(
      expect.arrayContaining(["prerequisite:music-module", "information:tts-readiness"]),
    );

    const configuredIllustrator = resolveRoleplayWorkflowProfile("cinematic", {
      chat,
      capabilities: {
        ...capabilities,
        imageConnection: { label: "Studio Image Cloud", mayUsePaidOrExternalService: true },
      },
    });
    expect(configuredIllustrator.rows.find((row) => row.id === "agent:illustrator")).toMatchObject({
      destination: "Studio Image Cloud (configured image connection)",
      warnings: ["Image generation may use paid or external provider services."],
    });

    const selfHostedIllustrator = resolveRoleplayWorkflowProfile("cinematic", {
      chat,
      capabilities: {
        ...capabilities,
        imageConnection: { label: "Local Image Server", mayUsePaidOrExternalService: false },
      },
    });
    expect(selfHostedIllustrator.rows.find((row) => row.id === "agent:illustrator")).toMatchObject({
      destination: "Local Image Server (configured image connection)",
      warnings: ["Configured image connection reports no paid or external provider use."],
    });
  });

  it("keeps Local Assist agent rows unavailable until the local sidecar is ready", () => {
    const unavailable = resolveRoleplayWorkflowProfile("local-assist", {
      chat,
      capabilities: { ...capabilities, localSidecarReady: false },
    });

    for (const agentId of ["world-state", "expression", "character-tracker"]) {
      expect(unavailable.rows.find((row) => row.id === `agent:${agentId}`)).toMatchObject({
        selectable: false,
        selectedByDefault: false,
        prerequisites: ["The local sidecar must be ready before adding Local Assist agents."],
      });
    }
    expect(() =>
      buildRoleplayWorkflowProfilePatch(unavailable, ["agent:world-state"], "2026-08-26T12:00:00.000Z"),
    ).toThrow("not selectable");
  });

  it("offers an individual agent activation row and applies it for normal chats while respecting explicit disablement", () => {
    const normal = resolveRoleplayWorkflowProfile("longform-continuity", { chat, capabilities });
    expect(normal.rows.find((row) => row.id === "enable-automatic-agents")).toMatchObject({
      selectable: true,
      selectedByDefault: true,
      before: undefined,
      after: true,
    });
    expect(
      buildRoleplayWorkflowProfilePatch(
        normal,
        ["enable-automatic-agents", "agent:continuity"],
        "2026-08-26T12:00:00.000Z",
      ).metadata,
    ).toMatchObject({ enableAgents: true, activeAgentIds: ["continuity"] });

    const explicitlyDisabled = resolveRoleplayWorkflowProfile("longform-continuity", {
      chat: { ...chat, metadata: { ...chat.metadata, enableAgents: false } },
      capabilities,
    });
    expect(explicitlyDisabled.rows.find((row) => row.id === "enable-automatic-agents")).toMatchObject({
      selectedByDefault: false,
      selectable: true,
    });
  });

  it("does not let selected profile agents bypass explicit automatic-agent disablement", () => {
    const explicitlyDisabled = resolveRoleplayWorkflowProfile("longform-continuity", {
      chat: { ...chat, metadata: { ...chat.metadata, enableAgents: false } },
      capabilities,
    });

    expect(explicitlyDisabled.rows.find((row) => row.id === "agent:continuity")).toMatchObject({
      selectedByDefault: false,
      selectable: true,
    });
    expect(() =>
      buildRoleplayWorkflowProfilePatch(explicitlyDisabled, ["agent:continuity"], "2026-08-26T12:00:00.000Z"),
    ).toThrow("enable-automatic-agents");
    expect(
      buildRoleplayWorkflowProfilePatch(
        explicitlyDisabled,
        ["enable-automatic-agents", "agent:continuity"],
        "2026-08-26T12:00:00.000Z",
      ).metadata,
    ).toMatchObject({ enableAgents: true, activeAgentIds: ["continuity"] });
  });

  it("keeps Local Assist agent and route defaults paired when automatic agents are explicitly disabled", () => {
    const explicitlyDisabled = resolveRoleplayWorkflowProfile("local-assist", {
      chat: { ...chat, metadata: { ...chat.metadata, enableAgents: false } },
      capabilities,
    });
    const selectedItemIds = explicitlyDisabled.rows
      .filter((row) => row.kind === "change" && row.selectedByDefault)
      .map((row) => row.id);

    expect(selectedItemIds).not.toContain("agent:world-state");
    expect(selectedItemIds).not.toContain("connection:world-state");
    expect(selectedItemIds).not.toContain("agent:expression");
    expect(selectedItemIds).not.toContain("connection:expression");
    expect(selectedItemIds).not.toContain("agent:character-tracker");
    expect(selectedItemIds).not.toContain("connection:character-tracker");
    expect(() =>
      buildRoleplayWorkflowProfilePatch(explicitlyDisabled, selectedItemIds, "2026-08-26T12:00:00.000Z"),
    ).not.toThrow();
  });

  it("builds a selected-only Local Assist patch without changing the writer connection", () => {
    const localAssist = resolveRoleplayWorkflowProfile("local-assist", {
      chat: {
        ...chat,
        connectionId: "writer-cloud",
        metadata: {
          ...chat.metadata,
          enableAgents: true,
          activeAgentIds: ["continuity"],
          agentConnectionOverrides: { continuity: "review" },
        },
      },
      capabilities,
    });
    const patch = buildRoleplayWorkflowProfilePatch(
      localAssist,
      [
        "agent:world-state",
        "agent:expression",
        "agent:character-tracker",
        "connection:world-state",
        "connection:expression",
        "connection:character-tracker",
      ],
      "2026-08-26T12:00:00.000Z",
    );

    expect(patch).not.toHaveProperty("connectionId");
    expect(patch.metadata).toMatchObject({
      activeAgentIds: ["continuity", "world-state", "expression", "character-tracker"],
      agentConnectionOverrides: {
        continuity: "review",
        "world-state": "sidecar:local",
        expression: "sidecar:local",
        "character-tracker": "sidecar:local",
      },
      roleplayWorkflowApplication: {
        profileId: "local-assist",
        profileVersion: 1,
        appliedAt: "2026-08-26T12:00:00.000Z",
        selectedItemIds: expect.arrayContaining(["connection:world-state"]),
      },
    });
    expect(() =>
      buildRoleplayWorkflowProfilePatch(localAssist, ["agent:illustrator"], "2026-08-26T12:00:00.000Z"),
    ).toThrow("not selectable");
  });

  it("accepts only dependency-safe Local Assist selections for absent, active, and already-routed baselines", () => {
    const absent = resolveRoleplayWorkflowProfile("local-assist", { chat, capabilities });
    expect(() => buildRoleplayWorkflowProfilePatch(absent, ["agent:world-state"], "2026-08-26T12:00:00.000Z")).toThrow(
      "local sidecar route",
    );
    expect(() =>
      buildRoleplayWorkflowProfilePatch(absent, ["connection:world-state"], "2026-08-26T12:00:00.000Z"),
    ).toThrow("active agent");
    expect(() =>
      buildRoleplayWorkflowProfilePatch(
        absent,
        ["enable-automatic-agents", "agent:world-state", "connection:world-state"],
        "2026-08-26T12:00:00.000Z",
      ),
    ).not.toThrow();

    const alreadyActive = resolveRoleplayWorkflowProfile("local-assist", {
      chat: { ...chat, metadata: { ...chat.metadata, activeAgentIds: ["world-state"] } },
      capabilities,
    });
    expect(() =>
      buildRoleplayWorkflowProfilePatch(alreadyActive, ["connection:world-state"], "2026-08-26T12:00:00.000Z"),
    ).not.toThrow();

    const alreadyRouted = resolveRoleplayWorkflowProfile("local-assist", {
      chat: {
        ...chat,
        metadata: {
          ...chat.metadata,
          enableAgents: true,
          agentConnectionOverrides: { "world-state": "sidecar:local" },
        },
      },
      capabilities,
    });
    expect(() =>
      buildRoleplayWorkflowProfilePatch(alreadyRouted, ["agent:world-state"], "2026-08-26T12:00:00.000Z"),
    ).not.toThrow();
  });

  it("reverts only values still owned by the recorded application and clears its receipt", () => {
    const resolution = resolveRoleplayWorkflowProfile("longform-continuity", {
      chat: { ...chat, metadata: { ...chat.metadata, enableAgents: true, activeAgentIds: ["existing"] } },
      capabilities,
    });
    const applied = buildRoleplayWorkflowProfilePatch(
      resolution,
      ["prompt-preset", "memory-recall", "agent:continuity"],
      "2026-08-26T12:00:00.000Z",
    );
    const reverted = buildRoleplayWorkflowProfileRevertPatch(
      {
        promptPresetId: "preset_universal_v2",
        metadata: {
          ...chat.metadata,
          activeAgentIds: ["existing", "continuity"],
          enableMemoryRecall: false,
          roleplayWorkflowApplication: applied.metadata.roleplayWorkflowApplication,
        },
      },
      applied.metadata.roleplayWorkflowApplication!,
    );

    expect(reverted.patch).toMatchObject({
      promptPresetId: null,
      metadata: { activeAgentIds: ["existing"], roleplayWorkflowApplication: null },
    });
    expect(reverted.skippedConflicts).toEqual(["memory-recall"]);
  });

  it("reverts unchanged enablement but preserves a later cadence edit and all plan content", () => {
    const existing = applyContinuityDirectorCommand(
      createDefaultContinuityDirectorState(NOW),
      {
        type: "replace_director_proposals",
        arc: "Recover the archive",
        threads: ["Who changed the map?"],
        beats: ["The map reveals a sealed stair."],
      },
      directorCommandOptions(),
    );
    const resolution = resolveRoleplayWorkflowProfile("longform-continuity", {
      chat: { ...chat, metadata: { ...chat.metadata, roleplayContinuityDirector: existing } },
      capabilities,
    });
    const applied = buildRoleplayWorkflowProfilePatch(
      resolution,
      ["continuity-director", "continuity-director-cadence"],
      NOW,
      existing,
    );
    const withLaterEdit = applyContinuityDirectorConfiguration(
      applied.metadata.roleplayContinuityDirector!,
      { refreshMode: "cadence", refreshEveryAssistantTurns: 20 },
      { now: () => "2026-09-03T13:00:00.000Z" },
    );

    const reverted = buildRoleplayWorkflowProfileRevertPatch(
      {
        promptPresetId: null,
        metadata: {
          ...chat.metadata,
          roleplayContinuityDirector: withLaterEdit,
          roleplayWorkflowApplication: applied.metadata.roleplayWorkflowApplication,
        },
      },
      applied.metadata.roleplayWorkflowApplication!,
      () => "2026-09-03T14:00:00.000Z",
    );

    expect(reverted.patch.metadata.roleplayContinuityDirector).toMatchObject({
      enabled: false,
      refreshMode: "cadence",
      refreshEveryAssistantTurns: 20,
      beats: existing.beats,
    });
    expect(reverted.skippedConflicts).toEqual(["continuity-director-cadence"]);
  });
});
