# Marinara Proof Template Index

Use these templates only when they add clarity. Tiny tasks do not need ceremony.

## Pack-Derived Templates

- `templates/bugfix-verification.template.json`: structured bugfix proof ledger for risky fixes, UI regressions with screenshots, or PR-affecting bugs.
- `templates/contract-lane-gate.template.json`: contract ownership gate for risky boundary work.
- `templates/risk-claim-matrix.template.json`: claim-boundary proof rows for storage, import/export, user data, prompt/provider/parser, auth/secrets, destructive actions, compatibility, and new abstractions.
- `templates/reviewer-thread-ledger.template.json`: PR inline review or automated review thread tracking.
- `templates/pr-proof-block.md`: PR proof block for the final PR body or ready-for-review update.
- `templates/status-snippets.md`: compact status, verdict, PR, debt, and mud-risk report shapes.

## Repo Workflow Tools

- `.agents/automation/scripts/proof-health.mjs`: tracked proof-health gate for risky ledgers.
- `.agents/automation/scripts/automation-ledger.mjs`: tracked scratch-ledger helper that includes `contractLaneGate`.
- `.agents/automation/scripts/risk-classifier.mjs`: shared risk signals used by workflow health, PR health, and proof health.
- `.agents/automation/scripts/pr-health.mjs`: PR gate for mergeability, CI, Bunny Review, unresolved threads, evidence links, and risky proof ledgers.
- `.agents/automation/scripts/workflow-health.mjs`: read-only preflight for active PRs, stale workflow guidance, and concurrent work.
- `scripts/check-agent-workflow.mjs`: CI-friendly fixture check for the lane-gate proof behavior.

## Marinara Manual Verification

Use when machine checks cannot prove the full claim.

```text
Start command:
App path or route:
Action sequence:
Expected result:
Failure signal:
Unverified coverage:
```

Name unverified mode, provider, viewport, platform, data shape, or legacy path explicitly.

## Final Report

```text
Behavior changed:
Files/modules:
Impact area:
Dependent areas reviewed:
Verification:
Manual QA:
Risk:
Debt:
Mud risk:
```

## Contract Lane Gate

Use this for risky contract or boundary work before editing:

```text
Broken contract:
Producer:
Consumer:
Implied contract:
Actual enforcement:
Primary owner lane:
Primary owner detail:
Consumer-only lanes:
Wrong-lane fix to avoid:
Regression proof:
```

Canonical lanes are `src/engine`, `src/features`, `src/shared/api`, `src-tauri`, `docs/workflow`, and `cross-boundary`. If the owner is `cross-boundary`, still name the primary owning lane. If the owner is `src-tauri`, the wrong-lane note must show why Rust owns the privileged/native mechanics rather than product meaning.

Use `Debt: none` when no known debt remains. Otherwise classify as `deliberate-prudent`, `inadvertent-prudent`, `deliberate-reckless`, or `inadvertent-reckless` and name the follow-up.

Use `Mud risk: none` when the change keeps ownership clear. Otherwise classify as `throwaway-code-survived`, `piecemeal-growth`, `keep-it-working-pressure`, `shearing-layer-drift`, `swept-under-rug`, or `reconstruction-needed` and name containment.

## Maintainer Self-Review

Ask before saying done:

- Does the implementation match the actual user problem?
- Does proof demonstrate the real claim?
- What user path did proof fail to prove?
- What adjacent legacy or default path could contradict the claim?
- Did the diff preserve Marinara's owner modules and dependency direction?
- Did the diff add bloat, repeated conditionals, shotgun surgery, disposable code, or coupling?
- Are docs, skills, or repo-defined release notes needed for the durable decision?
