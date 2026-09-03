# Roleplay Workflow Guidance and Continuity Director Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Roleplay workflow choices understandable in plain language and make the Long-Running Story workflow configure and start Continuity Director automatically without allowing model-authored beats to approve themselves.

**Architecture:** Keep workflow meaning, versioning, reversible configuration, and stale-preview detection in the React-free Roleplay engine. Keep the workflow storage write atomic, return an explicit initial-plan signal, and let the feature layer start the existing guarded planner only after persistence. Derive review badges from persisted proposed beats so readiness survives closed or unmounted setup UI.

**Tech Stack:** TypeScript, React, TanStack Query, Vitest, Testing Library DOM patterns, existing storage and LLM capability gateways.

## Global Constraints

- Preserve stable profile IDs: `minimal-clean`, `longform-continuity`, `cinematic`, and `local-assist`.
- Advance only `longform-continuity` to profile version 2.
- Do not enable Continuity Director for every Roleplay chat or mutate chats merely because they are opened.
- Long-Running Story defaults to Continuity Director enabled with cadence mode every 10 saved assistant replies.
- Persist the workflow before starting first-plan creation; planning failure must not roll back workflow application.
- Never auto-approve Director-generated beats; only persisted `approved` beats may enter writer prompts.
- Preserve Director arc, threads, beats, connection choice, source snapshot, and later user configuration changes.
- Keep workflow receipts free of arc, thread, and beat content.
- Keep Conversation and Game behavior unchanged.

---

### Task 1: Add a content-safe Continuity Director configuration boundary

**Files:**
- Modify: `src/engine/modes/roleplay/continuity-director/continuity-director-state.ts:145-270`
- Modify: `src/engine/modes/roleplay/continuity-director/continuity-director-state.spec.ts:35-100`

**Interfaces:**
- Consumes: `RoleplayContinuityDirectorState`, `ContinuityDirectorRefreshMode`, and the existing cadence normalization rules.
- Produces: `ContinuityDirectorConfiguration`, `readContinuityDirectorConfiguration(value)`, `applyContinuityDirectorConfiguration(state, patch, options)`, and `countProposedContinuityDirectorBeats(value)`.

- [ ] **Step 1: Write failing configuration and review-count tests**

Add focused cases proving configuration edits preserve content, invalid cadence values normalize through the existing rule, the revision increments once, and proposed counts ignore every non-proposed status:

```ts
it("updates only director configuration and preserves plan content", () => {
  const options = commandOptions();
  const state = applyContinuityDirectorCommand(createDefaultContinuityDirectorState(NOW), {
    type: "replace_director_proposals",
    arc: "Recover the sealed archive",
    threads: ["Who altered the map?"],
    beats: ["The map points beneath the city."],
  }, options);

  const next = applyContinuityDirectorConfiguration(
    state,
    { enabled: true, refreshMode: "cadence", refreshEveryAssistantTurns: 10 },
    options,
  );

  expect(next).toMatchObject({
    enabled: true,
    refreshMode: "cadence",
    refreshEveryAssistantTurns: 10,
    currentArc: state.currentArc,
    openThreads: state.openThreads,
    beats: state.beats,
    sourceSnapshot: state.sourceSnapshot,
    revision: state.revision + 1,
  });
});

it("counts only proposed beats from normalized state", () => {
  const state = proposedState();
  expect(countProposedContinuityDirectorBeats({
    ...state,
    beats: [state.beats[0]!, { ...state.beats[1]!, status: "approved" }],
  })).toBe(1);
  expect(countProposedContinuityDirectorBeats(undefined)).toBe(0);
});
```

- [ ] **Step 2: Run the state suite and verify the new tests fail**

Run:

```bash
pnpm vitest run src/engine/modes/roleplay/continuity-director/continuity-director-state.spec.ts
```

Expected: FAIL because the three exported configuration helpers do not exist.

- [ ] **Step 3: Implement the configuration helpers**

Add these exported contracts and keep validation centralized in this file:

