# Conversation Status Variety Design

## Goal

Make generated Conversation character statuses feel like distinct, character-authored Discord custom statuses instead of repeated retrospective paraphrases such as "thinking about yesterday."

## Confirmed failure

The status service overwrites one current message without retaining prior messages, so neither the prompt nor the engine can detect repetition. Every timed refresh receives the same long-lived chat summary, five character memories, and recent reply text. That stable continuity is presented alongside instructions to be specific and reactive, which repeatedly makes the same past event the easiest subject.

The service also reads only legacy `characterSchedules`. De-Koi's current availability owner prefers fuzzy `characterRoutines`, but routine-derived status and activity reach character extensions only when another path synchronizes them. Status blurbs can run while autonomous messaging is disabled, so their activity input can remain stale or fall back to `free time`.

## Chosen fix

Keep the fix in the Conversation-owned TypeScript status package. `status-message.service.ts` continues to own storage, LLM calls, and orchestration. A focused sibling, `status-message-variety.ts`, owns pure angle rotation, bounded history, and similarity policy so the already-large service does not gain another responsibility.

Resolve current availability from the same profile precedence used elsewhere: a valid fuzzy routine first, then a legacy schedule, then stored character extensions. Reuse `getAvailabilityDecision` rather than duplicating routine timing rules.

Persist a bounded six-message history inside `conversationStatusMessageMeta`, including the current accepted message. Persist the last selected status angle as an additive optional field so existing character records remain readable.

Rotate deterministically through six status angles:

1. current activity
2. social availability
3. throwaway joke, complaint, or mundane observation
4. small current interest or craving
5. minimal low-effort fragment
6. occasional continuity callback

Only the continuity angle receives chat summaries and character memories. Typing evidence remains available on every angle, but the prompt explicitly limits it to voice and formatting rather than subject matter. The prompt includes recent statuses as forbidden wording and topic examples.

Normalize accepted messages for comparison. Reject exact matches, containment variants, and high token-overlap variants against the bounded history. If the first result is too similar, advance to the next angle and retry once with the rejected result also listed. If the retry is empty or still too similar, preserve the previous valid status while advancing its next-refresh metadata so the 30-second poll does not repeatedly charge the provider for rejected output.

## Safety and compatibility

- Existing `conversationStatusMessageMeta` records without history or angle fields remain valid.
- Status messages remain capped at 96 characters and retain the existing JSON/plain-text parser safeguards.
- Provider empty-output retry behavior remains unchanged; duplicate handling adds at most one status-generation attempt.
- No new storage collection, migration, capability, React, shared API, Rust, or remote-runtime behavior is introduced.
- Only Conversation mode changes. Roleplay and game do not import or call this service.
- Refresh cadence remains unchanged; this fix changes input freshness and content diversity, not timer behavior.

## Proof

- A routine-only chat must expose the routine-derived activity and availability to the status prompt.
- Consecutive refreshes must persist bounded history, rotate angles, and exclude continuity from non-continuity prompts.
- A near-duplicate first result must trigger one retry using the next angle; an accepted retry must be stored.
- A second near-duplicate must leave the previous valid status untouched.
- Existing parser, prompt-style, refresh-gating, provider-retry, typecheck, and architecture tests must remain green.
