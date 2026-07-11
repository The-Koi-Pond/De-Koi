# Character History Pruning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep the newest 50 unpinned character versions per character plus every pinned version, prune existing histories with bounded memory, and protect all retained media references.

**Architecture:** Rust storage owns retention selection and deletion. A generic storage-crate streaming filter provides recoverable row removal without loading payloads; a focused `character_version_retention` module gathers compact ordering metadata, computes survivor IDs, filters rows atomically, and performs reference-safe media cleanup. React only exposes pin/unpin controls through the existing generic storage API.

**Tech Stack:** Rust, serde/serde_json, FileStorage transaction protocol, Tauri/hostable storage commands, React 19, TanStack Query, Vitest, pnpm.

## Global Constraints

- Retain the newest 50 unpinned versions per non-empty `characterId` plus every row with `pinned: true`.
- Preserve malformed rows without a valid `characterId`; never guess ownership.
- Run the one-time existing-history migration after `characterVersionInlineMediaV3`.
- Startup and runtime pruning must not call `storage.list("character-versions")` for the complete collection.
- Product retention policy stays in `src-tauri`; the generic storage crate contains only reusable streaming/filter mechanics.
- Delete managed media only after exact canonical reference checks prove that no character or retained version references it.
- Logs contain counts, migration keys, and error codes only—never character content or image payloads.
- Use TDD: every production behavior starts with a focused failing test observed for the expected reason.
- Architecture proof command: `pnpm check:architecture`.

---

### Task 1: Add recoverable streaming row filtering

**Files:**
- Modify: `src-tauri/crates/storage/src/streaming.rs`
- Modify: `src-tauri/crates/storage/src/lib.rs`

**Interfaces:**
- Consumes: existing `FileStorage::transform_collection_streaming`, transaction manifests, source stamps, cache invalidation, and `visit_collection_streaming`.
- Produces:

```rust
#[derive(Debug, Eq, PartialEq)]
pub struct StreamingFilterReport {
    pub input_records: usize,
    pub output_records: usize,
    pub deleted_records: usize,
}

impl FileStorage {
    pub fn filter_collection_streaming<F>(
        &self,
        collection: &str,
        operation_suffix: &str,
        keep: F,
    ) -> AppResult<StreamingFilterReport>
    where
        F: FnMut(usize, &Value) -> AppResult<bool>;
}
```

- [ ] **Step 1: Write failing storage tests**

Add tests beside the existing streaming tests:

```rust
#[test]
fn streaming_filter_removes_selected_rows_and_reports_counts() {
    let root = temp_storage_root("stream-filter-success");
    let storage = FileStorage::new(&root).unwrap();
    storage.replace_all("character-versions", vec![
        json!({"id":"keep-1","payload":"a".repeat(4096)}),
        json!({"id":"delete-1","payload":"b".repeat(4096)}),
        json!({"id":"keep-2","payload":"c".repeat(4096)}),
    ]).unwrap();

    let report = storage.filter_collection_streaming(
        "character-versions",
        "retention-v1",
        |_index, row| Ok(row["id"] != "delete-1"),
    ).unwrap();

    assert_eq!(report, StreamingFilterReport {
        input_records: 3,
        output_records: 2,
        deleted_records: 1,
    });
    assert_eq!(storage.list("character-versions").unwrap().iter()
        .map(|row| row["id"].as_str().unwrap()).collect::<Vec<_>>(),
        vec!["keep-1", "keep-2"]);
}

#[test]
fn streaming_filter_preserves_original_on_callback_or_source_change_failure() {
    let root = temp_storage_root("stream-filter-failure");
    let storage = FileStorage::new(&root).unwrap();
    storage.replace_all("character-versions", vec![
        json!({"id":"v1"}), json!({"id":"v2"}), json!({"id":"v3"}),
    ]).unwrap();
    let collection = root.join("collections/character-versions.json");
    let before = fs::read(&collection).unwrap();
    let error = storage.filter_collection_streaming(
        "character-versions", "retention-v1", |index, _row| {
            if index == 1 { return Err(AppError::new("forced_failure", "stop")); }
            Ok(true)
        },
    ).unwrap_err();
    assert_eq!(error.code, "forced_failure");
    assert_eq!(fs::read(&collection).unwrap(), before);

    let changed_collection = collection.clone();
    let error = storage.filter_collection_streaming(
        "character-versions", "retention-v1-source-change", move |_index, row| {
            fs::write(&changed_collection, b"[{\"id\":\"external\"}]")?;
            Ok(row["id"] != "v2")
        },
    ).unwrap_err();
    assert_eq!(error.code, "storage_source_changed");
}
```

