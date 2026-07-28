# Mobile Pending Message Stability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep a newly sent user message continuously visible while its character response generates.

**Architecture:** Coordinate the existing optimistic cache write with React Query by cancelling the exact chat-messages query first. Preserve the existing engine save and stream-event contracts.

**Tech Stack:** TypeScript, React Query, Vitest.

## Global Constraints

- Keep the fix in `src/features/runtime/generation`.
- Do not change storage, remote-runtime, Rust, or mode orchestration contracts.
- Preserve regenerate and impersonate behavior.
- Do not commit, push, or create a PR without separate authorization.

---

### Task 1: Protect the optimistic user row from stale message queries

**Files:**

- Modify: `src/features/runtime/generation/hooks/use-generate.ts`
- Test: `src/features/runtime/generation/hooks/use-generate.spec.ts`

**Interfaces:**

- Consumes: `runGenerationWithUi(queryClient, args, streamFactory, options)`
- Produces: the same `Promise<boolean>` contract with stale chat-message queries cancelled before optimistic insertion.

- [x] **Step 1: Write the failing regression test**

Add a test under `describe("runGenerationWithUi")` that starts a controlled `fetchInfiniteQuery` for `chatKeys.messages(chatId)`, starts `runGenerationWithUi` with `userMessage: "Still here"`, confirms the optimistic row is present, resolves the stale query, and expects the row to remain while the stream is blocked.

- [x] **Step 2: Run the test to verify it fails**

Run:

```powershell
pnpm exec vitest run src/features/runtime/generation/hooks/use-generate.spec.ts -t "keeps the optimistic user message when an older messages query finishes"
```

Expected: FAIL because the stale query result replaces the optimistic row.

- [x] **Step 3: Implement the minimal fix**

Inside `insertOptimisticUserMessage`, after confirming an optimistic row exists and immediately before writing it, await:

```ts
await queryClient.cancelQueries({
  queryKey: chatKeys.messages(args.chatId),
  exact: true,
});
```

Then await `insertOptimisticUserMessage` from `runGenerationWithUi` and keep the remaining stream handling unchanged.

- [x] **Step 4: Run focused and lane verification**

Run:

```powershell
pnpm exec vitest run src/features/runtime/generation/hooks/use-generate.spec.ts
pnpm typecheck
git diff --check
```

Expected: all tests pass, typecheck exits 0, and diff check reports no whitespace errors.

- [x] **Step 5: Review the shared-mode impact**

Confirm the diff adds no mode imports or mode flags, then run Bunny against the local diff and report the remaining manual mobile-browser gap.
