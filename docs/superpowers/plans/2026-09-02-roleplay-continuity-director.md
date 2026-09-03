# Roleplay Continuity Director Implementation Plan

> **Required sub-skill:** Use `superpowers:executing-plans` to implement this plan one task at a time.

**Goal:** Add a visible, user-controlled Roleplay Continuity Director that proposes and tracks story beats without writing prose, overruling the latest user request, or mutating canonical story and character knowledge.

**Architecture:** Treat the director as a Roleplay-owned plan resource stored in chat metadata, not as a resurrected hidden agent and not as another canonical-memory collection. The planner reads the existing story projection and character-knowledge systems, but it can only write its own plan state. Prompt assembly projects approved active beats into a bounded attributed system block; the saved generation snapshot preserves the exact guidance used. Delivery is split: Slice 1 ships manual planning and proves control/precedence, then Slice 2 adds opt-in scene-event and low-frequency refreshes without putting planning on the writer's critical path.

**Tech Stack:** TypeScript, React, React Query, Vitest, Testing Library, existing storage and LLM ports, De-Koi prompt attribution and generation snapshots.

## Global Constraints

- The latest explicit user request always outranks director guidance.
- The director proposes structure. The selected writer model still owns prose.
- No model response can approve its own beat. Approval is a local user action.
- Director output must never prescribe the user persona's exact dialogue, deliberate action, belief, intent, or strategic choice.
- Director code may read story projections and character-knowledge edges, but may not write chats, messages, canonical memories, lorebooks, character cards, trackers, or agent scratch state.
- A missing state means disabled. Enabling or disabling the feature never destroys the saved plan.
- Rejected, deferred, fulfilled, and user-edited decisions survive refresh, branch/replay, export/import, and application restart.
- Malformed output, unavailable connections, timeouts, and refresh failures leave the last valid plan untouched and never fail ordinary response generation.
- Legacy `narrative-craft`, `director`, `prose-guardian`, and `secret-plot-driver` injections remain filtered. This feature does not restore any retired agent.
- Slice 1 is the independently shippable feature. Do not begin Slice 2 until the Slice 1 authority, persistence, attribution, and browser checks pass.

## State and Ownership Contract

Add one optional `roleplayContinuityDirector` value to `ChatMetadata`. Store the whole resource under that key so the existing field-level `patchChatMetadata` merge can replace it atomically. This deliberately avoids a Rust collection, schema migration, or second persistence lifecycle; chat branching, deletion, and export/import already carry metadata.

The version-one state should expose these concepts:

```ts
type ContinuityDirectorBeatStatus = "proposed" | "approved" | "deferred" | "rejected" | "fulfilled";

type ContinuityDirectorRefreshMode = "manual" | "scene_events" | "cadence";

interface RoleplayContinuityDirectorState {
  version: 1;
  revision: number;
  enabled: boolean;
  connectionId: string | null;
  refreshMode: ContinuityDirectorRefreshMode;
  refreshEveryAssistantTurns: number | null;
  currentArc: ContinuityDirectorArc | null;
  openThreads: ContinuityDirectorThread[];
  beats: ContinuityDirectorBeat[];
  sourceSnapshot: {
    storyProjectionIds: string[];
    knowledgeEdgeIds: string[];
    lastMessageId: string | null;
    fingerprint: string;
    generatedAt: string;
  } | null;
  updatedAt: string;
}
```

Each arc, thread, and beat needs a stable local ID, `source: "director" | "user"`, timestamps, and source IDs where relevant. Beats also need `status`, integer `order`, and optional `characterIds` / `threadIds`. Keep generation limits explicit: at most 8 new proposed beats per refresh, 20 retained beats total, 12 open threads, 600 characters for the arc, and 280 characters per thread or beat.

Refresh merging must follow this table:

| Existing item                    | Refresh behavior                                                                 |
| -------------------------------- | -------------------------------------------------------------------------------- |
| User-authored item               | Preserve exactly                                                                 |
| Approved beat                    | Preserve status and text                                                         |
| Deferred/rejected/fulfilled beat | Preserve as history                                                              |
| Director-authored proposed beat  | Replace only when the refresh is applied                                         |
| Edited proposed beat             | Treat as user-authored and preserve                                              |
| Rerolled beat                    | Mark old item rejected with `resolution: "rerolled"`; insert a new proposed item |

