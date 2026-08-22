# Memory System Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make De-Koi memory mutation, automatic capture, indexing, and reference-context reads safe under concurrency and bounded as stored history grows.

**Architecture:** Keep chat memories embedded in their existing chat record, but move every final array transformation under Rust storage's write gate. Reuse the automatic-maintenance lease pattern for capture, add an explicit persisted lexical-index completeness marker, page reference messages, and replace new 32-bit identities with deterministic SHA-256 while retaining verified legacy lookup.

**Tech Stack:** TypeScript, Vitest, Rust, Tauri commands, Marinara append-journal storage, SHA-256 via Web Crypto and `sha2`.

**Status:** Implemented and verified on 2026-08-21. The checkboxes below preserve the original execution recipe; final proof is recorded in the task handoff.

## Global Constraints

- Preserve the existing Memory Recall two-pass behavior and all persisted chat/canonical-memory shapes.
- Preserve compatibility with older remote runtimes: optional new read capabilities fall back safely; missing capture-lease capability defers background capture instead of running unfenced.
- Do not add silent catches, fake success, bulk migrations, UI changes, prompt changes, or real-user-data deletion.
- Work only in `D:\dev\Marinara-Engine\.worktrees\memory-system-hardening`.
- Do not commit, push, create a PR, or change the dirty primary checkout without separate authorization.

---

### Task 1: Atomic Chat-Memory Mutation Owner

**Files:**

- Modify: `src-tauri/src/commands/storage/chat_memory.rs`
- Modify: `src-tauri/src/commands/storage/memory_maintenance/chat.rs`
- Test: inline `#[cfg(test)]` modules in both files

**Interfaces:**

- Consumes: `Storage::patch_with(collection, id, patch, after_patch)` and existing `chat_memory_values_for_mutation` validation.
- Produces: `mutate_chat_memory_values_with_trigger<T, F>(state, chat_id, trigger, mutate) -> AppResult<T>` and `mutate_chat_memory_values<T, F>(...)`.

- [ ] **Step 1: Write failing atomic-merge tests**

Add Rust tests that seed one chat, prepare two independent memory values, and call the wished-for mutation helper twice. Each closure must receive the latest array; the final chat must contain both memories. Add a refresh test where a prepared refresh is merged after a manual memory is inserted and where a deleted prepared target is not resurrected.

```rust
let first = automatic_memory("memory-a", "Mira keeps the key.");
let second = manual_memory("memory-b", "The room stays quiet.");
mutate_chat_memory_values(&state, "chat-1", |values| {
    values.push(first.clone());
    Ok(())
})?;
mutate_chat_memory_values(&state, "chat-1", |values| {
    values.push(second.clone());
    Ok(())
})?;
assert_eq!(stored_memory_ids(&state, "chat-1"), ["memory-a", "memory-b"]);
```

- [ ] **Step 2: Run the focused Rust tests and verify RED**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --workspace chat_memory_atomic --no-fail-fast`

Expected: compilation failure because the atomic mutation helper does not exist.

- [ ] **Step 3: Implement the atomic helper**

Use `state.storage.patch_with("chats", chat_id, json!({}), ...)` to parse the latest `memories`, invoke the closure, deduplicate/serialize through existing helpers, and put the result back into the same chat object. Enqueue maintenance only after the storage mutation succeeds.

```rust
pub(crate) fn mutate_chat_memory_values_with_trigger<T, F>(
    state: &AppState,
    chat_id: &str,
    trigger: Trigger,
    mutate: F,
) -> AppResult<T>
where
    F: FnOnce(&mut Vec<Value>) -> AppResult<T>,
{
    let mut mutate = Some(mutate);
    let mut output = None;
    state.storage.patch_with("chats", chat_id, json!({}), |chat, _| {
        let mut values = chat_memory_values_for_mutation(&Value::Object(chat.clone()))?;
        output = Some(mutate.take().expect("mutation runs once")(&mut values)?);
        chat.insert("memories".into(), Value::Array(deduplicate_chat_memory_values(values)));
        Ok(())
    })?;
    enqueue_chat_memory_maintenance(state, chat_id, trigger)?;
    output.ok_or_else(|| AppError::new("storage_error", "Chat memory mutation did not run"))
}
```

- [ ] **Step 4: Convert async mutation paths**

Prepare embeddings outside the gate, then use the helper to apply only the intended delta against current state in `create_chat_memory`, `update_chat_memory`, `correct_chat_memory`, `persist_prepared_focused_capture`, `refresh_chat_memories_for_source_messages`, `rebuild_chat_memory_indexes`, imports/migrations that await embeddings, and the chat-memory maintenance apply path. Re-resolve target eligibility inside the closure. Merge refresh results by memory ID; never replace the latest full array with the prepared snapshot.

- [ ] **Step 5: Verify GREEN**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --workspace chat_memory --no-fail-fast`

