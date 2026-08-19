# Feature-Preserving Performance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement every still-relevant optimization from the performance audit without removing De-Koi behavior.

**Architecture:** Tighten existing owner boundaries instead of adding caches or duplicate representations. Storage-facing work stays in `src/shared/api`, engine activity state stays in `src/engine/modes/chat/autonomous`, React lazy composition stays in the owning UI surface, and performance policy stays in repository tooling.

**Tech Stack:** React 19, TypeScript 5.9, TanStack Query, Vite/Rollup, Vitest, Lighthouse CI.

## Global Constraints

- Preserve all existing user-visible features and persisted export/history formats.
- Do not touch the dirty primary checkout.
- Use focused public owner APIs and pass `pnpm check:architecture`.
- Write and witness a focused failing test before each production behavior change.
- Do not commit, push, or open a PR without explicit shipping authorization.

---

### Task 1: Remove optional engines from eager chat-shell imports

**Files:**

- Create: `src/engine/modes/chat/autonomous/activity-state.ts`
- Create: `src/engine/modes/chat/autonomous/activity-state.spec.ts`
- Create: `src/features/catalog/chats/hooks/use-export-chat.ts`
- Modify: `src/engine/modes/chat/autonomous/autonomous.service.ts`
- Modify: `src/features/catalog/chats/hooks/use-chat-lifecycle.ts`
- Modify: `src/features/catalog/chats/hooks/use-chats.ts`
- Modify: `src/features/catalog/chats/index.ts`
- Modify: `src/app/boot-shell-boundary.spec.ts`

**Interfaces:**

- Produces: `getChatActivityState`, `setChatActivityState`, `hasChatActivityState`, and `clearChatActivity` sharing one module-local map.
- Produces: `useExportChat` with the existing mutation input/result behavior.

- [x] Add boundary and activity-state tests that fail while lifecycle imports `autonomous.service` and transcript export remains in `use-chats.ts`.
- [x] Run `pnpm vitest run src/app/boot-shell-boundary.spec.ts src/engine/modes/chat/autonomous/activity-state.spec.ts` and confirm the expected failures.
- [x] Extract the registry and export hook, then update owner imports and re-exports without changing callers.
- [x] Run the focused tests plus `use-chat-lifecycle.spec.ts` and autonomous service specs until green.

### Task 2: Bound Deki history hydration to affected sessions

**Files:**

- Modify: `src/shared/api/deki-api.ts`
- Modify: `src/shared/api/deki-api.spec.ts`

**Interfaces:**

- Consumes: existing `readSessionsState(hydrateSessionId)` and incremental persistence planner.
- Produces: unchanged `dekiApi.sessions` and `dekiApi.history` public contracts with narrower storage reads.

- [x] Add failing tests proving create/select/reset read no message partitions; targeted history mutations read only their requested partition; deletion reads only selected partitions.
- [x] Run `pnpm vitest run src/shared/api/deki-api.spec.ts` and confirm failures identify unrelated message hydration.
- [x] Use summary-only reads for session metadata operations, target-session reads for history operations, and selected-session hydration for deletion.
- [x] Re-run `deki-api.spec.ts`, `deki-api.test.ts`, and `deki-history-persistence.spec.ts` until green.

### Task 3: Defer conditional Game panels

**Files:**

- Modify: `src/features/modes/game/components/GameSurface.tsx`
- Create: `src/features/modes/game/components/game-surface-lazy-boundary.spec.ts`

**Interfaces:**

- Produces: unchanged Game component props and UI behavior through React lazy boundaries.

- [x] Add a source-boundary test requiring dynamic imports for `GameSetupWizard`, `GameCharacterSheet`, and `GameWidgetPanel`, and forbidding their static value imports.
- [x] Run the focused test and confirm it fails on current static imports.
- [x] Add named-export lazy loaders, render the widget preparation modal only while open, and wrap conditional renders with existing-style Suspense fallbacks.
- [x] Run the focused test and nearby Game component tests until green.

### Task 4: Bound bulk-export reads

**Files:**

- Create: `src/features/catalog/chats/lib/chat-export-loader.ts`
- Create: `src/features/catalog/chats/lib/chat-export-loader.spec.ts`
- Modify: `src/features/catalog/chats/hooks/use-bulk-export-chats.ts`

**Interfaces:**

- Produces: `listChatIdsForExport(storage)` using `{ fields: ["id"] }`.
- Produces: `loadChatsForExport(storage, chatIds, concurrency?)` preserving deduplicated input order with a default concurrency of four.

- [x] Add failing tests for ID projection, stable ordering, missing-chat rejection, and a maximum of four simultaneous chat loads.
- [x] Run `pnpm vitest run src/features/catalog/chats/lib/chat-export-loader.spec.ts` and confirm the module is missing.
- [x] Implement the bounded worker loader and route the hook through it without changing formats or UI feedback.
- [x] Re-run loader and transcript-export tests until green.

### Task 5: Strengthen performance gates

**Files:**

- Modify: `lighthouserc.cjs`
- Create: `scripts/lighthouse-config.test.mjs`

**Interfaces:**

- Produces: three-run desktop Lighthouse sampling with blocking performance/script/stylesheet assertions.

- [x] Add a failing config test for three runs and error-level performance/resource assertions.
- [x] Run `node --test scripts/lighthouse-config.test.mjs` and confirm failure.
- [x] Update only the performance sampling and assertion severity.
- [x] Re-run the config test and existing bundle-budget test until green.

### Task 6: Verify the integrated result

**Files:**

- Review all files changed by Tasks 1-5.

**Interfaces:**

- Consumes: every unchanged public API above.
- Produces: evidence that the integrated branch builds and respects architecture/bundle budgets.

- [x] Run all focused tests from Tasks 1-5 in one command.
- [x] Run `pnpm check:architecture`.
- [x] Run `pnpm typecheck`.
- [x] Run `pnpm build` and compare AppExperience/Game chunk output with the recorded baseline.
- [x] Run `pnpm perf:size`.
- [x] Inspect `git diff --check`, `git status --short`, and the final diff for unrelated changes.
