# Bounded Memory Cleanup Analysis Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep low-value memory review exhaustive while bounding consolidation work and showing deterministic analysis progress.

**Architecture:** The React-free engine owns group packing, consolidation budgets, deferred counts, and progress events. The existing feature hook translates progress events into transient state for the existing modal; no runtime, provider, storage, or Rust contracts change.

**Tech Stack:** TypeScript, React 19, Vitest, Testing Library

## Global Constraints

- Review every eligible memory for low value.
- Pack at most 32 records and 12,000 content characters into one value-review group.
- Analyze at most 12 model-assisted consolidation groups per run.
- Keep provider calls sequential and cancellable.
- Do not change proposal, selection, apply, storage, or undo semantics.

---

### Task 1: Bound deterministic cleanup preparation

**Files:**
- Modify: `src/engine/entities/memory-maintenance.ts`
- Test: `src/engine/entities/memory-maintenance.spec.ts`

**Interfaces:**
- Consumes: `MemoryCleanupSource[]`
- Produces: `PreparedMemoryCleanupCandidates` with exhaustive `valueGroups`, at most 12 `groups`, and an accurate `deferredCandidateCount`

- [ ] **Step 1: Write the failing Harlequin-scale regression test**

Add a test that prepares 94 active, short, lexically related memories and asserts:

