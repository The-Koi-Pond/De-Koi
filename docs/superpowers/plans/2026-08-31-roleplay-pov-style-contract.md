# Roleplay POV and Character Style Contract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the spawned-scene third-person conflict and prove character-owned examples remain available as Roleplay voice evidence.

**Architecture:** Keep POV ownership in the existing Universal preset and explicit scene direction. Change only the Roleplay scene guideline, then strengthen existing engine tests around scene metadata and assembled character examples; do not add a style subsystem or change provider/runtime boundaries.

**Tech Stack:** TypeScript, Vitest, pnpm.

## Global Constraints

- Conversation and Game behavior remain unchanged.
- Existing durable scene prompts are not migrated.
- No universal prose excerpts, critic, blacklist, planner, rewrite pass, or model-specific prompt is added.
- Product behavior stays in `src/engine`; no React, shared API, Tauri, HTTP, provider, or storage changes.

---

### Task 1: Make spawned-scene POV direction coherent

**Files:**
- Modify: `src/engine/modes/roleplay/scene/scene-service.ts`
- Test: `src/engine/modes/roleplay/scene/scene-service.spec.ts`

**Interfaces:**
- Consumes: the existing Universal preset `narration` and `pov` choices plus explicit scene/origin direction.
- Produces: a durable `sceneSystemPrompt` that defers to those active choices and contains no unconditional third-person instruction.

- [ ] **Step 1: Write the failing regression assertions**

Extend the spawned-scene Universal preset test to assert that `sceneSystemPrompt` contains direction equivalent to `Follow the active preset, originating chat, and explicit scene request for narration and point of view` and does not match `/keep narration in third person/i`. Preserve the existing assertions for `sceneUniversalPresetChoiceHints.narration` and related choices.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `pnpm vitest run src/engine/modes/roleplay/scene/scene-service.spec.ts`

Expected: FAIL because `SCENE_GUIDELINES` still contains the unconditional third-person sentence.

- [ ] **Step 3: Implement the minimal owner-layer fix**

Replace only the hardcoded third-person guideline with:

```ts
"- Follow the active preset, originating chat, and explicit scene request for narration and point of view. When they differ, prefer the newest explicit scene direction.",
```

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `pnpm vitest run src/engine/modes/roleplay/scene/scene-service.spec.ts`

Expected: PASS.

---

### Task 2: Lock character-owned examples into the Roleplay prompt contract

**Files:**
- Test: `src/engine/generation/prompt-assembly.roleplay-quality.spec.ts`
- Review only: `src/engine/modes/roleplay/core/roleplay-prose-guidance.ts`

**Interfaces:**
- Consumes: character `first_mes` and `mes_example` fields and the existing compact `Roleplay Prose Guidance` injection.
- Produces: regression proof that character example dialogue reaches the assembled prompt and is not replaced by a global sample.

- [ ] **Step 1: Add the prompt-assembly regression test**

Create or extend a Roleplay prompt fixture with distinctive `first_mes` and `mes_example` strings. Assert the assembled messages contain both strings, contain exactly one `Roleplay Prose Guidance` injection after mode guidance is applied through the existing public generation path, and contain neither `Automatic:` nor `Cleaner:`.

- [ ] **Step 2: Run the focused tests**

Run: `pnpm vitest run src/engine/generation/prompt-assembly.roleplay-quality.spec.ts src/engine/generation/prose-shape-guidance.spec.ts`

Expected: PASS if the existing contract is intact. If the new assertion fails, trace the actual assembly boundary and make the smallest engine-owner correction before continuing.

- [ ] **Step 3: Verify matching lane gates**

Run: `pnpm typecheck`

Expected: PASS.

Run: `pnpm check:architecture`

Expected: PASS.

- [ ] **Step 4: Inspect the final diff**

Run: `git diff --check` and `git diff -- docs/superpowers/specs/2026-08-31-roleplay-pov-style-contract-design.md docs/superpowers/plans/2026-08-31-roleplay-pov-style-contract.md src/engine/modes/roleplay/scene/scene-service.ts src/engine/modes/roleplay/scene/scene-service.spec.ts src/engine/generation/prompt-assembly.roleplay-quality.spec.ts`.

Expected: only the approved design, plan, POV fix, and narrow regression proof; no provider, storage, UI, or unrelated changes.
