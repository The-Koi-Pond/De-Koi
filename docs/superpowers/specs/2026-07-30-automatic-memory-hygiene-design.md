# Automatic Memory Hygiene Design

## Goal

Make De-Koi memory maintenance fully automatic:

- automatic capture must reject low-value candidates before they become stored memories;
- stored memories must be tidied without a user opening a modal, reviewing proposals, or clicking Apply;
- automatic cleanup must include active and pinned memories from every origin, including automatic, manual, imported, corrected, command-created, and cleanup-created records;
- cleanup must remain atomic, recoverable, bounded, and subordinate to foreground generation.

In this design, **cleanup** is one analyzed and atomically applied proposal batch for one storage target. **Maintenance** is the durable background lifecycle around cleanup: enqueueing, scheduling, reloading current sources, running zero or more cleanup batches, retrying interruptions, and stopping at a fixed point.

“Low value” means low value under De-Koi’s shared semantic policy. Model judgment cannot provide a mathematical guarantee, but capture and maintenance must use the same aggressive policy so the product does not intentionally admit a candidate that its own cleanup would immediately discard.

## User contract

Memory hygiene is an always-on consequence of Memory Recall. The user does not run or supervise it.

De-Koi will:

1. extract possible memories after a saved assistant turn;
2. review those candidates for durable future value before storage;
3. persist only candidates that pass the shared value policy;
4. queue the affected owner scope for background consolidation;
5. automatically apply valid discard, keep-one, and combine proposals;
6. preserve atomic undo history for recovery;
7. retry interrupted or failed background work later.

Manual, pinned, edited, imported, corrected, and command-created memories receive no protection from automatic cleanup. Their origin remains evidence shown in history, not an exemption from hygiene.

Contradictions are not resolved by guessing. A conflict proposal performs no destructive action. Both claims remain available until later evidence establishes a valid supersession or a future memory write makes them compatible. This requires no user action and does not block other non-overlapping cleanup.

## Considered approaches

### Full cleanup inline after every memory write

Run the complete low-value and consolidation analysis before returning from every write.

This is simple, but it makes manual saves, imports, tool calls, and assistant replies wait on multiple provider requests. It also repeats work when several memories enter the same scope together and risks competing with foreground generation.

### Scheduled cleanup without a capture gate

Save memories immediately, then clean scopes during idle periods.

This is inexpensive and easy to coalesce, but low-value automatic candidates temporarily become real memories and can enter recall before cleanup. That violates the requirement that low-value captures never be collected.

### Pre-storage capture gate plus durable background maintenance

Review automatic candidates before storage, then use a coalesced durable queue to tidy every changed owner scope after writes.

This satisfies the capture requirement without moving whole-scope maintenance onto the reply path. It reuses the existing cleanup policy, bounded analysis, atomic apply, undo batches, and foreground-generation lease.

## Decision

Use the pre-storage capture gate plus durable background maintenance.

The capture gate is narrow: it judges only the candidates extracted from the saved assistant turn. Whole-scope discard, deduplication, and consolidation remain background work.

## Shared value policy

Low-value detection must have one React-free engine owner shared by capture and maintenance.

The policy continues to flag:

- generic or common knowledge without user, character, relationship, or world-specific value;
- conversational residue and ephemeral reactions;
- contextless fragments;
- accidental captures;
- questionable facts that do not help future continuity.

The policy continues to preserve:

- preferences, routines, possessions, identity, and health needs;
- relationships, boundaries, plans, and promises;
- distinctive events and ongoing situations;
- character-specific beliefs and world-specific state.

Age, length, prose quality, uncertainty, origin, edit history, and pinning are not independent reasons to keep or discard a memory.

The engine must treat memory text as untrusted data, use structured JSON, accept only supplied IDs, reject malformed proposals, and never convert a failed review into permission to save or delete.

## Pre-storage automatic capture

### Data flow

1. The existing automatic-capture job extracts bounded candidate objects.
2. Candidates are normalized into ephemeral memory-shaped records with stable job-local IDs.
3. The shared value reviewer evaluates every candidate in bounded groups.
4. Candidates flagged as low value are counted as rejected and are never passed to `createMemory`.
5. Candidates that pass are persisted through the existing canonical-memory API.
6. Successfully created scopes are queued for automatic maintenance.
7. Touched indexes are rebuilt through the existing capture contract.

