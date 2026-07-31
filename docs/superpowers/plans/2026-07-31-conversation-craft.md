# Conversation Craft Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give solo and group Conversation Mode an automatic first-reply quality baseline plus configured-model background feedback for later replies without adding a blocking provider call.

**Architecture:** Add a Conversation Mode-specific built-in critic and compact persisted state while reusing De-Koi's existing Agent executor, prompt-injection, and post-save lifecycle. The baseline is an unconditional final Conversation Mode guide; adaptive guidance is validated, consumed once, and produced only by detached analysis after save. Narrative and Conversation critics share a small mode-neutral background queue so foreground generation cancels either kind of work.

**Tech Stack:** TypeScript 5.9, Vitest, De-Koi engine contracts/capabilities, existing LLM Agent runtime, pnpm.

**Implementation note:** The final size-safe implementation reuses the hidden `narrative-craft` runtime with a Conversation-specific prompt and gate instead of registering a second built-in. The behavioral acceptance criteria and test lanes below remain authoritative; references to a separate built-in describe the original implementation route.

## Global Constraints

- Automatic for both one-on-one and group Conversation chats, including existing chats.
- No UI setup and no new settings screen.
- Exactly one foreground writer/provider call when unrelated existing features do not require more.
- Baseline guidance applies even when Agents are disabled; adaptive critique respects Agent enablement.
- Adaptive critique uses the configured default Agent connection/model and existing fallback behavior.
- Analysis starts only after the assistant message is saved and `done` is emitted.
- Any new foreground generation cancels active or queued craft analysis.
- Explicit user, character, and chat style instructions control.
- Product logic remains in `src/engine`; no React, Tauri, Rust, storage schema, provider transport, dependency, or remote-runtime changes.
- Proof command for architecture ownership: `pnpm check:architecture`.

---

### Task 1: Conversation Craft contracts, prompt, and final baseline guide

**Files:**

- Modify: `src/engine/contracts/types/agent.ts`
- Modify: `src/engine/contracts/constants/agent-prompts.ts`
- Modify: `src/engine/contracts/constants/agent-prompts.spec.ts`
- Modify: `src/engine/agents-runtime/executor/agent-context-profile.ts`
- Modify: `src/engine/agents-runtime/executor/agent-context-profile.spec.ts`
- Create: `src/engine/shared/text/conversation-craft.ts`
- Create: `src/engine/shared/text/conversation-craft.spec.ts`
- Modify: `src/engine/shared/text/generation-guide.ts`
- Modify: `src/engine/shared/text/generation-guide.spec.ts`

**Interfaces:**

- Produces: `CONVERSATION_CRAFT_AGENT_TYPE`, `CONVERSATION_CRAFT_BASELINE_GUIDANCE`, `ConversationCraftIssue`, `ConversationCraftState`, `normalizeConversationCraftState`, and `conversationCraftDirectiveForIssue`.
- Produces: `BuildGenerationGuideMessagesInput.conversationCraftMode?: "solo" | "group" | null`.
- Consumes: existing `BUILT_IN_AGENT_DEFINITIONS`, result types, and final internal guide assembly.

**Durable test rationale:** The first-reply and exactly-once prompt contract is the core user-visible invariant, custom prompts can bypass ordinary defaults, and the nearby prompt/guide tests provide a narrow stable seam.

- [ ] **Step 1: Write failing contract and guide tests**

Add assertions equivalent to:

```ts
expect(BUILT_IN_AGENTS.find((agent) => agent.id === "conversation-craft")).toMatchObject({
  phase: "post_processing",
  modeAllowlist: ["conversation"],
});
expect(getDefaultBuiltInAgentSettings("conversation-craft")).toMatchObject({
  runInterval: 4,
  maxTokens: 1400,
  temperature: 0,
});

const guides = buildGenerationGuideMessages({ conversationCraftMode: "group" });
expect(guides).toHaveLength(1);
expect(guides[0]?.content.match(/<conversation_craft>/g)).toHaveLength(1);
expect(guides[0]?.content).toContain("answer only what this character would notice");
expect(guides[0]?.content).toContain("Explicit style requests control");
```

Also assert that null mode produces no Conversation Craft guide, pending `conversation-craft` injection text appears inside the same wrapper once, and the Agent context profile includes full identity fields.

- [ ] **Step 2: Run tests and confirm RED**

Run:

```powershell
pnpm vitest run src/engine/shared/text/conversation-craft.spec.ts src/engine/shared/text/generation-guide.spec.ts src/engine/contracts/constants/agent-prompts.spec.ts src/engine/agents-runtime/executor/agent-context-profile.spec.ts
```

