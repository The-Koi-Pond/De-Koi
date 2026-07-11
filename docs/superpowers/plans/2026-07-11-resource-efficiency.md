# Resource Efficiency Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bound De-Koi's gallery, storage-cache, download, and startup resource costs while preserving embedded/remote behavior and user data compatibility.

**Architecture:** Add narrow resource policies at the existing owners: gallery UI and shared managed-asset adapter, Rust storage capability, Rust sidecar capability, and build tooling. Do not introduce frontend-only persistence indexes or bypass the explicit shared API and HTTP dispatch pipeline.

**Tech Stack:** React 19, TanStack Query/Virtual, TypeScript, Vitest, Tauri 2, Rust, Tokio, Reqwest, Vite, size-limit.

## Global Constraints

- Global gallery pages contain 48 records and reject limits above 100.
- Authenticated blob URLs are bounded to 64 entries and 128 MiB and are revoked on eviction.
- Clean Rust storage caches are bounded to 64 MiB total, 16 MiB per collection, and 32 projection shapes; dirty rows are never evicted before flush.
- Downloads require remaining transfer bytes plus 512 MiB free-space headroom when response length is known.
- Startup JavaScript and stylesheet gzip budgets are 700 KiB and 120 KiB respectively.
- JSON import/export formats and embedded/remote runtime parity remain unchanged.

---

### Task 1: Bound authenticated managed-asset blobs

**Files:**
- Modify: `src/shared/api/remote-managed-assets.ts`
- Test: `src/shared/api/managed-assets.spec.ts`

**Interfaces:**
- Produces: internal cache entries with `byteSize` and `lastAccess`; existing `remoteManagedAssetResolvableUrl` signature remains unchanged.

- [ ] Write failing tests that resolve more than 64 authenticated assets, assert oldest URLs are revoked, and prove invalidation still revokes retained URLs.
- [ ] Run `pnpm vitest run src/shared/api/managed-assets.spec.ts` and confirm failures are caused by missing capacity eviction.
- [ ] Read `Content-Length` when valid, fall back to `Blob.size`, update recency on cache hits, and evict LRU entries until both entry and byte constraints hold.
- [ ] Rerun the focused test and confirm all assertions pass without warnings.
- [ ] Commit only the adapter and its test.

### Task 2: Paginate and virtualize the global gallery

**Files:**
- Modify: `src/features/catalog/gallery/hooks/use-global-gallery.ts`
- Modify: `src/features/catalog/gallery/components/GlobalGalleryPanel.tsx`
- Modify as required: `src/shared/api/storage-api.ts`, `src-tauri/src/commands/storage/commands/entities.rs`
- Test: `src/features/catalog/gallery/hooks/use-global-gallery.spec.tsx`
- Test: `src/features/catalog/gallery/components/GlobalGalleryPanel.spec.tsx`

**Interfaces:**
- Produces: `useGlobalGalleryImages()` backed by an infinite query with 48-row pages and stable cursor ordering; panel consumes flattened rows.
- Consumes: existing storage list ordering/limit options; add a cursor option only if current offset/cursor support cannot provide stable pages.

- [ ] Write a failing hook test proving the first request is limited to 48 and the next page starts after the prior stable cursor.
- [ ] Write a failing component test proving a large result does not mount every image card.
- [ ] Run both focused tests and confirm the expected pagination/DOM-count failures.
- [ ] Implement the smallest stable paged query contract through the shared API and Rust dispatch only if needed.
- [ ] Integrate TanStack Virtual with an accessible non-virtual fallback in test/no-layout environments.
- [ ] Use managed thumbnail resolvers for cards and resolve originals only for lightbox/export.
- [ ] Run focused frontend and Rust dispatch tests; confirm pagination order, no duplicates, and bounded mounted cards.
- [ ] Run `pnpm check:architecture` and commit the slice.

### Task 3: Bound Rust storage caches

**Files:**
- Modify: `src-tauri/crates/storage/src/cache.rs`
- Modify: `src-tauri/crates/storage/src/lib.rs`
- Test: colocated Rust tests in those modules or the existing storage test module.

