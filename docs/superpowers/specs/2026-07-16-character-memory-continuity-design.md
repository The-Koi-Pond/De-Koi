# Character Memory Continuity and Portable Import Design

**Project:** De-Koi
**Date:** 2026-07-16
**Status:** Approved

## Goal

Make durable memories follow a character across Conversations and Roleplays by
default while preserving an explicit per-character chat-local option. Repair
Memory Recall file import in the same change so portable memory data never
depends on a destination chat's provider connection.

## Product Rules

- `Across chats and roleplays` is the effective default for every character
  whose preference is absent.
- `Keep memories separate by chat` is the explicit alternative.
- The existing Memory Recall enable switch remains the master on/off control
  for capture and retrieval in a chat.
- A memory becomes character-wide only when De-Koi can attribute the saved
  assistant turn to exactly one active character.
- Narrator, shared, or ambiguous group and scene memories remain local to the
  originating chat or scene.
- Existing chat-scoped memories never migrate silently.
- Importing a Memory Recall file never reads, validates, or invokes an LLM or
  embedding connection. Import uses the deterministic local lexical index.
- De-Koi remains read-only with respect to model providers except for the
  generation and embedding requests the operator explicitly enables during
  normal runtime. File import is a local storage operation.

## Non-Goals

- Do not merge `agent-memory`, plugin memory, lorebooks, rolling summaries, or
  game world state into character memory.
- Do not infer a character owner from names or prose when a stable character ID
  is unavailable.
- Do not copy all historical chat memories automatically.
- Do not embed personal memory history inside ordinary character-card exports.
- Do not add a second memory retrieval engine or duplicate memories into every
  new chat.
- Do not require an external provider to import, browse, edit, or delete
  memories.

## Architecture

The canonical memory collection remains the single owner of cross-chat durable
memory. The existing chat `memories` projection remains the owner of the local
Memory Recall console, source exchange, and compatibility export.

```text
saved assistant exchange
        |
        v
automatic capture queue
        |
        +-- exact source capture -> originating chat memories projection
        |
        +-- deterministic scope resolver
                |
                +-- one attributable character + across preference
                |       -> canonical character memory
                |
                +-- chat-local preference or ambiguous ownership
                        -> no character-wide record

future Conversation or Roleplay
        |
        +-- local chat/scene recall
        +-- canonical scopes for active across-enabled characters
        v
one bounded Memory Recall prompt context
```

Scope selection is React-free engine behavior. React edits character
preferences and renders resolved scope labels; it does not reproduce scope or
attribution rules. Canonical storage and indexing remain privileged Rust
capabilities reached through the existing typed shared API and explicit remote
runtime dispatch.

## Character Preference

Add the internal character field:

```ts
type CharacterMemoryPersistence = "character" | "chat";

interface Character {
  memoryPersistence?: CharacterMemoryPersistence;
}
```

The effective value is `character` when the field is absent. The field is
stored on De-Koi's internal character row rather than inside `data` or character
card extensions. Therefore:

- Existing characters receive the new default without a destructive migration.
- Updating an existing character preserves its preference.
- Duplicated and newly imported character cards receive a new character ID, no
  personal memories, and the default `character` preference.
- Ordinary character-card export excludes the preference and all personal
  memories.
- De-Koi full-library backups retain the internal preference as part of the
  character row; memory records remain separate records.

The character editor exposes one clearly labeled control:

- **Across chats and roleplays** — remember attributable exchanges whenever
  Memory Recall is enabled.
- **Keep memories separate by chat** — capture and recall only the current
  chat's memory history.

Changing the preference affects future capture and whether that character's
canonical scope participates in future retrieval. It does not rewrite existing
records.

## Deterministic Capture Attribution

Introduce one pure scope resolver owned by the generation engine. Its inputs
are the chat mode and identity, the saved assistant message's `characterId`,
the active character IDs, the optional active scene ID, and the matched
character's effective preference.

Resolution rules, in priority order:

1. If Memory Recall is disabled, do not enqueue automatic capture.
2. If the saved assistant message has a stable `characterId`, that ID belongs
   to an active chat character, and that character's effective preference is
   `character`, select `{ kind: "character", id: characterId }`.
3. If the attributed character explicitly uses `chat`, select the current chat
   scope.
4. If no one stable active character owns the assistant turn, keep an active
   Roleplay/Visual Novel scene in scene scope when a stable scene ID exists.
5. Otherwise select the current chat scope.

The resolver never chooses an owner from display names, prompt text, list
position, or a single-character fallback when the saved message explicitly
identifies a different or missing speaker. This prevents merged narrators and
shared group narration from leaking knowledge into a character.

## Durable Capture and Idempotency