```ts
export interface ContinuityDirectorConfiguration {
  enabled: boolean;
  refreshMode: ContinuityDirectorRefreshMode;
  refreshEveryAssistantTurns: ContinuityDirectorCadence | null;
  connectionId: string | null;
  hasSourceSnapshot: boolean;
}

export function readContinuityDirectorConfiguration(value: unknown): ContinuityDirectorConfiguration {
  const state = normalizeContinuityDirectorState(value);
  return {
    enabled: state.enabled,
    refreshMode: state.refreshMode,
    refreshEveryAssistantTurns: state.refreshEveryAssistantTurns,
    connectionId: state.connectionId,
    hasSourceSnapshot: state.sourceSnapshot !== null,
  };
}

export function applyContinuityDirectorConfiguration(
  state: RoleplayContinuityDirectorState,
  patch: Partial<Pick<RoleplayContinuityDirectorState, "enabled" | "refreshMode" | "refreshEveryAssistantTurns">>,
  options: ContinuityDirectorCommandOptions = {},
): RoleplayContinuityDirectorState {
  const refreshMode = patch.refreshMode ?? state.refreshMode;
  const refreshEveryAssistantTurns =
    refreshMode === "cadence"
      ? cadence(patch.refreshEveryAssistantTurns ?? state.refreshEveryAssistantTurns)
      : null;
  const next = {
    ...state,
    enabled: patch.enabled ?? state.enabled,
    refreshMode,
    refreshEveryAssistantTurns,
  };
  if (
    next.enabled === state.enabled &&
    next.refreshMode === state.refreshMode &&
    next.refreshEveryAssistantTurns === state.refreshEveryAssistantTurns
  ) return state;
  const now = options.now?.() ?? new Date().toISOString();
  return { ...next, revision: state.revision + 1, updatedAt: now };
}

export function countProposedContinuityDirectorBeats(value: unknown): number {
  return normalizeContinuityDirectorState(value).beats.filter((beat) => beat.status === "proposed").length;
}
```

- [ ] **Step 4: Run the state suite and verify it passes**

Run the Step 2 command.

Expected: PASS with all state tests green.

- [ ] **Step 5: Commit the isolated state boundary**

```bash
git add src/engine/modes/roleplay/continuity-director/continuity-director-state.ts src/engine/modes/roleplay/continuity-director/continuity-director-state.spec.ts
git commit -m "feat: add continuity director configuration boundary"
```

---

### Task 2: Version Long-Running Story and make Director changes reversible

**Files:**
- Modify: `src/engine/contracts/types/chat.ts:125-158`
- Modify: `src/engine/modes/roleplay/workflow-profiles.ts:1-520`
- Modify: `src/engine/modes/roleplay/workflow-profiles.spec.ts:1-430`
- Modify: `src/features/catalog/chat-presets/hooks/use-chat-presets.ts:315-475`
- Modify: `src/features/catalog/chat-presets/hooks/use-chat-presets.spec.ts:120-570`

**Interfaces:**
- Consumes: Task 1 configuration helpers and the existing atomic workflow apply/revert functions.
- Produces: version-2 Longform rows `continuity-director` and `continuity-director-cadence`; `ApplyRoleplayWorkflowProfileResult.shouldCreateContinuityPlan`; receipt support for three Director configuration field paths.

- [ ] **Step 1: Write failing resolver and patch tests**

Replace the exact-v1 recipe assertion with per-profile version assertions and add these cases:

Extend the existing imports with `applyContinuityDirectorCommand`, `applyContinuityDirectorConfiguration`, `createDefaultContinuityDirectorState`, and the renamed `ROLEPLAY_WORKFLOW_PROFILE_RECIPES`. Add these deterministic fixtures below the existing `chat` fixture:

```ts
const NOW = "2026-09-03T12:00:00.000Z";

function directorCommandOptions() {
  let id = 0;
  return {
    now: () => NOW,
    createId: (prefix: string) => `${prefix}-${++id}`,
  };
}
```

```ts
it("adds selected-by-default Director configuration to Longform version 2", () => {
  const resolution = resolveRoleplayWorkflowProfile("longform-continuity", { chat, capabilities });

  expect(resolution.version).toBe(2);
  expect(resolution.rows.find((row) => row.id === "continuity-director")).toMatchObject({
    before: false,
    after: true,
    selectedByDefault: true,
    expectedExtraCalls: 0,
  });
  expect(resolution.rows.find((row) => row.id === "continuity-director-cadence")).toMatchObject({
    after: { mode: "cadence", everyAssistantTurns: 10 },
    selectedByDefault: true,
    expectedExtraCalls: 1,
    modelUse: "One non-blocking planning call every 10 assistant replies",
  });
  expect(() => buildRoleplayWorkflowProfilePatch(
    resolution,
    ["continuity-director-cadence"],
    NOW,
  )).toThrow("requires Continuity Director to be enabled");
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
```

Add this revert case. Refresh mode and cadence are one coupled policy for conflict detection: if either current value differs from the applied pair, skip reverting both.

```ts
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
```

- [ ] **Step 2: Run the engine workflow suite and verify red tests**

Run:

```bash
pnpm vitest run src/engine/modes/roleplay/workflow-profiles.spec.ts
```

Expected: FAIL on version 1, missing Director rows, unsupported receipt fields, and the old patch signature.

- [ ] **Step 3: Extend receipt fields without permitting story content**

Add only these field names to `RoleplayWorkflowApplicationChange["field"]`:

```ts
| "metadata.roleplayContinuityDirector.enabled"
| "metadata.roleplayContinuityDirector.refreshMode"
| "metadata.roleplayContinuityDirector.refreshEveryAssistantTurns"
```

Do not add `RoleplayContinuityDirectorState` or arbitrary objects to `RoleplayWorkflowApplicationFieldValue`.

- [ ] **Step 4: Implement Longform version 2 and Director rows**

