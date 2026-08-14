# Context budget compaction design

## Claim

Long-running roleplay chats should not keep paying for already summarized history, and saved prompt inspection should not duplicate the same large request payload.

## Existing contract

Generation keeps as many as 300 history messages until the provider's hard context limit forces trimming. Summary text is available to prompt assembly, but it cannot currently prove which stored messages it covers. Prompt snapshots retain both the provider request and a second preview copy so the prompt inspector can show the pre-normalized structure.

## Change

- Remove history only when enabled summary entries identify a contiguous covered prefix. Keep a recent causal tail even when it is covered, and never remove messages after a coverage gap.
- Give roleplay generation a 32k-token soft context budget. Use the existing priority-aware fitter, then retry against the provider's hard limit when required context alone cannot fit the soft budget. Conversation and game modes retain their current behavior.
- Store one canonical provider-request message list in new prompt snapshots. Encode the preview as references to identical request messages plus inline entries only where the preview is structurally different. Continue reading legacy snapshots with a full `previewMessages` array.
- Do not mutate existing chats, stored messages, or Pi data as part of this change.

## Ownership

Summary coverage is a generation-layer compaction primitive used by prompt assembly. The roleplay soft budget is roleplay-owned policy applied through the shared context fitter. Snapshot encoding remains in generation serialization, while reconstruction stays in the shared prompt-inspector adapter.

## Proof

Focused tests prove contiguous coverage, coverage gaps, causal-tail preservation, roleplay-only soft fitting with hard-limit fallback, compact snapshot round trips, structurally different previews, duplicate messages, and legacy compatibility. Type checking and architecture checks cover the affected boundaries. A representative serialization measurement demonstrates byte savings without changing reconstructed inspector data.
