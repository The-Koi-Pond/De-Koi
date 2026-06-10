---
name: de-koi-bugfix-discipline
description: "Guide De-Koi bug fixes through feedback-loop-first diagnosis and root-cause repair with clear impact areas, focused validation, and no band-aid patches. Use for regressions, broken UI actions, failing checks, provider/transport bugs, storage bugs, import/export bugs, generation bugs, mode behavior bugs, performance regressions, or any change where the fix could affect dependent modules."
---

# De-Koi Bugfix Discipline

## Overview

Use this skill to fix bugs without widening the blast radius. The goal is durable repair: build a useful feedback loop, reproduce the real symptom, understand the owner, fix the real contract or state transition, verify the affected path, and report impact clearly.

## Load First

Read `references/impact-brief-template.md` when preparing a fix plan or final summary.

Also load:

- `skills/de-koi-architecture-guard/SKILL.md` if the fix changes imports, owners, adapters, Rust commands, repositories, or file layout.
- `skills/de-koi-mode-separation/SKILL.md` if the fix touches chat, roleplay, game, prompts, or generation routing.

## Workflow

1. Define the failing behavior in one sentence.
2. Build the cheapest feedback loop that can show the failure and later prove the fix.
3. Reproduce the user's symptom, or state the closest representative proof and why it is sufficient.
4. Find the owning path and the exact callers.
5. Inspect data contracts at every boundary the failing path crosses.
6. Test ranked hypotheses one at a time.
7. Fix the lowest correct owner, not the most convenient caller.
8. Delete obsolete fallbacks or placeholder branches exposed by the fix.
9. Run targeted checks and broader checks when shared layers changed.
10. Report behavior, files, impact area, verification, and residual risk.

## Diagnosis Loop

Build the feedback loop before committing to a fix. Prefer loops in this order:

1. Existing focused unit, integration, component, Rust, or e2e test.
2. Temporary uncommitted test or harness at the owner boundary.
3. Route/module repro, command invocation, or fixture replay.
4. Browser or Tauri proof when the claim is browser/native behavior.
5. Manual script only when no runnable loop can cover the symptom.

The loop should be fast, deterministic, and specific to the reported failure. If it is flaky, raise the reproduction rate with repeated runs, seeded inputs, stress timing, or narrower setup before debugging against it.

For nontrivial bugs, rank 3-5 falsifiable hypotheses before instrumentation. Each hypothesis needs a prediction: if this is the cause, then a specific observation or small change should confirm or falsify it. Share the ranked list when user domain knowledge could rerank it, but keep moving if the user is not present.

Instrument only where it distinguishes hypotheses. Prefer debugger or REPL inspection when available, then targeted logs. Tag temporary logs with a unique prefix such as `[DEBUG-<short-id>]` and grep them away before done. For performance regressions, establish a baseline measurement before changing code.

Turn the minimized repro into a durable test only when De-Koi's durable-test criteria are met. Otherwise keep the harness temporary and cite its observed output in the final report.

## No Patch Layering

Do not solve bugs by adding:

- fake success responses
- catch-and-ignore blocks
- old-shape compatibility branches
- mode flags in generic code when the mode needs its own owner
- duplicate helpers copied into another feature
- UI-only guards that leave invalid engine or storage state
- broad defaults that hide missing persisted data
- direct Tauri or hostable-runtime HTTP calls from engine code
- new direct `invokeTauri` calls in feature code when a typed `src/shared/api` wrapper should own the command boundary
- feature-level generic local API routers or raw remote-runtime fetches

Fix the root: owner, contract, persistence shape, mode orchestrator, adapter, command, or capability.

## Commit Discipline

- Keep one commit to one coherent behavior or architecture move.
- Do not mix formatting churn with a behavioral fix.
- Include docs or skill updates when architecture or task guidance changes.
- Leave unrelated dirty worktree changes alone.
- In the final answer, say what was intentionally not touched.

## Verification

Use the smallest checks that prove the local fix, but escalate when shared paths changed:

- TypeScript/shared UI/engine: `pnpm typecheck`
- Build behavior or import graph changes: `pnpm build`
- Rust commands/capabilities/provider transport or hostable runtime: `cargo check --manifest-path src-tauri/Cargo.toml`
- Docs/agent guidance/checklist changes: `pnpm check:docs`

Before declaring done, re-run the original feedback loop or closest representative proof, remove temporary debug instrumentation, and name any path that remains unverified.
