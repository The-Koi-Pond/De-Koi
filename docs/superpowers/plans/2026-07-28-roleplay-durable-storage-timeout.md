# Roleplay Durable Storage Timeout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent slow remote storage mutations from falsely failing roleplay creation after 30 seconds while retaining finite deadlines for reads, health checks, and ordinary remote commands.

**Architecture:** `src/shared/api/remote-runtime.ts` will support an explicit `timeoutMs: null` request contract that keeps caller cancellation but does not arm an internal timer. The generic durable storage wrappers in `src/shared/api/storage-api.ts` will use that contract for create, update, and delete; roleplay orchestration and Rust storage behavior remain unchanged.

**Tech Stack:** TypeScript, Fetch/AbortController, Vitest, pnpm

## Global Constraints

- Preserve the default 30-second deadline for remote health checks, reads, and ordinary finite commands.
- Do not retry durable mutations: a client timeout cannot prove that the server-side write failed.
- Keep the owner boundary in `src/shared/api`; do not add roleplay-mode exceptions or raw runtime calls.
- Preserve embedded Tauri behavior and explicit caller cancellation.
- Do not delete existing partial roleplays automatically.
- Do not commit, push, or open a PR without explicit authorization.

---

### Task 1: Add an explicit no-deadline remote request contract

**Files:**

- Modify: `src/shared/api/remote-runtime.spec.ts`
- Modify: `src/shared/api/tauri-client.spec.ts`
- Modify: `src/shared/api/remote-runtime.ts`
- Modify: `src/shared/api/tauri-client.ts`

**Interfaces:**

- Consumes: `invokeRemote(command, args, options)` and `invokeTauri(command, args, options)`
- Produces: request option `{ timeoutMs: null }`, meaning no internally armed deadline while retaining the optional caller `AbortSignal`

- [x] **Step 1: Write the failing remote-runtime test**

Add a Vitest case that starts a hanging `invokeRemote` call with `{ timeoutMs: null }`, advances fake time beyond `REMOTE_FINITE_REQUEST_TIMEOUT_MS`, proves the request has not rejected, then explicitly aborts it and proves the caller's abort reason is preserved.

- [x] **Step 2: Write the failing Tauri bridge test**

Call `invokeTauri("storage_create", args, { timeoutMs: null })` and assert that `invokeRemote` receives the exact null timeout option.

- [x] **Step 3: Run the tests and verify RED**

Run:

```powershell
pnpm exec vitest run src/shared/api/remote-runtime.spec.ts src/shared/api/tauri-client.spec.ts
```

Expected: FAIL because `timeoutMs` currently accepts only numbers and `null` currently falls back to the 30-second timer.

- [x] **Step 4: Implement the minimal runtime contract**

Change the finite request option to:

```ts
type RemoteFiniteRequestOptions = {
  signal?: AbortSignal;
  timeoutMs?: number | null;
};
```

Create the internal timer only when the normalized timeout is a number. Keep the internal `AbortController`, caller-signal forwarding, timeout error shape, and cleanup behavior unchanged. Update `invokeTauri`'s option type to accept the same nullable timeout.

- [x] **Step 5: Run the focused tests and verify GREEN**

Run:

```powershell
pnpm exec vitest run src/shared/api/remote-runtime.spec.ts src/shared/api/tauri-client.spec.ts
```

Expected: both files pass, including the existing ordinary 30-second timeout tests.

### Task 2: Exempt durable generic storage mutations from client deadlines

**Files:**

- Modify: `src/shared/api/storage-api.spec.ts`
- Modify: `src/shared/api/storage-api.ts`

**Interfaces:**

- Consumes: `invokeTauri(..., { timeoutMs: null })` from Task 1
- Produces: no-deadline behavior for generic `storage_create`, `storage_update`, and `storage_delete`; generic list/get reads remain on the default deadline

- [x] **Step 1: Write the failing storage wrapper test**

Call `storageApi.create`, `storageApi.update`, and `storageApi.delete`. Assert each corresponding `invokeTauri` call includes `{ timeoutMs: null }`. Also call `storageApi.list` and `storageApi.get` and assert they still omit the third argument.

- [x] **Step 2: Run the storage test and verify RED**

Run:

```powershell
pnpm exec vitest run src/shared/api/storage-api.spec.ts
```

Expected: FAIL because the mutation wrappers currently omit request options.

- [x] **Step 3: Implement the minimal wrapper change**

Add one immutable shared option:

```ts
const DURABLE_STORAGE_REQUEST_OPTIONS = { timeoutMs: null } as const;
```

Pass it as the third argument for `storage_create`, `storage_update`, and `storage_delete` only.

- [x] **Step 4: Run the storage test and verify GREEN**

Run:

```powershell
pnpm exec vitest run src/shared/api/storage-api.spec.ts
```

Expected: PASS, with read wrappers still using the default bounded contract.

### Task 3: Verify the changed lane

**Files:**

- Review only: all files changed by Tasks 1 and 2

**Interfaces:**

- Consumes: completed runtime and storage-wrapper changes
- Produces: evidence that the regression is fixed without widening architecture or breaking the existing timeout contract

- [x] **Step 1: Run the focused shared-API suites**

```powershell
pnpm exec vitest run src/shared/api/remote-runtime.spec.ts src/shared/api/tauri-client.spec.ts src/shared/api/storage-api.spec.ts
```

Expected: all focused tests pass.

- [x] **Step 2: Run TypeScript and architecture checks**

```powershell
pnpm typecheck
pnpm check:architecture
```

Expected: both commands exit successfully.

- [x] **Step 3: Run the repository gate**

```powershell
pnpm check
```

Expected: the complete repository validation exits successfully.

- [x] **Step 4: Review scope**

Run:

```powershell
git status --short
git diff --check
git diff -- src/shared/api/remote-runtime.ts src/shared/api/remote-runtime.spec.ts src/shared/api/tauri-client.ts src/shared/api/tauri-client.spec.ts src/shared/api/storage-api.ts src/shared/api/storage-api.spec.ts
```

Expected: only the approved plan and shared-API files are changed; no whitespace errors.
