---
name: to-prd
description: "Turn De-Koi conversation context, feature ideas, or investigation results into a PRD-style GitHub issue draft with implementation and testing decisions. Use when the user asks for a PRD, product requirements, feature spec, or issue-ready requirements from current context."
---

# To PRD

Use this skill to synthesize what is already known. Do not run a broad interview unless a missing fact would make the PRD misleading or risky.

## Load First

- `.github/ISSUE_TEMPLATE/feature_request.md`
- `PRODUCT.md` and `DESIGN.md` when product or UI behavior matters
- `skills/de-koi-agent-workflow/references/workflows/issue-submission.md`
- `skills/de-koi-architecture-guard/SKILL.md` for owner, API, Rust, storage, import/export, provider, or runtime implications

## Process

1. Restate the user problem from the user's perspective.
2. Inspect the current repo enough to name existing owners, gaps, and likely seams.
3. Choose the highest stable test/proof seam for the feature.
4. Confirm seam assumptions with the user when they change implementation risk.
5. Draft the PRD as exact issue text.
6. Post only when the user authorizes issue creation.

## PRD Shape

```markdown
## Problem statement

<problem from the user's perspective>

## Solution

<user-visible solution>

## User stories

1. As a <actor>, I want <capability>, so that <benefit>.

## Implementation decisions

- <owner/module/contract decision>

## Testing decisions

- <public seam and proof strategy>

## Out of scope

- <explicit exclusions>

## Further notes

<risks, dependencies, or open questions>
```

Keep implementation decisions stable: name owners, contracts, and invariants more than transient file paths. If a prototype produced a decision-rich reducer, schema, or state shape, include only the trimmed decision, not the whole prototype.