Staleness is derived by comparing the current input fingerprint with `sourceSnapshot.fingerprint`. A stale badge does not silently deapprove a beat; users retain control until they fulfill, defer, reject, edit, reroll, or disable it.

---

## Slice 1 — Manual, Visible, Attributed Planning

### Task 1: Define the durable contract and pure state transitions

**Files:**

- Create: `src/engine/contracts/types/roleplay-continuity-director.ts`
- Modify: `src/engine/contracts/types/chat.ts`
- Create: `src/engine/modes/roleplay/continuity-director/continuity-director-state.ts`
- Create: `src/engine/modes/roleplay/continuity-director/continuity-director-state.spec.ts`

**Steps:**

1. Write failing tests for missing-state defaults, version normalization, bounds, stable ordering, and every permitted state transition.
2. Add the versioned state, arc, thread, beat, source-snapshot, and command types. Export only contracts needed across layers.
3. Add `roleplayContinuityDirector?: RoleplayContinuityDirectorState` to `ChatMetadata`.
4. Implement one pure command reducer for enable/disable, connection selection, arc/thread/beat edits, approve, defer, reject, fulfill, reorder, and reroll.
5. Make local code—not model output—assign IDs, timestamps, revision increments, approval status, and list positions.
6. Treat an edited director item as user-authored so later refreshes cannot overwrite it.
7. Normalize malformed or future-version metadata to disabled without throwing; retain the raw chat and ordinary generation path.
8. Run:

   ```powershell
   pnpm vitest run src/engine/modes/roleplay/continuity-director/continuity-director-state.spec.ts
   pnpm typecheck
   ```

   Expected: transition tests pass and `ChatMetadata` consumers compile without casts.

### Task 2: Build the read-only planning input and guarded planner

**Files:**

- Create: `src/engine/modes/roleplay/continuity-director/continuity-director-source.ts`
- Create: `src/engine/modes/roleplay/continuity-director/continuity-director-source.spec.ts`
- Create: `src/engine/modes/roleplay/continuity-director/continuity-director-safety.ts`
- Create: `src/engine/modes/roleplay/continuity-director/continuity-director-safety.spec.ts`
- Create: `src/engine/modes/roleplay/continuity-director/continuity-director-planner.ts`
- Create: `src/engine/modes/roleplay/continuity-director/continuity-director-planner.spec.ts`

**Steps:**

1. Write source-builder tests proving it reads only the current Roleplay chat, the newest active/pinned story arc and episodes, unresolved hooks/current state, the visible transcript tail, relevant character identities, and bounded character-knowledge edges.
2. Exclude hidden messages and unrelated chats. Include source IDs in the normalized input and compute a deterministic fingerprint from meaning-bearing fields only.
3. Use knowledge edges only to prevent impossible knowledge leaps. The director must not modify those edges or turn secret knowledge into mandatory user-persona behavior.
4. Write safety tests for exact dialogue, speaker labels, second-person/user-persona deliberate verbs, asserted beliefs/intents, and strategic choices. Include negative controls for environmental pressure, involuntary sensation, and non-user-character action.
5. Implement a dedicated beat validator. Do not call the finished-prose quality analyzer as a shortcut: director restrictions apply regardless of the Roleplay agency preset.
6. Define a strict JSON response schema containing candidate arc text, threads, and proposed beats only. The model must not return persistence IDs, approval status, timestamps, or executable instructions.
7. Resolve the selected connection as follows:
   - explicit director override when configured;
   - otherwise the chat's writer connection;
   - no silent fallback when an explicit override is missing or unavailable.
8. Use a bounded request, low temperature, and a 30-second abort signal. Parse fenced or plain JSON, validate every field, reject the entire candidate when the response is malformed, and reject only individually unsafe beats when the envelope is otherwise valid.
9. Before persisting, reload current metadata and merge against its latest `revision`. Preserve every user-authored or non-proposed item according to the merge table above. Concurrent refreshes for the same chat must coalesce or reject; last-finishing model output must not overwrite newer user edits.
10. On any model, parse, validation, timeout, or storage error, return a typed error and do not patch metadata.
11. Run:

```powershell
pnpm vitest run src/engine/modes/roleplay/continuity-director/continuity-director-source.spec.ts
pnpm vitest run src/engine/modes/roleplay/continuity-director/continuity-director-safety.spec.ts
pnpm vitest run src/engine/modes/roleplay/continuity-director/continuity-director-planner.spec.ts
```

