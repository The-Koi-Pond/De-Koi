# Background Conversation Summary Backfill Design

## Goal

Remove automatic conversation-summary LLM calls from the foreground generation critical path so an active character can begin responding without waiting for historical summary maintenance.

## Confirmed Problem

`startGeneration` currently awaits `backfillConversationSummaries` before prompt assembly. The backfill may process up to fourteen missing days sequentially, split a long day into multiple provider calls, consolidate a completed week with another provider call, and allow up to five minutes per call. The main model stream cannot begin until that work finishes.

The existing generation-level test intentionally proves this blocking order. That contract is the regression to replace.

## Scope

This change affects conversation mode only:

- Conversation summary orchestration in `src/engine/modes/chat/core/summaries`.
- Conversation branches in the shared generation lifecycle in `src/engine/generation/start-generation.ts`.
- Focused engine tests for foreground ordering, background scheduling, cancellation, and persistence.

The change does not alter roleplay summaries, game state, prompt formats, provider transport, React UI, shared API adapters, Rust commands, storage schemas, or remote-runtime dispatch.

## Chosen Architecture

Use a cancelable, single-flight, in-memory background coordinator owned by the conversation summary package.

The coordinator receives the existing `StorageGateway` and `LlmGateway` ports. It calls the existing `backfillConversationSummaries` service with `maxMissingDays: 1`, so each completed foreground turn schedules at most one missing day of work. Missing dates in persisted chat metadata remain the durable source of truth; no separate job entity is required.

Workers are keyed by storage gateway and chat ID. A `WeakMap<StorageGateway, Map<string, ActiveWorker>>` keeps embedded and remote-capable runtime instances isolated without retaining dead gateway instances. Each active worker owns an `AbortController` and its completion promise.

The coordinator exposes two engine-facing operations:

- Cancel the active background backfill for a chat before foreground generation starts.
- Schedule background backfill after a conversation assistant message has been saved.

Scheduling is synchronous from the caller's perspective: it starts background work and returns without awaiting completion. Repeated scheduling while a worker is active coalesces rather than creating concurrent provider calls.

## Foreground Lifecycle

1. Normalize and validate the generation input and chat ID.
2. Cancel any active background summary worker for that chat.
3. Continue saving the user message, loading context, assembling the prompt, and streaming the main response without invoking summary completion.
4. Use only summaries already persisted in chat metadata for the current prompt.
5. Save the assistant message and complete required foreground persistence.
6. If the mode is conversation and an assistant message was saved, schedule one background backfill attempt without awaiting it.
7. Emit the normal terminal generation event immediately.

Dry runs, user-message regeneration, failed generations without a saved assistant message, roleplay, and game do not schedule background summary maintenance.

## Background Lifecycle

1. Resolve the chat, connection, timezone, and existing summary metadata through the existing backfill service.
2. Process at most one missing historical day. Existing long-day chunking and completed-week consolidation remain unchanged and run off the foreground path.
3. Persist successful day/week entries through the existing `patchChatSummaries` capability.
4. Remove the worker from the active map only if it is still the registered worker for that chat.
5. Treat an abort as expected foreground preemption.
6. Record non-abort failures through the existing diagnostic/logging mechanism and leave the missing date unpersisted so a later completed turn can retry it.

The worker does not recursively drain the backlog. This prevents an old chat from monopolizing the selected provider. A backlog advances by at most one day per completed foreground turn or explicit existing summary retry action.

## Cancellation And Concurrency

Foreground generation always has priority.

Starting a new foreground generation aborts the same chat's active background worker before any new foreground provider work. The existing backfill service already forwards its `AbortSignal` to summary completion and propagates abort errors instead of recording them as failed summaries.

Different chats may have independent workers because they may use different connections. Same-chat scheduling coalesces into the active worker. Cancellation is scoped to the same storage gateway and chat ID; it cannot affect another runtime instance or sibling mode.

If a provider ignores cancellation, the foreground path still does not await the old promise. The worker's identity check prevents a late completion handler from clearing a newer worker registration.

## Prompt Freshness Tradeoff