Rename the misleading `ROLEPLAY_WORKFLOW_PROFILE_RECIPES_V1` export and its internal uses to `ROLEPLAY_WORKFLOW_PROFILE_RECIPES`. Keep versions explicit:

```ts
export interface RoleplayWorkflowProfileRecipe {
  version: 1 | 2;
  agentIds: readonly string[];
  optionalAgentIds?: readonly string[];
  connectionOverrides?: Readonly<Record<string, string>>;
  runIntervalOverrides?: Readonly<Record<string, number>>;
  continuityDirector?: { enabled: true; mode: "cadence"; everyAssistantTurns: 10 };
}

export const ROLEPLAY_WORKFLOW_PROFILE_RECIPES = {
  "minimal-clean": { version: 1, agentIds: [] },
  "longform-continuity": {
    version: 2,
    agentIds: [BUILT_IN_AGENT_IDS.CONTINUITY, BUILT_IN_AGENT_IDS.WORLD_STATE, BUILT_IN_AGENT_IDS.CHAT_SUMMARY],
    runIntervalOverrides: { [BUILT_IN_AGENT_IDS.CHAT_SUMMARY]: 5 },
    continuityDirector: { enabled: true, mode: "cadence", everyAssistantTurns: 10 },
  },
  cinematic: { version: 1, agentIds: [BUILT_IN_AGENT_IDS.EXPRESSION, BUILT_IN_AGENT_IDS.BACKGROUND], optionalAgentIds: [BUILT_IN_AGENT_IDS.ILLUSTRATOR, BUILT_IN_AGENT_IDS.MUSIC_DJ] },
  "local-assist": { version: 1, agentIds: [BUILT_IN_AGENT_IDS.WORLD_STATE, BUILT_IN_AGENT_IDS.EXPRESSION, BUILT_IN_AGENT_IDS.CHARACTER_TRACKER], connectionOverrides: { [BUILT_IN_AGENT_IDS.WORLD_STATE]: LOCAL_SIDECAR_CONNECTION_ID, [BUILT_IN_AGENT_IDS.EXPRESSION]: LOCAL_SIDECAR_CONNECTION_ID, [BUILT_IN_AGENT_IDS.CHARACTER_TRACKER]: LOCAL_SIDECAR_CONNECTION_ID } },
} as const satisfies Readonly<Record<RoleplayWorkflowProfileId, RoleplayWorkflowProfileRecipe>>;
```

Add `modelUse: string` and `addsWriterLatency: boolean` to every change row. Existing agent rows use `"One call when this helper runs"`; the Director cadence row uses the exact string from the red test and `addsWriterLatency: false`.

Add this exact configuration-only baseline field to `RoleplayWorkflowProfileResolution`:

```ts
baseline: {
  promptPresetId: string | null;
  metadata: Pick<ChatMetadata, "enableMemoryRecall" | "enableAgents" | "activeAgentIds" | "agentConnectionOverrides" | "agentRunIntervalOverrides">;
  continuityDirector: ContinuityDirectorConfiguration;
};
```

Only select the Director rows by default when `chat.metadata.roleplayContinuityDirector === undefined`. Existing metadata, including explicit `enabled: false`, is a user choice.

- [ ] **Step 5: Apply and revert scalar Director configuration through Task 1**

Change the builder signature and use the normalized current state only when a Director row is selected:

```ts
export function buildRoleplayWorkflowProfilePatch(
  resolution: RoleplayWorkflowProfileResolution,
  itemIds: readonly string[],
  appliedAt: string,
  currentDirectorValue?: unknown,
): RoleplayWorkflowProfilePatch
```

Build one next state with `applyContinuityDirectorConfiguration`, record the three scalar before/after changes with their row item IDs, and assign the complete preserved state only to `metadata.roleplayContinuityDirector`. Extend `currentValueForReceiptField` and revert assembly for the three scalar fields. Treat refresh mode and cadence as the coupled `continuity-director-cadence` row during conflict detection: a mismatch in either skips both. Revert must build one next Director state and bump its revision once; it must never serialize or compare plan content in a receipt.

Reject a selected `continuity-director-cadence` row unless the baseline Director is already enabled or `continuity-director` is selected in the same application. Change the revert signature so its single revision timestamp is deterministic in tests:

```ts
export function buildRoleplayWorkflowProfileRevertPatch(
  current: { promptPresetId: string | null; metadata: Partial<ChatMetadata> },
  receipt: RoleplayWorkflowApplicationReceipt,
  now: () => string = () => new Date().toISOString(),
): RoleplayWorkflowProfileRevertResult
```

- [ ] **Step 6: Write failing apply-result tests for initial-plan eligibility**

Extend the spec imports with `type Chat`, `type RoleplayContinuityDirectorState`, `createDefaultContinuityDirectorState`, and `resolveRoleplayWorkflowProfile`. Add `const NOW = "2026-09-03T12:00:00.000Z";` beside the existing `capabilities` fixture, then add this local helper:

