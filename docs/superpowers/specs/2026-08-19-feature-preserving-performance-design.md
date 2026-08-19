# Feature-Preserving Performance Design

## Goal

Reduce De-Koi startup, Deki history, Game entry, and bulk-export costs without removing behavior, changing persisted formats, or weakening user feedback.

## Current-main reconciliation

Current `main` already keeps Deki sidebar listing message-free, hydrates one requested history partition, persists record diffs incrementally, defers prompt preview, lazily loads Help, and enforces manifest-aware bundle budgets. This work extends those boundaries; it does not recreate them.

## Design

1. Move the in-memory autonomous-chat activity registry into its own engine-owner module. Chat deletion will import only `clearChatActivity`; the autonomous scheduler will consume the same registry API, preserving one shared state source without pulling schedule logic into the shell bundle.
2. Move single-chat transcript export out of the broad `use-chats.ts` module. The public chat API remains unchanged, while transcript formatting stays reachable only from export UI.
3. Change Deki mutations to request summaries only or the one affected message partition. Multi-session deletion will hydrate only selected partitions so message records are still deleted and unrelated histories are never loaded or rewritten.
4. Keep core Game narration and always-visible game infrastructure eager. Defer the setup wizard for established games, the character sheet until opened, and widget UI until widgets or its preparation modal are visible.
5. Load bulk exports with a stable, bounded worker pool and project only chat IDs for all-chat discovery. Existing native JSON, JSONL ZIP, text ZIP, filenames, ordering, and toasts remain unchanged.
6. Retain the existing bundle-budget script, raise Lighthouse sampling to three runs, and make its performance/resource thresholds blocking while leaving non-performance advisory categories unchanged.

## Error handling and compatibility

- Deki migration remains the fallback when durable rows do not exist.
- Storage errors continue to reject the caller; no silent fallback or fake success is added.
- Lazy panels use existing loading affordances and preserve props/state ownership in `GameSurface`.
- Export rejects missing chats exactly as before and preserves caller-provided order after ID deduplication.

## Proof

- Focused red-green tests for owner boundaries, Deki partition reads, export order/concurrency, and Lighthouse configuration.
- Existing autonomous, chat lifecycle, Deki API, Game boundary, and bundle-budget tests.
- `pnpm check:architecture`, `pnpm typecheck`, `pnpm build`, and `pnpm perf:size`.

## Self-review

The design keeps the five requested optimization areas independent, contains no feature removals or persistence-format changes, and names the exact owner boundary for every edit. Live browser timing remains a post-build proof gap unless a local runtime can be exercised safely.
