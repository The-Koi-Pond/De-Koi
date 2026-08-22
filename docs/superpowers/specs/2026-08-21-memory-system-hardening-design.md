# Memory System Hardening Design

## Goal

Prevent concurrent Memory Recall work from losing or corrupting memories, prevent duplicate automatic-capture workers across runtimes, and keep recall and capture costs bounded as chats and canonical-memory collections grow.

## Scope

This change repairs six findings on `origin/main` at `20f480fd51e892ce3b75c4778b0e107404e75263`:

1. Chat-memory commands replace a previously read array after awaiting embedding work, so overlapping mutations can erase each other.
2. Automatic-capture worker ownership exists only in one JavaScript realm, so multiple tabs or devices can process the same durable job.
3. Canonical recall always performs the durable fallback query even when the canonical index is usable.
4. Automatic capture loads an entire chat transcript to retain at most six reference messages.
5. Canonical index queries mark a memory ID as seen before validating row freshness, allowing a stale row to hide a fresh row.
6. Automatic-capture jobs and canonical consequences use collision-prone 32-bit deterministic identifiers.

The existing Memory Recall model remains intact: recall runs before generation, automatic capture runs after a saved assistant response, chat memories remain embedded in the chat record, and canonical memories remain the source of truth over rebuildable index rows.

## Architecture

### 1. Atomic chat-memory mutations

Embedding input may be prepared outside the storage write gate, but the final memory-array change must operate on the latest chat record inside one atomic storage mutation. A new storage helper will accept a chat ID and a narrowly scoped mutation closure, load the current `memories` value under `Storage::patch_with`, apply only the requested create, update, delete, correction, capture, or maintenance transformation, and write the resulting array before releasing the gate.

Each command will stop carrying an old full-array snapshot across an `await`. For edits to one existing memory, the command will preserve the validation performed against the current record at mutation time. Automatic capture will continue to identify its target by source-message chunk key and will replace only that matching automatic memory. Maintenance refresh will merge refreshed values by stable memory ID into the latest array so manual mutations that occurred during embedding are retained.

The contract does not introduce silent retries or fake success. If the target memory was removed or became ineligible before the atomic mutation, the command returns the existing not-found or invalid-input error instead of resurrecting it.

### 2. Durable automatic-capture worker lease

The automatic-capture queue will use a server-owned lease rather than treating JavaScript `WeakSet` state as global ownership. Storage will expose acquire, renew, and release operations for a single automatic-capture worker lease containing an owner token, lease expiry, and unique fencing token. The implementation will follow the existing automatic-memory-maintenance lease pattern and use the same clock and storage durability conventions.

A queue pass must acquire the lease before listing or claiming jobs. Only the current owner and fence may mark jobs completed, retryable, failed, or stale. An expired lease may be taken over after a crash or browser close. The existing in-realm `WeakSet` remains only as a cheap duplicate-scheduling guard; it is no longer the correctness boundary. A `processing` job is runnable only when its claim lease has expired, not immediately merely because its status is `processing`.

Storage-list failures remain visible to the scheduler. They schedule a bounded retry instead of being converted into an empty queue that can remain asleep until another user message.

### 3. Canonical-index completeness contract

Canonical recall will be index-first without giving up correctness during migration or repair. The Rust index query response will include both matching rows and whether the lexical projection is complete for the queried canonical collection revision. Canonical-memory create, update, delete, migration, and index rebuild paths will update the projection revision/completeness marker in the same durable owner boundary as their canonical/index writes.

The TypeScript recall path will use index rows alone when storage reports a complete projection. It will request durable canonical rows only when the projection is unavailable, explicitly incomplete, or being repaired. Older remote runtimes that expose the legacy array-only query remain compatible: they are treated as completeness unknown and retain the existing safe fallback.

The candidate cap remains applied after scope ordering and relevance scoring. This work does not weaken status, scope, supersession, or semantic-threshold filtering.

### 4. Bounded reference-message paging

Automatic capture will page backward from the first source message instead of loading the whole chat. Each request will use descending timestamp order, an exclusive `before` cursor, projected fields, and a small page limit. It will skip source messages, hidden messages, and unusable rows while collecting the newest six eligible preceding messages, then restore chronological order for the capture prompt.

