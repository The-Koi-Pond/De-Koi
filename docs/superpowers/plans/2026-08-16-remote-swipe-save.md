# Remote Swipe Save Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make regenerated-message swipe saves fast on large Pi histories and prevent a completed durable remote save from being reported as a timeout.

**Architecture:** Add a grouped record-upsert path whose global journal atomically commits message, swipe, and affected chat-memory rows, while record-local journals expose them without foreground primary rewrites. Route only add-swipe mutations through that fast path, and opt that durable remote command out of the finite client deadline.

**Tech Stack:** Rust, serde_json storage journals, TypeScript, Vitest, Tauri/HTTP shared runtime adapters.

## Global Constraints

- Preserve the `chat_message_add_swipe` command, payload, return shape, embedded behavior, and explicit remote HTTP pipeline.
- Preserve full atomic replacement for swipe deletion, reordering, and arbitrary message replacement.
- Do not retry, fake success, swallow errors, change the global remote deadline, or mutate live user chat data for verification.
- Keep the implementation within `src-tauri` storage ownership and `src/shared/api` runtime-wrapper ownership.

---

### Task 1: Add grouped journal upserts for related records

**Files:**

- Modify: `src-tauri/crates/storage/src/lib.rs`

**Interfaces:**

- Consumes: `FileStorage::append_many_uncached`, `append_journal::append_transaction`, `append_collection_mutation`, and `CollectionMutation::UpsertMany`.
- Produces: `upsert_many_journaled_with_record` behavior that updates the current related record under the write gate, atomically commits all rows, exposes them through record-local journals, updates caches without duplicates, and retains restart recovery.

- [ ] **Step 1: Write the failing storage regression**

Add a focused test that seeds related message, swipe, and chat records, warms their caches, calls:

```rust
storage.upsert_many_journaled_with_record(
    vec![("messages", vec![updated_message]), ("message-swipes", updated_swipes)],
    "chats",
    chat_id,
    update_chat,
)?;
```

Assert live reads contain the updated rows, all primary files remain byte-identical, and reopening storage yields the same records without duplicates.

- [ ] **Step 2: Run the regression and verify RED**

Run: `cargo test --manifest-path src-tauri/crates/storage/Cargo.toml upsert_many_journaled_commits_related_records_without_rewriting_primaries`

Expected: FAIL because the grouped journal-upsert API does not exist.

- [ ] **Step 3: Implement journal-backed replacement application**

Add `upsert_many_journaled_with_record`. Validate the complete write set, write one short-lived grouped commit marker, then expose each collection through:

```rust
append_collection_mutation(
    &self.root.join("collections"),
    collection,
    &CollectionMutation::UpsertMany { records: replacements },
)?;
```

Update dirty cached rows in place and invalidate clean caches. Remove the grouped marker only after every record journal is durable, preserve chat-summary read-model handling, and retain synchronous recovery on an application error.

- [ ] **Step 4: Run the storage regression and verify GREEN**

Run: `cargo test --manifest-path src-tauri/crates/storage/Cargo.toml upsert_many_journaled_commits_related_records_without_rewriting_primaries`

Expected: PASS with one current row before and after restart.

### Task 2: Route add-swipe persistence through the journal fast path

**Files:**

- Modify: `src-tauri/src/commands/storage/message_swipes.rs`
- Modify: `src-tauri/src/commands/storage/chats.rs`

**Interfaces:**

- Consumes: the upsert-capable `FileStorage::append_many_uncached` contract from Task 1.
- Produces: `message_swipe_storage::append_message_with_swipes_and_update_record(...) -> AppResult<Value>` for append-only swipe mutations.

- [ ] **Step 1: Write the failing swipe persistence regression**

Add a focused `message_swipes` test with a chat memory, target message, unrelated large sibling, and one existing swipe. Capture all three primary files, append a new active swipe through the public storage command helper, then assert:

```rust
assert_eq!(fs::read(&messages_path)?, messages_before);
assert_eq!(updated["swipeCount"], json!(2));
assert_eq!(updated["content"], json!("new swipe"));
```

Drop and reopen storage, materialize the message, and assert both swipes, active content, per-swipe metadata, and the unrelated sibling remain intact.

- [ ] **Step 2: Run the swipe regression and verify RED**

Run: `cargo test --manifest-path src-tauri/Cargo.toml message_swipes_append_uses_record_local_journals_and_survives_restart`

Expected: FAIL because `replace_message_with_swipes` rewrites the complete `messages` and `message-swipes` collections.

