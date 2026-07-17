# Character Memory Continuity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make automatic memories follow a character across Conversation and Roleplay by default, add character-owned management and explicit legacy copying, and make Memory Recall file import independent of provider connections.

**Architecture:** The existing chat-memory projection remains local to its chat. A pure engine resolver assigns each automatic capture job either a character or local scope; character-scoped jobs idempotently upsert a canonical `episode` record after the local capture succeeds. Canonical retrieval reads active across-enabled characters, while React manages preferences and records through focused APIs. Rust keeps atomic chat import and character-deletion cleanup.

**Tech Stack:** TypeScript, React, TanStack Query, Vitest, Rust, Tauri commands, hostable `/api/invoke`, durable JSON-backed storage.

## Global Constraints

- Missing character preference means `character`.
- Explicit `chat` preference prevents new character-wide writes and retrieval.
- Stable saved-message `characterId` is the only automatic character attribution signal.
- Ambiguous group/narrator turns remain chat/scene-local.
- Existing chat memories never migrate silently.
- Memory Recall v1 import never resolves or invokes a provider connection.
- Conversation and Roleplay remain separate mode owners.
- All runtime commands retain embedded/remote parity.
- The combined work ships in one PR as explicitly requested.

## Durable Test Rationale

This change alters storage, prompt assembly, cross-chat identity, deletion, import/export, and both runtime entrypoints. Existing manual proof cannot protect against silent cross-character leakage, duplicate capture after restart, or a provider call during import. The committed tests below are narrow owner-level guards: pure scope tests, the existing queue and canonical-context suites, focused Rust storage tests, and small UI-model tests.

---

### Task 1: Character Persistence Contract and Scope Resolver

**Files:**
- Modify: `src/engine/contracts/types/character.ts`
- Modify: `src/engine/contracts/schemas/character.schema.ts`
- Test: `src/engine/contracts/schemas/character.schema.spec.ts`
- Create: `src/engine/generation/character-memory-scope.ts`
- Test: `src/engine/generation/character-memory-scope.spec.ts`
- Modify: `src/engine/generation/prompt-assembly.ts`

**Interfaces:**
- Produces:

```ts
export type CharacterMemoryPersistence = "character" | "chat";

export function effectiveCharacterMemoryPersistence(
  value: unknown,
): CharacterMemoryPersistence;

export interface CharacterMemoryScopeCharacter {
  id: string;
  memoryPersistence?: CharacterMemoryPersistence;
}

export type AutomaticMemoryScopeResolution = {
  scope: { kind: "character" | "chat" | "scene"; id: string };
  characterId: string | null;
  reason:
    | "attributed_character"
    | "character_chat_only"
    | "ambiguous_scene"
    | "ambiguous_chat";
};

export function resolveAutomaticMemoryScope(input: {
  chatId: string;
  mode: string;
  sceneId?: string | null;
  assistantCharacterId?: string | null;
  activeCharacters: CharacterMemoryScopeCharacter[];
}): AutomaticMemoryScopeResolution;
```

- `GenerationCharacterContext` gains `memoryPersistence: CharacterMemoryPersistence`.

- [x] **Step 1: Write failing contract and resolver tests**

Cover the absent-value default, explicit chat value, schema rejection of unsupported explicit values, attributed active character, chat-only character, missing/inactive identity, ambiguous roleplay scene, and ambiguous conversation chat.

```ts
expect(effectiveCharacterMemoryPersistence(undefined)).toBe("character");
expect(resolveAutomaticMemoryScope({
  chatId: "chat-1",
  mode: "conversation",
  assistantCharacterId: "char-1",
  activeCharacters: [{ id: "char-1" }],
})).toMatchObject({
  scope: { kind: "character", id: "char-1" },
  reason: "attributed_character",
});
```

- [x] **Step 2: Run the tests and verify RED**

Run:

```powershell
pnpm vitest run src/engine/contracts/schemas/character.schema.spec.ts src/engine/generation/character-memory-scope.spec.ts
```

Expected: failure because the type, schema field, helper, and resolver do not exist.

