# Guided First-Run UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Carry desktop and web users from a chosen De-Koi experience through runtime/model readiness into exactly one configured chat, while simplifying navigation, Home, and recovery states.

**Architecture:** Put deterministic journey rules in a React-free `src/engine/onboarding` owner. Keep transient shell intent in a focused Zustand store module, and let existing Settings, Connections, and chat setup surfaces report completion without duplicating their forms. Compose the checklist, grouped navigation, contextual Home, and recovery actions in their existing React owners.

**Tech Stack:** TypeScript, React 19, Zustand, TanStack Query, Vitest/jsdom, Tailwind CSS, Tauri/web runtime adapters already present in De-Koi.

## Global Constraints

- Support both embedded Tauri desktop and the self-hosted web shell.
- Never persist credentials, API keys, provider payloads, runtime secrets, or provider test responses in journey state.
- Do not duplicate runtime, connection, character, persona, preset, lorebook, or chat setup editors.
- Do not create a chat until runtime and model prerequisites are ready.
- Consume a preserved launch intent exactly once; repeated completion events must not create duplicate chats.
- Previously completed onboarding must not reopen automatically unless a requested action is blocked or the user explicitly resumes setup.
- Keep Conversation, Roleplay, and Game separate mode owners.
- Engine code must not import React, Zustand, Tauri APIs, feature internals, or concrete shared API adapters.
- Feature code must use focused existing hooks/shared API wrappers and must not add raw `invokeTauri` or remote-runtime `fetch` calls.
- Desktop navigation must provide visible labels; tooltips are supplemental, not the sole identification.
- Mobile interactive targets remain at least 44 CSS pixels.
- Known errors must not assert a cause the app has not established.
- Preserve unrelated behavior and avoid broad refactors outside the files named by each task.

---

### Task 1: Deterministic setup journey model and focused state owner

**Files:**
- Create: `src/engine/onboarding/setup-journey.ts`
- Create: `src/engine/onboarding/setup-journey.spec.ts`
- Create: `src/engine/onboarding/index.ts`
- Create: `src/shared/stores/setup-journey.store.ts`
- Create: `src/shared/stores/setup-journey.store.spec.ts`
- Modify: `src/shared/stores/ui/persistence.ts`
- Modify: `src/shared/stores/ui/persistence.test.ts`

**Interfaces:**
- Produces `SetupJourneyIntent`, `SetupReadinessFacts`, `SetupJourneyAction`, `deriveSetupJourneyAction(facts, intent)`, and `isSetupReady(facts)` from `src/engine/onboarding`.
- Produces `useSetupJourneyStore` with `begin(mode, originCharacterId?)`, `dismiss()`, `resume()`, `markConnection(connectionId)`, `markCompleted()`, `replaceIntent(...)`, and `clearIntent()`.
- Persistence stores only mode, optional character id, optional selected connection id, dismissal, and completion-presentation metadata.

- [ ] **Step 1: Write failing pure-model tests**

Cover this table as separate assertions:

```ts
expect(deriveSetupJourneyAction(webFacts({ runtimeUrl: "" }), intent("game"))).toBe("configure-runtime");
expect(deriveSetupJourneyAction(webFacts({ runtimeHealth: "error" }), intent("game"))).toBe("repair-runtime");
expect(deriveSetupJourneyAction(desktopFacts({ connections: [] }), intent("roleplay"))).toBe("create-connection");
expect(deriveSetupJourneyAction(desktopFacts({ connectionTest: "required" }), intent("conversation"))).toBe("test-connection");
expect(deriveSetupJourneyAction(desktopFacts({ ready: true }), intent("game"))).toBe("configure-chat");
expect(deriveSetupJourneyAction(desktopFacts({ ready: true }), null)).toBe("choose-experience");
```

Also assert that desktop never returns a runtime action and that `complete` wins only after completion is explicitly recorded.

- [ ] **Step 2: Run the model test and verify RED**

