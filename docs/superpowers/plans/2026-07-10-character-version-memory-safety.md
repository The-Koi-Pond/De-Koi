# Character Version Memory Safety Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve all character-version history while externalizing inline images with bounded memory, preventing recurrence at every write boundary, and containing future server regressions on 4 GiB Pi hosts.

**Architecture:** Add a generic record-at-a-time JSON-array transformer to the Rust storage crate, then use it from a focused character-version media migration owned by the storage command layer. Normalize character-version media before imports, snapshots, restores, and direct storage writes; keep TypeScript and HTTP contracts unchanged. Apply a server-only Docker memory ceiling after the migration-capable image is deployed.

**Tech Stack:** Rust, serde/serde_json streaming visitors, SHA-256 content fingerprints, De-Koi `FileStorage`, managed media helpers, Docker Compose, Cargo tests, architecture checks.

## Global Constraints

- Preserve every valid historical version; do not prune history automatically.
- Migration peak memory must be bounded by one record, one decoded image, and bounded I/O buffers.
- Never trust imported file paths or log character content, image bytes, secrets, or chat transcripts.
- Keep product behavior in Rust storage/import owners; do not change React, TypeScript engine, shared API, or HTTP command contracts without new evidence.
- Keep the original Pi collection as a rollback backup until Celia explicitly approves cleanup.
- The Pi limit is `2g` memory and `2304m` memory-plus-swap, applied only after the migration-capable image is deployed.
- Preserve unrelated dirty-worktree changes and execute from an isolated worktree based on `origin/main`.

## File Map

- Create `src-tauri/crates/storage/src/streaming.rs`: record-at-a-time top-level JSON-array transformation and validation helpers.
- Modify `src-tauri/crates/storage/src/lib.rs`: expose a write-gated `transform_collection_streaming` method and invalidate affected caches after atomic installation.
- Create `src-tauri/src/commands/storage/character_version_media.rs`: canonical inline-avatar detection, content-addressed managed asset persistence, field normalization, and safe failed-attempt retention.
- Modify `src-tauri/src/commands/storage.rs`: register the focused character-version media module.
- Modify `src-tauri/src/commands/storage/startup_migrations.rs`: run the streaming character-version migration and focused migration tests.
- Modify `src-tauri/src/state.rs`: add the new independent migration marker and invoke it after existing media migrations.
- Modify `src-tauri/src/commands/storage/characters.rs`: normalize snapshots and restores through the shared owner.
- Modify `src-tauri/src/commands/storage/imports/marinara.rs`: normalize Marinara character/version payloads before storage.
- Modify `src-tauri/src/commands/storage/profile/legacy.rs`: normalize legacy profile character-version rows before installation.
- Modify `src-tauri/src/commands/storage/commands/entities.rs`: reject direct inline-media writes to `character-versions` at the focused command contract.
- Modify `docker-compose.pi.yml`: add server-only memory and memory-plus-swap limits.
- Add the approved design and this implementation plan under `docs/superpowers/` to the PR.

---

### Task 1: Bounded Streaming Collection Transformation

**Files:**
- Create: `src-tauri/crates/storage/src/streaming.rs`
- Modify: `src-tauri/crates/storage/src/lib.rs`
- Test: `src-tauri/crates/storage/src/streaming.rs`

**Interfaces:**
- Produces: `StreamingTransformReport { input_records: usize, output_records: usize, changed_records: usize }`
- Produces: `FileStorage::transform_collection_streaming<F>(&self, collection: &str, migration_suffix: &str, transform: F) -> AppResult<StreamingTransformReport>` where `F: FnMut(usize, Value) -> AppResult<Value>`.
- Guarantees: write-gate serialization, input fingerprint recheck, atomic install, backup refresh, and cache invalidation.

- [ ] **Step 1: Write failing streaming and interruption tests**

Add tests that create a pretty JSON array with multiple large synthetic records, invoke the proposed API, and assert record order/count preservation. Use a transform closure that records the current index and fails on record 2; assert the original file is byte-identical, no migration temporary remains, and retry succeeds.