- [x] **Step 3: Implement the minimal contract and resolver**

Add `memoryPersistence` to internal create/update schemas, not `CharacterData`. Load the normalized field from the character row in `loadCharacterContext`. Do not inspect names or infer an owner from character count.

- [x] **Step 4: Run focused tests and typecheck**

```powershell
pnpm vitest run src/engine/contracts/schemas/character.schema.spec.ts src/engine/generation/character-memory-scope.spec.ts
pnpm typecheck
```

- [x] **Step 5: Commit**

```powershell
git add src/engine/contracts src/engine/generation
git commit -m "Add character memory persistence contract"
```

### Task 2: Idempotent Character-Scoped Automatic Capture

**Files:**
- Modify: `src/engine/generation/automatic-memory-capture-queue.ts`
- Test: `src/engine/generation/automatic-memory-capture-queue.spec.ts`
- Modify: `src/engine/generation/start-generation.ts`
- Test: `src/engine/generation/start-generation.memory-recall.e2e.spec.ts`
- Test: `src/engine/generation/start-generation.group-typing.spec.ts`

**Interfaces:**
- `AutomaticMemoryCaptureScheduleInput` gains `characters: CharacterMemoryScopeCharacter[]`.
- Capture jobs persist `scopeKind`, `scopeId`, `scopeReason`, `characterId`, and optional `sceneId`.
- Character canonical IDs use:

```ts
function canonicalMemoryIdForJob(jobId: string): string {
  return `canonical-${jobId}`;
}
```

- Character canonical upsert uses:

```ts
{
  id: canonicalMemoryIdForJob(jobId),
  kind: "episode",
  status: "active",
  scope: { kind: "character", id: characterId },
  content: capture.memory.content,
  confidence: 1,
  provenance: {
    sourceChatId: chatId,
    messageIds: sourceMessageIds,
    sceneId,
    characterId,
    timestamp: assistantCreatedAt,
  },
  tags: ["automatic", mode],
  payload: { automatic: true, captureVersion: 2, captureJobId: jobId },
}
```

- [x] **Step 1: Write failing queue tests**

Add tests proving:

- attributed default character scope is persisted on the job;
- explicit chat preference persists chat scope;
- ambiguous group/scene fallback is local;
- processing creates one canonical record after local refresh;
- retry/reprocessing updates the stable ID rather than duplicating it;
- chat-local jobs never call `createMemory`;
- legacy jobs without scope remain chat-local.

- [x] **Step 2: Verify RED**

```powershell
pnpm vitest run src/engine/generation/automatic-memory-capture-queue.spec.ts
```

- [x] **Step 3: Implement scheduling and canonical upsert**

Resolve scope when the immutable source snapshot is enqueued. Keep `refreshChatMemories(chatId, { sourceMessageIds })` unchanged for the local projection. After refresh returns an exact capture, use the generic storage read plus `createMemory`/`updateMemory` to upsert the stable canonical record. Rebuild only the touched character scope; record index failure without discarding the durable memory.

- [x] **Step 4: Write and run generation seam tests**

Pass `assembly.characters` from both saved-assistant paths into `enqueueAutomaticMemoryCaptureSafely`. Update existing call assertions to include the new character context without weakening exact source-message checks.

```powershell
pnpm vitest run src/engine/generation/start-generation.memory-recall.e2e.spec.ts src/engine/generation/start-generation.group-typing.spec.ts
```

- [x] **Step 5: Run all focused capture tests and typecheck**

```powershell
pnpm vitest run src/engine/generation/automatic-memory-capture-queue.spec.ts src/engine/generation/start-generation.memory-recall.e2e.spec.ts src/engine/generation/start-generation.group-typing.spec.ts
pnpm typecheck
```

- [x] **Step 6: Commit**

```powershell
git add src/engine/generation
git commit -m "Persist automatic character memories"
```

### Task 3: Cross-Conversation and Cross-Roleplay Retrieval

**Files:**
- Modify: `src/engine/generation/canonical-memory-context.ts`
- Test: `src/engine/generation/canonical-memory-context.spec.ts`
- Modify: `src/engine/generation/prompt-assembly.ts`
- Test: `src/engine/generation/start-generation.memory-recall.e2e.spec.ts`

