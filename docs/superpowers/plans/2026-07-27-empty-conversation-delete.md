# Empty Conversation Delete Implementation Plan

> **Execution:** Implement inline in this session; repository instructions do not authorize agent delegation.

**Goal:** Make empty conversation deletion fast and make timeout reconciliation truthful.

**Architecture:** Detect a no-op inside the Rust message/swipe atomic boundary and let read-only atomic updates skip file replacement, then make the React Query mutation distinguish ambiguous remote timeouts from definite failures.

**Tech Stack:** Rust, TypeScript, React Query, Vitest, cargo test.

## Task 1: Lock the storage regression

- Add a focused test beside `delete_message_rows_for_chats_with_swipes`.
- Seed unrelated messages and swipes, delete an absent chat ID, and prove collection files are unchanged.
- Run the test and confirm it fails before implementation.

## Task 2: Add the race-free empty-chat fast path

- Track whether `AtomicCollectionRows::rows_mut` is requested and skip replacement when every transaction row set stays read-only.
- Inspect `messages` and `message-swipes` inside the existing atomic boundary.
- Return `0` without requesting mutable rows when both collections lack chat-owned data.
- Preserve the existing atomic path otherwise.
- Run focused message/swipe tests.

## Task 3: Lock timeout cache behavior

- Add hook tests around `useDeleteChat`.
- Prove optimistic removal survives `remote_runtime_timeout`.
- Prove a normal error restores the prior list and summary data.
- Run the test and confirm the timeout case fails before implementation.

## Task 4: Reconcile ambiguous timeouts

- Add a narrow `ApiError` detail-code classifier.
- Skip snapshot restoration only for `remote_runtime_timeout`.
- Keep settled invalidation as the authoritative reconciliation.
- Run focused frontend tests and type checking.

## Task 5: Verify and ship

- Run architecture, storage, frontend, deterministic, and relevant full checks.
- Record the risky-storage proof ledger and perform local Bunny review.
- Commit, push to `origin`, open the PR, satisfy CI and hosted Bunny, and merge to `main`.

## Task 6: Update and prove the Pi

- Deploy the exact merged revision using the trusted-LAN update workflow.
- Verify server/web image revisions, health, container state, and preserved mounts.
- Reload the live UI to clear stale ghosts.
- Create and delete one disposable empty conversation, verify immediate removal, wait past 30 seconds, reload, and confirm storage remains empty for that ID.
