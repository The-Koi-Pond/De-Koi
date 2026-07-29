# Memory Cleanup Junk Detection Design

## Status and relationship to existing designs

This design amends:

- `2026-07-27-memory-cleanup-consolidation-design.md`
- `2026-07-29-aggressive-memory-cleanup-design.md`

Those designs remain authoritative for consolidation, conflicts, review,
stale-state validation, atomic apply, and undo. This amendment replaces only
their prohibition on singleton cleanup and their consolidation-only user copy.

## Goal

Make **Tidy memories** find memories that are not worth keeping, even when they
do not duplicate or overlap another memory.

For example, a memory such as:

> Chai says heat stroke is serious.

may be true, but it is generic conversational residue rather than useful
persistent knowledge about the user, a character, a relationship, or the
world.

Tidy should aggressively surface both obvious and questionable low-value
memories. The user review step, rather than model certainty, remains the final
safety boundary.

## Product contract

All active and pinned memories owned by the selected chat, scene, or character
scope are eligible for low-value review, regardless of provenance or editing:

- automatic and prior-cleanup memories;
- pinned memories;
- manually written and user-edited memories;
- imported memories;
- correction memories;
- command- and tool-created memories.

Low-value review adds one proposal:

4. **Discard** one memory that is not useful enough to remain active.

A discard proposal:

- references exactly one source memory;
- creates no replacement and has no retained winner;
- uses the fixed reason `Low-value memory`;
- starts unchecked in the review UI;
- changes nothing until the user explicitly checks it and applies cleanup;
- removes the source from active recall without hard-deleting its history;
- participates in the same atomic cleanup batch and undo flow as
  consolidation.

## Low-value classification

The model should flag a memory when it is plausibly not useful as persistent
context. The scan intentionally favors review recall over model certainty.

Positive low-value signals include:

- generic or common knowledge with no user-, character-, relationship-, or
  world-specific value;
- conversational residue such as acknowledgements, reactions, narration about
  what someone just said, or paraphrases of the exchange rather than durable
  facts;
- ephemeral small talk that has no reasonable future use;
- contextless fragments that do not preserve an interpretable fact,
  preference, event, commitment, or relationship state;
- malformed or accidental captures;
- observations whose only content is that a speaker stated an ordinary,
  generally known proposition.

The model should not flag a memory merely because it is:

- short, mundane, old, awkward, or verbose;
- manual, user-edited, imported, corrected, command-created, or pinned;
- uncertain, negative, or emotionally minor;
- about an everyday preference, routine, possession, relationship, plan,
  promise, identity, health need, boundary, distinctive event, or ongoing
  situation;
- useful for understanding a character's beliefs, even when the belief is
  factually ordinary;
- presently unique.

The distinction is future contextual value, not factual truth, writing quality,
or importance in the abstract.

## Considered approaches

### Explicit discard proposal

Add a first-class singleton `discard` proposal to the engine, UI, and Rust
cleanup contract.

This preserves review, stale-state validation, atomicity, lifecycle history,
and one-batch undo. It requires coordinated contract and storage changes, but
it represents the product behavior honestly.

### Analyze, then call ordinary delete actions

Have the model identify junk and invoke existing per-memory delete behavior
outside the cleanup apply contract.

This avoids a Rust proposal-type change, but loses cleanup-batch atomicity,
shared stale-preview validation, and one-step undo. A partial failure could
remove only some reviewed memories.

### Encode discard as keep-one or combine

Use a fake retained winner or create an empty/synthetic replacement.

This is rejected because it corrupts the meaning of consolidation, creates
misleading history, and can leave junk represented by a new junk record.

## Decision

Use an explicit `discard` proposal.

The storage boundary changes because discard is a real lifecycle operation,
not a presentation-only variation of consolidation.

## Analysis architecture

Low-value review is a separate bounded value scan over every eligible source.
It does not depend on lexical overlap, embeddings, provenance, or candidate
edges.

Value-scan batches:

- include every eligible source exactly once;
- contain at most eight memories;
- target at most 12,000 characters;
- always include a single oversized source rather than dropping it;
- use deterministic source ordering;
- run sequentially;
- check cancellation between requests.

The value-scan prompt receives the same minimum safe source metadata as the
consolidation prompt. It asks the model to evaluate each supplied memory
independently and return zero or more discard objects.

The model may return questionable candidates. It must not:

- return free-form actions;
- invent source IDs;
- return a replacement or winner;
- consume more than one source in a discard;
- decide whether a claim is factually true;
- treat age, length, pinning, provenance, or editing as low-value evidence by
  themselves.

Consolidation candidate groups continue to run under the aggressive cleanup
design. All model calls remain sequential so the additional scan does not
create concurrent provider bursts.

## Proposal normalization and resolution

The TypeScript engine adds:

- proposal type `discard`;
- reason `Low-value memory`;
- validation that discard has exactly one source, no winner, and no
  replacement;
- default `selected: false`;
- estimated after-tokens of zero.

Resolution order becomes:

1. discard proposals;
2. deterministic exact duplicates;
3. possible conflicts;
4. remaining actionable consolidation proposals.

A discard claims its source during preview resolution. This prevents the same
memory from appearing simultaneously as both junk and part of a consolidation.
Duplicate discard proposals for the same source are coalesced
deterministically.

Discard precedence means that multiple copies of junk are offered for removal,
not reorganized into one surviving junk memory. If the user declines the
discard, a later analysis may offer a consolidation; one preview continues to
show only one interpretation per memory.

## Storage lifecycle

Rust adds `Discard` to the cleanup proposal contract.

A valid selected discard:

- has exactly one source ID;
- has expected state for that source only;
- has no winner ID;
- has no replacement;
- is owned by the requested scope;
- is active or pinned at apply time;
- matches the reviewed content, status, timestamps, pin state, and edit state.

Apply changes the source status to `deleted`, records that the transition came
from the cleanup batch, and creates no replacement. `deleted` is used instead
of `superseded` because no retained memory represents the discarded content.

Chat memory apply preserves enough prior field-presence and field-value
metadata to restore the source exactly. Canonical apply updates the lexical
index in the same atomic transaction as the memory row.

Undo restores:

- the prior active or pinned status;
- prior update and supersession fields;
- canonical index membership;
- any other cleanup-owned lifecycle metadata changed by apply.

Existing consolidation batches remain undoable. A batch may contain discard,
keep-one, and combine proposals; all selected operations succeed or fail
together.

The apply result adds a discarded count while retaining existing result fields
for compatibility.

The existing 20-proposal apply ceiling is too small for whole-scope junk
review. The request contract raises its explicit defensive maximum to 1,000
selected proposals. Preview generation remains uncapped, because discard
suggestions begin unchecked and the review UI submits only selected proposals.
If a user selects more than 1,000 changes, the UI must report that limit before
calling storage rather than sending a request that storage will reject. This
keeps a bounded privileged request without silently hiding analysis results.

## Review experience

The helper copy becomes:

> Find memories that can be combined or are not useful to keep. You review
> every change before anything is saved.

The no-op copy becomes:

> No cleanup opportunities found. These memories look distinct and useful.

Each discard card shows:

- reason `Low-value memory`;
- the source content under **Before**;
- **Remove from active memories** under **After**;
- an undo/recoverability note;
- visible `Pinned`, `Manual`, or `Edited` labels when applicable;
- an unchecked checkbox.

The user must explicitly check every discard they want applied. Existing
validated consolidation suggestions remain selected by default. Conflicts
remain unselectable.

## Error handling and safety

- Value analysis performs no writes.
- Cancellation before completion performs no writes.
- Invalid discard objects are rejected before preview resolution.
- If every returned model object is invalid, analysis follows the existing
  invalid-response failure contract.
- Cross-owner, inactive, malformed, overlapping, or stale proposals are
  rejected again by Rust.
- Apply remains atomic for both chat/scene and canonical character owners.
- Cleanup history remains recoverable; discard is not a hard delete.
- Undo remains scoped to the exact cleanup batch.
- Pinned, manual, and edited memories receive no exemption from analysis, but
  their discard checkboxes still start unchecked.

