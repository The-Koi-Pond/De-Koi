---
name: de-koi-architecture-guard
description: "Protect De-Koi's layered Tauri and hostable Rust runtime architecture, module ownership, dependency direction, explicit imports, Rust capability boundaries, shared-code placement, HTTP pipeline, and file-splitting discipline. Use when changing folders, imports, shared modules, TypeScript engine layers, Tauri/HTTP command wrappers, Rust capability crates, repositories, adapters, feature APIs, or any code structure that could widen impact area."
---

# De-Koi Architecture Guard

## Overview

Use this skill to keep De-Koi readable and modular while changing code. The goal is to build with stable bricks: small owner modules, explicit contracts, narrow adapters, and visible dependency direction.

## Load First

Read these references only when needed:

- `references/repo-layout.md` for the current architecture map and owner paths.
- `references/dependency-boundaries.md` for import direction and placement decisions.
- `docs/uml/Refactor` for PlantUML architecture diagrams about refactor-era boundaries, current hotspots, and architecture decision context.

Also keep the root `AGENTS.md` in force.

## Workflow

1. Name the owner before editing: UI feature, TypeScript engine layer, shared API runtime adapter, embedded Tauri command, hostable HTTP dispatch, or Rust capability.
2. List imports the changed module may use. If an import crosses a boundary, redesign before patching.
3. Keep behavior in its owner. Move reusable logic down to a lower layer instead of sideways into another mode or feature.
4. If engine code needs storage, LLM, assets, or integrations, pass a port from `src/engine/capabilities`; implement that port at the feature/app edge with `src/shared/api` wrappers.
5. Prefer direct owner imports over barrels or compatibility shims.
6. Split large mixed files when adding behavior would make the file broader.
7. If the behavior is remote-capable, route it through the explicit HTTP pipeline: typed shared API wrapper -> `tauri-client.ts` / `remote-runtime.ts` allowlist -> `/api/invoke` or a dedicated `http_server.rs` route -> explicit `http_dispatch.rs` handler -> focused Rust module.
8. Update docs or skill references when a durable architecture decision changes.
9. Report the impact area and dependent areas reviewed.

## Placement Rules

- Product rules live in `src/engine`, not Rust and not React components.
- React feature code lives in layered packages under `src/features/<layer>/<package>` and calls hooks, feature APIs, or shared API adapters through public entrypoints.
- Generic UI and browser-only utilities live in `src/shared`.
- Runtime wrappers live in `src/shared/api`; they may call embedded Tauri invoke or the configured hostable Rust HTTP runtime.
- New or touched feature code should call typed wrappers in `src/shared/api`, not import `invokeTauri` from `tauri-client.ts` directly.
- Remote-capable command names must be explicitly allowlisted in `src/shared/api/remote-runtime.ts` and explicitly handled in `src-tauri/src/http_dispatch.rs`.
- Use `src-tauri/src/http_server.rs` for dedicated HTTP routes such as streaming SSE; keep JSON command reuse behind `http_dispatch.rs`.
- Privileged local IO, storage, secrets, provider transport, and native integrations live in Rust.
- Mode-neutral deterministic helpers live below modes in `engine/shared`, `engine/entities`, or `engine/generation-core`.

## Stop Conditions

Pause and re-evaluate if the change requires a feature-level generic router, a broad catch-all helper, cross-mode imports, direct Tauri or HTTP calls from engine code, React imports from engine code, a feature-level raw `invokeTauri` call, or a new fallback branch for old runtime shapes. Those are architecture smells in this repo.

The hostable runtime's `/api/invoke` dispatch is the boundary exception. It must stay explicit, allowlisted, and backed by the same focused Rust capability modules as the embedded Tauri commands.
