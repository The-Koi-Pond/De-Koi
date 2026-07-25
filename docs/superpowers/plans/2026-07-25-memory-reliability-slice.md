# Memory Reliability Slice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep canonical memories recallable, make capture retries self-draining, and show truthful capture lifecycle state.

**Architecture:** The Rust canonical-memory command owns atomic record/index consistency. The React-free generation engine owns durable retry scheduling and sanitized lifecycle events. Shared chat UI renders those persisted states, while AppShell refreshes the affected message query.

**Tech Stack:** Rust, serde_json, De-Koi file storage transactions, TypeScript, React, TanStack Query, Vitest.

## Global Constraints

- Preserve embedded Tauri and hostable `/api/invoke` parity by changing the shared Rust command owner rather than adding a new command.
- Never persist raw provider or storage errors into message `extra`.
- Do not add queue retention cleanup, cross-window claims, scene-scope repair, or index performance changes.
- Keep Memory Recall's master-switch behavior unchanged.

---

### Task 1: Atomic canonical record and lexical-index consistency

**Files:**
- Modify: `src-tauri/src/commands/storage/canonical_memory.rs`
- Modify: `src/engine/generation/canonical-memory-context.ts`
- Test: `src-tauri/src/commands/storage/canonical_memory.rs`
- Test: `src/engine/generation/canonical-memory-context.spec.ts`

**Interfaces:**
- Consumes: `FileStorage::update_collections_atomically`, `CanonicalMemoryRecord`, `StorageGateway.queryMemoryIndexBatch`, and `StorageGateway.queryMemoriesBatch`.
- Produces: canonical create/update commands whose active/pinned record and lexical row commit together; recall candidates that union indexed and durable canonical rows by ID.

- [ ] **Step 1: Write the Rust failing regression**

Create two active memories, verify both are indexed, update one memory's content, then assert the index query returns both memories and the edited content.

- [ ] **Step 2: Run the Rust regression and verify RED**

Run: `cargo test --manifest-path src-tauri/Cargo.toml canonical_memory::tests::updating_one_memory_keeps_both_memories_indexed --lib`

Expected: FAIL because `update_memory` deletes the edited row without rebuilding it.

- [ ] **Step 3: Implement atomic canonical/index writes**

Add pure lexical-row construction and active/pinned-index eligibility helpers. Use `update_collections_atomically(vec![MEMORY_COLLECTION, INDEX_COLLECTION], ...)` for create and index-affecting update, replacing the canonical row and its lexical projection in one transaction.

- [ ] **Step 4: Run the Rust regression and canonical suite**

Run: `cargo test --manifest-path src-tauri/Cargo.toml canonical_memory::tests --lib`

Expected: all canonical-memory tests pass.

- [ ] **Step 5: Write the TypeScript failing legacy-index regression**

Provide one indexed memory and two durable fallback memories, then assert `buildCanonicalMemoryContext` can include the unindexed relevant memory without duplicating the indexed row.

- [ ] **Step 6: Run the TypeScript regression and verify RED**

Run: `pnpm exec vitest run src/engine/generation/canonical-memory-context.spec.ts`

Expected: FAIL because any non-empty index result currently suppresses the canonical query.

- [ ] **Step 7: Merge indexed and canonical candidates**

Always query the durable canonical scopes when available, append only IDs absent from index results, preserve scope ordering, and label appended rows with lexical provenance.

- [ ] **Step 8: Run the TypeScript canonical-context suite**

Run: `pnpm exec vitest run src/engine/generation/canonical-memory-context.spec.ts`

Expected: all canonical-context tests pass.

### Task 2: Self-draining capture scheduling

**Files:**
- Modify: `src/engine/generation/automatic-memory-capture-queue.ts`
- Test: `src/engine/generation/automatic-memory-capture-queue.spec.ts`

**Interfaces:**
- Consumes: durable `memory-capture-jobs`, `nextAttemptAt`, foreground-generation leases, and the existing queue processor.
- Produces: one timer per `StorageGateway` that wakes the earliest future retry or immediately drains remaining due work.

- [ ] **Step 1: Write the retry-wakeup regression**

Use fake timers to schedule a job whose first refresh fails, advance to just before `nextAttemptAt`, assert it remains retryable, then advance one millisecond and assert it completes without another enqueue or generation.

- [ ] **Step 2: Run the scheduler regression and verify RED**

Run: `pnpm exec vitest run src/engine/generation/automatic-memory-capture-queue.spec.ts`

