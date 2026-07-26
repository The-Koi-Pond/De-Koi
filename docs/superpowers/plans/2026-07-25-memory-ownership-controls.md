# Memory Ownership Controls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add safe, explicit memory choices to chat deletion and native character `.dekoi.json` export/import.

**Architecture:** React surfaces collect an unchecked user choice and pass it through typed shared APIs. Rust remains authoritative for chat-memory cleanup and portable character-memory projection, with embedded Tauri and hostable HTTP paths sharing the same owner functions.

**Tech Stack:** React 19, TypeScript, Zustand dialogs, TanStack React Query, Tauri 2, Rust, serde_json, Vitest, React Testing Library.

## Global Constraints

- Chat deletion keeps cross-chat memories when the option is omitted or false.
- Chat-local history and summaries are deleted with the chat either way.
- Only memories exclusively sourced by the deleted chat set are deleted; shared-source memories remain with deleted provenance removed.
- Native character memory export is opt-in and defaults off.
- Compatible JSON/PNG and transcript exports never contain De-Koi memories.
- Portable memory data excludes chat IDs, message IDs, embeddings, provider/model fields, index rows, storage timestamps, and arbitrary payload.
- Full profile backups remain full-fidelity.
- Embedded and remote runtime behavior must stay identical.
- No production behavior is written before its focused test fails for the expected reason.

---

### Task 1: Canonical chat-source cleanup

**Files:**
- Modify: `src-tauri/src/commands/storage/canonical_memory.rs`

**Interfaces:**
- Consumes: `AppState`, canonical memory rows, memory index rows, and a `HashSet<String>` of deleted chat IDs.
- Produces: `delete_memories_learned_only_from_chats(state: &AppState, chat_ids: &HashSet<String>) -> AppResult<ChatMemoryCleanupResult>`.

- [ ] **Step 1: Add a failing exclusive-source cleanup test**

Seed an active and pinned canonical memory sourced only from `chat-1`, an unrelated manual character memory, and index rows. Call the new function and assert the sourced memories and their indexes are gone while the manual memory remains.

- [ ] **Step 2: Run the focused Rust test and verify RED**

Run:

```powershell
cargo test --manifest-path src-tauri/Cargo.toml canonical_memory::tests::delete_memories_learned_only_from_chats_removes_exclusive_sources_and_indexes -- --exact
```

Expected: compilation failure because `delete_memories_learned_only_from_chats` does not exist.

- [ ] **Step 3: Implement the atomic cleanup owner**

Add:

```rust
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ChatMemoryCleanupResult {
    pub deleted: usize,
    pub retained_shared: usize,
}

pub(crate) fn delete_memories_learned_only_from_chats(
    state: &AppState,
    chat_ids: &HashSet<String>,
) -> AppResult<ChatMemoryCleanupResult>
```

Use `update_collections_atomically(vec![MEMORY_COLLECTION, INDEX_COLLECTION], ...)`. Gather known source chats from chat scope, `provenance.sourceChatId`, and `payload.sourceChatIds`. Delete only rows whose non-empty known source set is entirely contained by `chat_ids`; remove all matching index rows.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run the command from Step 2. Expected: one passing test.

- [ ] **Step 5: Add a failing shared-source cleanup test**

Seed a memory whose provenance points to `chat-1` and whose `payload.sourceChatIds` contains `chat-1` and `chat-2`. Assert cleanup for `chat-1` keeps the memory, changes provenance to `chat-2`, clears `messageIds`, leaves only `chat-2` in `sourceChatIds`, and rebuilds the lexical row with the updated canonical timestamp.

- [ ] **Step 6: Run the shared-source test and verify RED**

Run:

```powershell
cargo test --manifest-path src-tauri/Cargo.toml canonical_memory::tests::delete_memories_learned_only_from_chats_retains_shared_memory_without_deleted_provenance -- --exact
```

Expected: assertion failure because shared provenance cleanup is not implemented.

- [ ] **Step 7: Implement shared provenance cleanup**

