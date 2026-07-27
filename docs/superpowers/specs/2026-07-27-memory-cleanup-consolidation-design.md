# Memory Cleanup Consolidation Design

## Status and relationship to the original design

This design amends
`2026-07-27-memory-maintenance-design.md`. It replaces that document's cleanup
eligibility, proposal, candidate-discovery, user-copy, and verification
decisions where they conflict with this document. The deterministic
**Repair from chat history** contract is unchanged.

## Goal

Make **Tidy memories** answer one question:

> Can two or more active memories in this owner scope become fewer, simpler
> memories without losing distinct information?

Cleanup is consolidation, not a general prose editor. It is not triggered
because one memory is long, wordy, awkward, manually written, imported,
corrected, tool-created, edited, or pinned.

## Product contract

All active memories owned by the selected chat, scene, or character are
eligible for analysis and reviewed cleanup, regardless of provenance or
pinning:

- automatic and prior-cleanup memories;
- pinned memories;
- manually written and user-edited memories;
- imported memories;
- correction memories;
- command- and tool-created memories.

Provenance and pin state remain meaningful metadata, but they are not cleanup
exemptions.

The following integrity boundaries remain:

- inactive, deleted, wrong, stale, and superseded history is not source
  material;
- memories owned by another chat, scene, or character are out of scope;
- inherited character memories remain read-only from the chat Memory Console;
- a cleanup preview performs no writes;
- every change must be selected and reviewed before apply;
- conflicts are reported but never automatically resolved;
- stale-state validation, atomic apply, and undo remain required.

## What qualifies

A cleanup proposal must reference at least two source memories. It may:

1. **Keep one** existing memory when the other sources are wholly redundant.
2. **Combine** overlapping memories into one replacement that preserves all
   distinct supported information.
3. **Report a conflict** without selecting or changing either memory.

There is no single-memory **Shorten** proposal. A memory does not qualify by
itself because it exceeds a character or token threshold.

“Simpler” is primarily structural: fewer active memory records represent the
same supported information. A valid replacement may be as long as, or longer
than, any individual source when that is necessary to retain facts,
qualifiers, time references, relationships, promises, and attribution.

Memories that are merely about the same subject do not qualify. Separate
events, time periods, preferences, commitments, relationship changes, and
uncertain or contradictory claims remain separate.

## Candidate discovery and AI analysis

The analyzer considers every active in-scope record. It forms bounded
multi-record candidate groups using deterministic evidence such as:

- normalized exact equality;
- shared source-message or source-record provenance;
- lexical overlap;
- available embedding similarity;
- compatible entities, subjects, and time references.

Length alone is not a candidate signal. Candidate discovery must not emit
singleton groups. The existing long-memory threshold and singleton shortening
path are removed.

Bounded semantic grouping is preferred over both extremes:

- one unbounded whole-scope prompt has weaker cost, context, and failure
  isolation;
- pair-only comparison misses useful consolidation across three or more
  memories and encourages repeated cleanup passes.

The model receives only bounded candidate groups and minimum required metadata.
Its instructions define success as reducing the number of memories without
losing supported meaning. It must prefer no proposal when consolidation is
uncertain and must not treat brevity as an independent goal.

## Preview, apply, and metadata

The existing review-first preview remains the authority for user consent. Each
proposal shows:

- every source memory;
- the retained memory or proposed replacement;
- why the sources are redundant or overlapping;
- the before-and-after memory count;
- an editable replacement field for combine proposals;
- a selected-by-default checkbox only for validated, non-conflicting
  proposals.

Apply validates the same active owner scope in both the TypeScript planning
layer and the Rust storage boundary. Neither layer may reject a source merely
because it is pinned, manual, edited, imported, corrected, command-created, or
tool-created.

Existing fingerprints still reject stale previews. Sources cannot be consumed
by more than one selected proposal. Apply and undo remain atomic, and source
rows remain recoverable lifecycle history rather than being hard-deleted.

For a combined replacement:

- the cleanup batch retains source IDs and safe source provenance for audit and
  undo;
- the replacement remains pinned if any consumed source was pinned;
- its lifecycle origin identifies it as a cleanup result without erasing how
  its source facts entered memory.