Run: `pnpm vitest run src/engine/onboarding/setup-journey.spec.ts`

Expected: FAIL because `setup-journey` does not exist.

- [ ] **Step 3: Implement the minimal React-free model**

Use discriminated literal unions, no environment reads, and no store imports:

```ts
export type SetupJourneyAction =
  | "configure-runtime"
  | "repair-runtime"
  | "create-connection"
  | "test-connection"
  | "configure-chat"
  | "choose-experience"
  | "complete";

export interface SetupJourneyIntent {
  mode: "conversation" | "roleplay" | "game";
  originCharacterId: string | null;
  selectedConnectionId: string | null;
  dismissed: boolean;
  completed: boolean;
}
```

Keep readiness values explicit (`embedded`, runtime configuration/health, usable connection count, selected connection test state).

- [ ] **Step 4: Run the model test and verify GREEN**

Run: `pnpm vitest run src/engine/onboarding/setup-journey.spec.ts`

Expected: PASS with all action derivations covered.

- [ ] **Step 5: Write failing store and persistence tests**

Assert that beginning/replacing intent preserves the latest requested mode, dismissal keeps intent, resumption clears only dismissal, duplicate completion is idempotent, and serialized state excludes keys matching `/api|credential|secret|token|providerPayload/i`.

- [ ] **Step 6: Run store tests and verify RED**

Run: `pnpm vitest run src/shared/stores/setup-journey.store.spec.ts src/shared/stores/ui/persistence.test.ts`

Expected: FAIL because the focused store and persistence mapping do not exist.

- [ ] **Step 7: Implement the focused store and allowlisted persistence mapping**

Follow the existing Zustand reset/test pattern. Do not add setup fields to the already broad chat store. Persist with an explicit allowlist, not object spreading.

- [ ] **Step 8: Run store tests and architecture check**

Run: `pnpm vitest run src/shared/stores/setup-journey.store.spec.ts src/shared/stores/ui/persistence.test.ts && pnpm check:architecture`

Expected: PASS; architecture check reports no new boundary violation.

- [ ] **Step 9: Commit**

```bash
git add src/engine/onboarding src/shared/stores/setup-journey.store.ts src/shared/stores/setup-journey.store.spec.ts src/shared/stores/ui/persistence.ts src/shared/stores/ui/persistence.test.ts
git commit -m "feat: add resumable setup journey state"
```

**Stop condition:** If persistence cannot be added without changing credential/provider serialization, stop and report rather than broadening the stored payload.

---

### Task 2: Adaptive readiness checklist and prerequisite detours

**Files:**
- Create: `src/features/shell/onboarding/components/SetupReadinessChecklist.tsx`
- Create: `src/features/shell/onboarding/components/SetupReadinessChecklist.spec.tsx`
- Create: `src/features/shell/onboarding/lib/setup-readiness.ts`
- Create: `src/features/shell/onboarding/lib/setup-readiness.spec.ts`
- Modify: `src/features/shell/onboarding/shell.ts`
- Modify: `src/features/modes/router/components/ModeHomeSurface.tsx`
- Modify: `src/features/modes/router/components/ModeHomeSurface.spec.tsx`
- Modify: `src/features/modes/shared/chat-ui/components/NewChatConnectionGate.tsx`
- Modify: `src/features/shell/settings/components/SettingsPanel.tsx`
- Modify: `src/features/shell/connections/components/ConnectionsPanel.tsx`

**Interfaces:**
- Consumes Task 1 journey model/store.
- Produces `buildSetupReadinessFacts(...)` from existing runtime health and language-connection data.
- Produces checklist callbacks `onConfigureRuntime`, `onRepairRuntime`, `onCreateConnection`, `onTestConnection`, and `onContinueChat`.
- Existing Settings/Connections surfaces receive optional focused context through store/shell state rather than duplicate editors.

- [ ] **Step 1: Write failing readiness adapter tests**