The persisted automatic-capture job records the resolved scope, source chat,
source message IDs, assistant character ID, and the exact source snapshots.
Legacy queued jobs without a valid scope normalize to their existing chat
scope.

Processing retains the existing source-integrity checks. A successful focused
capture always updates the originating chat's Memory Recall projection. When
the resolved scope is `character`, the queue also upserts one canonical memory:

```ts
{
  id: stableIdFromCaptureJob,
  kind: "episode",
  status: "active",
  scope: { kind: "character", id: characterId },
  content: exactCapturedExchange,
  confidence: 1,
  provenance: {
    sourceChatId,
    messageIds: sourceMessageIds,
    sceneId,
    characterId,
    timestamp: assistantMessageCreatedAt
  },
  tags: ["automatic", mode],
  payload: {
    automatic: true,
    captureVersion: 2,
    captureJobId
  }
}
```

The canonical ID is derived from the durable capture-job identity. Retries,
process restarts, repeated queue scheduling, and duplicate UI adoption update
the same record rather than create duplicates. A job is complete only after
the local projection and canonical record are durable. Index rebuild failure
does not discard a durable memory; lexical canonical-query fallback remains
available and the index can be rebuilt later.

Chat-scoped capture does not create a character-scoped canonical record. This
keeps the explicit isolation promise real instead of merely hiding a record in
the UI.

## Retrieval

Canonical retrieval joins the ordinary Memory Recall path when all of the
following are true:

- The chat's effective Memory Recall switch is enabled.
- The optional legacy canonical-recall override is not explicitly `false`.
- At least one active character has effective `character` persistence.

Scope queries include the current chat, current scene when applicable, and
only the stable IDs of active across-enabled characters. They exclude muted or
inactive characters. Existing scoring, recent-message exclusion, status,
supersession, confidence, and prompt-token limits remain unchanged.

Conversation and Roleplay pass the same character preference into the same
engine resolver and canonical context builder. No mode imports another mode's
feature code.

The prompt describes recalled records as earlier relevant context rather than
claiming they came from the current chat. Visible newer messages still win over
contradictory recalled memory.

## Character-Level Memory Management

Add a **Memories** section to the character editor. It queries only
`{ kind: "character", id: characterId }` and supports:

- Search and status filtering.
- Source chat and source timestamp inspection.
- Edit, pin/unpin, correct, restore, and soft delete using canonical memory
  commands.
- Explicit per-character JSON export and import.
- Explicit copying of selected eligible chat-local memories.

The existing chat Memory Console continues to manage its chat projection. It
adds two visual categories:

- **Local to this chat/scene** — editable in the current console.
- **Inherited from Character Name** — read-only summary with an action that
  opens that character's memory manager.

No inherited memory can be edited through the wrong chat owner.

## Explicit Legacy Copy

Existing chat memories stay local. The character memory manager provides
**Copy memories from a chat**:

1. Choose a chat containing the character.
2. Select one or more active, non-deleted memories.
3. Confirm the target character and preview the content.
4. Create canonical `episode` records with stable copy IDs, the original
   `sourceChatId`, original source message IDs when present, the target
   `characterId`, and `payload.migratedFromChatMemoryId`.

The original chat memory is not deleted or mutated. Repeating the copy skips
records already copied from the same chat-memory identity. In group chats the
operator must choose the target explicitly; De-Koi does not bulk-attribute
ambiguous history.

## Portable Memory Recall File Import Repair

### Root Cause

The current chat-memory import resolves the destination chat's embedding
context before parsing or normalizing the file. A missing or stale destination
`connectionId`/`embeddingConnectionId` therefore rejects a local data import,
even when the file already contains an embedding and even though imported
content can be indexed locally.

### New Import Contract

Memory Recall v1 file import is provider-independent:

1. Validate the envelope and normalize importable chunks.
2. Deduplicate them against the destination chat.
3. Ignore file-carried numeric embeddings because vectors are not portable
   across provider models, dimensions, or installations.
4. Generate the existing deterministic local lexical vector for every newly
   imported chunk.
5. Persist the import atomically under the existing append/replace semantics.
6. Return imported, skipped, replaced, and lexical-indexed counts.

The import path never resolves a connection and never makes a network request.
The normal **Rebuild memories** action remains the explicit way to replace
local lexical vectors with semantic embeddings from a configured provider.

Refresh and live capture keep their current explicit-configuration behavior:
if the user selected a broken embedding connection for those operations, they
report the configuration error rather than silently changing providers. The
portable-import exception is narrow and visible, not a global fallback.

## Character Lifecycle, Export, and Deletion

- Updating a character preserves its stable ID, preference, and memory scope.
- Duplicating a character creates a new ID and does not copy personal memories.
- Importing a card as a new character does not adopt memories from a matching
  name, avatar, creator, or card metadata.
