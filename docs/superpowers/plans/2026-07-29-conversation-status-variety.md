# Conversation Status Variety Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate varied, routine-aware Conversation character statuses while preserving the last valid status when a provider repeats itself.

**Architecture:** The existing Conversation status package remains the owner. The service reuses the schedule service's normalized routine/schedule availability decision and performs a single prompt-level duplicate retry. A focused pure sibling owns bounded history, deterministic angle rotation, and similarity policy.

**Tech Stack:** TypeScript, De-Koi engine capability ports, Vitest, pnpm.

## Global Constraints

- Conversation mode owns all changed behavior; roleplay and game must not change.
- No React, shared API, Rust, storage collection, migration, provider-transport, or remote-runtime changes.
- Existing status metadata without history or angle fields remains readable.
- Recent status history is capped at six accepted messages.
- Duplicate handling adds at most one status-generation attempt.
- Refresh cadence and the 96-character persisted limit remain unchanged.
- Do not commit, push, open a PR, run Bunny, or start CI without explicit authorization.

---

## File Map

- Create `src/engine/modes/chat/status/status-message-variety.ts`: status-angle definitions, safe metadata state parsing, bounded history, deterministic rotation, and similarity detection.
- Create `src/engine/modes/chat/status/status-message-variety.spec.ts`: pure history, rotation, and similarity regressions.
- Modify `src/engine/modes/chat/status/status-message.service.ts`: routine-aware input resolution, prompt shaping, variety-policy orchestration, and one retry.
- Modify `src/engine/modes/chat/status/status-message.service.spec.ts`: focused routine, prompt, retry, and preserve-previous integration regressions.
- Add `docs/superpowers/specs/2026-07-29-conversation-status-variety-design.md`: approved behavior design.
- Add `docs/superpowers/plans/2026-07-29-conversation-status-variety.md`: test-first execution contract.

---

### Task 1: Prove routine-aware activity resolution

**Files:**

- Modify: `src/engine/modes/chat/status/status-message.service.spec.ts`
- Modify: `src/engine/modes/chat/status/status-message.service.ts`

**Interfaces:**

- Consumes: `getEnabledConversationRoutines(meta)`, `getEnabledConversationSchedules(meta)`, and `getAvailabilityDecision(profile, now)`.
- Produces: prompt fields whose availability and activity come from routine, schedule, or stored-extension precedence.

- [ ] **Step 1: Add a failing routine-only regression**

Create a status-enabled Conversation fixture with only `characterRoutines`, stale extension values, and a deterministic weekday-afternoon `now`. Capture the system prompt and assert it contains `Availability: dnd` and `Current activity: classes`, not the stale extension activity.

- [ ] **Step 2: Verify the red state**

Run:

```powershell
pnpm exec vitest run src/engine/modes/chat/status/status-message.service.spec.ts -t "uses fuzzy routine availability"
```

Expected: FAIL because the current service imports and reads only legacy schedules.

- [ ] **Step 3: Implement routine-first availability**

Import `getAvailabilityDecision` and `getEnabledConversationRoutines`. For each character, choose `routines[characterId] ?? schedules[characterId]`; when a profile exists, resolve it with `getAvailabilityDecision(profile, now)`. Preserve stored extension status/activity as the no-profile fallback.

- [ ] **Step 4: Verify the green state**

Run the same focused command. Expected: PASS.

---

### Task 2: Prove bounded history and rotating prompt angles

**Files:**

- Create: `src/engine/modes/chat/status/status-message-variety.spec.ts`
- Create: `src/engine/modes/chat/status/status-message-variety.ts`
- Modify: `src/engine/modes/chat/status/status-message.service.spec.ts`
- Modify: `src/engine/modes/chat/status/status-message.service.ts`

**Interfaces:**

- Produces: optional `recentMessages: string[]` and `angle: ConversationStatusAngleId` fields inside `conversationStatusMessageMeta`.
- Produces: a six-angle deterministic rotation and a prompt that lists recent statuses as forbidden repetitions.

- [ ] **Step 1: Add failing prompt/history tests**

Add pure tests for reading a legacy current status, capping accepted history at six messages, selecting a deterministic first angle, and rotating from each persisted angle to the next.

Add an integration test that starts with a valid current status plus metadata history. Capture the prompt and assert:

```ts
expect(systemPrompt).toContain("<recent_statuses>");
expect(systemPrompt).toContain("thinking about yesterday");
expect(systemPrompt).toContain("Do not repeat their wording, opening, topic, or central idea");
expect(systemPrompt).toContain("Assigned status angle:");
```

After an accepted result, assert history is capped to the newest six messages and the persisted angle advances on the next refresh.

- [ ] **Step 2: Verify the red state**

Run:

