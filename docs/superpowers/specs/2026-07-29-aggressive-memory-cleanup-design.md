# Aggressive Memory Cleanup Design

## Status and relationship to the existing design

This design amends
`2026-07-27-memory-cleanup-consolidation-design.md`. The existing review-first
cleanup, apply, undo, ownership, and lifecycle contracts remain authoritative
except where this document broadens candidate discovery and proposal analysis.

## Goal

Make **Tidy memories** find substantially more real consolidation
opportunities while preserving its safety boundary:

- cleanup still requires two or more active memories;
- every distinct supported detail must survive;
- standalone rewriting and shortening remain out of scope;
- contradictions remain visible conflicts rather than automatic decisions;
- the user still reviews every change before any write.

The intended behavior is aggressive discovery followed by conservative,
reviewed application.

## Current limitation

The current deterministic candidate filter prevents the model from seeing many
memories that a person would reasonably compare. A pair is considered only
when it has exact normalized text, shared source-message provenance, at least
three shared meaningful tokens plus 60 percent Jaccard similarity, or at least
0.88 cosine similarity from existing embeddings.

Those rules strongly favor near-duplicates. They miss common consolidation
shapes such as:

- a short fact and a later elaboration of that fact;
- two relationship updates that use different phrasing;
- repeated preferences with extra qualifiers in one memory;
- plot or promise state expressed with different surrounding details;
- semantically close memories whose embedding similarity is useful but below
  0.88.

Large connected components are also truncated to one bounded group, and only
20 groups are analyzed. The remainder is reported as deferred instead of being
examined during the same user-requested cleanup.

## Considered approaches

### Lower the existing thresholds only

Lower lexical and embedding thresholds while retaining the current connected
component and truncation behavior.

This is the smallest change, but it makes a crude candidate rule noisier
without fixing dropped component members, the 20-group ceiling, or overlapping
candidate coverage.

### Whole-scope model analysis

Send every active memory in the selected owner scope to the model in one or
more broad prompts.

This has high candidate recall, but cost and context grow poorly, large scopes
become fragile, and overlapping model proposals are difficult to validate
predictably.

### Broad deterministic retrieval plus bounded model review

Build a wider, scored candidate graph; cover every qualifying edge with
bounded neighborhoods; let the model decide whether each neighborhood contains
a valid consolidation; then deterministically remove duplicate or overlapping
proposals.

This gives the model much better recall while keeping prompts bounded and the
existing storage safety contract intact.

## Decision

Use broad deterministic retrieval plus bounded model review.

Aggressiveness belongs in candidate recall and model instructions, not in
storage apply. The storage boundary must remain strict and unchanged except for
any contract fields required to carry the preview.

## Product contract

All active and pinned memories in the selected chat, scene, or character scope
remain eligible regardless of origin, edit history, or pinning. Inactive,
deleted, wrong, stale, superseded, inherited read-only, and cross-owner records
remain excluded.

**Tidy memories** may propose:

1. **Keep one** when one retained memory fully covers redundant sources.
2. **Combine** when one replacement can preserve every distinct supported
   detail from two or more sources.
3. **Possible conflict** when sources disagree and the model cannot preserve
   both as compatible facts.

It must not:

- rewrite or shorten a single memory;
- combine memories only because they mention the same subject;
- erase attribution, uncertainty, chronology, promises, relationship changes,
  or qualifiers;
- resolve a contradiction;
- write during analysis;
- silently omit candidate groups because an arbitrary group-count ceiling was
  reached.

## Candidate retrieval

### Pair evidence

Candidate preparation continues to normalize whitespace and case and remove
common stop words. It assigns deterministic evidence to each in-scope pair
using the available signals:

- exact normalized equality;
- shared source-message provenance;
- lexical containment, measured against the smaller token set so a detailed
  elaboration can match a short fact;
- Jaccard lexical overlap;
- cosine similarity when compatible embeddings are already available.

A pair qualifies when any strong signal matches:

- exact normalized equality;
- shared provenance;
- at least two shared meaningful tokens and lexical containment of at least
  0.35;
- at least three shared meaningful tokens and Jaccard similarity of at least
  0.30;
- embedding cosine similarity of at least 0.78.

