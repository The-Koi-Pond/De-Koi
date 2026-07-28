# Memory Cleanup Consolidation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make reviewed memory cleanup consolidate any active in-scope memories, regardless of provenance or pinning, while removing single-memory shortening.

**Architecture:** Keep semantic eligibility and proposal rules in the React-free engine, presentation in the memory-maintenance feature, and authoritative apply/undo validation in the existing Rust chat and canonical storage owners. The TypeScript preview and Rust apply boundaries share the same active-scope and proposal-shape contract; existing shared runtime routing remains unchanged.

**Tech Stack:** TypeScript, Vitest, React, Rust, Serde, Tauri storage commands

## Global Constraints

- Cleanup considers status `active` and `pinned`; it excludes deleted, wrong, stale, superseded, and cross-owner rows.
- Origin, `userEdited`, and pinning are metadata, not eligibility exclusions.
- Every actionable proposal involves at least two memories; `shorten` is not a supported proposal.
- Length alone never creates a candidate group.
- A combine replacement is pinned when any source was pinned.
- A keep-one proposal must retain a pinned winner when any referenced source is pinned.
- Repair from chat history keeps its existing narrower preservation rules.
- Preview, atomic apply, stale-state validation, lifecycle history, and undo remain intact.
- No new dependencies, runtime routes, or cross-layer imports.

---

### Task 1: Align the TypeScript contract and candidate engine

**Files:**

- Modify: `src/engine/contracts/types/memory-maintenance.ts`
- Modify: `src/engine/entities/memory-maintenance.ts`
- Test: `src/engine/entities/memory-maintenance.spec.ts`

**Interfaces:**

- Produces: `isMemoryCleanupEligible(source: MemoryCleanupSource): boolean`
- Produces: `PreparedMemoryCleanupCandidates` with `eligible`, `groups`, and `deferredCandidateCount`
- Produces: proposal types `"keep_one" | "combine" | "conflict"`
- Produces: reasons `"Repeated fact" | "Overlapping memories" | "Possible conflict"`
- Produces: previews without `protectedCount` and apply results without `shortened`

- [ ] **Step 1: Write failing candidate and proposal tests**

Replace protection and verbosity expectations with coverage equivalent to:

```ts
it("allows every active provenance and pin variant while excluding inactive rows", () => {
  const prepared = prepareMemoryCleanupCandidates([
    source({ id: "automatic" }),
    source({ id: "pinned", status: "pinned", pinned: true }),
    source({ id: "manual", origin: "manual", userEdited: true }),
    source({ id: "imported", origin: "imported" }),
    source({ id: "correction", origin: "correction" }),
    source({ id: "command", origin: "command" }),
    source({ id: "wrong", status: "wrong" }),
  ]);
  expect(prepared.eligible.map(({ id }) => id)).toEqual([
    "automatic",
    "pinned",
    "manual",
    "imported",
    "correction",
    "command",
  ]);
});

it("does not create a singleton candidate because a memory is long", () => {
  const prepared = prepareMemoryCleanupCandidates([source({ id: "long", content: "x".repeat(601) })]);
  expect(prepared.groups).toEqual([]);
});
```

Add validation cases showing active manual/imported/command sources can be
consumed, inactive sources cannot, combine needs two sources, and a keep-one
proposal involving a pinned source must retain a pinned winner.

- [ ] **Step 2: Run the focused engine test and verify RED**

Run:

```powershell
pnpm test -- src/engine/entities/memory-maintenance.spec.ts
```

Expected: FAIL because protected rows are excluded, long singleton groups are
created, and the old `shorten` contract still exists.

- [ ] **Step 3: Implement the minimal TypeScript contract and engine changes**

Use the active-lifecycle helper:

```ts
export function isMemoryCleanupEligible(source: MemoryCleanupSource): boolean {
  return source.status === "active" || source.status === "pinned";
}
```

Build candidate adjacency only from eligible sources, remove
`MEMORY_CLEANUP_VERBOSE_CHARS`, remove the singleton loop, and count only
individually oversized active sources plus capped multi-record groups as
deferred.

In `validateCleanupProposal`:

```ts
if (proposal.type === "combine" && proposal.sourceIds.length < 2) {
  throw new Error("Combine cleanup requires at least two sources.");
}
if (proposal.type === "keep_one") {
  const winner = proposal.winnerId ? sourcesById.get(proposal.winnerId) : undefined;
  if (!winner) throw new Error("Keep-one proposals require a winner.");
  if (referenced.some((source) => source.pinned) && !winner.pinned) {
    throw new Error("Keep-one cleanup must retain a pinned winner.");
  }
}
```

Reject every referenced inactive source. Remove `shorten`, `Shorter wording`,
`protectedCount`, and `shortened` from the exported contracts.

- [ ] **Step 4: Run the focused engine test and verify GREEN**

Run:

```powershell
pnpm test -- src/engine/entities/memory-maintenance.spec.ts
```

Expected: PASS.

- [ ] **Step 5: Commit the contract slice**

```powershell
git add src/engine/contracts/types/memory-maintenance.ts src/engine/entities/memory-maintenance.ts src/engine/entities/memory-maintenance.spec.ts
git commit -m "Refine memory cleanup eligibility"
```

### Task 2: Make AI analysis consolidation-only

**Files:**

- Modify: `src/engine/generation/memory-cleanup.ts`
- Test: `src/engine/generation/memory-cleanup.spec.ts`

**Interfaces:**

- Consumes: Task 1 proposal types, reasons, eligibility, and validation
- Produces: bounded consolidation prompts with no singleton shortening
- Produces: deterministic exact-duplicate proposals that preserve pinned winners

- [ ] **Step 1: Write failing generation tests**

Add assertions equivalent to:

```ts
expect(systemPrompt).toContain("two or more");
expect(systemPrompt).toContain("Length alone");
expect(userPrompt.allowedTypes).toEqual(["keep_one", "combine", "conflict"]);
expect(userPrompt.sources).toEqual(expect.arrayContaining([expect.objectContaining({ id: "pinned", pinned: true })]));
expect(JSON.stringify(requests)).not.toContain("shorten");
```

Replace the protected-winner test with:

```ts
it("consolidates active edited and imported duplicates and preserves a pinned winner", async () => {
  const preview = await analyzeMemoryCleanup({
    scope: { kind: "character", id: "mira" },
    sources: [
      source({ id: "automatic", confidence: 0.99 }),
      source({ id: "edited", userEdited: true }),
      source({ id: "pinned", status: "pinned", pinned: true, origin: "imported" }),
    ],
    connectionId: "connection-1",
    llm: gateway(vi.fn()),
  });
  expect(preview.proposals[0]).toEqual(
    expect.objectContaining({
      type: "keep_one",
      winnerId: "pinned",
      sourceIds: expect.arrayContaining(["automatic", "edited"]),
    }),
  );
});
```

Add a test proving one long memory produces no LLM request and no proposal.

- [ ] **Step 2: Run the focused generation test and verify RED**

Run:

```powershell
pnpm test -- src/engine/generation/memory-cleanup.spec.ts
```

Expected: FAIL on protected-source behavior, old prompt types/reasons, and
singleton analysis.

- [ ] **Step 3: Implement consolidation-only analysis**

Update the system prompt with:

```ts
"Only propose cleanup when two or more memories can become fewer memories without losing distinct information.",
"Simpler means fewer memory records, not necessarily fewer words.",
"Length alone is never a cleanup reason.",
```

Allow only `keep_one`, `combine`, and `conflict`. Replace `Overlapping detail`
with `Overlapping memories`. Include `pinned` in the structured source payload.

Choose exact duplicate winners by pinned state first, then confidence,
`updatedAt`, and stable ID. Consume every other active duplicate regardless of
origin or edit metadata. Count created replacements from `combine` only and
omit `protectedCount` from the preview.

- [ ] **Step 4: Run focused generation and engine tests**

Run:

```powershell
pnpm test -- src/engine/entities/memory-maintenance.spec.ts src/engine/generation/memory-cleanup.spec.ts
```

Expected: PASS.

- [ ] **Step 5: Commit the analysis slice**

```powershell
git add src/engine/generation/memory-cleanup.ts src/engine/generation/memory-cleanup.spec.ts
git commit -m "Make memory cleanup consolidation-only"
```

