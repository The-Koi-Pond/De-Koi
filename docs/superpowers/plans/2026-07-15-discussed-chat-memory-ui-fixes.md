# Discussed Chat, Memory, and UI Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve De-Koi issues #1032-#1037 with durable fixes for transcript following, mobile message actions, vision-model routing, automatic-memory feedback, import/export icon direction, and New Chat launch routing.

**Architecture:** Keep transcript and message interactions in mode/shared UI owners, store the optional vision connection in chat metadata and resolve it in the React-free generation owner, keep memory-capture records authoritative at the Rust storage boundary while presenting them through shell/shared UI, and keep the setup journey owned by the shell rather than duplicating launch behavior per mode.

**Tech Stack:** React 19, TypeScript 5.9, Zustand, TanStack Query, Vitest/jsdom, Tauri 2, Rust, pnpm.

## Global Constraints

- GitHub issues #1032-#1037 are the approved requirements authority.
- Conversation, Roleplay, and Game remain separate mode owners; shared UI receives mode-neutral state only.
- No feature code imports raw Tauri or remote-runtime transports.
- Every production change follows a focused failing test first.
- Import/export changes alter only controls explicitly labelled Import or Export.
- Memory content appears only in in-app UI, never in operating-system notification copy.
- Shipping requires focused tests, `pnpm typecheck`, `pnpm check:architecture`, `pnpm build`, `pnpm check`, Bunny, CI, and merge to `main` only after clean gates.

---

### Task 1: Re-engage transcript following for a new turn (#1034)

**Files:**
- Modify/Test: `src/features/modes/shared/chat-ui/lib/transcript-scroll-geometry.ts`
- Modify/Test: `src/features/modes/shared/chat-ui/lib/transcript-scroll-geometry.spec.ts`
- Modify/Test: `src/features/modes/conversation/components/ConversationView.tsx`
- Modify/Test: `src/features/modes/roleplay/hooks/use-roleplay-transcript-scroll.ts`

**Interfaces:**
- Consumes: optimistic user-tail state, explicit bottom requests, and current-generation scroll-away state.
- Produces: a new outbound turn clears an idle reading-position latch, while an upward gesture during the active generation still disables bottom following.

- [ ] Add focused tests proving optimistic/explicit new-turn following wins over a stale idle latch and active-stream scroll-away still wins afterward.
- [ ] Run `pnpm vitest run src/features/modes/shared/chat-ui/lib/transcript-scroll-geometry.spec.ts`; expect the new-turn assertion to fail.
- [ ] Implement the minimal shared decision/call-site ordering correction and clear the Conversation transcript window before following the new optimistic tail.
- [ ] Re-run the focused geometry and affected Conversation/Roleplay tests; expect pass.
- [ ] Commit with subject `Restore new-turn transcript following`.

### Task 2: Restore tap-scoped mobile message actions (#1035)

**Files:**
- Modify/Test: `src/styles/globals/07-responsive-accessibility.css`
- Modify/Test: `src/features/shell/action-visibility-contract.spec.ts`
- Modify/Test: `src/features/modes/conversation/components/ConversationMessage.spec.tsx`

**Interfaces:**
- Consumes: `ConversationMessage`'s existing tapped/hovered/focused `showActions` state.
- Produces: coarse pointers no longer force every message toolbar visible; tapped and keyboard-focused messages remain accessible.

- [ ] Replace the blanket coarse-pointer test with a failing contract that excludes message action groups and add a focused tap-state component assertion.
- [ ] Run the two focused specs; expect failure against the blanket CSS rule.
- [ ] Scope the coarse-pointer override to non-message action groups, leaving the existing component visibility classes authoritative for messages.
- [ ] Re-run the focused specs; expect pass.
- [ ] Commit with subject `Restore mobile message action visibility`.

### Task 3: Route image turns through an optional vision connection (#1032)

**Files:**
- Modify/Test: `src/engine/generation/start-generation.image-attachments.spec.ts`
- Modify: `src/engine/generation/start-generation.ts`
- Modify: `src/engine/contracts/types/chat.ts`
- Modify/Test: `src/features/modes/shared/chat-ui/components/settings/ChatBasicSettingsSections.tsx`
- Modify/Test: `src/features/modes/shared/chat-ui/components/ChatSettingsDrawer.tsx`
- Modify/Test: `src/features/catalog/chat-presets/hooks/use-chat-presets.ts`

**Interfaces:**
- Consumes: `chat.metadata.visionConnectionId`, current-turn image attachments, and language-generation connections.
- Produces: text-only turns retain the normal connection; image-bearing main requests use the configured vision connection; missing/invalid overrides preserve explicit warnings instead of silent fallback.

- [ ] Add a failing engine test with primary `conn-text`, override `conn-vision`, and an image attachment; assert the final request uses `conn-vision` while a text-only turn uses `conn-text`.
- [ ] Add focused UI/preset tests proving the selector excludes image-generation providers and persists through chat preset metadata.
- [ ] Run the focused tests; expect the routing and selector assertions to fail.
- [ ] Add the metadata field, selector/help copy, and engine-level effective-main-connection resolution without changing agent image-generation connections.
- [ ] Re-run focused engine/UI/preset tests plus `pnpm check:architecture`; expect pass.
- [ ] Commit with subject `Add vision connection routing for attachments`.

