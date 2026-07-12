# Shared Modal Focus Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the existing shared De-Koi modal contain keyboard focus, restore the opener's focus, and expose an accessible title and close control.

**Architecture:** Keep all behavior inside `src/shared/components/ui/Modal.tsx`, using refs and effects without changing `ModalProps` or adding dependencies. Add one colocated jsdom component test file that exercises the public rendered behavior.

**Tech Stack:** React 19, TypeScript, Vitest 4, jsdom, React DOM test utilities.

## Global Constraints

- Touch only the shared modal, its focused tests, and these approved design/plan documents.
- Do not migrate other overlays or change runtime, engine, storage, Tauri, HTTP, or feature APIs.
- Preserve Escape ordering through `useEscapeOverlay` and preserve backdrop closing.
- Use a failing-test-first red-green sequence.

---

### Task 1: Specify the modal keyboard and accessibility contract

**Files:**
- Create: `src/shared/components/ui/Modal.spec.tsx`
- Read: `src/shared/components/ui/Modal.tsx`

**Interfaces:**
- Consumes: `Modal({ open, onClose, title, children, width?, onExited? })`
- Produces: behavior-level regression coverage without new production exports.

- [ ] **Step 1: Write the failing tests**

Create a jsdom React root harness with an opener button and `Modal`. Stub `requestAnimationFrame` so the mounted modal is rendered deterministically. Add separate tests asserting:

```tsx
expect(document.activeElement).toBe(closeButton);
expect(dialog.getAttribute("aria-labelledby")).toBe(heading.id);
expect(closeButton.getAttribute("aria-label")).toBe("Close Test modal");
```

Dispatch cancelable `keydown` events for Tab and Shift+Tab and assert focus wraps from the last focusable child to the close button and back. Close through the close button, finish the exit transition, and assert focus returns to the opener. Retain direct assertions that Escape and clicking the overlay call `onClose`.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `pnpm vitest run src/shared/components/ui/Modal.spec.tsx`

Expected: FAIL because the close button lacks an accessible name, the dialog uses `aria-label` instead of `aria-labelledby`, and focus is not managed.

- [ ] **Step 3: Commit the red test**

Run:

```text
git add src/shared/components/ui/Modal.spec.tsx
git commit -m "Test modal focus management"
```

### Task 2: Implement the minimal shared-modal behavior

**Files:**
- Modify: `src/shared/components/ui/Modal.tsx`
- Test: `src/shared/components/ui/Modal.spec.tsx`

**Interfaces:**
- Consumes: the existing `ModalProps` contract unchanged.
- Produces: an internally managed dialog with deterministic close-button initial focus and focus restoration.

- [ ] **Step 1: Add internal focus ownership**

Add refs for the panel, close button, previous active element, and a stable generated heading ID. When `open` becomes true, remember the current `HTMLElement`; after the modal mounts, focus the close button. On cleanup after the modal closes or unmounts, focus the remembered element only when it remains connected.

- [ ] **Step 2: Contain Tab navigation**

While open, listen for `keydown` on the modal overlay. For Tab only, query the panel for enabled, visible native focusable elements using this selector:

```ts
const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
```

If focus is outside the panel, move it to the first element. Wrap forward from the last element to the first and backward from the first to the last, calling `preventDefault()` only for those containment cases.

- [ ] **Step 3: Complete dialog semantics**

Replace `aria-label={title}` with `aria-labelledby={titleId}`, assign `id={titleId}` to the heading, set the close button to `type="button"` and `aria-label={`Close ${title}`}`, and set `aria-hidden="true"` on the `X` icon and decorative gradient/backdrop elements.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `pnpm vitest run src/shared/components/ui/Modal.spec.tsx`

Expected: all modal tests pass with zero failures.

- [ ] **Step 5: Run matching lane checks**

Run:

```text
pnpm typecheck
pnpm check:architecture
```

Expected: both commands exit 0.

- [ ] **Step 6: Commit the implementation**

Run:

```text
git add src/shared/components/ui/Modal.tsx
git commit -m "Harden modal focus management"
```

### Task 3: Shipping verification and review

**Files:**
- Review only: all branch changes against `origin/main`.

**Interfaces:**
- Consumes: Tasks 1 and 2 commits.
- Produces: verified PR-ready branch.

- [ ] **Step 1: Run full verification**

Run `pnpm check` and rerun `pnpm vitest run src/shared/components/ui/Modal.spec.tsx` afterward for fresh focused evidence. Expected: exit 0 with no test failures.

- [ ] **Step 2: Inspect the complete boundary**

Run `git diff --check origin/main...HEAD`, `git diff --stat origin/main...HEAD`, `git log --oneline origin/main..HEAD`, and read every changed hunk. Expected: only the spec, plan, modal test, and modal implementation are present.

- [ ] **Step 3: Run Bunny review**

Review the core claim, branch boundary, focused proof, full gate, and unproved manual browser behavior. Expected: Bunny pass or concrete fixes followed by repeated verification.

- [ ] **Step 4: Publish and merge**

Push only to `origin`, open a draft PR targeting `main` with approved factual wording, wait for required GitHub checks, then merge using the repository's allowed merge method. Verify the PR state and `origin/main` afterward.