For mixed source sets, retain the canonical record, replace a deleted `provenance.sourceChatId` with the first sorted retained source, clear `provenance.messageIds`, filter `payload.sourceChatIds`, update `updatedAt`, and call `replace_memory_lexical_index`.

- [ ] **Step 8: Run all canonical-memory tests**

Run:

```powershell
cargo test --manifest-path src-tauri/Cargo.toml canonical_memory::tests
```

Expected: all canonical-memory tests pass.

- [ ] **Step 9: Commit the cleanup owner**

```powershell
git add src-tauri/src/commands/storage/canonical_memory.rs
git commit -m "feat: add canonical chat memory cleanup"
```

---

### Task 2: Chat deletion policy across embedded and remote runtimes

**Files:**
- Modify: `src-tauri/src/commands/storage/chats.rs`
- Modify: `src-tauri/src/commands/storage/commands/entities/delete.rs`
- Modify: `src-tauri/src/commands/storage/commands/entities.rs`
- Modify: `src-tauri/src/commands/storage/commands/chats.rs`
- Modify: `src-tauri/src/http_storage_dispatch.rs`
- Modify: `src-tauri/src/http_dispatch.rs`
- Modify: `src/engine/capabilities/storage.ts`
- Modify: `src/shared/api/storage-api.ts`
- Modify: `src/shared/api/chat-command-api.ts`
- Test: `src/shared/api/storage-api.spec.ts`
- Test: `src/shared/api/chat-command-api.spec.ts`

**Interfaces:**
- Consumes: `deleteMemories?: boolean` from typed frontend callers.
- Produces: chat deletion results with `deletedChatIds` and `memoryCleanup`.

- [ ] **Step 1: Write failing shared-API argument tests**

Add assertions that:

```ts
await storageApi.delete("chats", "chat-1", { deleteMemories: true });
```

invokes `storage_delete` with `deleteMemories: true`, omission sends no true flag, and:

```ts
await chatCommandApi.groupDelete("group-1", { deleteMemories: true });
```

invokes `chat_group_delete` with the same explicit flag.

- [ ] **Step 2: Run API specs and verify RED**

Run:

```powershell
pnpm exec vitest run src/shared/api/storage-api.spec.ts src/shared/api/chat-command-api.spec.ts
```

Expected: failures showing the flag is absent from invoke arguments.

- [ ] **Step 3: Extend the typed frontend contracts**

Change:

```ts
export type StorageDeleteOptions = {
  force?: boolean;
  deleteMemories?: boolean;
};
```

Forward `deleteMemories` only when defined. Add `ChatGroupDeleteOptions` and forward it from `chatCommandApi.groupDelete`.

- [ ] **Step 4: Run API specs and verify GREEN**

Run the command from Step 2. Expected: all tests pass.

- [ ] **Step 5: Add failing Rust entity and group deletion tests**

Cover:

1. default `delete_entity` keeps character-scoped canonical memories learned from the chat;
2. `delete_entity_with_options(..., delete_memories: true)` removes exclusively sourced memories;
3. group deletion passes every deleted root/scene chat ID as one cleanup scope;
4. a cleanup failure reports `completed: false` without claiming the selected memories were removed.

- [ ] **Step 6: Run focused Rust tests and verify RED**

Run:

```powershell
cargo test --manifest-path src-tauri/Cargo.toml delete_chat_memory_policy
```

Expected: no matching implementation or failing assertions for the missing option.

- [ ] **Step 7: Implement Rust option forwarding and result reporting**

Keep existing helpers as safe-default wrappers:

```rust
pub(crate) fn delete_chat_with_messages(
    state: &AppState,
    chat_id: &str,
) -> AppResult<Vec<String>>
```

delegates to an option-aware variant with `delete_memories = false`.

After successful chat deletion, call the canonical cleanup owner only when true. Return:

```json
{
  "deleted": true,
  "deletedChatIds": ["chat-1"],
  "memoryCleanup": {
    "requested": true,
    "completed": true,
    "deleted": 2,
    "retainedShared": 1
  }
}
```

