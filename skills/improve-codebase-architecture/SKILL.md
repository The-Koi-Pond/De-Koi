---
name: improve-codebase-architecture
description: "Find De-Koi architecture deepening opportunities that improve locality, leverage, testability, and agent navigation without violating repo boundaries. Use when the user asks to improve architecture, reduce shallow modules, plan refactors, make code more testable, or inspect module/interface design."
---

# Improve Codebase Architecture

Use this skill to find refactors worth doing, not to rewrite for taste. Keep `AGENTS.md`, `de-koi-agent-workflow`, and `de-koi-architecture-guard` in force.

## Vocabulary

- Module: any function, class, package, feature slice, or command boundary with an interface and implementation.
- Interface: everything callers must know, including types, invariants, ordering, config, errors, and performance.
- Seam: where an interface lives.
- Adapter: a concrete implementation at a seam.
- Depth: how much useful behavior sits behind a small interface.
- Leverage: what callers gain from a deep module.
- Locality: where change, bugs, and proof concentrate.

Use the deletion test: if deleting a module removes complexity, it was pass-through; if complexity reappears across callers, it was earning its keep.

## Workflow

1. Name the target area and load `skills/de-koi-architecture-guard/SKILL.md`.
2. Inspect current callers, contracts, tests, and ownership boundaries.
3. Note friction while reading: bouncing between many files, shallow wrappers, duplicated conditionals, test-only seams, or cross-owner leakage.
4. Apply the deletion test to suspected shallow modules.
5. Produce a candidate report before proposing code.
6. If the user picks a candidate, design the new seam and proof plan before editing.

## Candidate Report

For each candidate, include:

- Files/modules involved
- Current interface cost
- Hidden implementation complexity, if any
- Proposed seam or owner move
- Benefits in locality, leverage, and testability
- Boundary risks under De-Koi architecture rules
- Recommendation: Strong, Worth exploring, or Speculative

Do not propose feature-level generic routers, fake compatibility layers, direct engine-to-Tauri imports, cross-mode imports, or one-adapter abstractions without a real second adapter or clear near-term caller.

## Design Pass

When exploring a chosen candidate, compare at least two interface shapes:

- smallest interface with maximum leverage
- common-caller optimized interface
- ports/adapters shape when dependencies cross runtime or storage seams

Pick the one that concentrates change in the right owner and can be proven through a stable public interface.