Expected: stale-write, malformed-output, unavailable-override, timeout, unsafe-beat, and successful-refresh cases pass without mutating any non-director resource.

### Task 3: Inject only approved guidance and preserve exact evidence

**Files:**

- Create: `src/engine/modes/roleplay/continuity-director/continuity-director-context.ts`
- Create: `src/engine/modes/roleplay/continuity-director/continuity-director-context.spec.ts`
- Modify: `src/engine/contracts/types/chat.ts`
- Modify: `src/engine/generation/prompt-assembly.ts`
- Create: `src/engine/generation/prompt-assembly.continuity-director.spec.ts`
- Modify: `src/features/modes/shared/chat-ui/lib/prompt-attribution.ts`
- Modify: `src/features/modes/shared/chat-ui/lib/prompt-attribution.spec.ts`
- Modify: `tests/unit/generation-replay.spec.ts`

**Steps:**

1. Add `continuity_director` to `ContextAttributionItem.kind` and label it `Continuity Director` in the prompt-inspector grouping model.
2. Write projector tests proving output is empty when the chat is not Roleplay, metadata is missing, the feature is disabled, or no approved active beats exist.
3. Build one bounded block from approved beats in user-defined order. Do not include proposed, deferred, rejected, fulfilled, or invalid entries.
4. Put explicit authority text in the block: the latest user request wins; beats are optional structural guidance; the model must not supply the user persona's dialogue, deliberate action, belief, intent, or strategic choice.
5. Integrate the block into Roleplay prompt assembly before the latest user message so ordinary message ordering reinforces the same precedence.
6. Emit one attribution item per included beat with its beat ID, chat ID, exact text snippet, plan revision, order, and status. Do not recompute or broaden the content when rendering the saved snapshot.
7. Verify the existing `GenerationPromptSnapshot.contextAttribution` plumbing saves the exact items used. Add an integration assertion if the assembly test alone does not cross the snapshot boundary.
8. Extend replay compatibility tests: legacy `director` and other retired narrative-agent injections remain non-replayable, while the current metadata plan is projected normally and is not represented as an agent injection.
9. Run:

   ```powershell
   pnpm vitest run src/engine/modes/roleplay/continuity-director/continuity-director-context.spec.ts
   pnpm vitest run src/engine/generation/prompt-assembly.continuity-director.spec.ts
   pnpm vitest run src/features/modes/shared/chat-ui/lib/prompt-attribution.spec.ts
   pnpm vitest run tests/unit/generation-replay.spec.ts
   ```

   Expected: the exact approved text appears once in assembly and attribution, user steering remains later/higher authority, and retired agent content remains absent.

### Task 4: Expose one typed persistence and refresh boundary

**Files:**

- Create: `src/shared/api/roleplay-continuity-director-api.ts`
- Create: `src/shared/api/roleplay-continuity-director-api.spec.ts`
- Create: `src/features/modes/roleplay/hooks/use-continuity-director.ts`
- Create: `src/features/modes/roleplay/hooks/use-continuity-director.spec.tsx`

**Steps:**

1. Write failing API tests around load, pure-command patch, manual refresh, stale revision, and error preservation.
2. Compose the existing `storageApi.patchChatMetadata` and `llmApi` ports in a narrow API. Do not call Tauri directly and do not add a storage collection.
3. Return the normalized state plus a derived stale flag. Keep failures typed so the UI can distinguish unavailable connection, timeout, invalid output, unsafe output, and persistence failure.
4. Add a Roleplay hook with a chat-scoped query key, command mutation, manual-refresh mutation, focused invalidation, and cancellation when the active chat changes.
5. Keep the last valid query data visible through refresh failure. Do not optimistically approve/reject unless rollback is implemented and tested.
6. Run:

   ```powershell
   pnpm vitest run src/shared/api/roleplay-continuity-director-api.spec.ts
   pnpm vitest run src/features/modes/roleplay/hooks/use-continuity-director.spec.tsx
   ```

   Expected: metadata patches contain only `roleplayContinuityDirector`, stale writes cannot clobber a newer revision, and failed refreshes retain the displayed plan.

### Task 5: Build the Roleplay-owned editor and wire discoverability