Expected: FAIL because Conversation Craft constants, built-in metadata, and guide mode do not exist.

- [ ] **Step 3: Add the minimal contracts and baseline**

Define a conversation-only hidden built-in Agent:

```ts
{
  id: "conversation-craft",
  name: "Conversation Craft",
  description: "Quietly reviews completed Conversation Mode messages and improves later texting quality.",
  phase: "post_processing",
  enabledByDefault: false,
  category: "writer",
  modeAllowlist: ["conversation"],
}
```

Add a four-message interval, `1400` max tokens, temperature `0`, full identity context, and a JSON-only default prompt that selects at most one supported issue and never writes arbitrary guidance. Add the compact baseline and deterministic issue-to-directive mapping in `conversation-craft.ts`. Extend `buildGenerationGuideMessages` so `conversationCraftMode` creates one final `<conversation_craft>` block containing the baseline, the group-only rule when applicable, and any pending adaptive injection.

- [ ] **Step 4: Run tests and confirm GREEN**

Run the Task 1 command and expect all files to pass with zero failures.

- [ ] **Step 5: Commit**

```powershell
git add src/engine/contracts/types/agent.ts src/engine/contracts/constants/agent-prompts.ts src/engine/contracts/constants/agent-prompts.spec.ts src/engine/agents-runtime/executor/agent-context-profile.ts src/engine/agents-runtime/executor/agent-context-profile.spec.ts src/engine/shared/text/conversation-craft.ts src/engine/shared/text/conversation-craft.spec.ts src/engine/shared/text/generation-guide.ts src/engine/shared/text/generation-guide.spec.ts
git commit -m "Add Conversation Craft prompt contracts"
```

---

### Task 2: Validated critic output and one-shot memory

**Files:**

- Modify: `src/engine/agents-runtime/executor/agent-executor.ts`
- Create: `src/engine/agents-runtime/executor/agent-executor.conversation-craft.spec.ts`
- Modify: `src/engine/generation/agent-memory-runtime.ts`
- Modify: `src/engine/generation/agent-memory-runtime.spec.ts`

**Interfaces:**

- Consumes: `ConversationCraftIssue`, `normalizeConversationCraftState`, and `conversationCraftDirectiveForIssue` from Task 1.
- Produces: `loadConversationCraftState(storage, agentId, chatId)`.
- Produces: `persistConversationCraftAgentMemory(storage, chatId, results)`.
- Produces: `consumeConversationCraftPendingGuidance(storage, agentId, chatId)`.

**Durable test rationale:** Model output is untrusted external data and persistent one-shot guidance affects later prompts; malformed evidence, arbitrary instructions, or failure to clear guidance could silently degrade every subsequent reply.

- [ ] **Step 1: Write failing executor validation tests**

Cover these public executor outcomes:

```ts
expect(validated.data).toMatchObject({
  intervened: true,
  issue: "therapy-speak",
  text: conversationCraftDirectiveForIssue("therapy-speak", "solo"),
});
```

Reject an excerpt absent from assistant text, an unsupported issue, model-authored `text`, a one-excerpt `polished-shape` claim, and a group-only issue in a solo chat. Accept one exact excerpt for `assistant-framing` and two exact excerpts for `polished-shape` or group voice-collapse.

- [ ] **Step 2: Run executor test and confirm RED**

Run:

```powershell
pnpm vitest run src/engine/agents-runtime/executor/agent-executor.conversation-craft.spec.ts
```

Expected: FAIL because the Agent result map and Conversation Craft validation gate do not exist.

- [ ] **Step 3: Implement the validation gate**

Register `conversation-craft` as JSON `context_injection`. After JSON parsing, validate `intervened`, `issue`, and flat evidence. Require all evidence to be exact substrings of recent assistant content. Require two distinct excerpts for repeated structural/group-collapse issues and one for locally visible issues. Replace any model-authored `text` with the deterministic directive and return a silent normalized result when validation fails.

- [ ] **Step 4: Run executor test and confirm GREEN**

Run the Task 2 executor command and expect it to pass.

- [ ] **Step 5: Write failing memory round-trip tests**

Add tests that persist a successful validated result, load bounded normalized state, consume its directive once, return null on the second consume, discover a configured Agent ID when the preferred built-in ID has no state, and ignore unsuccessful/malformed results.

- [ ] **Step 6: Run memory test and confirm RED**

Run:

```powershell
pnpm vitest run src/engine/generation/agent-memory-runtime.spec.ts
```

