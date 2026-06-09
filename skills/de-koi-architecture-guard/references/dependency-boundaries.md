# Dependency Boundaries

Use this reference when deciding where a fix belongs or whether an import is valid.

## Import Direction

Allowed:

- Layered UI feature direction is `shell -> modes -> runtime -> catalog`.
- Same-layer feature packages import each other only through public owner APIs.
- Cross-package feature imports use curated public entry files such as `index.ts`, `shell.ts`, `query-keys.ts`, and `types.ts`.
- UI features import `src/shared`, `src/shared/api`, contracts, engine entrypoints, and feature public APIs.
- Engine higher layers import engine lower layers.
- Engine repositories import capability ports.
- Engine services receive capability ports from `src/engine/capabilities`; feature/runtime adapters bind those ports to `src/shared/api` wrappers.
- `shared/api` imports Tauri invoke/listen helpers, remote-runtime HTTP helpers, and contract DTOs.
- Rust command modules import Rust capability crates.
- Hostable runtime routes call the same focused Rust modules as embedded Tauri commands through an explicit allowlist/dispatch layer.

Forbidden:

- `src/engine/**` importing React, Zustand stores, `@tauri-apps/api`, or `src/features/**`.
- `src/engine/**` importing concrete `src/shared/api/**` adapters.
- `engine/modes/chat` importing `engine/modes/roleplay` or `engine/modes/game`.
- `engine/modes/roleplay` importing `engine/modes/chat` or `engine/modes/game`.
- `engine/modes/game` importing `engine/modes/chat` or `engine/modes/roleplay`.
- `src/shared/**` importing `src/features/**`.
- `features/catalog/**` importing `features/runtime/**`, `features/modes/**`, or `features/shell/**`.
- `features/runtime/**` importing `features/modes/**` or `features/shell/**`.
- `features/modes/**` importing `features/shell/**`.
- Concrete feature modes importing each other directly: `features/modes/conversation`, `features/modes/roleplay`, and `features/modes/game` are composed only by `features/modes/router`.
- `features/modes/shared/**` importing concrete mode packages.
- Feature code importing another package's private `components`, `hooks`, `stores`, `state`, `lib`, `api`, or `encounter` folders.
- New or touched feature code importing `src/shared/api/tauri-client` or `@tauri-apps/api` directly instead of a focused shared API wrapper.
- Feature, engine, or mode code calling the hostable Rust server with raw `fetch` instead of routing through `src/shared/api`.
- Rust capability crates depending on TypeScript product concepts beyond opaque DTOs.

## Placement Questions

Ask these before adding a file:

1. Does it render UI? Put it in `features` or `shared/components`.
2. Does it coordinate shell-level UI workflows? Put it in `features/shell`.
3. Does it coordinate concrete mode UI? Put it in `features/modes/<mode>` or `features/modes/router`.
4. Is it shared mode UI? Put it in `features/modes/shared`.
5. Is it a shared runtime system used by modes or shell? Put it in `features/runtime`.
6. Is it resource data, query keys, or library editing? Put it in `features/catalog`.
7. Does it coordinate product behavior? Put it in `engine`, usually a mode or generation layer.
8. Does it perform privileged local work? Put it in Rust and expose a narrow command.
9. Does it only define what TS needs from Rust? Put it in `engine/capabilities`.
10. Is it a runtime wrapper for embedded Tauri or hostable HTTP? Put it in `shared/api`.
11. Is it pure and reused by multiple modes? Put it in `engine/shared`, `engine/entities`, or `engine/generation-core`.
12. Is it capability implementation glue for an engine service? Keep the port in `engine/capabilities` and the concrete shared API-backed implementation at the feature/app edge.
13. Is it a remote-capable Rust command? Reuse the focused Rust implementation, add an explicit `http_dispatch.rs` handler, and add the command to `remote-runtime.ts` only after checking the JSON/SSE HTTP contract.

## File Splitting

Split when a file mixes any two of these without a strong reason:

- UI rendering
- storage persistence
- provider transport
- prompt assembly
- mode orchestration
- agent execution
- Tauri command registration
- filesystem/path safety
- import/export parsing

Prefer one module per responsibility. A large owner module can expose a small public function while implementation details live in sibling files.

## Barrels And Re-exports

Avoid barrels whose only purpose is convenience or legacy compatibility. If a public API is needed, create an owner file that contains real behavior, types, or a curated facade. Public feature entrypoints should make ownership clear: `index.ts` for public hooks/components/APIs, `shell.ts` for app-shell composition surfaces, `query-keys.ts` for TanStack keys, and `types.ts` for shared DTO/view-model types.
