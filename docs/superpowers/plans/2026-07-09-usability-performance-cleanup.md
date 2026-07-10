# Usability and Performance Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make conversation membership, card warnings, Music Player guidance, diagnostics, Bot Browser performance, and persona status controls behave clearly and quickly.

**Architecture:** Put deterministic title formatting in the React-free engine, enforce membership/title completion in the shared chat mutation hook, keep UI warnings local to setup pickers, and repair Bot Browser latency at both the Rust transport pool and frontend lazy-image boundary. Remove saved statuses across their complete contract surface without migrating inert historical keys.

**Tech Stack:** React 19, TypeScript 5.9, TanStack Query, Vitest/jsdom, Rust, Tauri, reqwest.

## Global Constraints

- Preserve explicit user-supplied chat names.
- Chat, roleplay, and game remain separate mode owners.
- Feature code uses focused shared API wrappers; no raw Tauri invoke or remote fetch is added.
- Optional diagnostics must not create warning/error attention states until a configured feature actually fails.
- Existing saved-status data is left inert; no destructive migration.

---

### Task 1: Conversation title invariant

**Files:**
- Create: `src/engine/entities/chat-title.ts`
- Create: `src/engine/entities/chat-title.spec.ts`
- Modify: `src/features/catalog/chats/hooks/use-chats.ts`
- Modify: `src/features/catalog/chats/hooks/use-chats.spec.tsx`

**Interfaces:**
- Produces: `deriveChatTitle(mode: string | null | undefined, names: readonly string[]): string`.
- Consumes: `storageApi.get/list/update` and existing chat cache mutation behavior.

- [ ] Write failing tests for zero/one/multiple names and for omitted-vs-explicit `name` during `characterIds` updates.
- [ ] Run the focused tests and confirm the missing helper/completion fails.
- [ ] Implement the pure helper and make the mutation load selected character names only when `name` is omitted.
- [ ] Re-run the focused tests and typecheck.
- [ ] Commit the coherent title fix.

### Task 2: Character token warnings and Music Player instructions

**Files:**
- Modify: `src/features/catalog/lib/card-token-recommendation.ts`
- Modify: `src/features/catalog/lib/card-token-recommendation.spec.ts`
- Modify: `src/features/modes/shared/chat-ui/components/ChatSetupWizard.tsx`
- Modify: `src/features/shell/plugins/lib/core-module-registry.ts`
- Modify: `src/features/shell/plugins/lib/core-module-registry.spec.ts`
- Modify: `src/features/shell/discovery/discovery-entries.json`
- Modify: `src/features/modes/shared/chat-ui/components/ChatSettingsDrawer.tsx`
- Modify: `src/features/modes/game/components/GameSetupWizard.tsx`

**Interfaces:**
- Produces: an inline recommendation model from the existing character token estimator and actionable Music Player copy.

- [ ] Add failing recommendation/copy tests.
- [ ] Confirm tests fail on missing badge data and old “YouTube-first” copy.
- [ ] Render the badge in Conversation and Roleplay selected/available rows and replace user-facing copy.
- [ ] Re-run focused tests and typecheck.
- [ ] Commit the UI guidance change.

### Task 3: Useful diagnostics statuses

**Files:**
- Modify: `src/features/shell/diagnostics/lib/diagnostics-model.ts`
- Modify: `src/features/shell/diagnostics/lib/diagnostics-model.spec.ts`
- Modify: `src/features/shell/diagnostics/hooks/use-diagnostics-snapshot.ts`
- Modify: `src/features/shell/diagnostics/hooks/use-diagnostics-snapshot.spec.ts`
- Modify: `src/features/shell/diagnostics/components/HealthDiagnosticsSettings.spec.tsx`

**Interfaces:**
- Produces: overall rollups where neutral unknown items do not outrank confirmed health; optional/unprobed items use `unknown`.

- [ ] Add failing tests for healthy runtime plus neutral optional checks and for genuine failures.
- [ ] Confirm the current rollup reports false attention.
- [ ] Reclassify optional/unprobed states and adjust rollup ranking while preserving real failures.
- [ ] Re-run diagnostics tests and typecheck.
- [ ] Commit the diagnostics signal fix.

### Task 4: Bot Browser request and thumbnail latency

**Files:**
- Create: `src/features/shell/bot-browser/lib/asset-image-cache.ts`
- Create: `src/features/shell/bot-browser/lib/asset-image-cache.spec.ts`
- Modify: `src/features/shell/bot-browser/components/BotBrowserView.tsx`
- Modify: `src-tauri/src/commands/storage/bot_browser.rs`

**Interfaces:**
- Produces: bounded deduplicated asset-resolution cache; viewport-gated `BotBrowserAssetImage`; cached reqwest clients for 15/30/60-second timeout buckets.

- [ ] Add failing frontend cache tests and a Rust test for the shared client registry.
- [ ] Confirm missing cache/registry failures.
- [ ] Implement bounded asset promise caching, IntersectionObserver gating, and timeout-specific shared clients.
- [ ] Re-run focused Vitest and Rust tests, then cargo check.
- [ ] Commit the performance fix.

### Task 5: Remove saved persona statuses

**Files:**
- Modify: `src/features/modes/conversation/components/ConversationInput.tsx`
- Modify: `src/features/modes/conversation/components/ConversationInput.spec.tsx`
- Modify: `src/features/catalog/personas/hooks/use-personas.ts`
- Modify: `src/features/catalog/personas/components/modals/ImportPersonaModal.tsx`
- Modify: `src/engine/contracts/types/persona.ts`
- Modify: `src-tauri/src/commands/storage/contracts.rs`

**Interfaces:**
- Removes: `savedStatusOptions` UI and typed persistence/import support.

- [ ] Add/update a component test asserting no saved-status control or menu.
- [ ] Confirm it fails against the current bookmark feature.
- [ ] Delete UI state, callbacks, field projections/mutations/import mapping, and contracts.
- [ ] Re-run focused tests, typecheck, architecture, and cargo check.
- [ ] Commit the removal.

### Task 6: Live proof and shipping

**Files:**
- Modify only if proof finds an in-scope defect.

**Interfaces:**
- Consumes: built app, repo health scripts, GitHub Actions, Bunny review.

- [ ] Run focused tests, `pnpm check:architecture`, `pnpm typecheck`, `pnpm build`, `cargo check --manifest-path src-tauri/Cargo.toml`, and `pnpm check`.
- [ ] Launch the app and verify setup warnings/titles, neutral diagnostics, Music Player guidance, absent saved statuses, and Bot Browser loading behavior in the in-app browser.
- [ ] Confirm no love-toy implementation through source/dependency search and the parity ledger.
- [ ] Run workflow health and Bunny; fix and repeat any in-scope findings.
- [ ] Inspect branch/remotes/diff, push only to `origin`, open a draft PR with unchecked human validation boxes, wait for CI, mark ready, merge to `main`, and verify the merge.

