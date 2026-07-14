# New Chat Established-Connection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make New chat immediately and safely launch with an existing usable connection while reserving setup for genuinely missing prerequisites and eliminating the hosted same-origin startup gap.

**Architecture:** Keep `createSetupChatLaunchOrchestrator` as the single recovery-safe chat creation owner. Narrow the engine readiness contract to infrastructure readiness (healthy runtime plus usable connection), let the setup journey auto-submit ready intents, and remove connection testing from the blocking checklist. Move same-origin runtime inference into the shared runtime adapter so remote-capable API calls can select the hosted origin before the asynchronous health effect persists it.

**Tech Stack:** TypeScript 5.9, React 19, Zustand, TanStack Query, Vitest/jsdom, Vite, pnpm.

## Global Constraints

- Conversation, roleplay, and game stay separate mode owners; only their shared launch entrypoint changes.
- Chat creation must continue through `createSetupChatLaunchOrchestrator` and preserve recovery, preset, greeting, and single-flight behavior.
- The setup checklist appears only when the server or usable language-model connection is genuinely missing.
- Testing a saved connection remains available in Connections but is not a New chat prerequisite.
- Explicit configured runtime URLs take priority over same-origin inference.
- No storage schema, provider transport, prompt assembly, Rust command, or home “Next steps” changes.

---

### Task 1: Make infrastructure readiness independent of connection-test memory

**Files:**
- Modify: `src/engine/onboarding/setup-journey.ts`
- Modify: `src/engine/onboarding/setup-journey.spec.ts`
- Modify: `src/features/shell/onboarding/lib/setup-readiness.ts`
- Modify: `src/features/shell/onboarding/lib/setup-readiness.spec.ts`

**Interfaces:**
- Consumes: `SetupReadinessFacts` with environment, runtime URL/health, and usable connection count.
- Produces: `isSetupReady(facts): boolean` that is true for a healthy hosted runtime or embedded runtime with at least one usable language-model connection.

- [ ] **Step 1: Write the failing engine readiness test**

Add this case to `setup-journey.spec.ts` before changing production code:

```ts
it("treats a saved usable connection as launch-ready without a session test marker", () => {
  expect(isSetupReady(desktopFacts({ selectedConnectionTest: "required" }))).toBe(true);
  expect(deriveSetupJourneyAction(desktopFacts({ selectedConnectionTest: "required" }), intent("conversation"))).toBe(
    "configure-chat",
  );
});
```

- [ ] **Step 2: Run the engine test and verify RED**

Run: `pnpm exec vitest run src/engine/onboarding/setup-journey.spec.ts`

Expected: FAIL because `isSetupReady` is false and the action is `test-connection`.

- [ ] **Step 3: Remove diagnostic test state from launch readiness**

Update the engine contract so readiness depends only on runtime and connection availability:

```ts
export interface SetupReadinessFacts {
  environment: "embedded" | "web";
  runtimeUrl: string | null;
  runtimeHealth: "not-required" | "unknown" | "healthy" | "error";
  usableConnectionCount: number;
}

export function isSetupReady(facts: SetupReadinessFacts): boolean {
  const runtimeReady =
    facts.environment === "embedded" || (!!facts.runtimeUrl?.trim() && facts.runtimeHealth === "healthy");
  return runtimeReady && facts.usableConnectionCount > 0;
}
```

Remove the `test-connection` branch from `deriveSetupJourneyAction`. Remove `selectedConnectionTest`, `connectionTestCapability`, and `testedConnectionIds` from the setup-readiness fact builder and update its tests to assert only runtime and usable-connection filtering.

- [ ] **Step 4: Run focused readiness tests and verify GREEN**

Run: `pnpm exec vitest run src/engine/onboarding/setup-journey.spec.ts src/features/shell/onboarding/lib/setup-readiness.spec.ts`

Expected: both files PASS with no warnings.

- [ ] **Step 5: Commit the readiness contract**

```bash
git add src/engine/onboarding/setup-journey.ts src/engine/onboarding/setup-journey.spec.ts src/features/shell/onboarding/lib/setup-readiness.ts src/features/shell/onboarding/lib/setup-readiness.spec.ts
git commit -m "Allow established connections to launch chats"
```

### Task 2: Auto-launch ready New chat intents through the recovery-safe orchestrator

**Files:**
- Modify: `src/features/shell/onboarding/components/SetupReadinessJourney.tsx`
- Modify: `src/features/shell/onboarding/components/SetupReadinessJourney.spec.tsx`
- Modify: `src/features/shell/onboarding/components/SetupReadinessChecklist.tsx`
- Modify: `src/features/shell/onboarding/components/SetupReadinessChecklist.spec.tsx`

**Interfaces:**
- Consumes: `isSetupReady(facts)` from Task 1 and the existing `createSetupChatLaunchOrchestrator`.
- Produces: one automatic launch per ready journey; missing prerequisites continue to render `SetupReadinessChecklist`.