Expected: FAIL because production scheduling installs no retry timer.

- [ ] **Step 3: Implement earliest-wake scheduling**

Track one timeout per storage gateway, clear stale timeouts on new schedule requests, and inspect durable jobs after each worker pass to choose immediate drain, earliest retry delay, or no timer.

- [ ] **Step 4: Run the scheduler regression and verify GREEN**

Run: `pnpm exec vitest run src/engine/generation/automatic-memory-capture-queue.spec.ts`

Expected: retry-wakeup regression passes.

- [ ] **Step 5: Write and pass the bounded-batch drain regression**

Seed eleven due jobs, start the production scheduler once, run pending timers, and assert all eleven complete although each processor pass remains capped at ten.

### Task 3: Persist and display safe capture lifecycle state

**Files:**
- Modify: `src/engine/contracts/types/chat.ts`
- Modify: `src/engine/generation/automatic-memory-capture-queue.ts`
- Modify: `src/features/modes/shared/chat-ui/components/MessageMemoryIndicators.tsx`
- Modify: `src/app/shell/AppShell.tsx`
- Test: `src/engine/generation/automatic-memory-capture-queue.spec.ts`
- Test: `src/features/modes/shared/chat-ui/components/MessageMemoryIndicators.spec.tsx`

**Interfaces:**
- Consumes: assistant message ID, job attempts, next retry timestamp, and `chatKeys.messages(chatId)`.
- Produces: persisted `MessageMemoryCaptureExtra` lifecycle states and lifecycle events containing chat/message IDs but no raw errors.

- [ ] **Step 1: Write queue lifecycle regressions**

Assert the first transient failure patches `status: "retryable"` with `attempts` and `nextAttemptAt`, and the final failure patches `status: "failed"` with `failureCategory: "capture_unavailable"` and no `lastError`.

- [ ] **Step 2: Run queue tests and verify RED**

Run: `pnpm exec vitest run src/engine/generation/automatic-memory-capture-queue.spec.ts`

Expected: FAIL because failure states currently remain only on job records.

- [ ] **Step 3: Implement lifecycle persistence and events**

Broaden `MessageMemoryCaptureExtra`, patch processing/retryable/failed/completed states, publish a safe lifecycle event after each successful patch, and subscribe in AppShell to invalidate `chatKeys.messages(chatId)`.

- [ ] **Step 4: Write UI regressions**

Render retryable and failed lifecycle records. Assert the chips say `memory retrying` and `memory unavailable`, and the popover never includes a supplied raw provider error.

- [ ] **Step 5: Run UI tests and verify RED**

Run: `pnpm exec vitest run src/features/modes/shared/chat-ui/components/MessageMemoryIndicators.spec.tsx`

Expected: FAIL because non-completed lifecycle states currently render nothing.

- [ ] **Step 6: Implement safe UI copy**

Render non-completed assistant states with concise safe explanations, preserving existing completed/remembered/recalled behavior.

- [ ] **Step 7: Run focused queue and UI suites**

Run: `pnpm exec vitest run src/engine/generation/automatic-memory-capture-queue.spec.ts src/engine/generation/canonical-memory-context.spec.ts src/features/modes/shared/chat-ui/components/MessageMemoryIndicators.spec.tsx`

Expected: all focused tests pass.

### Task 4: Cross-lane validation and shipping

**Files:**
- Review all files changed by Tasks 1-3.

**Interfaces:**
- Consumes: De-Koi repository verification and Bunny review workflows.
- Produces: a focused PR targeting `The-Koi-Pond/De-Koi:main`.

- [ ] **Step 1: Run matching lane checks**

Run:

```text
pnpm typecheck
pnpm check:architecture
cargo check --manifest-path src-tauri/Cargo.toml
pnpm check
```

Expected: every command exits zero.

- [ ] **Step 2: Run diff safety checks**

Run:

```text
git diff --check origin/main...
git diff --stat origin/main...
git status --short
```

Expected: only approved slice files appear and no whitespace errors exist.

- [ ] **Step 3: Run Bunny review**

Review the root cause, risk matrix, diff, test evidence, hostable parity, and user-facing safe-copy boundary. Fix blocking findings and repeat validation.

- [ ] **Step 4: Commit, push, open PR, and merge after required checks**

Use an authorship-neutral branch/title, push only to `origin`, open the PR against `main`, wait for required CI and review gates, and merge without force-pushing.
