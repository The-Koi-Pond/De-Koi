# Scene Planner Boundaries Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent `/scene` planning from overriding explicit adult-scene intent and normalize malformed planner newlines before persistence.

**Architecture:** Keep all behavior inside the TypeScript roleplay scene owner. Treat the LLM plan as untrusted narrative input: normalize narrative prose, ignore planner-authored instruction fields and Universal preset selections, and let deterministic De-Koi guidance choose scene behavior.

**Tech Stack:** TypeScript, Vitest, De-Koi engine storage and LLM capability ports.

## Global Constraints

- Chat, roleplay, and game orchestration remain separate.
- No UI, shared API, Tauri, Rust, storage schema, or provider behavior changes.
- Fix the roleplay owner contract rather than adding renderer fallbacks.

---

### Task 1: Constrain and normalize scene plans

**Files:**
- Modify: `src/engine/modes/roleplay/scene/scene-service.ts`
- Test: `src/engine/modes/roleplay/scene/scene-service.spec.ts`

**Interfaces:**
- Consumes: `planRoleplayScene(capabilities, input)` and `createRoleplayScene(storage, input)`.
- Produces: sanitized `SceneFullPlan` values with normalized narrative prose and no planner-controlled instructions or `presetChoices`.

- [ ] **Step 1: Write failing regressions**

Add focused tests whose planner fixture returns double-escaped newlines and `boundary_explicit_adult_safe`. Assert that persisted prose contains real newlines and the created Universal preset uses the deterministic mature-adult choice.

- [ ] **Step 2: Run tests and verify RED**

Run: `pnpm vitest run src/engine/modes/roleplay/scene/scene-service.spec.ts`

Expected: failures showing literal `\\n` remains and planner preset choices override inference.

- [ ] **Step 3: Implement the minimal owner fix**

Normalize planner narrative fields during `sanitizeScenePlan`, replace planner instruction fields with deterministic De-Koi values, remove planner `presetChoices`, and stop requesting those fields from the planner.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `pnpm vitest run src/engine/modes/roleplay/scene/scene-service.spec.ts`

Expected: all scene-service tests pass.

- [ ] **Step 5: Run shipping verification**

Run: `pnpm typecheck`, `pnpm check:architecture`, and `pnpm check`.

Expected: all required checks pass; warning-only unused-code output is reported separately if present.
