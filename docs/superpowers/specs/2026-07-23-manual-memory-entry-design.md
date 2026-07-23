# Manual Memory Entry Design

## Goal

Let users create memory text directly in the two existing memory owners:

- Character Editor > Memories creates a durable character-wide memory.
- Chat Settings > Memory Console creates a memory local to the current chat.

The feature must preserve the existing distinction between editable local chat
memories and read-only character memories inherited into a chat.

## User Experience

Each memory manager gets a clearly labeled **New memory** action near its
existing import and export controls. Activating it reveals a small composer with
a multiline text field, **Save memory**, and **Cancel**.

Saving trims surrounding whitespace and rejects empty text without closing the
composer. While a save is running, duplicate submission is disabled. Success
closes the composer, selects or surfaces the new memory, and shows durable
success feedback. Failure keeps the text available for retry and shows the
backend error.

Character creation is available only in the character Memories tab. The chat
console continues to treat inherited character memories as read-only and links
users to the character tab to manage them.

## Ownership and Data Flow

### Character memory

The character catalog feature owns the UI and React Query mutation. It creates a
canonical memory through the focused canonical-memory API with:

- scope `character:<character id>`
- kind `fact`
- status `active`
- confidence `1`
- provenance containing the character id, no source chat, and no message ids
- manual-origin metadata in tags and payload

After creation, De-Koi rebuilds that character scope's lexical index and
invalidates the character-memory query. If the memory is saved but its index
refresh fails, the UI closes the composer and reports that accurate partial
outcome so retrying cannot create a duplicate.

### Chat memory

The chat catalog feature owns the frontend mutation. A new focused
`chat_memory_create` command validates non-empty content and writes a manual,
active, user-edited `ChatMemoryChunk` into the current chat with:

- scope type and id for the current chat
- memory kind `manual`
- source and creation reason identifying manual user entry
- empty message provenance
- current timestamps

The privileged chat-memory capability then rebuilds the new row's recall index
using the same provider-or-lexical path as edited and restored rows. The command
is registered for embedded Tauri and the hostable HTTP dispatcher so desktop
and remote/Pi clients behave identically.

## Error Handling

- Empty or whitespace-only content is rejected in both the UI and owning
  backend/API boundary.
- Missing character or chat ids do not create records.
- Failed writes keep the user's draft and do not show success. A post-save
  indexing failure keeps the saved record, closes the draft, and warns that
  retrieval indexing needs another refresh.
- Existing import, export, edit, pin, correction, delete, restore, and inherited
  read-only behavior remains unchanged.

## Testing

Focused tests will prove:

- character manual input has the correct scope and honest provenance;
- character creation refreshes the index and invalidates the query;
- chat creation rejects empty input and produces a manual chat-local row;
- chat creation is routed through the focused TypeScript API, embedded command
  registration, and remote HTTP dispatch;
- both existing panels expose their own creation action without making inherited
  character memories editable from the chat console.

Shipping validation includes the focused test set, architecture checks,
TypeScript checks, Rust checks, build, full `pnpm check`, Bunny Review, PR health,
CI, and merge to `main`.