**Interfaces:**
- `CanonicalMemoryCharacterContext` gains `memoryPersistence`.
- Canonical retrieval is enabled when ordinary Memory Recall is effectively enabled and `enableCanonicalMemoryRecall !== false`.
- Character scope queries include only effective `character` characters.

- [x] **Step 1: Add failing retrieval tests**

Prove that a missing preference queries character scope, an explicit chat preference does not, explicit canonical disable is honored, the master Memory Recall disable is honored, and inactive/non-present characters are not queried.

Add an E2E storage harness case that captures for `char-1` in a Conversation and then assembles a Roleplay prompt with the same character and the new canonical row.

- [x] **Step 2: Verify RED**

```powershell
pnpm vitest run src/engine/generation/canonical-memory-context.spec.ts src/engine/generation/start-generation.memory-recall.e2e.spec.ts
```

- [x] **Step 3: Implement effective retrieval**

Import `getEffectiveMemoryRecallEnabled` and the character preference helper. Replace the hidden opt-in-only gate with the approved effective rule. Keep current scope dedupe, score, recency, recent-message, supersession, and token limits.

Update prompt copy from “earlier in this chat” to “relevant earlier context” when canonical rows are present.

- [x] **Step 4: Verify focused and prompt suites**

```powershell
pnpm vitest run src/engine/generation/canonical-memory-context.spec.ts src/engine/generation/start-generation.memory-recall.e2e.spec.ts src/engine/generation/prompt-assembly.context-priority.spec.ts
pnpm typecheck
```

- [x] **Step 5: Commit**

```powershell
git add src/engine/generation
git commit -m "Recall memories across character chats"
```

### Task 4: Portable Connection-Independent Memory Import

**Files:**
- Modify: `src-tauri/src/commands/storage/chat_memory.rs`

**Interfaces:**
- `import_chat_memories` returns:

```json
{
  "imported": 1,
  "skipped": 0,
  "replaced": false,
  "lexicalIndexed": 1
}
```

- [x] **Step 1: Replace strict-connection import tests with failing portability tests**

The tests must seed a destination chat that references a missing explicit embedding connection and import:

1. a chunk with a numeric file embedding;
2. a chunk without an embedding.

Both must succeed, store `embeddingSource: "lexical"`, clear provider connection/model metadata, and produce the same deterministic local vector. Keep refresh tests that reject broken explicitly configured connections unchanged.

- [x] **Step 2: Verify RED**

```powershell
cargo test --manifest-path src-tauri/Cargo.toml import_chat_memories_ -- --nocapture
```

Expected: the missing connection aborts before normalization.

- [x] **Step 3: Implement the narrow import fix**

Remove eager `memory_embedding_context(state, &chat)` from import. For each new normalized chunk, discard file-carried embedding/index metadata and call:

```rust
insert_memory_embedding_fields(
    &mut memory,
    embed_memory_content(None, &content).await?,
);
```

Increment `lexical_indexed`. Preserve append/replace atomicity and all dedupe behavior.

- [x] **Step 4: Verify Rust memory tests**

```powershell
cargo test --manifest-path src-tauri/Cargo.toml chat_memory::tests -- --nocapture
cargo check --manifest-path src-tauri/Cargo.toml --workspace
```

- [x] **Step 5: Commit**

```powershell
git add src-tauri/src/commands/storage/chat_memory.rs
git commit -m "Make memory file import provider independent"
```

### Task 5: Character Preference and Memory Manager

**Files:**
- Create: `src/features/catalog/characters/lib/character-memory-model.ts`
- Test: `src/features/catalog/characters/lib/character-memory-model.spec.ts`
- Create: `src/features/catalog/characters/hooks/use-character-memories.ts`
- Create: `src/features/catalog/characters/components/CharacterMemoriesTab.tsx`
- Modify: `src/features/catalog/characters/components/CharacterEditor.tsx`
- Modify: `src/features/catalog/characters/components/CharacterEditorTabContent.tsx`
- Modify: `src/features/catalog/characters/components/CharacterEditorTabRail.tsx`
- Modify: `src/features/catalog/characters/hooks/use-characters.ts`
- Modify: `src/shared/api/canonical-memory-api.ts`
- Test: `src/shared/api/canonical-memory-api.spec.ts`
- Modify: `src/features/catalog/characters/index.ts`