```rust
#[test]
fn streaming_transform_preserves_original_on_mid_record_failure() {
    let root = temp_storage_root("stream-transform-failure");
    let storage = FileStorage::new(&root).unwrap();
    storage.replace_all("character-versions", vec![
        json!({"id":"v1","payload":"a".repeat(4096)}),
        json!({"id":"v2","payload":"b".repeat(4096)}),
        json!({"id":"v3","payload":"c".repeat(4096)}),
    ]).unwrap();
    let before = fs::read(root.join("collections/character-versions.json")).unwrap();

    let error = storage.transform_collection_streaming(
        "character-versions",
        "inline-media-v2",
        |index, row| {
            if index == 1 { return Err(AppError::new("forced_failure", "stop")); }
            Ok(!row.is_null())
        },
        |_index, _row| Ok(()),
    ).expect_err("transform should fail");

    assert_eq!(error.code, "forced_failure");
    assert_eq!(fs::read(root.join("collections/character-versions.json")).unwrap(), before);
    assert!(!root.join("collections/character-versions.json.inline-media-v2.tmp").exists());
}
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `cargo test --manifest-path src-tauri/crates/storage/Cargo.toml streaming_transform -- --nocapture`

Expected: compilation fails because `transform_collection_streaming` and `StreamingTransformReport` do not exist.

- [ ] **Step 3: Implement the streaming transformer**

Implement a serde `Visitor`/`SeqAccess` loop that reads one `Value`, calls the transform, writes one output record, and drops both before reading the next. Write `[`/`,`/`]` directly through `BufWriter`; do not call `serde_json::to_vec_pretty` on the collection. Validate the completed output with the same record-at-a-time parser, compare the input fast/content stamp immediately before install, refresh the backup, atomically replace the collection, and invalidate full-row, ID-index, and projection caches for that collection.

The public method acquires `write_gate.begin_write()` and the storage write lock before resolving the collection path. Return `storage_source_changed` if the fingerprint changes during transformation.

- [ ] **Step 4: Run focused storage tests and verify GREEN**

Run: `cargo test --manifest-path src-tauri/crates/storage/Cargo.toml streaming_transform -- --nocapture`

Expected: all streaming transformation, retry, source-change, and cache-invalidation tests pass.

- [ ] **Step 5: Commit the storage primitive**

```bash
git add src-tauri/crates/storage/src/streaming.rs src-tauri/crates/storage/src/lib.rs
git commit -m "storage: add bounded collection transformation"
```

### Task 2: Canonical Character-Version Media Normalizer

**Files:**
- Create: `src-tauri/src/commands/storage/character_version_media.rs`
- Modify: `src-tauri/src/commands/storage.rs`
- Test: `src-tauri/src/commands/storage/character_version_media.rs`

**Interfaces:**
- Consumes: existing `decode_image_payload`, `optimize_avatar_image_bytes`, `stored_managed_image`, and managed-path helpers.
- Produces: `normalize_character_version_media(data_dir: &Path, record: &mut Map<String, Value>, created_files: &mut Vec<PathBuf>) -> AppResult<bool>`.
- Produces: `reject_inline_character_version_media(record: &Value) -> AppResult<()>`.
- Produces: deterministic SHA-256 managed filenames under `avatars/characters/versions`.

- [ ] **Step 1: Write failing normalization tests**

Cover case-insensitive data URLs, all trusted avatar mirrors, duplicate image reuse, malformed payload rejection, oversized payload rejection, and non-avatar strings left untouched. Assert returned records contain managed URLs/file metadata and no trusted field starts with `data:image`.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `cargo test --manifest-path src-tauri/Cargo.toml character_version_media -- --nocapture`

Expected: compilation fails because the new module and functions do not exist.

- [ ] **Step 3: Implement normalization and failed-attempt accounting**

Decode only `avatarPath`, `avatar`, and `avatarUrl`. Optimize through the existing avatar path, hash the final bytes using `sha2::{Digest, Sha256}`, and write `version-<sha256>.<ext>` atomically inside `avatars/characters/versions`. Reuse an existing file only after its bytes match. Set `avatarPath`, present mirror fields, `avatarFilePath`, and `avatarFilename` coherently. Push only newly created paths into `created_files`.

`reject_inline_character_version_media` returns `inline_character_version_media` with the field name and no payload content.

- [ ] **Step 4: Run focused media tests and verify GREEN**

Run: `cargo test --manifest-path src-tauri/Cargo.toml character_version_media -- --nocapture`

Expected: all normalizer, deduplication, validation, and failed-attempt accounting tests pass.

- [ ] **Step 5: Commit the media owner**

```bash
git add src-tauri/src/commands/storage.rs src-tauri/src/commands/storage/character_version_media.rs
git commit -m "storage: canonicalize character version media"
```

### Task 3: Resumable Character-Version Migration

**Files:**
- Modify: `src-tauri/src/commands/storage/startup_migrations.rs`
- Modify: `src-tauri/src/state.rs`
- Test: `src-tauri/src/commands/storage/startup_migrations.rs`
- Test: `src-tauri/src/state.rs`

**Interfaces:**
- Consumes: `FileStorage::transform_collection_streaming` and `normalize_character_version_media`.
- Produces: migration marker `characterVersionInlineMediaV2` in the existing `startup-migrations` settings row.
- Produces: `migrate_character_version_inline_media(storage: &FileStorage, data_dir: &Path) -> AppResult<StreamingTransformReport>`.

- [ ] **Step 1: Write failing migration lifecycle tests**

Create synthetic version rows with repeated inline images and stable IDs. Assert record count/data preservation, zero trusted inline fields, one deduplicated asset, marker-after-success behavior, no marker after forced transform/install failure, cleanup of attempt-owned assets, and completed-run no-op behavior.

- [ ] **Step 2: Run focused migration tests and verify RED**

Run: `cargo test --manifest-path src-tauri/Cargo.toml character_version_inline_media -- --nocapture`

Expected: tests fail because the V2 migration and marker are absent.

- [ ] **Step 3: Implement migration orchestration**

Call the streaming transform with suffix `character-version-inline-media-v2`. Normalize each record through the focused media owner. On error, remove only content-addressed files that a record-at-a-time reference scan proves are unreferenced; after a successful bounded migration, also remove unreferenced files matching the version-content-address naming contract. Allow valid records without inline media to pass byte-semantically unchanged. Register the migration independently immediately after seeding, before any older full-collection migration can load `character-versions`, so a previously set V1 marker cannot suppress it or an unmarked legacy pass reproduce the OOM.

Do not automatically delete `character-versions.json.tmp-*` or the pre-migration backup.

- [ ] **Step 4: Run migration and startup tests and verify GREEN**

Run: `cargo test --manifest-path src-tauri/Cargo.toml character_version_inline_media -- --nocapture`

Expected: migration, interruption, retry, marker, and no-op tests pass.

- [ ] **Step 5: Commit the migration**

```bash
git add src-tauri/src/commands/storage/startup_migrations.rs src-tauri/src/state.rs
git commit -m "storage: migrate inline version images safely"
```

### Task 4: Close Every Recurrence Boundary

**Files:**
- Modify: `src-tauri/src/commands/storage/characters.rs`
- Modify: `src-tauri/src/commands/storage/imports/marinara.rs`
- Modify: `src-tauri/src/commands/storage/profile/legacy.rs`
- Modify: `src-tauri/src/commands/storage/commands/entities.rs`
- Test: existing colocated Rust test modules in those files.

**Interfaces:**
- Consumes: `normalize_character_version_media` for trusted owner paths.
- Consumes: `reject_inline_character_version_media` for direct generic entity creates/updates.
- Preserves: existing Tauri and hostable HTTP command names, arguments, and responses.

- [ ] **Step 1: Write failing entrypoint tests**

Add one focused test per boundary: snapshot creation externalizes an inline avatar; restore persists managed references; Marinara import externalizes version media; legacy profile import externalizes version media; direct `storage_create("character-versions", ...)` rejects inline avatar data.

- [ ] **Step 2: Run boundary tests and verify RED**

Run: `cargo test --manifest-path src-tauri/Cargo.toml character_version -- --nocapture`

Expected: at least the import/direct-write tests fail because current paths accept inline media.

- [ ] **Step 3: Route owner paths through the normalizer**

Normalize before creating snapshots or installing imported version rows. When a following mutation fails, remove only content-addressed assets proven unreferenced by a bounded scan. On restore, normalize the version row before constructing the live-character patch. Add the direct-write rejection immediately after entity contract validation and before any mutation.

- [ ] **Step 4: Run boundary tests and verify GREEN**

Run: `cargo test --manifest-path src-tauri/Cargo.toml character_version -- --nocapture`

Expected: snapshot, restore, Marinara import, legacy import, rollback, and direct-write tests pass.

- [ ] **Step 5: Commit recurrence prevention**

```bash
git add src-tauri/src/commands/storage/characters.rs src-tauri/src/commands/storage/imports/marinara.rs src-tauri/src/commands/storage/profile/legacy.rs src-tauri/src/commands/storage/commands/entities.rs
git commit -m "characters: prevent inline version media"
```

### Task 5: Pi Host Containment And Documentation

**Files:**
- Modify: `docker-compose.pi.yml`
- Add: `docs/superpowers/specs/2026-07-10-character-version-memory-safety-design.md`
- Add: `docs/superpowers/plans/2026-07-10-character-version-memory-safety.md`

**Interfaces:**
- Produces: Compose `mem_limit: 2g` and `memswap_limit: 2304m` for `de-koi-server` only.

- [ ] **Step 1: Add a failing Compose assertion**

Run before editing:

```powershell
$config = docker compose -f docker-compose.pi.yml config | Out-String
if ($config -notmatch 'memory: 2147483648') { throw 'server memory limit missing' }
```

Expected: command throws `server memory limit missing`.

- [ ] **Step 2: Add the Pi-only resource limits**

Under `de-koi-server`, add:

```yaml
    mem_limit: 2g
    memswap_limit: 2304m
