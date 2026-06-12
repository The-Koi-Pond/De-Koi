# De-Koi Automation Support

This folder contains repo-local support for assistant-side automation. It does not change De-Koi runtime behavior and does not require chai to use new command phrases.

Use these files when a task should be automated safely.

For De-Koi workflow users, a terse bug request such as "fix this bug",
"look for the smallest bug and fix it", "go", or a pasted bug screenshot means a
local fix and verification loop by default. Do not turn ordinary bugfix language
into commit, push, draft PR creation, Bunny Review, CI polling, PR health,
or ready-for-review work. Those are shipping actions and start only when the user
explicitly asks to ship, push, open a PR, or mark ready.

Only stop for a real safety blocker: force-push, missing credentials, dependency
declaration changes, schema/version/release/auth/prompt-pipeline scope jumps,
unrelated dirty files that would ship, or an unprovable core claim.

- `references/automation-ledger.md` defines the scratch ledger format agents use to record task state, proof, blockers, and final gates.
- `references/browser-recipes.md` lists repeatable browser verification recipes for De-Koi UI work.
- `references/automation-gates.md` makes autopilot exceptions and hard stops explicit.
- `references/automated-bugfix-playbook.md` gives the end-to-end autopilot bugfix flow.
- `templates/backend-repro.mjs` is the starting point for backend/logic scratch repros.
- `templates/command-repro.mjs` is the starting point for build/config command repros.
- `templates/ui-repro-playwright.mjs` is the starting point for headless UI repros.
- `scripts/automation-ledger.mjs` creates, updates, traces, timestamps, and validates ledgers under `scratch/`.
- `scripts/bugfix-fast-lane.mjs` checks whether a bugfix still qualifies for the fast lane and generates a PR proof block from the ledger.
- `scripts/risk-classifier.mjs` keeps risky-work detection shared across workflow health, PR health, and proof health.
- `scripts/proof-health.mjs` checks whether risky work records the contract lane gate, proves the claim boundary, contradiction rows, owned facts, user-data copy instructions, and reviewer dispositions.
- `scripts/pr-health.mjs` checks PR mergeability, CI, Bunny Review, unresolved review threads, and proof-link hygiene.
- `scripts/publish-evidence.mjs` records uploaded GitHub/gist evidence URLs in the proof ledger. Keep temporary screenshots under `scratch/`; do not commit PR proof images under `docs/pr-evidence/` unless they are intentional docs/reference assets.
- `scripts/workflow-health.mjs` summarizes open draft PR health and active vault task overlap before work starts.

For architecture and code-smell risk, do not invent a new ledger shape. Record
the owner and wrong-lane fix to avoid in `contractLaneGate`, then record the
known-large-file rationale, extension-point check, change map, and critic
disposition in existing fields such as `scope.riskFlags`, `claimBoundary`,
`notes`, and `trace`.

Default ledger path:

```bash
node .agents/automation/scripts/automation-ledger.mjs init scratch/automation-ledger.json task.type=bugfix task.title="Issue title"
node .agents/automation/scripts/automation-ledger.mjs start scratch/automation-ledger.json run.reasoningEffort=adaptive-high run.budget="focused local fix"
node .agents/automation/scripts/automation-ledger.mjs event scratch/automation-ledger.json phase=intake action="defined core claim" outcome=recorded
```

Before claiming automated work is done, validate the ledger:

```bash
node .agents/automation/scripts/automation-ledger.mjs validate scratch/automation-ledger.json
node .agents/automation/scripts/proof-health.mjs scratch/automation-ledger.json
```

During a small bugfix, use the fast-lane helper to avoid hand-checking the same
local proof and optional PR-readiness questions:

```bash
node .agents/automation/scripts/bugfix-fast-lane.mjs assess scratch/bugfix-verification.json
node .agents/automation/scripts/bugfix-fast-lane.mjs proof scratch/bugfix-verification.json --out scratch/bugfix-proof-pack.md
```

When transferring the proof block into a PR body, keep validation and test-plan
checkboxes unchecked for the human contributor. Put agent-run proof in prose,
command summaries, proof packs, and uploaded GitHub/gist evidence links. For any
relevant checklist item the agent did not cover, name it as `Not run`, `Not
applicable`, or `Covered by CI` in the notes instead of ticking the box.

Before calling a shipped PR ready or safe to merge, run:

```bash
node .agents/automation/scripts/pr-health.mjs 123
```

Risky PRs now require a proof ledger by default. If the PR touches installers,
upgrades, legacy data, storage, migrations, import/export, destructive actions,
compatibility, prompt/agent/lorebook behavior, release/version/dependency scope,
auth/credentials/external services, or cross-entrypoint behavior, `pr-health`
will block until rerun with a ledger:

```bash
node .agents/automation/scripts/pr-health.mjs 123 --ledger scratch/bugfix-verification.json
```

Before starting nontrivial workflow-sensitive work, summarize current lanes:

```bash
node .agents/automation/scripts/workflow-health.mjs
node .agents/automation/scripts/workflow-health.mjs --json
```

`workflow-health` also prints the active workflow policy: default base branch
`main`, PR target `The-Koi-Pond/De-Koi:main`, comparison base `origin/main`, and
whether stale workflow docs still reference an older branch target.

If GitHub checks or Bunny Review are still running after an explicit PR/shipping
action, keep polling without asking for another "okay". Report back only when
the PR is clean, a real blocker appears, or the normal wait budget is exhausted.

In repo-shared automation, Bunny Review is the trusted GitHub workflow/status
implemented by `.github/bunny-review/`. A personal Bunny skill may run a local
maintainer-style pass, but the portable PR gate is the repository status.

For UI/runtime verification, name the runtime being proven: `Chrome web shell`,
`Chrome + Remote Runtime`, `Tauri dev app`, or `scratch/backend harness`. Use the
cheapest proof ladder first: static inspection, targeted test, scratch harness,
route/module repro, or jsdom/component proof. Escalate to headless scripted
Playwright with an isolated profile when the browser state is the claim:
visual layout, interaction, routing, responsive behavior, screenshot-dependent
evidence, or a bug that only reproduces in a real browser. Chrome web-shell proof
is not enough for storage, imports/exports, managed files/assets, providers, LLM
streaming, haptics, native dialogs, updater behavior, app data paths, window
controls, Tauri commands, or Rust-backed behavior; use `pnpm tauri dev`, a
focused backend harness, or verified Remote Runtime support for those claims.
Use visible browser automation only by request or when headless verification is
insufficient.

When a bug needs a scratch harness, copy the closest template into `scratch/`
and customize only the setup/action/assert block:

## Audit Bundle Inputs

When preparing a portable Fable or external workflow audit packet, include the
repo-shared workflow surface that affects agent behavior:

- `AGENTS.md`, `CONTRIBUTING.md`, `.github/agents/`, and `.github/pull_request_template.md`
- `.github/ISSUE_TEMPLATE/` and `.github/bunny-review/`
- `skills/de-koi-agent-workflow/`, `skills/de-koi-architecture-guard/`,
  `skills/de-koi-mode-separation/`, and `skills/de-koi-bugfix-discipline/`
- `.agents/automation/`, root validation scripts such as
  `scripts/check-agent-workflow.mjs`, and `package.json`

Do not include personal/global skills as team defaults. If personal guidance is
useful audit context, label it as personal context and keep repo-shared fixes in
repo-shared files.

```bash
cp .agents/automation/templates/ui-repro-playwright.mjs scratch/issue-123-ui-repro.mjs
cp .agents/automation/templates/backend-repro.mjs scratch/issue-123-backend-repro.mjs
cp .agents/automation/templates/command-repro.mjs scratch/issue-123-command-repro.mjs
```

For tiny post-review convention fixes, do not burn time repeating a full local
baseline if the original fix already passed the matching validation command, the
focused repro still passes, and GitHub validation passes on the new head. Record that as
`verification.reviewIterationFastPath=true`; never use that shortcut for the
initial fix or for risky scope changes.

After an explicit shipping request opens a draft PR or pushes a PR-affecting
commit, wait for Bunny Review only when the current head is believed final and
has not been reviewed, then batch any PR body edits so Auto-label/checks only
restart once.

For UI/runtime bugfix screenshots that start under `scratch/`, publish them before using them in a PR body:

```bash
node .agents/automation/scripts/publish-evidence.mjs --url https://github.com/user-attachments/assets/... --ledger scratch/bugfix-verification.json
```

Then finish the ledger when the task reaches a terminal state:

```bash
node .agents/automation/scripts/automation-ledger.mjs finish scratch/automation-ledger.json status=complete
```