### Task 3: Make the review UI describe the real contract

**Files:**

- Modify: `src/features/catalog/memory-maintenance/components/MemoryCleanupReviewModal.tsx`
- Test: `src/features/catalog/memory-maintenance/components/MemoryCleanupReviewModal.spec.tsx`
- Test: `src/features/catalog/memory-maintenance/hooks/use-memory-cleanup.spec.tsx`
- Test: `src/shared/api/memory-maintenance-api.spec.ts`

**Interfaces:**

- Consumes: Task 1 preview and apply-result contracts
- Produces: truthful all-active consolidation helper, empty, and no-op states

- [ ] **Step 1: Write failing UI and fixture changes**

Assert:

```ts
expect(container.textContent).toContain(
  "Find memories that can be combined into fewer, clearer memories without losing details.",
);
expect(container.textContent).not.toContain("protected memories");
expect(container.textContent).not.toContain("overly wordy");
```

For an empty source list, expect:

```ts
"There are no active memories available to analyze yet.";
```

For an empty preview, expect:

```ts
"No consolidation opportunities found. Your memories are already distinct.";
```

Remove `protectedCount` and `shortened` from all test fixtures.

- [ ] **Step 2: Run focused UI, hook, and API tests and verify RED**

Run:

```powershell
pnpm test -- src/features/catalog/memory-maintenance/components/MemoryCleanupReviewModal.spec.tsx src/features/catalog/memory-maintenance/hooks/use-memory-cleanup.spec.tsx src/shared/api/memory-maintenance-api.spec.ts
```

Expected: FAIL on old helper/protected/empty copy and obsolete fixture fields.

- [ ] **Step 3: Implement the UI copy change**

Use:

```tsx
<p>
  Find memories that can be combined into fewer, clearer memories without losing details. You review every change before
  anything is saved.
</p>
```

Delete both protected-memory paragraphs and the protected count rendering.
Change the empty-source and no-op strings to the approved copy. Do not alter
the advanced deterministic repair explanation.

- [ ] **Step 4: Run focused UI, hook, and API tests**

Run:

```powershell
pnpm test -- src/features/catalog/memory-maintenance/components/MemoryCleanupReviewModal.spec.tsx src/features/catalog/memory-maintenance/hooks/use-memory-cleanup.spec.tsx src/shared/api/memory-maintenance-api.spec.ts
```

Expected: PASS.

- [ ] **Step 5: Commit the UI slice**

```powershell
git add src/features/catalog/memory-maintenance/components/MemoryCleanupReviewModal.tsx src/features/catalog/memory-maintenance/components/MemoryCleanupReviewModal.spec.tsx src/features/catalog/memory-maintenance/hooks/use-memory-cleanup.spec.tsx src/shared/api/memory-maintenance-api.spec.ts
git commit -m "Clarify memory consolidation review"
```

### Task 4: Align authoritative Rust apply validation and pin propagation

**Files:**

- Modify: `src-tauri/src/commands/storage/memory_maintenance/contracts.rs`
- Modify: `src-tauri/src/commands/storage/memory_maintenance/chat.rs`
- Modify: `src-tauri/src/commands/storage/memory_maintenance/canonical.rs`

**Interfaces:**

- Consumes: Task 1 apply proposal contract
- Produces: Rust validation accepting every active in-scope source
- Produces: pinned combine replacements and pinned-winner enforcement
- Preserves: atomic apply/undo, index updates, expected-state checks, and repair behavior

- [ ] **Step 1: Write failing Rust contract and storage tests**

Change eligibility tests to assert active imported, edited, manual, correction,
command, and pinned records are eligible while inactive and foreign-scope
records are not.

Extend combine/apply tests so one source is pinned and assert:

```rust
assert_eq!(
    replacement.get("pinned").and_then(Value::as_bool),
    Some(true)
);
```

for chat, and:

```rust
assert_eq!(
    replacement.get("status").and_then(Value::as_str),
    Some("pinned")
);
```

for canonical. Add contract coverage proving `"type": "shorten"` is rejected.
Add keep-one validation proving an unpinned winner cannot consume a pinned
source.

