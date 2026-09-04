# Roleplay Workflow Guidance and Continuity Director Design

## Problem

The Roleplay workflow chooser presents implementation-oriented profile names and a dense change ledger before it answers the user's actual question: which setup fits this story? Users can see that profiles add agents or settings, but they are not told plainly when to choose each profile, what experience it creates, or how often it adds model calls.

The new Continuity Director has the opposite problem. It is a high-impact part of long-running story quality, but it is absent from the Longform Continuity workflow. A user can select the workflow intended for multi-scene stories and still receive a disabled Director that requires separate discovery, activation, refresh-policy configuration, and first-plan creation.

## Goals

1. Make the workflow chooser answer “What kind of roleplay are you setting up?” before exposing technical changes.
2. Give every workflow profile plain guidance for when to use it, what experience it produces, and what additional model activity to expect.
3. Make Continuity Director configuration automatic when Long-Running Story is applied.
4. Start the first Director proposal without requiring a separate Create plan action.
5. Preserve the rule that model output cannot approve its own story beats.
6. Give existing Longform Continuity users a clear upgrade path without silently adding background model calls.
7. Preserve reversible, conflict-aware workflow application and existing profile IDs.

## Non-Goals

- Do not enable Continuity Director for every Roleplay chat.
- Do not mutate chats that never applied Longform Continuity.
- Do not silently upgrade an existing version-1 Longform application.
- Do not auto-approve Director-generated beats.
- Do not replace the Continuity Checker. It reviews generated prose for contradictions; the Director proposes future story structure.
- Do not add a pricing calculator, onboarding survey, recommendation engine, or new global preference.
- Do not change Conversation or Game setup.

## User Experience

### Workflow question and cards

The chooser opens with the heading **What kind of roleplay are you setting up?** The four stable profile IDs remain unchanged, but their user-facing labels and summaries become outcome-oriented:

| Stable profile ID | User-facing label | Use this when | What it does | Model usage summary |
| --- | --- | --- | --- | --- |
| `minimal-clean` | Simple Roleplay | You want a short or casual chat and expect the main model to handle the story. | Uses the standard Roleplay prompt and memory recall without automatic helper agents. | No background helper calls. |
| `longform-continuity` | Long-Running Story | You are building a campaign or story that will span many scenes or sessions. | Tracks continuity, world state, summaries, and reviewable future story beats. | Uses occasional background calls, including Director planning every 10 assistant replies. |
| `cinematic` | Cinematic Roleplay | You care most about expressions, backgrounds, artwork, or music while chatting. | Adds visual presentation helpers; artwork and music remain optional. | Helper calls vary; selected image or music features may use external services. |
| `local-assist` | Local Helpers | You have the local sidecar configured and want supported background work routed locally. | Adds selected tracking and expression helpers without changing the writer connection. | Uses local helper calls and requires a ready sidecar. |

Each card displays three short, consistently ordered fields: **Best for**, **Adds**, and **Model use**. The selected card remains visually distinct and accessible as a radio option. The cards must remain readable in the existing single-column mobile layout; the design does not add a comparison table to the rendered UI.

The detailed change ledger remains below or beside the cards. It continues to be the confirmation surface for exact mutations, prerequisites, destinations, and reversible choices. It is supporting evidence, not the primary explanation of the profiles.

### Long-Running Story behavior

Applying `longform-continuity` version 2 selects these Director changes by default when the chat has no explicit Director choice:

- Enable Continuity Director.
- Use the chat's writer connection unless the user already selected a Director-specific connection.
- Set automatic refresh to cadence mode every 10 saved assistant replies.
- Queue the first plan proposal after the workflow application succeeds.

The first plan creation is detached from the workflow's durable write. Applying the workflow succeeds or fails based only on its validated chat patch. After a successful application, the feature layer starts a best-effort Director refresh when the Director was newly enabled and has no source snapshot. The UI reports these outcomes separately:

- **Workflow applied. Creating the first story plan in the background.**
- **Story plan ready for review.**
- **Workflow applied, but the first story plan could not be created. Open Continuity Director to retry.**

A failed or unavailable planning connection never rolls back the applied workflow, blocks chat generation, or clears an existing plan.

Successful creation also exposes a persistent **N beats to review** count on the existing Continuity Director entry points. The count is derived from persisted `proposed` beats rather than from an ephemeral notification, so it remains discoverable after the chooser or setup wizard closes. No badge appears when there are no proposed beats.

Generated beats remain `proposed`. Only a local user action may change a beat to `approved`, and only approved beats enter writer prompts. The workflow removes configuration chores; it does not delegate story-direction consent to the planning model.

### Existing Longform users

The Longform recipe version increases from 1 to 2. When a chat has a `roleplayWorkflowApplication` receipt for `longform-continuity` version 1, the chooser selects Long-Running Story and displays **Update available: add automatic story planning**. The update action opens the normal version-2 preview with the new Director rows selected when Director metadata is missing.

