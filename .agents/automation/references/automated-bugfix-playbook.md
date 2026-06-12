# Automated Bugfix Playbook

Use this playbook when a user asks for a local small bugfix, or when an explicit
shipping request asks the assistant to carry the work from report to verified PR.

In Marinara's repo workflow, ordinary bugfix language defaults to local fix and
verification only. A request like "fix this bug", "go", "look for the smallest
bug and fix it", or a pasted bug screenshot with little text is enough to run
the local portions of this playbook for a small, machine-provable bug. Commit,
push, draft PR, Bunny Review, CI polling, ready marking, and merge require an
explicit shipping request such as "ship it", "open a PR", "push this", or
"ready for review".

## 1. Intake and Classify

Classify before editing:

- `tiny-local`: narrow bug, clear repro, machine-provable, and no schema/version/dependency/auth/storage/import/export/prompt/provider/security-sensitive, browser-evidence-dependent, cross-boundary, or PR-affecting risk.
- `small-local`: narrow bug that still benefits from a ledger because evidence, touched files, or risk is broader than `tiny-local`.
- `ship-requested`: user explicitly asked to push, open a PR, or move a verified fix through PR health.
- `needs-plan`: medium or ambiguous bug, likely multi-system fix, unclear expected behavior, or broad UI surface.
- `hard-stop`: cannot reproduce, cannot verify, unrelated dirty tree would be shipped, merge conflict, missing credentials, force-push needed, or baseline check fails for an in-scope reason.

Before editing, name the cheap gate: core claim, likely owner/lane, risk level,
and proof target. Also name the main code-smell risk when the bug is not truly
tiny. Use Bloaters, Object-Orientation Abusers, Change Preventers,
Dispensables, or Couplers as shorthand; for ledger-backed work, record the
guardrail using `scope.riskFlags`, `notes`, or `trace`.

For `tiny-local` and `small-local`, stop after the local fix, focused
verification, matching validation command, and maintainer-equivalent
self-review. Do not commit, push, open a draft PR, wait on Bunny Review, poll CI,
mark ready, upload screenshots, or merge. For `ship-requested`, external-text
approval is granted only for the PR title/body when the user explicitly asked
for PR creation and the body is generated from the repo template, links the
issue when applicable, leaves validation checkboxes for the human contributor,
and honestly records proof and blockers in prose and evidence links. Arbitrary
reviewer replies, issue comments, force-push, dependency declaration change,
scope expansion, and merge still need an explicit user decision.

For `tiny-local`, do not initialize a full ledger by default. Use this compact
receipt in the final report:

```text
Claim: <one sentence behavior proven>
Proof: <repro or targeted proof command/result>
Validation: <matching repo command/result>
Files: <paths + tiny summaries>
Risk: <none or explicit untested path/manual blocker>
Vault: <No vault capture|Decision note|Knowledge note|Task note|Meeting note>
```

Initialize a ledger as soon as the work is `small-local`, `ship-requested`, or
no longer clearly tiny:

```bash
node .agents/automation/scripts/automation-ledger.mjs init scratch/bugfix-verification.json task.type=bugfix task.title="<issue title>" task.classification=small-local
node .agents/automation/scripts/automation-ledger.mjs start scratch/bugfix-verification.json run.reasoningEffort=adaptive-high run.budget="focused local fix"
```

Record the core claim before the fix:

```bash
node .agents/automation/scripts/automation-ledger.mjs set scratch/bugfix-verification.json coreClaim="<one sentence behavior that must be proven>"
```

After the ledger exists, use the fast-lane helper as the running guardrail:

```bash
node .agents/automation/scripts/bugfix-fast-lane.mjs assess scratch/bugfix-verification.json
```

The helper does not replace judgment and is not a reason to create a ledger for
every tiny bug. It catches slow-path triggers early:
schema/version/dependency/auth/storage/import/export/prompt/provider paths,
recorded hard stops, broad diffs, unrecorded changed files, and missing proof.
If it reports an eligibility blocker, exit autopilot and report the blocker
instead of trying to force a small bug through the fast lane.

## 2. Reproduce

Pick the smallest proof that exercises the broken path. First name the runtime
being proven: `Chrome web shell`, `Chrome + Remote Runtime`, `Tauri dev app`, or
`scratch/backend harness`.

- UI-only bug: use the cheapest proof that exercises the user-visible claim. Prefer static inspection, targeted unit/Vitest tests, scratch harnesses, route/module repros, or jsdom/component proof. Copy `.agents/automation/templates/ui-repro-playwright.mjs` into `scratch/` only when browser state is the claim: visual layout, interaction, routing, responsive behavior, screenshot-dependent evidence, or a bug that only reproduces in a real browser. Use visible browser automation only when the user asks to watch it or headless cannot reproduce/debug the issue.
- Runtime-backed bug: Chrome web-shell proof is not enough for storage, imports/exports, managed files/assets, providers, LLM streaming, haptics, native dialogs, updater behavior, app data paths, window controls, Tauri commands, or Rust-backed behavior. Use `pnpm tauri dev`, a focused Rust/TS backend harness, or `Chrome + Remote Runtime` only when the exact command path is remote-supported. Record any untested app-only path as a risk or manual blocker instead of calling it verified.
- Backend/logic bug: copy `.agents/automation/templates/backend-repro.mjs` into `scratch/` and customize the smallest module-level repro.
- Build/config bug: copy `.agents/automation/templates/command-repro.mjs` into `scratch/` or record the exact failing command directly.

Record reproduction evidence in the ledger before changing production code.

## 3. Fix

Keep the patch focused. Stop if the fix expands into schema, version, dependency, auth, storage, prompt assembly, or unrelated refactor work.

