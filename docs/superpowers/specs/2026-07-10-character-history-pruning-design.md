# Character History Pruning Design

## Goal

Prevent character-version history from growing without bound while preserving useful recovery history and every version a user explicitly protects.

De-Koi will retain the newest 50 unpinned versions per character plus every pinned version. The policy applies to new snapshots, completed imports, and existing installations through a one-time bounded startup migration.

## User Contract

- Each character keeps its newest 50 unpinned versions.
- Versions with `pinned: true` never count against the 50-version allowance and are never automatically pruned.
- Users can pin and unpin versions from character version history.
- Manual deletion remains available and continues to require the existing user action.
- Pruning never deletes a version belonging to another character.
- A character with 50 or fewer unpinned versions is unchanged.
- Restoring a version follows the existing snapshot contract: the current character state is snapshotted first, then the selected version is restored. The resulting history is pruned only after the restore transaction succeeds.

The UI should explain the policy near the version list: “De-Koi keeps the newest 50 versions plus pinned versions.” Pin controls must be accessible by keyboard and expose clear `Pin version` and `Unpin version` labels.

## Ownership and Architecture

The retention rule and pruning mechanics belong to the Rust storage owner under `src-tauri/src/commands/storage`. React owns only the version-history display and pin/unpin interaction. The frontend uses the existing focused storage API; no raw Tauri invocation or remote fetch is added.

The implementation should introduce a focused character-version retention module rather than expanding generic entity deletion or `state.rs` with retention policy details. That module owns:

- the retention constant (`50`);
- deterministic ordering and survivor selection;
- atomic row removal;
- reference-safe managed-media cleanup;
- startup migration reporting;
- post-snapshot and post-import pruning entrypoints.

The storage crate may gain a bounded character-version transformation or visit primitive only if the existing streaming APIs cannot express the required atomic operation. Product-specific retention rules must not move into the generic storage crate.

Architecture proof target: `pnpm check:architecture`.

## Ordering and Selection

Retention is evaluated independently for each non-empty `characterId`. Rows without a valid `characterId` are retained and reported as malformed; automatic pruning must not guess their owner.

Versions are ordered newest-first using this precedence:

1. Valid `createdAt` timestamp.
2. Valid `updatedAt` timestamp.
3. Numeric or semver-like `version` value when timestamps are unavailable.
4. Stable source order as the final tie-breaker, with later source rows treated as newer.

Pinned rows are selected first and removed from cap calculations. The newest 50 remaining rows survive. Every other unpinned row for that character is a prune candidate.

The selector must be a pure, directly tested helper. Invalid dates or version labels do not abort pruning; they fall through to the next ordering signal. Exact ties remain deterministic.

## Runtime Pruning

Pruning runs after a character-version-producing operation has durably succeeded:

- ordinary character update snapshots;
- avatar-changing snapshots;
- restore snapshots;
- legacy profile import;
- character import flows that install version history;
- direct generic creation of a character-version row, after contract validation.

The producer passes the affected character IDs to the retention owner. Pruning reads only those histories, selects candidates, and removes them through an atomic storage mutation. It then removes candidate media only when bounded reference checks prove no surviving character, character version, avatar, or public-profile banner still refers to the file.

If pruning fails, the producing operation returns an explicit retention error rather than reporting clean success. Already-durable user content is not rolled back merely because cleanup failed; the error details distinguish row-pruning failure from best-effort orphan-file cleanup. A later snapshot or startup migration retries the policy.

Pin and unpin mutations also invoke pruning. Pinning can only increase protected history. Unpinning a version may immediately make it eligible for deletion if more than 50 newer unpinned versions exist; the UI must confirm this possibility before unpinning an out-of-window version.

## Existing-History Migration

A new independently versioned startup migration applies the policy to existing histories. It must run after character-version inline-media V3 so retained rows use canonical managed references and deleted-row media can be checked safely.

The migration is bounded-memory:

- it must not call `storage.list("character-versions")` for the complete collection;
- it processes or indexes one character partition at a time using disk-backed or streaming storage machinery;
- memory use is bounded by one character’s history plus compact character/index metadata, not the full collection payload;
- it validates input and output record counts against the computed survivor/pruned totals before installation;
- it uses the recoverable collection transaction protocol already used by streaming migrations;
- its completion marker is written only after the installed collection is reopened and validated.

