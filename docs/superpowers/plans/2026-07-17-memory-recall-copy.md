# Memory Recall Copy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every primary Memory Recall explanation accurately distinguish chat-local transcript recall, character-wide memory, automatic exchange capture, and embedding-based ranking.

**Architecture:** A small React-free copy contract in the shared chat UI library owns the reusable strings and Continuity detail builder. React surfaces consume that contract, while the JSON-backed Discover entry is guarded by its registry test.

**Tech Stack:** TypeScript, React 19, Vitest, JSON discovery registry.

## Global Constraints

- Do not change Memory Recall runtime, storage, persistence, ranking, or capture behavior.
- Keep Chat, Roleplay, and shared UI wording consistent.
- Say that embeddings rank matches; do not imply that embeddings summarize memories.
- Explain that automatic capture saves speaker-labeled exchanges and that eligible character-wide memories can follow a character into other chats.

---

### Task 1: Add the shared copy contract

**Files:**
- Create: `src/features/modes/shared/chat-ui/lib/memory-recall-copy.ts`
- Create: `src/features/modes/shared/chat-ui/lib/memory-recall-copy.spec.ts`

**Interfaces:**
- Consumes: a finite read-behind message count from existing chat metadata.
- Produces: `MEMORY_RECALL_TOGGLE_DESCRIPTION`, `MEMORY_RECALL_SECTION_HELP`, `MEMORY_RECALL_CONSOLE_DESCRIPTION`, and `memoryRecallContinuityDetail(enabled, readBehindMessages)`.

- [x] **Step 1: Write the failing contract test**

Create assertions that the exported descriptions contain `chat-local`, `character-wide`, `speaker-labeled exchanges`, and `rank`, reject the claim that embeddings summarize memory, and produce singular/plural Continuity wording.

- [x] **Step 2: Run the focused test and verify RED**

Run: `pnpm exec vitest run src/features/modes/shared/chat-ui/lib/memory-recall-copy.spec.ts`

Expected: FAIL because `memory-recall-copy.ts` does not exist.

- [x] **Step 3: Implement the minimal copy contract**

Export the three static descriptions and a pure Continuity detail function. The enabled detail must include the configured recent-message exclusion and both memory scopes; the disabled detail must state that neither scope is injected.

- [x] **Step 4: Run the focused test and verify GREEN**

Run: `pnpm exec vitest run src/features/modes/shared/chat-ui/lib/memory-recall-copy.spec.ts`

Expected: PASS.

### Task 2: Apply the contract to user-facing surfaces

**Files:**
- Modify: `src/features/modes/shared/chat-ui/components/ChatSettingsDrawer.tsx`
- Modify: `src/features/modes/shared/chat-ui/components/settings/MemoryRecallMemoriesModal.tsx`
- Modify: `src/features/modes/shared/chat-ui/lib/continuity-overview.ts`
- Modify: `src/features/modes/shared/chat-ui/lib/continuity-overview.spec.ts`
- Modify: `src/features/shell/discovery/discovery-entries.json`
- Modify: `src/features/shell/discovery/discovery-registry.spec.ts`

**Interfaces:**
- Consumes: the Task 1 copy exports.
- Produces: consistent Chat Settings, Continuity, Memory Console, and Discover explanations.

- [x] **Step 1: Write failing surface assertions**

Update the Continuity expectation to require chat-local and character-wide wording. Add a Discover registry assertion requiring chat-local memory, character-wide memory, speaker-labeled exchange capture, and ranking language.

- [x] **Step 2: Run surface tests and verify RED**

Run: `pnpm exec vitest run src/features/modes/shared/chat-ui/lib/continuity-overview.spec.ts src/features/shell/discovery/discovery-registry.spec.ts`

Expected: FAIL against the old current-chat-only copy.

- [x] **Step 3: Wire the shared copy into each surface**

Replace both duplicated Chat Settings help strings and the compact toggle description with imports from the contract. Render the console description above its toolbar, use the Continuity detail helper, and revise the Discover continuity summary and location text.

- [x] **Step 4: Run all focused tests and verify GREEN**

Run: `pnpm exec vitest run src/features/modes/shared/chat-ui/lib/memory-recall-copy.spec.ts src/features/modes/shared/chat-ui/lib/continuity-overview.spec.ts src/features/shell/discovery/discovery-registry.spec.ts`

Expected: PASS.

### Task 3: Validate and publish

**Files:**
- Review all files changed by Tasks 1-2.

**Interfaces:**
- Consumes: completed copy correction.
- Produces: one reviewed, merged PR closing #1053.

- [x] **Step 1: Run lane checks**

Run: `pnpm typecheck`, `pnpm check:architecture`, `pnpm check:docs`, and `pnpm check:discovery`.

Expected: all exit 0.

- [x] **Step 2: Run the full PR gate**

Run: `pnpm check`.

Expected: exit 0.

- [x] **Step 3: Review the branch boundary**

Run: `git diff --check origin/main...HEAD`, `git diff --stat origin/main...HEAD`, and `git status --short`.

Expected: only the approved copy-contract, surface, test, spec, and plan files appear.

- [x] **Step 4: Commit, run Bunny, push, and open a draft PR**

Commit only the intended files with a task-focused subject, run the Bunny review checklist against `origin/main`, push to `origin`, and create a draft PR with `Closes #1053`.

- [ ] **Step 5: Mark ready, verify CI and Bunny, then merge**

Mark the PR ready because the user explicitly requested merge. Verify all required checks, current Bunny contract state, review threads, and PR health before merging to `main`.