- Updating an existing character through an explicit import/update flow keeps
  that character's existing memories because its stable ID remains the owner.
- Ordinary character-card export contains neither personal memories nor the
  internal preference.
- Character-memory export is a separate explicit JSON action with a clear
  privacy warning and canonical provenance.
- Deleting a character uses the existing privileged deletion owner to mark its
  canonical memories deleted and remove their index rows before the deletion
  completes. Orphaned character memories are never retrieved by name matching.

## Runtime and API Boundaries

- Scope resolution, defaults, capture semantics, and migration identity live
  in `src/engine`.
- Character and chat React packages consume engine types/helpers and focused
  hooks. They do not call raw Tauri or remote HTTP APIs.
- Existing canonical-memory and chat-memory shared API wrappers remain the
  frontend boundary. Any added command is allowlisted in `remote-runtime.ts`
  and explicitly dispatched by `http_dispatch.rs`.
- Rust owns durable canonical records, indexes, atomic chat-memory import, and
  character-deletion cleanup.
- Conversation and Roleplay remain separate mode owners that share neutral
  generation and memory contracts.

## Error Handling

- Invalid character persistence values normalize to the safe default only when
  reading legacy data; update inputs reject unsupported explicit values.
- A capture with missing, inactive, or conflicting character identity remains
  local and records the fallback reason on its job.
- Deleted or edited source messages retain the current stale-job behavior and
  cannot create a new durable character memory.
- Duplicate canonical capture and migration identities are idempotent.
- Invalid Memory Recall envelopes still fail before any write.
- Replace import with zero valid normalized chunks remains an error and leaves
  existing memories untouched.
- Import never fails because a destination provider connection is missing.
- Character-memory management failures preserve the last durable record and
  surface an actionable local error.

## Test Strategy

### Pure Engine Tests

- Missing preference defaults to character-wide persistence.
- Explicit chat preference remains local.
- One active attributed character selects character scope.
- A missing, inactive, conflicting, narrator, or ambiguous group identity
  selects chat/scene scope.
- Conversation and Roleplay produce the same scope for the same identity.
- Legacy jobs without scope normalize to chat-local.

### Capture and Retrieval Tests

- One exchange creates one local projection and one canonical character memory.
- Retry and restart reuse the same canonical ID.
- Chat-only capture creates no character-wide record.
- A memory captured in Conversation is recalled in a new Roleplay for the same
  character.
- A Roleplay memory is recalled in a new Conversation for the same character.
- Other, inactive, and duplicated characters do not receive the memory.
- Ambiguous group narration never leaks into a character scope.
- The master Memory Recall switch disables capture and retrieval.

### Management and Lifecycle Tests

- The character manager queries and mutates only its stable character scope.
- The chat console distinguishes local and inherited rows.
- Copying selected local memories preserves provenance and is idempotent.
- Existing memories remain unchanged until copied.
- New imports and duplicates start without personal memories.
- Updating an existing character preserves memories.
- Deleting a character excludes its memories and removes index rows.
- Character-card export contains no preference or personal memory.
- Explicit character-memory export/import round-trips canonical records.

### Portable Import Regression Tests

- A valid v1 file imports when the destination chat references a missing
  embedding connection.
- Import does not call connection resolution or provider embedding code.
- File-carried vectors are replaced with deterministic lexical vectors.
- Missing-vector and present-vector files produce the same portable indexing
  metadata.
- Duplicate append imports remain skipped.
- Replace import remains atomic and rejects an empty valid set.
- Rebuild can later upgrade imported lexical rows through a valid configured
  embedding connection.

### Integration and Safety Checks

- Embedded Tauri and hostable remote runtime expose the same commands and
  results.
- Architecture checks prove engine/UI/API/Rust boundaries.
- Network/provider tripwires prove file import performs no provider request.
- Focused Vitest and Rust tests pass, followed by `pnpm test`, `pnpm check`,
  Bunny Review, and the ready-for-review health gate.

## Acceptance Criteria

- New attributable memories follow a character across Conversations and
  Roleplays by default.
- Users can opt a character into strict chat-local memory behavior.
- Ambiguous group and narrator memories never become character-wide.
- Existing chat memories do not migrate without explicit selection.
- Character memories have a character-owned management and export surface.
- Chat memory UI clearly distinguishes inherited from local records.
- Duplicate/import/delete behavior follows stable character IDs and prevents
  accidental memory inheritance or retrieval.
- A valid Memory Recall file imports successfully regardless of stale or
  missing destination connection configuration.
- Portable import performs no network request and creates usable local lexical
  indexes.
- The combined change remains compatible with embedded and remote runtimes.
