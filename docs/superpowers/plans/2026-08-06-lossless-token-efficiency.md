# Lossless Token Efficiency Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` or `superpowers:executing-plans` task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the five current-main token-waste defects while preserving prompt facts, stored data, permissions, and disabled/under-budget behavior.

**Architecture:** Keep each optimization at its existing owner boundary: provider serialization, prompt projection, summary persistence, and agent prompt assembly. Remove only duplicate work, and lock every boundary with red/green regression tests.

**Tech Stack:** TypeScript 5, Vitest, Rust, Serde JSON, Tauri.

## Global Constraints

- Work from `74d3310b7` in `D:\dev\de-koi-token-efficiency-main-worktree`.
- Do not commit, push, open a PR, or modify the user's dirty primary checkout without separate authorization.
- Preserve every unique prompt fact and every existing tool/privacy capability.
- Do not reorder character-wand prompts in this batch.
- Do not reimplement the six token-efficiency systems already present on main.
- Use test-first red/green proof for each production change.

---

### Task 1: Restore direct Anthropic prompt caching

**Files:**
- Modify: `src-tauri/crates/llm/src/providers/anthropic.rs`
- Test: `src-tauri/crates/llm/src/lib.rs`

**Interfaces:**
- Consumes: `LlmConnection.enable_caching: bool`, `LlmConnection.caching_at_depth: Option<u64>`.
- Produces: an Anthropic body with at most two explicit ephemeral breakpoints: last system block and configured message-history block.

- [ ] **Step 1: Write failing body-shape tests**

Add tests proving caching disabled preserves string system/message content; caching enabled marks the last system text block and the depth-selected history block; depth clamps for short history; and an image-bearing selected message retains its image and cache breakpoint.

```rust
request.connection.enable_caching = true;
request.connection.caching_at_depth = Some(1);
let body = build_anthropic_body(&request, false);
assert_eq!(body["system"][0]["cache_control"], json!({ "type": "ephemeral" }));
assert_eq!(body["messages"][selected]["content"][last]["cache_control"], json!({ "type": "ephemeral" }));
```

- [ ] **Step 2: Run tests and verify RED**

Run: `cargo test --manifest-path src-tauri/Cargo.toml -p marinara-llm anthropic_cache --lib`

Expected: assertions fail because the body contains no cache breakpoints.

- [ ] **Step 3: Implement minimal cache-aware serialization**

Add pure helpers for the clamped message index and for attaching `cache_control` to the final eligible content block. Keep the disabled branch on the current string serialization path.

```rust
fn anthropic_cache_message_index(message_count: usize, depth: Option<u64>) -> Option<usize> {
    (message_count > 0).then(|| message_count.saturating_sub(1 + depth.unwrap_or(5) as usize))
}
```

- [ ] **Step 4: Run tests and verify GREEN**

Run the focused Rust tests, then `cargo check --manifest-path src-tauri/Cargo.toml -p marinara-llm`.

---

### Task 2: Give game and roleplay prompt facts one owner

**Files:**
- Modify: `src/engine/generation/prompt-assembly.ts`
- Modify: `src/engine/generation/summary-context.ts`
- Test: `src/engine/generation/prompt-assembly.context-priority.spec.ts`
- Test: `src/engine/generation/summary-context.spec.ts`

**Interfaces:**
- Consumes: chat mode and preset marker entries.
- Produces: game character/persona/lore sentinels and roleplay scene continuity exactly once.

- [ ] **Step 1: Write failing prompt-shape tests**

Add a game fixture whose character, persona, before-lore, after-lore, creator notes, greeting/examples/system/post-history fields each have unique sentinels. Assert each sentinel occurs once and arbitrary preset instructions survive. Add roleplay fixtures for explicit `chat_summary` marker and fallback insertion, asserting `lastRoleplaySceneSummary` occurs once.

```ts
expect(messages.map((message) => message.content).join("\n").split("UNIQUE_SCENE_SENTINEL")).toHaveLength(2);
```

- [ ] **Step 2: Run tests and verify RED**

Run: `pnpm exec vitest run src/engine/generation/prompt-assembly.context-priority.spec.ts src/engine/generation/summary-context.spec.ts`

Expected: duplicate sentinel counts fail.

- [ ] **Step 3: Implement game-aware marker projection**