```powershell
pnpm exec vitest run src/engine/modes/chat/status/status-message.service.spec.ts -t "recent statuses|rotates status angles|caps status history"
```

Expected: FAIL because no history or angle contract exists.

- [ ] **Step 3: Implement the prompt state**

In `status-message-variety.ts`, add six literal angle definitions, safe readers for optional history/angle metadata, deterministic first-angle selection from the character ID, next-angle selection from the prior accepted angle, and bounded accepted-history construction.

In the service, include recent statuses in the prompt. Pass recent continuity only for the continuity angle, and state that typing evidence controls style rather than subject matter.

On persistence, append the accepted message, deduplicate exact normalized entries, retain the newest six, and store the accepted angle.

- [ ] **Step 4: Verify the green state**

Run the same focused command. Expected: PASS.

---

### Task 3: Prove one guarded retry for near-duplicates

**Files:**

- Modify: `src/engine/modes/chat/status/status-message.service.spec.ts`
- Modify: `src/engine/modes/chat/status/status-message.service.ts`

**Interfaces:**

- Produces: `isRepeatedStatusMessage(candidate: string, recentMessages: string[]): boolean` from `status-message-variety.ts`.
- Produces: at most two logical generation attempts for normal status output; the second attempt uses the next angle.

- [ ] **Step 1: Add failing duplicate tests**

First add pure similarity cases for exact normalized equality, meaningful containment, high token overlap, and clearly different short messages.

Then use an LLM harness returning `still thinking about yesterday` after stored `thinking about yesterday`, followed by `coffee has become structural`. Assert two requests, a changed assigned angle on request two, and persistence of only the accepted second result.

Add a second test returning two near-duplicates. Assert two requests, that the old current message and history remain unchanged, and that the next-refresh timestamp and last attempted angle advance. Call the service again 30 seconds later and prove it does not invoke the provider again.

- [ ] **Step 2: Verify the red state**

Run:

```powershell
pnpm exec vitest run src/engine/modes/chat/status/status-message-variety.spec.ts src/engine/modes/chat/status/status-message.service.spec.ts -t "detects near-duplicate|retries a near-duplicate|preserves the previous status"
```

Expected: FAIL because the current service accepts the first non-empty output.

- [ ] **Step 3: Implement normalized similarity and retry**

In the pure variety module, normalize case, whitespace, and punctuation. Treat exact normalized equality and meaningful containment as repeats. For messages with at least three distinct tokens, treat Jaccard token overlap of `0.6` or greater as a repeat.

Generate with the selected angle. If the parsed output repeats recent history, advance one angle, include the rejected attempt with the recent statuses, and call the existing completion path once more. Persist only a non-empty, non-repeated result. If both attempts repeat, preserve the current message and history but persist the current source status/activity, last attempted angle, and a fresh `nextRefreshAt` before adding the character to `skipped`.

- [ ] **Step 4: Verify the green state**

Run the same focused command. Expected: PASS.

---

### Task 4: Verify the complete Conversation status lane

**Files:**

- Verify only after Tasks 1-3.

- [ ] **Step 1: Run the complete focused suite**

```powershell
pnpm exec vitest run src/engine/modes/chat/status/status-message-variety.spec.ts src/engine/modes/chat/status/status-message.service.spec.ts src/engine/contracts/constants/conversation-prompt.spec.ts src/engine/modes/chat/schedules/schedule.service.spec.ts
```

Expected: PASS with zero failures.

- [ ] **Step 2: Run TypeScript and architecture checks**

```powershell
pnpm typecheck
pnpm check:architecture
```

Expected: both exit with code 0.

- [ ] **Step 3: Inspect the scoped diff and cleanup**

```powershell
git diff --check
git diff -- src/engine/modes/chat/status/status-message-variety.ts src/engine/modes/chat/status/status-message-variety.spec.ts src/engine/modes/chat/status/status-message.service.ts src/engine/modes/chat/status/status-message.service.spec.ts docs/superpowers/specs/2026-07-29-conversation-status-variety-design.md docs/superpowers/plans/2026-07-29-conversation-status-variety.md
rg -n "DEBUG-" src/engine/modes/chat/status
```

Expected: no whitespace errors, temporary diagnostics, placeholders, or unrelated files.

---

## Plan Self-Review Checklist

- Spec coverage: routine precedence, six-message history, six-angle rotation, continuity throttling, duplicate retry, and preserve-previous behavior each have a task.
- Type consistency: the metadata fields and angle identifiers are defined once in the pure status-variety sibling and consumed by the service.
- Scope: one Conversation engine package, its focused tests, and the approved design/plan docs.
- Test discipline: every production behavior starts with a focused failing test.
- Repository policy: no commit or shipping action is included.
