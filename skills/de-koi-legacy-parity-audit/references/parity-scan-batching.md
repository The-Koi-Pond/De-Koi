# Parityscan Batching

Use this reference when the user asks to split a De-Koi tracker issue, target
detail issue, or large parity target into small parityscan batches.

This is a planning workflow only. Do not run parityscan yet. Do not edit files,
create branches, open issues, open PRs, commit, or push.

## Context

- Current branch/worktree is the De-Koi implementation under audit.
- Legacy source target is the Pasta `staging` branch:
  https://github.com/Pasta-Devs/Marinara-Engine/tree/staging.
- De-Koi tracker issue #2 is the live parity tracker. A user may also name a
  De-Koi target detail issue or historical Pasta issue as source context.
- Goal is to split the named issue or target into small parityscan batches.

If the user says "upstream issue" or gives a Pasta issue number, treat that
issue as historical source context unless they explicitly say it is the live
De-Koi tracker. Do not copy historical Pasta status forward as De-Koi proof.

## Batching Rules

1. Read the named issue and extract all parity surfaces.
2. Group surfaces by owner/lane:
   - UI/features
   - engine/product behavior
   - shared API/runtime wrappers
   - Tauri/hostable/runtime
   - storage/import/export
   - architecture/contracts
3. Keep each batch to 2-4 tightly related surfaces.
4. Put any high-risk surface alone unless it needs one direct contract pair.
5. High-risk gets a solo batch, medium gets same-lane only, and low can group by workflow.
6. Do not mix storage/import/export/provider/security/runtime with unrelated UI.

High-risk surfaces include storage, migrations, import/export, providers,
security, prompt assembly, generation/runtime, remote/hostable runtime,
destructive actions, user data, and cross-boundary contracts.

## Batch Output

For each batch, output:

- Batch name
- Risk: Low/Medium/High
- Surfaces
- Why grouped
- Proof target
- Stop/escalate condition

End with recommended batch order, then include a copy-paste prompt list in that
exact order.

## Copy-Paste Prompt Rules

For each copy-paste prompt:

- Start with `===== Batch N: <Batch Name> =====`
- Include the batch risk and surfaces.
- Include the context discipline rules.
- Include stop conditions.
- Make each prompt standalone enough to paste into a fresh chat.
- Do not put commentary between prompts.

## Prompt Template

```text
===== Batch N: <Batch Name> =====

Run parityscan on this batch with context discipline.

Only load files needed to prove these surfaces. Prefer targeted rg/read over
broad exploration. Summarize findings with file:line references instead of
pasting large code. Do not inspect unrelated modes unless a listed surface
directly routes there.

Batch:
Risk: <Low/Medium/High>
Surfaces:
- <surface-id>
- <surface-id>

Issue context:
- Use De-Koi issue #<TRACKER ISSUE> as source of truth for these surface definitions.
- If #<TRACKER ISSUE> is a historical Pasta issue, use it as source context only and confirm current De-Koi behavior before classifying.
- Do not re-batch #<TRACKER ISSUE>.
- Do not inspect surfaces outside this batch except to prove direct caller/callee behavior.

Legacy source:
- Use the Pasta staging branch as legacy: https://github.com/Pasta-Devs/Marinara-Engine/tree/staging.
- If using a local legacy checkout, verify it is on or fetched from Pasta staging before comparing.

De-Koi source:
- Use the current De-Koi worktree unless the user names another branch or commit.

Context discipline:
- Read De-Koi AGENTS.md and repo-local parity guidance.
- Check De-Koi issue #2 known intentional divergences before calling a legacy/De-Koi difference a gap.
- Treat Pasta issues as historical leads only; do not copy their status forward as De-Koi proof.
- Do not edit files, create branches, open issues, open PRs, commit, or push unless the user explicitly asks after this scan.

Stop if:
- more than one high-risk owner boundary is needed
- proof requires broad runtime/storage/provider tracing outside listed surfaces
- batch expands beyond listed surfaces
- legacy source is not Pasta staging and no explicit alternate source was requested

Output receipt:
- result: gap / no gap / De-Koi better / blocked
- legacy behavior
- De-Koi behavior
- files inspected with file:line refs
- proof used
- follow-ups found but not chased
```
