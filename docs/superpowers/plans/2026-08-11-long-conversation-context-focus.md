# Long Conversation Context Focus Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep long Conversation chats character-specific by concentrating identity, voice, relevant continuity, and recent dialogue without adding a second generation call.

**Architecture:** A pure Conversation-owned generation helper decides when focus applies, bounds prompt-facing character fields, and selects established Conversation examples. Prompt assembly keeps its existing storage and capability seams while using smaller history, summary, and memory projections for the focused path.

**Tech Stack:** TypeScript, Vitest, De-Koi prompt assembly, existing summary and memory-recall projections.

## Global Constraints

- Conversation mode only; Roleplay, Visual Novel, and Game behavior must not change.
- Do not focus impersonation or untargeted multi-character Conversation turns.
- Activate at 20 visible assistant replies in the current conversation segment.
- Keep the latest five visible user messages and omit prior assistant history so drifted outputs cannot become recursive style examples.
- Preserve custom/preset instructions, lorebooks, depth prompts, images, Conversation Craft, and hidden command contracts.
- Do not add storage writes, provider calls, React imports, shared API adapters, or Rust changes.
- Do not commit, push, or open a PR without Celia's explicit authorization.

---

### Task 1: Prove the focused prompt contract

**Files:**

- Create: `src/engine/generation/prompt-assembly.conversation-focus.spec.ts`

**Interfaces:**

- Consumes: public `assembleGenerationPrompt(storage, input)`.
- Produces: regression coverage for long Conversation concentration and mode boundaries.

- [x] **Step 1: Write the failing long-conversation integration test**

Build one character with oversized description/system/memory fields, roleplay-formatted card examples, and 20 assistant replies. Assert the assembled prompt retains unique identity and tail voice sentinels, converts card dialogue into a Conversation-shaped example, keeps the latest five user messages while omitting drifted assistant history, retains the current user and `[memory: ...]` command guidance, and stays below a fixed character-size ceiling.

- [x] **Step 2: Run the test and confirm RED**

Run: `pnpm vitest run src/engine/generation/prompt-assembly.conversation-focus.spec.ts`

Expected: FAIL because the baseline includes the full character payload, roleplay example, and all history.

### Task 2: Add the pure focus policy

**Files:**

- Create: `src/engine/generation/conversation-context-focus.ts`
- Test: `src/engine/generation/prompt-assembly.conversation-focus.spec.ts`

**Interfaces:**

- Produces: `conversationContextFocus(...)`, returning `{ historyLimit, includeAssistantHistory, summaryMaxContext, memoryRecallTokenBudget, canonicalMemoryMaxContext, characters }` or `null`.
- Character inputs are structural and returned with the same generic type so prompt assembly retains `GenerationCharacterContext` without importing its owner type.

- [x] **Step 1: Implement activation and bounded text**

Count visible assistant messages since the latest `isConversationStart` marker. Require Conversation mode, non-impersonation, an eligible speaker, and 20 replies. Compact description, personality, scenario, backstory, system prompt, post-history instructions, and same-day memories with field-specific limits and head/tail retention.

- [x] **Step 2: Implement established Conversation example selection**

Extract plain quoted dialogue from up to two card examples, stripping roleplay actions. Fill remaining slots from early visible user/assistant pairs for the eligible character, rejecting roleplay-formatted or hidden-command-bearing replies. Omit card `firstMes` and replace `mesExample` with the bounded mode-matched examples.

### Task 3: Wire focus through prompt assembly

**Files:**

- Modify: `src/engine/generation/prompt-assembly.ts`
- Test: `src/engine/generation/prompt-assembly.conversation-focus.spec.ts`

**Interfaces:**

- Consumes: `conversationContextFocus(...)` after character/persona loading.
- Produces: focused prompt characters, the latest five user-only history messages, summary projection bounded through a 9,600-token effective context, chat-memory recall budget 512, and canonical-memory effective context 4,000.

- [x] **Step 1: Apply focused characters before macro construction**

Select the single or explicitly targeted Conversation speaker, call the pure helper, use its character copies for prompt rendering/macros, and skip card behavioral-example selection because focus supplies Conversation-mode examples.

- [x] **Step 2: Apply existing bounded continuity seams**

Use the focus policy's user-only history selection and smaller effective contexts when building summary, memory recall, and canonical memory blocks. Leave storage retrieval, attribution, and fallback behavior unchanged.

- [x] **Step 3: Run the focused spec and confirm GREEN**

Run: `pnpm vitest run src/engine/generation/prompt-assembly.conversation-focus.spec.ts`

Expected: PASS.

### Task 4: Lock mode boundaries and validate

**Files:**

- Modify: `src/engine/generation/prompt-assembly.conversation-focus.spec.ts`

**Interfaces:**

- Consumes: completed focus behavior.
- Produces: negative coverage and repository proof.

- [x] **Step 1: Add negative cases**

Assert 19 replies stay unchanged, impersonation stays unchanged, untargeted group Conversation stays unchanged, and Roleplay with 20 replies stays unchanged.

- [x] **Step 2: Run focused and neighboring suites**

Run: `pnpm vitest run src/engine/generation/prompt-assembly.conversation-focus.spec.ts src/engine/generation/conversation-freshness.spec.ts src/engine/generation/prompt-assembly.context-priority.spec.ts src/engine/generation/canonical-memory-context.spec.ts`

Expected: all files pass.

- [x] **Step 3: Run lane validation**

Run: `pnpm typecheck` and `pnpm check:architecture`.

Expected: both exit 0.

- [x] **Step 4: Review the final worktree**

Run: `git diff --check`, `git diff --stat`, and `git status --short`.

Expected: no whitespace errors and only the focused design, plan, helper, integration, and spec files are changed.