The gate applies to automatic transcript capture. Other origins can be written immediately, but every successful write queues automatic whole-scope maintenance. This avoids forcing user-authored and privileged tool writes to wait on a provider while still making every stored origin eligible for automatic cleanup.

### Failure behavior

The capture gate fails closed:

- malformed, aborted, or failed value review creates no candidate memories;
- the durable capture job remains retryable rather than reporting completion;
- provider unavailability therefore delays valuable automatic memories instead of admitting unreviewed low-value memories;
- retries must be idempotent and must not duplicate memories already created by a prior partial attempt.

Exhausted attempts remain visibly diagnosable through existing capture-job status and logs. No fake success or silent fallback may bypass the gate.

## Durable automatic maintenance queue

### Ownership

The TypeScript engine owns scheduling and model analysis. The existing embedded/remote storage capability remains authoritative for atomic apply, stale-state checks, lifecycle changes, and undo.

Add a durable `memory-maintenance-jobs` collection rather than overloading transcript capture jobs. A job contains:

- stable owner key (`chat`, `scene`, or `character` plus ID);
- maintenance policy version;
- pending, processing, retryable, completed, failed, or stale status;
- attempt count and maximum attempts;
- enqueue, start, completion, and retry timestamps;
- last error text safe for diagnostics;
- optional trigger metadata such as capture, manual edit, import, correction, command, or startup sweep.

Only one live job exists per owner and policy version. Repeated writes coalesce into that job. A write arriving during processing marks the owner dirty so one additional pass runs after the current pass rather than starting concurrently.

### Triggers

Queue maintenance after every successful canonical memory mutation that can change active scope contents:

- automatic capture;
- manual create or edit;
- import;
- correction;
- command or Deki memory write;
- pin or unpin;
- status restoration;
- cleanup-created replacement.

Cleanup’s own atomic apply must not create an infinite enqueue loop. Writes tagged with the active maintenance batch may mark the current job satisfied instead of scheduling a fresh identical pass. If the resulting scope fingerprint differs from the analyzed fingerprint for another reason, queue one follow-up pass.

### Existing-memory sweep

The policy version introduces a one-time background sweep for existing owner scopes.

At startup, a bounded discovery cursor queues scopes whose recorded maintenance version is older than the current policy. Discovery itself performs no model work and resumes across restarts. It must not enumerate all scopes into memory or launch an unbounded request burst.

Each successfully maintained scope records the applied policy version and final active-memory fingerprint. A failed or deferred scope remains eligible for retry.

### Scheduling and performance

Maintenance obeys the existing foreground-generation lease:

- do not start model work while foreground generation is active;
- pause between groups if foreground work begins;
- never cancel or delay the user’s current reply merely to tidy memory;
- process provider calls sequentially;
- preserve the existing exhaustive value groups and twelve-group consolidation budget;
- coalesce repeated triggers and process one owner at a time;
- yield between owners so other background queues can run.

Automatic maintenance does not require the Memory Console or any React component to be mounted.

## Automatic proposal application

The analyzer continues to produce non-overlapping validated proposals.

Automatic selection rules are:

- `discard`: select every valid low-value proposal;
- `keep_one`: select every valid exact or model-supported redundancy proposal;
- `combine`: select every valid detail-preserving replacement;
- `conflict`: never select and never mutate either source.

Before apply, revalidate every selected proposal against current source fingerprints. If any source is stale, abandon the entire preview and requeue the owner for fresh analysis.

Apply all selected proposals for one owner in one atomic storage operation, subject to the existing maximum proposal count. If more actionable proposals exist, apply the bounded batch and requeue the scope until a fixed point is reached.

A fixed point is a successful analysis with no actionable proposals. Before each analysis, hash the current eligible source IDs and their mutable expected-state fields. Keep the six most recent fingerprints: seeing any one again, including an `A -> B -> A` oscillation, stops the job as `failed` with `maintenance_oscillation` and performs no further apply. A drain applies at most three batches before yielding and rescheduling; a job may apply at most twelve batches in total, after which it stops as `failed` with `maintenance_pass_limit`. Those terminal diagnostics require a later material memory mutation or policy-version reset to clear the fingerprint/pass history, so an unchanged oscillating scope cannot spin indefinitely.

## Recovery and undo

Every automatic apply uses the existing cleanup batch journal and lifecycle records. Superseded or discarded rows are not hard-deleted.