```ts
async function applyLongformWithDirector(director?: RoleplayContinuityDirectorState) {
  let currentChat: Chat = {
    id: "chat-1",
    mode: roleplayMode,
    promptPresetId: null,
    metadata: { activeAgentIds: [], ...(director ? { roleplayContinuityDirector: director } : {}) },
  };
  const preview = resolveRoleplayWorkflowProfile("longform-continuity", { chat: currentChat, capabilities });
  const selectedItemIds = preview.rows
    .filter((row) => row.kind === "change" && row.selectedByDefault)
    .map((row) => row.id);
  return applyRoleplayWorkflowProfile({
    chatId: currentChat.id,
    profileId: "longform-continuity",
    preview,
    selectedItemIds,
    resolveCapabilities: async () => capabilities,
    storage: {
      get: async () => currentChat,
      update: async (_entity, _id, patch) => {
        currentChat = { ...currentChat, ...patch, metadata: { ...currentChat.metadata, ...patch.metadata } };
        return currentChat;
      },
    } as never,
    now: () => NOW,
  });
}
```

```ts
it("requests one initial plan only after newly enabling a snapshot-less Director", async () => {
  const result = await applyLongformWithDirector();
  expect(result).toMatchObject({ outcome: "applied", shouldCreateContinuityPlan: true });
});

it.each([true, false])("does not request an initial plan for an explicitly configured Director", async (enabled) => {
  const director = { ...createDefaultContinuityDirectorState(NOW), enabled };
  const result = await applyLongformWithDirector(director);
  expect(result).toMatchObject({ outcome: "applied", shouldCreateContinuityPlan: false });
});
```

- [ ] **Step 7: Return the eligibility signal after the atomic write**

Add `shouldCreateContinuityPlan: boolean` to the applied result variant and `false` to the stale variant. Compute it from the freshly resolved baseline plus accepted selections:

```ts
const shouldCreateContinuityPlan =
  selected.has("continuity-director") &&
  !resolution.baseline.continuityDirector.enabled &&
  !resolution.baseline.continuityDirector.hasSourceSnapshot;
```

Pass `chat.metadata.roleplayContinuityDirector` to the patch builder. Do not call the LLM or shared Director API from `applyRoleplayWorkflowProfile`.

- [ ] **Step 8: Run engine and persistence suites**

Run:

```bash
pnpm vitest run src/engine/modes/roleplay/workflow-profiles.spec.ts src/features/catalog/chat-presets/hooks/use-chat-presets.spec.ts
```

Expected: PASS with Director content preserved, scalar receipts, conflict-safe revert, and correct initial-plan signals.

- [ ] **Step 9: Commit the versioned workflow contract**

```bash
git add src/engine/contracts/types/chat.ts src/engine/modes/roleplay/workflow-profiles.ts src/engine/modes/roleplay/workflow-profiles.spec.ts src/features/catalog/chat-presets/hooks/use-chat-presets.ts src/features/catalog/chat-presets/hooks/use-chat-presets.spec.ts
git commit -m "feat: add continuity director to longform workflow"
```

---

### Task 3: Replace technical profile descriptions with decision guidance

**Files:**
- Modify: `src/features/catalog/chat-presets/components/RoleplayWorkflowProfileChooser.tsx:16-170,395-520`
- Modify: `src/features/catalog/chat-presets/components/RoleplayWorkflowProfileChooser.spec.tsx:55-145,560-690`
- Modify: `src/features/catalog/chat-presets/components/RoleplayWorkflowProfileDrawerControl.tsx:25-40`

**Interfaces:**
- Consumes: Task 2 profile versions, row `modelUse`, and existing receipt metadata.
- Produces: structured `ProfilePresentation`; plain-language cards; version-1 Longform update affordance; honest aggregate activity summary.

- [ ] **Step 1: Write failing chooser-copy tests for both entry points**

Add this helper beside the existing component fixtures:

```tsx
async function renderChooser(value: Chat, entryPoint: "drawer" | "wizard") {
  await act(async () => {
    root = createRoot(container);
    root.render(<RoleplayWorkflowProfileChooser chat={value} entryPoint={entryPoint} />);
  });
}
```

```ts
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
```

Add a Longform selection assertion that the aggregate reads `Background model activity: occasional`, while Simple Roleplay reads `Background model activity: none`.

- [ ] **Step 2: Run the chooser suite and verify copy tests fail**

Run:

```bash
pnpm vitest run src/features/catalog/chat-presets/components/RoleplayWorkflowProfileChooser.spec.tsx
```

Expected: FAIL on old labels, absent guidance fields, and old `expected extra calls` summary.

- [ ] **Step 3: Implement structured presentation copy**

Replace `description` with this exact data shape and copy:

```ts
interface ProfilePresentation {
  id: RoleplayWorkflowProfileId;
  label: string;
  bestFor: string;
  adds: string;
  modelUse: string;
}

const PROFILES: readonly ProfilePresentation[] = [
  { id: "minimal-clean", label: "Simple Roleplay", bestFor: "A short or casual chat where the main model handles the story.", adds: "Standard Roleplay prompting and memory recall without automatic helpers.", modelUse: "No background helper calls." },
  { id: "longform-continuity", label: "Long-Running Story", bestFor: "A campaign or story spanning many scenes or sessions.", adds: "Continuity checks, world state, summaries, and reviewable future story beats.", modelUse: "Occasional background calls, including Director planning every 10 assistant replies." },
  { id: "cinematic", label: "Cinematic Roleplay", bestFor: "Roleplay where expressions, backgrounds, artwork, or music matter most.", adds: "Visual presentation helpers; artwork and music remain optional.", modelUse: "Varies by selection; image or music features may use external services." },
  { id: "local-assist", label: "Local Helpers", bestFor: "A setup with the local sidecar configured for supported background work.", adds: "Local tracking and expression helpers without changing the writer connection.", modelUse: "Uses local helper calls and requires a ready sidecar." },
] as const;
```

Render `Best for`, `Adds`, and `Model use` as visible labels inside each radio card. Add the chooser heading and change the drawer subtitle to `Choose the setup that fits this story`.

```tsx
<h3 className="text-sm font-semibold text-[var(--foreground)]">
  What kind of roleplay are you setting up?
</h3>
<dl className="mt-1.5 grid gap-1 text-[0.625rem] leading-relaxed">
  <div><dt className="inline font-semibold">Best for: </dt><dd className="inline">{profile.bestFor}</dd></div>
  <div><dt className="inline font-semibold">Adds: </dt><dd className="inline">{profile.adds}</dd></div>
  <div><dt className="inline font-semibold">Model use: </dt><dd className="inline">{profile.modelUse}</dd></div>
</dl>
```

- [ ] **Step 4: Replace the misleading aggregate count**

Add a pure local helper:

```ts
function modelActivitySummary(rows: readonly RoleplayWorkflowChangeRow[]): string {
  if (!rows.some((row) => row.expectedExtraCalls > 0)) return "Background model activity: none";
  return "Background model activity: occasional";
}
```

Render each row's exact `modelUse`; show `No added writer latency` when `addsWriterLatency` is false. Remove wording that implies all selected calls happen on every writer response.

- [ ] **Step 5: Add the version-1 Longform update affordance**

Initialize the selected profile from a recognized receipt:

```ts
function appliedProfileId(chat: Chat): RoleplayWorkflowProfileId {
  const id = chat.metadata?.roleplayWorkflowApplication?.profileId;
  return PROFILES.some((profile) => profile.id === id) ? (id as RoleplayWorkflowProfileId) : "minimal-clean";
}
```

Initialize with `useState(() => appliedProfileId(chat))`. In the existing live-chat synchronization effect, call `setProfileId(appliedProfileId(chat))` before resolving the replacement preview so switching chats cannot leave the previous chat's profile selected.

When the receipt is `longform-continuity` version 1 and the current preview is version 2, render:

```tsx
<p role="status">Update available: add automatic story planning</p>
```

The update uses the normal Review and apply confirmation path. It must not write on mount or select Director rows when Director metadata already exists.

- [ ] **Step 6: Run chooser and entry-point suites**

Run:

```bash
pnpm vitest run src/features/catalog/chat-presets/components/RoleplayWorkflowProfileChooser.spec.tsx src/features/catalog/chat-presets/components/RoleplayWorkflowProfileDrawerControl.spec.tsx src/features/catalog/chat-presets/workflow-profile-entrypoints.spec.ts
```

Expected: PASS for both wizard/drawer guidance, update visibility, accessibility, and mobile profiles-first ordering.

- [ ] **Step 7: Commit the workflow guidance UI**

```bash
git add src/features/catalog/chat-presets/components/RoleplayWorkflowProfileChooser.tsx src/features/catalog/chat-presets/components/RoleplayWorkflowProfileChooser.spec.tsx src/features/catalog/chat-presets/components/RoleplayWorkflowProfileDrawerControl.tsx
git commit -m "feat: explain roleplay workflow choices"
```

---

### Task 4: Start the first plan after workflow persistence

**Files:**
- Modify: `src/features/catalog/chat-presets/hooks/use-chat-presets.ts:452-475`
- Create: `src/features/catalog/chat-presets/hooks/use-chat-presets.continuity-director.spec.tsx`
- Modify: `src/features/catalog/chat-presets/components/RoleplayWorkflowProfileChooser.tsx:300-390`
- Modify: `src/features/catalog/chat-presets/components/RoleplayWorkflowProfileChooser.spec.tsx:1-30,280-560`

**Interfaces:**
- Consumes: Task 2 `shouldCreateContinuityPlan` and `roleplayContinuityDirectorApi.refresh(chatId)`.
- Produces: `useCreateInitialContinuityPlan`; detached first-plan status flow; chat query invalidation after planner settlement.

- [ ] **Step 1: Write failing hook tests for success and failure isolation**

