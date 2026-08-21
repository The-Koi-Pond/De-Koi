# Prompt and Generation Profile Contracts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Repair Nano and LinkAPI profile resolution plus Conversation and roleplay prompt contracts without changing unrelated generation modes.

**Architecture:** Build inherited defaults, apply maintained provider-profile constraints, then preserve explicit chat/request overrides. Align TypeScript request snapshots with Rust transport, make group prompting strategy-aware, bound roleplay history by default, normalize bundled preset defaults, and migrate only known obsolete metadata.

**Tech Stack:** TypeScript, Vitest, Rust, serde_json, FileStorage, pnpm, Cargo.

## Global Constraints

- Preserve explicit chat-scoped and request-scoped parameter overrides.
- Do not invent LinkAPI Claude reasoning support on the OpenAI-compatible route.
- Preserve unrelated saved connection metadata and user-selected prompt choices.
- Keep the existing 300-message hard ceiling available through an explicit override.
- Do not commit, push, or modify the live Pi in this task.

---

### Task 1: Provider profile resolution and truthful snapshots

**Files:**

- Modify: `src/engine/generation/recommended-generation-profile.ts`
- Modify: `src/engine/generation/generate-route-utils.ts`
- Modify: `src/engine/generation/provider-visible-parameters.ts`
- Test: `src/engine/generation/recommended-generation-profile.spec.ts`
- Test: `src/engine/generation/generate-route-utils.spec.ts`
- Test: `src/engine/generation/provider-visible-parameters.spec.ts`

**Interfaces:**

- Consumes: saved connection defaults, prompt-preset defaults, chat parameters, request parameters.
- Produces: maintained LinkAPI Claude/Gemini and Nano profiles plus transport-shaped visible parameters.

- [x] Add failing tests proving maintained profiles override inherited preset defaults, explicit chat/request values remain authoritative, LinkAPI Claude is recognized, and custom Claude snapshots omit stripped fields.
- [x] Run the three focused Vitest files and confirm failures describe the current precedence/mirroring defects.
- [x] Add LinkAPI Claude recognition, profile-suppressed parameter aliases, staged merge ordering, and custom OpenAI-compatible snapshot serialization.
- [x] Re-run the focused tests and confirm they pass.

### Task 2: Coherent Conversation group roles

**Files:**

- Modify: `src/engine/contracts/constants/conversation-prompt.ts`
- Modify: `src/engine/contracts/constants/conversation-prompt.spec.ts`
- Test: `src/engine/generation/prompt-assembly.conversation-focus.spec.ts`

**Interfaces:**

- Consumes: group member names and per-turn target/response strategy.
- Produces: a neutral group role followed by non-contradictory speaker guidance.

- [x] Add a failing assembled-prompt test proving an automatic group turn can authorize multiple speakers without an exclusive-speaker contradiction.
- [x] Update the shared group role contract to defer speaker ownership to turn-specific guidance while always forbidding user-authored messages.
- [x] Run the constants and assembled-prompt tests and confirm they pass.

### Task 3: Bounded roleplay history and positive prose guidance

**Files:**

- Modify: `src/engine/generation/prompt-assembly.ts`
- Modify: `src/engine/modes/chat/core/conversation-prose-guidance.ts`
- Modify: `src/engine/modes/roleplay/core/roleplay-prose-guidance.ts`
- Test: `src/engine/generation/prompt-assembly.roleplay-quality.spec.ts`
- Test: `src/engine/generation/prose-shape-guidance.spec.ts`

**Interfaces:**

- Consumes: chat mode, optional explicit history limits, and assembled messages.
- Produces: a 50-message default roleplay tail and compact positive late guidance.

- [x] Add failing tests proving roleplay defaults to the latest 50 history messages, an explicit larger limit still works, and injected prose guides contain no literal Automatic/Cleaner examples.
- [x] Implement the mode-specific default and rewrite both mode guides as positive character/scene instructions.
- [x] Run the focused tests and confirm they pass.

### Task 4: Safe and reproducible universal preset defaults

**Files:**

- Modify: `src-tauri/resources/default-data/db/default-preset-v2.json`
- Modify: `src-tauri/src/seed_defaults.rs`

**Interfaces:**

- Consumes: bundled preset JSON and an existing managed universal preset row.
- Produces: SFW fallback and 4096-token/low-reasoning defaults for freshly seeded presets while preserving existing managed rows without an immutable version marker.

- [x] Add failing Rust assertions that fresh defaults are SFW and existing managed/custom adult, token, and reasoning choices survive repeated startup.
- [x] Change bundled defaults without inferring user intent from editable persisted values.
- [x] Run the focused `seed_defaults` Rust tests and confirm they pass.

### Task 5: Remove obsolete Nano profile metadata safely

**Files:**

- Modify: `src-tauri/src/seed_defaults.rs`

**Interfaces:**

- Consumes: connection rows with optional `providerMetadata` objects.
- Produces: identical rows minus the dead `roleplayProsePilot` key.

- [x] Add a failing Rust test with obsolete and unrelated provider metadata keys.
- [x] Add startup cleanup that removes only `roleplayProsePilot` and preserves every sibling field.
- [x] Run the focused Rust test and confirm it passes.

### Task 6: Integration verification and Bunny

**Files:**

- Review all changed files against `origin/main`.

**Interfaces:**

- Consumes: the complete implementation diff.
- Produces: evidence that the requested prompt/profile contracts are fixed without adjacent regressions.

- [x] Run all focused Vitest suites for profile, prompt, history, and snapshot behavior.
- [x] Run focused Rust tests, `pnpm typecheck`, `pnpm check:deterministic`, `git diff --check`, and the repository-required Bunny review.
- [x] Inspect the final diff for scope, source/default drift, migration safety, and unproved manual paths.
