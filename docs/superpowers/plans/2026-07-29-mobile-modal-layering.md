# Mobile Modal Layering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep shared modal dialogs and their action buttons above De-Koi's fixed mobile Chats / Deki-senpai / Tools navigation.

**Architecture:** Fix the stacking contract at the shared `Modal` owner rather than adding Tidy Memories compensation or shell state. Preserve the modal's focus, animation, scrolling, and safe-area behavior; only its overlay layer changes.

**Tech Stack:** React 19, TypeScript, Tailwind CSS utilities, Vitest, Playwright/browser viewport verification.

## Global Constraints

- The shared modal layer must be higher than the mobile navigation layer of 80.
- Tidy Memories, mobile-navigation state, memory-maintenance logic, and unrelated overlay systems must not change.
- The dirty primary checkout must remain untouched.
- Do not commit, push, or open a PR without explicit authorization.

---

### Task 1: Raise the shared modal above mobile navigation

**Files:**
- Modify: `src/shared/components/ui/Modal.spec.tsx`
- Modify: `src/shared/components/ui/Modal.tsx`

**Interfaces:**
- Consumes: The existing `ModalProps` public component interface and `mari-modal` root selector.
- Produces: The same `Modal` interface with a root overlay layer of 90 instead of 50.

**Durable test rationale:** This is a known mobile regression in a shared component. Session-only visual proof would not prevent the shared layer from drifting below persistent shell chrome again, and the existing `Modal.spec.tsx` provides a narrow stable test owner.

- [x] **Step 1: Write the failing shared-modal layer test**

Add this case to `src/shared/components/ui/Modal.spec.tsx` after the semantic-chrome test:

```tsx
it("renders above the fixed mobile shell navigation", () => {
  renderModal(true);

  const dialog = container.querySelector<HTMLElement>('[role="dialog"]')!;

  expect(dialog.className).toContain("z-[90]");
  expect(dialog.className).not.toContain("z-50");
});
```

- [x] **Step 2: Run the focused test and verify RED**

Run:

```powershell
pnpm test src/shared/components/ui/Modal.spec.tsx
```

Expected: one failure in `renders above the fixed mobile shell navigation` because the current root class contains `z-50` instead of `z-[90]`; the five pre-existing tests remain passing.

- [x] **Step 3: Implement the smallest owner-side fix**

In `src/shared/components/ui/Modal.tsx`, change only the modal root's stacking utility:

```tsx
className="mari-modal fixed inset-0 z-[90] flex items-center justify-center p-3 max-md:pt-[max(0.75rem,env(safe-area-inset-top))] max-md:pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:p-4"
```

- [x] **Step 4: Run the focused test and verify GREEN**

Run:

```powershell
pnpm test src/shared/components/ui/Modal.spec.tsx
```

Expected: one test file passes with six passing tests and no failures.

- [x] **Step 5: Run the matching TypeScript lane check**

Run:

```powershell
pnpm typecheck
```

Expected: exit code 0 with no TypeScript errors.

- [x] **Step 6: Verify the real mobile overlap path**

Run the De-Koi frontend from the isolated worktree, use a mobile viewport, and open Tidy Memories from a home/library surface where the Chats / Deki-senpai / Tools navigation is mounted.

In the browser, compare the computed layers:

```js
const dialog = document.querySelector('[role="dialog"]');
const navigation = document.querySelector('.mari-mobile-tab-bar');
({
  dialogZ: Number(getComputedStyle(dialog).zIndex),
  navigationZ: Number(getComputedStyle(navigation).zIndex),
  actionVisible: [...dialog.querySelectorAll('button')].some(
    (button) => button.textContent.trim() === 'Cancel' && button.getBoundingClientRect().bottom <= innerHeight,
  ),
});
```

Expected: `dialogZ` is 90, `navigationZ` is 80, `dialogZ > navigationZ`, and `actionVisible` is `true`. Confirm the Cancel and cleanup buttons receive taps without the navigation intercepting them.

Result: The clean browser runtime had no character or memory records, so the literal Tidy Memories dialog could not be opened. A mobile browser run used AI Character Maker, another consumer of the same shared `Modal`, and confirmed layer 90 over navigation layer 80. After scrolling its bottom action into the navigation overlap zone, the action remained the top hit target and navigation did not intercept it. Static source proof confirms Tidy Memories and its Cancel / Apply cleanup row use this same shared owner.

- [x] **Step 7: Review the local boundary**

Run:

```powershell
git diff --check
git status --short
git diff -- src/shared/components/ui/Modal.tsx src/shared/components/ui/Modal.spec.tsx
```

Expected: no whitespace errors; only the approved design/plan documents plus the two shared-modal files are changed. Leave all changes uncommitted unless the user separately authorizes a commit.
