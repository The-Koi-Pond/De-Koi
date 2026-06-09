---
name: de-koi-legacy-parity-audit
description: "Compare current De-Koi behavior against legacy Marinara to find regressions, parity gaps, current De-Koi defects, remote/embedded drift, and legacy-better workflows. Trigger keyword: parityscan. Use for full, static-trace, row-only, follow-up, or report-only parity scans across product surfaces, contracts, schemas, storage, migrations, import/export, settings, providers, modes, agents, tools, sprites, runtime behavior, and performance paths."
---

# De-Koi Legacy Parity Audit

Use this skill to compare the current De-Koi repo with legacy Marinara from the Pasta staging branch for one feature, contract, schema, storage format, runtime behavior, or product area. Focus on product-important missing behavior, likely accidental regressions, current De-Koi defects, and legacy flows that still work better.

Activation keyword: `parityscan`.

## Fast Path

1. Pick the cheapest scan mode that proves the user's claim.
2. Resolve the De-Koi and legacy paths.
3. Load only the references needed for that mode and target.
4. Search exact leads first in both codebases.
5. Classify with code, runtime, issue, or artifact evidence; never classify from memory.
6. Report with either the compact or full template.

Stop when the named target has De-Koi evidence, legacy evidence or justified absence, classification, next action, and uncertainty. Do not widen into adjacent targets unless one concrete risk crosses that boundary.

## Scan Modes

Default to the narrowest mode:

| User request shape | Mode |
| --- | --- |
| Exact tracker row, issue bullet, symbol, command, or file | `row-only` + `static-trace` + `report-only` |
| "Continue", "follow-up", "same target", or nearby row IDs | `follow-up` + `static-trace` unless runtime proof is requested |
| Current De-Koi bug/risk with legacy only as context | `static-trace`; legacy lookup is optional until parity classification depends on it |
| Broad target, target refresh, issue update, PR support, or unclear/risky scope | `full` |

Load `references/scan-modes.md` when mode choice is unclear, the user sets multiple mode constraints, or the task involves follow-up/report-only boundaries.

## Path Setup

Use the current worktree as the De-Koi checkout unless the user gives another path.

Resolve legacy from the first available source:

1. A path provided by the user.
2. `$env:MARINARA_LEGACY_PATH`.
3. A nearby checkout named `MarinaraEngine`, `Marinara-Engine-legacy`, or `legacy-Marinara-Engine`.
4. The `staging` branch of `https://github.com/Pasta-Devs/Marinara-Engine.git`, currently treated as legacy: https://github.com/Pasta-Devs/Marinara-Engine/tree/staging.

When using a local legacy checkout, verify it is on or fetched from Pasta `staging` unless the user explicitly asks for another legacy source.

If no local legacy path is available and network access or cloning/fetching is blocked, ask one focused question for a usable legacy checkout path. Follow active workspace rules before creating any new checkout or persistent copy.

## Required Context

Before auditing, read the De-Koi repo `AGENTS.md`.

Load extra workflow only when needed:

| Need | Load |
| --- | --- |
| `full` scan, nontrivial scan, issue/PR work, code edits, or unclear/risky symptoms | `skills/de-koi-agent-workflow/SKILL.md` plus the matching workflow card |
| imports, ownership, shared API wrappers, storage, Tauri, HTTP dispatch, remote runtime, or cross-boundary concerns | `skills/de-koi-architecture-guard/SKILL.md` |
| Chat, Roleplay, Game, prompt assembly, generation routing, scene logic, autonomous flows, or mode UI | `skills/de-koi-mode-separation/SKILL.md` |
| code edits or root-cause repair | `skills/de-koi-bugfix-discipline/SKILL.md` |

Treat user-provided topic skills, local notes, GitHub issues, and PRs as optional leads. Do not require personal skills or private notes. Confirm every finding with code, runtime, or artifact evidence.

## Reference Router

Load references only when their condition applies:

| Condition | Reference |
| --- | --- |
| mode choice, row-only/follow-up/report-only guardrails, prompt examples | `references/scan-modes.md` |
| target numbers, status terms, proof levels, De-Koi tracker issue #2 updates | `references/tracker-context.md` |
| splitting a tracker issue, detail issue, or large target into small parityscan batches without running the scans | `references/parity-scan-batching.md` |
| exact search strategy, audit path, commands, absence wording, evidence standard | `references/search-and-evidence.md` |
| CRUD, editors, import/export, runtime, media, storage, performance, UX, architecture, proof coverage | `references/audit-checklists.md` |
| storage, catalog data, chats/messages, avatars, cold-load, projection, pagination, payload, media latency | `references/storage-hot-paths.md` |
| final classification labels | `references/classification-guide.md` |
| row-only, follow-up, static-trace, or report-only output | `references/compact-report.md` |
| broad target output | `references/full-report-template.md` |

For row-only and follow-up scans, load only the exact references needed by the named row unless evidence crosses a risky boundary.

## Non-Negotiables

- State the audit gate before deep comparison: target aliases, contract surface, De-Koi owner, legacy owner, risk level, proof target, issue/PR coverage, and included/excluded downstream consumers.
- Check `https://github.com/The-Koi-Pond/De-Koi/issues/2#known-intentional-divergences` before classifying a legacy/De-Koi difference as a gap.
- Use De-Koi GitHub issue #2 as the durable tracker. Treat Pasta-Devs/Marinara-Engine#1904 and old `scratch/parity/*` files as historical migration inputs only.
- In `report-only`, do not post comments, edit issues, file follow-ups, update tracker rows, modify code, or create/update parity tracker state.
- Do not open issues, update PRs, edit scratch notes, or modify code unless the user asks for that next step or standing instructions require it for an out-of-scope actionable finding.
