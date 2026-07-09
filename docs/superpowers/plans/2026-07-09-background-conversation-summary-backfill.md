# Background Conversation Summary Backfill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove automatic conversation-summary provider calls from foreground generation while preserving cancelable, single-flight background summary maintenance.

**Architecture:** A conversation-owned background coordinator wraps the existing `backfillConversationSummaries` service and processes at most one missing day after a saved assistant turn. Foreground conversation and dry-run entrypoints cancel same-chat maintenance before provider work, use only persisted summaries, and never await background completion.

**Tech Stack:** TypeScript, async generators, `AbortController`, Vitest, De-Koi engine capability ports, pnpm.

## Global Constraints

- Conversation mode owns summary orchestration; roleplay and game behavior must not change.
- No React, shared API, Rust, storage schema, migration, remote-runtime, or provider-transport changes.
- No new storage entity: persisted missing summary dates remain the durable work record.
- Background work processes at most one missing day per completed conversation turn.
- Foreground generation always preempts same-chat background work.
- Preserve the existing dirty worktree and patch overlapping files narrowly.
- Do not commit unless Celia explicitly authorizes shipping or a commit in the active turn.
- Use `rtk` for shell commands; rerun raw commands only when RTK cannot locate the tool or obscures required output.

---

## File Map

- Create `src/engine/modes/chat/core/summaries/conversation-summary-background.ts`: conversation-owned worker registry, cancellation, single-flight scheduling, and safe failure reporting.
- Create `src/engine/modes/chat/core/summaries/conversation-summary-background.spec.ts`: deterministic unit tests for coalescing, cancellation, bounded work, and safe failures.
- Modify `src/engine/generation/start-generation.ts`: remove synchronous summary preparation, cancel background work at foreground entry, and schedule maintenance after saved conversation assistant turns.
- Modify `src/engine/generation/start-generation.conversation-summaries.test.ts`: replace the same-turn blocking contract with foreground-ordering, preemption, and later-prompt persistence contracts.
- Preserve `src/engine/modes/chat/core/summaries/auto-summary.service.ts`: reuse its timezone bucketing, one-day limit, abort propagation, timeout, chunking, and persistence behavior.

---

### Task 1: Add the cancelable single-flight summary coordinator

**Files:**

- Create: `src/engine/modes/chat/core/summaries/conversation-summary-background.spec.ts`
- Create: `src/engine/modes/chat/core/summaries/conversation-summary-background.ts`
- Reuse: `src/engine/modes/chat/core/summaries/auto-summary.service.ts`

**Interfaces:**

- Consumes: `backfillConversationSummaries({ storage, llm }, { chatId, connectionId, timeZone, maxMissingDays, signal })`.
- Produces: `cancelConversationSummaryBackfill(storage: StorageGateway, chatId: string): void`.
- Produces: `scheduleConversationSummaryBackfill(deps: ConversationSummaryBackgroundDeps, input: ScheduleConversationSummaryBackfillInput): void`.
- Invariant: one active worker per `StorageGateway` and normalized chat ID; different gateways remain isolated.

- [ ] **Step 1: Write the failing coordinator tests**

Create `src/engine/modes/chat/core/summaries/conversation-summary-background.spec.ts` with a mocked backfill boundary so the tests exercise only scheduling semantics:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LlmGateway } from "../../../../capabilities/llm";
import type { StorageGateway } from "../../../../capabilities/storage";
import { backfillConversationSummaries, type ConversationSummaryBackfillResult } from "./auto-summary.service";
import {
  cancelConversationSummaryBackfill,
  scheduleConversationSummaryBackfill,
} from "./conversation-summary-background";

vi.mock("./auto-summary.service", async (importOriginal) => {
  const original = await importOriginal<typeof import("./auto-summary.service")>();
  return { ...original, backfillConversationSummaries: vi.fn() };
});

