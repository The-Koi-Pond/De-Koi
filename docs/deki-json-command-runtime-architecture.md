# Deki JSON Command Runtime Architecture

This note indexes the architecture diagrams for issue #675 / Slice 2 of the
Deki CLI-style assistant handoff. Use these diagrams as implementation anchors
when changing Deki's prompt runtime.

## Diagram Index

- `docs/uml/Refactor/deki-json-command-runtime-target.puml`: target owner
  layout for the JSON command runtime, including the shell, shared API, engine
  contracts, embedded and remote Rust entrypoints, focused Deki runtime modules,
  LLM provider transport, storage, and security edges.
- `docs/uml/Refactor/deki-json-command-loop-sequence.puml`: Slice 2 prompt
  sequence from `DekiSurface` through `dekiApi.prompt`, `deki_prompt`, bounded
  JSON command rounds, read-only command execution, final visible response, and
  existing `<deki_action>` extraction.
- `docs/uml/Refactor/deki-json-command-runtime-edges.puml`: surrounding
  behavior that the implementation must keep functional while changing the
  runtime: Deki history, action cards, inline diffs, scoped chat access,
  consent-gated web research, sidebar session behavior, and future Slice 3/4
  boundaries.

## Implementation References

Reference the diagrams during Slice 2 changes with these labels:

- Target shape: `deki-json-command-runtime-target.puml`
- Runtime loop: `deki-json-command-loop-sequence.puml`
- Edge compatibility: `deki-json-command-runtime-edges.puml`

The Slice 2 implementation should primarily change the Rust Deki runtime under
`src-tauri/src/commands/storage/deki.rs` and focused sibling modules under
`src-tauri/src/commands/storage/deki/`. Keep the frontend response contract
stable unless the implementation exposes a missing optional field.

## Slice 2 Architecture Decisions

- `src-tauri/src/commands/storage/deki.rs` should become a thin command/runtime
  facade. It may parse the public request, wire `AppState`, call the loop
  coordinator, and return the final response. It should not own provider
  transport, prompt assembly, JSON protocol parsing, command dispatch, web
  research, action parsing, or budgeting.
- Provider access should go through a focused `deki/model_client.rs` adapter
  that sends plain chat messages through De-Koi's Rust LLM transport. The Slice
  2 runtime should not depend on `autoagents` or provider-native tool calls.
- Prompt text and request context assembly should live in `deki/prompt.rs`.
  Keep persona text, attachments, approved chat grants, approved web grants,
  repository guidance, and command-protocol instructions in one prompt owner.
- The bounded command loop should live in `deki/loop.rs`. It owns max rounds,
  wall-clock timeout checks, optional cancellation checks, internal trace
  collection, command result compaction, and stop-condition handling.
- Protocol parsing should live in `deki/protocol.rs`. It owns JSON frame
  extraction, fenced JSON stripping, multiple-frame rejection, visible
  `say`/`message`/`final` selection, and protocol-leak prevention.
- Context budgets should live in `deki/budget.rs`. All command results must pass
  through this owner before being fed back to the model.
- Commands should use a typed registry rather than a broad `serde_json::Value`
  switch. Prefer a `deki/commands/` module group with read-only handlers such as
  `code.rs` and `web.rs`; existing `library.rs` and `chat_access.rs` remain
  focused data owners and can be called through typed command adapters. The
  `commands/mod.rs` owner should own command names, typed argument conversion,
  and typed result conversion.
- Existing creative-library approval parsing should move toward a focused
  `deki/action_parser.rs` owner. Until it is split, the Slice 2 loop must treat
  `<deki_action>` blocks as final visible output, not as command protocol JSON.
- Existing web research is in scope for Slice 2 as a read-only command family
  only when a matching approved web research grant exists. Web commands must use
  the same consent, public URL, allowed-domain, timeout, and result-size
  constraints as the current main-branch behavior.
