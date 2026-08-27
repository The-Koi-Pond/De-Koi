# Canonical Memory Architecture

Canonical memory records are the source of truth for long-lived De-Koi memory. Legacy `chats.memories[]` remains supported for chat-local Memory Recall. Eligible chat, scene, and character canonical memories are retrieved into generation prompts through a bounded context block.

## Canonical Records

Canonical memories live in `canonical-memories`. Each record has a `kind`, `status`, `scope`, `confidence`, `content`, `provenance`, optional tags/title/supersession links, and a kind-specific `payload` object.

Memory kinds:

- `episode`: a remembered narrative or conversation episode.
- `fact`: a durable factual statement.
- `scene_event`: an event tied to a scene or moment in play.
- `relationship_state`: relationship state between user, characters, agents, or world actors.
- `preference`: user, character, chat, scene, world, or agent preference.
- `promise`: a commitment made by the user, character, or agent.
- `plot_state`: current plot or scene state that should survive later turns.
- `contradiction`: a memory that explicitly corrects or supersedes an earlier memory.
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

## Story Episodes and Arcs

Roleplay Story Continuity uses canonical records rather than a second summary store. Episodes are `episode` memories; four consecutive, non-overlapping episodes produce one `summary` memory whose versioned payload identifies it as an arc. Both use `storyProjectionVersion: 1`, a stable coverage ID and source fingerprint, exact ordered message IDs, first/last boundaries, summarizer identity, source-backed structured details, and readable prose in `content`. Arc payloads also retain the exact source episode IDs. Formal scenes create one whole-scene episode from the same final scene-summary model pass.

`story-consolidation-jobs` is the durable, chronologically processed background queue. It shares the fenced background-memory writer authority while retaining independent jobs, retries, source snapshots, and terminal state. Ordinary Roleplay closes an episode on the first saved assistant boundary at or after 24 eligible uncovered messages. Active formal scenes pause thresholding. Existing chats catch up one oldest uncovered episode after each new reply; **Build existing story** explicitly drains the backlog.

Source edits and deletes stale the affected episode, dependent arcs, matching queued jobs, and rebuildable index rows together. Unrelated story slots and atomic memories are not changed. Regeneration requires every ordered source to remain available, writes the deterministic replacement before superseding the old projection, and permits overlap only for the same coverage slot through that explicit supersession link.

Prompt assembly retrieves Story Continuity through its own bounded selector and attribution kind. It does not consume the atomic-memory candidate count or token budget. Active or pinned projections overlapping retained raw history are excluded, duplicate represented sentences are removed, and the context block explicitly says recent transcript and canonical atomic memory win conflicts.

## Projection Rows

Retrieval projection rows live in `memory-index-rows`. They are rebuildable and never authoritative. Every row points back to `memoryId` and stores provider/model/dimensions metadata, content and projection hashes, `canonicalUpdatedAt`, and either vector data or lexical fallback payloads.

Query behavior always resolves index hits back to canonical memory records. Canonical status wins over an index hit: `deleted`, `superseded`, and `stale` records are excluded by default even if an index row matches. Rows whose `canonicalUpdatedAt` no longer matches the canonical record are treated as stale and ignored.

Canonical edits make provider projections stale through their `canonicalUpdatedAt` and content hash. The next semantic query lazily replaces stale or missing provider vectors for the resolved embedding connection and model. Lexical projection replacement does not delete provider projections. Soft deletion sets status to `deleted` and removes every index row for that memory.

## Semantic Retrieval

When the active chat or generation connection resolves to a configured embedding model, canonical retrieval embeds the user query and lazily embeds only missing or stale scoped memories. Provider vectors are cached per memory, resolved embedding connection, provider, and model. Cosine similarity supplies semantic ranking evidence; results below the default `0.28` similarity threshold do not qualify a memory by meaning alone.

The scoped candidate query happens before vectorization. Group turns therefore retain the existing source-sensitive targeting contract: a Jester-targeted turn can retrieve shared chat/scene memories and Jester's character memories, but not another group member's character scope.

Provider vectors are derived cache data. A missing embedding model, unsupported provider authentication mode, network failure, invalid vector, or other semantic-query error leaves generation on the existing lexical/pinned retrieval path. These failures never mutate canonical records and never block durable memory capture.

## Lexical Fallback

When no embedding provider is configured, explicit lexical rebuild can create projection rows with provider `lexical`, model `de-koi-lexical-v1`, dimensions `64`, hashes, tokens, and a deterministic lexical vector. This supports retrieval in no-provider mode only. It is not canonical storage.

## Phase 2 Migration Note

Phase 2 does not migrate or backfill `chats.memories[]`. Existing Memory Recall rows remain in place and continue to be protected by Phase 1 invalidation behavior.

## Phase 3 Automatic Capture Note

Phase 3 captures candidate memories asynchronously after saved assistant generation for conversation, roleplay, and agent chats. Captured records are written to `canonical-memories`, never to `chats.memories[]`. Low-confidence or uncertain candidates are stored as `stale`; contradiction candidates can supersede older canonical records through supersession links. When source messages are edited, source-derived canonical memories become `stale`; when source messages are deleted, they become `deleted`. Projection rows are rebuilt or invalidated from canonical records and remain non-authoritative.