## Architecture ownership

- `src/engine/entities/memory-maintenance.ts` owns eligibility, value-scan
  batching, and TypeScript proposal validation.
- `src/engine/generation/memory-cleanup.ts` owns value-scan prompting,
  normalization, discard precedence, and preview totals.
- `src/engine/contracts/types/memory-maintenance.ts` owns the versioned
  TypeScript proposal and result shapes.
- `src/features/catalog/memory-maintenance` owns the explicit-review UI and
  unchecked selection state.
- `src-tauri/src/commands/storage/memory_maintenance/contracts.rs` owns the
  privileged discard contract.
- Chat and canonical memory-maintenance modules own atomic lifecycle changes,
  index updates, and undo.

No new Tauri command, HTTP route, storage collection, embedding request,
provider behavior, or cross-owner query is added.

## Durable test rationale

This change adds a model-directed path that can remove pinned or manually
written user data from active recall. Existing consolidation tests cannot prove
singleton classification, unchecked consent, or replacement-free storage
behavior. Narrow tests at each existing owner are required because a contract
drift could otherwise turn a reviewed suggestion into an unsafe apply.

## Verification

### Engine and generation

Durable tests prove:

- every eligible source appears in one value-scan batch;
- batches are deterministic, bounded, and retain an oversized singleton;
- the heat-stroke conversational-residue example can produce discard;
- a mundane but user-specific preference remains;
- a character-specific ordinary belief remains;
- pinned, manual, and edited sources are included;
- discard must reference exactly one known source;
- discard cannot have a winner or replacement;
- discard defaults to unchecked;
- discard wins overlap resolution against exact and semantic consolidation;
- preview counts and token totals reflect selected-state semantics correctly;
- invalid or invented discard IDs are rejected.

### Review UI

Durable tests prove:

- discard cards say **Remove from active memories**;
- pinned/manual/edited labels render from source metadata;
- discard starts unchecked even if a malformed preview says selected;
- Apply remains disabled until the user explicitly selects an actionable
  proposal;
- consolidation selection and conflict behavior do not regress.

### Rust contract, storage, and undo

Durable tests prove for both chat and canonical owners:

- one selected discard is accepted;
- zero or multiple discard sources are rejected;
- winner and replacement fields are rejected;
- pinned, manual, and edited eligible rows can be discarded;
- stale, inactive, and cross-owner rows reject the full batch;
- discard creates no replacement;
- discard records recoverable deleted history;
- canonical lexical indexes stop returning discarded rows;
- undo restores the source and canonical index;
- a mixed discard/consolidation batch is atomic.
- 21 selected proposals are accepted, while more than the documented 1,000
  proposal request limit is rejected before mutation.

### Repository checks

Run:

- focused entity, generation, hook, and review-modal tests;
- focused chat and canonical Rust cleanup tests;
- `pnpm typecheck`;
- `pnpm check:architecture`;
- `pnpm check:docs`;
- `pnpm build`;
- `cargo check --manifest-path src-tauri/Cargo.toml --workspace`;
- final diff, status, and whitespace checks.

Manual proof uses a disposable owner scope containing:

- the heat-stroke example;
- generic conversational residue;
- a mundane user preference that must stay;
- a character-specific ordinary belief that must stay;
- a pinned low-value memory;
- a manual low-value memory;
- a duplicate;
- an overlapping pair;
- a conflict.

The proof must show aggressive junk suggestions, unchecked discard controls,
unchanged valuable memories, consolidation behavior, atomic apply, removal from
active recall, and successful undo.

## Out of scope

- automatic or scheduled junk deletion;
- cleanup without review;
- hard deletion of source history;
- changing automatic capture in this slice;
- fact-checking memories;
- assigning a permanent quality score to every memory;
- cross-owner or global cleanup;
- generating new embeddings for value analysis;
- changing recall ranking or prompt memory budgets;
- resolving contradictions automatically.