If the fix touches a known large owner from `AGENTS.md`, `docs/developer/architecture.html`,
`docs/developer/impact-areas.html`, or the repo architecture skills, record why
the change belongs there and keep the edit tiny unless Celia approved a refactor.
If the same `mode`, `type`, provider, or UI conditional starts spreading across
files, exit autopilot and plan a single owner/registry change.

Update the ledger with intended and touched files as soon as the write set is known.

## 4. Verify

Re-run the original repro first, then the matching validation command from root
`AGENTS.md`:

```bash
pnpm typecheck
# or pnpm build / pnpm check:architecture / pnpm check:docs /
# pnpm check:agent-workflow / cargo check --manifest-path src-tauri/Cargo.toml
```

Full local `pnpm check` is for PR boundaries, risky changes, cross-lane changes,
or cases where the narrow proof does not cover the claim. The time-saving fast
path applies only after the original fix already passed the relevant validation:
for a tiny Bunny Review or human convention follow-up, re-run the focused repro and
a relevant narrow command if one exists, then rely on GitHub validation before
merge. Record this as:

```bash
node .agents/automation/scripts/automation-ledger.mjs set scratch/bugfix-verification.json verification.reviewIterationFastPath=true verification.githubValidationPassed=true verification.baselineEvidence="GitHub pnpm-validate passed on current head after focused repro"
```

Do not use the review-iteration fast path for behavior changes, schema/version/
dependency/auth/storage/prompt-pipeline changes, broad refactors, or anything
that changes the core claim.

For UI/runtime fixes that require browser proof, record the browser recipe,
viewport, result, and screenshot paths. Screenshots must come from the real
running app and the actual affected UI state; proof pages, terminal-output
screenshots, and mockups are not UI evidence. Keep local captures under
`scratch/` during local fix work. Upload/attach proof screenshots to GitHub or a
gist only in an explicit shipping flow, record the published URLs, then embed
the images inline in the PR body:

```bash
node .agents/automation/scripts/publish-evidence.mjs --url https://github.com/user-attachments/assets/... --ledger scratch/bugfix-verification.json
```

For backend/build fixes with no meaningful app UI state, set `finalGate.visualProofRequired=false` instead of forcing fake UI screenshots. Command proof can support the PR, but it should not be labeled as UI evidence.

When verification is recorded in the ledger, generate the PR proof block instead
of hand-assembling it:

```bash
node .agents/automation/scripts/bugfix-fast-lane.mjs proof scratch/bugfix-verification.json --out scratch/bugfix-proof-pack.md
```

Use the generated block as source material for the PR template. Keep agent-run
proof in prose and evidence sections, leave validation checkboxes unchecked for
the human contributor, and record uploaded UI screenshot URLs with
`publish-evidence.mjs` before the PR body cites them.

For checklist items relevant to the change, add explicit notes in the PR body:

- `Not run: <reason>` when Codex did not run it.
- `Not applicable: <reason>` when the check does not apply to the bug class.
- `Covered by CI: <check name>` when GitHub automation, not local Codex work,
  supplies the proof.

Do not tick validation checkboxes on behalf of the human contributor. A
machine-proven backend fix should still show clear proof in prose so empty
checkboxes do not read like skipped procedure.

## 5. PR Gate

For `ship-requested`, the PR gate includes the shipping actions. Commit the
focused fix, push only to `origin`, open the initial PR as a draft, wait for
Bunny Review only when the current head is believed final and has not been
reviewed, poll CI, then mark the PR ready only when the user explicitly asked
for ready marking and `pr-health.mjs` is clean with no blocking manual
verification. Merging always requires an explicit merge request.

Batch PR body edits. Build the final body from the template, proof pack,
published evidence links, validation notes, and docs/release impact in one edit
before posting. After Bunny Review follow-up commits, update the PR body once with
all new proof/status changes instead of repeatedly touching it and restarting
Auto-label or other checks.

If any PR-affecting action restarts CI, Auto-label, Bunny Review, or another
routine GitHub check, keep polling automatically. Do not report back only to say
that a routine check is running unless the wait budget is exhausted or a real
blocker appears.

Before saying a PR is ready, safe to merge, or done after review feedback, run:

```bash
node .agents/automation/scripts/pr-health.mjs 123
```

The PR health gate must pass. If it fails, stop and report the blocker instead of continuing into unrelated fixes.

## 6. Final Done Gate

Validate the ledger:

```bash
node .agents/automation/scripts/automation-ledger.mjs validate scratch/bugfix-verification.json
```

Tiny local bugfix work is complete when the focused repro, matching validation
command, maintainer-equivalent self-review, and compact receipt are complete.
Ledger-backed local bugfix work is complete when the ledger done gate, focused
repro, matching validation command, and maintainer-equivalent self-review pass.
Shipped bugfix work is complete only when both the ledger done gate and PR
health gate pass, unless a documented manual blocker explicitly prevents one of
them.

If the clean PR was merged, record `pr.merged=true`, `pr.mergeCommit`, and
`finalDoneGate.readyOrMerged=true` before reporting completion.

## Warm Worktree Pattern

For repeated small bugfixes, keep a prepared worktree under `C:\tmp` or another
writable root with dependencies already installed. This saves the cold-start
install/build tax without weakening the proof requirements.

Safe use:

1. Confirm the worktree has no uncommitted changes and no in-progress branch.
2. Fetch `origin/main`.
3. Create or switch to a fresh issue branch based on current `origin/main`.
4. Reuse the existing `node_modules` only when `pnpm-lock.yaml` has not changed.
5. Run the same reproduction, focused verification, PR health, and baseline gates.

Hard stops:

- Unknown dirty files in the warm worktree.
- Lockfile changed since the cache was prepared.
- Branch cannot be proven to start from current `origin/main`.
- Any cleanup would require destructive reset/removal without explicit approval.
