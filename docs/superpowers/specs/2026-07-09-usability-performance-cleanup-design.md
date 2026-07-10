# Usability and Performance Cleanup Design

## Scope

This change resolves seven active De-Koi usability/performance reports and records that the eighth, love-toy control, is already absent. It covers conversation membership titles, Music Player guidance, character-card length visibility, diagnostics signal quality, Bot Browser request/image latency, and saved persona statuses.

## Design

### Conversation titles

Character membership and the derived default title are one update invariant. `useUpdateChat` will complete any character-membership mutation that omits `name` by loading the selected character names and deriving the mode-appropriate title. Explicit title writes remain authoritative. A pure engine helper owns title formatting so every caller receives the same behavior.

### Character length warnings

The setup wizard already receives character summary data containing the card fields used by the existing token estimator. A small inline badge will calculate the estimate and appear beside over-limit characters in selected and available rows for Conversation and Roleplay. The editor toast remains unchanged.

### Music Player copy

User-facing “YouTube-first” descriptions will become actionable instructions: generate a fresh pick from visible Music Player controls or activate the Music Player agent for automatic roleplay/game cues. Internal provider-neutral prompt language and compatibility identifiers remain unchanged.

### Health and Diagnostics

Optional unconfigured components and configured-but-unprobed providers are neutral, not warnings. Unknown/inactive items will not outrank confirmed healthy checks in the overall rollup. Genuine failed runtime, storage, provider probes, and configured sidecar failures remain warnings/errors with their existing explanations and actions.

### Bot Browser performance

Rust will reuse timeout-specific `reqwest::Client` instances so DNS, TLS, and connection pools survive across searches and thumbnails. The frontend image component will wait until a thumbnail approaches the viewport before resolving its proxy asset, preserving native lazy-loading intent and preventing an initial request storm. Resolved proxy assets will use a bounded shared cache so list/detail reuse does not refetch the same image.

### Saved persona statuses

Remove the bookmark menu, parsing/persistence callbacks, summary projection, create/update fields, import handling, TypeScript contract, and Rust typed-JSON declaration. Existing stored keys are left inert rather than running a destructive data migration.

### Love-toy control

No implementation exists. The parity ledger already documents haptic/Lovense control as intentionally removed, and repository search finds no routes, agents, UI, wrappers, commands, or dependencies. No change is made.

## Error handling and boundaries

Chat title completion stays in the catalog chat hook and calls the existing typed storage wrapper. Product formatting is React-free under `src/engine`. Bot Browser remains on its existing typed shared API/Tauri/HTTP pipeline. Search and thumbnail failures continue to surface existing retry/fallback UI. No silent success or cross-mode orchestration is added.

## Proof

Use red-green focused tests for title derivation/completion, token-warning presentation data, diagnostics rollups, Music Player copy, saved-status removal, Bot Browser image deferral/cache, and Rust HTTP client reuse. Run architecture, TypeScript, build, Rust, focused browser smoke tests, full `pnpm check`, workflow/PR health scripts, Bunny review, and GitHub CI before merge.
