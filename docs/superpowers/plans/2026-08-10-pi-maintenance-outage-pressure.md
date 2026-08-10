# Pi Maintenance Outage Pressure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop automatic memory maintenance from amplifying one provider outage across queued jobs and eliminate full-chat bridge reads used only for background connection selection.

**Architecture:** Keep provider scheduling in the TypeScript engine queue and use the existing projected storage read at the app binding. Persist the circuit-breaker signal in the current job's retry state so every runtime sees the same cooldown without a new schema or command.

**Tech Stack:** TypeScript, Vitest, React app startup binding, existing `StorageGateway` remote-capable adapter.

## Global Constraints

- Preserve foreground generation behavior and all chat, roleplay, and game mode semantics.
- Do not add a new Tauri/HTTP command or a raw runtime call.
- Do not delete or mutate Pi user data during validation.
- Use red-green-refactor and retain the existing 1 minute, 5 minute, 30 minute backoff values.

---

### Task 1: Projected maintenance connection lookup

**Files:**

- Modify: `src/app/startup/automatic-memory-maintenance.spec.tsx`
- Modify: `src/app/startup/automatic-memory-maintenance.ts`

**Interfaces:**

- Consumes: `StorageGateway.get(entity, id, { fields })`
- Produces: unchanged `resolveAutomaticMemoryMaintenanceConnectionId(...): Promise<string>`

- [x] Add an assertion that chat lookup calls `storage.get("chats", "chat-1", { fields: ["connectionId"] })`.
- [x] Run `pnpm vitest run src/app/startup/automatic-memory-maintenance.spec.tsx` and confirm the new assertion fails because the options argument is absent.
- [x] Pass `{ fields: ["connectionId"] }` at the existing call site.
- [x] Rerun the focused spec and confirm it passes.

### Task 2: Durable queue-wide provider cooldown

**Files:**

- Modify: `src/engine/generation/automatic-memory-maintenance-queue.spec.ts`
- Modify: `src/engine/generation/automatic-memory-maintenance-queue.ts`

**Interfaces:**

- Consumes: existing job `status`, `attempts`, `nextAttemptAt`, and `lastErrorCode` fields.
- Produces: transient provider analysis failures stored as retryable `provider_unavailable` jobs that gate the whole queue until `nextAttemptAt`.

- [x] Add a failing regression with two pending jobs proving one provider failure makes only the first retryable, leaves the second untouched, and makes a direct pre-deadline rerun process zero jobs.
- [x] Run `pnpm vitest run src/engine/generation/automatic-memory-maintenance-queue.spec.ts` and confirm the current queue calls the provider for both jobs.
- [x] Wrap only provider-backed analysis calls so the queue can distinguish provider failures from storage/apply failures.
- [x] Before selecting due jobs, honor any future retryable `provider_unavailable` deadline; after such a failure, stop the current drain.
- [x] Add a failing regression proving a third transient provider failure remains retryable with the capped 30-minute delay rather than becoming terminal.
- [x] Implement that capped circuit-breaker retry behavior and rerun the focused spec.

### Task 3: Verification and delivery

**Files:**

- Review all files above plus the two design/plan documents.

**Interfaces:**

- Produces: a shipping-ready branch and exact-image Pi proof.

- [x] Run both focused specs together.
- [x] Run `pnpm typecheck` and `pnpm check:architecture`.
- [x] Run full `pnpm check` and the repository workflow health gate.
- [x] Run Bunny review and address actionable findings.
- [ ] Commit the intentional files, push to `origin`, open the PR, wait for exact-head hosted checks, mark ready, and merge.
- [ ] Wait for the merge SHA's matched container images, deploy with `sh scripts/pi-update.sh --trusted-lan`, and verify health, revisions, mounts, zero restarts/OOM kills, and post-maintenance RSS/error behavior.
