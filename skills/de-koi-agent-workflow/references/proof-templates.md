# De-Koi Proof Template Index

Use these templates only when they add clarity. Tiny tasks do not need ceremony.

## Pack-Derived Templates

- `templates/bugfix-verification.template.json`: structured bugfix proof ledger for risky fixes, UI regressions with screenshots, or PR-affecting bugs.
- `templates/risk-claim-matrix.template.json`: claim-boundary proof rows for storage, import/export, user data, prompt/provider/parser, auth/secrets, destructive actions, compatibility, and new abstractions.
- `templates/reviewer-thread-ledger.template.json`: PR inline review or automated review thread tracking.
- `templates/pr-proof-block.md`: PR proof block for the final PR body or ready-for-review update.
- `templates/status-snippets.md`: compact status, verdict, PR, debt, and mud-risk report shapes.

## De-Koi Manual Verification

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

Use `Debt: none` when no known debt remains. Otherwise classify as `deliberate-prudent`, `inadvertent-prudent`, `deliberate-reckless`, or `inadvertent-reckless` and name the follow-up.

Use `Mud risk: none` when the change keeps ownership clear. Otherwise classify as `throwaway-code-survived`, `piecemeal-growth`, `keep-it-working-pressure`, `shearing-layer-drift`, `swept-under-rug`, or `reconstruction-needed` and name containment.

## Repo Automation

- Canonical proof-health script: `.agents/automation/scripts/proof-health.mjs`
- Canonical automation-ledger script: `.agents/automation/scripts/automation-ledger.mjs`
- Canonical risk classifier: `.agents/automation/scripts/risk-classifier.mjs`
- PR health helper: `.agents/automation/scripts/pr-health.mjs`
- Workflow health helper: `.agents/automation/scripts/workflow-health.mjs`
- Root fixture entrypoint: `pnpm check:agent-workflow`

## Maintainer Self-Review

Ask before saying done:

- Does the implementation match the actual user problem?
- Does proof demonstrate the real claim?
- What user path did proof fail to prove?
- What adjacent legacy or default path could contradict the claim?
- Did the diff preserve De-Koi's owner modules and dependency direction?
- Did the diff add bloat, repeated conditionals, shotgun surgery, disposable code, or coupling?
- Are docs, skills, or repo-defined release notes needed for the durable decision?
