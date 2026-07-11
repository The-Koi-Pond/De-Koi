# Resource Efficiency Design

## Goal

Reduce De-Koi's idle CPU, peak RAM, storage failure risk, repeated internet transfer, and startup payload without changing user data formats or removing supported behavior.

## Scope reconciliation

The original audit included unconditional autonomous-chat polling and Raspberry Pi local-model pressure. Those are already addressed on `main` by merged PRs #970 and #815, so this change verifies rather than duplicates them.

The remaining scope is:

1. Paginate and virtualize global-gallery metadata.
2. Load authenticated remote thumbnails on demand and bound object-URL retention.
3. Bound Rust JSON collection and projection caches and avoid unnecessary whole-collection clones.
4. Make local-model downloads disk-aware and resumable.
5. Enforce startup-route and stylesheet bundle budgets.

## Considered approaches

### A. Incremental bounded contracts (selected)

Keep current storage and runtime boundaries, add narrow pagination/cache/download contracts, and validate each path independently. This minimizes migration risk and works for both embedded Tauri and the hostable runtime.

### B. Move all gallery and high-volume storage to SQLite immediately

This would provide the strongest query model but combines schema migration, import/export compatibility, asset delivery, and UI work into one high-risk release. It is intentionally deferred.

### C. Frontend-only limits

Limiting rendered rows and clearing browser caches would be cheaper, but the backend would still scan or clone unbounded collections and remote clients could still over-fetch. This does not satisfy the resource objective.

## Architecture

Gallery UI remains owned by `src/features/catalog/gallery`. It requests paged metadata through `src/shared/api/storage-api.ts`; embedded and remote calls continue through the existing explicit storage dispatch. Card media uses managed thumbnail URLs. Full-resolution authenticated blobs are created only for lightbox/export use and live in a bounded cache that revokes evicted object URLs.

Rust storage remains owned by `src-tauri/crates/storage`. Cache policy is internal to that capability and does not change JSON import/export shapes. Cache entries track approximate retained bytes and recency; collection and projection caches evict least-recently-used clean entries at configured caps. Dirty write-back entries are never evicted before flush.

Local-model download behavior remains in `src-tauri/crates/sidecar`. A deterministic `.part` file and small JSON metadata record the source URL and validator. Before transfer, De-Koi checks destination free space using the response size when known. It resumes only when the server confirms the requested byte range and validator; otherwise it safely restarts. Completed artifacts retain existing atomic replacement behavior.

Bundle enforcement stays in repository tooling. Budgets distinguish boot/startup JS, lazy route JS, total JS, and CSS, using gzip sizes from a production build.

## Resource budgets

- Authenticated managed-asset blob cache: at most 64 entries and 128 MiB, evicting LRU entries until both constraints hold.
- Global gallery page size: 48 records; no request may exceed 100.
- Storage clean-cache budget: 64 MiB total, 16 MiB per collection, and 32 projection shapes. Oversized collections stream/query without entering the clean whole-collection cache.
- Downloads require expected remaining bytes plus 512 MiB headroom when content length is known.
- Startup JS gzip budget: 700 KiB; CSS gzip budget: 120 KiB. Existing lazy-route and total budgets remain separate and may only be raised with measured evidence in the same PR.

## Error and compatibility behavior

- Pagination uses stable `createdAt`/`id` ordering so inserts do not duplicate existing pages.
- Thumbnail failures affect only their card and may fall back to the original URL only for local unauthenticated assets.
- Cache eviction never changes returned storage data and never evicts dirty rows.
- A resume response that is not valid partial content discards the incompatible partial before writing.
- Insufficient disk space fails before writing transfer bytes and reports required and available space without exposing private paths.
- Existing complete downloads and JSON profile import/export remain compatible.

## Verification

- Frontend tests prove pagination keys, page flattening, bounded blob eviction/revocation, and virtualized rendering.
- Rust storage tests prove byte/entry eviction, dirty-entry preservation, oversized-cache bypass, and unchanged query results.
- Rust sidecar tests prove resume, restart-on-invalid-range, disk-headroom rejection, cancellation, and final replacement.
- Production build plus size tooling proves route-specific gzip budgets.
- Shipping gates: focused tests, `pnpm typecheck`, `pnpm build`, `pnpm check:architecture`, Rust workspace check/tests, `pnpm check`, Bunny, and CI.

## Out of scope

- Replacing all JSON collections with SQLite.
- Provider-token or prompt-size optimization.
- Changing model defaults or deleting user models automatically.
- Claiming percentage CPU/RAM improvements without OS-level before/after profiling.
