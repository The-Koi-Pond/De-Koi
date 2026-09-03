import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  apply: vi.fn(),
  revert: vi.fn(),
  createInitialPlan: vi.fn(),
  initialPlanPending: false,
  resolveCapabilities: vi.fn(),
}));

vi.mock("../hooks/use-chat-presets", () => ({
  useApplyRoleplayWorkflowProfile: () => ({ mutateAsync: mocks.apply, isPending: false }),
  useRevertRoleplayWorkflowProfile: () => ({ mutateAsync: mocks.revert, isPending: false }),
  useCreateInitialContinuityPlan: () => ({ mutate: mocks.createInitialPlan, isPending: mocks.initialPlanPending }),
}));

vi.mock("../roleplay-workflow-capabilities", () => ({
  resolveRoleplayWorkflowCapabilities: mocks.resolveCapabilities,
  isLocalSidecarAssignmentReady: vi.fn(async () => true),
}));

import type { Chat } from "../../../../engine/contracts/types/chat";
import {
  buildRoleplayWorkflowProfilePatch,
  resolveRoleplayWorkflowProfile,
} from "../../../../engine/modes/roleplay/workflow-profiles";
import { createDefaultContinuityDirectorState } from "../../../../engine/modes/roleplay/continuity-director/continuity-director-state";
import { useUIStore } from "../../../../shared/stores/ui.store";
import { RoleplayWorkflowProfileChooser } from "./RoleplayWorkflowProfileChooser";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const chat = {
  id: "roleplay-chat",
  mode: "roleplay",
  promptPresetId: null,
  metadata: {
    activeAgentIds: [],
    activeToolIds: [],
    agentOverrides: {},
    presetChoices: {},
    summary: null,
    tags: [],
  },
} as unknown as Chat;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe("RoleplayWorkflowProfileChooser", () => {
  let root: Root;
  let container: HTMLDivElement;

  async function renderChooser(value: Chat, entryPoint: "drawer" | "wizard") {
    await act(async () => {
      root = createRoot(container);
      root.render(<RoleplayWorkflowProfileChooser chat={value} entryPoint={entryPoint} />);
    });
  }

  async function applyLongRunningStory() {
    await renderChooser(chat, "drawer");
    await act(async () => {
      (container.querySelector('[aria-label="Choose Long-Running Story"]') as HTMLButtonElement).click();
    });
    await act(async () => {
      (
        Array.from(container.querySelectorAll("button")).find((button) =>
          button.textContent?.includes("Review and apply"),
        ) as HTMLButtonElement
      ).click();
    });
    await act(async () => {
      (
        Array.from(container.querySelectorAll("button")).find((button) =>
          button.textContent?.includes("Confirm and apply"),
        ) as HTMLButtonElement
      ).click();
    });
  }

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    mocks.initialPlanPending = false;
    mocks.resolveCapabilities.mockResolvedValue({
      hasUniversalPreset: true,
      localSidecarReady: true,
      hasImageConnection: true,
      imageConnection: { label: "Studio Image Cloud", mayUsePaidOrExternalService: true },
      hasUsableBackgroundAssets: true,
      musicModuleEnabled: true,
      ttsReady: true,
    });
    useUIStore.setState({ rightPanelOpen: false, pendingSettingsDestination: null });
  });

  afterEach(() => {
    act(() => root?.unmount());
    container.remove();
    vi.clearAllMocks();
  });

  it.each(["drawer", "wizard"] as const)("explains when to use every workflow in the %s", async (entryPoint) => {
    await renderChooser(chat, entryPoint);
    expect(container.textContent).toContain("What kind of roleplay are you setting up?");
    for (const label of ["Simple Roleplay", "Long-Running Story", "Cinematic Roleplay", "Local Helpers"]) {
      expect(container.querySelector(`[aria-label="Choose ${label}"]`)).toBeTruthy();
    }
    expect(container.textContent).toContain("short or casual chat");
    expect(container.textContent).toContain("many scenes or sessions");
    expect(container.textContent).toContain("expressions, backgrounds, artwork, or music");
    expect(container.textContent).toContain("local sidecar configured");
    expect(container.textContent).toContain("Best for");
    expect(container.textContent).toContain("Adds");
    expect(container.textContent).toContain("Model use");
  });

  it("exposes every workflow's decision guidance through the radio description", async () => {
    await renderChooser(chat, "drawer");

    const radio = container.querySelector('[aria-label="Choose Long-Running Story"]');
    expect(radio?.getAttribute("aria-label")).toBe("Choose Long-Running Story");
    expect(radio?.getAttribute("aria-describedby")).toBe("workflow-profile-longform-continuity-guidance");

    const guidance = container.querySelector("#workflow-profile-longform-continuity-guidance");
    expect(guidance?.textContent).toContain("Best for: A campaign or story spanning many scenes or sessions.");
    expect(guidance?.textContent).toContain("Adds: Continuity checks, world state, summaries, and reviewable future story beats.");
    expect(guidance?.textContent).toContain(
      "Model use: One immediate background Director planning call when applied, then occasional background calls, including one non-blocking planning call every 10 assistant replies.",
    );
  });

  it("shows all four profiles and keeps optional media changes unchecked by default", async () => {
    await renderChooser(chat, "drawer");

    await act(async () => {
      (container.querySelector('[aria-label="Choose Cinematic Roleplay"]') as HTMLButtonElement).click();
    });

    expect((container.querySelector('[aria-label="Illustrator"]') as HTMLInputElement).checked).toBe(false);
    expect((container.querySelector('[aria-label="Music Player"]') as HTMLInputElement).checked).toBe(false);
    expect(container.textContent).toContain("Studio Image Cloud (configured image connection)");
    expect(container.textContent).toContain("Image generation may use paid or external provider services.");
  });

  it("keeps background activity occasional when Director is selected without its cadence", async () => {
    await renderChooser(chat, "drawer");
    expect(container.textContent).toContain("Background model activity: none");

    await act(async () => {
      (container.querySelector('[aria-label="Choose Long-Running Story"]') as HTMLButtonElement).click();
    });
    await act(async () => {
      for (const label of ["Continuity", "World State", "Chat Summary", "continuity director cadence"]) {
        (container.querySelector(`[aria-label="${label}"]`) as HTMLInputElement).click();
      }
    });

    expect((container.querySelector('[aria-label="continuity director"]') as HTMLInputElement).checked).toBe(true);
    expect((container.querySelector('[aria-label="continuity director cadence"]') as HTMLInputElement).checked).toBe(false);
    expect(container.textContent).toContain("Background model activity: occasional");
    expect(container.textContent).toContain("One immediate background planning call when enabled");
    expect(container.textContent).toContain("One non-blocking planning call every 10 assistant replies");
    expect(container.textContent).toContain("No added writer latency");
  });

  it("starts the first Director plan after the workflow write without awaiting it", async () => {
    const workflowResult = {
      outcome: "applied" as const,
      chat,
      resolution: null,
      selectedItemIds: [],
      omittedLocalAgentIds: [],
      skippedLocalRoutingAgentIds: [],
      shouldCreateContinuityPlan: true,
    };
    mocks.apply.mockResolvedValueOnce(workflowResult);

    await applyLongRunningStory();

    expect(workflowResult.outcome).toBe("applied");
    expect(container.textContent).toContain("Workflow applied. Creating the first story plan in the background.");
    expect(mocks.createInitialPlan).toHaveBeenCalledWith("roleplay-chat", expect.any(Object));
  });

  it("reports detached first-plan success without changing the applied workflow outcome", async () => {
    const workflowResult = {
      outcome: "applied" as const,
      chat,
      resolution: null,
      selectedItemIds: [],
      omittedLocalAgentIds: [],
      skippedLocalRoutingAgentIds: [],
      shouldCreateContinuityPlan: true,
    };
    mocks.apply.mockResolvedValueOnce(workflowResult);
    mocks.createInitialPlan.mockImplementation((_id, options) =>
      options.onSuccess({ state: { ...createDefaultContinuityDirectorState(), enabled: true } }),
    );

    await applyLongRunningStory();

    expect(workflowResult.outcome).toBe("applied");
    expect(container.textContent).toContain("Story plan ready for review.");
  });

  it("keeps the ready status when the planner's persisted Director state refetches", async () => {
    const appliedChat = {
      ...chat,
      metadata: {
        ...chat.metadata,
        roleplayWorkflowApplication: {
          profileId: "longform-continuity",
          profileVersion: 2,
          appliedAt: "2026-09-03T14:00:00.000Z",
          selectedItemIds: ["continuity-director"],
          changes: [],
        },
      },
    } as Chat;
    const plannerState = { ...createDefaultContinuityDirectorState(), enabled: true };
    const workflowResult = {
      outcome: "applied" as const,
      chat: appliedChat,
      resolution: null,
      selectedItemIds: [],
      omittedLocalAgentIds: [],
      skippedLocalRoutingAgentIds: [],
      shouldCreateContinuityPlan: true,
    };
    let onPlannerSuccess: ((result: { state: typeof plannerState }) => void) | undefined;
    mocks.apply.mockResolvedValueOnce(workflowResult);
    mocks.createInitialPlan.mockImplementation(
      (_id: string, options: { onSuccess?: (result: { state: typeof plannerState }) => void }) => {
        onPlannerSuccess = options.onSuccess;
      },
    );

    await applyLongRunningStory();
    await act(async () => {
      onPlannerSuccess?.({ state: plannerState });
    });
    expect(container.textContent).toContain("Story plan ready for review.");

    const persistedChat = {
      ...appliedChat,
      metadata: { ...appliedChat.metadata, roleplayContinuityDirector: plannerState },
    } as Chat;
    await act(async () => {
      root.render(<RoleplayWorkflowProfileChooser chat={persistedChat} entryPoint="drawer" />);
    });

    expect(container.textContent).toContain("Story plan ready for review.");
    expect(container.textContent).not.toContain("Chat settings changed. Review the refreshed ledger before applying.");
  });

  it("isolates detached first-plan failure from the applied workflow", async () => {
    const workflowResult = {
      outcome: "applied" as const,
      chat,
      resolution: null,
      selectedItemIds: [],
      omittedLocalAgentIds: [],
      skippedLocalRoutingAgentIds: [],
      shouldCreateContinuityPlan: true,
    };
    mocks.apply.mockResolvedValueOnce(workflowResult);
    mocks.createInitialPlan.mockImplementation((_id, options) => options.onError(new Error("provider offline")));

    await applyLongRunningStory();

    expect(workflowResult.outcome).toBe("applied");
    expect(container.textContent).toContain(
      "Workflow applied, but the first story plan could not be created. Open Continuity Director to retry.",
    );
  });

  it("does not create a first plan when the persisted workflow result does not request one", async () => {
    const workflowResult = {
      outcome: "applied" as const,
      chat,
      resolution: null,
      selectedItemIds: [],
      omittedLocalAgentIds: [],
      skippedLocalRoutingAgentIds: [],
      shouldCreateContinuityPlan: false,
    };
    mocks.apply.mockResolvedValueOnce(workflowResult);

    await applyLongRunningStory();

    expect(workflowResult.outcome).toBe("applied");
    expect(mocks.createInitialPlan).not.toHaveBeenCalled();
  });

  it("guards another Apply while initial planning is pending but leaves Revert available", async () => {
    mocks.initialPlanPending = true;
    const chatWithReceipt = {
      ...chat,
      metadata: {
        ...chat.metadata,
        roleplayWorkflowApplication: {
          profileId: "minimal-clean",
          profileVersion: 1,
          appliedAt: "2026-09-03T14:00:00.000Z",
          selectedItemIds: ["memory-recall"],
          changes: [],
        },
      },
    } as Chat;

    await renderChooser(chatWithReceipt, "drawer");

    const review = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("Review and apply"),
    ) as HTMLButtonElement;
    const revert = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("Revert"),
    ) as HTMLButtonElement;
    expect(review.disabled).toBe(true);
    expect(revert.disabled).toBe(false);
    expect((container.querySelector('[aria-label="Memory Recall"]') as HTMLInputElement).disabled).toBe(false);
  });

  it("keeps the reverted chat and status when an invalidated initial planner later fails", async () => {
    const appliedChat = {
      ...chat,
      metadata: {
        ...chat.metadata,
        roleplayWorkflowApplication: {
          profileId: "longform-continuity",
          profileVersion: 2,
          appliedAt: "2026-09-03T14:00:00.000Z",
          selectedItemIds: ["continuity-director"],
          changes: [],
        },
      },
    } as Chat;
    const revertedChat = {
      ...appliedChat,
      metadata: { ...appliedChat.metadata, roleplayWorkflowApplication: null },
    } as Chat;
    let onPlannerError: ((error: Error) => void) | undefined;
    mocks.apply.mockResolvedValueOnce({
      outcome: "applied",
      chat: appliedChat,
      resolution: null,
      selectedItemIds: [],
      omittedLocalAgentIds: [],
      skippedLocalRoutingAgentIds: [],
      shouldCreateContinuityPlan: true,
    });
    mocks.createInitialPlan.mockImplementation(
      (_id: string, options: { onError?: (error: Error) => void }) => {
        onPlannerError = options.onError;
      },
    );
    mocks.revert.mockResolvedValueOnce({ outcome: "reverted", chat: revertedChat, skippedConflicts: [] });

    await applyLongRunningStory();
    await act(async () => {
      const revert = Array.from(container.querySelectorAll("button")).find((button) =>
        button.textContent?.includes("Revert"),
      ) as HTMLButtonElement;
      revert.click();
    });
    expect(container.textContent).toContain("Workflow profile reverted.");

    await act(async () => {
      onPlannerError?.(new Error("provider offline"));
    });

    expect(container.textContent).toContain("Workflow profile reverted.");
    expect(container.textContent).not.toContain(
      "Workflow applied, but the first story plan could not be created. Open Continuity Director to retry.",
    );
    expect(container.textContent).not.toContain("Applied Long-Running Story, version 2");
  });

  it("keeps a genuinely external workflow update when the initial planner later succeeds", async () => {
    const appliedChat = {
      ...chat,
      metadata: {
        ...chat.metadata,
        roleplayWorkflowApplication: {
          profileId: "longform-continuity",
          profileVersion: 2,
          appliedAt: "2026-09-03T14:00:00.000Z",
          selectedItemIds: ["continuity-director"],
          changes: [],
        },
      },
    } as Chat;
    const plannerState = { ...createDefaultContinuityDirectorState(), enabled: true };
    let onPlannerSuccess: ((result: { state: typeof plannerState }) => void) | undefined;
    mocks.apply.mockResolvedValueOnce({
      outcome: "applied",
      chat: appliedChat,
      resolution: null,
      selectedItemIds: [],
      omittedLocalAgentIds: [],
      skippedLocalRoutingAgentIds: [],
      shouldCreateContinuityPlan: true,
    });
    mocks.createInitialPlan.mockImplementation(
      (_id: string, options: { onSuccess?: (result: { state: typeof plannerState }) => void }) => {
        onPlannerSuccess = options.onSuccess;
      },
    );

    await applyLongRunningStory();
    const externalChat = {
      ...appliedChat,
      metadata: {
        ...appliedChat.metadata,
        enableMemoryRecall: true,
        roleplayWorkflowApplication: {
          profileId: "minimal-clean",
          profileVersion: 1,
          appliedAt: "2026-09-03T14:01:00.000Z",
          selectedItemIds: ["memory-recall"],
          changes: [],
        },
      },
    } as Chat;
    await act(async () => {
      root.render(<RoleplayWorkflowProfileChooser chat={externalChat} entryPoint="drawer" />);
    });
    expect(container.textContent).toContain("Chat settings changed. Review the refreshed ledger before applying.");
    expect(container.textContent).toContain("Applied Simple Roleplay, version 1");

    await act(async () => {
      onPlannerSuccess?.({ state: plannerState });
    });

    expect(container.textContent).toContain("Chat settings changed. Review the refreshed ledger before applying.");
    expect(container.textContent).toContain("Applied Simple Roleplay, version 1");
    expect(container.textContent).not.toContain("Story plan ready for review.");
  });

  it("offers the version-2 Long-Running Story update without selecting existing Director settings", async () => {
    const chatWithLongformV1Receipt = {
      ...chat,
      metadata: {
        ...chat.metadata,
        roleplayWorkflowApplication: {
          profileId: "longform-continuity",
          profileVersion: 1,
          appliedAt: "2026-09-03T12:00:00.000Z",
          selectedItemIds: [],
          changes: [],
        },
        roleplayContinuityDirector: {
          enabled: true,
          refreshMode: "cadence",
          refreshEveryAssistantTurns: 10,
        },
      },
    } as unknown as Chat;

    await renderChooser(chatWithLongformV1Receipt, "drawer");

    expect(container.querySelector('[aria-label="Choose Long-Running Story"]')?.getAttribute("aria-checked")).toBe("true");
    expect(container.querySelector('[role="status"]')?.textContent).toContain(
      "Update available: add automatic story planning",
    );
    expect((container.querySelector('[aria-label="continuity director"]') as HTMLInputElement).checked).toBe(false);
    expect((container.querySelector('[aria-label="continuity director cadence"]') as HTMLInputElement).checked).toBe(false);
    expect(mocks.apply).not.toHaveBeenCalled();
  });

  it("refreshes the Long-Running Story preview for Director-only metadata and another recognized receipt", async () => {
    const longformV1Chat = {
      ...chat,
      metadata: {
        ...chat.metadata,
        roleplayWorkflowApplication: {
          profileId: "longform-continuity",
          profileVersion: 1,
          appliedAt: "2026-09-03T12:00:00.000Z",
          selectedItemIds: [],
          changes: [],
        },
      },
    } as unknown as Chat;
    const longformWithDirector = {
      ...longformV1Chat,
      metadata: {
        ...longformV1Chat.metadata,
        roleplayContinuityDirector: {
          version: 1,
          revision: 1,
          enabled: true,
          connectionId: null,
          refreshMode: "cadence",
          refreshEveryAssistantTurns: 10,
          currentArc: null,
          openThreads: [],
          beats: [],
          sourceSnapshot: null,
          updatedAt: "2026-09-03T12:00:00.000Z",
        },
      },
    } as unknown as Chat;

    await renderChooser(longformV1Chat, "drawer");
    expect((container.querySelector('[aria-label="continuity director"]') as HTMLInputElement).checked).toBe(true);
    expect((container.querySelector('[aria-label="continuity director cadence"]') as HTMLInputElement).checked).toBe(true);

    await act(async () => {
      root.render(<RoleplayWorkflowProfileChooser chat={longformWithDirector} entryPoint="drawer" />);
    });

    expect((container.querySelector('[aria-label="continuity director"]') as HTMLInputElement).checked).toBe(false);
    expect((container.querySelector('[aria-label="continuity director cadence"]') as HTMLInputElement).checked).toBe(false);

    const simpleReceiptChat = {
      ...longformWithDirector,
      id: "another-roleplay-chat",
      metadata: {
        ...longformWithDirector.metadata,
        roleplayWorkflowApplication: {
          profileId: "minimal-clean",
          profileVersion: 1,
          appliedAt: "2026-09-03T12:01:00.000Z",
          selectedItemIds: [],
          changes: [],
        },
      },
    } as unknown as Chat;
    await act(async () => {
      root.render(<RoleplayWorkflowProfileChooser chat={simpleReceiptChat} entryPoint="drawer" />);
    });

    expect(container.querySelector('[aria-label="Choose Simple Roleplay"]')?.getAttribute("aria-checked")).toBe("true");
    expect(container.querySelector('[aria-label="continuity director"]')).toBeNull();
  });

  it("shows disabled prerequisites, honest costs and destinations, settings links, and mobile-first structure", async () => {
    mocks.resolveCapabilities.mockResolvedValue({
      hasUniversalPreset: true,
      localSidecarReady: false,
      hasImageConnection: false,
      imageConnection: null,
      hasUsableBackgroundAssets: false,
      musicModuleEnabled: false,
      ttsReady: false,
    });
    await act(async () => {
      root = createRoot(container);
      root.render(<RoleplayWorkflowProfileChooser chat={chat} entryPoint="drawer" />);
    });

    await act(async () => {
      (container.querySelector('[aria-label="Choose Cinematic Roleplay"]') as HTMLButtonElement).click();
    });

    expect((container.querySelector('[aria-label="Background"]') as HTMLInputElement).disabled).toBe(true);
    expect((container.querySelector('[aria-label="Illustrator"]') as HTMLInputElement).disabled).toBe(true);
    expect(container.textContent).toContain(
      "Background needs usable background assets or a configured image connection.",
    );
    expect(container.textContent).toContain("One call when this helper runs");
    expect(container.textContent).toContain("No added writer latency");
    expect(container.textContent).toContain("YouTube/external music data");
    expect(container.textContent).toContain("Music Player uses YouTube/external music data.");
    expect(container.querySelector('[aria-label="Roleplay workflow profile chooser"]')?.className).toContain(
      "@container",
    );
    expect(container.querySelector('[data-layout="workflow-profile-grid"]')?.className).toContain("@[36rem]:grid-cols");
    expect(container.querySelector('[data-layout="workflow-profile-grid"]')?.className).not.toContain("md:grid-cols");
    expect(container.querySelector('[data-region="profile-list"]')?.className).toContain("order-1");
    expect(container.querySelector('[data-region="change-ledger"]')?.className).toContain("order-2");

    await act(async () => {
      (
        Array.from(container.querySelectorAll("button")).find((button) =>
          button.textContent?.includes("Modules"),
        ) as HTMLButtonElement
      ).click();
    });
    expect(useUIStore.getState()).toMatchObject({
      rightPanelOpen: true,
      rightPanel: "settings",
      settingsTab: "plugins",
      pendingSettingsDestination: "modules",
    });

    await act(async () => {
      (container.querySelector('[aria-label="Choose Local Helpers"]') as HTMLButtonElement).click();
    });
    expect((container.querySelector('[aria-label="World State"]') as HTMLInputElement).disabled).toBe(true);
    expect(container.textContent).toContain("local sidecar must be ready");
    expect(container.textContent).toContain("without changing the writer connection");
  });

  it("preserves toggles during review and requires explicit confirmation before applying", async () => {
    mocks.apply.mockRejectedValueOnce(new Error("storage update failed: disk is read-only"));
    await act(async () => {
      root = createRoot(container);
      root.render(<RoleplayWorkflowProfileChooser chat={chat} entryPoint="drawer" />);
    });
    await act(async () => {
      (container.querySelector('[aria-label="Choose Cinematic Roleplay"]') as HTMLButtonElement).click();
    });
    await act(async () => {
      (container.querySelector('[aria-label="Illustrator"]') as HTMLInputElement).click();
      (
        Array.from(container.querySelectorAll("button")).find((button) =>
          button.textContent?.includes("Review and apply"),
        ) as HTMLButtonElement
      ).click();
    });

    expect(mocks.apply).not.toHaveBeenCalled();
    expect((container.querySelector('[aria-label="Illustrator"]') as HTMLInputElement).checked).toBe(true);

    await act(async () => {
      (
        Array.from(container.querySelectorAll("button")).find((button) =>
          button.textContent?.includes("Confirm and apply"),
        ) as HTMLButtonElement
      ).click();
    });

    expect(mocks.apply).toHaveBeenCalledOnce();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "storage update failed: disk is read-only",
    );
  });

  it("keeps Local Assist agent and local-route toggles dependency-safe in both directions", async () => {
    await act(async () => {
      root = createRoot(container);
      root.render(<RoleplayWorkflowProfileChooser chat={chat} entryPoint="drawer" />);
    });
    await act(async () => {
      (container.querySelector('[aria-label="Choose Local Helpers"]') as HTMLButtonElement).click();
    });

    const agent = () => container.querySelector('[aria-label="World State"]') as HTMLInputElement;
    const route = () => container.querySelector('[aria-label="World State local route"]') as HTMLInputElement;
    expect(agent().checked).toBe(true);
    expect(route().checked).toBe(true);

    await act(async () => route().click());
    expect(agent().checked).toBe(false);
    expect(route().checked).toBe(false);

    await act(async () => agent().click());
    expect(agent().checked).toBe(true);
    expect(route().checked).toBe(true);

    await act(async () => agent().click());
    expect(agent().checked).toBe(false);
    expect(route().checked).toBe(false);
  });

  it("ignores reordered profile capability results and applies one internally consistent profile", async () => {
    await act(async () => {
      root = createRoot(container);
      root.render(<RoleplayWorkflowProfileChooser chat={chat} entryPoint="drawer" />);
    });
    const cinematic = deferred<Awaited<ReturnType<typeof mocks.resolveCapabilities>>>();
    const localAssist = deferred<Awaited<ReturnType<typeof mocks.resolveCapabilities>>>();
    mocks.resolveCapabilities.mockReturnValueOnce(cinematic.promise).mockReturnValueOnce(localAssist.promise);

    act(() => {
      (container.querySelector('[aria-label="Choose Cinematic Roleplay"]') as HTMLButtonElement).click();
      (container.querySelector('[aria-label="Choose Local Helpers"]') as HTMLButtonElement).click();
    });

    await act(async () => {
      localAssist.resolve({
        hasUniversalPreset: true,
        localSidecarReady: true,
        hasImageConnection: true,
        imageConnection: { label: "Studio Image Cloud", mayUsePaidOrExternalService: true },
        hasUsableBackgroundAssets: true,
        musicModuleEnabled: true,
        ttsReady: true,
      });
      await localAssist.promise;
    });
    await act(async () => {
      cinematic.resolve({
        hasUniversalPreset: true,
        localSidecarReady: true,
        hasImageConnection: true,
        imageConnection: { label: "Studio Image Cloud", mayUsePaidOrExternalService: true },
        hasUsableBackgroundAssets: true,
        musicModuleEnabled: true,
        ttsReady: true,
      });
      await cinematic.promise;
    });

    expect(container.querySelector('[aria-label="Choose Local Helpers"]')?.getAttribute("aria-checked")).toBe("true");
    expect(container.querySelector('[aria-label="Character Tracker"]')).toBeTruthy();
    expect(container.querySelector('[aria-label="Background"]')).toBeNull();
    mocks.apply.mockRejectedValueOnce(new Error("inspection stop"));
    await act(async () => {
      (
        Array.from(container.querySelectorAll("button")).find((button) =>
          button.textContent?.includes("Review and apply"),
        ) as HTMLButtonElement
      ).click();
    });
    await act(async () => {
      (
        Array.from(container.querySelectorAll("button")).find((button) =>
          button.textContent?.includes("Confirm and apply"),
        ) as HTMLButtonElement
      ).click();
    });

    expect(mocks.apply).toHaveBeenCalledWith(
      expect.objectContaining({
        profileId: "local-assist",
        preview: expect.objectContaining({ profileId: "local-assist" }),
        selectedItemIds: expect.arrayContaining(["agent:character-tracker", "connection:character-tracker"]),
      }),
    );
  });

  it.each(["drawer", "wizard"] as const)(
    "keeps explicit automatic-agent disablement valid through the %s chooser entry point",
    async (entryPoint) => {
      const disabledChat = {
        ...chat,
        metadata: { ...chat.metadata, enableAgents: false },
      } as Chat;
      mocks.apply.mockImplementationOnce(async (input) => {
        expect(() =>
          buildRoleplayWorkflowProfilePatch(input.preview, input.selectedItemIds, "2026-08-26T12:00:00.000Z"),
        ).not.toThrow();
        return {
          outcome: "applied",
          chat: disabledChat,
          skippedLocalRoutingAgentIds: [],
          omittedLocalAgentIds: [],
        };
      });
      await act(async () => {
        root = createRoot(container);
        root.render(<RoleplayWorkflowProfileChooser chat={disabledChat} entryPoint={entryPoint} />);
      });
      await act(async () => {
        (container.querySelector('[aria-label="Choose Local Helpers"]') as HTMLButtonElement).click();
      });

      expect(container.querySelector('[aria-label="Roleplay workflow profile chooser"]')?.getAttribute("data-entry-point"))
        .toBe(entryPoint);
      expect((container.querySelector('[aria-label="Enable automatic agents"]') as HTMLInputElement).checked).toBe(
        false,
      );
      expect((container.querySelector('[aria-label="World State"]') as HTMLInputElement).checked).toBe(false);
      expect((container.querySelector('[aria-label="World State local route"]') as HTMLInputElement).checked).toBe(
        false,
      );
      await act(async () => {
        (
          Array.from(container.querySelectorAll("button")).find((button) =>
            button.textContent?.includes("Review and apply"),
          ) as HTMLButtonElement
        ).click();
      });
      await act(async () => {
        (
          Array.from(container.querySelectorAll("button")).find((button) =>
            button.textContent?.includes("Confirm and apply"),
          ) as HTMLButtonElement
        ).click();
      });

      expect(mocks.apply).toHaveBeenCalledWith(
        expect.objectContaining({
          profileId: "local-assist",
          preview: expect.objectContaining({ profileId: "local-assist" }),
          selectedItemIds: expect.not.arrayContaining([
            "agent:world-state",
            "connection:world-state",
            "agent:expression",
            "connection:expression",
            "agent:character-tracker",
            "connection:character-tracker",
          ]),
        }),
      );
    },
  );

  it("revokes confirmation and resets the ledger when a changed live chat arrives", async () => {
    await act(async () => {
      root = createRoot(container);
      root.render(<RoleplayWorkflowProfileChooser chat={chat} entryPoint="drawer" />);
    });
    await act(async () => {
      (container.querySelector('[aria-label="Choose Cinematic Roleplay"]') as HTMLButtonElement).click();
    });
    await act(async () => {
      (container.querySelector('[aria-label="Illustrator"]') as HTMLInputElement).click();
    });
    await act(async () => {
      (
        Array.from(container.querySelectorAll("button")).find((button) =>
          button.textContent?.includes("Review and apply"),
        ) as HTMLButtonElement
      ).click();
    });
    expect(container.textContent).toContain("Confirm and apply");

    const changedChat = {
      ...chat,
      metadata: { ...chat.metadata, activeAgentIds: ["illustrator"] },
    } as Chat;
    await act(async () => {
      root.render(<RoleplayWorkflowProfileChooser chat={changedChat} entryPoint="drawer" />);
    });

    expect(container.textContent).not.toContain("Confirm and apply");
    expect(container.textContent).toContain("Chat settings changed. Review the refreshed ledger before applying.");
    expect(container.querySelector('[aria-label="Illustrator"]')).toBeNull();
    expect(container.querySelector('[aria-label="Choose Simple Roleplay"]')?.getAttribute("aria-checked")).toBe("true");
  });

  it("keeps Music Player disabled and unchecked until the optional module is enabled", async () => {
    mocks.resolveCapabilities.mockResolvedValue({
      hasUniversalPreset: true,
      localSidecarReady: true,
      hasImageConnection: true,
      imageConnection: { label: "Studio Image Cloud", mayUsePaidOrExternalService: true },
      hasUsableBackgroundAssets: true,
      musicModuleEnabled: false,
      ttsReady: true,
    });
    await act(async () => {
      root = createRoot(container);
      root.render(<RoleplayWorkflowProfileChooser chat={chat} entryPoint="drawer" />);
    });
    await act(async () => {
      (container.querySelector('[aria-label="Choose Cinematic Roleplay"]') as HTMLButtonElement).click();
    });

    expect((container.querySelector('[aria-label="Music Player"]') as HTMLInputElement).disabled).toBe(true);
    expect((container.querySelector('[aria-label="Music Player"]') as HTMLInputElement).checked).toBe(false);
  });

  it("replaces a stale preview and forces the refreshed ledger through review again", async () => {
    const staleCapabilities = {
      hasUniversalPreset: true,
      localSidecarReady: true,
      hasImageConnection: false,
      imageConnection: null,
      hasUsableBackgroundAssets: false,
      musicModuleEnabled: true,
      ttsReady: true,
    };
    mocks.apply.mockImplementationOnce(async (input: { profileId: "cinematic"; selectedItemIds: string[] }) => ({
      outcome: "stale",
      resolution: resolveRoleplayWorkflowProfile(input.profileId, { chat, capabilities: staleCapabilities }),
      selectedItemIds: input.selectedItemIds,
      omittedLocalAgentIds: [],
    }));
    await act(async () => {
      root = createRoot(container);
      root.render(<RoleplayWorkflowProfileChooser chat={chat} entryPoint="drawer" />);
    });
    await act(async () => {
      (container.querySelector('[aria-label="Choose Cinematic Roleplay"]') as HTMLButtonElement).click();
    });
    await act(async () => {
      (
        Array.from(container.querySelectorAll("button")).find((button) =>
          button.textContent?.includes("Review and apply"),
        ) as HTMLButtonElement
      ).click();
    });
    await act(async () => {
      (
        Array.from(container.querySelectorAll("button")).find((button) =>
          button.textContent?.includes("Confirm and apply"),
        ) as HTMLButtonElement
      ).click();
    });

    expect(container.textContent).toContain("Settings changed since this preview");
    expect((container.querySelector('[aria-label="Background"]') as HTMLInputElement).disabled).toBe(true);
    expect(
      Array.from(container.querySelectorAll("button")).some((button) =>
        button.textContent?.includes("Confirm and apply"),
      ),
    ).toBe(false);
    expect(
      Array.from(container.querySelectorAll("button")).some((button) =>
        button.textContent?.includes("Review and apply"),
      ),
    ).toBe(true);
  });

  it("names omitted Local Assist assignments and says no external fallback was used", async () => {
    mocks.apply.mockResolvedValueOnce({
      outcome: "applied",
      chat,
      resolution: null,
      selectedItemIds: [],
      omittedLocalAgentIds: ["world-state", "character-tracker"],
      skippedLocalRoutingAgentIds: [],
    });
    await act(async () => {
      root = createRoot(container);
      root.render(<RoleplayWorkflowProfileChooser chat={chat} entryPoint="drawer" />);
    });
    await act(async () => {
      (container.querySelector('[aria-label="Choose Local Helpers"]') as HTMLButtonElement).click();
    });
    await act(async () => {
      (
        Array.from(container.querySelectorAll("button")).find((button) =>
          button.textContent?.includes("Review and apply"),
        ) as HTMLButtonElement
      ).click();
    });
    await act(async () => {
      (
        Array.from(container.querySelectorAll("button")).find((button) =>
          button.textContent?.includes("Confirm and apply"),
        ) as HTMLButtonElement
      ).click();
    });

    expect(container.textContent).toContain("World State");
    expect(container.textContent).toContain("Character Tracker");
    expect(container.textContent).toContain("no external fallback was used");
  });

  it("reports skipped local routing precisely when an already-active agent keeps its existing connection", async () => {
    const activeChat = {
      ...chat,
      metadata: {
        ...chat.metadata,
        activeAgentIds: ["world-state"],
        agentConnectionOverrides: { "world-state": "writer-cloud" },
      },
    } as Chat;
    mocks.apply.mockResolvedValueOnce({
      outcome: "applied",
      chat: activeChat,
      resolution: null,
      selectedItemIds: [],
      omittedLocalAgentIds: [],
      skippedLocalRoutingAgentIds: ["world-state"],
    });
    await act(async () => {
      root = createRoot(container);
      root.render(<RoleplayWorkflowProfileChooser chat={activeChat} entryPoint="drawer" />);
    });
    await act(async () => {
      (container.querySelector('[aria-label="Choose Local Helpers"]') as HTMLButtonElement).click();
    });
    await act(async () => {
      (
        Array.from(container.querySelectorAll("button")).find((button) =>
          button.textContent?.includes("Review and apply"),
        ) as HTMLButtonElement
      ).click();
    });
    await act(async () => {
      (
        Array.from(container.querySelectorAll("button")).find((button) =>
          button.textContent?.includes("Confirm and apply"),
        ) as HTMLButtonElement
      ).click();
    });

    expect(container.textContent).toContain(
      "Local routing was skipped for World State. It remains active on its existing connection; this profile chose no substitute or fallback.",
    );
    expect(container.textContent).not.toContain("Applied without World State");
  });

  it("preserves apply status when query refetch returns a semantically equivalent chat object", async () => {
    const appliedChat = {
      ...chat,
      metadata: {
        ...chat.metadata,
        enableMemoryRecall: true,
        roleplayWorkflowApplication: {
          profileId: "minimal-clean",
          profileVersion: 1,
          appliedAt: "2026-08-26T12:34:00.000Z",
          selectedItemIds: ["memory-recall"],
          changes: [],
        },
      },
    } as Chat;
    mocks.apply.mockResolvedValueOnce({
      outcome: "applied",
      chat: appliedChat,
      resolution: null,
      selectedItemIds: ["memory-recall"],
      omittedLocalAgentIds: [],
      skippedLocalRoutingAgentIds: [],
    });
    await act(async () => {
      root = createRoot(container);
      root.render(<RoleplayWorkflowProfileChooser chat={chat} entryPoint="drawer" />);
    });
    await act(async () => {
      (
        Array.from(container.querySelectorAll("button")).find((button) =>
          button.textContent?.includes("Review and apply"),
        ) as HTMLButtonElement
      ).click();
    });
    await act(async () => {
      (
        Array.from(container.querySelectorAll("button")).find((button) =>
          button.textContent?.includes("Confirm and apply"),
        ) as HTMLButtonElement
      ).click();
    });
    expect(container.textContent).toContain("Simple Roleplay applied.");

    await act(async () => {
      root.render(
        <RoleplayWorkflowProfileChooser
          chat={{ ...appliedChat, metadata: { ...appliedChat.metadata } }}
          entryPoint="drawer"
        />,
      );
    });

    expect(container.textContent).toContain("Simple Roleplay applied.");
    expect(container.textContent).not.toContain("Chat settings changed. Review the refreshed ledger");
  });

  it("shows active receipt details and reports readable conflicts while preserving later edits", async () => {
    const chatWithReceipt = {
      ...chat,
      metadata: {
        ...chat.metadata,
        roleplayWorkflowApplication: {
          profileId: "longform-continuity",
          profileVersion: 1,
          appliedAt: "2026-08-26T12:34:00.000Z",
          selectedItemIds: ["memory-recall"],
          changes: [],
        },
      },
    } as Chat;
    const revertedChat = {
      ...chatWithReceipt,
      metadata: { ...chatWithReceipt.metadata, roleplayWorkflowApplication: null },
    } as Chat;
    mocks.revert.mockResolvedValueOnce({
      outcome: "reverted",
      chat: revertedChat,
      skippedConflicts: ["memory-recall", "agent:world-state"],
    });
    await act(async () => {
      root = createRoot(container);
      root.render(<RoleplayWorkflowProfileChooser chat={chatWithReceipt} entryPoint="drawer" />);
    });

    expect(container.textContent).toContain("Applied Long-Running Story, version 1");
    await act(async () => {
      (
        Array.from(container.querySelectorAll("button")).find((button) =>
          button.textContent?.includes("Revert"),
        ) as HTMLButtonElement
      ).click();
    });
    expect(container.textContent).toContain("Kept your later edits to Memory Recall, World State");

    await act(async () => {
      root.render(
        <RoleplayWorkflowProfileChooser
          chat={{ ...revertedChat, metadata: { ...revertedChat.metadata } }}
          entryPoint="drawer"
        />,
      );
    });
    expect(container.textContent).toContain("Kept your later edits to Memory Recall, World State");
    expect(container.textContent).not.toContain("Chat settings changed. Review the refreshed ledger");
  });

  it("refreshes honestly when a receipt disappeared before revert", async () => {
    const chatWithReceipt = {
      ...chat,
      metadata: {
        ...chat.metadata,
        roleplayWorkflowApplication: {
          profileId: "minimal-clean",
          profileVersion: 1,
          appliedAt: "2026-08-26T12:34:00.000Z",
          selectedItemIds: ["prompt-preset"],
          changes: [],
        },
      },
    } as Chat;
    const refreshedChat = {
      ...chatWithReceipt,
      metadata: { ...chatWithReceipt.metadata, roleplayWorkflowApplication: null },
    } as Chat;
    mocks.revert.mockResolvedValueOnce({ outcome: "not_applied", chat: refreshedChat, skippedConflicts: [] });
    await act(async () => {
      root = createRoot(container);
      root.render(<RoleplayWorkflowProfileChooser chat={chatWithReceipt} entryPoint="drawer" />);
    });

    await act(async () => {
      (
        Array.from(container.querySelectorAll("button")).find((button) =>
          button.textContent?.includes("Revert"),
        ) as HTMLButtonElement
      ).click();
    });

    expect(container.textContent).toContain(
      "No workflow profile is currently applied. Current chat state was refreshed.",
    );
    expect(container.textContent).not.toContain("Applied Simple Roleplay");
  });
});
