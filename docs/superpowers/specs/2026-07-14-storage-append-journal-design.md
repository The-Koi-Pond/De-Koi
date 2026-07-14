# Storage Append Journal Design

Issue: #1018
Owner: `src-tauri/crates/storage` Rust capability

## Problem

`FileStorage::append_many_uncached` commits a newly created message and its initial swipe by staging a complete replacement for both JSON collections. Each foreground create copies and synchronizes the historical `messages` and `message-swipes` files, refreshes complete backups, installs the replacements, and synchronizes transaction metadata. The foreground cost is therefore proportional to total history rather than the new records.

The direct Raspberry Pi 3 control in #983 isolates this path: median individual creates take 8.851–11.576 seconds even with generation and UI work bypassed.

## Chosen design

Keep the canonical JSON collections and their existing read paths, but add a storage-owned append transaction journal for the multi-collection fast path.

1. A single versioned journal entry contains every collection append in one logical transaction. The journal entry is written and synchronized before either collection is changed.
2. The prepared records are appended in place at the closing bracket of each validated JSON array and each file is synchronized. The work performed here is proportional to the serialized new records.
3. The journal remains as recovery evidence until a checkpoint refreshes the collection backups. A checkpoint is maintenance work, not part of normal message creation.
4. Startup replays journal entries idempotently. A valid primary is the preferred base; an unreadable primary is recovered from its checkpoint backup. The journal is removed only after every affected primary and backup is durable.
5. Non-append replacement paths checkpoint pending appends before superseding the affected collections, preserving mutation order.
6. The fast path is limited to the `messages` and `message-swipes` lifecycle owners. Unsupported collections and non-regular or non-array-shaped files decline the fast path before a journal commit.

The first use on an existing data directory may need to establish a trustworthy checkpoint backup. That is a one-time migration cost and must not recur for every created message.

## Crash-safety invariant

The synchronized journal entry is the commit point. Before De-Koi makes storage available after an interruption, replay must produce both the message and its initial swipe, or fail closed while retaining the recovery evidence. Replay is idempotent by record ID, so an interruption during replay can be retried safely.

If bounded application fails and synchronous replay also fails, the live storage handle rejects later reads and writes until restart. Recovery uses the checkpoint backup when an interrupted repair leaves a primary missing, and it synchronizes recovered primary and backup directory entries before clearing the journal.

The journal file is also the checkpoint marker. Its first creation follows synchronized backup refreshes; while it contains pending entries, those pre-journal backups are preserved rather than refreshed from a possibly partial primary. A missing or empty required backup fails closed before another append, and startup never returns a storage handle after append-journal recovery failure.

## Rejected approaches

- Removing synchronization or backups would reduce latency by weakening acknowledged-write durability.
- Keeping the current transaction but deleting one of its full copies would still make every create proportional to collection size.
- Moving all message storage to SQLite or a new sharded format would solve scaling more broadly, but requires a much larger migration and compatibility surface than this bug.

## Verification

- A focused regression test creates large historical collection files and proves the fast path does not create collection-sized staging artifacts or rewrite their historical prefixes.
- Recovery tests interrupt after the journal commit and after only one collection append, then prove startup restores the complete pair.
- Existing transaction, journal, message/swipe, corruption, and concurrency tests remain green.
- Run the Rust storage tests, `cargo check --manifest-path src-tauri/Cargo.toml`, `pnpm check:architecture`, and the full `pnpm check` shipping gate.
