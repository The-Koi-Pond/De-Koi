# Memory Reliability Slice Design

## Goal

Make De-Koi's automatic memory pipeline truthful and self-recovering:

- canonical memories remain recallable after create, edit, restore, pin, and automatic capture;
- retryable capture jobs run when their backoff expires without requiring another user message;
- a reply shows a safe `remembering`, `retrying`, or `memory unavailable` state while capture is unfinished or failed.

The slice does not add queue retention cleanup, multi-window atomic job claims, scene-scope repair, or global-index performance work.

## Architecture

### Canonical storage and index

`canonical_memory.rs` owns the durable invariant. Canonical record creation and index-affecting updates replace `canonical-memories` and `memory-index-rows` together with `update_collections_atomically`. Active and pinned records receive a fresh lexical row in the same transaction; inactive records have their rows removed.

Recall also unions valid canonical-query rows with index-query rows. This keeps legacy or previously unindexed records recallable and deduplicates by canonical memory ID. The index remains ranking metadata, not an authority that can hide durable records.

### Capture scheduling

`automatic-memory-capture-queue.ts` owns retry timing. After every scheduled worker pass it inspects the durable queue:

- due `pending`, `processing`, or `retryable` work schedules an immediate follow-up;
- future retryable work installs one timer for the earliest `nextAttemptAt`;
- a new enqueue or foreground-generation release cancels an obsolete timer and schedules the earlier work;
- no terminal-only queue installs a timer.

Source validation runs inside the same retry boundary as refresh, extraction, persistence, and message metadata updates.

### User-visible lifecycle

The assistant message stores a sanitized lifecycle record with the durable job ID:

- `processing`: memory capture is running;
- `retryable`: capture failed transiently and includes only attempt count and next retry time;
- `failed`: the bounded attempts were exhausted and exposes a generic `capture_unavailable` category;
- `completed`: preserves the existing capture and consequence details.

Raw provider/storage errors remain in the internal job record and never enter message UI. A lifecycle event invalidates the affected chat-message query so delayed retry transitions become visible without reopening the chat.

## Error handling

- Canonical storage/index mutation succeeds or fails as one host-side transaction.
- A failed assistant-message status patch does not falsify the durable job state; it is recorded as an internal synchronization error.
- Scheduler inspection failure stops that scheduling attempt instead of busy-looping.
- Timer callbacks re-enter the normal foreground/active-worker gates.

## Verification

- Rust regression: editing one of two indexed memories leaves both queryable and the edited row current.
- TypeScript regression: partial legacy index coverage still returns indexed and unindexed canonical memories.
- Scheduler regressions: more than ten jobs self-drain; a transient failure retries at `nextAttemptAt` without a new generation.
- Queue regressions: retryable and terminal failures patch safe message lifecycle states.
- Component regressions: retrying and failed chips render safe copy without raw errors.
- Cross-lane checks: focused tests, `pnpm typecheck`, `pnpm check:architecture`, `cargo check --manifest-path src-tauri/Cargo.toml`, and full `pnpm check`.

