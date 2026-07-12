# Discoverability Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Discover persistently reachable and add ranked feature search plus deep-linked Settings search.

**Architecture:** `src/features/shell/discovery` owns feature metadata, ranking, destinations, and Discover UI. `src/features/shell/settings` owns searchable Settings section metadata and DOM destination resolution; the UI store carries only pending cross-shell navigation state. Shell navigation opens the existing right-panel system without duplicating registries.

**Tech Stack:** React 19, TypeScript, Zustand, Vitest/jsdom, Tailwind CSS, Vite.

## Global Constraints

- Preserve feature ownership: shell UI in `src/features`/`src/app`, navigation state in `src/shared/stores`, no engine/runtime boundary changes.
- Do not add analytics, telemetry, remote search, or fuzzy-search dependencies.
- Use stable destination IDs, never selectors or display text, for deep links.
- Keep Conversation, Roleplay, and Game mode ownership separate.
- Follow red-green-refactor for every behavioral change.
- Run `pnpm check:architecture` for the changed import and shell boundaries.

---

### Task 1: Define validated Discover and Settings destinations

**Files:**
- Modify: `src/shared/stores/ui/model.ts`
- Modify: `src/shared/stores/ui.store.ts`
- Modify: `src/features/shell/discovery/discovery-types.ts`
- Modify: `src/features/shell/discovery/discovery-registry.ts`
- Modify: `src/features/shell/discovery/discovery-registry.spec.ts`
- Create: `src/features/shell/settings/lib/settings-destinations.ts`
- Create: `src/features/shell/settings/lib/settings-destinations.spec.ts`
- Modify: `scripts/check-discovery-metadata.mjs`

**Interfaces:**
- Produce `SettingsDestinationId`, `SETTINGS_DESTINATIONS`, `findSettingsDestination(id)`, and `searchSettingsDestinations(query)`.
- Extend `open-settings` actions with optional `destination`.
- Add `pendingSettingsDestination` and `setPendingSettingsDestination()` to the UI store.

- [ ] Write failing registry tests proving unknown tabs/destinations are rejected and valid destinations pass.
- [ ] Run `pnpm exec vitest run src/features/shell/discovery/discovery-registry.spec.ts src/features/shell/settings/lib/settings-destinations.spec.ts`; expect failures for missing destination contracts.
- [ ] Add a focused Settings destination registry with stable IDs for the user-visible sections referenced by current discovery entries, including notification sounds, image settings, prompt overrides, quick replies, backups/profile export, modules, extensions, import, themes, and health.
- [ ] Add pending destination state and typed action support, then validate both runtime metadata and `check:discovery` metadata against the registry's accepted IDs.
- [ ] Rerun the focused tests and `pnpm check:discovery`; expect all to pass.

### Task 2: Add deterministic weighted Discover ranking and task groups

**Files:**
- Modify: `src/features/shell/discovery/lib/discovery-search.ts`
- Create: `src/features/shell/discovery/lib/discovery-search.spec.ts`
- Create: `src/features/shell/discovery/lib/discovery-tasks.ts`
- Create: `src/features/shell/discovery/lib/discovery-tasks.spec.ts`
- Modify: `src/features/shell/discovery/components/DiscoverPanel.tsx`

**Interfaces:**
- Produce `rankDiscoveryEntries(entries, query, filters)` with stable tie ordering.
- Produce `DISCOVERY_TASKS` and `filterEntriesForDiscoveryTask(entries, taskId)`.

- [ ] Write failing tests for exact-title, title-prefix, keyword, descriptive-text, maturity tie-break, multi-term matching, stable ties, and each curated task group.
- [ ] Run the focused tests; expect ranking/task API failures.
- [ ] Implement normalized field-weight scoring without fuzzy matching or dependencies; require every query term to match at least one indexed field.
- [ ] Add the six approved task buttons to the empty-query Discover state and retain `Browse all features`; query/category/coverage selection must replace the task preview.
- [ ] Map coverage labels to Everyday, Advanced, and Experimental, with `needs-polish` shown as Experimental.
- [ ] Rerun focused tests; expect all to pass.

### Task 3: Make Discover a persistent right-panel destination

