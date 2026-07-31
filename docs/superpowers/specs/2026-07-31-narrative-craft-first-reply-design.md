# Narrative Craft First-Reply Design

## Goal

Make new De-Koi roleplay feel less mechanically AI-shaped from its first generated reply without adding another foreground model call, then begin story-specific Narrative Craft feedback after that first generated reply.

## Design

When Narrative Craft is active, the generation runtime always contributes a compact baseline craft directive before the writer call. The directive asks the existing writer model to perform one silent shape pass while preserving requested content, character voice, intentional repetition, direct emotion, and genre-appropriate flourish. It targets the recurring StoryScope-associated defaults observed in the Harlequin opening: stacked fragments or polished triplets, contrast pivots, explanation after an image, stock physiological cues, automatic setting mirrors, and endings that restate the beat. It explicitly forbids replacing those defaults with a new fixed formula.

The baseline directive is deterministic prompt text. It adds no provider request and no foreground orchestration stage. If a prior Narrative Craft analysis produced story-specific guidance, the runtime combines that guidance with the baseline rather than replacing either one.

The background critic keeps its detached execution and shared foreground lease. For a chat with no saved Narrative Craft state, it analyzes the first completed generated assistant response even when the cheap recurrence detector finds no candidate. That result, including a valid no-intervention result, persists state and establishes the ordinary cadence anchor. Later analyses retain the configured four-assistant-message cadence and cheap recurrence gate.

Explicit replay injection overrides remain authoritative and do not receive newly synthesized baseline guidance. Chats without Narrative Craft remain unchanged. Legacy Narrative Craft state continues to count as established state, avoiding a surprise first-run critic for migrated chats.

## Error Handling

Baseline guidance is static and cannot fail independently. Background failures retain the existing fail-open behavior: the visible reply is already saved, errors are recorded through diagnostics, and no false guidance is persisted. Foreground generation continues to abort queued or in-flight critic work before the next writer call.

## Verification

- Focused runtime tests prove baseline guidance exists on the first generated turn and composes with one-use story-specific guidance.
- Focused runtime tests prove the first completed response is analyzed without a recurrence signal, while established state still requires the recurrence gate and cadence.
- The start-generation integration test proves the critic remains detached from visible reply completion.
- A temporary, uncommitted Harlequin evaluation compares the current opening against a same-context treatment and runs the pinned StoryScope lane plus blind quality checks.
- `pnpm check:architecture`, `pnpm check`, Bunny, hosted CI, and exact Pi image/runtime verification close the shipping lane.

## Scope

This change does not add synchronous rewriting, production StoryScope calls, a detector score, new settings, storage formats, provider routes, or UI. It does not promise every individual response will be classified as human.
