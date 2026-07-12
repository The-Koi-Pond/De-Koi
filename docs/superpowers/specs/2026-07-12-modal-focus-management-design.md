# Shared Modal Focus Management Design

## Goal

Make De-Koi's existing shared `Modal` predictable for keyboard users and seeing users who sometimes navigate with the keyboard, without starting a broader accessibility migration.

## Scope

Change only the shared modal primitive and its focused component tests.

The modal will:

- move focus to its close button after opening;
- keep Tab and Shift+Tab navigation inside the modal while it is open;
- restore focus to the element that opened it after closing;
- retain the existing Escape and backdrop-close behavior;
- associate the dialog with its visible heading using `aria-labelledby`;
- give the close button an explicit accessible name; and
- hide decorative icons from assistive technology.

## Design

`src/shared/components/ui/Modal.tsx` remains the single owner. The implementation will use React refs and effects plus a small internal query for standard focusable elements. It will not add a dialog dependency, change the public props, migrate unrelated overlays, or introduce a generalized overlay framework.

Initial focus targets the close button because every modal has one and this avoids guessing which consumer control is safest. A document-level key handler will contain Tab navigation only while this modal is active. The existing overlay stack remains responsible for Escape ordering. On close/unmount, focus returns to the previously focused connected element.

## Testing

Add `src/shared/components/ui/Modal.spec.tsx` using Vitest, jsdom, and React DOM test utilities already used by nearby shared component tests. Tests will prove initial focus, forward and reverse wrapping, focus restoration, the accessible title relationship, the close-button label, and preservation of Escape/backdrop closing.

Verification gates:

- `pnpm vitest run src/shared/components/ui/Modal.spec.tsx`
- `pnpm typecheck`
- `pnpm check:architecture`
- `pnpm check` before shipping

## Explicit Non-Goals

- Screen-reader announcements for chat messages.
- Automated axe coverage.
- High-contrast or color-theme changes.
- Migration of hand-built dialogs, drawers, or popovers.
- New runtime, storage, Tauri, HTTP, or engine behavior.
