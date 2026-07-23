# Memory Quality and Deki Access Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Save only compact extracted consequences as cross-chat character memories, keep their success toast visible for eight seconds, and let Deki-senpai read and edit scoped character or approved chat memories.

**Architecture:** The TypeScript capture queue remains the policy owner deciding which durable result becomes user-visible. A focused Rust `deki/memory_access.rs` module projects and mutates memory records through existing canonical-memory and chat-memory owners, reusing chat grants for private chat Memory Recall. Shell code remains a pure mapping from capture completion to toast presentation.

**Tech Stack:** TypeScript, Vitest, React shell policy, Rust, AutoAgents tools, De-Koi storage capabilities, Tauri.

## Global Constraints

- Raw transcript captures remain in per-chat recall and are never promoted to canonical character memory.
- Only validated canonical consequences may publish automatic-memory success feedback.
- Automatic-memory success toasts use an 8,000 millisecond duration.
- Character memories are addressed by explicit character ID.
- Chat memories require an existing Deki chat-access grant covering the explicit chat ID.
- Deki edits one exact memory's non-empty content only; no delete, bulk edit, import/export, pin, restore, or status mutation.
- Existing literal memories are not migrated or silently rewritten.
- Keep Conversation, Roleplay, and Game orchestration unchanged; this work modifies only their shared lower-level post-generation memory capture.

---

### Task 1: Stop raw transcript promotion and lengthen memory feedback

**Files:**
- Modify: `src/engine/generation/automatic-memory-capture-queue.spec.ts`
- Modify: `src/engine/generation/automatic-memory-capture-queue.ts`
- Modify: `src/app/shell/app-shell-center-surfaces.spec.ts`
- Modify: `src/app/shell/app-shell-center-surfaces.ts`
- Modify: `src/app/shell/AppShell.tsx`

**Interfaces:**
- Consumes: `extractAndPersistConsequences(...)` returning `PersistedCanonicalConsequence[]`.
- Produces: `getAutomaticMemoryCaptureToast(...)` returning `{ title: string; description: string; duration: number } | null`.

- [ ] **Step 1: Convert the raw-promotion expectation into a failing regression**

Replace the existing `creates one stable canonical character memory after local capture` expectation. Process a character-scoped job without an LLM consequence and assert that `canonicalMemories` remains empty and the completion subscriber receives no event. Keep the assertion at the public `processAutomaticMemoryCaptureQueue(...)` and `subscribeAutomaticMemoryCaptureCompletions(...)` seams. Update or remove the adjacent resumed-job test whose only purpose is asserting the obsolete raw canonical episode ID.

- [ ] **Step 2: Run the focused queue test and verify RED**

Run: `pnpm vitest run src/engine/generation/automatic-memory-capture-queue.spec.ts`

Expected: FAIL because `upsertCanonicalCharacterMemory(...)` creates a raw `episode` and the queue publishes the transcript capture fallback.

- [ ] **Step 3: Remove raw canonical promotion and fallback publication**

Delete `upsertCanonicalCharacterMemory(...)` and its now-unused canonical input imports. In `processAutomaticMemoryCaptureQueue(...)`, keep `refreshChatMemories(...)` for internal chat recall, persist extracted consequences when an LLM is present, and call `publishMemoryCaptureCompletion(...)` only when `consequences[0]` exists. Preserve the assistant message's internal `capture` metadata for provenance and diagnostics.

- [ ] **Step 4: Run the focused queue test and verify GREEN**

Run: `pnpm vitest run src/engine/generation/automatic-memory-capture-queue.spec.ts`

Expected: PASS; raw chat recall still completes the job, no transcript becomes canonical character memory, and no misleading success event is emitted.

- [ ] **Step 5: Add a failing shell policy test for an eight-second toast**

Update the existing `getAutomaticMemoryCaptureToast` expectation to require:

```ts
{
  title: "Memory saved",
  description: "Celia's cat is named Miso.",
  duration: 8_000,
}
```

Repeat the duration assertion for `operation: "updated"`.

- [ ] **Step 6: Run the focused shell test and verify RED**

Run: `pnpm vitest run src/app/shell/app-shell-center-surfaces.spec.ts`

Expected: FAIL because the policy result has no duration.

- [ ] **Step 7: Add duration to the policy and pass it to Sonner**

