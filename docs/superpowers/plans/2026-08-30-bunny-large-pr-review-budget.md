# Bunny Large-PR Review Budget Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (when authorized) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make chunked Bunny reviews complete within the hosted workflow budget without weakening coverage, verdict, or failure semantics.

**Architecture:** Keep the current three-pass pipeline for one-packet reviews. For multi-chunk reviews, run one combined broad-and-skeptical pass per raw chunk with one bounded same-chunk retry, then run one compact PR-wide judge over the schema-valid chunk results. Preserve deterministic schema/path/line validation and honest failure behavior.

**Tech Stack:** Python 3, OpenAI Python SDK, deterministic fake clients, Node/pnpm repository gates, GitHub Actions.

## Global Constraints

- Every changed file must remain covered by one raw review chunk.
- Do not raise the workflow timeout as the primary fix.
- Do not persist model output or reuse it across workflow runs.
- Do not treat partial chunk coverage as a successful Bunny review.
- Keep packet contents and model output out of telemetry.
- Preserve the non-chunked three-pass review behavior.

---

### Task 1: Lock the orchestration regression in tests

**Files:**

- Modify: `.github/bunny-review/check_guidance_digest.py`
- Read: `.github/bunny-review/bunny_review.py`

**Interfaces:**

- Consumes: a list of raw review chunks and a deterministic fake model client.
- Produces: call-order, retry-scope, final-judge-input, and telemetry assertions.

- [ ] Inspect current fake-client helpers and chunking tests so the regression uses the repository's existing self-test conventions.
- [ ] Add a failing eight-chunk test requiring nine successful model calls and one final compact judge.
- [ ] Add a failing transient-error test requiring only the failed chunk to retry while completed chunks remain single-run.
- [ ] Add a failing exhausted-error test requiring no final judge and an honest exception.
- [ ] Add a failing telemetry assertion that identifies chunk progress without printing raw packet text.
- [ ] Run `pnpm check:bunny-review` and confirm failures are caused by the missing bounded chunk orchestration.

### Task 2: Implement bounded chunk review orchestration

**Files:**

- Modify: `.github/bunny-review/bunny_review.py`
- Modify: `.github/bunny-review/check_guidance_digest.py`

**Interfaces:**

- Consumes: reviewer skill, one raw packet per chunk, model client, aggregate stats.
- Produces: schema-valid chunk reviews, one final PR-wide review object, bounded progress telemetry.

- [ ] Add a combined chunk focus contract that explicitly performs both broad defect discovery and skeptical challenge in one pass.
- [ ] Add a helper that reviews one chunk with two total application attempts and reports per-attempt telemetry.
- [ ] Add a final-judge helper that receives compact serialized chunk results and PR metadata, not raw chunk packets.
- [ ] Route only multi-chunk reviews through the new helpers; leave the single-packet three-pass path unchanged.
- [ ] Ensure exhausted chunk and final-judge failures use the existing failed-review/status path.
- [ ] Re-run `pnpm check:bunny-review` and confirm the new regression tests pass.

### Task 3: Prove call budget and review integrity

**Files:**

- Review: `.github/bunny-review/bunny_review.py`
- Review: `.github/bunny-review/check_guidance_digest.py`

**Interfaces:**

- Consumes: representative eight-chunk packets and scripted valid/invalid model responses.
- Produces: deterministic evidence for call budget, retry isolation, compact judging, and schema enforcement.

- [ ] Run a focused fake-client simulation showing eight chunk calls plus one final judge.
- [ ] Run the same simulation with a transient failure and show only that chunk is retried.
- [ ] Confirm a malformed/exhausted chunk cannot emit `Ready` or invoke the final judge.
- [ ] Run `python -m py_compile .github/bunny-review/bunny_review.py .github/bunny-review/check_guidance_digest.py`.
- [ ] Run `git diff --check origin/main...HEAD`.

### Task 4: Repository verification and local Bunny pass

**Files:**

- Review all changed files against `origin/main`.

**Interfaces:**

- Consumes: the complete tooling diff and deterministic test evidence.
- Produces: repository-green and Bunny-reviewed branch state.

- [ ] Run `pnpm check:bunny-review` from a clean dependency install.
- [ ] Run `pnpm check`.
- [ ] Inspect `git log origin/main..HEAD`, `git diff --stat origin/main...HEAD`, and `git diff --check origin/main...HEAD`.
- [ ] Run the repo-local Bunny review against the branch diff and resolve any in-scope findings.
- [ ] Record any true manual verification gap; do not claim hosted timing proof before CI.

### Task 5: Ship and prove the production workflow

**Files:**

- No additional source changes expected.

**Interfaces:**

- Consumes: verified branch, strict PR metadata, hosted CI, Bunny status.
- Produces: merged Bunny tooling fix and a successful rerun of the original large pull request.

- [ ] Commit intended files, push only to `origin`, and open a pull request targeting `The-Koi-Pond/De-Koi:main`.
- [ ] Run Bunny after the push and wait for all hosted required checks on the exact head SHA.
- [ ] Merge the tooling pull request after its exact head is green and Bunny-ready.
- [ ] Rerun Bunny on PR #1274 at `ffa026301206072fabaddec0df99e8977d803962` using the merged base workflow.
- [ ] Confirm Bunny records `Ready`, success status, and the exact reviewed SHA before merging PR #1274.
- [ ] Wait for exact merge-SHA server/web images, update the Pi through the trusted-lan updater, and verify checkout, image labels, containers, mounts, health, and root HTTP response.