Assert desktop facts omit runtime requirements; web facts distinguish missing URL, checking, healthy+writable, and unhealthy; image/TTS-only connections do not satisfy language readiness; a saved usable language connection may satisfy providers without a test capability.

- [ ] **Step 2: Verify readiness tests fail**

Run: `pnpm vitest run src/features/shell/onboarding/lib/setup-readiness.spec.ts`

Expected: FAIL because the adapter does not exist.

- [ ] **Step 3: Implement readiness adapter using existing health and connection filters**

Import `filterLanguageGenerationConnections` and existing remote-health types. Do not fetch in this helper.

- [ ] **Step 4: Verify readiness tests pass**

Run: `pnpm vitest run src/features/shell/onboarding/lib/setup-readiness.spec.ts`

Expected: PASS.

- [ ] **Step 5: Write failing checklist/Home tests**

Cover:

- desktop renders model and experience steps but no server step;
- web renders `Connect to your De-Koi server` before model setup;
- dismiss hides the expanded list but leaves `Finish setup`;
- previously completed onboarding stays collapsed until a blocked mode request begins;
- choosing a mode records intent before opening a detour;
- runtime action opens Settings at the runtime/advanced section with focused context;
- connection action opens Connections with focused context;
- completion returns focus to the launching checklist item.

- [ ] **Step 6: Verify component tests fail**

Run: `pnpm vitest run src/features/shell/onboarding/components/SetupReadinessChecklist.spec.tsx src/features/modes/router/components/ModeHomeSurface.spec.tsx`

Expected: FAIL for missing checklist behavior.

- [ ] **Step 7: Implement the checklist and replace the blocking connection gate path**

Use semantic ordered/list status markup, labeled actions, icons plus text, and the current visual tokens. Keep `NewChatConnectionGate` only as a compatibility delegate if existing callers require it; it must hand intent to the shared journey rather than tell users to return manually.

- [ ] **Step 8: Add focused banners to existing Settings and Connections owners**

The banner explains why the surface opened, provides a return/cancel action, and observes existing successful health/save/test results. It must not add provider or runtime form fields.

- [ ] **Step 9: Verify checklist and existing owner tests**

Run: `pnpm vitest run src/features/shell/onboarding src/features/modes/router/components/ModeHomeSurface.spec.tsx src/features/shell/connections src/features/shell/settings`

Expected: PASS with no act warnings or unhandled promise output.

- [ ] **Step 10: Commit**

```bash
git add src/features/shell/onboarding src/features/modes/router/components/ModeHomeSurface.tsx src/features/modes/router/components/ModeHomeSurface.spec.tsx src/features/modes/shared/chat-ui/components/NewChatConnectionGate.tsx src/features/shell/settings/components/SettingsPanel.tsx src/features/shell/connections/components/ConnectionsPanel.tsx
git commit -m "feat: guide users through setup readiness"
```

**Stop condition:** If connection testing has no stable success signal, use successful usable-connection save as the documented fallback; do not invent a new provider test protocol.

---

### Task 3: Exactly-once chat launch intent consumption

**Files:**
- Create: `src/features/modes/router/lib/setup-chat-launch.ts`
- Create: `src/features/modes/router/lib/setup-chat-launch.spec.ts`
- Modify: `src/features/modes/router/components/ModeHomeSurface.tsx`
- Modify: `src/app/shell/useStartNewChat.ts`
- Modify: `src/features/catalog/characters/hooks/use-start-chat-from-character.ts`
- Modify: `src/shared/stores/chat.store.ts`
- Modify: `src/features/modes/shared/chat-ui/hooks/use-chat-overlays.ts`
- Modify: nearby existing specs for each touched path.

**Interfaces:**
- Consumes `SetupJourneyIntent` and selected usable connection from Tasks 1–2.
- Produces `claimSetupLaunch(): ClaimedSetupLaunch | null` with a monotonic claim token or equivalent atomic consumed state.
- Reuses the existing `newChatSetupIntent` overlay contract after a chat exists.

- [ ] **Step 1: Write failing orchestration tests**