Change the return type of `getAutomaticMemoryCaptureToast(...)` to include `duration: number`, return `duration: 8_000`, and render with:

```ts
toast.success(feedback.title, {
  description: feedback.description,
  duration: feedback.duration,
});
```

- [ ] **Step 8: Run both focused TypeScript suites**

Run: `pnpm vitest run src/engine/generation/automatic-memory-capture-queue.spec.ts src/app/shell/app-shell-center-surfaces.spec.ts`

Expected: PASS.

### Task 2: Add scoped Deki memory capability

**Files:**
- Create: `src-tauri/src/commands/storage/deki/memory_access.rs`
- Modify: `src-tauri/src/commands/storage/deki/chat_access.rs`
- Modify: `src-tauri/src/commands/storage/deki.rs`
- Modify: `src/features/shell/deki/components/DekiSurface.tsx`
- Modify: `src/features/shell/deki/components/DekiSurface.spec.tsx`
- Modify: `AGENTS.md`

**Interfaces:**
- Consumes: `canonical_memory::{get_memory, query_memories, update_memory, rebuild_memory_lexical_index}` and `chat_memory::{list_chat_memories_excluding_recent, update_chat_memory}`.
- Produces: `memory_access::read(...) -> AppResult<Value>` and `memory_access::edit(...) -> AppResult<Value>` plus `ReadDekiMemoriesTool` and `EditDekiMemoryTool`.

- [ ] **Step 1: Add failing grant-helper tests**

In `deki/chat_access.rs`, add tests requiring a public-to-parent helper with this signature:

```rust
pub(super) fn ensure_chat_allowed(
    state: &AppState,
    grants: &[DekiChatAccessGrant],
    chat_id: &str,
) -> AppResult<String>;
```

Assert it returns the normalized covered chat ID for a matching grant and rejects missing or cross-chat grants.

- [ ] **Step 2: Run the focused Rust tests and verify RED**

Run: `cargo test --manifest-path src-tauri/Cargo.toml commands::storage::deki::chat_access::tests --lib`

Expected: FAIL because `ensure_chat_allowed` does not exist.

- [ ] **Step 3: Implement the narrow chat authorization helper**

Normalize `chat_id`, compute the existing `allowed_chat_ids(...)`, require a non-empty grant set, and reject IDs not in the allowed set with the same explicit access error used by message reads. Return the normalized ID on success. Refactor `messages(...)` to use it so chat messages and chat memories share one authorization boundary.

- [ ] **Step 4: Run grant-helper tests and verify GREEN**

Run: `cargo test --manifest-path src-tauri/Cargo.toml commands::storage::deki::chat_access::tests --lib`

Expected: PASS.

- [ ] **Step 5: Create failing memory capability tests**

In `deki/memory_access.rs`, define test fixtures for a canonical character memory and a chat Memory Recall entry. Add tests proving:

- character reads return only the requested character scope;
- character edits reject a memory from another character;
- character edits update content and rebuild the character lexical index;
- chat reads reject an empty grant list;
- chat reads return only a covered chat's projected memory fields;
- chat edits reject a grant covering another chat;
- chat edits call the existing chat-memory owner and persist the edited content;
- empty content and deleted/inactive records are rejected.

Use these argument types:

```rust
#[derive(Debug, Deserialize, ToolInput)]
#[serde(rename_all = "camelCase")]
pub(super) struct ReadDekiMemoriesArgs {
    pub(super) scope_type: String,
    pub(super) scope_id: String,
    pub(super) query: Option<String>,
    pub(super) limit: Option<usize>,
}

#[derive(Debug, Deserialize, ToolInput)]
#[serde(rename_all = "camelCase")]
pub(super) struct EditDekiMemoryArgs {
    pub(super) scope_type: String,
    pub(super) scope_id: String,
    pub(super) memory_id: String,
    pub(super) content: String,
}
```

- [ ] **Step 6: Run memory capability tests and verify RED**

Run: `cargo test --manifest-path src-tauri/Cargo.toml commands::storage::deki::memory_access::tests --lib`

Expected: FAIL until the read/edit capability is implemented.

- [ ] **Step 7: Implement projected reads and owner-routed edits**