For **Keep one**, the retained source keeps its existing metadata. Redundant
sources are superseded by it only after review.

## User-facing copy

Primary helper:

> Find memories that can be combined into fewer, clearer memories without
> losing details. You review every change before anything is saved.

No-op result:

> No consolidation opportunities found. Your memories are already distinct.

The cleanup UI removes:

- the protected-memory notice;
- the protected-memory count;
- references to “automatic memories” as the only cleanup target;
- “overly wordy” as a cleanup reason;
- shortened-memory totals and wording.

Reasons presented to the user should describe consolidation, for example:

- `Repeated fact`
- `Overlapping memories`
- `Possible conflict`

The advanced **Repair from chat history** explanation continues to say which
records that deterministic repair leaves unchanged. Repair reconstructs
transcript-owned automatic memory and is not broadened by this cleanup change.

## Architecture and implementation boundaries

The current owners remain:

- `src/engine/entities/memory-maintenance.ts` for active in-scope eligibility,
  candidate preparation, and proposal validation;
- `src/engine/generation/memory-cleanup.ts` for exact-duplicate proposals,
  prompt construction, response parsing, and semantic proposal validation;
- `src/features/catalog/memory-maintenance` for adapters, review UI, and
  cleanup workflow;
- focused shared runtime APIs for embedded and remote calls;
- Rust chat and canonical memory-maintenance storage modules for authoritative
  apply and undo validation.

The change must be consistent across the planning and storage boundaries.
Changing UI copy or TypeScript eligibility alone would produce misleading
previews or apply-time rejection.

## Error handling

Existing failure behavior remains:

- analysis and cancellation write nothing;
- invalid model proposals are omitted or fail the preview according to the
  existing validation contract;
- stale or invalid selected proposals fail the whole apply without writes;
- apply/index failure commits no partial cleanup batch;
- undo refuses to overwrite later edits or cleanup batches;
- switching owner scope invalidates the preview.

Being manual, edited, imported, corrected, command-created, tool-created, or
pinned is not an error and must not produce a “protected” rejection.

## Durable regression coverage

This is a cross-boundary storage contract change that can silently regress if
the TypeScript and Rust eligibility rules drift. Focused durable tests are
required.

### Engine and generation

- every active in-scope provenance and pin variant is eligible;
- inactive and cross-scope records remain excluded;
- candidate preparation never emits singleton groups based on length;
- exact duplicate and multi-record overlap proposals may consume formerly
  protected source categories;
- no `shorten` proposal is accepted;
- distinct merely-related memories remain separate;
- replacement content preserves supported qualifiers and attribution.

### Storage

- chat and canonical apply accept active in-scope pinned, manual, edited,
  imported, correction, command, and tool-created sources;
- inactive, stale, cross-scope, overlapping, and missing sources still reject
  the whole batch;
- a combined replacement is pinned when any source was pinned;
- source provenance and cleanup-batch audit data remain recoverable;
- apply and undo remain atomic for both embedded and remote-capable paths;
- deterministic repair retains its narrower preservation rules.

### UI

- helper and no-op copy describe consolidation rather than wordiness;
- no protected-memory notice or count is rendered;
- no shortened-memory reason or total is rendered;
- all active in-scope memories can appear in reviewed proposals;
- conflicts, selection, editing, stale-preview handling, apply, and undo remain
  truthful.

## Verification

Implementation proof should include:

- focused TypeScript engine, generation, adapter, hook, API, and component
  tests;
- focused Rust chat and canonical memory-maintenance tests;
- `pnpm typecheck`;
- `pnpm check:architecture`;
- `cargo check --manifest-path src-tauri/Cargo.toml --workspace`;
- `pnpm build`;
- manual review of a mixed-source consolidation preview, apply, and undo.

If the work is later authorized for shipping, run the repository's full
shipping checks and Bunny review before merge.

## Out of scope

- rewriting one memory solely to improve its prose or length;
- automatic or scheduled cleanup;
- cross-owner or global cleanup;
- deciding which contradictory memory is true;
- changing deterministic repair eligibility;
- changing recall ranking, context budgets, embeddings, or source transcript
  storage;
- hard-deleting superseded history.
