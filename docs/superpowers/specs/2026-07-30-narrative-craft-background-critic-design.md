# Narrative Craft Background Critic Design

## Goal

Reduce recurring AI-shaped fiction without delaying the reply being generated and without enabling an unproven intervention by default.

## Accepted architecture

Narrative Craft remains the compatibility replacement for Prose Guardian, Narrative Director, and Secret Plot Driver, but it no longer runs as a blocking pre-generation LLM call. When explicitly active, a completed assistant reply may be analyzed in a detached background job. A validated directive is stored as one pending guidance item, injected into the next eligible roleplay or visual-novel generation, and cleared as soon as that generation claims it.

The persisted state separates `pendingGuidance` from `lastGuidance`. `pendingGuidance` is the consume-once delivery queue; `lastGuidance` remains visible in the Narrative Craft panel as the most recent analysis outcome.

## Trigger and safety policy

- Narrative Craft is not included in new-chat defaults. Existing chats that explicitly enabled Narrative Craft or one of its retired predecessors remain compatible.
- Automatic analysis keeps the existing assistant-message cadence but runs only when a cheap deterministic recurrence filter finds a repeated prose-shape candidate across different assistant turns.
- Manual “Analyze now” bypasses the cheap trigger, runs against the selected completed assistant response, and stores any validated directive for the following generation.
- The existing evidence gate remains authoritative: two distinct exact prose excerpts and one supported issue are required before guidance can become pending.
- Regeneration does not replay or consume pending Narrative Craft guidance through saved injection overrides.

## Runtime data flow

1. Normal generation resolves active agents.
2. If Narrative Craft has pending guidance, the runtime atomically claims it from persisted state and adds it to the current prompt as a cached context injection.
3. The writer generates and saves the reply without waiting for Narrative Craft.
4. After the visible `done` event, a per-chat coalescing worker evaluates the cheap recurrence trigger.
5. If due and triggered, the worker runs Narrative Craft against the completed reply, persists its run record and normalized state, and leaves at most one pending directive for a later turn.
6. A newer scheduled analysis replaces an older queued-but-not-started analysis for the same chat; simultaneous Narrative Craft analyses for one chat are not allowed.
7. Starting another foreground generation for the chat aborts any in-flight Narrative Craft analysis so background work cannot contend with the writer.

## Failure behavior

Background failures are logged and reported through performance diagnostics but never alter or retract the saved reply. Foreground cancellation is expected and is not logged as an error. A failed or cancelled analysis does not create pending guidance. Claiming guidance clears only `pendingGuidance`; the story state and last visible guidance remain intact.

## Proof requirements

- Focused unit tests prove default-off behavior, trigger positive and negative controls, detached scheduling, per-chat coalescing, completed-response evidence grounding, and consume-once guidance.
- Generation integration tests prove no Narrative Craft LLM request occurs before the main reply and that cached guidance appears on exactly one later generation.
- `pnpm typecheck` and `pnpm check:architecture` pass.
- The StoryScope challenge run reports intervention-only deltas, blind-quality preference, activation rate, and measured foreground latency. Narrative Craft remains default-off unless interventions improve StoryScope, blind quality is non-inferior, and foreground overhead stays below 100 ms at p95.
