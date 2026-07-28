# Empty Conversation Delete Design

## Goal

Make an empty conversation delete complete promptly on the Raspberry Pi and prevent an ambiguous remote-runtime timeout from restoring conversation rows that the server already deleted.

## Confirmed failure

The live Pi showed multiple `New Conversation` rows in the sidebar while only one remained in storage. Deleting the remaining empty chat started a storage transaction that rewrote the full `messages` and `message-swipes` collections even though neither contained a row for that chat. When the browser's 30-second remote-runtime deadline expired, the conversation mutation restored its full pre-delete React Query snapshots, including rows that were already absent from storage.

## Chosen fix

At the Rust message/swipe cleanup owner, inspect the two collections inside the existing atomic update for rows associated with the requested chat IDs. If no matching message and no matching sidecar exists, return without requesting mutable rows. `AtomicCollectionRows` records whether `rows_mut` was requested, allowing `update_collections_atomically` to return without replacing files for a read-only transaction. If either collection contains related rows, preserve the existing atomic cleanup, including sidecar removal by deleted message ID.

At the conversation catalog mutation owner, classify `ApiError` values whose detail code is `remote_runtime_timeout`. This error is ambiguous: the server may still finish the destructive operation after the browser gives up. Keep the optimistic removal for that error and let the existing settled invalidations reconcile against storage. Continue restoring snapshots for definite failures.

## Safety and compatibility

- The storage delete API, response shape, and remote-runtime timeout remain unchanged.
- Non-empty chat deletion keeps the existing atomic message/swipe transaction.
- Empty chats with stale swipe sidecars still use the atomic cleanup path.
- Definite errors still restore the previous sidebar state.
- Conversation, roleplay, and game chats share the corrected storage cleanup; only the conversation catalog's cache lifecycle changes.

## Proof

- Rust regressions prove a read-only atomic transaction and an empty chat do not rewrite either large collection.
- Existing Rust coverage proves messages and sidecars still delete atomically.
- Hook regressions prove a timeout does not resurrect a row and a definite failure still does.
- Architecture, TypeScript, focused tests, storage tests, repository checks, Bunny review, CI, and a live Pi browser repro gate shipping.