Expected: FAIL because Conversation Craft memory functions do not exist.

- [ ] **Step 7: Implement state persistence and consumption**

Use the existing `agent-memory` collection and `setAgentMemoryValue`. Persist only normalized bounded state plus zero or one engine-generated pending directive. When consumed, update the same row with an empty `pendingGuidance` array before returning the directive.

- [ ] **Step 8: Run Task 2 tests and confirm GREEN**

```powershell
pnpm vitest run src/engine/agents-runtime/executor/agent-executor.conversation-craft.spec.ts src/engine/generation/agent-memory-runtime.spec.ts
```

- [ ] **Step 9: Commit**

```powershell
git add src/engine/agents-runtime/executor/agent-executor.ts src/engine/agents-runtime/executor/agent-executor.conversation-craft.spec.ts src/engine/generation/agent-memory-runtime.ts src/engine/generation/agent-memory-runtime.spec.ts
git commit -m "Validate Conversation Craft feedback"
```

---

### Task 3: Automatic runtime activation and four-message cadence

**Files:**

- Modify: `src/engine/generation/agent-runner.ts`
- Modify: `src/engine/generation/agent-runner.test.ts`

**Interfaces:**

- Extends `GenerationAgentRuntime` with `conversationCraftAnalysisDue` and `runConversationCraftAnalysis(mainResponse, options)`.
- Extends `GenerationAgentRuntimeInput` with `automaticConversationCraftOnly?: boolean` for direct-message isolation.
- Consumes Task 2 memory functions.

**Durable test rationale:** Existing chats have no stored Conversation Craft activation ID, and a regression could silently remove the baseline, run unrelated Agents on direct paths, or add a pre-writer provider call.

- [ ] **Step 1: Write the failing runtime tests**

Add focused tests proving:

```ts
const runtime = await createGenerationAgentRuntime(deps, conversationInput({ activeAgentIds: [] }));
expect(runtime.preInjections).toEqual([]); // baseline is mode-owned by the guide
expect(runtime.conversationCraftAnalysisDue).toBe(true);
expect(provider.requests).toHaveLength(0);
```

Also prove that pending guidance is consumed into one `conversation-craft` injection, Agent-disabled chats produce no adaptive analysis, the first eligible turn runs the critic, later runs obey interval `4`, group mode reaches the same Agent with group context, replay overrides do not consume fresh guidance, and `automaticConversationCraftOnly` excludes unrelated Agents.

- [ ] **Step 2: Run runtime tests and confirm RED**

```powershell
pnpm vitest run src/engine/generation/agent-runner.test.ts
```

Expected: FAIL on missing runtime properties and automatic activation.

- [ ] **Step 3: Implement automatic resolution and runtime methods**

When mode is `conversation`, no explicit Agent type filter is present, and Agents are enabled, add `conversation-craft` to the runtime's scoped built-ins without changing chat metadata. Load state only on eligible cadence turns. Consume pending guidance even when the critic is not due. Exclude Conversation Craft from ordinary `runPost` so it can run only through its detached method.

- [ ] **Step 4: Run runtime tests and confirm GREEN**

Run the Task 3 command and expect all tests to pass.

- [ ] **Step 5: Commit**

```powershell
git add src/engine/generation/agent-runner.ts src/engine/generation/agent-runner.test.ts
git commit -m "Activate Conversation Craft automatically"
```

---

### Task 4: Shared background queue and detached generation lifecycle

**Files:**

- Create: `src/engine/generation/craft-analysis-background.ts`
- Create: `src/engine/generation/craft-analysis-background.spec.ts`
- Modify: `src/engine/generation/narrative-craft-background.ts`
- Modify: `src/engine/generation/narrative-craft-background.spec.ts`
- Create: `src/engine/generation/start-generation.conversation-craft-background.spec.ts`
- Modify: `src/engine/generation/start-generation.ts`

**Interfaces:**

- Produces: `scheduleCraftAnalysis({ storage, chatId, stage, run, onDiagnostic })`.
- Produces: `cancelCraftAnalysis(storage, chatId)` and `cancelCraftAnalysesForForeground(storage)`.
- Narrative Craft wrappers delegate to the shared queue without behavior change.
- Start generation adds `scheduleConversationCraftAfterSavedAssistant`.

**Durable test rationale:** Async ordering is the latency contract. A regression that awaits the critic, schedules before save, survives foreground cancellation, or misses direct/group paths would recreate the exact class of latency problem this feature is designed to avoid.

- [ ] **Step 1: Write failing shared-queue tests**