- [ ] **Step 2: Run tests and verify RED**

Run:

```powershell
cargo test --manifest-path src-tauri/crates/storage/Cargo.toml streaming_filter -- --nocapture
```

Expected: compilation fails because `StreamingFilterReport` and `filter_collection_streaming` do not exist.

- [ ] **Step 3: Implement the streaming filter**

Reuse the existing record-at-a-time visitor and transaction installation path. The filter visitor writes commas only for retained rows and calculates:

```rust
let keep_row = (self.keep)(index, &row)?;
report.input_records += 1;
if keep_row {
    write_row(self.writer, report.output_records, &row)?;
    report.output_records += 1;
} else {
    report.deleted_records += 1;
}
```

Validate `input_records == output_records + deleted_records`, reopen and count the staged array, recheck the source stamp, install through the existing collection transaction manifest, and invalidate all collection caches. If `deleted_records == 0`, delete the staged file and skip installation.

- [ ] **Step 4: Run storage tests and verify GREEN**

Run:

```powershell
cargo test --manifest-path src-tauri/crates/storage/Cargo.toml streaming_filter -- --nocapture
cargo test --manifest-path src-tauri/crates/storage/Cargo.toml
```

Expected: focused filter tests pass and the complete storage suite remains green.

- [ ] **Step 5: Commit**

```powershell
git add src-tauri/crates/storage/src/streaming.rs src-tauri/crates/storage/src/lib.rs
git commit -m "storage: add bounded collection filtering"
```

---

### Task 2: Build the deterministic retention selector

**Files:**
- Create: `src-tauri/src/commands/storage/character_version_retention.rs`
- Modify: `src-tauri/src/commands/storage.rs`

**Interfaces:**
- Consumes: `FileStorage::visit_collection_streaming`, `filter_collection_streaming`, character-version managed-media cleanup helpers.
- Produces:

```rust
pub(crate) const CHARACTER_VERSION_UNPINNED_LIMIT: usize = 50;

#[derive(Debug, Default, Eq, PartialEq)]
pub(crate) struct CharacterVersionPruneReport {
    pub affected_characters: usize,
    pub retained_unpinned: usize,
    pub retained_pinned: usize,
    pub pruned_rows: usize,
    pub cleaned_media: usize,
    pub preserved_shared_media: usize,
    pub malformed_ownerless_rows: usize,
}

pub(crate) fn prune_character_versions(
    state: &AppState,
    character_ids: Option<&HashSet<String>>,
) -> AppResult<CharacterVersionPruneReport>;
```

- [ ] **Step 1: Write selector tests before the module exists**

Create the module with only its `#[cfg(test)]` block and wished-for private selector API:

```rust
#[test]
fn selector_keeps_newest_fifty_unpinned_and_all_pinned() {
    let rows = (0..55).map(|index| version_meta(
        format!("v-{index}"),
        "char-1",
        format!("2026-01-{:02}T00:00:00Z", (index % 28) + 1),
        index == 0,
        index,
    )).collect::<Vec<_>>();

    let selection = select_pruned_ids(&rows, 50);

    assert!(!selection.contains("v-0"));
    assert_eq!(selection.len(), 4);
}

#[test]
fn selector_isolates_characters_and_preserves_ownerless_rows() {
    let rows = vec![
        version_meta("a-old", "a", "2026-01-01T00:00:00Z", false, 0),
        version_meta("b-only", "b", "2026-01-01T00:00:00Z", false, 1),
        ownerless_meta("unknown", 2),
    ];
    assert!(select_pruned_ids(&rows, 1).contains("a-old"));
    assert!(!select_pruned_ids(&rows, 1).contains("b-only"));
    assert!(!select_pruned_ids(&rows, 1).contains("unknown"));
}
```

