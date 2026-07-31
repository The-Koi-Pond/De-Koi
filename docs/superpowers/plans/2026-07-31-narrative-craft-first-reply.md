# Narrative Craft First-Reply Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the first generated roleplay reply a zero-extra-call craft guard and run the first detached Narrative Craft analysis immediately afterward.

**Architecture:** Keep behavior in the TypeScript generation owner. A focused guidance module supplies deterministic baseline prompt text; `createGenerationAgentRuntime` composes it with pending story-specific guidance and treats absence of saved state as the first-analysis signal. Existing background scheduling, persistence, cadence, and foreground cancellation remain unchanged.

**Tech Stack:** TypeScript, Vitest, De-Koi generation runtime, existing StoryScope evaluation adapter.

## Global Constraints

- Add no foreground model call and preserve detached critic cancellation.
- Keep the configured recurring cadence at four assistant messages.
- Do not add storage schemas, runtime APIs, settings, or UI.
- Preserve explicit replay overrides and inactive-chat behavior.
- Keep real Harlequin prose and generated evaluation artifacts outside the repository.

---

### Task 1: Baseline craft guidance

**Files:**
- Create: `src/engine/generation/narrative-craft-guidance.ts`
- Modify: `src/engine/generation/agent-runner.ts`
- Test: `src/engine/generation/agent-runner.test.ts`

**Interfaces:**
- Produces: `NARRATIVE_CRAFT_BASELINE_GUIDANCE: string`
- Consumes: existing `AgentInjection`, `consumeNarrativeCraftPendingGuidance`, and `mergeAgentInjections` contracts.

- [ ] **Step 1: Write the failing baseline tests**

Add assertions that an active Narrative Craft runtime with no saved state returns one pre-injection containing the baseline silent shape pass, and that pending guidance is composed under a story-specific heading while still being consumed only once.

- [ ] **Step 2: Run the tests to verify RED**

Run: `pnpm vitest run src/engine/generation/agent-runner.test.ts`

Expected: the new assertions fail because `preInjections` is empty without pending guidance and pending guidance currently replaces all baseline text.

- [ ] **Step 3: Implement minimal baseline composition**

Export a compact constant from `narrative-craft-guidance.ts`. In `createGenerationAgentRuntime`, create a Narrative Craft pre-injection whenever automatic Narrative Craft guidance is claimable. Use the baseline alone when no pending directive exists; otherwise append `Story-specific guidance:` and the consumed directive.

- [ ] **Step 4: Run the focused tests to verify GREEN**

Run: `pnpm vitest run src/engine/generation/agent-runner.test.ts`

Expected: all tests pass with no provider request created merely to produce the baseline injection.

### Task 2: First completed-response analysis

**Files:**
- Modify: `src/engine/generation/agent-runner.ts`
- Test: `src/engine/generation/agent-runner.test.ts`
- Test: `src/engine/generation/start-generation.narrative-craft-background.spec.ts`

**Interfaces:**
- Consumes: `context.memory._narrativeCraftState`, `narrativeCraftHasRecurringShape`, and `GenerationAgentRuntime.runNarrativeCraftAnalysis`.
- Produces: first analysis runs when saved state is absent; later automatic analyses remain recurrence-gated.

- [ ] **Step 1: Write the failing first-analysis tests**

Change the no-candidate case into two cases: no saved state must call Narrative Craft once for the completed response, while established saved state with non-recurring prose must return no results and issue no model request.

- [ ] **Step 2: Run the tests to verify RED**

Run: `pnpm vitest run src/engine/generation/agent-runner.test.ts src/engine/generation/start-generation.narrative-craft-background.spec.ts`

Expected: the state-less first-analysis test fails because the cheap recurrence gate returns before the pipeline call.

- [ ] **Step 3: Implement minimal first-analysis policy**

Capture `const firstNarrativeCraftAnalysis = !!narrativeCraftAgent && !context.memory._narrativeCraftState` after context construction. Skip for no recurrence only when that value is false and the caller did not force the run.

- [ ] **Step 4: Run focused tests to verify GREEN**

Run: `pnpm vitest run src/engine/generation/agent-runner.test.ts src/engine/generation/start-generation.narrative-craft-background.spec.ts`

Expected: the first response is analyzed, established state stays sparse, the visible reply finishes before the critic starts, and all tests pass.

### Task 3: Harlequin and StoryScope proof

**Files:**
- Modify only if evaluation falsifies the wording: `src/engine/generation/narrative-craft-guidance.ts`
- Temporary outside-repository artifacts: Harlequin source/treatment text, StoryScope input, extracted features, blind-review results.

**Interfaces:**
- Consumes: pinned StoryScope revision `642e746804e1ee4138ffdcf13b7412eb3dc2a70b` and the agent-configured writer model.
- Produces: measured feature comparison, quality judgment, and foreground-call-count proof.

- [ ] **Step 1: Capture the latest Harlequin opening read-only outside the repository**

Use the Pi storage snapshot/pending journal read-only, identify the latest assistant message, and keep its text only in a temporary external evaluation directory.

- [ ] **Step 2: Generate a treatment with the same context and writer model**

Apply the baseline craft directive without adding another production generation stage. Record provider/model and elapsed time; do not commit prose or credentials.

- [ ] **Step 3: Run the pinned StoryScope feature application and blind review**

Use the existing evaluation adapter and report full-feature and narrative-without-style probability deltas plus any newly introduced near-universal replacement device. Independently judge voice, continuity, genre fit, agency, and whether the treatment reads less formulaically.

- [ ] **Step 4: Tune only if evidence requires it**

If treatment loses StoryScope or blind quality, revise the baseline wording, add a focused expectation for the corrected contract, and repeat the comparison. Do not add synchronous critique/rewrite latency.

### Task 4: Verification and shipping

**Files:**
- Update if user-visible behavior changed: `src/features/shell/discovery/discovery-entries.json` or record `Feature Discoverability: N/A` with the reason that existing Narrative Craft activation/UI is unchanged.
- Update risky proof: `.github/pr-evidence/narrative-craft-first-reply/proof-ledger.json` if required by proof health.

**Interfaces:**
- Produces: clean diff, full local checks, current-head Bunny pass, green hosted CI, merged PR, and exact Pi deployment receipt.

- [ ] **Step 1: Run local verification**

Run focused Vitest, `pnpm typecheck`, `pnpm check:architecture`, `pnpm check`, and `git diff --check origin/main...HEAD`.

- [ ] **Step 2: Run Bunny before publication**

Review `git log origin/main..HEAD`, `git diff --stat origin/main...HEAD`, changed code, proof, and PR wording. Fix every current-head blocking finding and rerun matching checks.

- [ ] **Step 3: Publish and merge**

Commit only intended files, push only to `origin`, open the strict-template PR ready for review, satisfy proof health, hosted CI, current-head Bunny, mergeability, and unresolved-thread gates, then squash-merge to `main`.

- [ ] **Step 4: Update and prove the Pi**

Wait for exact ARM64 images, fast-forward `/home/chai/de-koi-src`, run `sh scripts/pi-update.sh --trusted-lan`, and verify checkout/image revisions, both containers, root HTTP 200, writable `/health?probe=1`, `/data`, `/root/.codex`, and the local compose override.