Extend the game-owned card text with any unique fields currently available only through the preset character/persona markers. During preset rendering for game mode, suppress only duplicate `character`, `persona`, `world_info_before`, and `world_info_after` outputs. Preserve all other preset entries and ordering.

- [ ] **Step 4: Implement roleplay-owned scene continuity**

Extend summary projection with `includeSceneSummary?: boolean` defaulting to current behavior. Pass `false` only when roleplay scene assembly owns `lastRoleplaySceneSummary`.

```ts
buildSummaryContextProjection({ chat, budgetTokens, includeSceneSummary: chatMode !== "roleplay" });
```

- [ ] **Step 5: Run tests and verify GREEN**

Run the two focused suites plus `pnpm typecheck`.

---

### Task 3: Persist daily summaries before weekly consolidation

**Files:**
- Modify: `src/engine/modes/chat/core/summaries/auto-summary.service.ts`
- Test: `src/engine/modes/chat/core/summaries/auto-summary.service.test.ts`

**Interfaces:**
- Consumes: generated daily summary entries.
- Produces: an awaited daily checkpoint before any weekly provider call, using existing metadata merge semantics.

- [ ] **Step 1: Write the cancellation-window regression**

Create six stored days plus one missing day in a closed week. Resolve the daily generation, block and abort weekly generation, assert the day patch occurred, then rerun and assert the daily summarizer was not called again.

- [ ] **Step 2: Run test and verify RED**

Run: `pnpm exec vitest run src/engine/modes/chat/core/summaries/auto-summary.service.test.ts`

Expected: no persistence call occurs before weekly generation settles.

- [ ] **Step 3: Add awaited daily checkpoints**

Add an optional `onDayGenerated(date, entry)` callback to the pure generation flow. `backfillConversationSummaries` supplies a callback that merges and persists the one-day delta immediately. Weekly results use a later independent merge/persist. Preserve abort propagation and idempotent entry merge behavior.

- [ ] **Step 4: Run test and verify GREEN**

Run the focused summary suite and `pnpm typecheck`.

---

### Task 4: Remove Card Evolution's second full-card serialization

**Files:**
- Modify: `src/engine/contracts/constants/agent-prompts.ts`
- Modify: `src/engine/agents-runtime/executor/agent-executor.ts`
- Test: `src/engine/agents-runtime/executor/agent-context-profile.spec.ts`

**Interfaces:**
- Consumes: the full-identity `<lore><characters>` projection already emitted for `card-evolution-auditor`.
- Produces: the auditor's exact-match edit contract without a separate `<character_cards>` copy.

- [ ] **Step 1: Write failing single-agent and mixed-batch assertions**

Assert every unique card field value occurs exactly once in the assembled prompt and the auditor instructions reference `<lore><characters>`.

- [ ] **Step 2: Run test and verify RED**

Run: `pnpm exec vitest run src/engine/agents-runtime/executor/agent-context-profile.spec.ts`

Expected: card values occur twice and instructions reference `<character_cards>`.

- [ ] **Step 3: Use the canonical lore block**

Update the built-in prompt contract to identify cards under `<lore><characters>`. Remove the auditor-only character-card branch from `buildAgentExtras`; keep every other extra unchanged.

- [ ] **Step 4: Run test and verify GREEN**

Run the focused agent suite, the pipeline suite, and `pnpm typecheck`.

---

### Task 5: Integration verification and review

**Files:** all files changed by Tasks 1-4 only, plus this design/plan.

- [ ] Run all focused TypeScript and Rust suites from Tasks 1-4.
- [ ] Run `pnpm typecheck`.
- [ ] Run `pnpm check:architecture`.
- [ ] Run `cargo check --manifest-path src-tauri/Cargo.toml --workspace`.
- [ ] Run `pnpm check`.
- [ ] Inspect `git diff --check` and `git status --short`.
- [ ] Run the simplification audit over the final diff.
- [ ] Run Bunny against the current-main merge base and record its verdict.

## Done criteria

- [ ] All five reproduced token-waste paths have focused red/green regressions.
- [ ] Caching-disabled and under-budget behavior remain unchanged.
- [ ] Every unique prompt fact appears exactly once in the affected prompt owners.
- [ ] Daily summary cancellation cannot repay for an already completed day.
- [ ] Current-main baseline and all changed-lane gates pass.
- [ ] No commit, push, PR, or merge occurs without explicit authorization.