Length is never evidence. No embedding request is added to cleanup; the
embedding signal remains opportunistic.

The thresholds are intentionally wider than the current 0.60 lexical and 0.88
embedding gates. The model remains responsible for rejecting merely related
memories.

Pair ordering uses a stable evidence tuple rather than a blended magic-number
score. Signal priority is exact equality, shared provenance, embedding
similarity, lexical containment, then Jaccard overlap. Within one signal,
higher similarity, more shared meaningful tokens, and finally source IDs break
ties. A pair retains all matched evidence for diagnostics, but its strongest
signal controls ordering.

### Bounded neighborhoods

Candidate preparation builds a scored undirected graph. For each source it
keeps its four strongest qualifying neighbors, with stable source ID ordering
as the final tie-breaker. This bounds graph density without restoring the old
near-duplicate bias.

Groups are produced as edge-covering neighborhoods:

- choose the highest-scoring uncovered edge;
- include both endpoints;
- add their strongest connected neighbors while the group remains within eight
  records and 12,000 characters;
- mark every qualifying edge inside that group as covered;
- continue until every retained qualifying edge has appeared in at least one
  group.

Groups may overlap because overlap is necessary to compare a memory with more
than one semantic neighborhood. Candidate preparation no longer stops after 20
groups and no longer drops the tail of a large connected component. Analysis
runs groups sequentially so a wide scan does not create a burst of concurrent
model requests. Cancellation is checked between groups.

The seed edge's two endpoints are mandatory even when their combined content
already exceeds 12,000 characters. The character budget limits additional
neighbors; it never turns a qualifying pair into a deferred or dropped
candidate.

`deferredCandidateCount` remains in the version 1 preview contract for
compatibility, but the completed scan returns zero. A nonzero value is reserved
for an explicit future user-visible analysis budget, not an internal hidden
ceiling.

## Model analysis

The cleanup prompt keeps the existing untrusted-data and JSON-only rules. It is
changed from near-duplicate caution to active, detail-preserving
consolidation:

- compare every supplied source, not only similarly worded sources;
- propose consolidation when fewer records can carry the same supported
  meaning;
- preserve qualifiers, chronology, uncertainty, relationships, promises,
  attribution, and distinct events;
- allow the replacement to be longer than any one source;
- return no proposal for memories that are merely topically related;
- return a conflict rather than choosing a truth when claims disagree.

Exact normalized duplicates continue to produce deterministic **Keep one**
proposals without a model call.

Malformed output handling, structured-output repair, cancellation, and
no-write preview behavior remain unchanged.

## Overlapping proposal resolution

Overlapping candidate groups can produce duplicate or competing proposals.
Resolution occurs in the TypeScript generation owner before preview totals are
calculated:

1. Coalesce proposals with the same type and referenced source set. If
   overlapping groups produced different valid replacements for that same
   proposal, retain the proposal from the strongest candidate group; stable
   group ID breaks an evidence tie.
2. Retain deterministic exact-duplicate proposals first.
3. For non-exact proposals, any **Possible conflict** blocks actionable
   proposals that reference the same source. This preserves the rule that a
   conflict cannot be quietly undermined by another suggestion.
4. Rank the remaining actionable proposals by:
   - greatest reduction in active memory count;
   - strongest candidate evidence;
   - greatest number of referenced sources;
   - stable proposal ID.
5. Accept proposals in rank order only when none of their referenced sources
   have already been claimed.

All referenced IDs count as claimed for preview resolution, including a
**Keep one** winner. This is stricter than storage's consumed-row rule and
prevents the review screen from offering competing interpretations of the same
memory.

The final preview therefore preserves the existing invariant that one memory
appears in at most one visible proposal.

## Architecture and data flow

The change stays in the existing owners:

- `src/engine/entities/memory-maintenance.ts` owns tokenization, pair scoring,
  bounded graph construction, and edge-covering groups;
- `src/engine/generation/memory-cleanup.ts` owns prompts, model proposal
  normalization, evidence-aware overlap resolution, and preview totals;
- `src/engine/contracts/types/memory-maintenance.ts` changes only if internal
  candidate evidence needs an explicit non-storage contract;
- the existing catalog hook and review modal continue to own cancellation,
  progress, selection, editing, apply, and undo;
