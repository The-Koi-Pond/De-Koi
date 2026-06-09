# Parity Tracker Context

De-Koi tracker issue: https://github.com/The-Koi-Pond/De-Koi/issues/2

Historical upstream seed: https://github.com/Pasta-Devs/Marinara-Engine/issues/1904

Use De-Koi issue #2 as the live source of truth for target order, target
status, status vocabulary, report links, follow-up state, and accepted
intentional divergences. Pasta #1904 and its linked reports are historical
search leads only; do not copy their status forward as De-Koi proof.

## Tracker Rules

- Issue #2 is the public De-Koi index for target order, target status, status
  vocabulary, report links, follow-up state, and known intentional divergences.
- A checked target row means a De-Koi report exists; it does not mean the target
  is `on_par`.
- Target detail issues are optional. Use them when a target needs durable
  per-target scope, surface inventory, coverage matrix, proof, residual risk, or
  rescan criteria.
- Do not update Pasta #1904 for De-Koi work.
- Old `scratch/parity/README.md`, `scratch/parity/INDEX.md`, and
  `scratch/parity/targets/*.md` files are migration inputs only if they appear
  in a local checkout.

## Tracker Operations

- Use De-Koi issue #2 for current report links, blocker state, live status, and
  index rows.
- Use De-Koi target detail issues when they exist. If none exists, report to
  issue #2 unless the user asks for a new detail issue.
- In `report-only` mode, read tracker rows as leads but do not load or edit full
  issue bodies unless the named row cannot be understood without them.
- Do not post comments, edit bodies, file follow-ups, or update tracker rows in
  `report-only`.
- For requested tracker edits, prefer the narrowest durable change: append a
  short dated report comment, update only affected matrix rows, or file one
  follow-up with minimal issue context plus linked evidence.
- Do not rewrite the full tracker for a row-only result.

Useful commands:

```powershell
gh issue view 2 --repo The-Koi-Pond/De-Koi --json number,title,body,url
gh issue view 2 --repo The-Koi-Pond/De-Koi --json body --jq ".body" | Select-String -Pattern "<row id>|<target>|Known intentional divergences" -Context 2,4
gh issue view 1904 --repo Pasta-Devs/Marinara-Engine --json body,url
```

## Status Vocabulary

- `not_started`: no De-Koi report exists yet.
- `in_progress`: active scan, not reported.
- `reported`: report posted to issue #2 or a linked De-Koi detail issue.
- `needs_rescan`: old De-Koi scan exists, but current `main` or landed fixes
  changed enough to invalidate it.
- `on_par`: fresh scan found no blocking gaps after relevant fixes landed.
- `gaps_open`: at least one blocker or related De-Koi parity issue remains
  open.
- `fixed_needs_rescan`: known blockers are closed, but no focused current
  De-Koi rescan confirmed parity.
- `intentional_divergence`: difference is documented and accepted in issue #2.
- `unknown`: evidence is too weak to classify.

Proof levels: `report_only`, `static_trace`, `focused_test`, `native_tauri`,
and `manual_qa`. Coverage-row statuses such as `covered_static`,
`de_koi_better`, and `intentional_divergence` do not upgrade a whole target to
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

## Historical Seed Leads

These links are useful starting points for searches only. They do not prove
current De-Koi status:

- Contracts and schemas: Pasta #1904 comment 4599710600.
- Storage and data access: Pasta #1904 comments 4600505400 and 4602178505.
- Remote runtime parity: Pasta #1904 comment 4600978411.
- Media and assets: Pasta #1904 comment 4602089938.
- Characters: Pasta #1904 comment 4604507027.
- Personas: Pasta #1904 comment 4604674871.
- Lorebooks: Pasta #1904 comment 4605486948.
- Presets and prompt settings: Pasta #1904 comment 4608864275.
- Provider transport: Pasta #1904 referenced Pasta #2410 as an upstream pass.

## Sequencing Rules

- Run foundation scans before mode scans: contracts, storage, remote runtime,
  then media.
- Keep catalog resource scans separate so runtime and mode scans can consume
  them as prior evidence.
- Keep shared chat UI separate from conversation, roleplay, and game behavior.
- Treat remote-vs-embedded behavior as a cross-cutting target, not an
  afterthought in each feature scan.
- Check issue #2's `Known intentional divergences` section before classifying a
  legacy/De-Koi difference as a gap.
- When a scan finds a concrete regression or missing behavior, draft or open a
  narrower De-Koi follow-up issue only when requested, and link it back to issue
  #2.
- If all known blockers are closed, use `fixed_needs_rescan` until a fresh scan
  on current De-Koi `main` confirms `on_par`.

## Status Refresh Shape

For tracker refreshes:

1. Fetch issue #2 body and comments.
2. Fetch linked De-Koi detail issues and follow-up issue states.
3. Treat old Pasta tracker links as historical search leads only.
4. Update target follow-up state from live De-Koi issue state.
5. Use `fixed_needs_rescan` when blockers are closed but no fresh scan confirms
   parity.
6. Use `on_par` only after a fresh scan on current De-Koi `main`.