On cleanup error, return `completed: false` plus the stable error code. Do not reinsert the already deleted chat.

Extend desktop command arguments and `http_storage_dispatch`/`http_dispatch` parsing with omission defaulting to false.

- [ ] **Step 8: Run focused Rust deletion tests**

Run:

```powershell
cargo test --manifest-path src-tauri/Cargo.toml delete_chat_memory_policy
cargo test --manifest-path src-tauri/Cargo.toml delete_chat_group
```

Expected: all matching tests pass.

- [ ] **Step 9: Run architecture and Rust checks**

Run:

```powershell
pnpm check:architecture
cargo check --manifest-path src-tauri/Cargo.toml
```

Expected: both commands exit successfully.

- [ ] **Step 10: Commit the transport slice**

```powershell
git add src-tauri/src/commands/storage src-tauri/src/http_storage_dispatch.rs src-tauri/src/http_dispatch.rs src/engine/capabilities/storage.ts src/shared/api/storage-api.ts src/shared/api/chat-command-api.ts src/shared/api/storage-api.spec.ts src/shared/api/chat-command-api.spec.ts
git commit -m "feat: add chat deletion memory policy"
```

---

### Task 3: Option-bearing confirmations and every user deletion entrypoint

**Files:**
- Modify: `src/shared/stores/dialog.store.ts`
- Modify: `src/shared/lib/app-dialogs.ts`
- Modify: `src/shared/components/ui/AppDialogRenderer.tsx`
- Create: `src/shared/components/ui/AppDialogRenderer.spec.tsx`
- Create: `src/features/catalog/chats/lib/chat-delete-confirmation.ts`
- Create: `src/features/catalog/chats/lib/chat-delete-confirmation.spec.ts`
- Modify: `src/features/catalog/chats/hooks/use-chat-lifecycle.ts`
- Create: `src/features/catalog/chats/hooks/use-chat-lifecycle.spec.tsx`
- Modify: `src/app/shell/chat-sidebar-batch-actions.ts`
- Modify: `src/app/shell/chat-sidebar-batch-actions.spec.ts`
- Modify: `src/app/shell/ChatSidebar.tsx`
- Modify: `src/features/modes/shared/chat-ui/components/ChatFilesDrawer.tsx`

**Interfaces:**
- Produces: `showConfirmDialogWithOption(...) -> Promise<{ confirmed: boolean; optionChecked: boolean }>` and `confirmChatDeletion(count)`.
- Consumes: option-aware `useDeleteChat` and `useDeleteChatGroup`.

- [ ] **Step 1: Write a failing option-dialog component test**

Render `AppDialogRenderer`, open an option-bearing confirmation with `defaultChecked: false`, assert the checkbox is initially unchecked, toggle it, confirm, and expect:

```ts
{ confirmed: true, optionChecked: true }
```

Dismissal must resolve:

```ts
{ confirmed: false, optionChecked: false }
```

- [ ] **Step 2: Run the component test and verify RED**

Run:

```powershell
pnpm exec vitest run src/shared/components/ui/AppDialogRenderer.spec.tsx
```

Expected: failure because the option dialog API does not exist.

- [ ] **Step 3: Implement a separate option-confirm dialog kind**

Add a discriminated `confirm-option` state with:

```ts
optionLabel: string;
optionDescription?: string;
defaultChecked?: boolean;
```

Keep `showConfirmDialog(): Promise<boolean>` unchanged. Render an accessible checkbox and resolve the structured result.

- [ ] **Step 4: Run the component test and verify GREEN**

Run the command from Step 2. Expected: all tests pass.

- [ ] **Step 5: Write failing copy and propagation tests**

Test `confirmChatDeletion(1)` and `confirmChatDeletion(3)` for exact singular/plural labels, unchecked default, and cancellation. Extend sequential batch deletion tests so `deleteMemories: true` is included for every selected chat.

- [ ] **Step 6: Run helper and batch tests and verify RED**

Run:

```powershell
pnpm exec vitest run src/features/catalog/chats/lib/chat-delete-confirmation.spec.ts src/app/shell/chat-sidebar-batch-actions.spec.ts
```

