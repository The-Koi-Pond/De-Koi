# Remote Runtime Storage Read Availability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep De-Koi remote-runtime reads responsive while the Pi prepares large atomic storage replacements.

**Architecture:** Hold the existing atomic `WriteGate` across the transaction, but split slow replacement-file preparation from the short global-lock install phase. Preserve transaction manifests, rollback, cache publication, and storage formats, then skip the separate no-op `chats` rewrite during ordinary chat deletion.

**Tech Stack:** Rust, `std::sync::RwLock`, De-Koi file-storage transaction manifests, Cargo tests, Vitest/repo checks, Docker Pi deployment.

## Global Constraints

- Do not change frontend timeout policy or disable automatic maintenance.
- Do not change collection JSON, journal, checkpoint, backup, or transaction-manifest formats.
- Do not weaken atomic writer exclusion or crash recovery.
- Do not delete or mutate live user data for verification.
- Keep the PR limited to storage concurrency, the no-op chat rewrite, focused tests, and these approved design records.

---

### Task 1: Prove atomic preparation blocks reads

**Files:**
- Modify: `src-tauri/crates/storage/src/lib.rs`

**Interfaces:**
- Consumes: `FileStorage::update_collections_atomically`, `DIRTY_FLUSH_CLONE_TEST_HOOK` test-hook pattern.
- Produces: a deterministic regression proving reads finish while replacement temp files are being prepared.

- [ ] **Step 1: Add the failing concurrency test and test hook**

Add a `#[cfg(test)]` serialized hook invoked immediately before replacement rows are written to transaction temp files. The test creates `messages` and `personas`, starts an atomic `messages` update, pauses at the hook, starts `get("personas", "persona-1")`, and asserts the read completes within 250 ms before releasing preparation.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `cargo test --manifest-path src-tauri/Cargo.toml -p marinara-storage reads_continue_while_atomic_replacement_files_are_prepared -- --nocapture`

Expected: FAIL because the read cannot acquire the current global storage read lock until the preparation hook is released.

### Task 2: Prepare replacement files outside the global lock

**Files:**
- Modify: `src-tauri/crates/storage/src/lib.rs`

**Interfaces:**
- Consumes: `PendingCollectionReplacement`, transaction manifest/rollback helpers, `WriteGate::begin_atomic_update`, `CollectionContentStamp`.
- Produces: `prepare_collection_replacement_files` and `install_prepared_collection_replacements_locked` helper phases reused by atomic updates and `replace_all_many_locked`.

- [ ] **Step 1: Extract pure preparation**

Move path validation, duplicate-path rejection, temp/backup path construction, JSON streaming, buffer flush, and `sync_file` into `prepare_collection_replacement_files`. On any error, call `cleanup_pending_collection_temps` and return the original error. Do not recover journals, write a manifest, rename primaries, or publish cache state in this phase.

- [ ] **Step 2: Extract locked installation**

Move journal validation/recovery, checkpoint invalidation, manifest creation, backup/primary renames, rollback, commit marking, cleanup, read-model rebuild, cache replacement, and checkpoint preparation into `install_prepared_collection_replacements_locked`.

- [ ] **Step 3: Change the atomic update sequence**

While holding the atomic `WriteGate`, flush dirty target collections without the global `RwLock`; snapshot rows and content stamps under the lock; run the update closure; prepare requested replacements without the lock; reacquire the lock; reject changed stamps while cleaning prepared temps; then install the prepared transaction.

- [ ] **Step 4: Keep immediate replacement callers compatible**

Make `replace_all_many_locked` call the extracted prepare/install helpers while its existing callers continue to hold the global lock.

- [ ] **Step 5: Run the focused test and verify GREEN**

Run: `cargo test --manifest-path src-tauri/Cargo.toml -p marinara-storage reads_continue_while_atomic_replacement_files_are_prepared -- --nocapture`

Expected: PASS; the read returns the pre-commit persona while preparation is paused.

- [ ] **Step 6: Run atomic transaction regression tests**

Run: `cargo test --manifest-path src-tauri/Cargo.toml -p marinara-storage update_collections_atomically -- --nocapture`

Expected: all matching tests PASS, including queued writer, conflict, recovery, and read-only behavior.

### Task 3: Skip the no-op connected-chat rewrite

**Files:**
- Modify: `src-tauri/src/commands/storage/chats.rs`

**Interfaces:**
- Consumes: `disconnect_connected_chat`, `AtomicCollectionRows::rows`, `AtomicCollectionRows::rows_mut`.
- Produces: unchanged disconnect result with no collection replacement when no link or connected note changes.

- [ ] **Step 1: Add a failing no-op regression**

Create an unconnected chat, capture the `chats.json` content stamp, call `disconnect_connected_chat`, and assert the content stamp is unchanged while the command still reports `disconnected: true` for the requested chat.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `cargo test --manifest-path src-tauri/Cargo.toml -p de-koi disconnect_connected_chat_skips_unconnected_collection_rewrite -- --nocapture`

Expected: FAIL because `rows_mut()` currently marks the entire chat collection for replacement unconditionally.

- [ ] **Step 3: Implement immutable detection before mutation**

Compute partner IDs, link-clear IDs, and connected-note matches from `rows()`. Return the existing result immediately when no row requires a field or note change. Call `rows_mut()` only after a mutation is proven necessary, then apply the existing link/note cleanup.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run the Task 3 focused command again.

Expected: PASS.

### Task 4: Validate, review, and ship

**Files:**
- Review: all branch changes against `origin/main`.

**Interfaces:**
- Consumes: Tasks 1-3.
- Produces: merged PR and exact deployed Pi revision.

- [ ] **Step 1: Run lane validation**

Run:

```text
cargo test --manifest-path src-tauri/Cargo.toml -p marinara-storage
cargo check --manifest-path src-tauri/Cargo.toml
pnpm check:architecture
pnpm check
```

Expected: every command exits 0.

- [ ] **Step 2: Prove branch scope**

Run `git diff --check origin/main...HEAD`, `git diff --stat origin/main...HEAD`, and `git log --oneline origin/main..HEAD`.

Expected: only the approved storage/chat/tests/design files and coherent commits.

- [ ] **Step 3: Run Bunny review**

Review root cause, changed code, failure paths, regression proof, and PR wording. Expected: Bunny pass with no blocking findings.

- [ ] **Step 4: Publish and merge**

Push only to `origin`, open a ready PR targeting `The-Koi-Pond/De-Koi:main`, wait for required CI and current-head Bunny approval, then merge without force-push.

- [ ] **Step 5: Deploy and prove the Pi**

From `/home/chai/de-koi-src`, fast-forward `origin/main`, run `sh scripts/pi-update.sh --trusted-lan`, and verify matched web/server image labels, root HTTP 200, `/health?probe=1`, `/api/invoke`, and preserved `/data` plus `/root/.codex` mounts.

- [ ] **Step 6: Re-run the mobile command trace**

Load the Pi with an Android Chrome profile and verify startup reads complete below the 15-second remote deadline while a representative non-destructive storage replacement harness is active. Record any remaining manual-only mobile gap honestly.
