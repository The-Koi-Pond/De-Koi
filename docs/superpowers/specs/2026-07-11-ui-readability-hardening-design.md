# UI Readability and Interaction Hardening

## Goal

Improve De-Koi's default interface against four verified weaknesses: undersized persistent text, inconsistent interaction targets, hover-only action discovery, and an overcrowded settings tab strip. Preserve the koi-pond identity and compact power-user character while making common controls easier to read, find, and operate.

## Scope

This slice owns UI feature presentation and global design-system CSS. It may change:

- semantic typography and interaction utilities in `src/styles/globals`;
- the settings navigation in `src/features/shell/settings`;
- representative conversation, connection, and high-density settings controls needed to establish the new patterns;
- focused tests or static contract tests for the changed behavior.

It does not redesign chat, roleplay, or game layouts; replace every historical arbitrary font size; change engine behavior; change persistence; or alter runtime/Tauri boundaries.

## Design

### Readability floor

Persistent explanatory prose, button labels, and state labels must render at 12px or larger. The normal compact label remains 13px and normal body copy remains 14px. Text below 12px is reserved for genuinely incidental display data where loss does not block understanding. Representative high-density editors will migrate first, backed by semantic CSS utilities so later cleanup does not invent more arbitrary sizes.

Opacity must not be used to make already-small essential text quieter. Secondary copy should prefer the existing `--muted-foreground` token at readable size and full token opacity.

### Interaction targets

Introduce reusable compact, regular, and touch target rules. Compact desktop icon controls have a 32px hit area, regular controls 36px, and coarse-pointer/mobile controls at least 44px. Icons may remain visually small inside the larger target. Existing window controls are excluded where native-titlebar geometry requires their current dimensions, but app navigation and feature controls use the shared targets.

### Action discovery

Essential row actions cannot depend exclusively on hover. Desktop rows may keep secondary actions visually quiet, but their action group must also reveal on keyboard focus. Coarse-pointer layouts keep essential actions visible. Representative conversation and connection action groups will establish the contract; a focused static test will prevent regression to hover-only behavior in those owners.

### Settings navigation

Replace the eight equal-weight wrapping tabs with four top-level groups:

- General: General
- Customize: Appearance and Themes
- Add-ons: Modules and Extensions
- Advanced: Import, Health, and Advanced

The group control stays a proper keyboard-operated tablist. Selecting a group reveals a compact second-level control when the group contains multiple sections. Existing settings section components and store identifiers remain unchanged, avoiding persistence migration. On narrow surfaces the controls may horizontally scroll rather than wrap into three rows.

## Accessibility

- Preserve tab, tabpanel, `aria-selected`, and keyboard navigation semantics.
- Every icon-only control touched by this slice retains or gains an accessible name.
- Focus-visible treatment must be at least as discoverable as hover treatment.
- Selected state continues to use structure and active backing in addition to color.
- Coarse-pointer targets use a 44px minimum without enlarging decorative icons.

## Verification

Development follows red-green-refactor with focused tests for settings navigation grouping and action visibility contracts. Required gates are:

1. Focused Vitest tests for changed components/contracts.
2. `pnpm typecheck`.
3. `pnpm lint:design` and `pnpm lint:eslint`.
4. `pnpm build`.
5. `pnpm check:architecture` because shared CSS and feature ownership are touched.
6. `pnpm check` before shipping.
7. Browser proof at desktop and mobile widths when the local app is reachable; otherwise the PR must state that rendered proof remains manual.
8. Bunny review before the initial PR and after every PR-affecting push.

## Risks and containment

- Larger controls could crowd narrow toolbars. Apply shared targets to selected owners first and verify overflow at mobile widths.
- Settings grouping could make a section harder to find. Keep all existing labels, expose the active child label, and preserve the stored section IDs.
- Global typography rules could unintentionally enlarge cinematic/game HUD text. Do not use a universal font-size override; use semantic classes and targeted migrations.
- Hover changes could add visual noise. Keep secondary actions quiet through color and backing rather than making them invisible.

## Done criteria

- No touched persistent UI copy is below 12px.
- Touched app controls meet the defined hit-area tier and coarse-pointer minimum.
- Touched action groups are reachable and visible through keyboard focus and coarse-pointer layouts.
- Settings uses four top-level groups without changing the existing settings-section IDs.
- Focused tests and all required shipping gates pass, or the PR is blocked rather than merged.
