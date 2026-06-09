---
name: de-koi-bugfix-discipline
description: "Guide De-Koi bug fixes toward root-cause repairs with clear impact areas, focused commits, validation, and no band-aid patches. Use for regressions, broken UI actions, failing checks, provider/transport bugs, storage bugs, import/export bugs, generation bugs, mode behavior bugs, and any change where the fix could affect dependent modules."
---

# De-Koi Bugfix Discipline

## Overview

Use this skill to fix bugs without widening the blast radius. The goal is durable repair: understand the owner, fix the real contract or state transition, verify the affected path, and report impact clearly.

## Load First

Read `references/impact-brief-template.md` when preparing a fix plan or final summary.

Also load:

- `skills/de-koi-architecture-guard/SKILL.md` if the fix changes imports, owners, adapters, Rust commands, repositories, or file layout.
- `skills/de-koi-mode-separation/SKILL.md` if the fix touches chat, roleplay, game, prompts, or generation routing.

## Workflow

1. Define the failing behavior in one sentence.
2. Find the owning path and the exact callers.
3. Inspect data contracts at every boundary the failing path crosses.
4. Fix the lowest correct owner, not the most convenient caller.
5. Delete obsolete fallbacks or placeholder branches exposed by the fix.
6. Run targeted checks and broader checks when shared layers changed.
7. Report behavior, files, impact area, verification, and residual risk.

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