The latest automatic batches remain undoable through memory history or an equivalent recovery surface. Undo is optional recovery, not a required maintenance step. Undoing a batch must suppress immediate reapplication long enough for the restored state to remain inspectable; the restored scope may be reconsidered only after a later material memory change or policy-version change.

## Product surface

Remove the workflow obligation represented by the current Tidy Memories action:

- no Analyze Memories step;
- no proposal checkboxes;
- no replacement editor;
- no Apply Cleanup button;
- no user-facing progress modal.

Memory management may retain a compact, non-blocking history entry such as “Memory maintenance combined 3 and removed 2,” with access to recovery details. Healthy no-op runs remain silent. Failures appear in diagnostics rather than repetitive toasts.

Discovery and help copy must describe automatic memory hygiene and must not instruct the user to run Tidy Memories.

## Architecture boundaries

- `src/engine/generation/automatic-memory-capture.ts` owns extraction and the pre-storage value gate orchestration.
- A focused React-free value-policy module owns shared prompts, schemas, normalization, and rejection rules.
- `src/engine/generation/memory-cleanup.ts` continues to own whole-scope model analysis.
- A new React-free maintenance queue module owns durable scheduling, coalescing, retries, fixed-point draining, and foreground-lease coordination.
- `src/engine/entities/memory-maintenance.ts` continues to own deterministic grouping, evidence, eligibility, and proposal validation.
- `src/shared/api` exposes only focused runtime wrappers required by the engine coordinator.
- `src-tauri` remains the embedded and hostable owner for atomic apply, undo, and any storage commands needed for bounded scope discovery or maintenance-version state.
- React feature code renders history/recovery state only; it does not own scheduling or policy.

Remote runtime parity is required for every new command. Embedded Tauri invocation, HTTP dispatch, request/response schema, and frontend wrapper must be implemented and tested together.

## Compatibility and migration

- Existing canonical memory rows and cleanup batches require no destructive migration.
- Existing active and pinned memories from every origin become eligible for the startup sweep.
- Existing inactive, deleted, wrong, stale, and superseded rows remain excluded.
- Existing imported data remains valid.
- The new queue collection and policy-version metadata are additive and recoverable.
- Older clients or runtimes that do not expose the required maintenance commands must fail closed: capture jobs stay retryable and maintenance does not pretend to apply.

## Verification

### Capture gate

Durable tests must prove:

- obvious and questionable low-value candidates never reach `createMemory`;
- durable candidates still preserve category, confidence, provenance, scope, and index refresh;
- mixed candidate groups create only survivors;
- malformed or failed value review creates nothing and leaves the job retryable;
- retry after a partial failure does not duplicate previously created memories;
- the capture and cleanup lanes use the same value-policy prompt and normalization.

### Queue

Durable tests must prove:

- triggers from every memory origin coalesce by owner;
- queue state survives restart;
- foreground generation prevents or pauses maintenance model work;
- a write during processing causes exactly one follow-up pass;
- cleanup apply does not recursively enqueue itself forever;
- owners process sequentially with bounded calls;
- retry, exhausted-attempt, cancellation, and stale-owner paths preserve data;
- startup discovery is bounded, resumable, and versioned.

### Automatic apply

Durable tests must prove:

- discard, keep-one, and combine proposals apply without UI interaction;
- pinned, manual, edited, imported, corrected, and command-created memories are eligible;
- conflicts remain unchanged without blocking disjoint actionable proposals;
- stale fingerprints cause reanalysis rather than partial apply;
- multi-batch fixed-point cleanup terminates;
- repeated fingerprints and pass budgets stop oscillation;
- every successful automatic batch can be undone.

### Product surface and parity

Tests must prove:

- no active UI or discovery copy tells users to run Tidy Memories;
- maintenance history is silent when healthy and exposes recovery after changes;
- embedded and remote runtimes share the same queue/apply contracts;
- app startup resumes both capture and maintenance work without requiring a mounted modal.

Run focused TypeScript and Rust tests, `pnpm typecheck`, `pnpm check:architecture`, `pnpm check:docs`, `cargo check --manifest-path src-tauri/Cargo.toml --workspace`, and the full `pnpm check` shipping baseline.

## Out of scope

- Hard-deleting lifecycle history.
- Guessing which side of an unresolved contradiction is true.
- Cross-owner consolidation.
- Making cleanup provider calls concurrent.
- Adding a user preference that disables automatic hygiene while Memory Recall remains enabled.
- Claiming subjective semantic classification is infallible.
