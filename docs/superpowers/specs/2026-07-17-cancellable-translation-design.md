# Cancellable translation design

## Claim

Cancelling a translation must stop the remote request when possible, release its UI state immediately, and invalidate late completion so cancelled text cannot display or persist.

## Ownership

- A cancellable request owns one `AbortController` and accepts completion only while it remains active.
- Message requests are keyed by message ID; cancelling one does not affect another.
- Each draft input owns its own request and cancels it on unmount.
- Remote runtime invokes receive the abort signal. Embedded Tauri invokes cannot currently interrupt the Rust command, but the same ownership guard rejects their late result.

## Surfaces

Conversation, shared Roleplay chat, and Game show Cancel in active message/narration translation panels. Their draft translation button becomes a Cancel action while active.

## Persistence

Message cancellation removes the display value immediately. If cancellation races with persistence, cleanup removes the persisted translation after the earlier write settles.

## Proof

Unit tests cover completed, cancelled, provider-error, late-response, scoped message cancellation, and unmount races. Type checking covers all three mode surfaces and the typed remote/Tauri boundary.
