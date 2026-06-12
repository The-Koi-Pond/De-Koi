# Automation Ledger

The automation ledger is the machine-readable source of truth for automated Marinara work. Use it for bug fixes, feature builds, issue triage, reviews, PR iteration, and shipping whenever the task has multiple steps or an external outcome.

The ledger lives under `scratch/` and should not be committed unless chai explicitly asks for verification artifacts in a PR. Prefer task-specific names such as:

- `scratch/bugfix-verification.json` for auto-bugfix PRs.
- `scratch/feature-<short-slug>-ledger.json` for feature builds.
- `scratch/triage-<date>-ledger.json` for issue batches.
- `scratch/pr-<number>-iteration-ledger.json` for review feedback rounds.

## Required Shape

```json
{
  "schemaVersion": 1,
  "task": {
    "type": "bugfix",
    "title": "",
    "source": "",
    "classification": "",
    "status": "in_progress"
  },
  "run": {
    "startedAt": "",
    "finishedAt": "",
    "elapsedMinutes": null,
    "reasoningEffort": "",
    "budget": "",
    "costNotes": ""
  },
  "trace": [],
  "coreClaim": "",
  "rootCause": "",
  "scope": {
    "intendedFiles": [],
    "touchedFiles": [],
    "riskFlags": [],
    "hardStops": []
  },
  "evidence": {
    "reproduction": [],
    "verification": [],
    "visualProof": [],
    "commands": [],
    "browserRecipes": []
  },
  "verification": {
    "originalReproPassed": false,
    "focusedReproPassed": false,
    "baselinePassed": false,
    "baselineCommand": "matching validation command",
    "baselineEvidence": "",
    "githubValidationPassed": false,
    "reviewIterationFastPath": false
  },
  "checks": {
    "baselineCommand": "matching validation command",
    "baselineStatus": "not_run",
    "versionCheckStatus": "not_applicable",
    "dbPushStatus": "not_applicable",
    "ciStatus": "not_applicable",
    "bunnyReviewStatus": "not_applicable",
    "prHealthStatus": "not_applicable"
  },
  "manualBlockers": [],
  "claimBoundary": {
    "coreClaim": "",
    "riskType": "",
    "entrypoints": [],
    "currentPathsOrFormats": [],
    "legacyPathsOrFormats": [],
    "outOfScopeClaims": []
  },
  "contractLaneGate": {
    "brokenContract": "",
    "producer": "",
    "consumer": "",
    "impliedContract": "",
    "actualEnforcement": "",
    "primaryOwnerLane": "",
    "primaryOwnerDetail": "",
    "consumerOnlyLanes": [],
    "wrongLaneFixToAvoid": "",
    "regressionProof": []
  },
  "proofRows": {
    "positiveRows": [],
    "contradictionRows": [],
    "legacyDefaultRows": [],
    "untestedRows": []
  },
  "ownedFacts": [],
  "userActionCopy": [],
  "reviewThreadLedger": [],
  "externalActions": [],
  "pr": {
    "number": null,
    "url": "",
    "headRefName": "",
    "baseRefName": "",
    "healthStatus": "not_applicable",
    "bunnyReviewStatus": "not_applicable",
    "checksStatus": "not_applicable",
    "merged": false,
    "mergeCommit": ""
  },
  "finalGate": {
    "coreClaimProven": false,
    "visualProofPresent": false,
    "visualProofRequired": null,
    "diffFocused": false,
    "noUnapprovedExternalText": true,
    "readyToReportDone": false
  },
  "finalDoneGate": {
    "bugfixComplete": false,
    "prClean": false,
    "bunnyReviewClean": false,
    "requiredChecksPassed": false,
    "readyOrMerged": false,
    "noBlockingManualVerification": false,
    "reportOnlyWhenComplete": true
  },
  "notes": []
}
```

## Status Values

Use these exact values when possible:

- `not_run`
- `passed`
- `failed`
- `blocked`
- `not_applicable`
- `pending`

Task `status` should be one of:

- `in_progress`
- `blocked`
- `verified`
- `waiting_on_ci`
- `needs_review_feedback`
- `complete`

## Run Metadata And Trace

Use the helper commands to record agentic workflow observability without making
chat history carry the audit trail:

```bash
node .agents/automation/scripts/automation-ledger.mjs start scratch/bugfix-verification.json run.reasoningEffort=adaptive-high run.budget="focused local fix"
node .agents/automation/scripts/automation-ledger.mjs event scratch/bugfix-verification.json phase=reproduce action="scratch harness repro" outcome=failed evidence=scratch/before.txt
node .agents/automation/scripts/automation-ledger.mjs finish scratch/bugfix-verification.json status=complete
```

Trace events should be short records of decisions, commands, evidence, blockers,
and external actions. Cost fields are intentionally lightweight: record elapsed
time, reasoning tier, budget, and any LinkAPI/Mo/token notes available from an
external source.

## Core Claim And Proof

For bugfixes, `coreClaim` is the one-sentence behavior claim that must be proven before the work is called done. Example:

```json
"coreClaim": "TTS diagnostics now surface provider initialization errors instead of reporting a generic unavailable state."
```