**Files:**
- Modify: `src/shared/stores/ui/model.ts`
- Modify: `src/app/shell/right-panel-loaders.ts`
- Modify: `src/app/shell/RightPanel.tsx`
- Modify: `src/app/shell/PanelNavButtons.tsx`
- Modify: `src/shared/components/mobile-shell-actions.tsx`
- Modify: `src/app/shell/MobileTabBar.tsx`
- Modify: `src/app/shell/HelpHub.tsx`
- Modify: `src/app/shell/AppShell.tsx`
- Modify: `src/app/shell/MobileTabBar.spec.tsx`
- Create: `src/app/shell/PanelNavButtons.spec.tsx`
- Create: `src/app/shell/HelpHub.spec.tsx`

**Interfaces:**
- Add `discover` to the right-panel `Panel` union and lazy loader map.
- Add `onOpenDiscover` to Help Hub, implemented through `openRightPanel("discover")`.

- [ ] Write failing desktop, mobile, and Help Hub tests requiring accessible Discover actions and correct panel routing.
- [ ] Run the three focused shell test files; expect missing action/panel failures.
- [ ] Register Discover in the right-panel loader/component metadata, desktop buttons, mobile Tools list, and Help Hub.
- [ ] Ensure opening Discover preserves the active chat and receives normal pressed/selected semantics.
- [ ] Rerun focused shell tests and `pnpm check:architecture`; expect all to pass.

### Task 4: Add Settings search and destination consumption

**Files:**
- Modify: `src/features/shell/settings/components/SettingsPanel.tsx`
- Create: `src/features/shell/settings/components/SettingsPanel.spec.tsx`
- Create: `src/features/shell/settings/lib/settings-destination-navigation.ts`
- Create: `src/features/shell/settings/lib/settings-destination-navigation.spec.ts`
- Modify: `src/features/shell/settings/components/settings/SettingsSurfaces.tsx`
- Modify: `src/features/shell/discovery/lib/discovery-actions.ts`
- Create: `src/features/shell/discovery/lib/discovery-actions.spec.ts`
- Modify: `src/features/shell/discovery/discovery-entries.json`

**Interfaces:**
- `runDiscoveryAction` sets the owning tab and pending destination when present.
- Settings consumes the pending destination once, scrolls after render, highlights, and clears it.

- [ ] Write failing tests for search matching, result labels, keyboard/click selection, tab activation, pending destination clearing, reduced-motion scrolling, missing-element behavior, and discovery-action state.
- [ ] Run the focused tests; expect failures because search/navigation are absent.
- [ ] Add the Settings search UI above tabs with live result count and buttons labeled with section plus owning tab.
- [ ] Add stable `id` markers to the destination-owning Settings sections and a small navigation helper that selects behavior based on `prefers-reduced-motion`.
- [ ] Update narrow discovery entries to target stable Settings destination IDs while leaving broad entries tab-only.
- [ ] Rerun focused tests and `pnpm check:discovery`; expect all to pass.

### Task 5: Integrate, visually prove, and prepare shipping evidence

**Files:**
- Modify only files already listed when a verified integration defect requires it.
- Add no screenshots to the repository unless existing PR evidence policy requires them.

- [ ] Run focused suites for discovery, Settings, RightPanel, desktop navigation, mobile navigation, Help Hub, and Home.
- [ ] Run `pnpm typecheck`; expect exit 0.
- [ ] Run `pnpm check:architecture`; expect exit 0.
- [ ] Run `pnpm build`; expect exit 0.
- [ ] Run `pnpm check`; expect exit 0, allowing only its documented warning-only unused-code report.
- [ ] Launch the app and use browser proof at desktop and mobile widths: open Discover from persistent navigation, search for a feature, open Settings search, select one deep link, confirm scroll/highlight, and confirm active chat preservation.
- [ ] Inspect `git diff --check origin/main...HEAD`, commit boundaries, and changed files; remove any unrelated change.
- [ ] Run Bunny review and resolve all in-scope findings before publishing.
- [ ] Commit with concise non-authorship wording, push only to `origin`, create a draft PR targeting `main`, and include exact validation/manual evidence.
- [ ] After any PR-affecting push, rerun Bunny. When CI and health gates are clean, mark ready, rerun Bunny, and merge as explicitly authorized.