**Files:**

- Create: `src/features/modes/roleplay/components/RoleplayContinuityDirectorModal.tsx`
- Create: `src/features/modes/roleplay/components/RoleplayContinuityDirectorModal.spec.tsx`
- Modify: `src/features/modes/roleplay/components/ChatRoleplaySurface.tsx`
- Modify: `src/features/modes/shared/chat-ui/components/settings/ContinuityOverviewPanel.tsx`
- Modify: `src/features/modes/shared/chat-ui/components/settings/ContinuityOverviewPanel.spec.tsx`
- Modify: `src/features/modes/shared/chat-ui/components/settings/StoryContinuityModal.tsx`
- Modify: `src/features/modes/shared/chat-ui/components/ChatCommonOverlays.tsx`
- Modify: `src/features/modes/shared/chat-ui/components/settings/ChatSettingsDrawer.tsx`
- Modify: `src/features/shell/discovery/discovery-entries.json`
- Modify: `src/features/shell/discovery/discovery-registry.spec.ts`

**Steps:**

1. Write modal tests for disabled, empty, loading, stale, success, and failed-refresh states; connection override; arc/thread edits; every beat action; accessible reorder; and preserved data after an error.
2. Build a lazy-loaded Roleplay modal with:
   - enable toggle;
   - explicit connection selector with `Use chat model` as the null value;
   - current-arc editor;
   - editable open-thread list;
   - ordered beat cards with visible text statuses;
   - approve, defer, reject, fulfill, edit, reroll, move-up, and move-down actions;
   - `Refresh plan` plus stale/source summary;
   - clear non-destructive error feedback.
3. Use buttons for reordering instead of a drag-only interaction. Give every icon control an accessible name, show focus rings, and make status understandable without color.
4. Add a Continuity Director action to the always-available Roleplay toolbar in `ChatRoleplaySurface`; it must not depend on the retired agents feature flag or live inside the Agents menu.
5. Let shared continuity settings receive a mode-owned `onOpenContinuityDirector` callback. Show the action only for Roleplay; shared UI must not import the director hook, service, or state reducer.
6. Add/update the discovery entry so search opens the Roleplay continuity area from which the director editor is one explicit action away. Assert title, keywords, destination, and Roleplay availability.
7. Verify responsive behavior at narrow width: editor sections stack, text never clips, beat actions wrap, and the modal remains keyboard-scrollable.
8. Run:

   ```powershell
   pnpm vitest run src/features/modes/roleplay/components/RoleplayContinuityDirectorModal.spec.tsx
   pnpm vitest run src/features/modes/shared/chat-ui/components/settings/ContinuityOverviewPanel.spec.tsx
   pnpm vitest run src/features/shell/discovery/discovery-registry.spec.ts
   pnpm check:discovery
   pnpm typecheck
   ```

   Expected: the feature is reachable from Roleplay and Discover, shared components only receive callbacks/view data, and all editor actions persist through the typed boundary.

### Task 6: Document and prove Slice 1 as an independent release

**Files:**

- Modify: `AGENTS.md`
- Modify: `docs/REFACTOR_PARITY_PIPELINE.md`
- Modify: `docs/canonical-memory-architecture.md`
- Modify: `docs/database-schema.md`
- Modify: `docs/superpowers/plans/2026-09-02-roleplay-continuity-director.md` only if implementation findings require an explicit deviation note

**Steps:**

1. Add the continuity-director engine and Roleplay UI owners to the repository map.
2. Document that this is a user-visible plan resource, not a retired hidden agent, canonical-memory record, agent scratchpad, or prose generator.
3. Document the chat-metadata storage decision and why no Rust schema/collection was added.
4. Run the focused suites from Tasks 1–5, then:

   ```powershell
   pnpm check
   pnpm typecheck
   pnpm test
   pnpm check:docs
   pnpm check:architecture
   pnpm check:discovery
   pnpm check:unused
   ```

5. Browser-proof the actual Roleplay path:
   - feature starts disabled and contributes no prompt text;
   - enable and manually refresh;
   - edit, reorder, approve, defer, reject, fulfill, and reroll;
   - reload the app and confirm all decisions persist;
   - send a user instruction contradicting an approved beat and confirm the reply follows the user;
   - inspect the saved prompt snapshot and verify the exact approved beat attribution;
   - simulate malformed output and timeout, then confirm the prior plan and normal reply generation still work;
   - check desktop, narrow/mobile, keyboard-only, light theme, and dark theme.
