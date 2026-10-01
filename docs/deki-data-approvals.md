# Deki App-Data Commands, Approvals, And Live Activity

Slices 3 and 4 of the Deki CLI-style assistant handoff (issues #676 and #677). Deki-senpai can
read and propose changes to the creative library through the `deki_data`
command family, but it never writes on its own: every change is a dry-run that
the user must approve.

## Owners

- `src-tauri/src/commands/storage/deki/data_cli.rs`: `deki_data` argument
  parsing, read actions, dry-run planning, validation, diff previews, operation
  hashes, and the approved-write path.
- `src-tauri/src/commands/storage/deki/approvals.rs`: pending approvals, their
  expiry, approve/reject resolution, compact history, and the approvals summary
  injected into the next Deki turn.
- `src-tauri/src/commands/storage/deki/library.rs`: the collection allowlist
  shared by library reads and `deki_data`.
- `src/shared/api/deki-api.ts`: `dekiApi.workspace.status`, `approve`, and
  `reject` wrappers. `deki_workspace_approve` and `deki_workspace_reject` are
  explicit in `remote-runtime.ts` and `http_dispatch.rs`.

## Command Contract

Read actions: `status`, `collections`, `list`, `search`, `get`.
Mutation actions: `insert`, `patch`, `delete`, each with a required `reason`.

Collections are the creative library only: characters, character groups,
personas, persona groups, lorebooks, lorebook entries, prompt presets, and
prompt sections, groups, and variables. Chats, messages, memories, connections,
and settings are not `deki_data` collections.

`replace` is rejected on purpose. Storage owners merge updates (character
`data` merges recursively), so a raw full-row replace would bypass their
normalization. Use `patch` with only the fields that change.

## Dry-Run And Apply

1. A mutation command plans against current storage and writes nothing. The
   plan normalizes the payload with the same card-field contract Deki action
   cards use, checks parent references (`lorebookId`, `presetId`), rejects
   storage-owned fields (`id`, `createdAt`, `updatedAt`) and no-op patches.
   A delete also lists every row the storage owner's cleanup touches: lorebook
   entries and folders plus the chats and characters that stop using the
   lorebook; prompt sections, groups, and variables; character and persona
   gallery rows; knowledge links it invalidates; and character memories it
   moves to deleted. Each side-effect row says what happens to it. Managed
   files (avatars, sprites, gallery and lorebook images) are named in a
   validation notice because they are not rows.
2. A plan that passes validation becomes a pending approval with a bounded diff
   preview and a `sha256:` operation hash over the payload, the current row,
   and every side-effect row, so a related row that changes after the dry-run
   makes the approval `state_changed`. Inserts pre-assign their id, so the preview, the
   hash, and the created record name the same row. Blocked plans are recorded
   in history and create no approval.
3. Approve and reject take the Deki session id and act only on approvals in
   the caller's owner and session scope; anything else resolves as
   `not_found`. Approve removes the pending entry first, so a second approve
   resolves as `not_found`. It then re-plans, checks, and writes inside one
   exclusive storage section (`FileStorage::with_exclusive_writes`), so no
   other writer can change the rows between the check and the write. If
   validation now fails the result is `blocked`, and if the hash differs the
   result is `state_changed`. In both cases nothing is written. A blocked
   dry-run reports zero affected rows. Otherwise the change is applied through
   `storage_create_inner`, `storage_update_inner`, or `delete_entity`, the same
   owners the app editors use, so normalization, cascades, and character
   version snapshots match manual edits.
4. If the write fails, the runtime plans again inside the same exclusive
   section. An unchanged hash proves nothing was written, so the approval goes
   back to pending under the same id and can be retried without a new history
   row. A changed hash means part of the change may have been saved; the
   approval is recorded as `failed` and is never replayed, and the user is
   told to check the records and ask for a fresh dry-run.

Limits: 6 data dry-runs per Deki turn, 12 pending approvals per session,
30-minute approval expiry, 64 KiB payloads, and previews capped per string,
array, depth, and cascade row count.

## Scope And Persistence

Pending approvals and history are in memory for the running process. They do
not survive a restart; an expired or lost approval is simply re-requested. Each
entry is scoped to the server-owned runtime owner plus the Deki session id, the
same scope as workspace status and abort, so one remote principal cannot list,
approve, or reject another's changes. The next Deki turn receives a short
summary of pending and resolved approvals so Deki reports outcomes instead of
guessing.

Existing `<deki_action>` approval cards are unchanged and remain the preferred
way to draft or rewrite a single card. `deki_data` covers deletes and precise
structured edits.

## Live Activity (Slice 4)

- `deki/events.rs` defines `DekiEventSink`. The JSON runtime reports visible
  narration (`status`), command steps (`tool_start`/`tool_end` with bounded
  output), retries, and each new `approval_pending`. Events never carry hidden
  protocol frames or raw model output.
- Embedded: `deki_prompt_events` sends events over a Tauri `Channel` and
  resolves with the final response. It is a non-remote command.
- Hostable: `POST /api/deki/prompt/stream` (SSE) takes the same
  `{ "request": DekiPromptRequest }` body as `/api/invoke`, rejects any other
  body before streaming, sends the same events, and ends with `done` (the final
  response) or `error`. It uses the verified runtime
  owner like `/api/invoke`, and the `deki` rate-limit bucket.
- The final response carries `workspaceTrace` (narration and command steps,
  outputs clipped to 1.2k chars; protocol-repair notes are dropped) and the
  turn's `pendingApprovals`. The shell stores the trace and one compact
  history row per approval on the assistant message, so outcomes stay
  readable after the runtime forgets the approval.
- `dekiApi.promptEvents` normalizes every event and drops unknown or malformed
  ones. `DekiSurface` keys live activity by session and ignores events from an
  older run of the same session. Stop calls `deki_workspace_abort`; a native
  write-tool turn reports that it cannot be stopped.

Known limit: the hostable runtime treats loopback and trusted-interface
requests as auth bypass, which is not a principal, so Deki refuses them. Use
Basic Auth from another address to run Deki against a hosted runtime.