Add separate tests for 49/50/51, all pinned, invalid dates, `updatedAt` fallback, semver-like labels, exact ties, and stable source order.

- [ ] **Step 2: Run selector tests and verify RED**

Run:

```powershell
cargo test --manifest-path src-tauri/Cargo.toml character_version_retention::tests --lib -- --nocapture
```

Expected: compilation fails because `VersionRetentionMeta` and `select_pruned_ids` are undefined.

- [ ] **Step 3: Implement compact metadata and pure selection**

Use compact metadata only:

```rust
struct VersionRetentionMeta {
    id: String,
    character_id: Option<String>,
    pinned: bool,
    created_at: Option<DateTime<Utc>>,
    updated_at: Option<DateTime<Utc>>,
    version_parts: Vec<u64>,
    source_index: usize,
}
```

Group by valid `character_id`, sort newest-first by created time, updated time, version parts, and source index, then add IDs after the first 50 unpinned rows to a `HashSet<String>`. Pinned and ownerless rows never enter the deletion set.

- [ ] **Step 4: Write the failing bounded integration test**

```rust
#[test]
fn pruning_filters_rows_without_loading_payload_collection() {
    let state = test_state("retention-bounded-filter");
    seed_versions(&state, "char-1", 55, &["version-0"]);

    let report = prune_character_versions(&state, None).unwrap();
    let retained = state.storage.list("character-versions").unwrap();

    assert_eq!(report.pruned_rows, 4);
    assert_eq!(retained.len(), 51);
    assert!(retained.iter().any(|row| row["id"] == "version-0"));
}
```

Expected RED: `prune_character_versions` is absent.

- [ ] **Step 5: Implement bounded selection, atomic filtering, and reporting**

First call `visit_collection_streaming` to collect `VersionRetentionMeta` for scoped IDs. Compute deletion IDs. Then call `filter_collection_streaming`, capturing media paths only for rows whose IDs are selected. After successful installation, call a focused batch cleanup that deduplicates paths and checks surviving versions plus live characters before removal.

Do not call `storage.list("character-versions")` anywhere in this module.

- [ ] **Step 6: Verify retention tests and architecture**

Run:

```powershell
cargo test --manifest-path src-tauri/Cargo.toml character_version_retention --lib -- --nocapture
pnpm check:architecture
```

Expected: retention tests and architecture checks pass.

- [ ] **Step 7: Commit**

```powershell
git add src-tauri/src/commands/storage.rs src-tauri/src/commands/storage/character_version_retention.rs
git commit -m "characters: add version retention owner"
```

---

### Task 3: Integrate pruning with version-producing mutations

**Files:**
- Modify: `src-tauri/src/commands/storage/characters.rs`
- Modify: `src-tauri/src/commands/storage/commands/entities.rs`
- Modify: `src-tauri/src/commands/storage/profile/legacy.rs`
- Modify: `src-tauri/src/commands/storage/character_version_retention.rs`
- Test: existing `#[cfg(test)]` modules in those files

**Interfaces:**
- Consumes: `prune_character_versions(state, Some(&ids))` from Task 2.
- Produces: every successful create/update/import path enforces the cap before returning clean success.

- [ ] **Step 1: Write failing snapshot and restore tests**

Seed 50 unpinned versions, perform the real snapshot-producing update, and assert only 50 remain and the new snapshot survives. Repeat through restore and avatar-update paths. Include a forced-prune-failure harness and assert the returned error code is `character_version_prune_failed` while the new durable snapshot still exists.

Run:

```powershell
cargo test --manifest-path src-tauri/Cargo.toml snapshot_prunes_character_versions --lib -- --nocapture
```

Expected RED: 51 rows remain because producers do not invoke retention.

- [ ] **Step 2: Call retention after durable snapshot/restore operations**

After snapshot creation and after the final live-character mutation succeeds:

```rust
let ids = HashSet::from([character_id.to_string()]);
prune_character_versions(state, Some(&ids)).map_err(|error| {
    AppError::with_details(
        "character_version_prune_failed",
        "Character was saved, but version history cleanup failed",
        json!({ "causeCode": error.code }),
    )
})?;
```

Avoid pruning temporary snapshots that are rolled back inside the same operation; prune only at the public operation success boundary.

- [ ] **Step 3: Write failing generic create/update tests**

Through `create_entity` and `update_entity`, seed 50 versions and create a 51st. Assert the oldest unpinned row disappears. Patch an out-of-window pinned row from `true` to `false` and assert that exact row is pruned after the update.

Expected RED: generic writes exceed the cap and unpin leaves 51 rows.

- [ ] **Step 4: Enforce retention in generic character-version commands**

After validation and successful generic create/update of `character-versions`, extract the non-empty `characterId`, invoke scoped pruning, then return the created/updated value. Invalid `pinned` values return `invalid_input`; missing values normalize to false for retention.

- [ ] **Step 5: Write failing legacy import tests**

Build a committed legacy import with 55 unpinned rows and two pinned rows for one character. Assert preview reports `wouldPrune: 5`, commit retains 52 total rows, and an import-progress failure leaves the pre-import collection unchanged.

- [ ] **Step 6: Prune after atomic import completion**

Collect affected character IDs from planned `character-versions` rows. Invoke pruning only after `replace_all_many_and_then` succeeds. Add retention counts to the import result without logging user content:

```rust
"versionRetention": {
    "affectedCharacters": report.affected_characters,
    "retainedPinned": report.retained_pinned,
    "pruned": report.pruned_rows
}
```

- [ ] **Step 7: Run all mutation-path tests**

```powershell
cargo test --manifest-path src-tauri/Cargo.toml character_version --lib -- --nocapture
cargo check --manifest-path src-tauri/Cargo.toml --workspace
```

Expected: snapshot, restore, generic mutation, import, media, and retention tests pass.

- [ ] **Step 8: Commit**

```powershell
git add src-tauri/src/commands/storage/characters.rs src-tauri/src/commands/storage/commands/entities.rs src-tauri/src/commands/storage/profile/legacy.rs src-tauri/src/commands/storage/character_version_retention.rs
git commit -m "characters: enforce version retention on writes"
```

---

### Task 4: Add the bounded existing-history migration

**Files:**
- Modify: `src-tauri/src/state.rs`
- Modify: `src-tauri/src/commands/storage/character_version_retention.rs`

**Interfaces:**
- Consumes: `prune_character_versions(state, None)` and startup migration marker helpers.
- Produces: marker `characterVersionRetentionV1` executed after `characterVersionInlineMediaV3`.

- [ ] **Step 1: Write failing startup migration tests**

```rust
#[test]
fn app_state_prunes_existing_history_once_after_media_v3() {
    let root = temp_root("character-version-retention-v1");
    seed_raw_versions(&root, "char-1", 55, &["version-0"]);

    let first = AppState::from_data_dir(&root.0, vec![]).unwrap();
    assert_eq!(count_versions(&first.storage, "char-1"), 51);
    assert!(startup_migration_applied(
        &first.storage,
        CHARACTER_VERSION_RETENTION_MIGRATION_KEY,
    ).unwrap());
    let first_hash = collection_hash(&root.0, "character-versions");
    drop(first);

    let second = AppState::from_data_dir(&root.0, vec![]).unwrap();
    assert_eq!(collection_hash(&root.0, "character-versions"), first_hash);
}
```

Also add a source-change/failure test proving the marker stays unset and the primary bytes remain unchanged.

- [ ] **Step 2: Run migration tests and verify RED**