**Interfaces:**
- `CharacterMemoriesTab` receives `characterId`, `characterName`, `memoryPersistence`, and `onMemoryPersistenceChange`.
- Query key: `["character-memories", characterId]`.
- Character export envelope:

```ts
type CharacterMemoryExportV1 = {
  type: "de_koi_character_memories";
  version: 1;
  exportedAt: string;
  character: { id: string; name: string };
  memories: CanonicalMemoryRecord[];
};
```

- [x] **Step 1: Write failing pure model/API tests**

Cover export sanitization, import normalization to the selected stable character scope, stable migration IDs, status labels, and canonical API argument shapes.

- [x] **Step 2: Verify RED**

```powershell
pnpm vitest run src/features/catalog/characters/lib/character-memory-model.spec.ts src/shared/api/canonical-memory-api.spec.ts
```

- [x] **Step 3: Implement hooks and model**

Use `canonicalMemoryApi.query/update/delete/create/index.rebuildLexical`. Soft delete uses `status: "deleted"`; restore uses `status: "active"`; pin toggles `pinned`/`active`. Import rewrites scope to the selected character and preserves source provenance. Export excludes index vectors and provider metadata.

- [x] **Step 4: Implement the Memories tab**

Add a `Brain` tab with:

- persistence radio/select;
- search and active/deleted/pinned filter;
- source chat/timestamp details;
- edit, pin, restore, soft delete;
- explicit JSON export/import;
- “Copy memories from a chat” flow that lists chats containing the character and requires row selection plus confirmation.

Save `memoryPersistence` beside `data` and `comment` in `CharacterEditor`; do not put it in card data.

- [x] **Step 5: Verify focused UI/model checks**

```powershell
pnpm vitest run src/features/catalog/characters/lib/character-memory-model.spec.ts src/shared/api/canonical-memory-api.spec.ts src/features/catalog/characters/hooks/use-characters.spec.ts
pnpm typecheck
```

- [x] **Step 6: Commit**

```powershell
git add src/features/catalog/characters src/shared/api/canonical-memory-api*
git commit -m "Add character memory management"
```

### Task 6: Distinguish Inherited Memories in Chat

**Files:**
- Modify: `src/features/modes/shared/chat-ui/components/settings/MemoryRecallMemoriesModal.tsx`
- Test: `src/features/modes/shared/chat-ui/components/settings/MemoryRecallMemoriesModal.spec.ts`
- Modify: `src/features/catalog/chats/hooks/use-chats.ts`
- Modify: `src/features/catalog/chats/index.ts`

**Interfaces:**
- Add a hook that loads active character IDs from the chat, resolves effective across-enabled characters, and queries canonical rows for each character scope.
- UI rows use:

```ts
type DisplayMemoryOwner =
  | { kind: "local"; label: "Local to this chat" | "Local to this scene" }
  | { kind: "character"; characterId: string; label: `Inherited from ${string}` };
```

- [x] **Step 1: Add failing filter/owner tests**

Prove local and inherited labels, inherited read-only behavior, source search, and exclusion of chat-only/inactive characters.

- [x] **Step 2: Verify RED**

```powershell
pnpm vitest run src/features/modes/shared/chat-ui/components/settings/MemoryRecallMemoriesModal.spec.ts
```

- [x] **Step 3: Implement inherited queries and display**

Keep local mutation buttons only for local rows. Inherited rows show canonical status/provenance and an “Open character memories” action. Do not copy canonical rows into chat storage.

- [x] **Step 4: Verify**

```powershell
pnpm vitest run src/features/modes/shared/chat-ui/components/settings/MemoryRecallMemoriesModal.spec.ts
pnpm typecheck
```

- [x] **Step 5: Commit**

