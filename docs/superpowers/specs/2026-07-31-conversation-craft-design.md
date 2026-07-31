# Conversation Craft Design

## Goal

Make one-on-one and group Conversation Mode replies feel like natural, character-specific texting from the first response, then improve later responses from observed mistakes without adding a blocking model call or requiring user setup.

## Constraints

- The first generated reply receives useful guidance before any completed assistant message exists.
- Foreground generation still makes exactly one writer/provider call unless an unrelated existing feature already requires more.
- Adaptive analysis runs only after the assistant message has been saved and the `done` event has been emitted.
- Starting any foreground generation cancels pending or active craft analysis so it cannot compete with the writer.
- One-on-one and group conversations use different quality rubrics.
- Explicit user or character style instructions remain authoritative.
- The background critic uses De-Koi's configured default Agent connection and model. Existing connection fallback behavior remains available when no Agent default exists.
- No React, Tauri, Rust, storage-schema, provider-transport, or new network boundary is introduced.

## Chosen Architecture

Reuse the hidden `narrative-craft` Agent runtime in Conversation Mode, selecting a Conversation-specific prompt and evidence gate there. This preserves the configured Agent-model fallback, cadence, memory, and detached lifecycle without shipping a duplicate built-in or runtime.

Conversation Craft has two layers:

1. A compact baseline instruction is injected exactly once into every generated Conversation Mode prompt, including custom conversation prompts and direct-message generation paths. It costs prompt tokens but no additional provider call.
2. A detached post-save analysis uses the configured Agent model after the response is visible. Its validated, compact directive is consumed once by the next reply and then cleared.

The baseline is core Conversation Mode behavior and remains active when chat Agents are disabled. Adaptive analysis respects the Agent enablement setting and silently skips when no runnable model exists.

## Baseline Guidance

The baseline supplements, rather than duplicates, the existing Conversation Mode system prompt. It tells the writer to:

- answer the actual message without paraphrasing it first;
- avoid assistant framing, canned validation, therapy language, and automatic offers to help;
- avoid polished triplets, symmetrical `not X but Y` pivots, recap endings, and forced closing questions;
- prefer the amount of text the moment warrants, including fragments, silence-like brevity, or uneven cadence;
- preserve character-specific casing, slang, directness, humor, and emotional avoidance instead of imposing generic messiness;
- keep output to message text rather than actions, narration, or stage directions;
- in groups, respond only to what that character would notice and keep voices distinct rather than answering every point;
- yield to explicit user, character-card, or chat-specific style requests.

The runtime places this in the existing final internal generation-guide block, after ordinary prompt context. Applied adaptive guidance is retained with the assistant message for observability, but remains non-replayable like Narrative Craft guidance; regeneration receives the stable baseline without consuming new pending advice.

## Adaptive Critic

The critic runs after the first saved assistant reply and then on the existing four-assistant-message cadence. It receives recent visible chat, the completed response, character/persona context, and the solo/group classification. Conversation runs do not receive roleplay Narrative Craft state.

It may classify at most one supported issue:

- `assistant-framing`
- `therapy-speak`
- `restatement`
- `forced-question`
- `overexplaining`
- `polished-shape`
- `voice-drift`
- `roleplay-formatting`
- `group-omnireply`
- `group-voice-collapse`

The model does not author arbitrary instructions. It returns an issue, exact evidence excerpts, and an intervention decision. Engine validation confirms that evidence occurs in recent assistant text, applies issue-specific evidence-count requirements, and maps the issue to a bounded deterministic directive. Invalid, unsupported, requested, or weakly evidenced findings produce no guidance.

## State and Persistence

Conversation Craft reuses Narrative Craft's versioned, chat-scoped memory envelope to store zero or one pending directive and the last analysis reason. The next generation atomically consumes the directive and clears it. Conversation chats have separate chat IDs, and their critic never receives roleplay state, so the shared storage mechanism does not blend the two rubrics.

## Scheduling and Group Behavior

Craft analysis uses a shared post-generation background queue with at most one active job per chat and latest-job-wins behavior for that chat. Narrative Craft and Conversation Craft share the foreground-priority cancellation mechanism, preventing either quality critic from competing with a new writer call.

Individual group responders naturally coalesce: each later responder starts foreground generation and cancels earlier analysis. The analysis that survives after the final responder sees the completed group context and emits group-level guidance, avoiding character-specific advice being incorrectly applied to every participant.

## Direct, Replay, and Failure Paths

- Normal and direct-message generation both receive exactly one Conversation Craft guide.
- Regeneration receives the stable baseline without replaying stale adaptive advice, consuming new pending guidance, or scheduling a new analysis.
- Impersonation does not run adaptive critique.
- Missing Agent configuration, invalid model output, persistence failure, timeout, or cancellation never delays or removes the visible reply.
- Diagnostics report background duration and outcome without exposing prompt contents.

## Evaluation

Automated contract tests must prove:

- solo and group first replies contain exactly one baseline guide;
- explicit style requests remain authoritative;
- the foreground provider is called once and `done` occurs before the critic call;
- first analysis runs after save, later analysis follows the four-message cadence, and state survives round trips;
- pending guidance is consumed once;
- direct-message and individual group-response paths cannot bypass the guide;
- regeneration replay remains stable;
- foreground generation cancels active analysis;
- malformed or unsupported critic output cannot become prompt guidance.

A scratch benchmark will compare baseline `origin/main` and treatment prompts across a balanced set of one-on-one and group texting scenarios using the same writer model and parameters. Blind judging will score human-texting naturalness, character fidelity, direct responsiveness, assistant/therapy leakage, formatting, brevity appropriateness, and group voice separation. Provider call order and time-to-`done` will be recorded separately from background analysis duration.

## Acceptance Criteria

- Treatment wins more blind quality comparisons than it loses across the full benchmark and both solo and group subsets have no catastrophic regression.
- The first response improves without waiting for a critic.
- There is no additional foreground provider call.
- Background work begins only after save/`done` and is cancelled by a new foreground generation.
- Targeted tests, typecheck, architecture checks, bundle budget, full repository checks, Bunny, and GitHub CI pass before merge.
- The Pi runs both server and web images labeled with the merge revision, returns HTTP 200 at the root and writable health endpoint, and preserves data and Codex mounts.

## Non-goals

- Rewriting already displayed messages.
- Using StoryScope as the primary Conversation Mode evaluator; its fiction-oriented signals are not a valid texting-quality target.
- Adding a Conversation Craft settings screen or requiring users to enable a new Agent manually.
- Changing response orchestration, schedules, autonomous messaging, provider transport, or chat persistence schemas.
