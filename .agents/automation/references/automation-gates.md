# Automation Gates

Use this reference when deciding what an agent may do autonomously and where it must stop.

## Rule Precedence

1. Team repo rules in `AGENTS.md` and `CONTRIBUTING.md`.
2. chai's personal Codex notes.
3. Task skill rules.
4. This automation support reference.

When rules overlap, the stricter safety gate wins unless a task-specific autopilot exception explicitly allows the action.

## Default Local-Fix Trigger

For Marinara workflow users, ordinary bug-fix language is enough to activate the
local bugfix path when the selected bug is narrow and machine-provable. Treat all
of these as standing approval for local fix and verification only: "fix this
bug", "fix this", "go", "look for the smallest bug and fix it", a pasted bug
screenshot with minimal text, or any equivalent request.

Do not commit, push to `origin`, open the initial draft PR, wait on
Bunny Review, poll checks, mark the PR ready, or merge unless
the user explicitly asks to ship, push, open a PR, mark ready, or merge. Those
actions are shipping lane work, not default local-fix work. Still stop for the
hard stops listed below.

For these gates, Bunny Review means the trusted GitHub workflow/status provided
by `.github/bunny-review/`. A personal Bunny skill can help prepare or interpret
the review, but it is not required for the repo-shared automation contract.

## Autonomy Table

| Action | Default | Autopilot exception | Hard stop |
|---|---|---|---|
| Read files, search code, inspect diffs | Allowed | Allowed | Stop only for inaccessible files needed for the task |
| Start local dev server | Allowed when needed | Allowed | Stop if dependencies/config are missing and install would change declarations |
| Use Playwright/browser-use on localhost | Pre-approved only when browser state is the claim; use cheaper proof first | Same | Stop only if browser tooling is required and unavailable after trying the configured fallback |
| Create scratch repro/proof files | Allowed | Allowed | Keep under `scratch/` unless explicitly requested |
| Publish UI proof for PR reviewers | Shipping action; ask or require explicit ship request | Required only inside explicit shipping flow | Stop if screenshots are not from the real app UI, are only local `scratch/` paths, or are only linked as text paths; upload/attach scoped evidence and embed the images inline in the PR body. Do not commit temporary proof screenshots under `docs/pr-evidence/` |
| Edit production code | Allowed for requested bug/feature | Allowed for small verified bugfixes | Stop if scope expands, schema/version/dependency/auth/storage/prompt assembly changes appear |
| Run validation | Run the root `AGENTS.md` matching command for the changed lane | Full `pnpm check` only at PR boundary, risky, or cross-lane changes | Stop/report if failure is new or in-scope |
| Run PR health gate | Required before claiming a PR is ready/safe | Required before ready/merge recommendation | Stop on failed checks, pending checks, unresolved review threads, stale evidence paths, or checked checkboxes without matching proof |
| Commit | Ask first unless shipping was explicitly requested | Allowed only inside explicit shipping flow | Stop on unrelated dirty files or unclear branch base |
| Push | Ask first unless shipping was explicitly requested | Allowed only to `origin` inside explicit shipping flow | Never push to `official-upstream`; never force-push without explicit approval |
| Open PR | Draft only, after exact-text approval unless user explicitly requested PR creation | Initial draft PR title/body may be prepared only inside explicit shipping flow | Stop if PR body would omit proof, cite only local screenshot paths for UI evidence, or include unrelated files |
| Mark PR ready | Ask after human/manual verification unless explicitly authorized | Allowed only when the shipping request includes ready marking and health is clean | Stop if CI/Bunny Review/manual blocker remains |
| Post issue/PR comments | Exact-text approval required | Bunny Review status updates are handled by the trusted workflow | Never post arbitrary external replies without approval |
| Merge PR | Ask first | No ordinary bugfix-language exception | Never merge broad/risky PRs, PRs opened by others, PRs with failed/pending checks, force-push requirements, unresolved actionable threads, or unproven core claims |

## Batch Automation

For issue queues or repeated automation:

1. Work one issue/PR at a time unless chai explicitly asks for parallel triage.
2. Preflight for duplicate PRs, linked fixes, local branches, and dirty worktrees before editing.
3. Record each candidate in a batch ledger with `selected`, `skipped`, `blocked`, or `completed`.
4. Stop the batch on the first unexpected dirty tree, failed baseline check, merge conflict, missing credentials, or scope expansion.
5. Summarize what was completed and what remains; do not silently continue into unrelated fixes.

## PR Health Gate

Run this before saying a PR is ready, safe to merge, or clean after review feedback:

```bash
node .agents/automation/scripts/pr-health.mjs <pr-number>
```

The gate must pass before automated work can be called complete. It checks:

- mergeability is `MERGEABLE` and merge state is `CLEAN`
- no failed or pending checks
- Bunny Review status is `SUCCESS`
- no unresolved, non-outdated review threads
- any checked checklist item is backed by concrete proof in the PR body; agent-authored PRs should leave human validation checkboxes unchecked
- PR body does not cite local `scratch/` evidence paths
- UI/runtime PRs embed real app screenshots/recordings inline, using uploaded GitHub/gist evidence URLs

For risky work, include the scratch ledger so the PR health gate also checks
claim-proof quality. Risky PRs without a ledger are not ready; `pr-health` must
return a missing-ledger blocker instead of treating green CI as enough:

```bash
node .agents/automation/scripts/pr-health.mjs <pr-number> --ledger scratch/bugfix-verification.json
```

This keeps green CI and stale/outdated review threads from being confused with
a proven claim. Proof health must pass when the PR touches installers, upgrades,
legacy data, storage, migrations, import/export, destructive actions,
compatibility, prompt assembly, release/version/dependency files, or
cross-entrypoint behavior.

If the ledger or diff records code-smell risk, readiness also requires a critic
disposition. Blocking smells must be fixed or converted into an explicit manual
blocker/out-of-scope decision before the PR is called ready. Review-note smells
must be small, isolated, and not on the core behavior path.

If GitHub still reports `reviewDecision: CHANGES_REQUESTED`, readiness requires a
clean proof-health ledger with reviewer-thread dispositions. When active threads
are resolved/outdated and the ledger records concrete dispositions, treat the
stale review decision as a warning. Without those dispositions, it remains a
ready blocker.

For a merge-ready autopilot PR, run the gate immediately before merge and again
after merge if GitHub still shows a transitional state. Record the merge SHA in
the ledger. If the merge command fails for anything other than a transient
GitHub state, report the blocker instead of retrying different merge strategies.

## Code Smell Gate

Use this gate during intake and the final critic pass for nontrivial coding:

- `Bloaters`: touching a known large owner from `AGENTS.md`, `docs/developer/architecture.html`, `docs/developer/impact-areas.html`, or the repo architecture skills
  needs a "why here?" rationale. Prefer leaf helpers, hooks, services,
  extracted components, or narrower owners.
- `Object-Orientation Abusers`: name the extension point. Repeated `mode`,
  `type`, provider, entity, or UI conditionals across files are a planning
  blocker.
- `Change Preventers`: if the change touches 4+ surfaces or crosses
  client/server/shared/docs, record a change map before editing and verify all
  mapped surfaces afterward.
- `Dispensables`: block duplicate behavior, dead code, speculative wrappers,
  TODO-only fixes, or comments that hide unclear code.
- `Couplers`: block new cross-mode or cross-layer intimacy unless a shared
  primitive/contract is extracted or the boundary crossing is explicitly
  approved.

A smell is blocking when it threatens correctness, maintainability, proof, or
reviewability. It is a review note only when it is tiny, isolated, follows an
established local pattern, and is not on the core path.

## Review-Iteration Fast Path

The initial fix must run the matching local validation command for the changed
lane, with full `pnpm check` reserved for PR boundaries, risky changes, or
cross-lane changes. After that, a tiny post-review convention fix may skip a
second full local validation run only when all of
these are true:

- The original bugfix already had the relevant validation command pass locally.
- The follow-up does not change the core claim or broaden scope.
- The focused repro still passes after the follow-up.
- GitHub validation passes on the current head.
- The ledger records `verification.reviewIterationFastPath=true` and names the GitHub check in `verification.baselineEvidence`.

Do not use this shortcut for dependency, schema, version, auth, storage, prompt
pipeline, release, or cross-cutting refactor changes.

## PR Body Churn Rule

Build one complete PR-body update from the template, proof pack, validation
notes, published evidence links, docs/release impact, Bunny Review status, and CI
status before posting it. Avoid repeated cosmetic edits that restart Auto-label,
Bunny Review, or other checks. After a follow-up commit, batch all status/proof
changes into one update, then start the wait loop.

## Waiting Ownership

When an explicit shipping action starts or restarts GitHub work, such as opening a PR,
pushing a commit, waiting on Bunny Review, marking ready, or editing the
PR body, the assistant owns the wait loop. Do not report back with only
"checks are running" while routine CI or Bunny Review work is still in progress.
Start polling automatically and continue until the PR reaches a terminal state:

- `clean`: report completion.
- `needs-review-work`: address clear in-scope feedback or report the blocker.
- `failed-checks`: report the failed check and stop.
- `merge-conflict`: report the conflict and stop.
- `needs-true-manual-verification`: report the exact missing human-only proof.

Only report `waiting-on-ci` after the normal wait budget is exhausted or the
session/tooling cannot continue polling. The user should not need to type
"okay" just to make the assistant wait for routine GitHub checks.

## Browser Permission Rule

For Marinara Engine work, local browser verification is not an approval question
when browser state is the claim. Use a proof ladder first: static inspection,
targeted tests, scratch harnesses, route/module repros, and jsdom/component proof
before Playwright/browser-use. Use Playwright or browser-use directly only when
the task genuinely needs UI reproduction, visual/layout proof, browser-only
interaction behavior, screenshots, console/network inspection, or a localhost/file
proof page.

Do not ask "should I open Playwright?" or "do you want me to verify this in the browser?" after chai has asked for the work. Ask only when the browser step would require a non-local external site, credentials, hardware, or user-owned data that is not available in this workspace.

Browser permission is separate from runtime fidelity. Name the runtime in every
UI/runtime proof: `Chrome web shell`, `Chrome + Remote Runtime`, `Tauri dev app`,
or `scratch/backend harness`. Chrome web-shell proof can prove React/UI-only
behavior, but runtime-backed claims need the Tauri app, a backend harness, or a
remote-supported command path.

Do not interrupt chai's desktop by opening visible browser windows by default.
Use headless scripted Playwright with an isolated profile/temp directory first.
Visible/in-app browser automation is a fallback for cases that genuinely need
human-visible inspection, fail only in headful mode, or were explicitly requested
by chai.

Do not turn local browser verification into a sequence of user permission prompts. If browser-use/Playwright MCP would require permission for every click, navigation, upload, or screenshot, switch to a scripted Playwright proof run instead. The preferred default is a repo-local script under `scratch/` or an equivalent one-shot Playwright run that opens only localhost/file URLs in headless mode, performs the complete repro or verification flow, captures real screenshots, and exits with a clear pass/fail result.

If Playwright MCP reports that the browser is already in use or the profile is locked, treat that as stale-session cleanup or a fallback trigger, not as missing permission. First try to close/recover the stale MCP browser. If that fails, use an isolated browser context, separate user-data-dir, or headless Chrome/Edge proof harness. Do not ask chai for Playwright permission and do not mark browser verification blocked until those local recovery paths fail.

## Feature Intake Gate

Before building a feature, classify it with the same thinking as feature-creep triage:

- `normal-scope`: build through the small/medium/big feature workflow.
- `scope-risk`: plan, split, or ask for the product decision before implementation.
- `feature-creep`: do not build without explicit maintainer decision.

This classification does not require applying GitHub labels unless the task is issue triage or issue submission.
