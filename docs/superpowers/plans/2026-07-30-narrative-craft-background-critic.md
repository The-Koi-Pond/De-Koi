# Narrative Craft Background Critic Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Narrative Craft’s blocking pre-generation LLM call with a default-off, trigger-gated background critic whose validated guidance is consumed once by a later reply.

**Architecture:** Keep Narrative Craft in the TypeScript engine and preserve retired-agent compatibility. Change its phase to post-processing, exclude it from awaited post-processing, schedule it after visible completion, and persist a separate one-item `pendingGuidance` queue that the next normal generation claims before prompt assembly.

**Tech Stack:** TypeScript, Vitest, De-Koi generation engine, `StorageGateway`, existing agent pipeline and evaluation scripts.

## Global Constraints

- Roleplay and visual novel only; Conversation and Game remain untouched.
- No new provider, storage collection, shared API, Tauri, HTTP, or React dependency.
- No blocking Narrative Craft LLM call on the foreground generation path.
- Existing explicit Narrative Craft and retired-agent activations remain compatible.
- New chats do not activate Narrative Craft by default.
- Guidance requires two distinct grounded excerpts and a supported issue.
- Do not commit, push, or open a PR without separate authorization.

---

### Task 1: Persist and consume one pending directive

**Files:**
- Modify: `src/engine/generation/narrative-craft-state.ts`
- Modify: `src/engine/generation/agent-memory-runtime.ts`
- Test: `src/engine/generation/narrative-craft-state.spec.ts`
- Test: `src/engine/generation/agent-memory-runtime.spec.ts`

**Interfaces:**
- Produces: `NarrativeCraftState.pendingGuidance: string[]`
- Produces: `consumeNarrativeCraftPendingGuidance(storage, agentId, chatId): Promise<string | null>`
- Preserves: `lastGuidance` for inspection after pending delivery is consumed.

- [ ] **Step 1: Write a failing normalization test**

Add assertions that `pendingGuidance` accepts one trimmed string, drops empty entries, and is absent from legacy input as an empty array.

- [ ] **Step 2: Run the state test and verify RED**

Run: `pnpm vitest run src/engine/generation/narrative-craft-state.spec.ts`

Expected: FAIL because normalized state has no `pendingGuidance`.

- [ ] **Step 3: Add the normalized state field**

Add `pendingGuidance: string[]` to the interface and empty state, normalized with `normalizeStrings(value.pendingGuidance, 1)`.

- [ ] **Step 4: Run the state test and verify GREEN**

Run: `pnpm vitest run src/engine/generation/narrative-craft-state.spec.ts`

Expected: PASS.

- [ ] **Step 5: Write failing persistence tests**

Prove that an intervening result stores its directive in both `lastGuidance` and `pendingGuidance`, a silent result stores no pending directive, and consumption returns the directive once while retaining `lastGuidance`.

- [ ] **Step 6: Run the memory test and verify RED**

Run: `pnpm vitest run src/engine/generation/agent-memory-runtime.spec.ts`

Expected: FAIL because pending persistence and consumption do not exist.

- [ ] **Step 7: Implement pending persistence and consumption**

Normalize result state, derive the validated directive from result data, store at most one pending item, and update the existing state row with `pendingGuidance: []` when claimed.

- [ ] **Step 8: Run the memory test and verify GREEN**

Run: `pnpm vitest run src/engine/generation/agent-memory-runtime.spec.ts`

Expected: PASS.

### Task 2: Add the cheap recurrence trigger and coalescing worker

**Files:**
- Create: `src/engine/generation/narrative-craft-background.ts`
- Test: `src/engine/generation/narrative-craft-background.spec.ts`

**Interfaces:**
- Produces: `narrativeCraftHasRecurringShape(messages, mainResponse): boolean`
- Produces: `scheduleNarrativeCraftAnalysis({ storage, chatId, run, onDiagnostic }): boolean`

- [ ] **Step 1: Write failing trigger tests**

Prove a positive row with the same supported prose-shape marker in two different assistant turns and negative rows for one occurrence, duplicate text in one turn, user prose, and short/common phrases.

- [ ] **Step 2: Run the background test and verify RED**

