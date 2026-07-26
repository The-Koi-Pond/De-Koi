# Memory Ownership Controls Design

## Goal

Give people an explicit, safe choice about whether cross-chat memories leave De-Koi when a chat is deleted or a native character file is exported.

## Product Decisions

- Chat deletion keeps cross-chat memories by default.
- Every user-initiated single-chat, multi-chat, branch, and group deletion surface offers an unchecked option labeled `Also delete cross-chat memories learned only from this chat` (pluralized for multi-chat operations).
- Chat-local transcript chunks, summaries, and other data stored inside the chat are deleted with the chat regardless of that option. The confirmation copy says this plainly.
- Selecting the option removes canonical memories whose only known source is within the deleted chat set.
- A canonical memory supported by both deleted and retained chats remains, but references to deleted chats are removed from its portable source metadata.
- Manually entered character memories with no deleted-chat provenance remain.
- Native character `.dekoi.json` exports offer an unchecked `Include character memories` option.
- The export option applies only to De-Koi Native JSON and native bulk character ZIP exports. Compatible JSON and PNG cards never contain De-Koi memory data.
- Full profile backups remain full-fidelity recovery exports and continue to include all stored collections.
- Plain text and JSONL chat transcript exports remain memory-free.
- Imported native character memories are rebound to the newly created character and do not restore source chat IDs or source message IDs.

## Considered Approaches

### 1. Backend-owned policy with explicit UI options

Pass an explicit memory policy through the typed frontend API, embedded Tauri command, and hostable HTTP dispatch. Rust owns deletion, export sanitization, and import rebinding.

This is the selected approach because the same rule applies to desktop and remote runtimes, destructive behavior cannot be bypassed by a UI-only path, and native exports have one authoritative privacy boundary.

### 2. UI performs memory operations after chat deletion

The frontend could delete the chat and then issue separate canonical-memory mutations. This was rejected because a crash, network failure, or second entrypoint could produce partial behavior, and remote runtime parity would depend on React orchestration.

### 3. Global preference

A setting could always keep or always delete/export memories. This was rejected because the privacy decision is contextual and must remain visible at the destructive or portable-data action.

## Architecture

### Confirmation UI

Add a distinct option-bearing confirmation dialog contract alongside the existing boolean confirmation contract. Existing confirmation callers and return types stay unchanged.

A feature-owned chat deletion helper builds the exact title, body, checkbox label, and default for single or plural chat scopes. Sidebar and chat-file surfaces use the helper. The existing branch/group chooser keeps its two deletion targets and adds the same unchecked checkbox.

Automatic cleanup of empty setup chats does not prompt and continues to use the default `deleteMemories: false`.

### Typed delete contract

Extend `StorageDeleteOptions` and the chat lifecycle input with `deleteMemories?: boolean`. Only the `chats` entity consumes it. Extend group deletion with the same explicit option.

Both embedded Tauri and hostable HTTP paths forward the flag. Omission means `false` at every boundary.

After the chat scope is successfully deleted, Rust applies canonical-memory cleanup across `canonical-memories` and `memory-index-rows` atomically. The result reports:

- deleted chat IDs;
- number of canonical memories deleted;
- number of shared canonical memories retained after provenance cleanup;
- whether memory cleanup was requested.

If memory cleanup cannot complete, the chat deletion result reports a cleanup failure rather than pretending all requested memories were removed. The frontend shows a warning that the chat is gone but some memories may remain and points the person to Manage Memories.

### Canonical memory ownership

For each canonical memory, the owner gathers known source chat IDs from:

- `scope.kind === "chat"` and `scope.id`;
- `provenance.sourceChatId`;
- string values in `payload.sourceChatIds`.

When none intersect the deleted chat set, the record is unchanged.

When every known source is in the deleted set, the canonical record and every index row for its memory ID are deleted, including pinned records.

When deleted and retained sources are both present, the memory remains. Deleted chat IDs are removed from `payload.sourceChatIds`; a deleted `provenance.sourceChatId` is replaced by a retained source; and source message IDs are cleared because they cannot be safely attributed after the source chat is removed.

Records with no known source are never inferred to belong to a deleted chat.

### Native character export

Extend single and bulk character export APIs with `includeMemories?: boolean`. The flag is honored only for native format.

When selected, the native envelope includes a `memories` array containing character-scoped canonical memories. The portable projection includes:

- a file-local export ID;
- kind, status, content, confidence, title, and tags;
- file-local supersession links when both linked memories are exported.

It excludes chat IDs, message IDs, storage timestamps, embeddings, index rows, provider/model details, and arbitrary payload fields.

Compatible JSON and PNG paths ignore the option and never receive the native memory envelope.

### Native character import

When a native envelope contains memories, import creates the character first, then creates new canonical memory records scoped to the new character ID. It remaps file-local supersession links, sets source chat and message provenance to empty, and lets canonical storage create the matching lexical index atomically.

Malformed optional memory rows are rejected before any memory write. If memory creation fails, imported memory records, character assets, and the created character are rolled back through the existing native-character rollback path.

Older native files without `memories` import exactly as before.

## User-Facing Copy

Chat deletion:

- Checkbox: `Also delete cross-chat memories learned only from this chat`
- Helper: `Chat-local history and summaries are deleted either way. Shared memories supported by other chats are kept.`

Plural deletion:

- Checkbox: `Also delete cross-chat memories learned only from these chats`

Character export:

- Checkbox: `Include character memories`
- Helper: `Only De-Koi Native exports can include memories. Source chat and message IDs are never exported.`

Cleanup warning:

- `The chat was deleted, but De-Koi could not finish removing every selected memory. Review Manage Memories before relying on the cleanup.`

## Error Handling

- Missing flags default to safe preservation.
- Non-chat generic deletes ignore the memory flag.
- Compatible character exports remain memory-free even if a stale caller passes the flag.
- Memory cleanup failure is visible and never rolls the deleted chat back into frontend caches.
- Import rejects invalid memory kinds, statuses, confidence values, or missing content.
- Export/import never copies embedding or provider metadata.

## Verification

- Rust canonical-memory tests cover exclusive source deletion, shared-source retention and provenance cleanup, manual-memory retention, pinned-memory deletion, and atomic index cleanup.
- Rust entity/group deletion tests cover the default keep behavior and explicit delete behavior.
- Shared API tests cover embedded command arguments and safe defaults.
- Component/helper tests cover unchecked defaults, cancellation, single/plural copy, and option propagation.
- Export tests prove native opt-in inclusion and compatible exclusion.
- Import tests prove character-ID rebinding, stripped chat provenance, index creation, old-file compatibility, and rollback.
- Run `pnpm check:architecture`, focused TypeScript tests, focused Rust tests, `cargo check --manifest-path src-tauri/Cargo.toml`, and the full `pnpm check` shipping gate.

## Manual Proof

Before merge, exercise the rendered option-bearing dialog and native character export selection in the browser/app if the available environment can reach the UI. If not, record component proof as the exact boundary and do not claim a live app interaction.
