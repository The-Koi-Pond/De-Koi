# Parityscan Mode Routing

Use the cheapest mode that can prove the user's claim. Escalate only when a concrete risk or evidence gap requires it.

## Modes

- `full`: broad audit across the target surface, tracker context, classification, and full report.
- `static-trace`: code and artifact evidence only. Do not run browser, Tauri, or runtime proof unless the gap depends on runtime behavior.
- `row-only`: inspect exact tracker rows, issue bullets, commands, or symbols named by the user. Do not refresh the broader target.
- `follow-up`: reuse already-loaded tracker/context when the user says continue, follow-up, same target, or gives nearby row IDs. If prior context is missing after compaction or a new session, reload only the named issue row, prior final summary, or exact linked evidence.
- `report-only`: produce findings and next actions only. Read tracker rows as leads, but do not edit, comment on, file, or update GitHub issues/PRs unless the user explicitly asks for that write.

## Default Selection

| User shape | Default mode |
| --- | --- |
| Exact tracker row, issue bullet, symbol, command, or file | `row-only` + `static-trace` + `report-only` |
| "Continue", "follow-up", "same target", or nearby row IDs | `follow-up` + `static-trace` unless runtime proof is requested |
| Current refactor bug/risk with legacy only as context | `static-trace`; legacy lookup is optional until parity classification depends on it |
| Broad target, target refresh, issue update, PR support, or unclear/risky scope | `full` |

User wording can set the mode directly, for example:

```text
parityscan target rows X/Y only. Static trace only. Use #2106 as context lead.
No browser proof. If gap found, final concise, no tracker refresh.
```

If the user says `skip workflow docs; follow-up scan`, do not reload workflow cards already covered by active context unless the work becomes nontrivial, issue/PR-facing, code-editing, risky, or ambiguous. Still obey repo/team rules that require `AGENTS.md`.

## Escalation Triggers

Escalate out of row-only/follow-up when:

- Evidence crosses storage, import/export, prompt assembly, provider transport, hostability, user data, destructive action, or security boundaries.
- Static evidence cannot distinguish a real gap from dead code, disabled UI, migration behavior, or runtime-only behavior.
- The row depends on target status, proof level, linked follow-up issue state, or #1904 tracker wording not present in the prompt.
- The user asks for a tracker refresh, issue update, PR support, fix, or ready-for-review handoff.