- [ ] **Step 1: Write the failing component regression test**

Set `mocks.testedConnectionIds.current = []`, return healthy runtime state, and assert that rendering the journey launches without a second click:

```ts
it("automatically launches a fresh intent with an existing usable connection", async () => {
  mocks.testedConnectionIds.current = [];
  mocks.health.mockResolvedValue({ status: "ok", message: "Ready", health: { ok: true, writable: true } });
  mocks.mutateAsync.mockResolvedValue({ id: "chat-1" });

  await act(async () => {
    root.render(<SetupReadinessJourney />);
    await Promise.resolve();
    await Promise.resolve();
  });

  expect(mocks.mutateAsync).toHaveBeenCalledOnce();
  expect(mocks.mutateAsync).toHaveBeenCalledWith(
    expect.objectContaining({ mode: "conversation", connectionId: "saved" }),
  );
  expect(container.textContent).not.toContain("Finish setting up De-Koi");
});
```

Keep the existing negative runtime-readiness test and add a no-connection case that expects no `mutateAsync` call and visible “Connect a language model” guidance.

- [ ] **Step 2: Run the journey test and verify RED**

Run: `pnpm exec vitest run src/features/shell/onboarding/components/SetupReadinessJourney.spec.tsx`

Expected: FAIL because the component waits for a manual Continue click and test-marker readiness.

- [ ] **Step 3: Auto-submit ready intents and hide the checklist while launching**

Memoize the readiness facts, derive `const setupReady = isSetupReady(facts)`, wrap `launchChat` in `useCallback`, and add:

```ts
useEffect(() => {
  if (!setupReady || !intent) return;
  launchChat();
}, [intent, launchChat, setupReady]);
```

Render the checklist only for missing prerequisites:

```tsx
{!setupReady && (
  <SetupReadinessChecklist
    facts={facts}
    dismissed={intent.dismissed}
    completed={intent.completed}
    onDismiss={() => useSetupJourneyStore.getState().dismiss()}
    onResume={() => useSetupJourneyStore.getState().resume()}
    onConfigureRuntime={openSettings}
    onRepairRuntime={openSettings}
    onCreateConnection={openConnections}
  />
)}
```

Preserve the existing error alert and its Retry / Continue with defaults actions. The orchestrator remains responsible for single-flight protection and recovery.

- [ ] **Step 4: Remove the blocking connection-test row**

Delete `onTestConnection` from `SetupReadinessChecklistProps` and remove this step from the checklist array:

```ts
{
  key: "test-connection",
  label: "Test your language model",
  ready: connectionTestReady,
  action: connectionReady ? onTestConnection : undefined,
  actionLabel: "Test connection",
  icon: Circle,
}
```

Set the experience step readiness to `runtimeReady && connectionReady`. Update the checklist test to assert there is no “Test your language model” row and that “Continue to chat” appears once real prerequisites are ready.

- [ ] **Step 5: Run the onboarding component tests and verify GREEN**

Run: `pnpm exec vitest run src/features/shell/onboarding/components/SetupReadinessJourney.spec.tsx src/features/shell/onboarding/components/SetupReadinessChecklist.spec.tsx`

Expected: both files PASS; ready intent launches once, missing prerequisites do not launch, and the diagnostic test is absent from the blocking checklist.

- [ ] **Step 6: Commit the auto-launch behavior**

```bash
git add src/features/shell/onboarding/components/SetupReadinessJourney.tsx src/features/shell/onboarding/components/SetupReadinessJourney.spec.tsx src/features/shell/onboarding/components/SetupReadinessChecklist.tsx src/features/shell/onboarding/components/SetupReadinessChecklist.spec.tsx
git commit -m "Launch ready chats without setup friction"
```

### Task 3: Select the hosted same-origin runtime synchronously

**Files:**
- Modify: `src/shared/api/remote-runtime.ts`
- Modify: `src/shared/api/remote-runtime.spec.ts`
- Modify: `src/app/startup/remote-runtime-health.ts`

**Interfaces:**
- Produces: `sameOriginRemoteRuntimeUrl(): string` and `remoteRuntimeTarget(): RuntimeTarget | null` with configured URL priority.
- Consumes: `hasEmbeddedTauriRuntime()` and `useUIStore.getState().remoteRuntimeUrl`.

- [ ] **Step 1: Write failing adapter tests**

Export `remoteRuntimeTarget` in the test import and add:

```ts
describe("remoteRuntimeTarget", () => {
  afterEach(() => {
    useUIStore.setState({ remoteRuntimeUrl: "" });
    delete (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  });

  it("uses the hosted page origin before startup health persistence completes", () => {
    useUIStore.setState({ remoteRuntimeUrl: "" });
    expect(remoteRuntimeTarget()).toEqual({ baseUrl: window.location.origin });
  });

  it("prefers an explicitly configured runtime", () => {
    useUIStore.setState({ remoteRuntimeUrl: "https://runtime.example/" });
    expect(remoteRuntimeTarget()).toEqual({ baseUrl: "https://runtime.example" });
  });

  it("does not infer a remote runtime inside Tauri", () => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", { configurable: true, value: {} });
    expect(remoteRuntimeTarget()).toBeNull();
  });
});
```

