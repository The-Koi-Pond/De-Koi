# Search And Evidence

Load this when a parityscan needs exact search strategy, audit path, command shapes, absence wording, or evidence standards.

## Search Budget

Start exact and widen only when exact leads fail.

1. Search exact symbols, file names, issue row IDs, commands, routes, storage keys, UI labels, schema fields, and serialized names first.
2. Prefer `rg -l` for broad discovery, then open only the top files needed to prove the row or claim.
3. If broad `rg` returns too much, narrow by owner directory before opening files.
4. For `row-only` and `follow-up`, stop after the named row is explained unless evidence crosses a risky boundary.
5. Use browser, Tauri, or runtime proof only when the claim depends on browser/runtime behavior or static evidence leaves a material gap.

## Audit Flow

1. Search both codebases with `rg` using exact target terms, schema names, field names, UI labels, commands, routes, storage keys, and serialized formats before broad terms.
2. Trace runtime behavior through the real owner path: refactor UI to engine/shared API/Tauri/Rust, and legacy UI to client/server/shared.
3. For contracts and storage formats, trace producers, consumers, migrations or compatibility repair, import/export, and user-visible workflows.
4. Search open issues and PRs for the target when GitHub access or `gh` is available. Treat issue bodies, project drafts, and #1904 tracker rows as leads, not proof.
5. Load `classification-guide.md` before final classification.

Do not stop at a visible button when persistence, prompt assembly, generation, import/export, or asset resolution matters.

## Useful Commands

```powershell
rg -l -F "<exact symbol or label>" src src-tauri public skills
rg -n -F "<exact symbol or label>" <top refactor files from rg -l>
rg -l -F "<exact symbol or label>" <legacy-root>
rg -n -F "<exact symbol or label>" <top legacy files from rg -l>
gh issue list --repo Pasta-Devs/Marinara-Engine --state open --search "<target terms>" --json number,title,labels,url
gh pr list --repo Pasta-Devs/Marinara-Engine --state open --search "<target terms>" --json number,title,labels,url
```

When one exact issue or tracker row is needed:

```powershell
gh issue view <number> --repo Pasta-Devs/Marinara-Engine --json number,title,body,url
gh issue view 1904 --repo Pasta-Devs/Marinara-Engine --json body --jq ".body" | Select-String -Pattern "<row id>|<target>" -Context 2,4
```

## Evidence Standard

Every finding needs evidence from both sides when possible:

- Cite refactor files with line references.
- Cite legacy files with line references.
- Mention commands or searches used when they materially support absence or presence.
- Mark absence carefully: "No matching refactor path found in searches X/Y/Z" rather than "does not exist" unless code structure proves it.
- Distinguish code-level support from app-proven behavior.
- For issue-backed leads, cite the issue or PR number, then cite confirming code or runtime evidence.
- For performance findings, include the call shape, expected payload shape, large fields involved, and whether proof is measured, reproduced, or static-only.

When line references are unavailable, include exact file paths and symbols. Do not rely only on old skill references, memory, or naming similarity.