Run:

```powershell
cargo test --manifest-path src-tauri/Cargo.toml character_version_retention_v1 --lib -- --nocapture
```

Expected RED: no retention marker exists and 55 rows remain.

- [ ] **Step 3: Register migration after media V3**

Add:

```rust
const CHARACTER_VERSION_RETENTION_MIGRATION_KEY: &str = "characterVersionRetentionV1";
```

Immediately after successful V3 media migration/cleanup, run retention through `run_startup_migration_once`. Propagate row-filter transaction errors so destructive migration failure is visible and retryable. Log only report counts.

- [ ] **Step 4: Verify migration ordering and idempotence**

Run:

```powershell
cargo test --manifest-path src-tauri/Cargo.toml character_version_retention_v1 --lib -- --nocapture
cargo test --manifest-path src-tauri/Cargo.toml character_version --lib -- --nocapture
```

Expected: first start prunes, marker is durable, second start preserves the exact collection hash, and media V3 tests remain green.

- [ ] **Step 5: Commit**

```powershell
git add src-tauri/src/state.rs src-tauri/src/commands/storage/character_version_retention.rs
git commit -m "storage: migrate character history retention"
```

---

### Task 5: Add pin and unpin controls to version history

**Files:**
- Modify: `src/engine/contracts/types/character.ts`
- Modify: `src/features/catalog/characters/hooks/use-characters.ts`
- Modify: `src/features/catalog/characters/components/CharacterVersionHistoryPanel.tsx`
- Create: `src/features/catalog/characters/components/CharacterVersionHistoryPanel.spec.tsx`

**Interfaces:**
- Consumes: `storageApi.update("character-versions", versionId, { pinned })`; server-side generic update retention from Task 3.
- Produces:

```ts
export interface CharacterCardVersion {
  // existing fields
  pinned?: boolean;
}

export function useSetCharacterVersionPinned(): UseMutationResult<
  CharacterCardVersion,
  Error,
  { characterId: string; versionId: string; pinned: boolean }
>;
```

- [ ] **Step 1: Write failing component tests**

Mock the character hooks and render the panel with pinned and unpinned rows:

```tsx
it("pins and unpins versions with accessible labels", async () => {
  render(<CharacterVersionHistoryPanel {...props} />);
  await user.click(screen.getByRole("button", { name: "Pin version" }));
  expect(setPinned.mutateAsync).toHaveBeenCalledWith({
    characterId: "char-1",
    versionId: "version-1",
    pinned: true,
  });
  expect(screen.getByText("De-Koi keeps the newest 50 versions plus pinned versions.")).toBeVisible();
});

it("confirms before unpinning a protected version", async () => {
  // Render a pinned row beyond the first 50 unpinned rows, click Unpin,
  // and assert showConfirmDialog describes immediate pruning eligibility.
});
```

- [ ] **Step 2: Run component tests and verify RED**

Run:

```powershell
pnpm vitest run src/features/catalog/characters/components/CharacterVersionHistoryPanel.spec.tsx
```

Expected: tests fail because the hook, `pinned` field, retention copy, and buttons do not exist.

- [ ] **Step 3: Add the type and mutation hook**

Implement:

```ts
export function useSetCharacterVersionPinned() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ versionId, pinned }: { characterId: string; versionId: string; pinned: boolean }) =>
      storageApi.update<CharacterCardVersion>("character-versions", versionId, { pinned }),
    onSuccess: (_data, variables) =>
      qc.invalidateQueries({ queryKey: characterKeys.versions(variables.characterId) }),
  });
}
```

- [ ] **Step 4: Add accessible pin controls and confirmation**

Import `Pin`/`PinOff`, render a button per row with `aria-label={version.pinned ? "Unpin version" : "Pin version"}`, and display the retention policy below the header. Before unpinning a pinned row whose index is beyond the protected window, show:

```ts
message: "Unpin this version? De-Koi keeps only the newest 50 unpinned versions, so this older version may be deleted immediately."
```

