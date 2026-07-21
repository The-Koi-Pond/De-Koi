# Performance Critical Paths Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement issues #1135 through #1145 as independently verified performance slices delivered in one PR.

**Architecture:** Keep product orchestration in the TypeScript engine, runtime adapters in `src/shared/api`, and privileged work in Rust. Reuse the existing performance diagnostics, provider embedding helper, explicit remote dispatch, and collection journal rather than introducing parallel mechanisms.

**Tech Stack:** TypeScript, React-free engine ports, Vitest, Rust, Tokio, Tauri 2, pnpm, Cargo.

## Global Constraints

- Preserve embedded and hostable runtime parity.
- Preserve prompt text, attribution, memory ranking, Deki durable formats, backup/export results, and JSON compatibility.
- Do not import React or concrete shared APIs into `src/engine`.
- Keep diagnostics opt-in and free of content, IDs, request bodies, secrets, and full paths.
- Follow red-green-refactor for each behavior and run `pnpm check:architecture` after boundary changes.
- One integration PR closes #1135 through #1145.

---

### Task 1: Stage diagnostics (#1145)

**Files:**
- Modify: `src/shared/lib/performance-diagnostics.ts`
- Modify: `src/shared/lib/performance-diagnostics.spec.ts`
- Modify: `src/engine/generation/start-generation.ts`
- Modify: `src/shared/api/deki-api.ts`
- Modify: `docs/performance-diagnostics.md`

**Interfaces:**
- Produces stable span names `generation.prompt_assembly`, `generation.first_token`, `generation.post_save`, `deki.session_summaries`, `deki.active_history`, and `generation.background_maintenance` through the existing `measurePerformanceAsync` or a synchronous start/finish helper.

- [ ] Add failing diagnostics tests proving disabled-mode silence and detail redaction for the new stages.
- [ ] Run `pnpm vitest run src/shared/lib/performance-diagnostics.spec.ts` and confirm the new assertions fail for missing stage support.
- [ ] Add the smallest timing API needed by async and streaming owners; keep detail filtering centralized.
- [ ] Instrument prompt assembly, first stream token, post-save tail work, Deki summary/history loads, and background maintenance without logging private payloads.
- [ ] Update the diagnostics documentation and run the focused diagnostics, generation, and Deki suites.

### Task 2: Low-risk Rust runtime wins (#1135, #1141, #1144)

**Files:**
- Modify: `src-tauri/src/commands/storage/llm.rs`
- Modify: `src-tauri/src/http_server.rs`
- Modify: `src-tauri/src/commands/storage/prompts.rs` only if the existing helper needs visibility changes
- Modify: `src-tauri/src/commands/storage/character_version_media.rs`
- Modify: `src-tauri/src/http_dispatch.rs`

**Interfaces:**
- Consumes the existing provider-aware `embed_texts` helper.
- Produces an owned blocking-dispatch adapter and a pure referenced-media set reducer.

- [ ] Add a failing embedding test proving multiple compatible inputs produce one bounded provider batch and preserve output order.
- [ ] Add a failing media-cleanup test with many referenced rows proving each candidate is classified once and negative controls are retained.
- [ ] Add a failing dispatch ownership test or compile-time seam proving the full argument map is moved rather than cloned.
- [ ] Implement batching with sequential provider fallback, linear media cleanup, and owned request transfer.
- [ ] Run the focused Rust tests and `cargo check --manifest-path src-tauri/Cargo.toml --workspace`.

### Task 3: Bounded blocking backup and export work (#1142)

**Files:**
- Modify: `src-tauri/src/commands/storage/commands/backup.rs`
- Modify: `src-tauri/src/http_dispatch.rs`
- Modify: focused backup/export tests in their existing Rust owners

**Interfaces:**
- Produces async command facades whose synchronous capability bodies run in `spawn_blocking` and return the existing JSON/AppResult contract.

- [ ] Add failing tests using a blocking probe that prove unrelated Tokio work can progress during backup/export execution.
- [ ] Convert Tauri and hostable facades to bounded blocking tasks while keeping filesystem logic synchronous and focused.
- [ ] Preserve error details, snapshot atomicity, cancellation boundaries, and shutdown behavior.
- [ ] Run backup, export, HTTP dispatch, and Rust workspace tests.

### Task 4: Generation critical path (#1136, #1137)

