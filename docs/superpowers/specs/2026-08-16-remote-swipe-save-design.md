# Remote Swipe Save Design

## Problem

On the live Pi, the latest `The Freak Circus - All Five` regeneration finished its model and web-research work, then spent 30.016 seconds in `chat_message_add_swipe`. The mobile browser's 30-second finite remote-runtime deadline aborted the HTTP request, so nginx recorded `499` while the Rust server completed the save. The final 442-character reply was present as the second swipe even though De-Koi reported failure.

The delay is caused by the add-swipe path calling `update_collections_atomically` for `messages`, `message-swipes`, and `chats` when the newly visible content invalidates derived chat memories. On the Pi the first two files alone are approximately 26.6 MB and 27.3 MB. A one-message mutation therefore materializes, serializes, backs up, and replaces complete collections. Normal generated-message creation already uses the append checkpoint/journal path and does not pay this cost.

## Design

Add `FileStorage::upsert_many_journaled_with_record` for grouped record upserts. A short-lived transaction marker is the crash-recovery commit record across `messages`, `message-swipes`, and an affected `chats` record. Each committed row is exposed through the existing record-local pending journal, then the grouped marker is removed, so the foreground request does not rewrite any primary collection. Clean caches are invalidated and dirty caches receive the same upserts. Recovery is idempotent because record journals use `CollectionMutation::UpsertMany` semantics.

Add a message-swipe-specific fast path that uses this journal transaction only for appending a swipe to canonical sidecar rows. Inside the storage write gate and before commit, it loads the current chat record and computes memory invalidation so concurrent metadata is preserved and validation failures still roll back the whole operation. It then writes the updated parent message, deterministic sidecar rows, and changed chat record together before materializing the public message result. Legacy embedded or noncanonical swipe rows retain the existing full cleanup path, and other swipe operations that can remove or reorder sidecars keep the existing full atomic replacement path.

At the TypeScript runtime wrapper, call `chat_message_add_swipe` with `{ timeoutMs: null }`. This durable mutation cannot be rolled back by a browser abort; if storage is unusually slow again, the UI must wait for the real result instead of inventing a failure. The global timeout and all unrelated commands remain unchanged.

## Data And Error Flow

1. Generation finishes and calls `storageApi.addChatMessageSwipe`.
2. The remote request has no client deadline but still reports genuine HTTP, network, and server errors.
3. Rust materializes the target message, appends the new swipe, and prepares the updated parent plus deterministic sidecar rows.
4. Any affected chat-memory record is calculated and validated before persistence.
5. The grouped transaction marker durably commits all related record upserts.
6. Record-local journals expose the committed rows immediately while leaving the primary files untouched.
7. Startup recovery replays the global transaction idempotently if the process stops between commit and application.

## Compatibility And Scope

- Preserve command name, payload, return shape, active-swipe behavior, per-swipe metadata, blank lines, embedded Tauri behavior, and remote HTTP dispatch.
- Preserve full atomic replacement for deletion, reordering, and arbitrary replacement paths.
- Do not retry, fake success, swallow errors, change the global remote deadline, or modify user chat content during live verification.
- No discovery or user documentation update is needed because this restores expected save behavior without adding a discoverable feature.

## Verification

- TypeScript regression: `storageApi.addChatMessageSwipe` forwards the exact command payload with `{ timeoutMs: null }`.
- Storage regression: grouped journal upserts update message, swipe, and chat records without rewriting primaries or creating duplicates, and survive restart recovery.
- Swipe regression: appending a swipe leaves all three primary files unchanged, preserves unrelated rows, prunes affected memory, materializes both swipes, and survives reopening storage.
- Focused Vitest and Rust tests, `pnpm typecheck`, `pnpm check:architecture`, `cargo check --manifest-path src-tauri/Cargo.toml`, and full `pnpm check` before push.
- After merge and exact-image publication, verify Pi image revisions, health, mounts, restart/OOM state, and non-destructively confirm the deployed runtime contract.