```powershell
git add src/features/modes/shared/chat-ui src/features/catalog/chats
git commit -m "Show inherited character memories in chats"
```

### Task 7: Character Deletion Cleanup and Runtime Parity

**Files:**
- Modify: `src-tauri/src/commands/storage/canonical_memory.rs`
- Modify: `src-tauri/src/commands/storage/commands/entities/delete.rs`
- Modify: `src-tauri/src/commands/storage/commands/entities.rs`
- Modify: `src-tauri/src/http_dispatch.rs` only if a new command is required by Task 5
- Modify: `src/shared/api/remote-runtime.ts` only if a new command is required by Task 5
- Modify: `src/features/shell/discovery/discovery-entries.json`
- Test: nearest Rust entity-delete tests
- Test: `src/shared/api/remote-runtime.spec.ts` when routing changes

**Interfaces:**
- Rust helper:

```rust
pub(crate) fn soft_delete_memories_for_scope(
    state: &AppState,
    scope_kind: &str,
    scope_id: &str,
) -> AppResult<usize>;
```

- [x] **Step 1: Add failing deletion test**

Seed one character-scoped canonical memory, one other-character memory, and index rows. Delete the character through `delete_entity`. Assert only the deleted character's memory is `deleted` and its index rows are removed.

- [x] **Step 2: Verify RED**

```powershell
cargo test --manifest-path src-tauri/Cargo.toml delete_character_ -- --nocapture
```

- [x] **Step 3: Implement cleanup in the existing character-delete owner**

Call the focused canonical-memory cleanup from the existing `characters` deletion path. Do not add a React-side cleanup sequence. Preserve media/gallery/version cleanup.

- [x] **Step 4: Update discoverability**

Add the character Memories tab and cross-chat continuity keywords/action to the existing character or Memory Recall discovery entry. Do not create duplicate entries.

- [x] **Step 5: Run architecture and runtime checks**

```powershell
pnpm check:architecture
pnpm check:discovery -- --changed-from origin/main
cargo check --manifest-path src-tauri/Cargo.toml --workspace
pnpm typecheck
```

- [x] **Step 6: Commit**

```powershell
git add src-tauri src/shared/api src/features/shell/discovery
git commit -m "Clean up deleted character memories"
```

### Task 8: Combined Verification and Shipping

**Files:**
- Modify: `docs/superpowers/plans/2026-07-17-character-memory-continuity.md` checkboxes as work completes
- Modify: PR body only after local proof

- [x] **Step 1: Run focused regression suites**

```powershell
pnpm vitest run src/engine/generation/character-memory-scope.spec.ts src/engine/generation/automatic-memory-capture-queue.spec.ts src/engine/generation/canonical-memory-context.spec.ts src/engine/generation/start-generation.memory-recall.e2e.spec.ts src/features/catalog/characters/lib/character-memory-model.spec.ts src/features/modes/shared/chat-ui/components/settings/MemoryRecallMemoriesModal.spec.ts
cargo test --manifest-path src-tauri/Cargo.toml chat_memory::tests -- --nocapture
cargo test --manifest-path src-tauri/Cargo.toml canonical_memory -- --nocapture
```

- [x] **Step 2: Run full local gates**

```powershell
pnpm test
pnpm check
git diff --check origin/main...HEAD
```

- [x] **Step 3: Run Bunny review**

Use the Bunny skill on the complete branch. Address blocker findings with red tests and rerun focused/full gates. Record the final READY result.

- [ ] **Step 4: Push and open one draft PR**

Push only to `origin`. The PR must:

- link `#1047`;
- describe the memory import root cause and regression proof;
- mark Feature Discoverability updated;
- include storage, import/export, prompt, cross-mode, privacy, and remote-runtime risk claims;
- leave human validation unchecked.

- [ ] **Step 5: Verify PR health**

```powershell
$prNumber = gh pr view --json number --jq '.number'
node .agents/automation/scripts/pr-health.mjs $prNumber --repo The-Koi-Pond/De-Koi --json
```

Do not mark ready or merge this new PR without a new explicit instruction.
