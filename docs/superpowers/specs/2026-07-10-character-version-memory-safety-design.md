# Character Version Memory Safety Design

## Goal

Prevent oversized character-version history from exhausting De-Koi's hostable runtime while preserving every valid historical version. Existing inline image payloads must be migrated to managed assets without loading the full collection into memory, and all import and snapshot entrypoints must prevent inline media from returning.

The immediate incident occurred on a 4 GiB Raspberry Pi, but the product fix applies to every embedded and hostable De-Koi runtime. A Pi-specific container limit is defense-in-depth, not the primary repair.

## Incident Evidence

- The Pi's `de-koi-server` process was OOM-killed with about 2.0 GiB resident memory while all 2.0 GiB of swap was exhausted.
- `/data/data/collections/character-versions.json` was 279 MiB and contained 727 version records.
- The collection contained 145 `data:image` values; its longest JSON line was about 3 MiB.
- Parsing the collection expanded the restarted server from a small baseline to about 758 MiB RSS.
- A character-version write created another partial 126 MiB temporary file before the OOM kill, showing that full-collection cloning and serialization amplified the resident collection.
- Storage operations degraded from milliseconds to 30â€“38 seconds before failure.
- Power, temperature, throttling, hostname resolution, and the Windows Tailscale client were healthy. Wi-Fi/DHCP failure happened after memory pressure and removed remote reachability.

## Design Principles

1. Preserve user history by default. No automatic version pruning is part of this repair.
2. Store media as managed files and references, never as base64 inside hot JSON collections.
3. Bound memory by the largest individual record, not by the full collection size.
4. Make migration interruption-safe, idempotent, and recoverable without trusting a completion marker alone.
5. Normalize at the owning import and snapshot boundaries before generic storage receives a record.
6. Keep generic storage contracts explicit; do not hide malformed payloads with silent catches or lossy fallbacks.
7. Use a Pi container ceiling only to protect the operating system if a future product regression escapes these safeguards.

## Ownership And Architecture

The repair belongs to three existing owners:

- **Rust storage capability:** streaming collection migration, atomic installation, validation, and startup marker lifecycle.
- **Rust character/import commands:** conversion of trusted inline character media into managed assets before creating characters or character-version snapshots.
- **Pi deployment override:** a server-only Docker memory ceiling that leaves enough memory for Linux, Docker, networking, and Tailscale.

The TypeScript engine and React features do not own this repair. Their typed storage and import contracts remain unchanged. Embedded Tauri commands and hostable HTTP dispatch continue to call the same focused Rust modules.

## Canonical Character-Version Media Contract

A character-version record may retain character data, comments, version metadata, and managed media references. It must not persist an inline `data:image/...;base64,...` value in any supported avatar field.

Trusted avatar fields are normalized as one coherent group:

- `avatarPath`
- `avatar`
- `avatarUrl`
- `avatarFilePath`
- `avatarFilename`

The canonical stored value is a managed asset URL plus the corresponding managed file path and filename metadata already used by De-Koi. Redundant mirror fields may remain only when required by the current storage contract, and they must reference the same managed asset. Arbitrary strings elsewhere in character data are not interpreted as files or rewritten.

Image decoding must use existing MIME validation, supported-format checks, decoded-size limits, and managed-path containment. Invalid or oversized image payloads return an explicit import or snapshot error before generic storage mutation.

## Streaming Migration

Introduce a new versioned migration, independent of the already-completed one-shot inline-image marker. The old marker cannot be reused because inline records may have been imported after it was set.

### Input And Output

The migration opens `character-versions.json` with a buffered reader and parses the top-level array one record at a time. Each normalized record is immediately serialized to a migration temporary file. The implementation must never materialize the full input or output collection as `Vec<Value>` or `Vec<u8>`.

For each record:

1. Parse one JSON object.
2. Inspect only the trusted avatar fields.
3. Decode and validate any inline image.
4. Persist it as a managed character-version asset.
5. Replace all applicable avatar mirrors with canonical managed references.
6. Serialize the normalized record to the output array.
7. Release record-local image and JSON buffers before reading the next record.

The peak-memory target is the runtime baseline plus one record, one decoded image, and bounded serialization buffers. It must not scale with collection length.

### Asset Identity

Use a deterministic content fingerprint in the managed filename so repeated historical snapshots of the same image reuse an existing valid asset instead of creating hundreds of duplicate files. A collision-safe suffix remains available if an existing path has different bytes. No source filesystem path supplied by imported data is trusted directly.

### Atomic Installation

The migration writes beside the active collection using a dedicated, recognizable temporary suffix. It tracks assets newly created during the attempt.

Before installation it verifies:

- the output parses as a complete JSON array;
- output record count equals input record count;
- every rewritten managed reference resolves inside the approved asset root;
- no trusted avatar field in the output contains an inline image;
- the original active collection has not changed since migration began.

If verification succeeds, the storage capability installs the new file with the repository's atomic replacement and backup discipline. The migration marker is written only after the installed file is reopened and validated. The pre-migration collection is retained as a named rollback backup until a later explicit cleanup.

If parsing, image conversion, validation, or installation fails, the active collection and completion marker remain unchanged. The temporary output and assets created only by that failed attempt are removed. A subsequent startup can retry safely.

### Recovery And Stale Files