### Task 4: Show exact automatic-memory capture details (#1033)

**Files:**
- Modify/Test: `src-tauri/src/commands/storage/chat_memory.rs`
- Modify/Test: `src/engine/generation/automatic-memory-capture-queue.ts`
- Modify/Test: `src/engine/generation/automatic-memory-capture-queue.spec.ts`
- Modify: `src/engine/contracts/types/chat.ts`
- Modify/Test: `src/features/modes/shared/chat-ui/components/MessageMemoryIndicators.tsx`
- Create/Test: `src/features/shell/notifications/components/AutomaticMemoryCaptureNotifications.tsx`
- Modify: `src/features/shell/notifications/shell.ts`
- Modify/Test: `src/shared/stores/ui/model.ts`
- Modify/Test: `src/shared/stores/ui.store.ts`
- Modify/Test: `src/shared/stores/ui/persistence.ts`
- Modify/Test: `src/features/shell/settings/components/settings/SettingControls.tsx`
- Modify/Test: `src/app/shell/AppShell.tsx`

**Interfaces:**
- Produces: focused memory refresh returns the affected exact record and created/updated operation; the queue persists that detail on the assistant message and emits an in-process completion event; shell UI shows a default-on in-app toast; the remembered chip reopens exact details.

- [ ] Add failing Rust coverage for the focused capture result and failing queue/UI/store tests for persisted details, default-on preference, opt-out, and chip disclosure.
- [ ] Run the narrow Cargo/Vitest tests; expect the new result/detail assertions to fail.
- [ ] Extend the focused refresh result without exposing embeddings in UI detail, persist exact content/IDs/operation, add the engine subscription seam, and render the in-app notification plus remembered popover.
- [ ] Add the persisted `automaticMemoryCaptureNotifications` toggle under Notifications; do not call native notification APIs with memory content.
- [ ] Re-run focused tests, Cargo checks, architecture checks, and relevant message tests; expect pass.
- [ ] Commit with subject `Show automatic memory capture details`.

### Task 5: Standardize Import and Export icons (#1036)

**Files:**
- Create/Test: `src/features/shell/imports/lib/import-export-icon-contract.spec.ts`
- Modify: all user-facing controls explicitly labelled Import or Export found by the source audit, including Memory Console, Chat Preset bar, Chat Files drawer, catalog panels, and Agent editor.

**Interfaces:**
- Produces: Import uses `Download` (data enters De-Koi) and Export uses `Upload` (data leaves De-Koi); ordinary file download/upload controls are unchanged.

- [ ] Add a failing source contract enumerating every labelled Import/Export control and its expected icon.
- [ ] Run the focused contract; expect inconsistent surfaces to fail.
- [ ] Swap only mismatched labelled actions and keep accessible names/tooltips intact.
- [ ] Re-run the contract and affected component tests; expect pass.
- [ ] Commit with subject `Standardize import and export icons`.

### Task 6: Keep the setup journey reachable from active routes (#1037)

**Files:**
- Modify/Test: `src/app/shell/AppShell.tsx`
- Modify/Test: `src/app/shell/app-shell-center-surfaces.spec.ts`
- Modify/Test: `src/features/modes/router/components/ModeSurface.tsx`
- Modify/Test: `src/features/modes/router/components/ModeHomeSurface.tsx`

**Interfaces:**
- Consumes: shell setup intent and current active/detail surface.
- Produces: exactly one `SetupReadinessJourney` consumer remains mounted whether Home, a detail surface, or an active Conversation/Roleplay/Game route occupies the center.

- [ ] Add a failing shell integration/static contract proving the readiness host is outside the Home-only `ModeSurface` branch and remains singular.
- [ ] Run the focused shell/router tests; expect failure against the Home-only prop path.
- [ ] Move journey ownership to the shell and present non-ready UI as a center overlay without adding mode-specific launch logic.
- [ ] Re-run shell/router/onboarding launch tests; expect pass and no duplicate launches.
- [ ] Commit with subject `Keep New Chat setup reachable from active chats`.

### Task 7: Shipping

**Files:** all intended files from Tasks 1-6 only.

- [ ] Fetch/rebase onto current `origin/main`, rerun focused tests, `pnpm typecheck`, `pnpm check:architecture`, `pnpm build`, Rust checks, and `pnpm check`.
- [ ] Run `git diff --check origin/main...HEAD`, inspect commits/files, and verify no unrelated worktree changes.
- [ ] Run Bunny; fix every blocking in-scope finding and repeat its proof.
- [ ] Push only to `origin`, open a draft PR targeting `main`, link #1032-#1037, and leave human validation checkboxes unchecked.
- [ ] Run Bunny after the push, wait for clean CI, mark ready, merge, and verify `origin/main` contains the merge commit.