- [ ] **Step 3: Implement the append-only helper**

Add `append_message_with_swipes_and_update_record` beside `replace_message_with_swipes`. It prepares the updated parent and sidecars with the existing normalization helpers, updates the current chat record inside the same storage write gate, commits all changed rows through the grouped journal, and materializes the result. Change only the add-swipe branch in `chats::message_swipes` to supply the memory-invalidation callback. Gate the fast path to canonical sidecar IDs; retain full replacement cleanup for legacy embedded or noncanonical rows.

- [ ] **Step 4: Run the swipe and adjacent Rust tests**

Run:

```powershell
cargo test --manifest-path src-tauri/Cargo.toml message_swipes_append_uses_record_local_journals_and_survives_restart
cargo test --manifest-path src-tauri/Cargo.toml message_swipes_preserves_blank_lines_in_new_swipe_content
cargo test --manifest-path src-tauri/Cargo.toml message_swipes_store_per_swipe_extra_and_preserve_previous_active_extra
```

Expected: all PASS.

### Task 3: Remove the false client deadline for durable swipe saves

**Files:**

- Modify: `src/shared/api/storage-api.spec.ts`
- Modify: `src/shared/api/storage-api.ts`

**Interfaces:**

- Consumes: `invokeTauri(command, args, { timeoutMs?: number | null })`.
- Produces: `storageApi.addChatMessageSwipe` with unchanged arguments/result and `{ timeoutMs: null }` for remote execution.

- [ ] **Step 1: Write the failing TypeScript regression**

Change the existing chat-message-write assertion to require:

```ts
expect(invokeTauriMock).toHaveBeenNthCalledWith(
  2,
  "chat_message_add_swipe",
  {
    chatId: "chat-1",
    messageId: "message-blank",
    body: expect.objectContaining({ content: "Alt 1\n\n\nAlt 2" }),
  },
  { timeoutMs: null },
);
```

- [ ] **Step 2: Run the regression and verify RED**

Run: `pnpm vitest run src/shared/api/storage-api.spec.ts`

Expected: FAIL because the wrapper currently supplies only the command and payload.

- [ ] **Step 3: Implement the scoped timeout opt-out**

Change only `addChatMessageSwipe` to call:

```ts
invokeTauri(
  "chat_message_add_swipe",
  { chatId, messageId, body: chatMessageSwipeBody(content, options) },
  { timeoutMs: null },
);
```

- [ ] **Step 4: Run the TypeScript regression and verify GREEN**

Run: `pnpm vitest run src/shared/api/storage-api.spec.ts`

Expected: PASS.

### Task 4: Validate, review, and ship the coupled fix

**Files:**

- Create: `.github/pr-evidence/remote-swipe-save/proof-ledger.json`
- Review: all changed source, tests, design, and plan files.

**Interfaces:**

- Consumes: completed Tasks 1-3.
- Produces: a reviewable PR proving the live symptom, storage performance boundary, remote deadline behavior, and recovery invariants.

- [ ] **Step 1: Run focused and lane validation**

Run:

```powershell
pnpm vitest run src/shared/api/storage-api.spec.ts
cargo test --manifest-path src-tauri/crates/storage/Cargo.toml upsert_many_journaled_commits_related_records_without_rewriting_primaries
cargo test --manifest-path src-tauri/Cargo.toml message_swipes
pnpm typecheck
pnpm check:architecture
cargo check --manifest-path src-tauri/Cargo.toml
pnpm check
```

Expected: all commands exit 0; review the warning-only unused-code output from `pnpm check`.

- [ ] **Step 2: Run Bunny and inspect the final diff**

Verify `git diff --check origin/main...HEAD`, changed-file scope, storage recovery/error paths, TypeScript command shape, and Bunny's current final-head verdict. Fix any in-scope finding and rerun affected checks.

- [ ] **Step 3: Commit, push, and open the ready PR**

Stage only the intended files and commit with subject `Fix remote swipe save timeouts`. Push only to `origin`, use the repository PR template, include the live Pi `30.016s`/HTTP `499` evidence, and mark ready once local gates and Bunny's pre-PR pass are clean.

- [ ] **Step 4: Merge and deploy exact images**

After required hosted checks and final-head Bunny pass, merge to `main`, wait for both exact merge-SHA images, update the Pi's De-Koi checkout with `scripts/pi-update.sh --trusted-lan`, and verify both image labels, root HTTP, writable health, zero restart/OOM state, and preserved `/data` plus `/root/.codex` mounts. Do not mutate a real chat merely to prove deployment.