Use injected functions around the real orchestration helper. Assert:

```ts
expect(createChat).not.toHaveBeenCalled(); // before readiness
expect(claimSetupLaunch()).toEqual(expect.objectContaining({ mode: "game", connectionId: "conn-1" }));
expect(claimSetupLaunch()).toBeNull(); // same intent cannot be claimed twice
```

Also cover failure releasing a safe retry, latest mode replacing older intent, character origin preservation, selected connection reuse, and starred preset application once.

- [ ] **Step 2: Verify launch tests fail**

Run: `pnpm vitest run src/features/modes/router/lib/setup-chat-launch.spec.ts`

Expected: FAIL because atomic launch orchestration does not exist.

- [ ] **Step 3: Implement minimal claim/create/complete orchestration**

Keep query/mutation hooks at the feature edge. The helper coordinates injected operations and contains no React or storage API calls. Clear or mark the intent claimed before creation; release only on an identified creation failure.

- [ ] **Step 4: Consolidate quick-start callers on the orchestration path**

Replace direct `setShouldOpenSettings` + `setShouldOpenWizard` pairs with the existing targeted `newChatSetupIntent` entrypoint. Preserve character shortcut mode semantics.

- [ ] **Step 5: Run focused tests**

Run: `pnpm vitest run src/features/modes/router src/app/shell src/features/catalog/characters src/features/modes/shared/chat-ui/hooks/use-chat-overlays.spec.tsx src/shared/stores`

Expected: PASS; no duplicate mutation assertions fail.

- [ ] **Step 6: Commit**

```bash
git add src/features/modes/router src/app/shell/useStartNewChat.ts src/features/catalog/characters/hooks/use-start-chat-from-character.ts src/shared/stores/chat.store.ts src/features/modes/shared/chat-ui/hooks
git commit -m "feat: resume setup into one chat launch"
```

**Stop condition:** If an existing wizard requires creating a draft earlier than readiness, stop and report the exact dependency instead of restoring ghost-chat behavior.

---

### Task 4: Action-focused Home and dedicated Discover surface

**Files:**
- Create: `src/features/modes/router/lib/home-suggestions.ts`
- Create: `src/features/modes/router/lib/home-suggestions.spec.ts`
- Modify: `src/features/modes/router/components/ModeHomeSurface.tsx`
- Modify: `src/features/modes/router/components/ModeHomeSurface.spec.tsx`
- Modify: `src/features/shell/discovery/components/DiscoverPanel.tsx`
- Modify: `src/features/shell/discovery/discovery-actions.ts` or the current action owner if required.
- Modify: `src/app/shell/AppShell.tsx`
- Modify: `src/app/shell/app-shell-center-surfaces.ts`
- Modify: `src/app/shell/app-shell-center-surfaces.spec.ts`

**Interfaces:**
- Produces `getHomeSuggestions(context): HomeSuggestion[]` capped at three.
- Adds a dedicated Discover center/shell route using the existing `DiscoverPanel`; Home no longer embeds the full registry.

- [ ] **Step 1: Write failing suggestion tests**

Assert the result is capped at three, incomplete web setup prioritizes server setup, no-model state offers sample world, empty library offers import, completed/active users get Discover without inventory counts, and duplicate destinations are removed.

- [ ] **Step 2: Verify suggestion tests fail**

Run: `pnpm vitest run src/features/modes/router/lib/home-suggestions.spec.ts`

Expected: FAIL because the helper does not exist.

- [ ] **Step 3: Implement the pure suggestion selector**

Use only facts already available to Home; do not add new broad queries.

- [ ] **Step 4: Write failing Home/shell tests**

Assert Home does not render `features tracked`, coverage chips, or `Browse all 40`; it renders no more than three contextual suggestion buttons; `Open Discover` routes to the dedicated Discover surface; browser back/home closes Discover consistently with other center surfaces.

- [ ] **Step 5: Verify Home/shell tests fail**

