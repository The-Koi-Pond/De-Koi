# Conversation Time Continuity Design

## Problem

Conversation prompts include the current local date and time, but visible history messages lose their persisted `createdAt` values when converted to ChatML. A character therefore sees an old "goodnight" immediately beside a new user message and can treat both as one continuous nighttime exchange.

## Design

Keep this behavior owned by conversation prompt assembly. For an ordinary user turn, find the newest visible user message and the visible message immediately before it. When both timestamps are valid and at least 30 minutes apart, append compact transition facts to the existing `conversation_presence` block:

- the previous message's zoned date and time;
- the latest user message's zoned date and time;
- the elapsed duration;
- whether the user's local calendar date changed; and
- guidance to treat the new message as a later interaction without mentioning timestamp machinery unless relevant.

Do not annotate every history message. Do not add transition context to regenerations, impersonation, non-conversation modes, missing/invalid timestamps, clock-skewed rows, or short gaps that remain one conversational session.

## Verification

Use the public `assembleGenerationPrompt` seam with a fake clock. Cover an overnight New York gap, a short same-session gap, and regeneration suppression. Run the focused Vitest file and TypeScript typecheck.