Expected: all chat-memory and maintenance-chat tests pass, including the new atomic merge cases.

### Task 2: Durable Capture Lease and Fenced Job Updates

**Files:**

- Create: `src/engine/capabilities/memory-capture.ts`
- Create: `src/shared/api/memory-capture-api.ts`
- Create: `src/shared/api/memory-capture-api.spec.ts`
- Create: `src-tauri/src/commands/storage/memory_capture.rs`
- Modify: `src/engine/generation/automatic-memory-capture-queue.ts`
- Modify: `src/engine/generation/automatic-memory-capture-queue.spec.ts`
- Modify: `src/engine/generation/start-generation.ts`
- Modify: `src/shared/api/storage-api.ts`
- Modify: `src/shared/api/remote-runtime.ts`
- Modify: `src/shared/api/remote-runtime.spec.ts`
- Modify: `src-tauri/src/commands/storage/mod.rs`
- Modify: `src-tauri/src/commands/storage/commands/memory.rs`
- Modify: `src-tauri/src/http_dispatch.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/src/state.rs`

**Interfaces:**

- Produces: `MemoryCaptureGateway.acquireWorker(workerId, leaseId?)`, `releaseWorker(workerId, leaseId)`, and `updateJob(leaseId, jobId, patch)`.
- Consumes: queue dependencies `{ storage, llm, capture }` and the existing maintenance lease semantics.

- [ ] **Step 1: Write failing two-runtime and stale-fence tests**

Build one shared durable harness with two independent queue dependency objects. Hold the first LLM call open, start both processors, and assert only one extraction begins. Add takeover after lease expiry and stale-owner `updateJob` rejection.

```ts
const first = processAutomaticMemoryCaptureQueue(runtimeA, { workerId: "a" });
const second = processAutomaticMemoryCaptureQueue(runtimeB, { workerId: "b" });
await waitFor(() => expect(llm.complete).toHaveBeenCalledTimes(1));
releaseExtraction();
await Promise.all([first, second]);
```

- [ ] **Step 2: Verify RED**

Run: `pnpm vitest run src/engine/generation/automatic-memory-capture-queue.spec.ts src/shared/api/memory-capture-api.spec.ts`

Expected: failure because capture lease capabilities and commands do not exist.

- [ ] **Step 3: Implement the capture lease owner**

Mirror maintenance's acquire/renew/release contract in a distinct capture lane. Keep lease state server-owned, use a random lease ID, expire abandoned ownership, and guard job patches with `with_memory_capture_lease`.

```ts
export interface MemoryCaptureGateway {
  acquireWorker(workerId: string, leaseId?: string): Promise<string | null>;
  releaseWorker(workerId: string, leaseId: string): Promise<void>;
  updateJob(leaseId: string, jobId: string, patch: Record<string, unknown>): Promise<Record<string, unknown>>;
}
```

- [ ] **Step 4: Fence the queue**

Acquire before listing jobs, renew on an interval and before each job commit, abort when renewal returns a different lease, use the fenced API for every status transition, and release in `finally`. Change `jobDue` so `processing` requires `leaseExpiresAt <= now`; pending and due retryable jobs remain eligible. If the new API is unavailable, return without processing and leave jobs durable.

- [ ] **Step 5: Verify GREEN**

Run the focused Vitest command from Step 2 and `cargo test --manifest-path src-tauri/Cargo.toml --workspace memory_capture --no-fail-fast`.

Expected: one runtime processes each job; expiry recovers; stale fences fail with `memory_capture_lease_lost`.

### Task 3: Capture Scheduler Outage Recovery

**Files:**

- Modify: `src/engine/generation/automatic-memory-capture-queue.ts`
- Modify: `src/engine/generation/automatic-memory-capture-queue.spec.ts`

**Interfaces:**

- Produces: a bounded scheduler retry after queue-list failure.

- [ ] **Step 1: Write the failing scheduler test**

Use fake timers and make the first job-list call reject. Assert a retry timer is installed and the second list succeeds without another foreground generation or enqueue.

- [ ] **Step 2: Verify RED**

Run: `pnpm vitest run src/engine/generation/automatic-memory-capture-queue.spec.ts -t "retries scheduling after a storage list failure"`

Expected: timeout/no second list because the error is converted to an empty queue.