```ts
expect(prepared.eligible).toHaveLength(94);
expect(prepared.valueGroups).toHaveLength(3);
expect(prepared.valueGroups.flatMap((group) => group.sourceIds)).toHaveLength(94);
expect(prepared.groups).toHaveLength(12);
expect(prepared.deferredCandidateCount).toBeGreaterThan(0);
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```powershell
pnpm vitest run src/engine/entities/memory-maintenance.spec.ts
```

Expected: FAIL because value review currently creates 12 groups, consolidation returns more than 12 groups, and deferred count is zero.

- [ ] **Step 3: Implement the deterministic budgets**

In `memory-maintenance.ts`:

```ts
const MEMORY_CLEANUP_MAX_VALUE_GROUP_RECORDS = 32;
const MEMORY_CLEANUP_MAX_CANDIDATE_GROUPS = 12;
```

Keep the existing 8-record limit for evidence-based candidate construction. Use the 32-record limit only in `buildValueGroups`. Build all candidate groups once, return the first 12, and set `deferredCandidateCount` to the omitted count.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run the same Vitest command. Expected: PASS with all existing deterministic grouping tests unchanged.

- [ ] **Step 5: Commit the bounded engine preparation**

```powershell
git add src/engine/entities/memory-maintenance.ts src/engine/entities/memory-maintenance.spec.ts
git commit -m "fix: bound memory cleanup analysis groups"
```

### Task 2: Expose and render real progress

**Files:**
- Modify: `src/engine/generation/memory-cleanup.ts`
- Modify: `src/engine/generation/memory-cleanup.spec.ts`
- Modify: `src/features/catalog/memory-maintenance/hooks/use-memory-cleanup.ts`
- Modify: `src/features/catalog/memory-maintenance/hooks/use-memory-cleanup.spec.tsx`
- Modify: `src/features/catalog/memory-maintenance/components/MemoryCleanupReviewModal.tsx`
- Modify: `src/features/catalog/memory-maintenance/components/MemoryCleanupReviewModal.spec.tsx`

**Interfaces:**
- Produces: `MemoryCleanupAnalysisProgress { completedGroups: number; totalGroups: number }`
- Extends: `analyzeMemoryCleanup` input with optional `onProgress`
- Exposes: hook field `analysisProgress`

- [ ] **Step 1: Write failing engine progress tests**

Add a focused generation test that supplies multiple value/consolidation groups and records callbacks:

```ts
expect(progress[0]).toEqual({ completedGroups: 0, totalGroups: expectedCalls });
expect(progress.at(-1)).toEqual({
  completedGroups: expectedCalls,
  totalGroups: expectedCalls,
});
expect(progress).toHaveLength(expectedCalls + 1);
```

Also assert the gateway never has more than one request in flight.

- [ ] **Step 2: Run the generation test and verify RED**

```powershell
pnpm vitest run src/engine/generation/memory-cleanup.spec.ts
```

Expected: FAIL because `onProgress` and the progress type do not exist.

- [ ] **Step 3: Implement engine progress**

Precompute the consolidation groups that are not already claimed by deterministic exact duplicates. Emit zero-of-total before the loops and emit one completed event after each successful structured generation. Preserve abort checks before and after each request.

- [ ] **Step 4: Run the generation test and verify GREEN**

Run the same generation suite. Expected: PASS with sequential call ordering preserved.

- [ ] **Step 5: Write failing hook and modal progress tests**

The hook test must assert progress is exposed during analysis and cleared on cancel. The modal test must render:

```text
Analyzing memories… 2 of 15
```

- [ ] **Step 6: Run the feature tests and verify RED**

```powershell
pnpm vitest run src/features/catalog/memory-maintenance/hooks/use-memory-cleanup.spec.tsx src/features/catalog/memory-maintenance/components/MemoryCleanupReviewModal.spec.tsx
```

Expected: FAIL because the hook does not store progress and the modal only renders an indefinite label.

- [ ] **Step 7: Implement hook and modal progress**

Store progress only for the current owner/abort controller, clear it on reset, cancellation, error, and successful preview, and render the completed/total suffix only while analyzing and a total is known.

- [ ] **Step 8: Run the feature tests and verify GREEN**

Run the same feature suites. Expected: PASS with the existing Cancel behavior intact.

- [ ] **Step 9: Commit progress behavior**

```powershell
git add src/engine/generation/memory-cleanup.ts src/engine/generation/memory-cleanup.spec.ts src/features/catalog/memory-maintenance/hooks/use-memory-cleanup.ts src/features/catalog/memory-maintenance/hooks/use-memory-cleanup.spec.tsx src/features/catalog/memory-maintenance/components/MemoryCleanupReviewModal.tsx src/features/catalog/memory-maintenance/components/MemoryCleanupReviewModal.spec.tsx
git commit -m "fix: show bounded memory cleanup progress"
```

### Task 3: Validate and ship the regression fix

**Files:**
- Create: `.github/pr-evidence/bounded-memory-cleanup/proof-ledger.json`

**Interfaces:**
- Consumes: final branch diff and test evidence
- Produces: current-head Bunny pass, healthy PR, merged main revision, and matched Pi deployment

- [ ] **Step 1: Run focused regression proof**

```powershell
pnpm vitest run src/engine/entities/memory-maintenance.spec.ts src/engine/generation/memory-cleanup.spec.ts src/features/catalog/memory-maintenance/hooks/use-memory-cleanup.spec.tsx src/features/catalog/memory-maintenance/components/MemoryCleanupReviewModal.spec.tsx
```

Expected: all focused files pass and the Harlequin-scale upper bound is 15 calls.

- [ ] **Step 2: Run matching architecture and type gates**

```powershell
pnpm typecheck
pnpm check:architecture
git diff --check origin/main...HEAD
```

Expected: all commands exit zero.

- [ ] **Step 3: Run the full shipping baseline**

```powershell
pnpm check
```

Expected: exit zero; warning-only unused-code reports remain non-blocking.

- [ ] **Step 4: Run Bunny on the final local head**

Review the issue match, call budget, exhaustive junk coverage, cancellation, progress state, diff boundary, and proof. Any blocking finding must be fixed and reverified.

- [ ] **Step 5: Create and commit proof metadata**

```powershell
git add .github/pr-evidence/bounded-memory-cleanup/proof-ledger.json
git commit -m "docs: record bounded cleanup proof"
```

- [ ] **Step 6: Push, open the PR, and wait for current-head CI/Bunny**

Push only to `origin`, use the strict PR template, include Feature Discoverability handling, and verify zero unresolved threads with `pr-health.mjs`.

- [ ] **Step 7: Squash-merge and deploy the exact main revision to the Pi**

After all required checks pass, merge from a neutral directory, wait for the matched container batch, then update `/home/chai/de-koi-src` with `scripts/pi-update.sh --trusted-lan`.

- [ ] **Step 8: Prove the Pi deployment**

Require root HTTP 200, writable health, both image labels at the merged revision, running containers, and preserved `/data` and `/root/.codex` mounts.