Run: `pnpm vitest run src/features/modes/router/components/ModeHomeSurface.spec.tsx src/app/shell/app-shell-center-surfaces.spec.ts`

Expected: FAIL because Discover is still embedded on Home.

- [ ] **Step 6: Implement Home composition and dedicated Discover routing**

Retain the sample world, recent chats, mode cards, reduced-motion behavior, and legal footer. Do not change the discovery registry schema.

- [ ] **Step 7: Run focused tests and architecture check**

Run: `pnpm vitest run src/features/modes/router src/features/shell/discovery src/app/shell/app-shell-center-surfaces.spec.ts && pnpm check:architecture`

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/features/modes/router src/features/shell/discovery src/app/shell/AppShell.tsx src/app/shell/app-shell-center-surfaces.ts src/app/shell/app-shell-center-surfaces.spec.ts
git commit -m "feat: focus home on common journeys"
```

---

### Task 5: Labeled, grouped desktop and mobile navigation

**Files:**
- Create: `src/app/shell/shell-navigation.ts`
- Create: `src/app/shell/shell-navigation.spec.ts`
- Modify: `src/app/shell/PanelNavButtons.tsx`
- Create or modify: `src/app/shell/PanelNavButtons.spec.tsx`
- Modify: `src/app/shell/WindowTitleBar.tsx`
- Modify: `src/app/shell/WindowTitleBar.spec.tsx`
- Modify: `src/app/shell/MobileTabBar.tsx`
- Modify: `src/app/shell/MobileTabBar.spec.tsx`

**Interfaces:**
- Produces `PRIMARY_NAV_ITEMS`, `LIBRARY_NAV_ITEMS`, and `TOOLS_NAV_ITEMS` from one typed registry.
- Library contains Browser, Characters, Personas, Lorebooks, Presets, Gallery.
- Tools contains Connections, Agents, Settings, Discover.

- [ ] **Step 1: Write failing registry tests**

Assert every right-panel/dedicated destination appears exactly once, the required labels and group membership match the spec, and labels are non-empty.

- [ ] **Step 2: Verify registry tests fail**

Run: `pnpm vitest run src/app/shell/shell-navigation.spec.ts`

Expected: FAIL because the grouped registry does not exist.

- [ ] **Step 3: Implement the typed registry**

Reuse existing panel identifiers and icons at the component edge. Keep the registry free of React nodes if doing so simplifies pure tests.

- [ ] **Step 4: Write failing navigation component tests**

Desktop assertions:

- visible labeled `Chats`, `Deki-senpai`, `Library`, and `Tools` controls;
- menu items use their full labels and active state;
- Enter/Space opens a menu, arrow keys move within it, Escape closes and restores focus;
- constrained layout retains an accessible labeled overflow control.

Mobile assertions:

- existing Chats/Deki-senpai/Tools tabs remain;
- Tools sheet displays Library and Tools group headings;
- every mobile item retains at least `min-h-11`/equivalent 44px sizing.

- [ ] **Step 5: Verify component tests fail**

Run: `pnpm vitest run src/app/shell/PanelNavButtons.spec.tsx src/app/shell/WindowTitleBar.spec.tsx src/app/shell/MobileTabBar.spec.tsx`

Expected: FAIL for missing grouped labeled controls.

- [ ] **Step 6: Implement grouped navigation with accessible menu behavior**

Follow existing titlebar drag suppression. Do not make menu items hover-only. Preserve lazy preloading on focus/pointer intent.

- [ ] **Step 7: Run shell tests**

Run: `pnpm vitest run src/app/shell`

Expected: PASS with existing window-control ordering and mobile sidebar behavior preserved.

- [ ] **Step 8: Commit**

```bash
git add src/app/shell
git commit -m "feat: group and label shell navigation"
```

---

### Task 6: Contextual chat recovery states and integration verification

**Files:**
- Create: `src/app/shell/chat-sidebar-recovery.ts`
- Create: `src/app/shell/chat-sidebar-recovery.spec.ts`
- Modify: `src/app/shell/ChatSidebar.tsx`
- Modify: focused `ChatSidebar` component spec or create `src/app/shell/ChatSidebar.recovery.spec.tsx`
- Modify: `src/app/shell/HelpHub.tsx`
- Modify: `src/features/shell/onboarding/components/OnboardingTutorial.tsx`
- Modify: `src/features/shell/discovery/discovery-entries.json`

**Interfaces:**
- Produces `getChatSidebarRecovery(error, context)` returning `{ title, description, primaryAction, secondaryAction? }` for startup, missing runtime, unhealthy runtime, storage, connection, and unknown failures.
- Recovery action IDs map only at the component edge to Retry, Connect server, Open Connections, View Health, or Copy support details.

- [ ] **Step 1: Write failing recovery mapping tests**

Assert each known context receives accurate copy and one relevant recovery action. Assert unknown errors do not contain `waking up`, `should appear`, or any unverified diagnosis. Assert filtered empty state produces `Clear filters`, while a true empty list produces `New Conversation/Roleplay/Game`.

- [ ] **Step 2: Verify recovery tests fail**

Run: `pnpm vitest run src/app/shell/chat-sidebar-recovery.spec.ts`

Expected: FAIL because the mapper does not exist.

- [ ] **Step 3: Implement recovery mapper and component actions**

Use stable error/context discriminants already available. If only an unknown error reaches the sidebar, map it to Retry + View Health rather than parsing arbitrary message strings.

- [ ] **Step 4: Update tutorial and discovery copy**

Rename the optional tour action to `Show me around`; remove `You're All Set` language tied only to viewing pages; explain that the readiness checklist handles setup. Update the discovery entry/action for the new dedicated Discover surface and resumable setup.