- [ ] **Step 3: Implement bounded retry**

Remove `.catch(() => [])` from processing/scheduling list reads. Catch at the scheduler boundary, install one retry timer using the first capture backoff, and preserve the durable job. Do not spin immediately.

- [ ] **Step 4: Verify GREEN**

Run the full capture-queue spec and confirm no unhandled rejection or timer leakage.

### Task 4: Fresh Canonical Index Rows and Completeness Marker

**Files:**

- Modify: `src-tauri/src/commands/storage/canonical_memory.rs`
- Modify: `src-tauri/src/commands/storage/commands/memory.rs`
- Modify: `src-tauri/src/http_dispatch.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src/engine/contracts/types/memory.ts`
- Modify: `src/engine/capabilities/storage.ts`
- Modify: `src/shared/api/canonical-memory-api.ts`
- Modify: `src/shared/api/canonical-memory-api.spec.ts`
- Modify: `src/shared/api/storage-api.ts`
- Modify: `src/shared/api/remote-runtime.ts`
- Modify: `src/shared/api/remote-runtime.spec.ts`
- Modify: `src/engine/generation/canonical-memory-context.ts`
- Modify: `src/engine/generation/canonical-memory-context.spec.ts`

**Interfaces:**

- Produces: `MemoryIndexHealth { lexicalComplete: boolean; version: 1 }` through optional `StorageGateway.memoryIndexHealth()`.
- Consumes: existing array-returning index queries and `rebuildMemoryIndex()`.

- [ ] **Step 1: Write failing stale/fresh ordering tests in Rust**

Create one stale provider row followed by one fresh lexical row for the same memory, then reverse their order. Assert single and batch queries return the memory in both arrangements.

