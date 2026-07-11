# UI Readability Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make De-Koi's dense UI easier to read and operate by introducing semantic readability and target-size foundations, keyboard-visible actions, and grouped settings navigation.

**Architecture:** Keep the change in the UI feature lane. Global CSS defines reusable presentation contracts; feature components opt into those contracts. Settings grouping is a pure React presentation helper over the existing persisted settings IDs, so no store or migration changes are required.

**Tech Stack:** React 19, TypeScript 5.9, Tailwind CSS 4, Vitest, Testing Library/jsdom, De-Koi global CSS.

## Global Constraints

- Persistent explanatory prose, button labels, and state labels must render at 12px or larger.
- Compact desktop icon controls use a 32px hit area, regular controls 36px, and coarse-pointer/mobile controls at least 44px.
- Existing settings IDs and persisted store values must not change.
- Essential actions must be visible on keyboard focus and coarse pointers, not hover alone.
- Preserve De-Koi's koi-pond visual identity; do not redesign chat, roleplay, or game surfaces.
- Do not touch engine, persistence, shared API, Tauri, or Rust boundaries.

---

### Task 1: Settings Navigation Model

**Files:**
- Create: `src/features/shell/settings/components/settings-navigation.ts`
- Create: `src/features/shell/settings/components/settings-navigation.spec.ts`
- Modify: `src/features/shell/settings/components/SettingsPanel.tsx`

**Interfaces:**
- Produces: `SETTINGS_SECTIONS`, `SETTINGS_GROUPS`, `settingsGroupForSection(id)`, and `settingsGroupSections(groupId)`.
- Consumes: existing section IDs `general | appearance | themes | plugins | extensions | import | health | advanced`.

- [ ] Write a failing test asserting four groups, exact child ordering, and complete one-time coverage of all eight existing IDs.
- [ ] Run `pnpm vitest run src/features/shell/settings/components/settings-navigation.spec.ts`; expect failure because the module does not exist.
- [ ] Implement the typed navigation constants and helpers with the exact groups General, Customize, Add-ons, and Advanced.
- [ ] Rerun the focused test; expect PASS.
- [ ] Write a failing component/static test asserting the panel renders a top-level group tablist and child section navigation while retaining `role="tab"`, `aria-selected`, and existing tabpanel IDs.
- [ ] Run the focused SettingsPanel test; expect failure against the current eight-tab strip.
- [ ] Update `SettingsPanel.tsx` to render four group tabs, a child section selector for multi-section groups, keyboard navigation in each level, and the unchanged active section component.
- [ ] Rerun focused settings tests; expect PASS.
- [ ] Commit `Group settings navigation`.

### Task 2: Semantic Readability and Target Utilities

**Files:**
- Modify: `src/styles/globals/04-surfaces-components.css`
- Modify: `src/styles/globals/07-responsive-accessibility.css`
- Create: `src/styles/globals/ui-foundations.spec.ts`

**Interfaces:**
- Produces CSS classes `.de-koi-caption`, `.de-koi-label`, `.de-koi-icon-target`, `.de-koi-control-target`, and coarse-pointer target overrides.

- [ ] Write a failing static CSS contract test that requires 12px/13px readable classes, 32px/36px target classes, and a coarse-pointer 44px minimum.
- [ ] Run `pnpm vitest run src/styles/globals/ui-foundations.spec.ts`; expect failure because the contracts are absent.
- [ ] Add the semantic classes to the surfaces module and coarse-pointer sizing to the responsive module, using existing semantic color tokens and focus-ring vocabulary.
- [ ] Rerun the CSS contract test; expect PASS.
- [ ] Commit `Add readable UI foundation utilities`.

### Task 3: Representative Dense Controls

**Files:**
- Modify: `src/features/modes/shared/chat-ui/components/settings/ModePromptSettingsSections.tsx`
- Modify: `src/features/modes/shared/chat-ui/components/settings/ScheduleEditor.tsx`
- Modify: `src/app/shell/WindowTitleBar.tsx`
- Create: `src/features/modes/shared/chat-ui/components/settings/readability-contract.spec.ts`

**Interfaces:**
- Consumes the semantic classes from Task 2.

- [ ] Write a failing static contract test that rejects sub-12px persistent copy in the two selected settings owners and requires shared target classes on their icon/text actions.
- [ ] Run the focused contract test; expect failure on current `0.5rem` through `0.6875rem` usages.
- [ ] Migrate persistent prose, labels, counters, and actions in the two owners to `.de-koi-caption` or `.de-koi-label`; leave purely graphical schedule density markers exempt only when accompanied by readable text.
- [ ] Apply shared icon target sizing to the titlebar Home and Help actions without changing native window-control geometry.
- [ ] Rerun the focused contract test and relevant existing component tests; expect PASS.
- [ ] Commit `Raise dense UI readability`.

### Task 4: Action Discoverability

**Files:**
- Modify: `src/features/modes/conversation/components/ConversationMessageActions.tsx`
- Modify: `src/features/shell/connections/components/ConnectionsPanel.tsx`
- Create: `src/features/shell/action-visibility-contract.spec.ts`

**Interfaces:**
- Consumes target utilities from Task 2.

- [ ] Write a failing static contract test requiring hover-revealed groups in the selected owners to also use focus-within/focus-visible and coarse-pointer visibility.
- [ ] Run `pnpm vitest run src/features/shell/action-visibility-contract.spec.ts`; expect failure on the current hover-only connection actions.
- [ ] Add keyboard focus and coarse-pointer visibility contracts, accessible names where absent, and shared target sizing. Keep destructive actions visually distinct.
- [ ] Rerun the focused contract and nearby conversation/connection tests; expect PASS.
- [ ] Commit `Expose actions beyond hover`.

### Task 5: Integration and Visual Proof

**Files:**
- Modify only files already listed if verification reveals an in-scope defect.

- [ ] Run all focused tests created by Tasks 1–4 together; expect PASS.
- [ ] Run `pnpm typecheck`; expect exit 0.
- [ ] Run `pnpm lint:eslint`; expect exit 0.
- [ ] Run `pnpm lint:design`; expect exit 0.
- [ ] Run `pnpm check:architecture`; expect exit 0.
- [ ] Run `pnpm build`; expect exit 0.
- [ ] Start the local web app and capture desktop settings plus a narrow/mobile settings view when the runtime permits navigation without credentials; verify no tab wrapping, clipping, or inaccessible controls.
- [ ] Run `pnpm check`; expect exit 0 before shipping.
- [ ] Run `git diff --check origin/main...HEAD`; expect no output.
- [ ] Run Bunny against the final branch diff and verification evidence; fix any blocking in-scope finding and repeat affected gates.
- [ ] Commit any verification-only fixes with a narrow subject.

### Task 6: Publish and Merge

**Files:** None beyond the reviewed implementation.

- [ ] Confirm `git status -sb`, `git log origin/main..HEAD`, and `git diff --stat origin/main...HEAD` contain only this slice.
- [ ] Push only to `origin` with tracking.
- [ ] Open a draft PR to `The-Koi-Pond/De-Koi:main` with exact scope, impact, verification, Bunny result, and any manual visual gap.
- [ ] Wait for required CI checks and address only in-scope failures.
- [ ] Run Bunny again after every PR-affecting push.
- [ ] Mark ready only after clean gates, then merge to `main` using the repository's permitted merge method.
- [ ] Verify the PR reports merged and `origin/main` contains the merge result.
