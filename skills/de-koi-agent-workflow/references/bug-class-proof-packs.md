# Bug Class Proof Packs

Use these packs for risky or boundary bugfixes before Bunny/PR handoff. They are
adjacent-invariant prompts, not a new process: pick the matching pack, add only
the proof rows that could contradict the fix, and keep tiny local bugs on the
fast path.

## Storage/import/export

- When to use: fixes that read, write, import, export, migrate, back up, restore,
  select, rename, delete, or normalize user data or app-managed files.
- Common adjacent invariants: empty selection; omitted input vs explicit empty
  input; partial success and rollback; path traversal and safe filenames; current
  and legacy format compatibility; user-visible success/error copy; embedded vs
  remote/runtime parity where the command is remote-capable.
- Cheap proof rows: no items selected; `undefined` or missing field; `[]` or
  empty string; one valid plus one invalid item; `../` and reserved filename
  rows; legacy fixture plus current fixture; asserted toast/dialog/status copy;
  Tauri command and HTTP route/harness row when both paths exist.
- Wrong fixes to avoid: UI-only guards over unsafe storage contracts; silent
  partial failure; pretending an empty import/export succeeded; broad filename
  sanitizers that collide or delete companion files; converting legacy data
  without a compatibility row.
- Validation commands likely relevant: `pnpm typecheck`, `pnpm build`, `cargo
  check --manifest-path src-tauri/Cargo.toml`, `pnpm check:architecture`.

## Prompt/generation/hidden commands

- When to use: fixes that change prompt assembly, generation routing, tool or
  hidden-command parsing, provider requests, model capability behavior, or
  execution of advertised commands.
- Common adjacent invariants: advertised vs parsed vs executed command parity;
  chat/roleplay/game mode gating; provider and capability gating; no fake
  success when execution fails; prompt assembly owner boundaries; focused
  regression proof for the original command or prompt shape.
- Cheap proof rows: visible command list contains the command; parser accepts the
  documented spelling and rejects near misses; execution succeeds in the allowed
  mode and is blocked in other modes; provider without the capability gets a
  real error/disabled path; failing executor does not emit success copy; snapshot
  or harness proof of the assembled prompt/request.
- Wrong fixes to avoid: adding duplicate mode/provider conditionals in consumers;
  hardcoding prompt text in UI; swallowing executor errors; marking a command
  complete before the command returns; broad fallbacks that make unsupported
  providers look supported.
- Validation commands likely relevant: `pnpm typecheck`, targeted Vitest,
  `pnpm build`, `pnpm check:architecture`.

## Stream/runtime contracts

- When to use: fixes that touch streaming events, runtime adapters, shared API
  wrappers, hostable runtime routes, Tauri command shapes, or producer/consumer
  event contracts.
- Common adjacent invariants: producer and consumer event parity; legacy stream
  variants; remote runtime path; typed shared contract ownership; unknown event
  handling; no UI-only guard over a broken contract.
- Cheap proof rows: every emitted event has a consumer and type; legacy event
  variant still parses; embedded/Tauri path and remote HTTP path return the same
  contract where both are supported; unknown event is ignored or surfaced by the
  documented owner; failing producer row proves the consumer does not invent
  success.
- Wrong fixes to avoid: patching only the React consumer; changing shared types
  without producer proof; dropping unknown events silently when diagnostics need
  them; adding a remote-only shape that embedded runtime cannot produce.
- Validation commands likely relevant: `pnpm typecheck`, `pnpm build`, `pnpm
  check:architecture`, `cargo check --manifest-path src-tauri/Cargo.toml`.

## Cache/file cleanup/media mutations

- When to use: fixes that mutate, copy, clean, prune, cache, upload, replace,
  resize, relink, or delete local/remote media or managed files.
- Common adjacent invariants: success-before-cleanup ordering; failed or partial
  mutation behavior; local vs remote parity; managed path safety; no deletion of
  unchanged assets; retry/fallback behavior.
- Cheap proof rows: successful mutation records new asset before cleanup; failed
  mutation leaves original asset and metadata intact; one of several mutations
  fails; unchanged asset is not deleted; path outside managed roots is rejected;
  retry row does not duplicate or orphan files; local and remote-capable routes
  produce matching metadata.
- Wrong fixes to avoid: deleting first and hoping replacement succeeds; cleanup
  based only on filename text; catching mutation errors and showing success;
  remote path that bypasses managed-root checks; fallback that creates untracked
  duplicate assets.
- Validation commands likely relevant: `pnpm typecheck`, targeted Vitest,
  `cargo check --manifest-path src-tauri/Cargo.toml`, `pnpm check:architecture`.

## Metadata/schedule/memory/state shape

- When to use: fixes that reshape metadata, schedules, tracker rows, memories,
  summaries, state blocks, normalized records, or persisted runtime state.
- Common adjacent invariants: preserving unknown fields; sibling/local identity;
  legacy/default rows; missing current block behavior; partial update behavior;
  import/export/storage normalization risk.
- Cheap proof rows: unknown field round-trips; sibling record keeps its own id
  and local-only fields; legacy/default fixture still loads; missing current
  block creates the documented default or reports the documented error; partial
  update changes only named fields; normalized import/export/storage row keeps
  the same app-owned identity.
- Wrong fixes to avoid: replacing whole records for partial updates; assuming
  current block always exists; dropping unknown fields during normalization;
  conflating sibling identity with display labels; fixing UI state while
  persisted/imported state still has the old shape.
- Validation commands likely relevant: `pnpm typecheck`, targeted Vitest, `pnpm
  build`, `pnpm check:architecture`.
