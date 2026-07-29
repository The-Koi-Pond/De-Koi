# Mobile modal layering design

## Problem

On mobile home and library surfaces, the fixed Chats / Deki-senpai / Tools navigation can cover controls near the bottom of a modal. Tidy memories exposes the bug because its Cancel and cleanup actions appear at the bottom of a shared `Modal`.

The overlap is deterministic:

- `MobileTabBar` renders the fixed navigation at z-index 80.
- The shared `Modal` overlay renders at z-index 50.
- Tidy memories uses the shared `Modal`.

The navigation therefore paints above the modal backdrop and panel and can intercept taps intended for the modal.

## Selected design

Raise the shared modal overlay above persistent shell navigation. The shared modal remains responsible for its backdrop, focus trap, scrolling, safe-area padding, and dismissal behavior. Feature-specific dialogs such as Tidy memories do not coordinate with or compensate for app chrome.

The modal layer must be higher than the mobile navigation layer while remaining below intentionally topmost notifications or emergency overlays. No changes are needed to Tidy memories, the mobile navigation state, or memory-maintenance behavior.

## Alternatives considered

### Hide the mobile navigation while a modal is open

This would require global modal state or DOM-driven coordination between unrelated owners. It adds state synchronization and exit-animation edge cases for a visual stacking problem.

### Add bottom padding only to Tidy memories

This would leave the navigation visibly and interactively above the modal backdrop, and other shared modals could reproduce the same failure. It treats one symptom instead of the shared owner.

## Scope

In scope:

- Shared `Modal` overlay stacking.
- A focused shared-modal regression test.
- Mobile viewport verification with Tidy memories open.

Out of scope:

- Memory-cleanup logic or data.
- Mobile navigation behavior, labels, or layout.
- Other overlay systems that do not use the shared `Modal`.
- General z-index refactoring.

## Verification

Use red-green-refactor at the shared-modal boundary:

1. Add a focused test proving the shared modal's declared layer is above the mobile navigation layer.
2. Run the test against the existing z-index 50 implementation and confirm the expected failure.
3. Raise the shared modal layer with the smallest owner-side change.
4. Re-run the focused test and existing shared-modal suite.
5. Run `pnpm typecheck`.
6. At a mobile viewport, open Tidy memories from a surface where the Chats / Deki-senpai / Tools bar is present and confirm the modal backdrop and action buttons render above the bar and remain tappable.

## Risk

Risk is low and limited to shared modal stacking. The intended dependent impact is that every shared modal correctly appears above persistent shell chrome. Focus trapping, animation, scrolling, and desktop layout remain unchanged.
