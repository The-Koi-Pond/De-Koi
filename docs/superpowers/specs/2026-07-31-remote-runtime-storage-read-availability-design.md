# Remote Runtime Storage Read Availability Design

## Problem

On the Raspberry Pi, a chat deletion held De-Koi's global storage `RwLock` while large `messages`, `message-swipes`, and sometimes `chats` collection replacements were serialized and synced to disk. The observed delete took 56.5 seconds. Concurrent Android Chrome `storage_list` and `storage_get` requests waited 18-21 seconds, crossed the 15-second remote-runtime deadline, and were cancelled as HTTP 499 responses.

The network, web listener, container health, memory, and ordinary read latency were healthy. The failure begins only while an atomic storage replacement owns the global lock.

## Approved Behavior

- Preserve atomic, crash-recoverable multi-collection writes.
- Preserve write serialization: no writer may enter while an atomic replacement is staged or installed.
- Allow readers to keep using the last authoritative cached or on-disk state while replacement JSON is serialized and synced to transaction temp files.
- Acquire the global storage write lock only for the short validation and transaction-install phase.
- Do not rewrite `chats.json` when disconnecting a chat that has no connected-chat relationship or connected-note cleanup.
- Keep frontend remote-runtime deadlines, automatic memory maintenance, Narrative Craft, storage formats, and Pi data mounts unchanged.

## Architecture

`FileStorage::update_collections_atomically` continues to own the transaction. Its `WriteGate` atomic permit remains held from the initial snapshot through commit, so other writers cannot invalidate the transaction. Dirty target collections are flushed before the snapshot without the global `RwLock`, matching the existing deferred-compaction rule that readers use authoritative dirty cache rows.

Replacement preparation becomes a distinct phase. It validates paths, serializes replacement rows to transaction temp files, flushes buffers, and calls `sync_file` without holding the global `RwLock`. Readers therefore continue to see the pre-commit state. After preparation, the method acquires the global write lock, revalidates collection content stamps, writes the transaction manifest, atomically renames the prepared files, updates caches/read models, commits the manifest, and releases the lock.

The existing `replace_all_many_locked` entrypoint reuses the same preparation/install helpers but retains its current caller-visible locking behavior. This keeps imports and other immediate replacement paths unchanged.

`disconnect_connected_chat` first computes whether any chat link or connected note needs mutation using immutable rows. It calls `rows_mut()` only when a real change exists, so the storage transaction's existing read-only fast path skips replacement for ordinary unconnected chats.

## Failure Handling

- Preparation failure removes every prepared temp file and leaves primary collections untouched.
- A content-stamp conflict after preparation removes temp files and returns `storage_conflict`.
- Install failure follows the existing rollback and recovery-manifest path.
- Cache publication remains after successful installation, so readers never observe a partially installed multi-collection state.

## Verification

A deterministic Rust concurrency regression pauses transaction-file preparation. A simultaneous read must complete before preparation is released; the current implementation fails because preparation pauses while holding the global write lock. Existing atomicity, queued-writer, recovery, and backup tests must remain green.

A focused chat regression proves disconnecting an unconnected chat does not request a write. Full storage crate tests, architecture checks, Rust checks, repo checks, Bunny review, CI, exact-revision Pi deployment, and live mobile `/api/invoke` latency complete the shipping gate.