**Files:**
- Modify: `src/engine/generation/prompt-assembly.ts`
- Modify: `src/engine/generation/start-generation.ts`
- Create or modify: `src/engine/generation/lorebook-keeper-background.ts`
- Add focused specs beside the existing prompt-assembly and start-generation suites

**Interfaces:**
- Produces `scheduleLorebookKeeperBackfill(...)` with per-chat single-flight semantics.
- Keeps `assembleGenerationPrompt(...)` return type and deterministic output unchanged.

- [ ] Add a failing prompt test with deferred storage promises proving character/persona/preset requests start before any resolves.
- [ ] Add a failing generation test proving `done` is emitted before a deferred Lorebook Keeper backfill completes.
- [ ] Parallelize immutable prerequisites, then overlap pure lore/memory retrieval only where macro inputs are fixed.
- [ ] Implement the background queue with deduplication, per-chat serialization, and explicit completion/failure diagnostics.
- [ ] Run prompt snapshots, attribution, generation, Lorebook Keeper, typecheck, and architecture tests.

### Task 5: Bounded Deki and context reads (#1138, #1139, #1140)

**Files:**
- Modify: `src/shared/api/deki-api.ts` and `src/shared/api/deki-api.spec.ts`
- Modify: `src/engine/capabilities/storage.ts`
- Modify: `src/engine/generation/canonical-memory-context.ts`
- Modify: `src/engine/generation/prompt-assembly.ts`
- Modify: focused shared API, remote-runtime, HTTP dispatch, and Rust storage owners required by the new batch contracts

**Interfaces:**
- Produces target-only Deki history hydration.
- Produces batched canonical-memory scope queries and bounded sibling-conversation context queries through the storage capability port.

- [ ] Add a failing Deki test proving appending to one session does not list messages for unrelated sessions.
- [ ] Add a failing canonical-memory test proving mixed scopes invoke one batch capability and preserve ranking.
- [ ] Add a failing cross-chat test proving no unbounded chat list or serial per-chat message loop occurs.
- [ ] Implement focused batch DTOs through shared API, remote allowlist, HTTP dispatch, and Rust owner modules.
- [ ] Preserve legacy migration, visibility, mode, recency, dedupe, and section limits.
- [ ] Run focused TypeScript/Rust suites, typecheck, and architecture checks.

### Task 6: Bound journal compaction (#1143)

**Files:**
- Modify: `src-tauri/crates/storage/src/journal.rs`
- Modify: `src-tauri/crates/storage/src/lib.rs`
- Add or modify: storage benchmarks and focused recovery/flush tests

**Interfaces:**
- Extends the existing collection journal with explicit age, entry-count, and byte-size compaction decisions.
- Keeps `FileStorage` public CRUD signatures unchanged.

- [ ] Add failing tests proving a short generic mutation burst remains journal-backed without immediate full serialization, thresholds force compaction, shutdown flushes, and startup replays an un-compacted journal.
- [ ] Implement a single compaction policy owner; do not create another journal format.
- [ ] Preserve checkpoint-tracked collection recovery, atomic updates, imports, and fail-closed corruption handling.
- [ ] Add a representative large-collection benchmark comparing repeated patch cost before and after the policy.
- [ ] Run `cargo test --manifest-path src-tauri/Cargo.toml -p marinara-storage` and the benchmark smoke path.

### Task 7: Integration, review, and shipping

**Files:**
- Modify only documentation, discovery metadata, or proof files required by repository gates.

- [ ] Run all focused suites from Tasks 1-6.
- [ ] Run `pnpm check:architecture`, `pnpm typecheck`, `pnpm test`, `cargo test --manifest-path src-tauri/Cargo.toml --workspace`, `pnpm build`, `pnpm perf:size`, and `pnpm check`.
- [ ] Run whole-branch code review and resolve every Critical or Important finding.
- [ ] Run Bunny, fix every blocking finding, and rerun affected proof.
- [ ] Inspect branch, remote, commits, `git diff --check`, and the complete diff against `origin/main`.
- [ ] Push only to `origin`, open one PR closing #1135 through #1145, wait for required CI, rerun Bunny after every PR-affecting push, mark ready, and merge to `main` only when clean.

## Self-Review

- The plan covers every issue #1135-#1145 exactly once.
- Remote-capable changes include the explicit HTTP pipeline.
- Risky storage, backup, prompt, provider, and Deki paths have positive and negative proof requirements.
- No placeholder or broad migration task remains.

