# Manual Memory Entry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add direct, honest manual memory creation to the existing character Memories tab and chat Memory Console.

**Architecture:** Character memories remain canonical `memory` records scoped to a character and are created through `canonicalMemoryApi`. Chat memories remain embedded `ChatMemoryChunk` rows owned by the current chat and gain a focused `chat_memory_create` command with embedded and remote-runtime parity. Each existing panel owns its own composer and query invalidation.

**Tech Stack:** React 19, TypeScript, TanStack Query, Vitest/jsdom, Tauri 2, Rust, serde_json.

## Global Constraints

- Preserve the separate character-memory and chat-memory owners.
- Inherited character memories stay read-only in the chat Memory Console.
- Trim and reject empty content at both UI and owning API/backend boundaries.
- Mark manual records with accurate manual provenance.
- Desktop and remote/Pi clients must route the same chat-memory command.
- Preserve unrelated import, export, edit, pin, correction, delete, restore, and recall behavior.

---

### Task 1: Character-scoped manual memory creation

**Files:**
- Modify: `src/features/catalog/characters/lib/character-memory-model.ts`
- Modify: `src/features/catalog/characters/lib/character-memory-model.spec.ts`
- Modify: `src/features/catalog/characters/hooks/use-character-memories.ts`
- Modify: `src/features/catalog/characters/components/CharacterMemoriesTab.tsx`
- Create: `src/features/catalog/characters/components/CharacterMemoriesTab.spec.tsx`

**Interfaces:**
- Produces: `createManualCharacterMemoryInput(characterId: string, content: string, createdAt?: string): CanonicalMemoryInput`
- Produces: `useCreateCharacterMemory(characterId: string)` mutation returning `{ memory: CanonicalMemoryRecord; indexRefreshFailed: boolean }`
- Consumes: `canonicalMemoryApi.create`, `canonicalMemoryApi.index.rebuildLexical`, and `characterMemoryKeys.detail`

- [ ] **Step 1: Write the failing model test**

Add a test asserting:

```ts
expect(createManualCharacterMemoryInput(" char-1 ", "  Mira keeps the brass key.  ", now)).toEqual({
  kind: "fact",
  status: "active",
  scope: { kind: "character", id: "char-1" },
  content: "Mira keeps the brass key.",
  confidence: 1,
  provenance: {
    sourceChatId: null,
    messageIds: [],
    sceneId: null,
    characterId: "char-1",
    timestamp: now,
  },
  tags: ["manual"],
  payload: { manual: true, createdBy: "user" },
  createdAt: now,
  updatedAt: now,
});
expect(() => createManualCharacterMemoryInput("", "memory")).toThrow("Choose a character");
expect(() => createManualCharacterMemoryInput("char-1", "   ")).toThrow("Memory content is required");
```

- [ ] **Step 2: Run the model test and verify RED**

Run: `pnpm vitest run src/features/catalog/characters/lib/character-memory-model.spec.ts`

Expected: FAIL because `createManualCharacterMemoryInput` is not exported.

- [ ] **Step 3: Implement the pure character input builder**

Add the exact validation and `CanonicalMemoryInput` shape asserted above. Use the supplied timestamp or `new Date().toISOString()`.

- [ ] **Step 4: Run the model test and verify GREEN**

Run: `pnpm vitest run src/features/catalog/characters/lib/character-memory-model.spec.ts`

Expected: PASS.

- [ ] **Step 5: Write the failing character-tab component test**

Mock `useCharacterMemories`, `useCreateCharacterMemory`, update/import/source hooks, render the tab, click **New memory**, type content, click **Save memory**, and assert:

```ts
expect(createMemory.mutateAsync).toHaveBeenCalledWith("Mira keeps the brass key.");
expect(container.textContent).toContain("New memory");
```

Also reject a whitespace-only draft without calling the mutation.

- [ ] **Step 6: Run the component test and verify RED**

Run: `pnpm vitest run src/features/catalog/characters/components/CharacterMemoriesTab.spec.tsx`

Expected: FAIL because the action and mutation hook do not exist.

- [ ] **Step 7: Implement the mutation and character composer**

`useCreateCharacterMemory` must:

```ts
const memory = await canonicalMemoryApi.create(
  createManualCharacterMemoryInput(characterId, content),
);
let indexRefreshFailed = false;
try {
  await canonicalMemoryApi.index.rebuildLexical({
    scope: { kind: "character", id: characterId },
  });
} catch {
  indexRefreshFailed = true;
}
return { memory, indexRefreshFailed };
```

Always invalidate the character-memory query after a saved record, including a
partial index refresh. The UI closes and clears a saved draft, shows
`Memory added` on full success, and warns `Memory added, but its recall index
could not be refreshed.` for the partial outcome. A failed create keeps the
draft and shows the real error.