Startup distinguishes an active migration temporary from unrelated storage write temporaries. It may resume from a small progress manifest when the input fingerprint still matches; otherwise it discards only its own migration temporary and restarts from record zero.

Existing `character-versions.json.tmp-*` files are not selected as authoritative data automatically. After the active collection and its backup validate, stale failed-write temporaries may be reported and removed by an explicit maintenance step. The Pi repair will keep a safety copy until post-migration validation is complete.

## Preventing Recurrence

All paths that can create or restore legacy character data must call the same character-media normalizer before mutation:

- Marinara character import;
- legacy/native profile import of character versions;
- character creation or update when avatar mirrors are present;
- character-version snapshot creation;
- character-version restoration before the restored character is persisted.

The normalizer returns either a canonical managed-media field set or a precise error. Generic `FileStorage` remains unaware of character semantics.

Add a defensive contract check for `character-versions` writes that rejects trusted avatar fields containing inline image data. This catches future entrypoints that bypass the owner without turning generic storage into a character-specific router.

No history retention limit is introduced. If De-Koi later offers retention controls, they must be explicit user-facing policy with export/backup semantics, not an emergency memory workaround.

## Pi Runtime Containment

The Pi-specific Compose override gives `de-koi-server` a 2 GiB hard memory limit and a 2.25 GiB memory-plus-swap limit. The web container remains separate. `restart: unless-stopped` allows the server to recover while preserving capacity for SSH, NetworkManager, Docker, and Tailscale.

This limit is applied only after the streaming migration is available; otherwise it could repeatedly kill the old full-collection migration. A limit-triggered restart must remain visible in Docker and kernel diagnostics rather than being reported as application success.

## Error Handling And User Safety

- Migration errors include the record index and stable record ID when available, but never log character content or image bytes.
- Import errors identify the offending media field and size/format reason without echoing the payload.
- The server starts only when the active collection is valid. A failed optional migration leaves the old data readable and reports that repair is pending.
- The migration never deletes the original history file during the same operation that creates the replacement.
- Managed asset cleanup is reference-aware. It must not remove an image referenced by a live character or another version.
- Secrets, chat transcripts, and unrelated collections are outside the migration scope.

## Test Strategy

### Durable Rust Tests

1. A synthetic multi-record collection with inline images migrates without loading the complete collection through the ordinary `list` API.
2. Migrated output preserves record count, IDs, version metadata, and non-media character data.
3. Repeated identical images resolve to the same managed asset.
4. Unsupported, malformed, and oversized images fail without changing the active collection or marker.
5. Forced interruption during parsing, asset write, validation, and atomic installation leaves the original readable and permits retry.
6. Re-running a completed migration is a no-op.
7. Import and snapshot entrypoints persist no inline avatar fields.
8. A direct invalid `character-versions` write is rejected at the focused contract boundary.
9. Failed attempts remove only content-addressed assets that a record-at-a-time reference scan proves are unreferenced; successful startup also removes unreferenced files matching the version-content-address naming contract.

The streaming test uses an instrumented reader or migration seam to prove record-at-a-time processing. It must not depend on unstable process-RSS assertions or commit a hundreds-of-megabytes fixture.

### Repository Verification

- Focused Rust tests for the migration, imports, characters, and storage contract.
- `cargo check --manifest-path src-tauri/Cargo.toml`
- `pnpm check:architecture`
- `pnpm typecheck` only if a TypeScript contract must change; the current design expects none.
- `pnpm check` before any shipping or ready-for-review step.

### Live Pi Proof

1. Capture the active collection fingerprint, record count, image count, file sizes, server RSS, and free memory.
2. Preserve an external rollback copy before deploying the migration.
3. Deploy the repaired server and run the migration once.
4. Confirm identical record count and zero inline images in trusted fields.
5. Confirm historical versions and their avatars remain accessible through the app.
6. Repeatedly save and restore characters while sampling server RSS and storage latency.
7. Restart the stack and verify the migration is a no-op.
8. Confirm `http://pi:7860`, SSH, Tailscale, Docker health, and kernel OOM logs remain clean.
9. Leave the rollback copy in place until Celia approves cleanup.

## Rollout

1. Implement and verify normalization plus the streaming migration locally using synthetic data.
2. Add the Pi Compose containment setting, but do not activate it before the migration-capable image is deployed.
3. Back up the Pi collection and deploy the new image.
4. Run and verify migration under observation.
5. Exercise character save/restore and normal app startup.
6. Monitor memory and service reachability through a representative session.
7. Keep the original collection backup; stale temporary-file cleanup is a separate explicit step.

## Non-Goals

- Automatically deleting old character versions.
- Converting all JSON collections to SQLite or another storage engine.
- Changing TypeScript engine, React feature, or HTTP command contracts without evidence that they require it.
- Treating Docker restarts as the product fix.
- Repairing unrelated Wi-Fi configuration, legacy backup files, or other dirty-worktree changes.

## Success Criteria

- Every valid character version remains available after migration.
- Trusted character-version avatar fields contain no inline images.
- Migration peak memory is bounded by one record and one decoded image rather than collection size.
- Character version creation and restoration no longer rewrite hundreds of megabytes caused by embedded media.
- A future server memory regression cannot exhaust the Pi host and take down remote administration.
- Local checks and the live Pi proof pass without modifying unrelated user work.