Prove latest-job-wins per chat, simultaneous chats remain independent, foreground activity defers jobs, foreground cancellation aborts running jobs and drops pending jobs, and diagnostics retain the supplied stage name.

- [ ] **Step 2: Run queue tests and confirm RED**

```powershell
pnpm vitest run src/engine/generation/craft-analysis-background.spec.ts src/engine/generation/narrative-craft-background.spec.ts
```

Expected: FAIL because the shared queue does not exist.

- [ ] **Step 3: Extract the mode-neutral queue**

Move only scheduling/cancellation mechanics out of `narrative-craft-background.ts`. Keep `narrativeCraftHasRecurringShape` and compatibility wrappers in their current owner. Preserve the existing zero-delay detached scheduling and foreground coordinator.

- [ ] **Step 4: Run queue tests and confirm GREEN**

Run the Task 4 queue command and expect both suites to pass.

- [ ] **Step 5: Write failing start-generation lifecycle tests**

Using the public `startGeneration` event stream, prove:

```ts
expect(events.findIndex((event) => event.type === "done")).toBeLessThan(criticRequestIndex);
expect(writerRequestsBeforeDone).toHaveLength(1);
expect(savedMessage.extra.contextInjections.filter((x) => x.agentType === "conversation-craft")).toHaveLength(1);
```

Cover solo normal generation, group child generation, direct `messages` input, Agent-disabled baseline-only behavior, regeneration, and a second foreground start cancelling an active critic.

- [ ] **Step 6: Run lifecycle tests and confirm RED**

```powershell
pnpm vitest run src/engine/generation/start-generation.conversation-craft-background.spec.ts src/engine/generation/start-generation.narrative-craft-background.spec.ts
```

Expected: FAIL because Conversation Craft is not wired to generation or direct paths.

- [ ] **Step 7: Wire the final guide and detached critic**

Pass `conversationCraftMode` into every normal, preview, dry-run, and direct generation-guide construction. Create an isolated direct craft runtime without running other Agents. After a saved assistant reply, emit `done`, schedule analysis, validate/persist its state and Agent run, and report `generation.conversation_craft_background`. Replace the foreground cancellation call with the shared craft cancellation function.

- [ ] **Step 8: Run lifecycle tests and confirm GREEN**

Run the Task 4 lifecycle command and expect all tests to pass.

- [ ] **Step 9: Run the combined feature suite**

```powershell
pnpm vitest run src/engine/shared/text/conversation-craft.spec.ts src/engine/shared/text/generation-guide.spec.ts src/engine/contracts/constants/agent-prompts.spec.ts src/engine/agents-runtime/executor/agent-executor.conversation-craft.spec.ts src/engine/generation/agent-memory-runtime.spec.ts src/engine/generation/agent-runner.test.ts src/engine/generation/craft-analysis-background.spec.ts src/engine/generation/narrative-craft-background.spec.ts src/engine/generation/start-generation.conversation-craft-background.spec.ts src/engine/generation/start-generation.narrative-craft-background.spec.ts
```

- [ ] **Step 10: Commit**

```powershell
git add src/engine/generation/craft-analysis-background.ts src/engine/generation/craft-analysis-background.spec.ts src/engine/generation/narrative-craft-background.ts src/engine/generation/narrative-craft-background.spec.ts src/engine/generation/start-generation.conversation-craft-background.spec.ts src/engine/generation/start-generation.ts
git commit -m "Run Conversation Craft after replies"
```

---

### Task 5: Quality and latency evaluation

**Files:**

