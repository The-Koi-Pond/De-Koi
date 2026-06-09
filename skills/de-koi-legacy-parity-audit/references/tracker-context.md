# Parity Tracker Context

This is durable context from #1904. Fetch #1904 for current statuses, report
links, blocker state, comments, and live follow-up issue state before tracker
updates or full status refreshes.

## Tracker Rules

- #1904 is the public index for target order, target status, status vocabulary, report links, and follow-up state.
- A checked target row means a report exists; it does not mean the target is `on_par`.
- Target detail issues own per-target scope, surface inventory, coverage matrix, proof, residual risk, and rescan criteria.
- Published detail issues: target 1 is #2011, target 2 is #2028, target 3 is #2050.
- Targets 4-21 may have prepared unpublished draft cards. Do not publish, convert, or update drafts unless explicitly requested.
- Old `scratch/parity/README.md`, `scratch/parity/INDEX.md`, and `scratch/parity/targets/*.md` files are migration inputs only. GitHub issues and comments supersede them.

## Tracker Operations

- Use #1904 for current report links, blocker state, live status, and index rows.
- Use target detail issues when they exist instead of local `scratch/parity/targets/<target>.md` records.
- If no target detail issue exists and tracker updates are requested, post the parityscan report to #1904 and ask before opening or publishing a new target detail issue.
- In `report-only` mode, read tracker rows as leads but do not load or edit full issue bodies unless the named row cannot be understood without them.
- Do not post comments, edit bodies, file follow-ups, or update tracker rows in `report-only`.
- For requested tracker edits, prefer the narrowest durable change: append a short dated section, update only affected matrix rows, or file one follow-up with minimal issue context plus linked evidence.
- Do not rewrite the full tracker for a row-only result.

Useful commands:

```powershell
gh issue view <number> --repo Pasta-Devs/Marinara-Engine --json number,title,body,url
gh issue view 1904 --repo Pasta-Devs/Marinara-Engine --json body --jq ".body" | Select-String -Pattern "<row id>|<target>" -Context 2,4
```

## Status Vocabulary

- `not_started`: no report exists yet.
- `in_progress`: active scan, not reported.
- `reported`: report posted, parity not necessarily proven.
- `needs_rescan`: old scan exists but current refactor or landed fixes made it stale.
- `on_par`: fresh scan found no blocking gaps after relevant fixes landed.
- `gaps_open`: at least one blocker or related parity issue remains open.
- `fixed_needs_rescan`: known blockers are closed, but no focused current-refactor rescan confirmed parity.
- `intentional_divergence`: difference is documented and accepted.
- `unknown`: evidence is too weak to classify.

Proof levels: `report_only`, `static_trace`, `focused_test`, `native_tauri`,
and `manual_qa`. Coverage-row statuses such as `covered_static`,
`refactor_better`, and `intentional_divergence` do not upgrade a whole target to
`on_par`.

## Target Order

1. Contracts and schemas
2. Storage and data access
3. Remote runtime parity
4. Media and assets
5. Characters
6. Personas
7. Lorebooks
8. Presets and prompt settings
9. Chats and messages
10. Connections and provider config
11. Provider transport
12. Prompt assembly
13. Agents, tools, regex, and knowledge
14. Shared chat UI
15. Conversation mode
16. Roleplay mode
17. Game mode
18. Game assets
19. Tracker, world state, and visuals
20. Import, export, and backup
21. Shell and integrations

## Sequencing Rules

- Run foundation scans before mode scans: contracts, storage, remote runtime, then media.
- Keep catalog resource scans separate so runtime and mode scans can consume them as prior evidence.
- Keep shared chat UI separate from conversation, roleplay, and game behavior.
- Treat remote-vs-embedded behavior as a cross-cutting target, not an afterthought in each feature scan.
- When a scan finds a concrete regression or missing behavior, draft or open a narrower follow-up issue only when requested, and link it back to #1904.
- If all known blockers are closed, use `fixed_needs_rescan` until a fresh scan on current `refactor` confirms `on_par`.

## Status Refresh Shape

For tracker refreshes:

1. Fetch #1904 body and comments.
2. Fetch published target detail issues.
3. Fetch prepared draft cards only when available and explicitly in scope.
4. Fetch every linked follow-up issue state.
5. Update target follow-up state from live issue state.
6. Use `fixed_needs_rescan` when blockers are closed but no fresh scan confirms parity.
7. Use `on_par` only after a fresh scan on current `refactor`.