- [ ] **Step 5: Run focused UX tests**

Run: `pnpm vitest run src/app/shell src/features/shell/onboarding src/features/shell/discovery`

Expected: PASS.

- [ ] **Step 6: Run all shipping checks**

Run in order:

```bash
pnpm typecheck
pnpm check:architecture
pnpm build
pnpm check
```

Expected: all commands exit 0. The warning-only unused-code report may print warnings but must not identify newly orphaned journey/navigation modules.

- [ ] **Step 7: Visually validate**

Run the app in the clean worktree and capture/inspect these states at desktop and mobile widths:

- Home with incomplete desktop setup;
- Home with incomplete web runtime setup;
- dismissed and resumed checklist;
- Connections focused setup banner;
- completed returning-user Home;
- Library and Tools navigation menus;
- unknown chat-list recovery state;
- filtered empty chat state.

Check keyboard focus, no horizontal overflow, 44px mobile targets, legible labels, and reduced-motion behavior. Record screenshots under `docs/pr-evidence/guided-first-run-ux/` only if they are suitable for the PR evidence packet.

- [ ] **Step 8: Commit final integration**

```bash
git add src/app/shell src/features/shell/onboarding src/features/shell/discovery docs/pr-evidence/guided-first-run-ux
git commit -m "fix: make setup recovery actionable"
```

**Stop condition:** Do not manufacture internal error categories by brittle substring parsing. Unknown errors must remain unknown and route to Health.

---

## Final Review And Shipping

- [ ] Generate a whole-branch review package from the merge base and run the broad code review workflow.
- [ ] Fix every Critical or Important finding and re-run its covering tests.
- [ ] Run Bunny review using the branch/PR workflow; resolve all blocker findings.
- [ ] Confirm `git diff --check`, intended-file scope, branch, and `origin` remote.
- [ ] Push only to `origin` and open a draft PR with unchecked human-validation boxes.
- [ ] Wait for required CI checks; fix failures with the GitHub CI workflow if necessary.
- [ ] Mark ready only after local checks, CI, visual proof, and Bunny are clean.
- [ ] Merge to `main` through GitHub without force-push, then verify the PR is merged and `origin/main` contains the merge commit.
