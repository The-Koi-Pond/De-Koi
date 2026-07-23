# Memory Recall Relevance Implementation Plan

**Goal:** Prevent visible transcript duplication and unrelated same-owner
canonical memories from inflating Memory Recall.

**Architecture:** Keep selection in the prompt-assembly owner. Reuse selected
history as transcript provenance exclusion, and treat the canonical index as a
scoped candidate source rather than evidence of relevance.

**Tech stack:** TypeScript, Vitest, pnpm.

## Task 1: Lock the broken behavior with tests

**Files:**

- Modify: `src/engine/generation/canonical-memory-context.spec.ts`
- Modify: `src/engine/generation/prompt-assembly.context-priority.spec.ts`

Add regressions proving unrelated indexed records are excluded and transcript
records sourced from visible history are excluded while older off-window
transcript records remain eligible. Run the focused tests and confirm the new
assertions fail for the intended reasons.

## Task 2: Repair transcript recall provenance filtering

**File:**

- Modify: `src/engine/generation/prompt-assembly.ts`

Select history before context lookup, pass the selected messages into transcript
recall, and combine their provenance with the existing read-behind exclusion for
both storage and fallback filtering.

## Task 3: Repair canonical relevance qualification

**File:**

- Modify: `src/engine/generation/canonical-memory-context.ts`

Remove the synthetic semantic score granted to all index records and require
lexical overlap or pinned status before metadata ranking.

## Task 4: Verify and ship

Run focused tests, type checking, architecture checks, and the repository check
lane. Complete Bunny review, publish and merge the PR, deploy the exact merged
revision to the Pi, then verify service health, image revision, containers,
mounts, and the affected prompt behavior.