Create the new spec with a React Query probe matching the repository's existing hook-test pattern:

```ts
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

import { createDefaultContinuityDirectorState } from "../../../../engine/modes/roleplay/continuity-director/continuity-director-state";
import type { RoleplayContinuityDirectorApi } from "../../../../shared/api/roleplay-continuity-director-api";
import { chatKeys } from "../../chats/query-keys";
import { useCreateInitialContinuityPlan } from "./use-chat-presets";

async function setup(api: Pick<RoleplayContinuityDirectorApi, "refresh">) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  let current!: ReturnType<typeof useCreateInitialContinuityPlan>;
  const container = document.createElement("div");
  const root = createRoot(container);
  function Probe() {
    current = useCreateInitialContinuityPlan(api);
    return null;
  }
  await act(async () => {
    root.render(<QueryClientProvider client={client}><Probe /></QueryClientProvider>);
  });
  return {
    client,
    current: () => current,
    cleanup: async () => act(async () => root.unmount()),
  };
}

it("refreshes a newly enabled Director and invalidates chat state", async () => {
  const refresh = vi.fn().mockResolvedValue({
    state: { ...createDefaultContinuityDirectorState(), enabled: true },
    isStale: false,
    sourceUnavailable: false,
    rejectedUnsafeBeats: 0,
  });
  const hook = await setup({ refresh } as Pick<RoleplayContinuityDirectorApi, "refresh">);
  const invalidate = vi.spyOn(hook.client, "invalidateQueries");
  await act(async () => hook.current().mutateAsync("chat-1"));
  expect(refresh).toHaveBeenCalledWith("chat-1");
  expect(invalidate).toHaveBeenCalledWith({ queryKey: chatKeys.detail("chat-1") });
  expect(invalidate).toHaveBeenCalledWith({ queryKey: chatKeys.list() });
  await hook.cleanup();
});

it("surfaces planner failure to the caller", async () => {
  const refresh = vi.fn().mockRejectedValue(new Error("planning connection unavailable"));
  const hook = await setup({ refresh } as Pick<RoleplayContinuityDirectorApi, "refresh">);
  await act(async () => {
    await expect(hook.current().mutateAsync("chat-1")).rejects.toThrow("planning connection unavailable");
  });
  await hook.cleanup();
});
```

- [ ] **Step 2: Run the hook suite and verify the new hook is missing**

Run:

```bash
pnpm vitest run src/features/catalog/chat-presets/hooks/use-chat-presets.continuity-director.spec.tsx
```

Expected: FAIL because `useCreateInitialContinuityPlan` is not exported.

- [ ] **Step 3: Implement the focused mutation hook**

```ts
export function useCreateInitialContinuityPlan(
  api: Pick<RoleplayContinuityDirectorApi, "refresh"> = roleplayContinuityDirectorApi,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (chatId: string) => api.refresh(chatId),
    onSettled: (_data, _error, chatId) => {
      qc.invalidateQueries({ queryKey: chatKeys.detail(chatId) });
      qc.invalidateQueries({ queryKey: chatKeys.list() });
    },
  });
}
```

Do not call this hook from the engine apply function.

- [ ] **Step 4: Write failing chooser tests for detached status behavior**

Mock `useCreateInitialContinuityPlan`. Add three cases:

```ts
expect(container.textContent).toContain("Workflow applied. Creating the first story plan in the background.");
expect(mocks.createInitialPlan).toHaveBeenCalledWith("roleplay-chat", expect.any(Object));

mocks.createInitialPlan.mockImplementation((_id, options) => options.onSuccess());
expect(container.textContent).toContain("Story plan ready for review.");

mocks.createInitialPlan.mockImplementation((_id, options) => options.onError(new Error("provider offline")));
expect(container.textContent).toContain(
  "Workflow applied, but the first story plan could not be created. Open Continuity Director to retry.",
);
```

In every case, assert the workflow result remains `outcome: "applied"`. Add a negative case for `shouldCreateContinuityPlan: false`.

- [ ] **Step 5: Trigger the planner only from the applied result**

After storing `result.chat`, branch on the signal without awaiting it:

```ts
if (result.shouldCreateContinuityPlan) {
  setStatus({ tone: "info", message: "Workflow applied. Creating the first story plan in the background." });
  initialPlan.mutate(displayedChat.id, {
    onSuccess: () => setStatus({ tone: "success", message: "Story plan ready for review." }),
    onError: () => setStatus({
      tone: "info",
      message: "Workflow applied, but the first story plan could not be created. Open Continuity Director to retry.",
    }),
  });
  return;
}
```

Include `initialPlan.isPending` in UI pending state only to prevent a duplicate profile application; do not block closing the wizard or normal chat generation.

- [ ] **Step 6: Run the hook and chooser suites**

Run:

