# Mobile Pending Message Stability Design

## Problem

On the Pi's browser UI, a newly sent user message can appear optimistically, disappear while the character is generating, and reappear near the end of generation.

The shared generation hook inserts an optimistic row without first cancelling an already-running messages query. A slow response from that older query can therefore replace the React Query cache with a snapshot that predates the new row. Later `user_message` or `assistant_message` events upsert the saved rows and make the message reappear.

## Design

Before inserting the optimistic user message, cancel the exact active messages query for that chat. This follows the existing `useCreateMessage` mutation pattern and prevents an older request from overwriting the optimistic row.

Keep the change inside `src/features/runtime/generation/hooks/use-generate.ts`. Do not add mode flags, storage fallbacks, a second pending-message store, or changes to the engine/runtime persistence contract.

## Verification

Add a focused regression test around `runGenerationWithUi` that:

1. Starts a controlled stale messages query.
2. Starts generation and observes the optimistic user row.
3. Releases the stale query while generation is still waiting.
4. Proves the sent row remains visible.

Then run the focused generation-hook tests and `pnpm typecheck`. Because the shared hook serves Conversation, Roleplay, and Game entry points, verify that regenerate and impersonate paths still skip optimistic user insertion.

## Scope

- Shared lower layer changed: frontend generation lifecycle cache coordination.
- Modes observing the change: Conversation, Roleplay, and Game sends that use `runGenerationWithUi`.
- Not changed: message persistence, prompt assembly, generation routing, storage APIs, remote HTTP dispatch, Rust, or mobile-specific rendering.