Disable restore, delete, and pin controls while any version mutation is pending. On success, show `Pinned version.` or `Unpinned version.`; on failure, show the server error.

- [ ] **Step 5: Run UI tests and typecheck**

```powershell
pnpm vitest run src/features/catalog/characters/components/CharacterVersionHistoryPanel.spec.tsx src/features/catalog/characters/hooks/use-characters.spec.ts
pnpm typecheck
```

Expected: focused UI tests and TypeScript compilation pass.

- [ ] **Step 6: Commit**

```powershell
git add src/engine/contracts/types/character.ts src/features/catalog/characters/hooks/use-characters.ts src/features/catalog/characters/components/CharacterVersionHistoryPanel.tsx src/features/catalog/characters/components/CharacterVersionHistoryPanel.spec.tsx
git commit -m "characters: add version pin controls"
```

---

### Task 6: Final proof, review, shipping, and Pi rollout

**Files:**
- Modify only if verification finds an in-scope defect.
- Preserve: `/home/chai/de-koi-data/rollback/character-versions-pre-v2-20260710-172133.json`

**Interfaces:**
- Consumes: all previous tasks.
- Produces: a clean PR, Bunny pass, merged `main`, and verified Pi retention migration.

- [ ] **Step 1: Run focused and full local gates**

```powershell
cargo test --manifest-path src-tauri/crates/storage/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml character_version --lib -- --nocapture
pnpm vitest run src/features/catalog/characters/components/CharacterVersionHistoryPanel.spec.tsx
cargo check --manifest-path src-tauri/Cargo.toml --workspace
pnpm check:architecture
pnpm check
node .agents/automation/scripts/workflow-health.mjs
git diff --check origin/main...HEAD
```

Expected: every command exits 0; `check:unused` may report only the repository’s existing warning-only baseline.

- [ ] **Step 2: Run independent review and Bunny**

Review the complete diff for destructive-selection correctness, entrypoint coverage, bounded memory, transaction recovery, shared media, malformed rows, pin semantics, import behavior, and exact rollback copy. Resolve all Critical/Important findings, rerun affected tests, and obtain a Bunny pass before opening or updating the PR.

- [ ] **Step 3: Publish a draft PR and pass ready gates**

Push only to `origin`, create a draft PR against `The-Koi-Pond/De-Koi:main`, include the approved retention rule and unchecked human-validation boxes, run proof health with a destructive-user-data risk matrix, trigger Bunny, wait for CI, resolve all threads, then mark ready only when `pr-health --for-ready` reports no blockers.

- [ ] **Step 4: Merge and wait for the exact container batch**

Squash-merge only after full CI and ready-state Bunny are green. Wait for the `Container Images` workflow for the merge SHA to publish and promote the matched arm64 `prealpha` batch.

- [ ] **Step 5: Capture pre-migration Pi evidence**

Over SSH, record active collection SHA-256, bytes, exact top-level record count, per-character unpinned/pinned counts, HTTP health, server memory, and free memory. Create a new timestamped rollback copy outside `/home/chai/de-koi-data/data/collections` and verify its hash. Keep the existing pre-V2 rollback as a second recovery point.

- [ ] **Step 6: Deploy and verify destructive migration**

Run from `/home/chai/de-koi-src`:

```sh
git pull --ff-only origin main
sh scripts/pi-update.sh --trusted-lan
curl -I http://127.0.0.1:7860/
```

Verify every character has at most 50 unpinned rows, every pinned ID survived, ownerless rows survived, retained versions restore, shared media URLs resolve, collection size is bounded, HTTP is 200, and no OOM appears. Restart `de-koi-server`, confirm the collection hash is unchanged, and retain both rollback files until Celia separately approves cleanup.

- [ ] **Step 7: Report completion**

Report PR URLs/state, merge SHA, container batch, behavior changed, files/modules, dependent areas reviewed, focused/full verification, Bunny, health gate, exact Pi before/after counts, rollback paths/hashes, remaining cgroup limitation, and vault classification.