- Rust chat and canonical memory-maintenance modules remain the authoritative
  stale-state, scope, atomicity, and lifecycle boundary.

No React or runtime-adapter dependency enters the engine. No new Tauri command,
HTTP route, storage collection, embedding call, or cross-owner query is added.

The flow is:

1. The selected owner scope supplies its active memory sources.
2. The engine builds broad scored candidate neighborhoods.
3. Exact duplicates are proposed deterministically.
4. Other neighborhoods are analyzed sequentially by the configured cleanup
   connection.
5. Duplicate and overlapping proposals are resolved deterministically.
6. The unchanged review modal presents the non-overlapping preview.
7. Apply and undo use the existing atomic storage paths.

## User experience

The primary helper remains:

> Find memories that can be combined into fewer, clearer memories without
> losing details. You review every change before anything is saved.

The no-op result remains:

> No consolidation opportunities found. Your memories are already distinct.

No new aggressiveness setting is added. **Tidy memories** becomes more thorough
by default because the user already opted into a review-first manual action.

Existing progress and cancellation remain. If the current UI reports analyzed
groups, the total must reflect all prepared groups rather than the former
20-group ceiling.

## Error handling and safety

- Candidate preparation is deterministic and performs no writes.
- Cancellation between groups stops analysis and performs no writes.
- One malformed or failed model response follows the existing preview failure
  contract; it does not produce a partial apply.
- Invalid model proposals are rejected before overlap resolution.
- A stale source fingerprint rejects the whole selected apply.
- Apply and undo remain atomic.
- Source rows remain recoverable lifecycle history.
- Replacement pinning and provenance remain governed by the existing
  consolidation contract.
- Repair from chat history remains separate and unchanged.

## Durable test rationale

This is a risky cross-cutting behavior change at the engine-to-model boundary.
Session-only proof is insufficient because small threshold, grouping, or
overlap changes can silently return cleanup to near-duplicate-only behavior or
show competing proposals. Focused existing test files provide a narrow stable
seam without adding a broad fixture framework.

## Verification

### Candidate preparation

Durable tests must prove:

- a short fact and longer elaboration qualify through lexical containment;
- a two-token meaningful overlap can qualify;
- embedding similarity near 0.80 qualifies while clearly unrelated vectors do
  not;
- same-subject records without a qualifying signal remain separate;
- every retained edge in a component larger than eight records is covered by a
  bounded group;
- more than 20 valid neighborhoods are returned rather than deferred;
- group and proposal ordering is deterministic;
- inactive and cross-scope records remain excluded.

### Proposal analysis

Durable tests must prove:

- the prompt actively requests detail-preserving consolidation;
- the model can combine differently worded compatible memories;
- merely related memories can return no proposal;
- conflicts block overlapping actionable proposals;
- exact duplicates win over overlapping semantic suggestions;
- the highest-ranked non-overlapping actionable set is stable;
- final proposals never reference one memory more than once;
- no `shorten` or singleton proposal is accepted;
- a completed preview reports zero deferred candidates.

### Existing safety lanes

Run the focused engine/entity and generation tests plus:

- memory-maintenance hook and review-modal tests;
- `pnpm typecheck`;
- `pnpm check:architecture`;
- `pnpm check:docs`;
- `pnpm build`.

Rust storage behavior is not intended to change. Run the existing focused chat
and canonical memory-maintenance tests to prove the broader preview still
applies and undoes through the unchanged boundary. Run
`cargo check --manifest-path src-tauri/Cargo.toml --workspace` before shipping.

Manual proof uses a mixed owner scope containing:

- exact duplicates;
- a short fact plus an elaboration;
- differently phrased compatible relationship or preference memories;
- merely related distinct events;
- a contradiction;
- more than 20 candidate neighborhoods.

The proof must show a broader preview, preserved details, visible unresolved
conflicts, atomic apply, and successful undo.

## Out of scope

- standalone memory rewriting or shortening;
- automatic or scheduled cleanup;
- cleanup without review;
- cross-owner or global cleanup;
- automatic contradiction resolution;
- new embeddings generated solely for cleanup;
- changes to recall ranking or prompt memory budgets;
- changes to automatic memory capture;
- hard deletion of superseded source history;
- changing deterministic Repair from chat history.