- [ ] **Step 2: Verify RED for row freshness**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --workspace index_query_prefers_fresh_row --no-fail-fast`

Expected: stale-first fixtures return no memory.

- [ ] **Step 3: Fix freshness deduplication**

Load and validate the canonical memory before inserting its ID into `seen`. For batch queries, insert after freshness validation and before scope emission so each memory remains emitted once.

- [ ] **Step 4: Write failing completeness/fallback tests**

In TypeScript, assert `lexicalComplete: true` prevents `queryMemoriesBatch`, `false` retains fallback and requests a full rebuild, and absence of `memoryIndexHealth` preserves legacy fallback. In Rust, assert a full rebuild writes the completeness marker while a scoped rebuild does not claim global completeness.

```ts
if (storage.memoryIndexHealth && (await storage.memoryIndexHealth()).lexicalComplete) {
  return indexedRows;
}
const fallback = await queryDurableRows(storage, queries);
void storage.rebuildMemoryIndex?.().catch(() => undefined);
return mergeRows(indexedRows, fallback);
```

- [ ] **Step 5: Verify RED for completeness**

Run the canonical-context and canonical-memory API specs. Expected: durable fallback is still always called and the health command is absent.

- [ ] **Step 6: Implement the persisted marker and compatibility API**

Store one versioned row in a dedicated index-metadata collection. A full lexical rebuild atomically replaces lexical rows and writes `{ id: "lexical-v1", complete: true }`; scoped rebuilds leave the global marker unchanged. Existing canonical create/update/delete paths already update lexical rows atomically, so a valid marker remains valid. The API returns false when the marker is missing or malformed.

- [ ] **Step 7: Verify GREEN**

Run the focused Rust and Vitest suites. Confirm complete indexes skip durable reads and older gateways still use the safe fallback.

### Task 5: Bounded Automatic-Capture Reference Paging

**Files:**

- Modify: `src/engine/generation/automatic-memory-context.ts`
- Modify: `src/engine/generation/automatic-memory-context.spec.ts`

**Interfaces:**

- Consumes: `listChatMessages(chatId, { before, descending: true, orderBy: "createdAt", limit, fields })`.
- Produces: the same chronologically ordered maximum-six `referenceMessages` output.

- [ ] **Step 1: Write failing paging tests**

Assert the first storage call includes descending order, `before: firstSourceAt`, and a fixed page limit. Return pages containing source, hidden, and empty messages; assert paging stops at six eligible rows. Add a fixture that never finds eligible rows and assert no more than the fixed scan ceiling is requested.

- [ ] **Step 2: Verify RED**

Run: `pnpm vitest run src/engine/generation/automatic-memory-context.spec.ts`

Expected: current implementation makes one unbounded list call.

- [ ] **Step 3: Implement paging**

Use page size 24 and scan ceiling 120. Advance the exclusive cursor using the oldest returned `createdAt`; stop if the page is short, the cursor cannot move, six eligible rows are collected, or 120 rows have been scanned. Sort the selected six chronologically before returning.

- [ ] **Step 4: Verify GREEN**

Run the focused spec and confirm existing speaker-label/source-snapshot fixtures remain unchanged.

### Task 6: Collision-Safe Deterministic IDs

**Files:**

- Create: `src/engine/generation/deterministic-memory-id.ts`
- Create: `src/engine/generation/deterministic-memory-id.spec.ts`
- Modify: `src/engine/generation/automatic-memory-capture-queue.ts`
- Modify: `src/engine/generation/automatic-memory-capture-queue.spec.ts`
- Modify: `src/engine/generation/automatic-memory-capture.ts`
- Modify: `src/engine/generation/automatic-memory-consequences.spec.ts`
- Modify: `src-tauri/src/commands/storage/canonical_memory.rs`

**Interfaces:**

- Produces: `sha256MemoryId(prefix, identity) -> Promise<string>` and `legacyMemoryId(prefix, identity) -> string`.
- Preserves: exact identity verification before legacy-record reuse.

- [ ] **Step 1: Write failing known-collision tests**

Use the known legacy pair `source-47759` and `source-364162` under the same chat/version. Assert their legacy job IDs match but SHA-256 job IDs differ. Seed the colliding completed legacy job and assert enqueue creates/reuses the correct SHA-256 job instead of returning the unrelated record. Add the same semantic-identity mismatch fixture for canonical consequences.

- [ ] **Step 2: Verify RED**

Run the deterministic-ID, queue, and automatic-consequences specs. Expected: no SHA-256 helper exists and the legacy collision suppresses or updates unrelated data.

- [ ] **Step 3: Implement deterministic SHA-256 IDs and verified legacy lookup**

Use `globalThis.crypto.subtle.digest("SHA-256", ...)` and lowercase hex. Make job-ID calculation async. For legacy lookup, compare capture version, chat ID, and exact ordered source-message IDs. For consequences, compare stored `payload.semanticIdentity` before reuse; mismatches are unrelated.

```ts
export async function sha256MemoryId(prefix: string, identity: string): Promise<string> {
  const bytes = new TextEncoder().encode(identity);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return `${prefix}-${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}
```

- [ ] **Step 4: Upgrade new Rust lexical projection IDs**

Use `Sha256::digest` for new lexical `contentHash`, `projectionHash`, and row ID generation. Continue removal by `memoryId`/provider/model so legacy rows remain replaceable without bulk renaming.

- [ ] **Step 5: Verify GREEN**

Run all focused TS memory specs and Rust canonical-memory tests. Confirm legacy matching records remain idempotent and known collisions separate.

### Task 7: Integration Verification and Diff Audit

**Files:**

- Review every changed file from Tasks 1-6
- Update the design/plan only if implementation constraints required a documented deviation

**Interfaces:**

- Produces: verified uncommitted worktree ready for explicit review/shipping authorization.

- [ ] **Step 1: Run focused memory verification**

Run:

```powershell
pnpm vitest run src/engine/generation/automatic-memory-context.spec.ts src/engine/generation/automatic-memory-capture-queue.spec.ts src/engine/generation/automatic-memory-consequences.spec.ts src/engine/generation/canonical-memory-context.spec.ts src/shared/api/memory-capture-api.spec.ts src/shared/api/canonical-memory-api.spec.ts
cargo test --manifest-path src-tauri/Cargo.toml --workspace chat_memory --no-fail-fast
cargo test --manifest-path src-tauri/Cargo.toml --workspace canonical_memory --no-fail-fast
cargo test --manifest-path src-tauri/Cargo.toml --workspace memory_capture --no-fail-fast
```

- [ ] **Step 2: Run required static gates**

Run:

```powershell
pnpm typecheck
pnpm check:architecture
pnpm check:discovery
pnpm check:unused
cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check
cargo check --manifest-path src-tauri/Cargo.toml --workspace
```

- [ ] **Step 3: Run the full repository check**

Run: `pnpm check`

Expected: exit 0 with no failing check.

- [ ] **Step 4: Audit the final diff**

Run `git diff --check`, inspect `git status --short`, review every changed hunk, verify only intended files are present, and reconcile every design requirement with a passing test or explicitly reported manual gap.

- [ ] **Step 5: Report without publishing**

Report changed files, red-green evidence, full verification output, remaining risk, and the exact worktree path. Do not commit, push, open a PR, run Bunny, or deploy until separately authorized.
