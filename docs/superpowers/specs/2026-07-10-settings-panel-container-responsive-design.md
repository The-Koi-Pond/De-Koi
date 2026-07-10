# Settings Panel Container-Responsive Layout Design

## Problem

The settings redesign introduced a descriptive navigation rail at Tailwind's `lg` viewport breakpoint. De-Koi renders settings inside a resizable right panel, so the application viewport can be wide while the settings container remains narrow. In that state, the fixed `14rem` rail leaves too little width for the active settings form and produces severe wrapping and cramped controls.

## Goal

Preserve the redesigned navigation, section descriptions, icons, page heading, and keyboard behavior while ensuring the active settings surface always receives usable width.

## Design

Make `SettingsPanel` an inline-size container and select its navigation layout from the panel's own width instead of the application viewport.

- At narrow settings widths, render the existing compact horizontal, scrollable tab row. Keep labels and icons visible, but hide per-tab descriptions.
- At a sufficiently wide settings width, switch to the two-column layout with the `14rem` descriptive navigation rail and the active settings surface beside it.
- Retain the active page heading and description in both layouts.
- Keep selection, roving tab focus, arrow keys, Home, and End behavior unchanged.

The initial wide-layout threshold will be `48rem`. This guarantees at least `34rem` remains beside the `14rem` rail before content padding, while normal right-panel widths stay in the compact layout. The breakpoint is local to the settings component and does not depend on viewport size or persisted right-panel state.

## Ownership and Boundaries

This is a UI feature-lane change owned by `src/features/shell/settings/components/SettingsPanel.tsx`. It does not change engine state, shared APIs, persistence, runtime adapters, or Tauri behavior.

No new component or data boundary is needed. The active tab continues to come from `useUIStore`, and the active settings component lookup remains unchanged.

## Styling Approach

Use Tailwind container-query utilities on the settings panel:

- Add `@container` to the root.
- Replace viewport-responsive `lg:` layout utilities with container-responsive `@3xl:` utilities, whose `48rem` threshold matches the required minimum settings width.
- Leave ordinary `sm:` content padding responsive to the viewport because it only adjusts modest internal spacing and cannot create the split-layout failure.

## Regression Proof

Update the focused `SettingsPanel` component test before production code so it fails while viewport-based layout utilities remain. The test will assert that:

- the settings root establishes a container;
- the split layout and vertical navigation are controlled by `@3xl:` utilities;
- the tab list no longer uses `lg:` to decide whether it becomes a sidebar.

Existing tests continue to cover the page introduction, tab selection, and keyboard focus behavior. After the focused red-green cycle, run the settings test, TypeScript typecheck, architecture check, and the full shipping gate. Browser validation will confirm that a narrow right panel uses horizontal tabs and a genuinely wide settings container uses the descriptive rail.

## Risk

Risk is low and limited to responsive presentation. The main residual risk is browser support for CSS container queries; De-Koi's supported modern browser/Tauri targets already use container queries elsewhere in the product.