```bash
pnpm vitest run src/features/catalog/chat-presets/hooks/use-chat-presets.spec.ts src/features/catalog/chat-presets/hooks/use-chat-presets.continuity-director.spec.tsx src/features/catalog/chat-presets/components/RoleplayWorkflowProfileChooser.spec.tsx src/shared/api/roleplay-continuity-director-api.spec.ts
```

Expected: PASS with one post-persistence refresh, truthful statuses, and isolated failure.

- [ ] **Step 7: Commit the detached first-plan flow**

```bash
git add src/features/catalog/chat-presets/hooks/use-chat-presets.ts src/features/catalog/chat-presets/hooks/use-chat-presets.continuity-director.spec.tsx src/features/catalog/chat-presets/components/RoleplayWorkflowProfileChooser.tsx src/features/catalog/chat-presets/components/RoleplayWorkflowProfileChooser.spec.tsx
git commit -m "feat: create longform story plan after setup"
```

---

### Task 5: Keep proposed beats visibly reviewable

**Files:**
- Create: `src/features/modes/roleplay/components/ContinuityDirectorReviewBadge.tsx`
- Create: `src/features/modes/roleplay/components/ContinuityDirectorReviewBadge.spec.tsx`
- Modify: `src/features/modes/roleplay/components/ChatRoleplaySurface.tsx:316-345,820-840,1145-1160,1568-1590`

**Interfaces:**
- Consumes: Task 1 `countProposedContinuityDirectorBeats(chatMeta.roleplayContinuityDirector)`.
- Produces: `ContinuityDirectorReviewBadge({ count, compact })`, desktop icon count, and mobile `N to review` label.

- [ ] **Step 1: Write the failing badge component tests**

```tsx
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";

import { ContinuityDirectorReviewBadge } from "./ContinuityDirectorReviewBadge";

it("renders nothing for an empty review queue", () => {
  const container = document.createElement("div");
  const root = createRoot(container);
  act(() => root.render(<ContinuityDirectorReviewBadge count={0} compact />));
  expect(container.textContent).toBe("");
  act(() => root.unmount());
});

it("renders accessible compact and full review counts", () => {
  const container = document.createElement("div");
  const root = createRoot(container);
  act(() => root.render(<ContinuityDirectorReviewBadge count={3} compact />));
  expect(container.querySelector('[aria-label="3 story beats to review"]')?.textContent).toBe("3");
  act(() => root.render(<ContinuityDirectorReviewBadge count={3} />));
  expect(container.textContent).toContain("3 to review");
  act(() => root.unmount());
});
```

- [ ] **Step 2: Run the badge test and verify it fails**

Run:

```bash
pnpm vitest run src/features/modes/roleplay/components/ContinuityDirectorReviewBadge.spec.tsx
```

Expected: FAIL because the component does not exist.

- [ ] **Step 3: Implement the focused badge component**

```tsx
export function ContinuityDirectorReviewBadge({ count, compact = false }: { count: number; compact?: boolean }) {
  if (count <= 0) return null;
  return (
    <span
      aria-label={`${count} story ${count === 1 ? "beat" : "beats"} to review`}
      className={compact
        ? "absolute -right-1 -top-1 min-w-4 rounded-full bg-[var(--primary)] px-1 text-center text-[0.5625rem] font-bold text-[var(--primary-foreground)]"
        : "ml-auto rounded-full bg-[var(--primary)]/15 px-2 py-0.5 text-[0.625rem] font-semibold text-[var(--primary)]"}
    >
      {compact ? count : `${count} to review`}
    </span>
  );
}
```

- [ ] **Step 4: Wire the persisted count into both existing entry points**

In `ChatRoleplaySurface`, derive once:

```ts
const continuityReviewCount = countProposedContinuityDirectorBeats(chatMeta.roleplayContinuityDirector);
```

Add `badge?: ReactNode` to `RpToolbarButton`, make its button `relative`, and render the compact badge inside the existing Continuity Director toolbar button. Render the full badge beside the mobile Continuity Director label. Do not add another query or duplicate metadata state.

```tsx
function RpToolbarButton({ icon, title, onClick, size, badge }: {
  icon: ReactNode;
  title: string;
  onClick: () => void;
  size?: "sm";
  badge?: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "relative flex items-center justify-center rounded-full border bg-foreground/5 text-foreground/60 backdrop-blur-md transition-all hover:bg-foreground/10 hover:text-foreground",
        size === "sm" ? "p-1" : "p-1.5",
        "border-foreground/10",
      )}
      title={title}
      aria-label={title}
    >
      {icon}
      {badge}
    </button>
  );
}

<RpToolbarButton
  icon={<Sparkles size="0.875rem" />}
  title="Continuity Director"
  onClick={() => setContinuityDirectorOpen(true)}
  badge={<ContinuityDirectorReviewBadge count={continuityReviewCount} compact />}
/>

<span className="text-sm font-medium text-[var(--foreground)]">Continuity Director</span>
<ContinuityDirectorReviewBadge count={continuityReviewCount} />
```

- [ ] **Step 5: Run badge, state, and Roleplay surface tests**

Run:

```bash
pnpm vitest run src/features/modes/roleplay/components/ContinuityDirectorReviewBadge.spec.tsx src/features/modes/roleplay/components/ChatRoleplaySurface.spec.tsx src/engine/modes/roleplay/continuity-director/continuity-director-state.spec.ts
```

Expected: PASS; zero proposed beats render no badge and proposed counts are accessible on both entry-point variants.

- [ ] **Step 6: Commit review discoverability**

```bash
git add src/features/modes/roleplay/components/ContinuityDirectorReviewBadge.tsx src/features/modes/roleplay/components/ContinuityDirectorReviewBadge.spec.tsx src/features/modes/roleplay/components/ChatRoleplaySurface.tsx
git commit -m "feat: show continuity beats awaiting review"
```

---

### Task 6: Prove cross-boundary behavior and prepare the shipping gate

**Files:**
- Test: `src/features/catalog/chat-presets/workflow-profile-entrypoints.spec.ts`
- Track proof in the repository-prescribed ignored `scratch/` ledger; do not add generated proof artifacts to git.

**Interfaces:**
- Consumes: Tasks 1-5 completed behavior.
- Produces: complete regression proof, desktop/mobile browser evidence, and a reviewable shipping diff.

- [ ] **Step 1: Run all focused suites together**

```bash
pnpm vitest run src/engine/modes/roleplay/workflow-profiles.spec.ts src/engine/modes/roleplay/continuity-director/continuity-director-state.spec.ts src/features/catalog/chat-presets/hooks/use-chat-presets.spec.ts src/features/catalog/chat-presets/hooks/use-chat-presets.continuity-director.spec.tsx src/features/catalog/chat-presets/components/RoleplayWorkflowProfileChooser.spec.tsx src/features/catalog/chat-presets/components/RoleplayWorkflowProfileDrawerControl.spec.tsx src/features/catalog/chat-presets/workflow-profile-entrypoints.spec.ts src/features/modes/roleplay/components/ContinuityDirectorReviewBadge.spec.tsx src/features/modes/roleplay/components/ChatRoleplaySurface.spec.tsx src/shared/api/roleplay-continuity-director-api.spec.ts src/engine/generation/prompt-assembly.continuity-director.spec.ts
```

Expected: all listed files pass with no failures.

- [ ] **Step 2: Run repository validation**

```bash
pnpm check
pnpm test
pnpm eslint src/engine/contracts/types/chat.ts src/engine/modes/roleplay/workflow-profiles.ts src/engine/modes/roleplay/continuity-director/continuity-director-state.ts src/features/catalog/chat-presets/hooks/use-chat-presets.ts src/features/catalog/chat-presets/components/RoleplayWorkflowProfileChooser.tsx src/features/catalog/chat-presets/components/RoleplayWorkflowProfileDrawerControl.tsx src/features/modes/roleplay/components/ContinuityDirectorReviewBadge.tsx src/features/modes/roleplay/components/ChatRoleplaySurface.tsx
git diff --check
```

Expected: every command exits 0. Record any repository baseline advisory separately; do not hide failures.

- [ ] **Step 3: Browser-verify the drawer and wizard at desktop and mobile widths**

Use a clean Roleplay chat and verify:

1. The chooser asks what kind of Roleplay is being created.
2. All four cards show Best for, Adds, and Model use without clipping.
3. Long-Running Story previews Director enablement and a non-blocking 10-reply cadence.
4. Applying it persists before the first planning request begins.
5. Success produces proposed beats and a persistent review badge.
6. A deliberately unavailable planning connection leaves the workflow applied and gives the retry message.
7. Version-1 Longform metadata shows an update without writing until confirmation.
8. Proposed beats do not appear in Prompt Inspector; approving one makes exactly that beat appear with `continuity_director` attribution.

Expected: desktop and mobile behavior match the design, normal writer replies never wait for background planning, and no model output approves itself.

- [ ] **Step 4: Review the final diff for scope and content safety**

```bash
git status --short
git diff --stat origin/main...HEAD
git diff origin/main...HEAD -- src/engine/contracts/types/chat.ts src/engine/modes/roleplay/workflow-profiles.ts src/engine/modes/roleplay/continuity-director/continuity-director-state.ts src/features/catalog/chat-presets src/features/modes/roleplay/components/ChatRoleplaySurface.tsx src/features/modes/roleplay/components/ContinuityDirectorReviewBadge.tsx
```

Expected: only the planned workflow, Director configuration, chooser, badge, tests, spec, and plan files changed. Confirm receipts contain no story text and non-Longform profiles do not touch Director metadata.

- [ ] **Step 5: Run the repository's PR proof and Bunny workflow before requesting merge**

Create or refresh the ignored feature ledger using the repository template, run its proof-health command, then follow the De-Koi shipping lane for branch inspection, push to `origin`, PR body validation, Bunny, hosted CI, unresolved-thread handling, and merge authorization. Do not resolve reviewer threads without explicit authorization.