Expected: failures because the helper and policy propagation do not exist.

- [ ] **Step 7: Implement and wire every user-initiated deletion surface**

Use exact helper copy from the design. Extend `DeleteChatInput` with `deleteMemories?: boolean` and pass it to `storageApi.delete`.

Wire:

- sidebar single-chat confirmation;
- sidebar multi-select deletion;
- branch chooser checkbox for “this chat” and “entire group”;
- chat-files single branch deletion;
- chat-files entire group deletion.

Do not add prompts to empty setup-chat cleanup in conversation, roleplay, or game; those callers omit the flag and keep memories.

When `memoryCleanup.completed === false`, show the design warning and invalidate memory queries without rolling the deleted chat back into caches.

- [ ] **Step 8: Run focused UI and hook tests**

Run:

```powershell
pnpm exec vitest run src/shared/components/ui/AppDialogRenderer.spec.tsx src/features/catalog/chats/lib/chat-delete-confirmation.spec.ts src/app/shell/chat-sidebar-batch-actions.spec.ts src/features/catalog/chats/hooks/use-chat-lifecycle.spec.tsx
```

Expected: all tests pass.

- [ ] **Step 9: Run type and architecture checks**

Run:

```powershell
pnpm typecheck
pnpm check:architecture
```

Expected: both commands exit successfully.

- [ ] **Step 10: Commit the UI deletion slice**

```powershell
git add src/shared/stores/dialog.store.ts src/shared/lib/app-dialogs.ts src/shared/components/ui src/features/catalog/chats src/app/shell src/features/modes/shared/chat-ui/components/ChatFilesDrawer.tsx
git commit -m "feat: let chat deletion preserve memories"
```

---

### Task 4: Portable native character memories

**Files:**
- Modify: `src-tauri/src/commands/storage/exports.rs`
- Modify: `src-tauri/src/commands/storage/commands/profile.rs`
- Modify: `src-tauri/src/commands/storage/imports/marinara.rs`
- Modify: `src-tauri/src/commands/storage/imports/marinara_tests.rs`
- Modify: `src-tauri/src/http_dispatch.rs`

**Interfaces:**
- Consumes: `include_memories: Option<bool>` for single/bulk native character export.
- Produces: sanitized optional `memories` arrays and import rebinding to the new character ID.

- [ ] **Step 1: Write a failing native-export privacy test**

Seed a character-scoped canonical memory containing chat provenance, message IDs, payload source IDs, and index/embedding metadata. Assert:

- native export with `includeMemories: false` has no `memories`;
- native export with true contains semantic fields;
- the exported memory contains no source chat/message IDs, embedding/provider/model/index data, or arbitrary payload;
- compatible export contains no memories even when true is passed.

- [ ] **Step 2: Run the export test and verify RED**

Run:

```powershell
cargo test --manifest-path src-tauri/Cargo.toml character_export_memory_privacy -- --nocapture
```

Expected: failure because character exports do not accept or emit memories.

- [ ] **Step 3: Implement sanitized native character projection**

Add `portable_character_memories(state, character_id)` and include it only when native format and the explicit flag are true. Preserve file-local IDs and remap supersession links only within the exported set.

Extend single/bulk desktop command and HTTP dispatch arguments. Omission remains false.

- [ ] **Step 4: Run export tests and verify GREEN**

Run:

```powershell
cargo test --manifest-path src-tauri/Cargo.toml character_export_memory_privacy
cargo test --manifest-path src-tauri/Cargo.toml exports::tests
```

Expected: all matching tests pass.

- [ ] **Step 5: Write failing native-import tests**

Import a native character envelope with two linked memories. Assert:

- both memories are scoped to the newly generated character ID;
- source chat/message provenance is empty;
- supersession links point to newly generated memory IDs;
- active/pinned memories have lexical indexes;
- a legacy file without `memories` still imports;
- malformed memory input rolls back the character, imported assets, created memories, and indexes.