Run: `pnpm vitest run src/engine/generation/narrative-craft-background.spec.ts`

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement the deterministic trigger**

Extract bounded assistant prose from prior messages plus the completed response. Return true only when two different assistant turns share a high-confidence supported marker or a repeated non-trivial sentence-opening shape.

- [ ] **Step 4: Add failing scheduler tests**

Use fake timers to prove scheduling returns before `run` resolves, jobs for different chats can proceed independently, and a second job for the same chat replaces the queued successor without running concurrently.

- [ ] **Step 5: Run the scheduler tests and verify RED**

Run: `pnpm vitest run src/engine/generation/narrative-craft-background.spec.ts`

Expected: FAIL on detached/coalescing behavior.

- [ ] **Step 6: Implement the scheduler**

Use a `WeakMap<StorageGateway, Map<string, WorkerState>>`, defer initial work with `setTimeout(..., 0)`, run one job at a time per chat, retain only the newest pending job, and emit bounded `ok` or `error` diagnostics.

- [ ] **Step 7: Run the background test and verify GREEN**

Run: `pnpm vitest run src/engine/generation/narrative-craft-background.spec.ts`

Expected: PASS.

### Task 3: Move analysis behind completed generation

**Files:**
- Modify: `src/engine/contracts/types/agent.ts`
- Modify: `src/engine/agents-runtime/pipeline/agent-pipeline.ts`
- Modify: `src/engine/agents-runtime/executor/agent-executor.ts`
- Modify: `src/engine/generation/agent-runner.ts`
- Test: `src/engine/contracts/types/agent.spec.ts`
- Test: `src/engine/agents-runtime/pipeline/agent-pipeline.spec.ts`
- Test: `src/engine/generation/agent-runner.test.ts`

**Interfaces:**
- Changes: built-in Narrative Craft phase from `pre_generation` to `post_processing`.
- Produces: `GenerationAgentRuntime.runNarrativeCraftAnalysis(mainResponse, { force? }): Promise<AgentResult[]>`
- Changes: normal `runPost` excludes Narrative Craft; the explicit background method runs only Narrative Craft.

- [ ] **Step 1: Write failing contract and runner tests**

Prove Narrative Craft is post-processing, construction sends no Narrative Craft LLM request, a claimed cached directive appears in `preInjections`, a second construction cannot claim it again, automatic analysis skips without a recurring candidate, and forced analysis runs against `mainResponse`.

- [ ] **Step 2: Run the focused tests and verify RED**

Run: `pnpm vitest run src/engine/contracts/types/agent.spec.ts src/engine/generation/agent-runner.test.ts`

Expected: FAIL on current pre-generation execution and missing runtime method.

- [ ] **Step 3: Add filtered post-processing execution**

Let the agent pipeline accept an optional post-processing type filter. The standard runtime post path filters out `narrative-craft`; the explicit analysis path filters for it and returns only results produced by that call.

- [ ] **Step 4: Ground evidence in the completed response**

Include `context.mainResponse` in Narrative Craft’s assistant-prose evidence corpus so exact excerpts from the just-finished reply pass the existing guidance gate.

- [ ] **Step 5: Claim cached guidance during normal runtime creation**

For normal, non-override generation with an explicitly active Narrative Craft-compatible ID, claim pending guidance and merge it into initial injections before any LLM work.

- [ ] **Step 6: Implement the explicit analysis method**

Keep the cadence-resolved Narrative Craft agent out of foreground post-processing. Run it only when forced or when `narrativeCraftHasRecurringShape` returns true.

- [ ] **Step 7: Run the focused tests and verify GREEN**

Run: `pnpm vitest run src/engine/contracts/types/agent.spec.ts src/engine/agents-runtime/pipeline/agent-pipeline.spec.ts src/engine/generation/agent-runner.test.ts`

Expected: PASS.

### Task 4: Schedule automatic analysis after visible completion

**Files:**
- Modify: `src/engine/generation/start-generation.ts`
- Modify: `src/engine/generation/start-generation.retry-agents.spec.ts`
- Create: `src/engine/generation/start-generation.narrative-craft-background.spec.ts`