Implement `character` and `chat` scope parsing only. Cap reads at 100, default to 50, perform optional case-insensitive content search, return projected rows rather than raw records, and omit chat rows the chat-memory owner marks non-retrievable. Character edits verify `scope.kind == "character"`, `scope.id == scope_id`, and an active/pinned status before calling `update_memory` followed by `rebuild_memory_lexical_index` for the exact character scope. Chat reads and edits call `ensure_chat_allowed` before accessing data; chat edits verify the memory exists in that chat before calling `update_chat_memory`.

- [ ] **Step 8: Register Deki tools and explicit write-intent routing**

Add `memory_access` as a focused module. Register:

```rust
read_deki_memories
edit_deki_memory
```

Add a `Memory` tool bundle selected by memory-specific words. Include the read tool in Memory and Broad bundles. Add the edit tool only when the latest user turn is an imperative memory-edit request, including an unambiguous referential follow-up to a prior memory request. Add both tool names to the workspace tool allowlist, instantiate both in `DekiAgent::tools`, and update the agent description/system prompt. Character memory may be read directly by explicit character ID; chat memory instructions must tell Deki to request chat access first.

Update the chat-access approval card so it no longer claims the grant is read-only: disclose scoped memory access and state that a memory edit still requires an explicit request.

- [ ] **Step 9: Add and run routing/system-prompt tests**

Extend existing `deki.rs` tests to prove a read request selects `read_deki_memories`, a question does not expose `edit_deki_memory`, an explicit edit does, an unrelated mutation cannot unlock it, and the system prompt documents chat grant enforcement.

Run: `cargo test --manifest-path src-tauri/Cargo.toml commands::storage::deki::tests --lib`

Expected: PASS.

- [ ] **Step 10: Update the Deki map**

In `AGENTS.md`, extend the Deki `src-tauri/src/commands/storage/deki/*` map entry to include scoped canonical character-memory and approved chat-memory read/edit access.

### Task 3: Verify architecture, behavior, and branch scope

**Files:**
- Verify all changed files from Tasks 1-2.

**Interfaces:**
- Consumes: the completed TypeScript and Rust behavior.
- Produces: shippable branch proof for Bunny and the PR.

- [ ] **Step 1: Run focused tests**

Run:

```powershell
pnpm vitest run src/engine/generation/automatic-memory-capture-queue.spec.ts src/app/shell/app-shell-center-surfaces.spec.ts
cargo test --manifest-path src-tauri/Cargo.toml commands::storage::deki --lib
```

Expected: PASS.

- [ ] **Step 2: Run lane checks**

Run:

```powershell
pnpm typecheck
pnpm check:architecture
cargo check --manifest-path src-tauri/Cargo.toml
pnpm check:docs
```

Expected: PASS.

- [ ] **Step 3: Inspect final diff and clean state**

Run:

```powershell
git diff --check
git status --short
git diff --stat origin/main...HEAD
```

Expected: only the approved memory, Deki, tests, AGENTS, design, and plan files; no whitespace errors or generated artifacts.

- [ ] **Step 4: Commit the coherent implementation**

Stage only intended files and commit with a non-authorship subject such as:

```powershell
git commit -m "memory: improve capture quality and Deki access"
```

### Task 4: Bunny, PR, merge, and Pi deployment

**Files:**
- No additional product files unless Bunny or CI finds an in-scope defect.

**Interfaces:**
- Consumes: verified branch commit.
- Produces: merged `main` and a Pi running the merged image revision.

- [ ] **Step 1: Run pre-PR Bunny review**

Inspect branch/base, diff, prompt/storage/privacy risk matrix, tests, and exact unproven paths. Fix in-scope findings and rerun affected proof before continuing.

- [ ] **Step 2: Push only to origin and open a draft PR**

Confirm branch, remotes, and dirty state; push `fix/memory-quality-deki-access` to `origin`; open a draft PR targeting `The-Koi-Pond/De-Koi:main` with honest validation and manual gaps.

- [ ] **Step 3: Run post-push Bunny and babysit checks**

Rerun Bunny against the pushed diff, monitor required CI and unresolved review threads, repair in-scope failures, push fixes, and rerun Bunny after every PR-affecting push.

- [ ] **Step 4: Mark ready and merge**

Run the ready gate, confirm all required checks and review threads are green, then merge through GitHub without force-pushing.

- [ ] **Step 5: Update the Pi from merged main**

Use the repository's Pi update workflow. Prove `/health?probe=1`, the running image revision matches the merged main revision, containers/services are healthy, and persistent mounts remain attached.
