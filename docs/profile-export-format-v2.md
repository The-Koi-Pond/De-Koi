# Profile Export Format v2 Contract

De-Koi keeps JSON profile export on the backward-compatible v1 contract. The
Profile ZIP option uses the v2 ZIP archive with a manifest and chunked record
files so large profiles do not depend on one monolithic JSON document.

The v2 codec is active in Settings, the Tauri command, and the remote HTTP
download route. Profile ZIP import auto-detects v2 packages while retaining the
existing v1 JSON and ZIP import paths. V2 packages are fully validated before
preflight or mutation, expose record counts and destructive scopes for
confirmation, stage managed assets, and commit collection replacements with
asset installation through the existing rollback-aware storage transaction.

## Archive Layout

```text
marinara-profile-v2.zip
  manifest.json
  tables/
    chats/000001.jsonl
    messages/000001.jsonl
    characters/000001.jsonl
    lorebooks/000001.jsonl
    ...
  assets/
    index.json
    ...
```

## Manifest

`manifest.json` should contain:

- `type`: `marinara_profile`
- `version`: `2`
- `exportedAt`: ISO timestamp
- `appVersion`: exporting app version when available
- `tables`: array of exported table descriptors
- `assets`: optional asset index descriptor
- `compatibility`: minimum app/runtime expectations

Each table descriptor should include:

- `name`
- `recordCount`
- `files`
- `bytes`
- `schemaVersion`
- `destructiveImportMode`

## Table Chunks

Table chunks should be JSON Lines files. Each line is one record object. Chunk
names should be deterministic and sorted so import progress can be resumed or
reported predictably.

Recommended first chunking targets:

- `messages`
- `chats`
- `chat-memory`
- `conversation-notes`
- `gallery`
- future bulky media metadata tables

Small tables may still use one chunk.

## Import Requirements

The importer must:

- keep v1 `marinara-profile.json` support;
- preflight the manifest before mutating storage;
- show table counts and destructive import scope before commit;
- normalize every table through the same storage/import boundary used by current
  writes;
- report failed chunks with table name and chunk filename;
- avoid partial destructive replacement unless a future staged transaction plan
  defines rollback behavior.

## Folder Imports

A user-selected folder can represent an unpacked v2 archive if it contains a
valid `manifest.json` at the root. Folder import should follow the same preflight
and commit rules as zip import.

## Out Of Scope

The implementation does not change profile semantics, silently merge tables, or
raise JSON size limits as the primary solution. User-selected unpacked folder
import remains future work; the active transport accepts v2 ZIP packages.