**Interfaces:**
- Automatic path schedules `runNarrativeCraftAnalysis(displayContent)` only after the assistant message is saved and visible completion is emitted.
- Manual retry calls `runNarrativeCraftAnalysis(targetContent, { force: true })`, awaits it, then persists state and run history against the target message.

- [ ] **Step 1: Write failing automatic-path test**

Use a deferred Narrative Craft LLM gateway. Prove the main assistant message and `done` event occur while the critic promise remains unresolved, then resolve it and verify state/run persistence.

- [ ] **Step 2: Run the automatic-path test and verify RED**

Run: `pnpm vitest run src/engine/generation/start-generation.narrative-craft-background.spec.ts`

Expected: FAIL because Narrative Craft currently runs before the writer.

- [ ] **Step 3: Schedule the detached analysis**

After visible completion, enqueue a per-chat Narrative Craft job detached from the foreground signal. Persist its result state and run history against the saved assistant message; report failures without changing the saved reply.

- [ ] **Step 4: Write and run the failing manual-retry test**

Update the retry test to require completed-response analysis and future pending guidance rather than a same-message pre-injection.

- [ ] **Step 5: Implement forced manual analysis**

Call the explicit analysis method with `force: true` before retry persistence.

- [ ] **Step 6: Run automatic and retry tests and verify GREEN**

Run the two focused test files.

Expected: PASS.

### Task 5: Make unproven behavior default-off and update documentation

**Files:**
- Modify: `src/engine/contracts/constants/chat-modes.ts`
- Create: `src/engine/contracts/constants/chat-modes.spec.ts`
- Modify: `src/engine/contracts/constants/agent-prompts.ts`
- Modify: `src/engine/contracts/constants/agent-prompts.spec.ts`
- Modify: `docs/narrative-craft-evaluation.md`
- Modify: `docs/REFACTOR_PARITY_PIPELINE.md`
- Modify: `docs/database-schema.md`

**Interfaces:**
- New roleplay chats omit `narrative-craft` from `defaultAgents`.
- Prompt describes completed-response analysis and future-turn guidance.
- Evaluation gate remains StoryScope improvement on interventions, blind non-inferiority, and foreground p95 under 100 ms.

- [ ] **Step 1: Write the failing default-off and prompt tests**

Assert roleplay defaults omit Narrative Craft and the prompt instructs analysis of `<assistant_response>` for a later reply.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `pnpm vitest run src/engine/contracts/types/agent.spec.ts src/engine/contracts/constants/chat-modes.spec.ts src/engine/contracts/constants/agent-prompts.spec.ts`

Expected: FAIL on phase/default/prompt wording.

- [ ] **Step 3: Update defaults, prompt, and docs**

Remove Narrative Craft from new-chat defaults while preserving explicit and legacy activation. Update runtime and storage documentation for background delivery and `pendingGuidance`.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run the same command.

Expected: PASS.

### Task 6: Verify quality, latency, and repository health

**Files:**
- Modify only if the benchmark harness needs a non-product reporting field: `scripts/narrative-craft-eval/*`
- Update: `docs/narrative-craft-evaluation.md` with the new dated result.

- [ ] **Step 1: Run all changed-lane tests**

Run the focused Vitest files from Tasks 1–5.

Expected: PASS with zero failures.

- [ ] **Step 2: Run architecture and type checks**

Run: `pnpm check:architecture`

Run: `pnpm typecheck`

Expected: both exit 0.

- [ ] **Step 3: Run the existing StoryScope and blind-quality evaluation**

Use the pinned StoryScope revision and the existing external artifact directory. Record overall and intervention-only deltas, activation count, blind preferences, and foreground timing separately from detached worker duration.

- [ ] **Step 4: Apply the enablement gate**

Keep Narrative Craft default-off unless intervention-only StoryScope delta is positive, blind judging is non-inferior, and p95 foreground overhead is below 100 ms.

- [ ] **Step 5: Run Bunny review**

Review the full worktree diff, generation/prompt/storage risk matrix, focused proof, `git diff --check`, and remaining benchmark limitations. Fix in-scope findings and rerun affected proof.
