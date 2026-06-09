---
name: marinara-legacy-parity-audit
description: "Compare De-Koi refactor behavior against legacy Marinara to find regressions, parity gaps, current refactor defects, remote/embedded drift, and legacy-better workflows. Trigger keyword: parityscan. Use for full, static-trace, row-only, follow-up, or report-only parity scans across product surfaces, contracts, schemas, storage, migrations, import/export, settings, providers, modes, agents, tools, sprites, runtime behavior, and performance paths."
---

# Marinara Legacy Parity Audit

Use this skill to compare the current De-Koi refactor repo with legacy Marinara for one feature, contract, schema, storage format, runtime behavior, or product area. Focus on product-important missing behavior, likely accidental regressions, current refactor defects, and legacy flows that still work better.

Activation keyword: `parityscan`.

## Fast Path

1. Pick the cheapest scan mode that proves the user's claim.
2. Resolve the refactor and legacy paths.
3. Load only the references needed for that mode and target.
4. Search exact leads first in both codebases.
5. Classify with code, runtime, issue, or artifact evidence; never classify from memory.
6. Report with either the compact or full template.

Stop when the named target has refactor evidence, legacy evidence or justified absence, classification, next action, and uncertainty. Do not widen into adjacent targets unless one concrete risk crosses that boundary.

## Scan Modes

Default to the narrowest mode:

| User request shape | Mode |
| --- | --- |
| Exact tracker row, issue bullet, symbol, command, or file | `row-only` + `static-trace` + `report-only` |
| "Continue", "follow-up", "same target", or nearby row IDs | `follow-up` + `static-trace` unless runtime proof is requested |
| Current refactor bug/risk with legacy only as context | `static-trace`; legacy lookup is optional until parity classification depends on it |
| Broad target, target refresh, issue update, PR support, or unclear/risky scope | `full` |

Load `references/scan-modes.md` when mode choice is unclear, the user sets multiple mode constraints, or the task involves follow-up/report-only boundaries.

## Path Setup

Use the current worktree as the refactor checkout unless the user gives another path.

Resolve legacy from the first available source:

1. A path provided by the user.
2. `$env:MARINARA_LEGACY_PATH`.
3. A nearby checkout named `MarinaraEngine`, `Marinara-Engine-legacy`, or `legacy-Marinara-Engine`.

Do not clone, fetch, query, or otherwise contact the Official Marinara Engine repository for parity work unless the user explicitly approves that specific read-only provenance research. If no local legacy path is available, ask one focused question for a usable legacy checkout path or continue with current De-Koi evidence only.

## Required Context

Before auditing, read the refactor repo `AGENTS.md`.

Load extra workflow only when needed:

| Need | Load |
| --- | --- |
| `full` scan, nontrivial scan, issue/PR work, code edits, or unclear/risky symptoms | `skills/marinara-agent-workflow/SKILL.md` plus the matching workflow card |
| imports, ownership, shared API wrappers, storage, Tauri, HTTP dispatch, remote runtime, or cross-boundary concerns | `skills/marinara-architecture-guard/SKILL.md` |
| Chat, Roleplay, Game, prompt assembly, generation routing, scene logic, autonomous flows, or mode UI | `skills/marinara-mode-separation/SKILL.md` |
| code edits or root-cause repair | `skills/marinara-bugfix-discipline/SKILL.md` |

Treat user-provided topic skills, local notes, GitHub issues, and PRs as optional leads. Do not require personal skills or private notes. Confirm every finding with code, runtime, or artifact evidence.

## Reference Router

Load references only when their condition applies:

| Condition | Reference |
| --- | --- |
| mode choice, row-only/follow-up/report-only guardrails, prompt examples | `references/scan-modes.md` |
| target numbers, status terms, proof levels, detail issues, #1904 tracker updates | `references/tracker-context.md` |
| exact search strategy, audit path, commands, absence wording, evidence standard | `references/search-and-evidence.md` |
| CRUD, editors, import/export, runtime, media, storage, performance, UX, architecture, proof coverage | `references/audit-checklists.md` |
| storage, catalog data, chats/messages, avatars, cold-load, projection, pagination, payload, media latency | `references/storage-hot-paths.md` |
| final classification labels | `references/classification-guide.md` |
| row-only, follow-up, static-trace, or report-only output | `references/compact-report.md` |
| broad target output | `references/full-report-template.md` |

For row-only and follow-up scans, load only the exact references needed by the named row unless evidence crosses a risky boundary.

## Non-Negotiables

- State the audit gate before deep comparison: target aliases, contract surface, refactor owner, legacy owner, risk level, proof target, issue/PR coverage, and included/excluded downstream consumers.
- Check `docs/REFACTOR_PARITY_PIPELINE.md#known-intentional-divergences` before classifying a legacy/refactor difference as a gap.
- Use GitHub issues as the durable tracker; old `scratch/parity/*` files are migration inputs only.
- In `report-only`, do not post comments, edit issues, file follow-ups, update tracker rows, modify code, or create/update parity tracker state.
- Do not open issues, update PRs, edit scratch notes, or modify code unless the user asks for that next step or standing instructions require it for an out-of-scope actionable finding.
