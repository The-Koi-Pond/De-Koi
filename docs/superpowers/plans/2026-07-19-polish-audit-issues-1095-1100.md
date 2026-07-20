# Polish Audit Issues #1095-#1100 Implementation Plan

**Goal:** Close the six polish findings with shared, test-backed contracts while preserving De-Koi's existing shell information architecture and interaction behavior.

**Architecture:** Keep generic interaction behavior in shared UI primitives, keep shell destination metadata in one neutral shared registry, and let app/feature consumers project that metadata without local copies. Enforce typography through semantic classes and a source-level regression contract scoped to persistent UI copy. Keep the Connections change inside its existing panel and reuse the current add-connection path.

**Tech Stack:** React 19, TypeScript, Tailwind/CSS tokens, Vitest, Testing Library-compatible DOM assertions, pnpm.

---

## Task 1: Accessible shared help tooltips (#1095)

**Files:**
- Modify: `src/shared/components/ui/HelpTooltip.tsx`
- Create: `src/shared/components/ui/HelpTooltip.spec.tsx`

1. Add failing component tests for a contextual accessible name, `role="tooltip"`, trigger-to-tooltip association, focus opening, Escape dismissal, click toggling, and outside-click dismissal.
2. Give each tooltip a stable React ID, contextual trigger label, `aria-expanded`, and an active `aria-describedby`/`aria-controls` relationship.
3. Open on keyboard focus and keep pointer, activation, Escape, blur, and outside-click behavior coherent.
4. Run the focused test until green.

## Task 2: Tokenized shared modal chrome (#1096)

**Files:**
- Modify: `src/shared/components/ui/Modal.tsx`
- Modify: `src/shared/components/ui/Modal.spec.tsx`

1. Extend the modal test with failing checks for retired `os-window`/`pastel-gradient` classes and the shared icon-target class.
2. Replace legacy chrome with semantic card/background/border/elevation tokens.
3. Remove the animated title stripe and apply `de-koi-icon-target` to the close button.
4. Re-run modal focus, Escape, backdrop, transition, and restoration tests.

## Task 3: One semantic shell destination registry and touch targets (#1097, #1099)

**Files:**
- Create: `src/shared/components/shell-navigation.ts`
- Modify: `src/app/shell/PanelNavButtons.tsx`
- Modify: `src/app/shell/RightPanel.tsx`
- Modify: `src/app/shell/MobileTabBar.tsx`
- Modify: `src/shared/components/mobile-shell-actions.tsx`
- Modify: `src/features/modes/conversation/components/ConversationView.tsx`
- Modify: `src/features/modes/roleplay/components/ChatRoleplaySurface.tsx`
- Modify: `src/features/modes/game/components/GameSurface.tsx`
- Modify/delete: `src/app/shell/shell-navigation.ts`
- Modify: `src/app/shell/shell-navigation.spec.ts`
- Modify: `src/app/shell/PanelNavButtons.spec.tsx`

1. Add failing registry tests proving destination uniqueness, complete panel coverage, and shared semantic accent metadata.
2. Add a failing titlebar test requiring every panel action and Discover to use `de-koi-icon-target`.
3. Move stable labels, icon identities, groups, and semantic accent roles into one neutral shared registry.
4. Replace local arrays/config maps in desktop titlebar, mobile home, mode tools menus, and right-panel headers with projections from the registry.
5. Resolve accents through existing semantic theme tokens instead of literal Tailwind palettes.
6. Preserve preload, active/pressed, failure badge, accessible labels, and compact fine-pointer layout.
7. Run focused shell tests and `pnpm check:architecture`.

## Task 4: Enforce the persistent-copy readability floor (#1098)

**Files:**
- Modify: `src/app/shell/MobileTabBar.tsx`
- Modify: `src/features/shell/settings/components/SettingsPanel.tsx`
- Modify: `src/features/modes/shared/chat-ui/components/settings/readability-contract.spec.ts`
- Modify focused component tests if needed: `src/app/shell/MobileTabBar.spec.tsx`, `src/features/shell/settings/components/SettingsPanel.spec.tsx`

1. Add failing tests for semantic 14px mobile navigation labels and semantic settings search metadata.
2. Replace arbitrary sub-caption sizes in the audited persistent owners with `de-koi-body`, `de-koi-label`, or `de-koi-caption` according to role.
3. Replace the enumerated literal regex with a numeric arbitrary-size detector and an explicit persistent-owner list, so new values below 12px cannot bypass coverage.
4. Keep 12px captions limited to secondary metadata; persistent mobile navigation and task copy use at least the label/body roles.
5. Run focused readability tests and `pnpm lint:design`.

## Task 5: Task-first Connections empty state (#1100)

**Files:**
- Modify: `src/features/shell/connections/components/ConnectionsPanel.tsx`
- Create or modify focused test: `src/features/shell/connections/components/ConnectionsPanel.empty-state.spec.tsx`

1. Add failing tests proving the empty state explains the task, exposes the existing add action as the primary CTA, presents provider guidance as optional, uses one external link, and supports durable “Don't show again” dismissal.
2. Reuse the current add-connection handler from both the panel header and the empty-state CTA.
3. Rewrite the empty state in plain language and demote the LinkAPI recommendation to a provider-neutral optional suggestion.
4. Preserve the existing local-storage dismissal key and external-link safety attributes.
5. Run focused Connections tests.

## Task 6: Integrated verification and shipping

1. Run all focused tests for the changed owners.
2. Run `pnpm typecheck`, `pnpm lint:design`, `pnpm check:architecture`, and the repository-required `pnpm check`.
3. Perform browser proof at desktop and mobile widths for tooltip keyboard behavior, modal chrome, titlebar/mobile navigation, and Connections empty state where practical.
4. Run the required Bunny review against the complete diff and address every blocking finding.
5. Inspect the dirty tree and intended files, commit once, push only to `origin`, and open one PR closing #1095, #1096, #1097, #1098, #1099, and #1100.
6. Run Bunny again for the pushed SHA, babysit required CI/review gates, mark ready when appropriate, and merge to `main`.