- [ ] **Step 2: Run the adapter test and verify RED**

Run: `pnpm exec vitest run src/shared/api/remote-runtime.spec.ts`

Expected: the blank hosted-runtime case FAILS with `null`.

- [ ] **Step 3: Implement shared same-origin selection**

Add this shared helper and use it in `remoteRuntimeTarget`:

```ts
export function sameOriginRemoteRuntimeUrl(): string {
  if (typeof window === "undefined" || hasEmbeddedTauriRuntime()) return "";
  if (window.location.protocol !== "http:" && window.location.protocol !== "https:") return "";
  return window.location.origin;
}

export function remoteRuntimeTarget(): RuntimeTarget | null {
  const configured = useUIStore.getState().remoteRuntimeUrl.trim();
  const raw = configured || sameOriginRemoteRuntimeUrl();
  try {
    return normalizeRemoteRuntimeUrl(raw);
  } catch {
    throw new ApiError("Invalid Remote Runtime URL. Check Settings and enter a valid runtime URL.", 400, {
      code: "invalid_remote_runtime_url",
    });
  }
}
```

Delete the duplicate same-origin helper from `src/app/startup/remote-runtime-health.ts` and import `sameOriginRemoteRuntimeUrl` from the shared adapter. Keep the health check responsible for persisting the candidate only after health and writable storage succeed.

- [ ] **Step 4: Run runtime and startup-focused tests and verify GREEN**

Run: `pnpm exec vitest run src/shared/api/remote-runtime.spec.ts src/app/shell/useStartNewChat.spec.tsx`

Expected: both files PASS, explicit runtime priority remains intact, and the New chat hook still closes detail routes.

- [ ] **Step 5: Commit synchronous runtime selection**

```bash
git add src/shared/api/remote-runtime.ts src/shared/api/remote-runtime.spec.ts src/app/startup/remote-runtime-health.ts
git commit -m "Resolve hosted runtime before startup effects"
```

### Task 4: Validate, review, publish, and merge

**Files:**
- Review all files changed since `origin/main`.

**Interfaces:**
- Consumes: completed Tasks 1–3.
- Produces: a merged GitHub PR targeting `main` with no unrelated root-worktree changes.

- [ ] **Step 1: Run formatting and focused regression suites**

Run:

```bash
pnpm exec prettier --check src/engine/onboarding/setup-journey.ts src/engine/onboarding/setup-journey.spec.ts src/features/shell/onboarding/lib/setup-readiness.ts src/features/shell/onboarding/lib/setup-readiness.spec.ts src/features/shell/onboarding/components/SetupReadinessJourney.tsx src/features/shell/onboarding/components/SetupReadinessJourney.spec.tsx src/features/shell/onboarding/components/SetupReadinessChecklist.tsx src/features/shell/onboarding/components/SetupReadinessChecklist.spec.tsx src/shared/api/remote-runtime.ts src/shared/api/remote-runtime.spec.ts src/app/startup/remote-runtime-health.ts
pnpm exec vitest run src/engine/onboarding/setup-journey.spec.ts src/features/shell/onboarding/lib/setup-readiness.spec.ts src/features/shell/onboarding/components/SetupReadinessJourney.spec.tsx src/features/shell/onboarding/components/SetupReadinessChecklist.spec.tsx src/shared/api/remote-runtime.spec.ts src/app/shell/useStartNewChat.spec.tsx
```

Expected: formatting clean and all targeted test files PASS.

- [ ] **Step 2: Run architecture and shipping gates**

Run:

```bash
pnpm typecheck
pnpm check:architecture
pnpm check
```

Expected: all commands exit 0. Record any warning-only unused-code output separately.

- [ ] **Step 3: Inspect branch scope**

Run:

```bash
git status --short
git diff --check origin/main...HEAD
git log --oneline origin/main..HEAD
git diff --stat origin/main...HEAD
```

Expected: only the design, plan, readiness, setup journey/checklist, shared runtime adapter, startup health, and focused tests are present.

- [ ] **Step 4: Run Bunny and independent read-only review**

Review root cause, negative paths, mode separation, same-origin security assumptions, recovery semantics, focused proof, and full gate output. Resolve every Critical or Important finding before publishing.

- [ ] **Step 5: Push only to `origin`, open a draft PR, mark ready, and merge after checks**

Use branch `fix/new-chat-established-connection`, title `Fix established-connection New chat launch`, and a PR body covering root cause, behavior, impact, checks, Bunny, and the live-Pi deployment gap. Push only to `origin`; never force-push. After GitHub checks pass and the PR is mergeable, squash-merge to `main` without touching the dirty root checkout.
