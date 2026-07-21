# Performance Critical Paths Design

## Goal

Reduce De-Koi's generation latency, Deki history latency, startup work, runtime blocking, and storage compaction cost while keeping embedded Tauri and hostable runtime behavior equivalent.

## Scope

This design implements GitHub issues #1135 through #1145 in one integration PR. Each issue remains an independently testable vertical slice even though the final delivery is one branch and PR.

## Architecture

The work stays with the current owners:

- provider batching, blocking filesystem work, startup cleanup, remote dispatch ownership, and journal compaction remain in Rust;
- prompt assembly, canonical-memory selection, cross-chat awareness, and Lorebook Keeper scheduling remain React-free engine behavior;
- Deki history coordination remains in the focused shared runtime API;
- diagnostics extend the existing opt-in frontend and Rust performance helpers.

Remote-capable behavior continues through the explicit shared API, remote allowlist, HTTP dispatch, and focused Rust owner pipeline. No engine module may import React or a concrete runtime adapter.

## Delivery Order

1. Add stage diagnostics so later changes have stable measurement boundaries.
2. Land low-risk Rust improvements: embedding batching, linear startup cleanup, request ownership transfer, and bounded blocking filesystem execution.
3. Remove generation critical-path waterfalls: parallel prompt prerequisites and background Lorebook Keeper backfill.
4. Replace repeated reads: target-only Deki hydration, batched canonical-memory scopes, and bounded cross-chat context reads.
5. Extend the existing mutation journal with bounded compaction thresholds instead of adding another persistence mechanism.

## Detailed Contracts

### Embeddings

The existing provider-aware `embed_texts` helper is the single batching owner. Compatible providers receive bounded arrays and return vectors in input order. Providers without batch support use the current sequential behavior. Embedded and hostable endpoints expose the same JSON response shape.

### Prompt assembly

Character, persona, and preset reads start together. Macro-sensitive work retains its current order. Lorebook, episodic-memory, and canonical-memory work may overlap only after their immutable inputs are fixed. Final prompt sections, attribution, snapshots, and reusable-context output remain deterministic.

### Lorebook Keeper

Foreground generation schedules a per-chat single-flight background job after the assistant message is durable. The scheduler deduplicates target messages, serializes work per chat, and yields background update callbacks without delaying the foreground `done` event.

### Deki history

Session-list reads return lightweight session records without hydrating every message. Active history loads by `sessionId`. Mutations read the target session plus session summaries, preserve legacy migration, and retain the current durable `deki-sessions` and `deki-messages` formats.

### Canonical memory and cross-chat context

Canonical-memory scope queries batch chat, scene, and character scopes through one capability call while preserving per-scope filtering and ranking metadata. Cross-chat awareness requests a bounded set of recent conversation siblings and bounded message windows without transferring the full chat collection.

### Runtime and startup

Orphaned character-version media cleanup builds reference sets once, then subtracts them from candidate files. Backup and export facades execute recursive filesystem/archive work in bounded blocking tasks. Hostable blocking dispatch moves owned argument maps rather than cloning them.

### Journal compaction

The existing durable collection journal remains the acknowledgment boundary. Generic dirty collections may retain their journal overlay across short bursts and compact only when an explicit age, entry-count, byte-size, shutdown, or compatibility boundary is reached. Recovery, atomic updates, import/export, and checkpoint-tracked collections retain their existing fail-closed behavior.

### Diagnostics

Diagnostics stay opt-in and silent by default. Stable stage names cover prompt preparation, first token, post-save tail work, Deki summary/history hydration, and background maintenance. Details exclude content, IDs, request bodies, secrets, and full paths.

## Error Handling And Compatibility

- Batch failures preserve provider error semantics and never reorder successful vectors.
- Background jobs report failures through existing diagnostics without turning a saved foreground reply into a failure.
- Blocking-task join errors become explicit app errors; no panic or silent catch is introduced.
- Deki legacy settings migrate through the existing durable-state path.
- Batched memory/context queries preserve single-scope compatibility until every caller is migrated.
- Journal corruption continues to block startup and preserves the primary file for recovery.

## Testing

Every behavior follows red-green-refactor at the highest stable public seam. Focused TypeScript and Rust tests precede implementation. Final validation is `pnpm check:architecture`, `pnpm typecheck`, `pnpm test`, Rust focused suites, `cargo test --manifest-path src-tauri/Cargo.toml --workspace`, `pnpm build`, `pnpm perf:size`, and `pnpm check`.

## Out Of Scope

- a wholesale SQLite migration;
- removing Lorebook Keeper, memory, cross-chat awareness, backups, or exports;
- provider-specific tokenizer bundles;
- a new performance dashboard or persisted private trace payloads;
- percentage performance claims without live before-and-after measurements.