- Exact code edits, extension creation, custom-agent creation, raw shell, and
  app-data mutation are not JSON-runtime commands in Slice 2. Keep them disabled
  or routed through existing approval-card behavior until later approval slices
  deliberately reintroduce them.
- Workspace status routing must match the chosen runtime shape. If Slice 2 makes
  workspace status meaningful, add explicit embedded and remote routing for
  `deki_workspace_status`. Add `deki_workspace_abort` only with a real
  cancellation token or a clear `not_running`/`not_supported` result. Keep
  `approve`/`reject` as explicit Slice 3 not-implemented routes if the shared
  API remains callable.

## Default Runtime Budgets

Use named constants in `deki/budget.rs` so tests can assert them:

- Maximum command-loop rounds: 8.
- Maximum commands per round: 4.
- Maximum wall-clock runtime before controlled stop: 90 seconds.
- Maximum single command evidence fed to the next model turn: 12 KiB.
- Maximum total hidden command evidence retained for the next model turn: 48 KiB.
- Maximum internal trace text kept for future Slice 4 use: 64 KiB.
- Maximum web search results per command: 5.
- Maximum web pages read per turn: 2.
- Maximum extracted text per web page evidence item: 12 KiB.

When output is truncated, the command result must say what was truncated and how
to narrow the next command. Silent truncation is not acceptable.

## Slice 2 Acceptance Checklist

- Provider boundary: no Slice 2 code path should require
  `ensure_connection_supports_native_tools`; JSON runtime model calls go through
  `deki/model_client.rs`.
- Module split: `deki.rs` stays a facade. Prompt assembly, loop control,
  protocol parsing, budget enforcement, action parsing, command execution, web
  research, and status DTOs have focused owners.
- Typed commands: command input and output should use Rust structs/enums at the
  command boundary. Raw `serde_json::Value` should be limited to JSON protocol
  ingress/egress and returned storage payloads that are already JSON-shaped.
- Budgets: every command result passes through `deki/budget.rs` before it is fed
  back to the model. Tests should cover positive truncation and at least one
  should-not-truncate row.
- Web research: only exact approved queries and allowed public URLs are usable.
  Tests should cover rejected unapproved query, rejected disallowed/private URL,
  result/page caps, and timeout/error reporting.
- Protocol/action boundary: protocol JSON is parsed before final visible text is
  selected; `<deki_action>` is parsed only from that final visible text. The
  protocol parser must not inspect inside action blocks.
- Cancellation and runtime friction: loop control checks max rounds, max
  commands per round, wall-clock timeout, and abort state before executing each
  batch and before sending each follow-up model turn.
- Storage boundary: direct storage reads should stay inside focused library/chat
  modules. The loop and command registry should not learn collection internals.
- Workspace routing: if a shared API workspace method remains callable, its
  embedded Tauri command and remote `/api/invoke` dispatch must be explicit and
  behaviorally aligned. Unsupported approval routes must return deliberate
  Slice 3 not-implemented errors, not generic unsupported-command failures.
- Deferred write tools: exact source edits, extension creation, custom-agent
  creation, `deki_data` mutations, raw shell, and broad file writes are not
  Slice 2 JSON commands.
- Internal trace: collect bounded internal trace events for future Slice 4, but
  do not change the Slice 2 shell UI contract from final `content + action`.

## Boundary Rules

- Deki remains a shell feature under `src/features/shell/deki`.
- React UI calls `src/shared/api/deki-api.ts`; it must not call raw Tauri or raw
  remote runtime fetch.
- Engine contracts under `src/engine/deki` stay React-free and host-independent.
- Remote-capable commands must stay explicit in `remote-runtime.ts` and
  `http_dispatch.rs`.
- The Rust runtime owns privileged local reads, provider transport, repo path
  safety, storage access, and JSON protocol parsing.
- Slice 2 is read-only command execution. App-data dry-run approvals belong to
  Slice 3, and live trace streaming belongs to Slice 4.
- Slice 2 may collect bounded internal trace events so Slice 4 can render them
  later, but it should still return the current final-response `content +
  action` shape to the shell.