The first foreground turn after a day becomes eligible for summarization may use the summaries already persisted plus the configured raw `summaryTailMessages` history. The newly generated day summary becomes available to a later turn.

This bounded lag is intentional: deterministic time-to-first-token takes priority over same-turn historical maintenance. No summary is fabricated or partially injected. If background work fails, later completed turns retry because the day remains missing, and the existing summary editor continues to provide manual retry controls.

This change does not redesign summary compaction. Expanding raw-history coverage while a summary backlog exists is a separate prompt-context policy decision and is out of scope.

## Error Handling And Observability

- Abort errors caused by foreground preemption are expected and do not produce user-facing errors.
- Provider, parsing, timeout, and persistence failures never fail the visible response.
- Non-abort failures include chat ID and stage in a client diagnostic or focused console warning without logging prompt or transcript content.
- Existing foreground generation timing diagnostics should show that `prepare-context` no longer includes summary LLM latency.
- No success toast or completion UI is added; this remains background maintenance.

## File Ownership

Expected implementation files:

- Create `src/engine/modes/chat/core/summaries/conversation-summary-background.ts` for worker registration, cancellation, scheduling, and diagnostics.
- Create `src/engine/modes/chat/core/summaries/conversation-summary-background.spec.ts` for single-flight and cancellation behavior.
- Modify `src/engine/generation/start-generation.ts` to remove awaited foreground backfill, cancel stale workers at conversation generation start, and schedule work after a saved assistant response.
- Modify `src/engine/generation/start-generation.conversation-summaries.test.ts` to replace the blocking-order contract with non-blocking foreground and next-turn persistence contracts.
- Reuse `src/engine/modes/chat/core/summaries/auto-summary.service.ts` unchanged unless a narrow exported abort classifier is required; prefer keeping error classification inside the coordinator.

No UI, shared API, Rust, or storage entity files should change.

## Verification Design

### Foreground regression

Use a deferred summary `llm.complete` promise and a main `llm.stream` spy. Prove the first main-stream event arrives while summary completion remains unresolved. The old implementation must fail this test because it awaits summary completion first.

### Single-flight scheduling

Schedule the same chat twice while completion is deferred. Prove only one summary completion call is active and both scheduling operations return immediately.

### Foreground preemption

Start a background summary, then begin foreground generation for the same chat. Prove the summary completion signal is aborted and the main stream still begins.

### Persistence visibility

Complete a background summary, then run a later generation. Prove its prompt includes the persisted summary without requiring another foreground summary call.

### Mode isolation

Run representative roleplay and game generation tests or existing focused suites. Prove neither mode schedules or cancels conversation summary workers.

### Commands

- `pnpm vitest run src/engine/modes/chat/core/summaries/auto-summary.service.test.ts src/engine/modes/chat/core/summaries/conversation-summary-background.spec.ts src/engine/generation/start-generation.conversation-summaries.test.ts`
- `pnpm typecheck`
- `pnpm check:architecture`
- Run the smallest existing roleplay and game generation suites selected during implementation after inspecting current test coverage.

## Acceptance Criteria

- A conversation response can begin streaming while historical summary completion is unresolved.
- Foreground generation never awaits automatic day/week backfill.
- Same-chat background work is single-flight and cancelable.
- Starting foreground generation preempts same-chat background provider work.
- At most one missing day is attempted per completed conversation turn.
- Successfully persisted summaries appear in later prompts.
- Background failures do not fail or delay the visible response.
- Roleplay and game behavior do not change.
- No new storage entity, migration, Rust command, remote-runtime route, or UI setting is introduced.

## Risks

- A summary can lag by one or more turns when the backlog is large or the provider repeatedly fails.
- Long single-day chunking can continue in the background until preempted.
- Providers that ignore abort signals may briefly compete with a new foreground request, although the foreground no longer waits for them.
- Existing summary compaction may expose only the configured raw tail until the missing summary is persisted.

These risks are preferable to blocking every visible response on unbounded maintenance work and are explicitly covered by cancellation, bounded scheduling, diagnostics, and focused tests.