Malformed ownerless rows survive. A migration failure leaves the original collection installed, leaves its marker unset, cleans only proven-unreferenced attempt-owned files, and surfaces the error at startup. The pre-migration backup remains available through the existing collection transaction and the operational rollback copy; automatic cleanup does not delete those recovery artifacts.

## Pinning Data and UI

`pinned` is an optional boolean on character-version records. Missing, null, or non-boolean legacy values are treated as `false` for retention, while direct writes must normalize or reject invalid values according to the collection contract.

The character-version TypeScript type gains `pinned?: boolean`. The existing version-history query and mutation owner exposes pin/unpin mutations with optimistic state only if rollback on failure is already established in that hook; otherwise it invalidates and refetches after the server confirms the change.

The pin control does not create another version snapshot. Pin state is retention metadata, not character content.

## Managed-Media Safety

Pruning must reuse the expanded media-reference rules established by the character-version memory-safety work:

- avatar and public-profile banner paths share a content-addressed namespace;
- a file may be referenced by another version through avatar metadata, banner metadata, or an exact managed asset URL;
- a live character may reference restored media through its avatar fields or nested public-profile banner URL;
- duplicate paths within one deleted batch are cleaned once;
- cleanup never relies on filename substring matching;
- failure to prove a path is unreferenced preserves the file.

Row deletion is the durable operation. Media deletion is reference-safe cleanup after the row transaction. A media cleanup failure is reported and retried later; it does not reconstruct already-pruned history rows or pretend the prune failed atomically.

## Import and Export

Imports may temporarily stage more than 50 versions for a character, but the completed import must apply retention before returning success. Pinned imported versions survive when their `pinned` value is valid. Preview and dry-run imports report how many versions would be retained, pinned, and pruned without mutating data.

Exports contain only retained history. No tombstones or hidden pruned versions are exported.

## Observability

Pruning returns a structured internal report:

- affected character count;
- retained unpinned count;
- retained pinned count;
- pruned row count;
- cleaned media count;
- preserved shared-media count;
- malformed ownerless row count.

Logs contain counts, migration key, and error codes only. They must not include character names, descriptions, prompts, image data, or complete records.

## Verification

Durable focused tests are justified because this feature permanently deletes user data and can silently break historical media.

Required tests:

- 49, 50, and 51 unpinned versions;
- more than 50 versions with pinned rows inside and outside the newest window;
- all-pinned history;
- timestamp, version-label, invalid-date, and exact-tie ordering;
- ownerless malformed rows preserved;
- isolation between multiple characters;
- pin, unpin, and out-of-window unpin behavior;
- snapshot, avatar update, restore, direct create, and import entrypoints;
- startup migration record accounting, retry, idempotence, and source-change failure;
- shared avatar/banner media across retained and pruned versions;
- live character avatar and banner references;
- duplicate cleanup paths;
- row-pruning failure and media-cleanup failure;
- UI pin labels, confirmation, and query refresh behavior.

Matching gates:

- focused Rust retention and character-version tests;
- focused React version-history tests;
- `cargo check --manifest-path src-tauri/Cargo.toml --workspace`;
- `pnpm typecheck`;
- `pnpm check:architecture`;
- full `pnpm check` for shipping.

## Rollout and Rollback

Before deploying the migration to an installation with existing history, preserve a timestamped copy of `character-versions.json` outside the active collection directory and record its hash and row count. Do not delete managed avatar directories or collection backups.

Live rollout verifies:

- each character has at most 50 unpinned versions;
- pinned versions remain;
- ownerless rows remain;
- retained versions restore correctly;
- shared avatars and banners resolve;
- a second restart is a no-op;
- HTTP health and server memory remain stable.

Rollback uses the previous application image plus the preserved collection copy and its companion managed-media directories. Because automatic pruning is destructive, rollback cannot recreate pruned versions without that backup.

## Success Criteria

- Character-version history cannot grow beyond 50 unpinned rows per character during normal operation.
- Pinned versions remain indefinitely until explicitly unpinned or manually deleted.
- Existing histories are pruned once with bounded memory and recoverable installation.
- No retained character or version loses referenced avatar or banner media.
- Failures are explicit, retryable, and never presented as clean success.
- The Pi and representative desktop data sets pass record-count, restore, media, restart, HTTP, and memory verification.
