# Conversation Time Continuity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make conversation characters distinguish a new user message from an older exchange using persisted message times.

**Architecture:** Extend the existing conversation-only presence prompt in `prompt-assembly.ts`; no provider, storage, UI, roleplay, or game contracts change. Derive a bounded transition from the latest visible user message and its predecessor, using the already-resolved user timezone.

**Tech Stack:** TypeScript, Vitest, De-Koi prompt assembly, existing zoned-time helpers.

## Global Constraints

- Preserve chat, roleplay, and game ownership boundaries.
- Do not expose timestamps as visible chat content or mutate persisted messages.
- Skip invalid, reversed, short, regeneration, and impersonation cases.
- Do not commit, push, or open a PR without Celia's explicit authorization.

---

### Task 1: Add conversation transition context

**Files:**

- Modify: `src/engine/generation/prompt-assembly.ts`
- Test: `src/engine/generation/conversation-spotify-commands.spec.ts`

**Interfaces:**

- Consumes: `PromptAssemblyInput.storedMessages`, `request.userTimeZone`, persisted message `createdAt` values.
- Produces: additional lines inside the existing `conversation_presence` system message; no exported API changes.

- [x] **Step 1: Write the failing overnight transition test**

Use fake time and `America/New_York` with an assistant message at `2026-06-22T03:30:00.000Z` and a new user message at `2026-06-22T13:00:00.000Z`. Assert the assembled prompt names the two zoned timestamps, a 9-hour-30-minute gap, the local date crossing, and later-interaction guidance.

- [x] **Step 2: Run the focused test and verify RED**

Run: `pnpm exec vitest run src/engine/generation/conversation-spotify-commands.spec.ts`

Expected: the overnight test fails because the current presence block has no previous/latest message timing relationship.

- [x] **Step 3: Implement the minimal owner-side transition helper**

In `prompt-assembly.ts`, select the latest visible user message and its visible predecessor. Parse both `createdAt` values, require a non-regeneration/non-impersonation conversation request and a gap of at least 30 minutes, format both timestamps in the resolved prompt timezone, format the elapsed duration, and append the facts plus non-meta guidance to `buildConversationPresenceBlock`.

- [x] **Step 4: Verify GREEN and add negative controls**

Add narrow assertions that a ten-minute same-session gap and an overnight regeneration do not receive transition guidance. Rerun the focused Vitest file and expect all tests to pass.

- [x] **Step 5: Run lane validation and review**

Run `pnpm typecheck`, inspect `git diff --check`, verify only the intended engine/test/docs files changed, and perform Bunny's failure-path review. Do not commit unless Celia asks.