const EMPTY_RESULT: ConversationSummaryBackfillResult = {
  generatedDays: [],
  consolidatedWeeks: [],
  generatedDaySummaries: {},
  consolidatedWeekSummaries: {},
  failedDays: [],
  failedWeeks: [],
  missingDayCount: 0,
  processedDayCount: 0,
  remainingMissingDayCount: 0,
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function harness() {
  return {
    storage: {} as StorageGateway,
    llm: {} as LlmGateway,
  };
}

const mockedBackfill = vi.mocked(backfillConversationSummaries);

afterEach(() => {
  mockedBackfill.mockReset();
  vi.restoreAllMocks();
});

describe("conversation summary background coordinator", () => {
  it("coalesces same-chat scheduling and limits backfill to one missing day", async () => {
    const deps = harness();
    const pending = deferred<ConversationSummaryBackfillResult>();
    mockedBackfill.mockReturnValue(pending.promise);

    scheduleConversationSummaryBackfill(deps, {
      chatId: " chat-1 ",
      connectionId: "connection-1",
      timeZone: "America/New_York",
    });
    scheduleConversationSummaryBackfill(deps, {
      chatId: "chat-1",
      connectionId: "connection-1",
      timeZone: "America/New_York",
    });

    expect(mockedBackfill).toHaveBeenCalledTimes(1);
    expect(mockedBackfill).toHaveBeenCalledWith(deps, {
      chatId: "chat-1",
      connectionId: "connection-1",
      timeZone: "America/New_York",
      maxMissingDays: 1,
      signal: expect.any(AbortSignal),
    });

    pending.resolve(EMPTY_RESULT);
    await pending.promise;
  });

  it("aborts the active same-chat worker when foreground generation preempts it", async () => {
    const deps = harness();
    let observedSignal: AbortSignal | undefined;
    mockedBackfill.mockImplementation(async (_deps, input) => {
      observedSignal = input.signal;
      await new Promise<void>((_resolve, reject) => {
        input.signal?.addEventListener(
          "abort",
          () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })),
          { once: true },
        );
      });
      return EMPTY_RESULT;
    });

    scheduleConversationSummaryBackfill(deps, { chatId: "chat-1" });
    expect(observedSignal?.aborted).toBe(false);

    cancelConversationSummaryBackfill(deps.storage, "chat-1");

    expect(observedSignal?.aborted).toBe(true);
    await vi.waitFor(() => expect(mockedBackfill).toHaveBeenCalledTimes(1));
  });

  it("reports non-abort failures without rejecting the caller", async () => {
    const deps = harness();
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    mockedBackfill.mockRejectedValue(new Error("provider unavailable"));

    expect(() => scheduleConversationSummaryBackfill(deps, { chatId: "chat-1" })).not.toThrow();

    await vi.waitFor(() =>
      expect(warning).toHaveBeenCalledWith(
        "[generation] conversation summary background backfill failed",
        expect.objectContaining({ chatId: "chat-1", error: "provider unavailable" }),
      ),
    );
  });
});
```

- [ ] **Step 2: Run the coordinator test and confirm the red state**

Run:

```powershell
rtk pnpm vitest run src/engine/modes/chat/core/summaries/conversation-summary-background.spec.ts
```

If RTK reports `program not found`, rerun:

```powershell
pnpm vitest run src/engine/modes/chat/core/summaries/conversation-summary-background.spec.ts
```

Expected: FAIL because `./conversation-summary-background` does not exist.

- [ ] **Step 3: Implement the coordinator**

Create `src/engine/modes/chat/core/summaries/conversation-summary-background.ts`:

```ts
import type { LlmGateway } from "../../../../capabilities/llm";
import type { StorageGateway } from "../../../../capabilities/storage";
import { backfillConversationSummaries } from "./auto-summary.service";

export interface ConversationSummaryBackgroundDeps {
  storage: StorageGateway;
  llm: LlmGateway;
}