Existing chats are not mutated merely because they are opened. Users must apply the visible update, because version 2 introduces a new recurring model call. If a user explicitly configured or disabled the Director before updating, that state is preserved and the corresponding Director row is not selected by default.

## Engine and Persistence Design

`src/engine/modes/roleplay/workflow-profiles.ts` remains the owner of profile meaning. The recipe and resolution contracts gain enough information to describe the version-2 Director configuration and its user-facing call timing. Profile IDs stay stable; versions may differ by profile, with only `longform-continuity` advancing to version 2.

The Longform resolution adds independently selectable rows for Director enablement and its 10-reply refresh policy. The row labels and timing text must state that planning runs in the background and does not add writer-response latency.

Workflow application constructs the next Continuity Director state through the existing normalization and command-reducer boundary. It preserves current arc, threads, beats, connection override, timestamps, and source snapshot. It changes only selected configuration fields.

The workflow receipt remains non-content-bearing. It records the scalar fields `metadata.roleplayContinuityDirector.enabled`, `metadata.roleplayContinuityDirector.refreshMode`, and `metadata.roleplayContinuityDirector.refreshEveryAssistantTurns` separately rather than serializing arc, thread, or beat text. The workflow baseline and stale-preview comparison include those three configuration values plus whether a source snapshot exists; they do not copy plan content into the resolution or receipt. Conflict-aware revert restores a configuration field only when its current value still equals the value applied by the workflow. It never deletes or rewrites plan content, and it never overwrites a later user configuration change.

The workflow apply function remains a single storage update and does not gain LLM capabilities. Its result reports whether a newly enabled, snapshot-less Director should receive an initial refresh. The feature hook consumes that signal and invokes the existing shared Continuity Director API after persistence.

## Presentation Design

The profile-copy model becomes structured rather than relying on one overloaded description string. The chooser renders the same information at both wizard and settings-drawer entry points. Accessibility names continue to include the visible profile label, and selected/unavailable states remain exposed semantically.

The change ledger gains honest timing language. It must distinguish:

- no background call;
- one call when a helper runs;
- one non-blocking call every configured number of replies;
- optional external image or music activity;
- local-sidecar activity.

The existing aggregate “expected extra calls” label must not imply that differently scheduled work all occurs on every writer response. Replace it with a plain summary such as **Background model activity: occasional** when selected rows have mixed or scheduled timing. Exact timing remains visible on each selected row.

## Error and Concurrency Behavior

- Re-resolve capabilities and current chat state immediately before applying, as the current workflow does.
- Treat a changed Director configuration as a stale preview and require the user to review the refreshed ledger.
- Persist the workflow before starting first-plan creation.
- Deduplicate first-plan creation through the existing per-chat Director planner serialization.
- Keep workflow success visible if first-plan creation fails.
- Do not enqueue a first plan when Director enablement was not selected, the Director was disabled concurrently, or a source snapshot already exists.
- Do not replace a user-selected Director connection.
- Do not add a planning call when merely previewing profiles or opening the chooser.

## Verification

### Engine tests

- Longform version 2 exposes selected-by-default Director enablement and 10-reply cadence rows for an unset chat.
- Explicitly configured or disabled Director state is preserved and not selected by default.
- Other profiles do not change Director state.
- Applying selected Director rows preserves all story-plan content and connection choice.
- Receipts contain only scalar configuration values and no arc, thread, or beat text.
- Revert restores unchanged configuration fields, preserves plan content, and skips fields changed after application.
- Stale-preview detection includes concurrent Director configuration changes.

### Feature tests

- All four cards render their Best for, Adds, and Model use guidance in both wizard and drawer layouts.
- Stable IDs still map to the new user-facing labels.
- A version-1 Longform receipt displays the update affordance and selects Long-Running Story.
- Applying version 2 queues one detached initial refresh only when newly enabled and snapshot-less.
- Initial-refresh success and failure produce truthful, separate status messages.
- A failed initial refresh does not change the successful workflow result.
- Persisted proposed beats produce the correct review count on the existing Director entry points, and an empty proposal set produces no badge.
- Mobile ordering remains profiles first, ledger second, with no clipped guidance.

### Regression and shipping checks

Run the focused workflow profile, chooser, apply/revert, Continuity Director API, scheduler, and prompt-projection suites. Then run `pnpm check`, the full test suite, changed-file lint, `git diff --check`, browser verification at desktop and mobile widths, Bunny review, and hosted CI before merge.

## Acceptance Criteria

1. A new user can choose a workflow from the cards without opening the change ledger to understand the intended use case.
2. Applying Long-Running Story to an unset chat enables the Director, configures a 10-reply cadence, and starts the first proposal without another setup action.
3. No Director-generated beat influences writer output until the user approves it.
4. A generated proposal remains visibly reviewable after the workflow chooser closes.
5. Existing version-1 Longform users see a clear update rather than receiving silent new model usage.
6. Reverting or reapplying a workflow does not destroy Director plan content or overwrite later user choices.
7. Simple Roleplay, Cinematic Roleplay, Local Helpers, Conversation, and Game retain their existing behavioral boundaries.
