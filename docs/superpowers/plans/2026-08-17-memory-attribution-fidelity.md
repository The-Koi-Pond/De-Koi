# Automatic Memory Attribution Fidelity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reject automatic canonical memories that change pronouns, speaker ownership, or the specificity of cited evidence.

**Architecture:** Keep the behavior in the shared TypeScript automatic-memory capture owner. Extend the existing deterministic candidate gate and align the extraction prompt; do not change storage, runtime adapters, or mode orchestration.

**Tech Stack:** TypeScript, Vitest, De-Koi engine generation contracts.

## Global Constraints

- Preserve the current canonical-memory schema and queue contract.
- Use only snapshotted source message IDs, roles, speaker labels, and content.
- Prefer rejection to persisting an inaccurate automatic memory.
- Do not affect manual, imported, corrected, or user-edited memories.

---

### Task 1: Reproduce the reported fidelity failures

**Files:**
- Modify: `src/engine/generation/automatic-memory-capture.spec.ts`
- Modify: `src/engine/generation/memory-context-clarity.fixtures.spec.ts`

**Interfaces:**
- Consumes: `extractCanonicalMemoryConsequences(...)` and `standaloneMemoryFailure(...)`.
- Produces: failing public-behavior fixtures for pronoun, speaker, and specificity drift.

- [ ] Add one candidate using the wrong third-person pronoun for Agent Cobalt and expect rejection.
- [ ] Run focused Vitest and confirm the pronoun fixture fails because the candidate is currently accepted.
- [ ] Add a candidate saying Shlo made Agent Cobalt's statement and expect rejection.
- [ ] Run focused Vitest and confirm the attribution fixture fails because token-union evidence currently accepts it.
- [ ] Add a candidate that turns one returned-Machina observation into a general rule and expect rejection.
- [ ] Run focused Vitest and confirm the specificity fixture fails because the current overlap gate ignores quantifier loss.

### Task 2: Enforce source fidelity at the capture owner

**Files:**
- Modify: `src/engine/generation/automatic-memory-capture.ts`
- Modify: `src/engine/generation/automatic-memory-capture.spec.ts`
- Modify: `src/engine/generation/memory-context-clarity.fixtures.spec.ts`

**Interfaces:**
- Consumes: `CanonicalConsequenceSourceMessage[]` already resolved from candidate evidence IDs.
- Produces: conservative deterministic acceptance helpers used before `CanonicalMemoryInput` construction.

- [ ] Extend `StandaloneMemoryFailure` and `standaloneMemoryFailure(...)` to reject third-person personal pronouns anywhere in automatic memory content.
- [ ] Run the pronoun fixture and confirm green.
- [ ] Add a speaker-local support helper that recognizes named reporting clauses and requires meaningful overlap with that named speaker's cited rows.
- [ ] Call it from `extractCanonicalMemoryConsequences(...)` and run the attribution fixture to green.
- [ ] Add a specificity helper that rejects loss of explicit `one`, `single`, `this`, or `that` evidence scope.
- [ ] Call it from `extractCanonicalMemoryConsequences(...)` and run the generalization fixture to green.
- [ ] Tighten the extraction prompt with the three fidelity rules and positive wording guidance.
- [ ] Run all nearby memory capture and clarity tests.

### Task 3: Validate and ship

**Files:**
- Review all changed files; no additional production owner is expected.

**Interfaces:**
- Consumes: focused red-green proof and the repository shipping workflow.
- Produces: one reviewed PR merged to `main`, followed by exact-SHA Pi deployment.

- [ ] Run `pnpm typecheck`.
- [ ] Run `pnpm check:architecture`.
- [ ] Run `pnpm check`.
- [ ] Run Bunny against the final local diff and fix any blocker test-first.
- [ ] Commit only the intended source, tests, spec, and plan; push to `origin` and open the PR with strict template headings.
- [ ] Mark ready, wait for hosted CI and final-head Bunny, then merge.
- [ ] Wait for the merge SHA's matched server/web `:prealpha` images.
- [ ] Update `/home/chai/de-koi-src` on the Pi with `pi-update.sh --trusted-lan` and verify exact labels, HTTP, writable health, container state, and persistent mounts.