- [ ] **Step 8: Verify the character slice**

Run:

```powershell
pnpm vitest run src/features/catalog/characters/lib/character-memory-model.spec.ts src/features/catalog/characters/components/CharacterMemoriesTab.spec.tsx
pnpm typecheck
```

Expected: both test files and TypeScript pass.

- [ ] **Step 9: Commit the character slice**

```powershell
git add src/features/catalog/characters
git commit -m "feat: add manual character memories"
```

---

### Task 2: Chat-memory creation capability and runtime routing

**Files:**
- Modify: `src-tauri/src/commands/storage/chat_memory.rs`
- Modify: `src-tauri/src/commands/storage/commands/chats.rs`
- Modify: `src-tauri/src/http_dispatch.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src/shared/api/remote-runtime.ts`
- Modify: `src/shared/api/chat-command-api.ts`
- Create: `src/shared/api/chat-command-api.spec.ts`

**Interfaces:**
- Produces: `chat_memory::create_chat_memory(state: &AppState, chat_id: &str, body: Value) -> AppResult<Value>`
- Produces: Tauri command `chat_memory_create(chat_id: String, body: Value)`
- Produces: `chatCommandApi.memoryCreate<T>(chatId, { content })`
- Consumes: existing `memory_embedding_context`, `embed_chat_memory_object`, `chat_memory_values_for_mutation`, and `set_chat_memory_values`

- [ ] **Step 1: Write the failing Rust capability test**

In `chat_memory.rs`, seed `chat-1`, call:

```rust
let created = create_chat_memory(
    &state,
    "chat-1",
    json!({ "content": "  The ferry leaves before dawn.  " }),
)
.await
.expect("manual memory should be created");
```

Assert trimmed content plus:

```rust
assert_eq!(created["chatId"], json!("chat-1"));
assert_eq!(created["memoryKind"], json!("manual"));
assert_eq!(created["scopeType"], json!("chat"));
assert_eq!(created["scopeId"], json!("chat-1"));
assert_eq!(created["source"], json!("manual"));
assert_eq!(created["creationReason"], json!("User-created memory"));
assert_eq!(created["status"], json!("active"));
assert_eq!(created["userEdited"], json!(true));
assert_eq!(created["messageIds"], json!([]));
assert_eq!(created["hasEmbedding"], json!(true));
assert_eq!(created["embeddingSource"], json!("lexical"));
```

Assert the same row is persisted, then assert whitespace input returns
`invalid_input` and leaves the array unchanged.

- [ ] **Step 2: Run the Rust test and verify RED**

Run: `cargo test --manifest-path src-tauri/Cargo.toml chat_memory::tests::manual_memory_creation -- --exact --nocapture`

Expected: compile failure because `create_chat_memory` does not exist.

- [ ] **Step 3: Implement the Rust capability**

Validate `body.content`, load the chat, resolve its embedding context, construct
one canonical manual `Map<String, Value>` with a new id and current timestamps,
embed it before persistence, append it to the existing mutable memory array,
persist once, and return only the created row. Provider/index failure must occur
before the chat patch so retry cannot duplicate a partially saved row.

- [ ] **Step 4: Run the Rust test and verify GREEN**

Run: `cargo test --manifest-path src-tauri/Cargo.toml chat_memory::tests::manual_memory_creation -- --exact --nocapture`

Expected: PASS.

- [ ] **Step 5: Write the failing TypeScript API test**

Mock `invokeTauri`, call:

```ts
await chatCommandApi.memoryCreate("chat-1", { content: "The ferry leaves before dawn." });
```

Assert:

```ts
expect(invokeTauri).toHaveBeenCalledWith("chat_memory_create", {
  chatId: "chat-1",
  body: { content: "The ferry leaves before dawn." },
});
```

- [ ] **Step 6: Run the API test and verify RED**

Run: `pnpm vitest run src/shared/api/chat-command-api.spec.ts`

Expected: FAIL because `memoryCreate` is missing.

- [ ] **Step 7: Wire all runtime surfaces**

Add the focused API wrapper, Tauri command facade, desktop registration, remote
allowlist entry, and an async `http_dispatch` arm that requires `chatId` and
passes `body` to the same Rust capability. Do not add a separate HTTP-only
implementation.

- [ ] **Step 8: Verify API routing and remote parity**

Run:

```powershell
pnpm vitest run src/shared/api/chat-command-api.spec.ts
pnpm check:architecture
cargo check --manifest-path src-tauri/Cargo.toml --workspace
```

Expected: API test, remote command parity, architecture guards, and Rust compile pass.

- [ ] **Step 9: Commit the chat capability**

