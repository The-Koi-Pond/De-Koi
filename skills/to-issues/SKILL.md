---
name: to-issues
description: "Break De-Koi plans, PRDs, parity targets, or feature ideas into independently verifiable GitHub issues using vertical slices. Use when the user asks to create implementation tickets, split a plan into issues, prepare ready-for-implementation work, or turn a broad feature into issue-sized slices."
---

# To Issues

Use this skill to turn a plan into small De-Koi issues. Draft first unless the user clearly authorized posting.

## Load First

- `skills/de-koi-agent-workflow/references/workflows/issue-submission.md`
- `.github/ISSUE_TEMPLATE/issue_report.md` or `.github/ISSUE_TEMPLATE/feature_request.md`, matching the request
- `skills/de-koi-architecture-guard/SKILL.md` when slices cross owners, shared APIs, Rust, storage, import/export, providers, or runtime boundaries

## Process

1. Gather the source plan, issue, PRD, screenshot facts, or parity row.
2. Inspect enough code to understand current owners and existing coverage.
3. Split into vertical slices, not layer-only tasks.
4. Mark each slice as `Ready` or `Needs decision`.
5. Show the breakdown and ask for approval before creating issues unless posting was already authorized.
6. Publish with `gh issue create` only after approval, using live templates and labels.

## Vertical Slice Rules

Each slice should:

- deliver one demoable or verifiable behavior
- cross necessary layers end to end, such as UI, shared API, engine, Rust, storage, and proof
- have a clear owner and proof target
- avoid broad cleanup mixed with behavior
- be small enough for one focused implementation pass

Prefer several thin slices over one large mixed issue. Keep dependency order explicit.

## Issue Draft Shape

```markdown
## Parent

<source issue or plan, if any>

## What to build

<end-to-end behavior, not a layer-by-layer task list>

## Acceptance criteria

- [ ] <observable criterion>
- [ ] <proof or validation criterion>

## Blocked by

<issue link or "None">
```

Avoid stale file-path inventories in public issue bodies. Name stable owners and contracts instead. Do not add AI/tool self-attribution or disclaimers.