- [ ] **Step 6: Run import tests and verify RED**

Run:

```powershell
cargo test --manifest-path src-tauri/Cargo.toml native_marinara_character_imports_portable_memories -- --exact
```

Expected: failure because native import ignores `memories`.

- [ ] **Step 7: Implement validated import and rollback**

Validate the full portable array before writing memory records. Create the character, allocate new memory IDs, remap links, call `canonical_memory::create_memory`, and track created IDs. On any later error, delete created canonical memories before the existing character/gallery/sprite/avatar rollback completes.

- [ ] **Step 8: Run focused import and canonical tests**

Run:

```powershell
cargo test --manifest-path src-tauri/Cargo.toml native_marinara_character_import
cargo test --manifest-path src-tauri/Cargo.toml canonical_memory::tests
cargo check --manifest-path src-tauri/Cargo.toml
```

Expected: all tests and cargo check pass.

- [ ] **Step 9: Commit the portable memory owner**

```powershell
git add src-tauri/src/commands/storage/exports.rs src-tauri/src/commands/storage/commands/profile.rs src-tauri/src/commands/storage/imports/marinara.rs src-tauri/src/commands/storage/imports/marinara_tests.rs src-tauri/src/http_dispatch.rs
git commit -m "feat: add portable character memories"
```

---

### Task 5: Character export choice in single and bulk UI

**Files:**
- Modify: `src/shared/api/export-api.ts`
- Modify: `src/shared/api/export-api.spec.ts`
- Modify: `src/shared/components/ui/ExportFormatDialog.tsx`
- Modify: `src/shared/components/ui/ExportFormatDialog.spec.tsx`
- Modify: `src/features/catalog/characters/components/CharacterEditorDialogs.tsx`
- Create: `src/features/catalog/characters/components/CharacterEditorDialogs.spec.tsx`
- Modify: `src/features/catalog/characters/hooks/use-characters-panel-selection.ts`
- Create: `src/features/catalog/characters/hooks/use-characters-panel-selection.spec.tsx`
- Modify: `src/features/catalog/characters/components/CharactersPanel.tsx`

**Interfaces:**
- Consumes: unchecked `includeMemories` UI state.
- Produces: `exportApi.character(id, format, { includeMemories })` and equivalent bulk calls.

- [ ] **Step 1: Write failing API argument tests**

Assert single and bulk APIs pass `includeMemories: true` only when requested and default to omission/false.

- [ ] **Step 2: Run export API tests and verify RED**

Run:

```powershell
pnpm exec vitest run src/shared/api/export-api.spec.ts
```

Expected: argument mismatch because the option is not supported.

- [ ] **Step 3: Implement typed export options**

Add:

```ts
export type CharacterExportOptions = {
  includeMemories?: boolean;
};
```

Forward the explicit value for single and bulk character commands.

- [ ] **Step 4: Run export API tests and verify GREEN**

Run the command from Step 2. Expected: all tests pass.

- [ ] **Step 5: Write failing dialog and character-export tests**

Prove:

- the checkbox starts unchecked each time the dialog opens;
- helper copy says it only affects De-Koi Native;
- native single export forwards true when checked;
- compatible JSON/PNG does not forward memory inclusion;
- bulk native export forwards the same option.

- [ ] **Step 6: Run component tests and verify RED**

Run:

```powershell
pnpm exec vitest run src/shared/components/ui/ExportFormatDialog.spec.tsx src/features/catalog/characters/components/CharacterEditorDialogs.spec.tsx
```

Expected: failures because the memory option is absent.

- [ ] **Step 7: Implement opt-in export controls**

Extend `ExportFormatDialog` with optional controlled checkbox props:

```ts
option?: {
  checked: boolean;
  label: string;
  description?: string;
  onCheckedChange: (checked: boolean) => void;
};
```

Single and bulk character callers own state, reset it to false on open/close, and pass it only for `format === "native"`.

- [ ] **Step 8: Run all focused TypeScript tests**

Run:

```powershell
pnpm exec vitest run src/shared/api/export-api.spec.ts src/shared/components/ui/ExportFormatDialog.spec.tsx src/features/catalog/characters/components/CharacterEditorDialogs.spec.tsx src/features/catalog/characters/hooks/use-characters-panel-selection.spec.tsx
```

Expected: all tests pass.

- [ ] **Step 9: Run type, architecture, and build checks**

Run:

```powershell
pnpm typecheck
pnpm check:architecture
pnpm build
```

Expected: every command exits successfully.

- [ ] **Step 10: Commit the export UI**

```powershell
git add src/shared/api/export-api.ts src/shared/api/export-api.spec.ts src/shared/components/ui/ExportFormatDialog.tsx src/shared/components/ui/ExportFormatDialog.spec.tsx src/features/catalog/characters
git commit -m "feat: add memory choice to character export"
```

---

### Task 6: Discoverability, proof, and shipping

**Files:**
- Modify: `src/features/shell/discovery/discovery-entries.json`
- Modify: `docs/superpowers/specs/2026-07-25-memory-ownership-controls-design.md` only if implementation evidence requires a correction.

**Interfaces:**
- Produces: discoverable copy for memory ownership controls and final shipping evidence.

- [ ] **Step 1: Update feature discovery**

Add searchable wording for keeping/deleting chat-learned memories and including character memories in De-Koi Native exports. Do not advertise memory support for compatible or transcript exports.

- [ ] **Step 2: Run discovery and docs checks**

Run:

```powershell
$env:DISCOVERY_CHECK_ALLOW_MISSING='1'
pnpm check:discovery
pnpm check:docs
```

Expected: both commands pass.

- [ ] **Step 3: Run the changed-path proof suite**

Run all focused TypeScript tests from Tasks 2, 3, and 5 plus:

```powershell
cargo test --manifest-path src-tauri/Cargo.toml canonical_memory::tests
cargo test --manifest-path src-tauri/Cargo.toml delete_chat
cargo test --manifest-path src-tauri/Cargo.toml native_marinara_character_import
```

Expected: zero failures.

- [ ] **Step 4: Run full local shipping gates**

Run:

```powershell
$env:DISCOVERY_CHECK_ALLOW_MISSING='1'
pnpm check
pnpm build
cargo check --manifest-path src-tauri/Cargo.toml
```

Expected: every command exits successfully.

- [ ] **Step 5: Run Bunny before push**

Review `git log origin/main..HEAD`, `git diff --stat origin/main...HEAD`, `git diff --check origin/main...HEAD`, every changed owner, proof output, user-data copy, remote parity, and manual gaps. Fix any in-scope finding and rerun relevant tests.

- [ ] **Step 6: Commit final discoverability changes**

```powershell
git add src/features/shell/discovery/discovery-entries.json docs
git commit -m "docs: explain memory ownership controls"
```

- [ ] **Step 7: Push and open the PR**

Push only to `origin`, create a PR targeting `The-Koi-Pond/De-Koi:main`, use the repository template, and keep human validation checkboxes unchecked.

- [ ] **Step 8: Run Bunny after the push and address review**

Require zero unresolved actionable findings on the exact head SHA. Reply with technical evidence and resolve only addressed threads.

- [ ] **Step 9: Wait for exact-head CI**

Require Change Classification, Deterministic Repository Gates, Rust Capability Layer, Browser Smoke and Performance, Required Validation, and Bunny Review to pass.

- [ ] **Step 10: Squash merge and prove main**

Merge the PR, fetch `origin/main`, and prove the GitHub merge commit is contained by `origin/main`.

- [ ] **Step 11: Update and prove the Pi**

Follow `update-pi`: fast-forward `~/Marinara-Engine` to merged `main`, run:

```sh
sh scripts/pi-update.sh --trusted-lan
```

Then prove:

- `curl -I http://127.0.0.1:7860/` returns a healthy response;
- the running image revision matches the merged/cooked revision;
- expected containers are running;
- `/home/chai/de-koi-data -> /data` and `/home/chai/.codex -> /root/.codex` mounts remain present.
