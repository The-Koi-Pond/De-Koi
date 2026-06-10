# Impact Brief Template

Use this structure before and after bug fixes. Keep it concise, but account for every affected area.

## Before Editing

```text
Bug:
Core claim:
Likely owner/lane:
Risk: low|risky
Proof target:
Feedback loop:
Top hypothesis:
```

For nontrivial or hard-to-reproduce bugs, add the top 3-5 falsifiable hypotheses and the observation that would confirm or reject each one. Skip the list only when the owner and cause are already obvious from a failing check or exact repro.

## After Editing

```text
Behavior changed:
Primary files:
Owner fixed:
Affected callers reviewed:
Mode impact:
Shared layer impact:
Rust/TS boundary impact:
Verification:
Feedback loop rerun:
Debug cleanup:
Not touched:
Remaining risk:
```

## Tiny Local Receipt

Use this instead of a full ledger only for narrow, low-risk, machine-provable
local bugs:

```text
Claim:
Proof:
Validation:
Files:
Risk:
Vault:
```

## Root Cause Checklist

- Did the failing path cross a contract boundary?
- Did UI state diverge from persisted state?
- Did a Tauri adapter shape differ from engine expectations?
- Did Rust return the wrong DTO shape?
- Did generation route through the wrong mode guide or prompt path?
- Did a shared helper accidentally encode mode-specific behavior?
- Did a recent architecture change move the owner or contract?

## Commit Shape

Good commits:

- `game: persist setup config through start flow`
- `llm: preserve OpenRouter provider routing parameters`
- `roleplay: restore scene conclusion memory writes`
- `storage: split character avatar persistence commands`

Bad commits:

- `fix stuff`
- `misc cleanup`
- `temporary workaround`
- `make app work`
