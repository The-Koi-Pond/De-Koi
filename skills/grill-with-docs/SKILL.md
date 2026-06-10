---
name: grill-with-docs
description: "Stress-test De-Koi plans against the current repo, product docs, architecture rules, and durable guidance, then capture only reusable decisions. Use when the user wants to be grilled on a design, sharpen fuzzy requirements, validate terminology, or update docs while a plan is clarified."
---

# Grill With Docs

Use this skill to reach shared understanding before implementation. Ask one question at a time. If code or docs can answer the question, inspect them instead of asking.

## Load First

- `AGENTS.md`
- `PRODUCT.md` and `DESIGN.md` when product or UI intent matters
- `skills/de-koi-agent-workflow/SKILL.md`
- `skills/de-koi-architecture-guard/SKILL.md` for ownership, imports, shared APIs, Tauri, Rust, storage, providers, or runtime behavior
- `skills/de-koi-mode-separation/SKILL.md` for chat, roleplay, game, prompt, generation, or mode UI behavior

## Session Loop

1. Restate the plan in one concise paragraph.
2. Identify the highest-risk unclear decision.
3. Ask one question with your recommended answer.
4. Use repo inspection to resolve answerable questions.
5. Challenge fuzzy language against De-Koi terms and owners.
6. Probe concrete scenarios and edge cases.
7. Record only durable decisions that future work needs.
8. Continue until the plan has clear scope, owner, proof, and out-of-scope boundaries.

## What To Challenge

- owner confusion between `src/engine`, `src/features`, `src/shared/api`, and `src-tauri`
- chat, roleplay, and game mode mixing
- UI-only fixes for engine/storage/provider contract bugs
- hidden persistence, migration, import/export, prompt, provider, or security risk
- vague words such as "sync", "memory", "agent", "runtime", "profile", or "state" when multiple De-Koi meanings exist
- missing negative controls for destructive or detection logic

## Durable Capture

Do not create docs by reflex. Capture decisions only when they change future agent behavior, architecture, product language, or issue/PR clarity.

Use the narrowest durable home:

- GitHub issue or PR body for active work ownership and acceptance criteria
- `skills/*/references/*` for reusable agent guidance
- developer docs for user-facing or architecture guidance that belongs outside skills

Do not add AI/tool self-attribution to public text. Draft exact external text and wait for approval unless posting was already authorized.
