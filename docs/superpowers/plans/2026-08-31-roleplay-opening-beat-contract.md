# Roleplay Opening Beat Contract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop generated Roleplay scene plans from pre-writing the opening response in an AI-associated polished cadence.

**Architecture:** Tighten and enforce the existing `firstMessage` contract at the Roleplay scene planner. Preserve the wire/storage shape while turning the value into a bounded beat brief consumed by the existing Roleplay opening guide.

**Tech Stack:** TypeScript, Vitest, De-Koi engine gateways.

## Global Constraints

- Keep the change inside the Roleplay engine owner.
- Do not change Conversation, Game, presets, character data, provider transport, or existing saved scenes.
- Permit a brief exact user-requested line only inside the same 360-character beat limit.

---

### Task 1: Enforce the opening-beat contract

**Files:**
- Modify: `src/engine/modes/roleplay/scene/scene-service.ts`
- Test: `src/engine/modes/roleplay/scene/scene-service.spec.ts`

**Interfaces:**
- Consumes: planner JSON field `firstMessage: string`.
- Produces: `SceneFullPlan.firstMessage` as a compact, sentence-bounded beat brief.

- [x] **Step 1: Write the failing test**

Capture the outgoing `LlmRequest`, return an overlong multi-sentence opening, and assert that the system contract requests a beat brief while the returned plan is bounded.

- [x] **Step 2: Run the focused test and verify RED**

Run: `pnpm vitest run src/engine/modes/roleplay/scene/scene-service.spec.ts`

Expected: the new contract assertion fails against the current planner prompt and unbounded response.

- [x] **Step 3: Implement the minimal owner fix**

Add a named opening-beat character limit, update the planner system instruction, apply the existing sentence-aware trimming helper, and replace short script-shaped output unless its dialogue was supplied verbatim by the user.

- [ ] **Step 4: Verify GREEN and the shipping baseline**

Run the focused Vitest file, `pnpm typecheck`, `pnpm check:architecture`, `git diff --check`, and `pnpm check`.

- [ ] **Step 5: Review and ship**

Run Bunny against the exact diff, commit and push the coherent change, open the PR, wait for hosted CI and final-head Bunny, merge, wait for exact merge-SHA images, and deploy/verify the Pi.