- [ ] **Step 2: Run focused Rust tests and verify RED**

Run:

```powershell
cargo test --manifest-path src-tauri/Cargo.toml memory_maintenance -- --nocapture
```

Expected: FAIL because Rust still protects provenance categories, accepts
`shorten`, and creates unpinned replacements.

- [ ] **Step 3: Implement Rust contract and storage changes**

Remove `ProposalType::Shorten`. Require replacement content only for
`ProposalType::Combine`.

Chat eligibility becomes same-scope plus active lifecycle only:

```rust
fn chat_memory_is_cleanup_eligible(memory: &Value, scope: &CleanupScope) -> bool {
    memory_belongs_to_scope(memory, scope)
        && matches!(memory_status(memory), "active" | "pinned")
}
```

Canonical eligibility follows the same rule. Validate winners with the same
active-scope helper. For keep-one, reject an unpinned winner when any referenced
source is pinned.

For combine replacements, derive:

```rust
let pinned = sources.iter().any(|source| memory_is_pinned(source));
```

Write `"pinned": pinned` for chat replacements and
`"status": if pinned { "pinned" } else { "active" }` for canonical
replacements. In chat supersession metadata, save the actual previous status
rather than hard-coding `"active"` so undo restores pinned lifecycle state.

Remove `shortened` counters and response properties.

- [ ] **Step 4: Run focused Rust tests and verify GREEN**

Run:

```powershell
cargo test --manifest-path src-tauri/Cargo.toml memory_maintenance -- --nocapture
```

Expected: PASS.

- [ ] **Step 5: Commit the storage slice**

```powershell
git add src-tauri/src/commands/storage/memory_maintenance/contracts.rs src-tauri/src/commands/storage/memory_maintenance/chat.rs src-tauri/src/commands/storage/memory_maintenance/canonical.rs
git commit -m "Align storage memory consolidation rules"
```

### Task 5: Cross-boundary verification and documentation

**Files:**

- Add: `docs/superpowers/specs/2026-07-27-memory-cleanup-consolidation-design.md`
- Add: `docs/superpowers/plans/2026-07-27-memory-cleanup-consolidation.md`
- Review: `src/features/catalog/memory-maintenance/adapters.ts`
- Review: `src/shared/api/memory-maintenance-api.ts`
- Review: deterministic repair modules and copy

**Interfaces:**

- Verifies the same contract from adapters through engine, review UI, shared API, and Rust storage

- [ ] **Step 1: Run all focused memory-maintenance tests**

```powershell
pnpm test -- src/engine/entities/memory-maintenance.spec.ts src/engine/generation/memory-cleanup.spec.ts src/features/catalog/memory-maintenance/adapters.spec.ts src/features/catalog/memory-maintenance/components/MemoryCleanupReviewModal.spec.tsx src/features/catalog/memory-maintenance/hooks/use-memory-cleanup.spec.tsx src/shared/api/memory-maintenance-api.spec.ts
cargo test --manifest-path src-tauri/Cargo.toml memory_maintenance -- --nocapture
```

Expected: PASS.

- [ ] **Step 2: Run matching architecture and compile gates**

```powershell
pnpm typecheck
pnpm check:architecture
cargo check --manifest-path src-tauri/Cargo.toml --workspace
pnpm build
pnpm check:docs
```

Expected: PASS.

- [ ] **Step 3: Search for stale product-contract language**

```powershell
rg -n "protectedCount|Shorter wording|overly wordy automatic|protected memories are unchanged|ProposalType::Shorten|type: \"shorten\"|\"shortened\"" src src-tauri/src
```

Expected: no memory-cleanup product or runtime contract hits.

- [ ] **Step 4: Commit the design and plan**

```powershell
git add docs/superpowers/specs/2026-07-27-memory-cleanup-consolidation-design.md docs/superpowers/plans/2026-07-27-memory-cleanup-consolidation.md
git commit -m "Document memory consolidation contract"
```

- [ ] **Step 5: Run shipping review**

Run the Bunny review workflow and the full repository shipping gate, address
actionable findings, then publish the branch to `origin`, open the PR, wait for
required CI and review checks, and merge only after all gates are green.