Paging stops when six eligible messages are found, storage is exhausted, or a fixed scan ceiling is reached. The ceiling prevents chats dominated by hidden or empty records from recreating the original unbounded behavior. Source-message snapshots and speaker-label behavior do not change.

### 5. Fresh-row index deduplication

Rust canonical index queries will add a memory ID to `seen` only after loading the canonical record, confirming `canonicalUpdatedAt` matches `updatedAt`, and confirming the record is eligible for at least one requested query. A stale provider row therefore cannot suppress a fresh lexical row for the same memory. Single and batch query paths will share the same ordering rule.

### 6. Collision-safe deterministic IDs

New capture jobs and canonical consequences will use a full deterministic SHA-256 digest of their existing identity strings. Determinism preserves idempotent enqueue and consequence update behavior across restarts and runtimes.

Compatibility lookup will compute the legacy 32-bit ID as well. An existing legacy record is reused only when its stored chat/source identity or canonical semantic identity exactly matches the requested identity. A legacy-ID collision is treated as unrelated data and never suppresses or overwrites the new record. Existing records are not bulk-renamed.

Rust-generated canonical projection identifiers will use the same collision-safe digest convention for newly rebuilt rows while continuing to read and remove legacy projection rows by their stored memory relationship.

## Interfaces and ownership

- `src-tauri/src/commands/storage/chat_memory.rs` owns atomic embedded chat-memory transformations.
- `src-tauri/src/commands/storage/memory_maintenance/jobs.rs` remains the reference for durable lease and fence semantics; capture-specific commands use a distinct lease identity.
- `src/engine/generation/automatic-memory-capture-queue.ts` owns capture scheduling, lease lifecycle, legacy-ID compatibility, and job state transitions.
- `src-tauri/src/commands/storage/canonical_memory.rs` owns canonical index freshness, completeness, and projection IDs.
- `src/engine/generation/canonical-memory-context.ts` consumes the completeness signal and decides whether a durable fallback is required.
- `src/engine/generation/automatic-memory-context.ts` owns bounded reference-message paging.
- Shared hashing code will live in one engine utility rather than duplicating SHA-256 and legacy-hash behavior across capture modules.

No React UI, prompt wording, model-provider behavior, memory extraction criteria, or user-facing notification copy changes.

## Error handling and compatibility

- Lease acquisition failure defers capture without failing foreground generation.
- Lease renewal or fence loss stops the worker before it commits another job result.
- Storage outages schedule a bounded retry and preserve the durable job.
- Legacy array-only index responses retain the current conservative fallback.
- Legacy 32-bit records are reused only after exact identity verification.
- Atomic mutation errors propagate to the caller; no catch converts a failed write into success.
- Existing chat and canonical-memory persisted shapes remain readable without a bulk migration.

## Verification

- Rust concurrency tests coordinate two mutations so both read before one embedding completes, then prove both intended memories survive.
- Rust tests prove maintenance refresh merges into the latest memory array and cannot resurrect a removed memory.
- Queue tests run two independent gateway/runtime instances against one durable store and prove only one lease owner processes a job.
- Queue tests prove expired ownership can be recovered and stale fences cannot complete work.
- Scheduler tests prove a transient storage-list error schedules another pass.
- Canonical-context tests prove complete indexes skip durable scans, incomplete/legacy responses retain fallback, and scope ordering is unchanged.
- Automatic-context tests prove the first read is bounded, paging stops after six eligible messages, hidden/source rows are skipped, and the scan ceiling is enforced.
- Rust index tests cover stale-then-fresh and fresh-then-stale row order for single and batch queries.
- Hash tests prove the known legacy collision receives distinct SHA-256 IDs and a colliding legacy record is not reused without exact identity.
- Focused Vitest and Rust memory tests run after each red-green slice, followed by `pnpm typecheck`, `pnpm check:architecture`, `cargo test --manifest-path src-tauri/Cargo.toml --workspace`, and the repository-required full checks before shipping.

## Non-goals

- Replacing canonical memories with a new schema or database.
- Changing which facts automatic extraction accepts.
- Rewriting existing memory content or attribution.
- Adding UI for queue leases or index health.
- Deleting real user data for live verification.

## Self-review

The design covers all six reported findings, keeps each correctness boundary with its durable owner, preserves older runtime compatibility, and avoids a bulk storage migration. The only intentional behavior change is that incomplete reference history beyond the scan ceiling is omitted rather than allowing one capture to scan an unbounded transcript.