6. Stop here for Slice 1 review. Do not hide a cadence implementation in the same change.

---

## Slice 2 — Opt-In Scene and Cadence Refresh

### Task 7: Add safe refresh policy decisions

**Files:**

- Modify: `src/engine/contracts/types/roleplay-continuity-director.ts`
- Create: `src/engine/modes/roleplay/continuity-director/continuity-director-refresh-policy.ts`
- Create: `src/engine/modes/roleplay/continuity-director/continuity-director-refresh-policy.spec.ts`
- Modify: `src/features/modes/roleplay/components/RoleplayContinuityDirectorModal.tsx`
- Modify: `src/features/modes/roleplay/components/RoleplayContinuityDirectorModal.spec.tsx`

**Steps:**

1. Write a pure decision table for `manual`, `scene_events`, and `cadence` modes. Default remains `manual`.
2. Scene-event refreshes are eligible only after a successful scene creation or conclusion and only when the source fingerprint changed.
3. Cadence refreshes are eligible only after a successfully saved assistant reply, the configured number of visible assistant turns has elapsed since the plan snapshot, and no refresh for that chat is already pending.
4. Bound cadence choices to a deliberately low range such as 5, 10, or 20 assistant turns. Do not offer every-turn refresh.
5. Add the policy controls to the modal with plain-language cost/latency consequences.
6. Run the policy and modal suites.

### Task 8: Schedule automation outside the writer critical path

**Files:**

- Create: `src/engine/modes/roleplay/continuity-director/continuity-director-scheduler.ts`
- Create: `src/engine/modes/roleplay/continuity-director/continuity-director-scheduler.spec.ts`
- Modify: `src/features/modes/roleplay/hooks/use-scene.ts`
- Modify: `src/engine/generation/start-generation.ts`
- Create or modify the narrow `start-generation` and scene-hook specs selected during implementation

**Steps:**

1. Add a deduplicating, best-effort scheduler around the same guarded planner used by manual refresh.
2. From the Roleplay scene composition hook, enqueue refresh only after successful scene creation/conclusion. Do not make scene completion wait for planning.
3. After a Roleplay assistant message is durably saved, ask the pure policy whether cadence is due and enqueue if eligible.
4. A queued refresh must reload the latest metadata and re-check the policy before calling the model.
5. Catch and report refresh failures through diagnostics/UI state without rejecting the generation result, altering the saved assistant message, or clearing the prior plan.
6. Test disabled/manual modes, due/not-due cadence, source fingerprint changes, overlapping requests, chat switches, failed planner calls, and successful non-blocking scheduling.
7. Run the focused scheduler/integration suites followed by the full validation commands from Task 6.
8. Browser-proof scene creation, scene conclusion, and one cadence boundary with a deliberately failing director connection. Confirm the writer reply still completes and the existing plan remains usable.

---

## Acceptance Trace

| Issue requirement                          | Primary proof                                            |
| ------------------------------------------ | -------------------------------------------------------- |
| No text unless enabled and approved        | Context projector unit test + prompt snapshot inspection |
| Edit/reject decisions persist              | State reducer, API, reload, branch/replay checks         |
| Explicit user steering wins                | Prompt ordering test + browser contradiction case        |
| No mutation of other resources             | Planner capability surface and API patch assertion       |
| Exact inspector/snapshot evidence          | Attribution grouping and saved snapshot assertion        |
| Malformed/timeout is non-destructive       | Planner failure tests + browser failing-connection case  |
| Approval/rejection/stale refresh           | State, planner merge, and UI suites                      |
| Retired-agent compatibility                | `generation-replay.spec.ts`                              |
| Cheaper/local model override               | Planner resolution and modal tests                       |
| Optional cadence is low-frequency and safe | Slice 2 policy/scheduler tests                           |

## Explicit Non-Goals

- Autonomous world simulation.
- Numeric relationship simulation.
- First-class secret or character-knowledge modeling beyond read-only planning constraints.
- Rewriting or post-processing writer prose.
- Director-authored user dialogue or agency.
- Restoring retired narrative agents or their injection/replay path.
- A new Rust storage collection or migration for plan state.
- Background refresh enabled by default.