- Create: `.github/pr-evidence/conversation-craft/proof-ledger.json`
- Modify: `docs/superpowers/specs/2026-07-31-conversation-craft-design.md` only if measured evidence requires narrowing a claim.
- Scratch only, not committed: `D:\tmp\user-temp\de-koi-conversation-craft-20260731\`

**Interfaces:**

- Consumes the production prompt builder and one configured writer model.
- Produces reproducible baseline/treatment outputs, blind judgments, call-order timings, and a checked proof ledger.

- [ ] **Step 1: Build a scratch benchmark outside the repository**

Create balanced solo/group scenarios covering terse banter, emotional disclosure, disagreement, flirtation, mundane planning, character-specific slang, multi-topic group chat, direct mentions, and a participant who should not answer. For each scenario, generate baseline `origin/main` and treatment outputs with identical model/settings and randomized A/B labels.

- [ ] **Step 2: Blind-score quality**

Run the existing GLM, Spark, and Terra blind judges used by the Narrative Craft evaluation. Record wins/ties/losses for natural texting, character fidelity, direct responsiveness, assistant/therapy leakage, formatting, appropriate length, selective group response, and voice separation. Preserve raw outputs and judgments outside the repository. If one named judge is unavailable, record the failure and require the other two rather than substituting the writer model as its own judge.

- [ ] **Step 3: Measure latency contract**

Use the engine harness to record writer request count, time to first token, time to `done`, critic request start, and critic completion. The required result is one foreground writer request and critic start after `done`; provider wall-clock deltas are reported as samples rather than guarantees.

- [ ] **Step 4: Write the proof ledger**

Record exact commands, model identifiers without credentials, sample count, aggregate and solo/group results, call-order evidence, known limitations, and artifact path. Do not claim universal improvement from one provider or synthetic sample set.

- [ ] **Step 5: Validate proof health and commit**

```powershell
node .agents/automation/scripts/proof-health.mjs .github/pr-evidence/conversation-craft/proof-ledger.json --json
git add .github/pr-evidence/conversation-craft/proof-ledger.json docs/superpowers/specs/2026-07-31-conversation-craft-design.md
git commit -m "Document Conversation Craft proof"
```

---

### Task 6: Full verification, Bunny, PR, merge, and Pi deployment

**Files:**

- Modify only files required by verified failures or Bunny findings.

**Interfaces:**

- Consumes all feature tasks and proof artifacts.
- Produces a merged PR and exact-revision Pi deployment receipt.

- [ ] **Step 1: Run fresh local verification**

```powershell
pnpm vitest run src/engine/shared/text/conversation-craft.spec.ts src/engine/shared/text/generation-guide.spec.ts src/engine/contracts/constants/agent-prompts.spec.ts src/engine/agents-runtime/executor/agent-executor.conversation-craft.spec.ts src/engine/generation/agent-memory-runtime.spec.ts src/engine/generation/agent-runner.test.ts src/engine/generation/craft-analysis-background.spec.ts src/engine/generation/narrative-craft-background.spec.ts src/engine/generation/start-generation.conversation-craft-background.spec.ts src/engine/generation/start-generation.narrative-craft-background.spec.ts
pnpm typecheck
pnpm check:architecture
pnpm perf:size
pnpm check
git diff --check origin/main...HEAD
```

Expected: every command exits `0`; bundle remains within the existing budget.

- [ ] **Step 2: Run local Bunny and fix findings**

Review branch/base, exact diff, prompt and async contracts, malformed-output controls, direct/group/regeneration paths, proof ledger, and bundle budget. Rerun affected verification after every fix until Bunny passes.

- [ ] **Step 3: Inspect and publish the intended branch**

```powershell
git status --short --branch
git log --oneline origin/main..HEAD
git diff --stat origin/main...HEAD
git remote -v
gh auth status
git push -u origin feature/conversation-craft
```

Open a draft PR to `The-Koi-Pond/De-Koi:main` using the strict repository template. Leave human validation checkboxes unchecked and mark UI/discoverability evidence N/A because behavior is automatic and adds no UI.

- [ ] **Step 4: Pass current-head Bunny and GitHub CI**

Wait for required deterministic, Rust, browser/performance, and Bunny checks. Treat only the Bunny comment whose `last-reviewed-sha` equals the current head as valid. Fix and push any in-scope finding, then repeat local proof and current-head review.

- [ ] **Step 5: Merge**

When checks are green, Bunny is READY, and GitHub reports a clean merge state:

```powershell
$prNumber = gh pr view --repo The-Koi-Pond/De-Koi --json number --jq .number
gh pr merge $prNumber --repo The-Koi-Pond/De-Koi --squash --delete-branch
gh pr view $prNumber --repo The-Koi-Pond/De-Koi --json state,mergedAt,mergeCommit,url
```

- [ ] **Step 6: Deploy the exact merge revision to the Pi**

Use the currently verified canonical checkout `/home/chai/de-koi-src` rather than the stale path in the generic helper:

```powershell
ssh chai@pi "cd /home/chai/de-koi-src && git pull --ff-only origin main && sh scripts/pi-update.sh --trusted-lan"
```

If the updater reports the previous cooked batch, wait for the merge SHA's Container Images workflow to succeed, then rerun it.

- [ ] **Step 7: Verify live state independently**

Prove the Pi checkout, `de-koi-server` label, and `de-koi-web` label all equal the merge SHA; both containers are running; root and `/health?probe=1` return HTTP 200; health reports `ok` and `writable`; `docker-compose.pi.local.yml` exists; and mounts remain `/home/chai/de-koi-data -> /data` and `/home/chai/.codex -> /root/.codex`.
