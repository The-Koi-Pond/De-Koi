# Reported Runtime and Chat Issues Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve issues #975-#983 with durable fixes for connection discovery/model metadata, updates, runtime compatibility, conversation message stability, transcript scrolling, setup completion, and measurable Pi performance diagnostics.

**Architecture:** Keep connection behavior in the shell connection feature, runtime compatibility in typed shared API/Rust dispatch contracts, and Conversation behavior in chat-owned hooks plus mode-neutral shared UI. Add pure owner helpers where component state transitions need focused tests; do not add compatibility catches or cross-mode orchestration.

**Tech Stack:** React 19, TypeScript 5.9, TanStack Query, Vitest/jsdom, Tauri 2, Rust, pnpm.

## Global Constraints

- Product behavior remains in `src/engine`; React UI remains in `src/features`; runtime wrappers remain in `src/shared/api`; privileged behavior remains in `src-tauri`.
- Conversation, Roleplay, and Game remain separate mode owners.
- Every production change follows a failing focused test first.
- Shipping requires `pnpm check`, Rust validation for Rust changes, Bunny, CI, and merge into `main` only after clean gates.

---

### Task 1: Connection defaults and model metadata (#975, #978, #979)

**Files:**
- Create: `src/features/shell/connections/lib/connection-model-selection.ts`
- Test: `src/features/shell/connections/lib/connection-model-selection.spec.ts`
- Modify: `src/features/shell/connections/components/ConnectionEditor.tsx`
- Modify: `src/features/shell/connections/components/ConnectionsPanel.tsx`

**Interfaces:**
- Produces: `normalizeModelMetadata(model): { context: number | null; maxOutput: number | null }` and `nextModelLimits(current, model)`.
- Consumes: provider model IDs and optional remote metadata already owned by `ConnectionEditor`.

- [ ] Write tests proving missing metadata stays `null`, known zero is not displayed as a real limit, and selecting a new model clears stale prior limits.
- [ ] Run `pnpm vitest run src/features/shell/connections/lib/connection-model-selection.spec.ts`; expect failures because the helper does not exist.
- [ ] Implement the helper, wire model selection/search to independent state, and add an explicit “Set default” action/current-default affordance in the list.
- [ ] Re-run the focused test and connection component tests; expect pass.
- [ ] Commit only the connection files with subject `Clarify connection defaults and model limits`.

### Task 2: Update workflow and runtime compatibility (#976, #977)

**Files:**
- Modify/Test: `src/shared/api/updates-api.ts` and adjacent spec
- Modify/Test: `src/shared/api/remote-runtime.ts` and adjacent spec
- Modify/Test: `src-tauri/src/commands/storage/updates.rs`
- Modify/Test: `src-tauri/src/http_dispatch.rs`
- Modify/Test: `src/features/shell/settings/components/settings/SettingsSurfaces.tsx`

**Interfaces:**
- Consumes: `update_check`, `update_apply`, runtime health/version information, and storage collection allowlists.
- Produces: visible update outcomes and an explicit incompatible-runtime error/action instead of an unsupported-entity toast.

- [ ] Add failing TS/Rust tests for browser update handoff and newer-SPA/older-runtime compatibility detection.
- [ ] Run the narrow Vitest and Cargo tests; expect the asserted visible/typed outcomes to fail.
- [ ] Implement the smallest contract-level changes and user-facing remediation copy without retry or silent fallback.
- [ ] Re-run focused tests, `pnpm check:architecture`, and `cargo check --manifest-path src-tauri/Cargo.toml`; expect pass.
- [ ] Commit the runtime files with subject `Harden updates and runtime compatibility`.

### Task 3: Conversation persistence and setup (#980, #982)

**Files:**
- Modify/Test: `src/features/catalog/chats/hooks/use-create-message.spec.ts`
- Modify: `src/features/catalog/chats/hooks/use-chats.ts`
- Create/Test: `src/features/modes/shared/chat-ui/lib/chat-setup-start.spec.ts`
- Create: `src/features/modes/shared/chat-ui/lib/chat-setup-start.ts`
- Modify: `src/features/modes/shared/chat-ui/components/ChatSetupWizard.tsx`

**Interfaces:**
- Produces: stable optimistic-to-saved message replacement during streaming and `startChatSetup(input): Promise<Result>` with visible errors.
- Consumes: chat-owned mutation/cache keys, metadata mutation, schedule generation callback, and `onFinish`.

- [ ] Add a failing cache test reproducing a streamed user row being dropped by replacement/refetch ordering and a failing setup test for rejected metadata persistence.
- [ ] Run both focused tests; expect the message continuity/error assertions to fail.
- [ ] Fix the cache transition at the chat hook owner and route setup through a tested async result with toast feedback and click re-entry protection.
- [ ] Re-run focused tests plus Conversation component tests; expect pass and no Roleplay/Game changes.
- [ ] Commit with subject `Keep conversation sends and setup stable`.

### Task 4: Firefox transcript history (#981)

**Files:**
- Modify/Test: `src/features/modes/shared/chat-ui/lib/transcript-scroll-geometry.ts`
- Modify/Test: `src/features/modes/shared/chat-ui/lib/transcript-scroll-geometry.spec.ts`
- Modify the transcript owner component identified by call-site tracing.

**Interfaces:**
- Produces: anchor-preserving upward pagination that does not let streaming bottom-follow overwrite explicit user scroll-away.

- [ ] Add a failing Firefox-shaped geometry test using fractional scroll values and prepend height growth.
- [ ] Run the focused geometry test; expect the anchor assertion to fail.
- [ ] Implement the minimal geometry/call-site correction and keep the helper mode-neutral.
- [ ] Re-run geometry and transcript component tests; expect pass.
- [ ] Commit with subject `Preserve Firefox transcript history scrolling`.

### Task 5: Pi performance evidence (#983)

**Files:**
- Modify/Test only the runtime timing/diagnostics owner proven by baseline tracing; do not change generation behavior without a demonstrated De-Koi bottleneck.

**Interfaces:**
- Produces: timings separating prompt preparation, request dispatch, first token, and completion where current instrumentation cannot distinguish them.

- [ ] Establish a local representative baseline and inspect existing timing fields.
- [ ] If an owned bottleneck is reproduced, add a failing focused benchmark/test; otherwise add no production optimization and document the hardware measurement blocker on #983.
- [ ] Implement only the proven correction or diagnostic contract.
- [ ] Run its focused proof and matching Rust/TS checks.
- [ ] Commit any justified change with subject `Expose generation latency phases`.

### Task 6: Shipping

**Files:** all intended files from Tasks 1-5 only.

- [ ] Run focused tests, `pnpm typecheck`, `pnpm check:architecture`, `cargo check --manifest-path src-tauri/Cargo.toml` when applicable, and `pnpm check`.
- [ ] Run `git diff --check origin/main...HEAD` and inspect commits/files for scope.
- [ ] Run Bunny; fix any blocking finding and repeat verification.
- [ ] Push only to `origin`, open a draft PR targeting `main`, and include issue links plus honest manual gaps.
- [ ] Run Bunny after the push, wait for CI, mark ready only when clean, merge, and verify `main` contains the merge.
