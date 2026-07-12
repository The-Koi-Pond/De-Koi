# Setup Test Guidance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the setup checklist explicitly show and action the required language-model test.

**Architecture:** Split the existing combined connection/test presentation into two checklist rows without changing readiness facts or callback contracts. Keep all behavior in the shell onboarding component and prove the formerly stuck state with a focused component test.

**Tech Stack:** React, TypeScript, Vitest, jsdom

## Global Constraints

- Product behavior remains in the existing onboarding owner.
- No engine, storage, provider, runtime adapter, or HTTP contract changes.
- Preserve existing runtime, connection creation, dismissal, and continuation behavior.

---

### Task 1: Expose the hidden model-test prerequisite

**Files:**
- Modify: `src/features/shell/onboarding/components/SetupReadinessChecklist.tsx`
- Test: `src/features/shell/onboarding/components/SetupReadinessChecklist.spec.tsx`

**Interfaces:**
- Consumes: `SetupReadinessFacts.selectedConnectionTest` and the existing `onTestConnection?: () => void` prop.
- Produces: A separate `test-connection` checklist row with the existing callback and action label.

- [ ] **Step 1: Write the failing regression test**

Render the checklist with `usableConnectionCount: 1` and `selectedConnectionTest: "required"`. Assert that “Test your language model” and a “Test connection” button are visible, click the button, and assert that `onTestConnection` was called.

- [ ] **Step 2: Run the focused test and verify red**

Run: `pnpm vitest run src/features/shell/onboarding/components/SetupReadinessChecklist.spec.tsx`

Expected: the new assertion fails because the current completed connection row hides its test action.

- [ ] **Step 3: Implement the separate test row**

Keep “Connect a language model” ready when `connectionReady` is true and make it responsible only for `onCreateConnection`. Insert “Test your language model” after it, ready when `connectionTestReady` is true, and expose `onTestConnection` only when a connection exists but the test has not passed.

- [ ] **Step 4: Run focused and lane verification**

Run:

```text
pnpm vitest run src/features/shell/onboarding/components/SetupReadinessChecklist.spec.tsx
pnpm typecheck
pnpm check:architecture
pnpm check
```

Expected: all commands exit successfully.

- [ ] **Step 5: Review and ship**

Run Bunny against the diff from `origin/main`, commit only the two docs and two onboarding files, push to `origin`, open a draft PR targeting `main`, verify CI, mark ready if required for merge, and merge after clean gates.