export interface ScheduleConversationSummaryBackfillInput {
  chatId: string;
  connectionId?: string | null;
  timeZone?: string | null;
}

interface ActiveConversationSummaryWorker {
  controller: AbortController;
  promise: Promise<void>;
}

const activeWorkers = new WeakMap<StorageGateway, Map<string, ActiveConversationSummaryWorker>>();

function normalizedChatId(chatId: string): string {
  return chatId.trim();
}

function workerMap(storage: StorageGateway): Map<string, ActiveConversationSummaryWorker> {
  let workers = activeWorkers.get(storage);
  if (!workers) {
    workers = new Map();
    activeWorkers.set(storage, workers);
  }
  return workers;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error ?? "Unknown summary backfill error");
}

function abortError(error: unknown): boolean {
  return !!error && typeof error === "object" && "name" in error && (error as { name?: unknown }).name === "AbortError";
}

export function cancelConversationSummaryBackfill(storage: StorageGateway, chatId: string): void {
  const normalized = normalizedChatId(chatId);
  if (!normalized) return;
  activeWorkers.get(storage)?.get(normalized)?.controller.abort();
}

export function scheduleConversationSummaryBackfill(
  deps: ConversationSummaryBackgroundDeps,
  input: ScheduleConversationSummaryBackfillInput,
): void {
  const chatId = normalizedChatId(input.chatId);
  if (!chatId) return;

  const workers = workerMap(deps.storage);
  if (workers.has(chatId)) return;

  const controller = new AbortController();
  const worker = {} as ActiveConversationSummaryWorker;
  worker.controller = controller;
  worker.promise = backfillConversationSummaries(deps, {
    chatId,
    connectionId: input.connectionId,
    timeZone: input.timeZone,
    maxMissingDays: 1,
    signal: controller.signal,
  })
    .catch((error) => {
      if (controller.signal.aborted || abortError(error)) return;
      console.warn("[generation] conversation summary background backfill failed", {
        chatId,
        error: errorMessage(error),
      });
    })
    .finally(() => {
      if (workers.get(chatId) === worker) workers.delete(chatId);
      if (workers.size === 0) activeWorkers.delete(deps.storage);
    });
  workers.set(chatId, worker);
}
```

Do not add a barrel export. `start-generation.ts` should import the concrete owner module directly.

- [ ] **Step 4: Run the coordinator test and confirm the green state**

Run:

```powershell
pnpm vitest run src/engine/modes/chat/core/summaries/conversation-summary-background.spec.ts
```

Expected: PASS, 3 tests.

- [ ] **Step 5: Run the existing summary-service tests**

Run:

```powershell
pnpm vitest run src/engine/modes/chat/core/summaries/auto-summary.service.test.ts src/engine/modes/chat/core/summaries/conversation-summary-background.spec.ts
```

Expected: PASS. This proves timezone bucketing and abort propagation remain intact while the new coordinator owns concurrency.

- [ ] **Step 6: Review the Task 1 diff without committing**

Run:

```powershell
rtk git diff -- src/engine/modes/chat/core/summaries/conversation-summary-background.ts src/engine/modes/chat/core/summaries/conversation-summary-background.spec.ts
```

Expected: only the new coordinator and focused tests. Do not commit without explicit authorization.

---

### Task 2: Remove summary completion from foreground generation

**Files:**

- Modify: `src/engine/generation/start-generation.conversation-summaries.test.ts`
- Modify: `src/engine/generation/start-generation.ts:1-40`
- Modify: `src/engine/generation/start-generation.ts:1442-1496`
- Modify: `src/engine/generation/start-generation.ts:4240-4305`
- Modify: `src/engine/generation/start-generation.ts:4447-4545`
- Modify: `src/engine/generation/start-generation.ts:5066-5088`
- Modify: `src/engine/generation/start-generation.ts:5263-5284`

**Interfaces:**

- Consumes: Task 1's `cancelConversationSummaryBackfill` and `scheduleConversationSummaryBackfill`.
- Produces: foreground conversation and dry-run paths that preempt background summary work before provider use.
- Produces: completed saved assistant turns that schedule one background attempt without awaiting it.
- Removes: `prepareConversationSummariesForGeneration`, `chatWithBackfilledSummaries`, and `mergeSummaryEntries`.

- [ ] **Step 1: Replace the blocking-order test with a failing non-blocking regression**

In `src/engine/generation/start-generation.conversation-summaries.test.ts`, add this helper near `drain`:

```ts
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}
```

Change `depsForConversationSummaryGeneration` to accept an optional summary promise:

```ts
function depsForConversationSummaryGeneration(summaryCompletion?: Promise<string>) {
  // Keep the existing chat, connection, messages, storage, and stream harness.
  const complete = vi.fn<LlmGateway["complete"]>(async () =>
    summaryCompletion
      ? summaryCompletion
      : JSON.stringify({ summary: "SAME_TURN_SUMMARY_AVAILABLE", keyDetails: ["timezone bucket respected"] }),
  );
```

Replace the existing `awaits missing conversation summaries before assembling the prompt` test with:

```ts
it("streams the foreground response before background summary completion resolves", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-06-14T12:00:00.000Z"));
  const summary = deferred<string>();
  const { deps, storage, complete, streamedRequests } = depsForConversationSummaryGeneration(summary.promise);
  const generation = drain(
    startGeneration(deps, {
      chatId: "chat-1",
      userMessage: "hello",
      impersonateBlockAgents: true,
      userTimeZone: "America/New_York",
    }),
  );

  try {
    await vi.waitFor(() => expect(complete).toHaveBeenCalledTimes(1));
    expect(streamedRequests).toHaveLength(1);
    expect(storage.patchChatSummaries).not.toHaveBeenCalled();

    summary.resolve(
      JSON.stringify({ summary: "BACKGROUND_SUMMARY_AVAILABLE", keyDetails: ["timezone bucket respected"] }),
    );
    await generation;
    await vi.waitFor(() =>
      expect(storage.patchChatSummaries).toHaveBeenCalledWith("chat-1", {
        daySummaries: {
          "12.06.2026": {
            summary: "BACKGROUND_SUMMARY_AVAILABLE",
            keyDetails: ["timezone bucket respected"],
          },
        },
        weekSummaries: {},
      }),
    );
  } finally {
    summary.resolve("{}");
    await generation.catch(() => undefined);
    vi.useRealTimers();
  }
});
```

The important red-state assertion is `streamedRequests` length: the old implementation calls `complete` and blocks before the first stream request.

- [ ] **Step 2: Add a later-turn persistence test**

Add a second test using the existing immediate summary completion:

```ts
it("uses a successfully persisted background summary on the next turn", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-06-14T12:00:00.000Z"));
  const { deps, storage, complete, streamedRequests } = depsForConversationSummaryGeneration();

  try {
    await drain(
      startGeneration(deps, {
        chatId: "chat-1",
        userMessage: "first turn",
        impersonateBlockAgents: true,
        userTimeZone: "America/New_York",
      }),
    );
    await vi.waitFor(() => expect(storage.patchChatSummaries).toHaveBeenCalledTimes(1));

    complete.mockClear();
    await drain(
      startGeneration(deps, {
        chatId: "chat-1",
        userMessage: "second turn",
        impersonateBlockAgents: true,
        userTimeZone: "America/New_York",
      }),
    );

    expect(JSON.stringify(streamedRequests[1]?.messages ?? [])).toContain("SAME_TURN_SUMMARY_AVAILABLE");
    expect(complete).not.toHaveBeenCalled();
  } finally {
    vi.useRealTimers();
  }
});
```

- [ ] **Step 3: Run the generation summary test and confirm the red state**

Run:

```powershell
pnpm vitest run src/engine/generation/start-generation.conversation-summaries.test.ts
```

Expected: FAIL because the main stream has not started when the unresolved summary completion is observed. Do not continue if it passes against the old foreground-await implementation; correct the test harness first.

- [ ] **Step 4: Replace synchronous summary imports and helpers**

In `src/engine/generation/start-generation.ts`:

1. Remove `DaySummaryEntry` and `WeekSummaryEntry` from the `../contracts/types/chat` import.
2. Remove the `backfillConversationSummaries` and `ConversationSummaryBackfillResult` import from `auto-summary.service`.
3. Add:

```ts
import {
  cancelConversationSummaryBackfill,
  scheduleConversationSummaryBackfill,
} from "../modes/chat/core/summaries/conversation-summary-background";
```

4. Delete `mergeSummaryEntries`, `chatWithBackfilledSummaries`, and `prepareConversationSummariesForGeneration` in full.
5. Keep `resolveGenerationPromptTimeZone`; the background scheduler uses the same persisted/runtime timezone precedence.

- [ ] **Step 5: Add narrow conversation-mode lifecycle helpers**

Immediately after `resolveGenerationPromptTimeZone`, add:

```ts
function isConversationGenerationChat(chat: JsonRecord): boolean {
  return readString(chat.mode || chat.chatMode, "conversation") === "conversation";
}

