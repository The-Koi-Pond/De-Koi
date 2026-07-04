# Canonical Memory Architecture

Phase 2 introduces canonical memory records as the source of truth for long-lived De-Koi memory. Legacy `chats.memories[]` remains supported for Memory Recall, but it is not backfilled into canonical memory and canonical memory is not injected into prompts automatically in this phase.

## Canonical Records

Canonical memories live in `canonical-memories`. Each record has a `kind`, `status`, `scope`, `confidence`, `content`, `provenance`, optional tags/title/supersession links, and a kind-specific `payload` object.

Memory kinds:

- `episode`: a remembered narrative or conversation episode.
- `fact`: a durable factual statement.
- `scene_event`: an event tied to a scene or moment in play.
- `relationship_state`: relationship state between user, characters, agents, or world actors.
- `preference`: user, character, chat, scene, world, or agent preference.
- `lore`: durable world or setting information that is memory-shaped rather than lorebook-authored.
- `summary`: a compact summary memory produced or curated from a larger context.

Statuses:

- `active`: eligible for default query results and indexing.
- `pinned`: eligible for default query results and indexing, with product meaning reserved for future ranking.
- `stale`: retained but excluded from default query and index results.
- `superseded`: retained for provenance but excluded from default query and index results.
- `deleted`: soft-deleted canonical record; excluded from default query and index results.

Scopes:

- `user`, `character`, `chat`, `scene`, `world`, and `agent` each store `{ kind, id }` so queries can ask for the memory domain directly.

Provenance stores the source chat, message IDs, scene, character, and timestamp when known. These fields explain where the memory came from; they do not make transcript chunks authoritative.

## Projection Rows

Retrieval projection rows live in `memory-index-rows`. They are rebuildable and never authoritative. Every row points back to `memoryId` and stores provider/model/dimensions metadata, content and projection hashes, `canonicalUpdatedAt`, and either vector data or lexical fallback payloads.

Query behavior always resolves index hits back to canonical memory records. Canonical status wins over an index hit: `deleted`, `superseded`, and `stale` records are excluded by default even if an index row matches. Rows whose `canonicalUpdatedAt` no longer matches the canonical record are treated as stale and ignored.

Canonical edits that change content, kind, scope, provenance, status, confidence, tags, payload, title, or supersession links invalidate projection rows for that memory. Soft deletion sets status to `deleted` and removes index rows.

## Lexical Fallback

When no embedding provider is configured, explicit lexical rebuild can create projection rows with provider `lexical`, model `de-koi-lexical-v1`, dimensions `64`, hashes, tokens, and a deterministic lexical vector. This supports retrieval in no-provider mode only. It is not canonical storage.

## Phase 2 Migration Note

Phase 2 does not migrate or backfill `chats.memories[]`. Existing Memory Recall rows remain in place and continue to be protected by Phase 1 invalidation behavior. Future phases may add extraction, migration, prompt assembly, or provider embedding workflows, but those are intentionally out of scope here.