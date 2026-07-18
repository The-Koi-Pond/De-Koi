# Character Web Research Timeline Repair

## Problem

When a character requests permission to research the web, generation saves a
`characterWebResearchRequest` in the assistant message's `extra` metadata. The
live saved-message event briefly contains that metadata, but the automatic
timeline refresh requests only the allowlisted fields in
`timelineMessageProjection()`. Because the projection omits
`characterWebResearchRequest` and `characterWebResearchSources`, storage returns
the refreshed message without the permission card or later source links. The
fallback sentence remains visible, so the character appears to promise research
without providing a way to approve it.

## Design

The chat timeline projection will request both durable web-research fields:

- `characterWebResearchRequest`
- `characterWebResearchSources`

This repairs the storage-to-UI contract at its owner without changing generation,
provider transport, consent semantics, or the Rust web-research capability.
Existing Conversation and Roleplay renderers already consume these fields and
the approval card already grants one exact query before regenerating the message.

## Verification

A focused regression test at the public `timelineMessageProjection()` interface
will assert that both fields are included in the `extra` field selection. The
test must fail before the projection changes and pass afterward.

The shipping validation is:

1. Focused timeline projection test.
2. `pnpm typecheck`.
3. `pnpm check:architecture`.
4. `pnpm check`.
5. Bunny review of the final diff and proof.

## Scope

No UI redesign, provider change, grant-policy change, search-parser change,
storage migration, or backward-compatibility fallback is included.