function cancelConversationSummaryBackgroundForForeground(storage: StorageGateway, chat: JsonRecord): void {
  if (!isConversationGenerationChat(chat)) return;
  cancelConversationSummaryBackfill(storage, readString(chat.id).trim());
}

function scheduleConversationSummaryBackgroundAfterSavedAssistant(
  deps: GenerationEngineDeps,
  chat: JsonRecord,
  input: StartGenerationInput,
  connection: JsonRecord,
): void {
  if (!isConversationGenerationChat(chat)) return;
  scheduleConversationSummaryBackfill(
    { storage: deps.storage, llm: deps.llm },
    {
      chatId: readString(chat.id).trim() || readString(input.chatId).trim(),
      connectionId: readString(connection.id).trim() || readString(input.connectionId).trim() || null,
      timeZone: resolveGenerationPromptTimeZone(chat, input) ?? null,
    },
  );
}
```

These helpers keep mode checks out of the generic coordinator and ensure roleplay/game cannot schedule or cancel conversation workers.

- [ ] **Step 6: Cancel maintenance at both foreground entrypoints**

In `dryRunGeneration`, immediately after loading `chat` and checking abort:

```ts
const chat = requireRecord(await deps.storage.get("chats", chatId), "Chat");
throwIfAborted(signal);
cancelConversationSummaryBackgroundForForeground(deps.storage, chat);
```

In `startGeneration`, immediately after loading `chat` and checking abort:

```ts
let chat = requireRecord(await deps.storage.get("chats", chatId), "Chat");
throwIfAborted(signal);
cancelConversationSummaryBackgroundForForeground(deps.storage, chat);
scheduleAutomaticMemoryCaptureQueueProcessing(deps.storage);
```

Do not pass the foreground generation signal into background work. The coordinator owns a distinct controller so foreground completion does not abort maintenance; the next foreground request does.

- [ ] **Step 7: Remove foreground summary backfill**

Delete these lines from the context-preparation path:

```ts
chat = await prepareConversationSummariesForGeneration(deps, chat, input, connection, signal);
throwIfAborted(signal);
```

Prompt assembly must receive the already-loaded `chat` record and its persisted summaries without a replacement fallback or synthetic summary.

- [ ] **Step 8: Schedule background work after saved assistant turns**

In the agent-enabled branch, extend the existing `savedAssistantGeneration` block near automatic memory capture:

```ts
if (savedAssistantGeneration) {
  await enqueueAutomaticMemoryCaptureSafely(deps.storage, chat, savedUserMessage, latestSaved);
  scheduleConversationSummaryBackgroundAfterSavedAssistant(deps, chat, input, connection);
}
```

In the direct branch, make the parallel change:

```ts
if (savedAssistantGeneration) {
  await enqueueAutomaticMemoryCaptureSafely(deps.storage, chat, savedUserMessage, saved);
  scheduleConversationSummaryBackgroundAfterSavedAssistant(deps, chat, input, connection);
}
```

Do not schedule from `finally`, abort handling, suppressed-message paths, impersonation, or user-message regeneration. `savedAssistantGeneration` already encodes those exclusions.

- [ ] **Step 9: Add an integration assertion for foreground preemption**

In `start-generation.conversation-summaries.test.ts`, import Task 1's scheduler and cancellation functions. Add a test that starts a background worker with a deferred completion, captures the first completion signal, and then runs foreground generation:

```ts
it("aborts same-chat background summary work when foreground generation starts", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-06-14T12:00:00.000Z"));
  const summary = deferred<string>();
  const { deps, complete } = depsForConversationSummaryGeneration(summary.promise);

  scheduleConversationSummaryBackfill(
    { storage: deps.storage, llm: deps.llm },
    { chatId: "chat-1", connectionId: "connection-1", timeZone: "America/New_York" },
  );
  await vi.waitFor(() => expect(complete).toHaveBeenCalledTimes(1));
  const backgroundSignal = complete.mock.calls[0]?.[1];

  try {
    await drain(
      startGeneration(deps, {
        chatId: "chat-1",
        userMessage: "foreground turn",
        impersonateBlockAgents: true,
        userTimeZone: "America/New_York",
      }),
    );
    expect(backgroundSignal?.aborted).toBe(true);
  } finally {
    cancelConversationSummaryBackfill(deps.storage, "chat-1");
    summary.resolve("{}");
    vi.useRealTimers();
  }
});
```

If the harness's mocked completion promise does not observe abort by itself, that is acceptable: the assertion checks the signal contract, and the coordinator unit test proves abort propagation is handled safely.

- [ ] **Step 10: Run the focused red-green suite**

Run:

```powershell
pnpm vitest run src/engine/modes/chat/core/summaries/auto-summary.service.test.ts src/engine/modes/chat/core/summaries/conversation-summary-background.spec.ts src/engine/generation/start-generation.conversation-summaries.test.ts
```

Expected: PASS. Expected focused count after implementing the snippets: 9 tests total (3 existing service tests, 3 coordinator tests, and 3 generation tests). Use Vitest's reported count as the source of truth if the existing suite changes before execution. There must be zero failures and no unhandled promise rejections.

- [ ] **Step 11: Review the Task 2 diff without committing**

Run:

```powershell
rtk git diff -- src/engine/generation/start-generation.ts src/engine/generation/start-generation.conversation-summaries.test.ts
```

Expected: the synchronous backfill helpers/imports are removed; conversation-only cancel/schedule calls are added; unrelated dirty changes remain untouched. Do not commit without explicit authorization.

---

### Task 3: Verify architecture, sibling modes, and regression scope

**Files:**

- Verify only; no planned source edits.
- Inspect: `src/engine/generation/start-generation.ts`
- Inspect: `src/engine/generation/start-generation.bunny.test.ts`
- Inspect: `src/engine/modes/game/scene/game-scene-analysis.service.spec.ts`
- Inspect: `docs/superpowers/specs/2026-07-09-background-conversation-summary-backfill-design.md`

**Interfaces:**

- Consumes: Tasks 1–2 completed implementation.
- Produces: evidence that TypeScript contracts, import direction, conversation behavior, roleplay generation, and game mode remain valid.

- [ ] **Step 1: Run focused summary and generation verification again**

Run:

```powershell
pnpm vitest run src/engine/modes/chat/core/summaries/auto-summary.service.test.ts src/engine/modes/chat/core/summaries/conversation-summary-background.spec.ts src/engine/generation/start-generation.conversation-summaries.test.ts
```

Expected: PASS with zero unhandled rejections.

- [ ] **Step 2: Run representative sibling-mode tests**

Run:

```powershell
pnpm vitest run src/engine/generation/start-generation.bunny.test.ts src/engine/modes/game/scene/game-scene-analysis.service.spec.ts
```

Expected: PASS. The roleplay dialogue-attribution cases in `start-generation.bunny.test.ts` continue to use the normal generation path, and the game scene service remains unaffected.

- [ ] **Step 3: Run the TypeScript lane check**

Run:

```powershell
pnpm typecheck
```

Expected: exit code 0 and no TypeScript errors.

- [ ] **Step 4: Run the architecture gate**

Run:

```powershell
pnpm check:architecture
```

Expected: exit code 0. Confirm the new coordinator imports only engine capability ports and the lower summary service; no React, shared API, Tauri, feature, roleplay, or game imports appear.

- [ ] **Step 5: Run workflow health because this is nontrivial shared-generation work**

Run:

```powershell
node .agents/automation/scripts/workflow-health.mjs
```

Expected: clean result or an explicitly documented pre-existing worktree warning. Do not repair unrelated dirty-tree findings.

- [ ] **Step 6: Inspect the final scoped diff and debug cleanup**

Run:

```powershell
rtk git diff --check
rtk git diff -- src/engine/modes/chat/core/summaries/conversation-summary-background.ts src/engine/modes/chat/core/summaries/conversation-summary-background.spec.ts src/engine/generation/start-generation.ts src/engine/generation/start-generation.conversation-summaries.test.ts
rg -n "DEBUG-|prepareConversationSummariesForGeneration|chatWithBackfilledSummaries|mergeSummaryEntries" src/engine/generation/start-generation.ts src/engine/modes/chat/core/summaries
```

Expected:

- `git diff --check` reports no new whitespace errors in the scoped implementation.
- No temporary `DEBUG-` instrumentation remains.
- The three removed synchronous summary helpers have no references.
- The only planned files are the two coordinator files and the two generation files.

- [ ] **Step 7: Prepare the implementation receipt without committing**

Use this exact report shape:

```text
Behavior changed: Conversation responses no longer await historical summary LLM calls; one missing day is scheduled in a cancelable background worker after a saved assistant turn.
Primary files: conversation-summary-background.ts/.test.ts; start-generation.ts; start-generation.conversation-summaries.test.ts.
Owner fixed: Conversation summary orchestration in the TypeScript engine.
Affected callers reviewed: Standard conversation generation, direct-message generation branch, agent-enabled branch, dry run, roleplay generation, game scene analysis.
Mode impact: Conversation only; roleplay and game unchanged.
Shared layer impact: Shared generation lifecycle receives guarded conversation callbacks; no shared API or Rust changes.
Rust/TS boundary impact: None.
Verification: List exact passing commands and test counts.
Feedback loop rerun: Main stream begins while summary completion is unresolved.
Debug cleanup: No temporary instrumentation remains.
Not touched: UI, storage schema, provider transport, remote runtime, unrelated dirty files.
Remaining risk: Background summaries may lag; providers that ignore abort may briefly overlap foreground work; summary compaction exposes only the configured raw tail until persistence.
Vault: No vault capture.
```

Do not commit, push, open a PR, run Bunny, or start CI unless Celia explicitly requests shipping.

---

## Plan Self-Review Checklist

- Spec coverage: Tasks 1–3 cover single-flight scheduling, foreground preemption, one-day bounds, persistence visibility, failures, mode isolation, and architecture checks.
- Type consistency: coordinator signatures match every generation and test call site in this plan.
- Scope: no UI, Rust, shared API, storage entity, migration, or prompt-policy work is included.
- Test discipline: Task 1 and Task 2 establish failing contracts before implementation; Task 3 reruns focused and sibling-mode evidence.
- Repository policy: all commit steps are replaced with review checkpoints because shipping was not authorized.
