# Memory Quality and Deki Access Design

## Goal

Automatic character memories should be compact statements of what happened or what was learned, never raw user and character dialogue. Memory-success feedback should remain visible long enough to read. Deki-senpai should be able to inspect and edit character memories and approved chat memories through the same validated storage owners used by the rest of De-Koi.

## Current Failure

The automatic capture queue creates two representations of an exchange:

1. `refreshChatMemories` stores a transcript-shaped chat recall capture.
2. The LLM consequence extractor produces compact canonical memory sentences.

For character-scoped persistence, the queue currently promotes the transcript-shaped capture into a canonical `episode` in addition to persisting extracted consequences. That makes literal dialogue appear in Character Memory. When no consequence is produced, the same transcript capture is also used as the success-toast fallback.

Deki-senpai has creative-library and approved-chat tools, but no tool can list or update either canonical character memories or per-chat Memory Recall entries. The prompt explicitly says memories are unavailable.

## Chosen Design

### Automatic memory quality

- Keep transcript-shaped captures in the existing per-chat recall lane because they provide source evidence and local lexical recall.
- Do not promote a transcript capture into canonical character memory.
- Persist only validated consequence-extraction results as new automatic canonical memories.
- Publish a memory success completion only for a created or updated canonical consequence. If extraction yields no trustworthy consequence, create no character memory and show no success toast.
- Preserve existing literal canonical episodes. No automatic migration or silent rewriting will alter user data. Deki and the existing Character Memory editor can repair those records deliberately.

This preserves the chat recall pipeline while stopping the user-visible cross-chat character-memory defect at its owner boundary.

### Toast behavior

- Keep the existing `Memory saved` and `Memory updated` wording and extracted sentence description.
- Set the automatic-memory success toast duration to 8,000 milliseconds.
- Do not show a success toast for an internal transcript capture that did not produce a canonical consequence.

### Deki memory access

Add narrowly scoped Deki tools rather than exposing raw collections:

- A read tool lists memories for one explicit scope.
  - Character scope queries canonical memories for an explicit character ID.
  - Chat scope lists active/retrievable Memory Recall entries for an explicit chat ID and requires an existing Deki chat-access grant covering that chat.
- An edit tool updates one explicit memory ID within the declared scope.
  - Character edits use canonical-memory validation and refresh the affected lexical index.
  - Chat edits use the chat-memory update owner so the edited content is re-embedded.
  - The server verifies that the selected record belongs to the requested character or chat before mutation.
- Tools support content edits only. They do not delete, bulk rewrite, import, export, pin, restore, or change status.
- Results return only the bounded memory data Deki needs: IDs, content, status/kind where applicable, timestamps, and source identifiers. They never return full chat transcripts, secrets, or unrelated collections.
- Update Deki's tool descriptions and system prompt to explain when memory tools are available and that chat-memory access requires an approved grant.
- Update the chat-access approval card to disclose scoped memory reads and state that an edit still requires an explicit request.

## Ownership and Data Flow

- Automatic consequence extraction and queue policy remain in `src/engine/generation`.
- Toast selection remains a pure shell policy in `src/app/shell/app-shell-center-surfaces.ts`; rendering remains in `AppShell.tsx`.
- Deki tool definitions and privileged memory access live under `src-tauri/src/commands/storage/deki`, calling the existing canonical-memory and chat-memory owners.
- Existing Deki chat grants remain the authorization source for private chat-memory access.
- No feature component calls raw Tauri commands or remote runtime endpoints.

## Error Handling and Safety

- Missing, deleted, out-of-scope, or inactive memories produce explicit tool errors.
- Chat-memory requests without a matching grant are rejected before any content is read or changed.
- Empty edits are rejected.
- A failed re-index or re-embedding operation fails the edit rather than reporting false success.
- A failed consequence extraction keeps the existing queue retry behavior but does not fall back to promoting literal dialogue.

## Verification

- Queue regression tests prove raw transcript captures are not copied into canonical character memory and do not produce success notifications when no consequence exists.
- Consequence tests prove compact extracted sentences are persisted and published.
- Shell tests prove automatic memory toasts request an 8-second duration.
- Rust Deki tests prove character-memory reads/edits work, chat-memory reads/edits require a covering grant, deleted chat memories stay hidden, cross-scope IDs are rejected, and edits update the correct owner.
- Deki surface tests prove the chat-access approval copy discloses memory access and the separate explicit-edit requirement.
- Run focused Vitest and Rust tests, `pnpm typecheck`, `pnpm check:architecture`, and `cargo check --manifest-path src-tauri/Cargo.toml`.

## Out of Scope

- Rewriting or migrating existing literal memories.
- Giving Deki delete, bulk-edit, import/export, or unrestricted transcript access.
- Replacing transcript-shaped per-chat recall evidence with LLM summaries.
- Changing Memory Recall enablement, retrieval ranking, embedding providers, or notification preferences.