Use `verification.originalReproPassed=true` after the original reproduction passes against the fixed code. Use `verification.focusedReproPassed=true` for any narrower scratch, targeted, jsdom/component, route/module, or Playwright harness that directly exercises the bug. Use `verification.baselinePassed=true` only when the baseline command named in `verification.baselineCommand` has passed locally. The baseline command should be the root `AGENTS.md` matching validation command for the changed lane; full `pnpm check` is for PR boundaries, risky changes, cross-lane changes, or when narrow proof does not cover the claim.

The only exception is `verification.reviewIterationFastPath=true`: after the initial bugfix already ran matching local validation, a tiny Bunny Review/human follow-up that only changes convention, copy, or a narrow implementation detail may skip another full local validation run if the focused repro still passes and GitHub validation for the current head passes. Record that with `githubValidationPassed=true` and cite the check name in `baselineEvidence`. Do not use this fast path for the initial fix, dependency/schema/version/auth/storage/prompt-pipeline changes, or any follow-up that changes the core behavior.

`pr` mirrors the ship-it health checker output. Fill it only inside explicit shipping or PR iteration work, and keep it current after opening a draft PR, after every push, after Bunny Review, after marking ready, and after an approved merge.

## Claim-Proof Quality

Risky work must prove the claim boundary, not only green checks. Risky means the task touches or claims behavior around installers, upgrades, legacy data, storage, migrations, import/export, destructive actions, compatibility, prompt assembly, release/version/dependency files, or cross-entrypoint behavior.

Use:

```bash
node .agents/automation/scripts/proof-health.mjs <ledger>
```

For risky work, record:

- `claimBoundary`: the exact claim, risk type, affected entrypoints, current paths/formats, legacy paths/formats, and out-of-scope claims.
- `contractLaneGate`: the broken contract, producer, consumer, implied contract, current enforcement, owner lane, consumer-only lanes, wrong-lane fix to avoid, and regression proof. Use `cross-boundary` only with a named primary owner. For `src-tauri`, prove Rust owns the privileged/native mechanics rather than product meaning.
- `proofRows`: positive rows, contradiction/negative rows, legacy/default rows, and any untested rows.
- `ownedFacts`: app/installer-owned facts with `sourceType` set to `measured`, `derived`, `artifact-derived`, or `harness-proven`, plus evidence.
- `userActionCopy`: exact copy/backup/destructive-action instructions, including source, destination, files/folders, companion files, and detected layouts where relevant.
- `reviewThreadLedger`: each actionable reviewer finding with disposition, fix/defer/pushback, evidence or commit, reply status, and whether human resolution remains.

The proof-health gate blocks risky ledgers that make unbounded, ungrounded, happy-path-only shipping claims.

## Architecture And Code Smell Risk

For nontrivial bugfixes, features, and refactors, record structural risk in the
existing ledger fields instead of adding a new schema. Use:

- `scope.riskFlags` for smell groups such as `bloater`, `oo-abuser`,
  `change-preventer`, `dispensable`, and `coupler`.
- `claimBoundary.outOfScopeClaims` for smell-adjacent work intentionally left
  out of the change, such as a broader large-file split.
- `notes` for the owner subsystem, known-large-file "why here?" rationale,
  extension-point check, and change map.
- `trace` for critic outcomes, including whether a smell was fixed, blocking,
  deferred as a review note, or outside the approved scope.

Smell risk blocks readiness when it directly threatens correctness,
maintainability, proof, or reviewability: substantial new orchestration in a
known giant file, repeated conditionals across files, partial multi-layer
updates, duplicate behavior, dead code, speculative layers, or new cross-mode
intimacy. Tiny, isolated, intentionally contained smells can be recorded as
review notes.

## Manual Blockers

Only record a manual blocker when the task genuinely depends on something this workspace cannot access. Good blockers name the missing dependency and whether it blocks the core claim:

```json
{
  "description": "Termux install behavior requires an Android/Termux device.",
  "blockingCoreClaim": true,
  "verifiedInstead": "Checked the generated install command and matching validation locally."
}
```

Do not use manual blockers for things the agent can test with a local dev server, browser automation, a scratch harness, or a command.

## Done Gate

Before saying automated work is done, the ledger must show:

- `finalGate.coreClaimProven=true`, unless a blocking manual blocker is explicitly recorded.
- `finalGate.visualProofPresent=true` for UI/runtime tasks, or a blocker explaining why visual proof cannot exist.
  - Set `finalGate.visualProofRequired=false` only for non-UI backend/build/config changes.
  - Leave `finalGate.visualProofRequired=null` when the automation script should infer it from task classification, risk flags, and browser recipes.
- `checks.baselineStatus=passed`, unless the failure is documented as unrelated/pre-existing and the work stays draft.
- `finalGate.diffFocused=true`.
- `finalGate.noUnapprovedExternalText=true`.
- `finalGate.readyToReportDone=true`.
- For local bugfixes, `finalDoneGate.bugfixComplete=true` means local proof, matching validation, and maintainer-equivalent self-review are complete.
- For shipped bugfix PRs, `prClean=true`, `bunnyReviewClean=true`, `requiredChecksPassed=true`, and `noBlockingManualVerification=true` are required before PR completion.
- Merges are never implied by ordinary bugfix language. If the user explicitly approved a merge and the PR is clean, `finalDoneGate.readyOrMerged=true` should mean the PR is either ready or already merged. Record the merge under `pr.merged` and `pr.mergeCommit`.

If any required field is missing, report `not complete yet` and name the blocker.