```

Do not limit `de-koi-web` and do not change restart behavior.

- [ ] **Step 3: Validate Compose and docs**

Run: `docker compose -f docker-compose.pi.yml config`

Expected: exit 0; server memory resolves to 2147483648 bytes and memory-plus-swap to 2415919104 bytes.

Run: `pnpm check:docs`

Expected: exit 0.

- [ ] **Step 4: Commit containment and design artifacts**

```bash
git add docker-compose.pi.yml docs/superpowers/specs/2026-07-10-character-version-memory-safety-design.md docs/superpowers/plans/2026-07-10-character-version-memory-safety.md
git commit -m "pi: contain hostable server memory"
```

### Task 6: Full Verification, Pi Migration, And Shipping

**Files:**
- No new production files expected.
- Temporary local/Pi proof artifacts must remain uncommitted and be removed after evidence capture.

**Interfaces:**
- Consumes: completed implementation and migration-capable server image.
- Produces: review packet with local checks, Pi before/after evidence, Bunny result, CI state, and merge readiness.

- [ ] **Step 1: Run focused and lane verification**

Run:

```bash
cargo test --manifest-path src-tauri/crates/storage/Cargo.toml streaming_transform -- --nocapture
cargo test --manifest-path src-tauri/Cargo.toml character_version -- --nocapture
cargo check --manifest-path src-tauri/Cargo.toml
pnpm check:architecture
pnpm check:docs
pnpm check
```

Expected: all commands exit 0 with no new warnings attributable to this branch.

- [ ] **Step 2: Review scope and create the draft PR**

Confirm the isolated worktree is clean, the branch is based on current `origin/main`, only intended files changed, and all commits avoid AI/tool authorship language. Push only to `origin`; open a draft PR with the approved design, root-cause evidence, verification, rollback plan, and unchecked human-validation boxes.

- [ ] **Step 3: Run Bunny and CI**

Run the repository Bunny review workflow, address every actionable finding test-first, rerun affected checks, and wait for required GitHub Actions checks. Keep the PR draft until Bunny and CI are clean.

- [ ] **Step 4: Deploy the migration-capable build to the Pi**

Before deployment, capture SHA-256, byte size, record count, inline-image count, server RSS, and free memory. Copy `character-versions.json` to a timestamped rollback file outside the active collection path. Deploy the branch build, allow the V2 migration to complete, then confirm 727 records remain, trusted inline-image count is zero, historical avatars resolve, the active file shrinks materially, and no kernel OOM occurs.

- [ ] **Step 5: Exercise stability and rollback controls**

Save and restore representative characters repeatedly while sampling RSS and request latency. Restart the stack and confirm the migration marker makes the second startup a no-op. Verify HTTP 200 at `http://pi:7860`, SSH, Tailscale, Docker health, and `journalctl` OOM output. Keep the rollback file and failed-write temporaries until Celia separately approves deletion.

- [ ] **Step 6: Mark ready and merge**

After local checks, Bunny, CI, and Pi proof are all clean, mark the PR ready, merge it into `main` using the repository's allowed merge strategy, then verify `origin/main` contains the merge and the Pi is running the merged image. Report the PR URL, merged state, checks, Bunny, health gate, remaining rollback file, and vault classification.