```powershell
git add src-tauri/src/commands/storage/chat_memory.rs src-tauri/src/commands/storage/commands/chats.rs src-tauri/src/http_dispatch.rs src-tauri/src/lib.rs src/shared/api/remote-runtime.ts src/shared/api/chat-command-api.ts src/shared/api/chat-command-api.spec.ts
git commit -m "feat: create manual chat memories"
```

---

### Task 3: Chat Memory Console composer

**Files:**
- Modify: `src/features/catalog/chats/hooks/use-chats.ts`
- Modify: `src/features/modes/shared/chat-ui/components/settings/MemoryRecallMemoriesModal.tsx`
- Modify: `src/features/modes/shared/chat-ui/components/settings/MemoryRecallMemoriesModal.spec.ts`

**Interfaces:**
- Produces: `useCreateChatMemory(chatId: string | null)`
- Consumes: `chatCommandApi.memoryCreate<ChatMemoryChunk>` and `chatKeys.memories`

- [ ] **Step 1: Write the failing console component test**

Extend the modal spec with mocked chat hooks and a mounted modal. Open **New
memory**, submit `The ferry leaves before dawn.`, and assert:

```ts
expect(createMemory.mutateAsync).toHaveBeenCalledWith("The ferry leaves before dawn.");
```

Assert whitespace-only input does not call the mutation and inherited rows still
render the **Open character memories** action rather than edit controls.

- [ ] **Step 2: Run the modal test and verify RED**

Run: `pnpm vitest run src/features/modes/shared/chat-ui/components/settings/MemoryRecallMemoriesModal.spec.ts`

Expected: FAIL because the composer and create hook do not exist.

- [ ] **Step 3: Implement the hook and composer**

The hook calls:

```ts
chatCommandApi.memoryCreate<ChatMemoryChunk>(chatId, { content })
```

and invalidates `chatKeys.memories(chatId)` on success. Add the composer near
the local import/export controls, include create mutation state in `busy`,
select the returned row after success, close/clear on success, retain the draft
on error, and show `Memory added and indexed.` only after the command resolves.

- [ ] **Step 4: Verify the chat UI slice**

Run:

```powershell
pnpm vitest run src/features/modes/shared/chat-ui/components/settings/MemoryRecallMemoriesModal.spec.ts
pnpm typecheck
```

Expected: modal tests and TypeScript pass.

- [ ] **Step 5: Commit the chat UI slice**

```powershell
git add src/features/catalog/chats/hooks/use-chats.ts src/features/modes/shared/chat-ui/components/settings/MemoryRecallMemoriesModal.tsx src/features/modes/shared/chat-ui/components/settings/MemoryRecallMemoriesModal.spec.ts
git commit -m "feat: add chat memory composer"
```

---

### Task 4: Discoverability, integrated validation, and shipping

**Files:**
- Modify: `src/features/shell/discovery/discovery-entries.json`

**Interfaces:**
- Consumes: the shipped character Memories tab and chat Memory Console actions.

- [ ] **Step 1: Update the existing memory discovery entry**

Update `chat-memory-summaries` so its summary/keywords state that users can
manually add chat-local memories and add durable memories from Character Editor
> Memories. Keep the existing route and avoid adding a duplicate discovery item.

- [ ] **Step 2: Run focused and lane validation**

Run:

```powershell
pnpm vitest run src/features/catalog/characters/lib/character-memory-model.spec.ts src/features/catalog/characters/components/CharacterMemoriesTab.spec.tsx src/shared/api/chat-command-api.spec.ts src/features/modes/shared/chat-ui/components/settings/MemoryRecallMemoriesModal.spec.ts
cargo test --manifest-path src-tauri/Cargo.toml chat_memory::tests::manual_memory_creation -- --exact --nocapture
pnpm check:architecture
pnpm typecheck
pnpm build
pnpm check
```

Expected: all focused tests and full PR boundary checks pass.

- [ ] **Step 3: Run Bunny review and resolve findings**

Use the repository Bunny workflow against the complete branch diff. Fix every
actionable finding with a new failing test when behavior changes, rerun focused
proof plus `pnpm check`, and repeat until Bunny reports zero unresolved findings.

- [ ] **Step 4: Commit discoverability or review fixes**

```powershell
git add src/features/shell/discovery/discovery-entries.json
git commit -m "docs: surface manual memory entry"
```

Include any reviewed source/test fixes in an intentional additional commit.

- [ ] **Step 5: Push and open the PR**

Inspect branch, remotes, and staged/unstaged scope. Push only to `origin`. Open a
draft PR using the repository template with behavior, verification, risk,
Feature Discoverability, Bunny, and health receipts.

- [ ] **Step 6: Pass PR health, CI, and merge**

Run `pr-health.mjs <PR> --for-ready`, address CI/review threads, mark ready only
when all gates pass, and merge to `main` without force-pushing. Verify the PR is
merged and `origin/main` contains the merge commit.
