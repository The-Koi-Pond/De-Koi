# Hot Storage Backend Strategy

Status: proposed architecture direction for issue #876.

De-Koi's current `FileStorage` backend stores normal collections as JSON arrays under
`<app-data>/collections/<collection>.json`. That keeps data portable and easy to
inspect, but the hot paths still pay for full-file scans, full-array parses, and
full-collection rewrites when collections grow. `messages` and `chats` already have
targeted optimizations, but they remain JSON collection files.

## Decision

Use SQLite as the hot operational backend for selected high-volume collections and
read models. Do not build a long-lived custom system of materialized JSON index or
summary files.

The storage capability stays behind the existing Rust boundary. Frontend and engine
callers should continue to use the storage gateway and shared API wrappers; they
should not learn whether a collection is served by JSON files, SQLite rows, or a
transitional shadow index. Embedded Tauri and hostable HTTP runtime paths must route
through the same explicit storage command handlers.

Raw JSON remains the compatibility and exchange format. User-facing backup,
export, import, and profile-package flows must continue to produce and accept
JSON-shaped collection data even when a hot collection is served by SQLite at
runtime.

## Why SQLite

- SQLite gives indexed filters, ordering, limits, and point lookups without parsing
  every row in a collection file.
- SQLite removes the need to rewrite a whole JSON array for append-heavy or
  frequently patched records.
- SQLite has a tested crash-recovery, transaction, and migration story. A custom
  JSON index layer would need to reimplement consistency, invalidation, recovery,
  compaction, and rebuild behavior.
- SQLite can support both embedded Tauri and the hostable runtime from the Rust
  storage capability without widening the TypeScript engine or React feature
  layers.
- SQLite read models can be introduced collection by collection while preserving
  the current storage command contract.

Materialized JSON summary files are rejected as the long-term backend because they
would add another durable format, another corruption mode, and another import/export
surface while still leaving large rewrites unsolved for hot collections.

## First Hot Collections

Migrate or index these areas first:

1. `chats`: sidebar and recent-chat reads need projection, sorting by `updatedAt`,
   folder filtering, status display, and small limits without scanning every chat
   row.
2. `messages`: chat transcript reads need indexed `chatId` access, pagination,
   append, edit, delete, and lightweight metadata queries without reparsing a large
   global message array.
3. `message-swipes`: swipe sidecars are internal but can grow with generated
   alternatives; they need indexed `messageId` and `chatId` reads and deletes.
4. `characters`: character summaries are read by chat status, gallery, search, and
   selector surfaces. They are not as append-heavy as messages, but they are a high
   fan-out lookup target.
5. Chat metadata fields that drive shell or runtime lists: title, mode, folder,
   participant IDs, timestamps, last-message summary, and status fields should live
   in indexed columns or generated read-model rows. Large mode-specific blobs can
   remain JSON payload columns until a narrower owner needs them.

Later candidates are `agent-runs`, canonical memory projection rows, gallery
metadata, and resource-library catalogs, but they should wait until the first slice
proves the migration and compatibility path.

## Compatibility Contract

- Existing JSON collection files are valid import input.
- Profile export/import continues to operate on JSON-shaped collection records.
- Backups must either include the SQLite database plus a manifest or generate a
  JSON profile package before handoff. User-facing export should prefer the JSON
  package shape.
- A migrated collection needs an explicit schema version, idempotent migration, and
  rollback-safe failure behavior. Migration failure must leave the previous JSON
  data readable.
- The app should be able to rebuild SQLite read models from JSON for transitional
  collections. Once a collection becomes SQLite-authoritative, export becomes the
  rebuild source for user portability rather than the runtime source of truth.
- The remote runtime and embedded Tauri runtime must share the same Rust storage
  implementation. Do not create separate browser-only or TypeScript-only storage
  indexes.
- External edits to JSON files remain best-effort compatibility, not a guaranteed
  live update mechanism for SQLite-authoritative collections.
- Destructive collection operations must delete or update both authoritative rows
  and any managed files, sidecars, or read models in one transaction or in a
  recoverable two-step path.

## First Vertical Slice

Build a SQLite-backed `chats` read model before moving all chat writes.

Scope:

- Add a Rust storage-internal SQLite database under app data, opened by the storage
  capability with WAL mode and an explicit schema version.
- Create a `chat_summaries` table keyed by chat id with columns for `updatedAt`,
  `createdAt`, `title`, `mode`, `folderId`, `characterIds`, `personaId`, status
  fields, and a JSON payload for fields not yet promoted.
- Backfill `chat_summaries` from the existing `chats` JSON collection at startup or
  on first use.
- Maintain the summary row on `create`, `update`, `patch`, and delete for `chats`.
- Serve the common projected chat-list query from SQLite when the requested fields,
  filters, order, and limit are covered. Fall back to existing JSON behavior for
  unsupported query shapes.
- Keep JSON export/import behavior unchanged for the slice.

Measure before and after with the diagnostics from issue #873:

- cold and warm `storage_list` for `chats` with projected sidebar fields,
  descending `updatedAt`, and limits of 25, 50, and 100;
- update latency for patching one chat title or timestamp in a large collection;
- startup backfill time for 1k, 10k, and 50k chat rows;
- correctness checks comparing SQLite-served results to JSON-served results for
  the same query shape.

Success target:

- covered sidebar reads avoid full JSON parse on cache misses;
- covered reads stay under 50 ms p95 for 10k chat rows on the reference Windows
  machine;
- single-chat summary updates avoid a full `chats.json` rewrite on the final
  SQLite-authoritative step;
- JSON profile export/import still round-trips the same chat records.

## Validation Plan

- Unit tests for schema migration, idempotent backfill, query equivalence, and
  stale/corrupt read-model rebuild.
- Rust storage integration tests for `create`, `update`, `patch`, delete,
  `list_projected`, order, limit, and fallback behavior.
- Import/export tests proving JSON profile packages are unchanged for user-facing
  flows.
- Hostable-runtime tests proving `/api/invoke` storage dispatch uses the same Rust
  storage behavior as embedded Tauri commands.
- Diagnostics captures before and after the first slice, stored as PR evidence.

## Risks And Open Questions

- Choose the SQLite Rust dependency and feature flags deliberately. `rusqlite` with
  bundled SQLite is the likely default, but the first slice should confirm Windows,
  Linux, and Raspberry Pi packaging behavior.
- Decide how app backups present SQLite data: database file backup, generated JSON
  package, or both.
- Define corruption recovery UX before SQLite becomes authoritative for a
  collection.
- Keep schema migrations small and forward-only; avoid a single migration that
  moves every collection at once.
- Treat cross-process writes and manual JSON edits as unsupported for
  SQLite-authoritative collections unless a later design explicitly supports them.
