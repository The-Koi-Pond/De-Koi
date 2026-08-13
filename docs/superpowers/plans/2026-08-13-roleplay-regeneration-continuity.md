# Roleplay Regeneration Continuity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task by task.

**Goal:** Keep assistant regenerations grounded in the preceding user turn, interrupt background memory-provider work when foreground generation begins, and prevent unmistakable roleplay drafting placeholders from reaching the saved response.

**Architecture:** Preserve the existing generation pipeline and fix each issue at its owning boundary. Shared generation derives recall input from the latest visible user message and coordinates foreground/background cancellation; roleplay owns the narrow malformed-output signal and prose guidance. Existing quality correction performs any repair rather than introducing a second rewrite pipeline.

**Tech Stack:** TypeScript, Vitest, React/Tauri application generation engine, pnpm.

**Global constraints:** Preserve non-roleplay behavior unless it shares the broken regeneration or scheduling contract. Do not broadly reject capitalized prose. Do not replay stale generated prompts. Do not commit, push, or publish without separate authorization.

### Task 1: Preserve canonical recall during assistant regeneration

**Files:**

- Modify: `src/engine/generation/start-generation.ts`
- Test: `src/engine/generation/start-generation.memory-recall.e2e.spec.ts`

- [x] Add a failing end-to-end test that stores a user turn, an assistant turn, and a matching canonical memory, then regenerates the assistant turn.
- [x] Prove the current regenerated request omits the matching canonical-memory block.
- [x] Derive `latestUserInput` from the latest visible user message before the regeneration target when direct input is absent.
- [x] Apply the same fallback to normal and dry-run generation paths without replaying the prior assembled prompt.
- [x] Keep ordinary no-input group selection unchanged by limiting the fallback to assistant regeneration targets.
- [x] Run `pnpm vitest run src/engine/generation/start-generation.memory-recall.e2e.spec.ts`.

### Task 2: Interrupt active memory maintenance for foreground generation

**Files:**

- Modify: `src/engine/generation/background-generation-coordinator.ts`
- Modify: `src/engine/generation/automatic-memory-maintenance-queue.ts`
- Test: `src/engine/generation/background-generation-coordinator.spec.ts`
- Test: `src/engine/generation/automatic-memory-maintenance-queue.spec.ts`

- [x] Add a failing coordinator test for a one-shot foreground-start interruption registration.
- [x] Implement scoped registration, cleanup, and outermost foreground-start notification.
- [x] Add a failing queue test proving a maintenance provider signal is aborted when foreground generation begins and the job returns to pending without consuming an attempt.
- [x] Combine lease-loss and foreground-pause cancellation for active provider work while preserving the existing deferred retry path.
- [x] Run the two focused coordinator and maintenance suites.

### Task 3: Add narrow roleplay defenses for the observed GLM failures

**Files:**

- Modify: `src/engine/generation/roleplay-quality-signals.ts`
- Modify: `src/engine/modes/roleplay/core/roleplay-prose-guidance.ts`
- Test: `src/engine/generation/roleplay-quality-signals.spec.ts`
- Test: `src/engine/generation/prose-shape-guidance.spec.ts`

- [x] Add a failing quality-signal test for the observed all-caps editorial placeholder family.
- [x] Implement a narrowly scoped malformed-output signal that catches drafting instructions such as `CREATIVE BACKGROUND SKIP HERE` without treating ordinary capitals as malformed.
- [x] Add a failing roleplay-guidance test requiring characters to infer or write around plainly observable but unspecified details instead of interrogating the user about them.
- [x] Add the roleplay-only guidance invariant.
- [x] Run both focused roleplay suites and the prompt snapshot suite.

### Task 4: Verify the integrated change

**Files:**

- Review all files above and the generated diff.

- [x] Run all directly affected Vitest suites together.
- [x] Run `pnpm typecheck`.
- [x] Run `pnpm check:architecture`.
- [x] Run `pnpm check:line-endings`.
- [x] Inspect `git diff --check`, the final diff, and worktree status for unrelated changes.
- [x] Report behavior, mode impact, verification evidence, and any remaining live-provider uncertainty.