**Interfaces:**
- Produces: internal cache admission/eviction helpers; public `FileStorage` methods remain source-compatible.

- [ ] Write failing tests for oversized clean-collection bypass, total-budget LRU eviction, projection-shape cap, and dirty-entry preservation.
- [ ] Run `cargo test --manifest-path src-tauri/Cargo.toml -p marinara-storage cache_budget -- --nocapture` and confirm policy tests fail.
- [ ] Add approximate serialized-byte accounting and monotonic access ticks inside `StorageCache`.
- [ ] Admit only clean collections at or below 16 MiB, evict clean LRU entries to 64 MiB, cap projections at 32, and exclude dirty collections from eviction.
- [ ] Replace whole cached-row clones with shared/targeted access only where public ownership permits; do not change durable write semantics.
- [ ] Run all `marinara-storage` tests and focused benchmarks; commit the slice.

### Task 4: Add safe resumable sidecar downloads

**Files:**
- Modify: `src-tauri/crates/sidecar/Cargo.toml`
- Modify: `src-tauri/crates/sidecar/src/lib.rs` or split a focused `download.rs` module if the owner grows broader.
- Test: colocated sidecar download tests.

**Interfaces:**
- Produces: deterministic partial path and metadata, disk-headroom validator, and resume-aware request builder; existing public download commands remain unchanged.

- [ ] Write failing HTTP harness tests for valid range resume, ignored range restart, mismatched validator restart, cancellation retention, and insufficient-space rejection.
- [ ] Run focused `marinara-sidecar` download tests and confirm each missing behavior fails for the intended reason.
- [ ] Introduce a disk-free-space dependency with narrowly scoped features or use a platform API already present in the workspace.
- [ ] Persist non-secret URL/validator metadata atomically, request `Range`/`If-Range`, append only after a valid 206 response, and restart safely otherwise.
- [ ] Require remaining bytes plus 512 MiB headroom before writing when size is known; preserve partials for resumable failures and explicit cancellation.
- [ ] Validate final size, atomically replace destination, and delete metadata only after success.
- [ ] Run all `marinara-sidecar` tests and `cargo check --manifest-path src-tauri/Cargo.toml --workspace`; commit the slice.

### Task 5: Enforce route-specific bundle budgets

**Files:**
- Modify: `package.json`
- Modify or create: `scripts/check-bundle-budgets.mjs`
- Test: `scripts/check-bundle-budgets.test.mjs` or existing script-test convention.
- Modify: CI workflow invoking performance size checks if the script is not already covered.

**Interfaces:**
- Produces: deterministic command `pnpm perf:size` that builds and checks boot/startup, lazy-route, total JS, and CSS gzip budgets.

- [ ] Write failing script tests using synthetic manifest/assets over and under each budget.
- [ ] Run the script test and confirm missing classifier/budget failures.
- [ ] Parse Vite manifest entry relationships rather than filename substrings, gzip assets, and emit actual versus allowed bytes.
- [ ] Wire the checker into `perf:size` after the production build and retain a separate total lazy-route guard.
- [ ] Run script tests, `pnpm build`, and `pnpm perf:size`; adjust code splitting rather than raising approved budgets.
- [ ] Commit the tooling slice.

### Task 6: Integrated verification and shipping

**Files:**
- Modify only evidence/docs required by repository checks.

- [ ] Run all focused frontend and Rust suites from Tasks 1–5.
- [ ] Run `pnpm typecheck`, `pnpm build`, `pnpm check:architecture`, and `cargo check --manifest-path src-tauri/Cargo.toml --workspace`.
- [ ] Run `pnpm check` and the Rust workspace tests with sufficient timeout; distinguish any unchanged baseline failure with before/after proof.
- [ ] Inspect `git diff --check`, branch commits, changed-file scope, remote, and PR boundary.
- [ ] Run Bunny and resolve every blocking finding.
- [ ] Push only to `origin`, open a draft PR to `main`, wait for required CI, rerun Bunny after PR-affecting pushes, mark ready, and merge only with clean required gates.
