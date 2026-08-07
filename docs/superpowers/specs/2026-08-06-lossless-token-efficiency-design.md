# Lossless Token Efficiency Design

## Goal

Remove recurring provider input and repeated auxiliary-generation work without deleting stored user data, dropping prompt facts, narrowing existing permissions, or changing normal under-budget output behavior.

## Current-main scope

The July resource-efficiency work already shipped normalized turn usage, bounded summary projection, explicit main-tool selection, routed Deki tool bundles, capability-shaped agent context, and priority-aware context fitting. Those paths are verification-only in this change.

Five current-main defects remain:

1. Direct Anthropic requests ignore `enable_caching` and `caching_at_depth`.
2. Game prompts render character, persona, and lore facts in both the game-owned prompt and surviving preset markers.
3. Roleplay prompts render `lastRoleplaySceneSummary` in both summary projection and the roleplay scene block.
4. A completed daily summary is not persisted until optional weekly consolidation completes, so cancellation can repay for the same daily generation.
5. Card Evolution Auditor receives full character-card fields in both `<lore><characters>` and `<character_cards>`.

Memory Recall exchange/chunk overlap is already repaired on current main and requires no change. Character-wand prompt reordering is excluded because changing prompt order is not provider-agnostic or provably behavior-identical.

## Design

### Direct Anthropic caching

When caching is disabled, preserve the current request body byte-for-byte. When enabled, serialize system messages as text content blocks and mark the last system block with an ephemeral cache breakpoint. Convert the configured history message to content blocks and mark its final cacheable block. `caching_at_depth = 0` means the newest non-system message; larger depths count backward and clamp to the oldest available message. Image-bearing messages preserve all images and text.

### Prompt ownership

Game mode owns character, persona, and lore rendering. Preset processing must suppress only those marker projections in game mode, while retaining arbitrary preset instructions, summaries, history, and marker-only character fields by adding those fields once to the game-owned card renderer.

Roleplay scene continuity is owned by `buildRoleplayScenePromptBlock`. Summary projection receives an explicit `includeSceneSummary` option and roleplay assembly disables that one block. Other modes keep their current summary projection.

### Summary durability

Daily and weekly summaries become independently durable checkpoints. The backfill owner persists each completed day before starting weekly consolidation, then persists completed weeks separately with the existing merge semantics. Cancellation after a daily response cannot cause that day to be generated again.

### Card Evolution context

The auditor consumes the existing full-fidelity `<lore><characters>` projection. Its prompt contract is updated accordingly and the redundant `<character_cards>` extra is removed for that built-in type. Mixed batches retain the shared lore block and do not add a second card copy.

## Safety and verification

- No storage records are deleted or rewritten for token reduction.
- No existing tool capability, consent check, history tail, or user-authored prompt is removed.
- Every fix starts with a focused failing regression test.
- Under caching-disabled and under-budget paths, serialized behavior remains unchanged.
- Required gates: focused Vitest/Rust tests, `pnpm typecheck`, `pnpm check:architecture`, `cargo check --manifest-path src-tauri/Cargo.toml --workspace`, `pnpm check`, simplification audit, and Bunny review.
