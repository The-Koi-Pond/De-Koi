# `/illustrate` Command Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an invisible, scene-aware `/illustrate [free-form guidance]` command to Conversation and Roleplay inputs by extending De-Koi's existing manual Illustrator retry path.

**Architecture:** The slash-command registry dispatches through a narrow injected `illustrate` callback. The two chat inputs adapt that callback to `retryAgents`, while the generation engine carries optional guidance into transient agent context and XML-escapes it into the manual Illustrator prompt. Existing image generation, references, gallery persistence, and attachments remain unchanged.

**Tech Stack:** TypeScript, React, Vitest, De-Koi generation engine, JSON discovery metadata.

## Global Constraints

- The slash command and guidance must never create a transcript message, scene-state record, metadata field, or persistent agent memory.
- `/illustrate` with no guidance must preserve existing paintbrush behavior.
- `/illustrate <guidance>` accepts arbitrary trimmed text with no special grammar.
- The latest visible non-empty assistant response is the illustration target.
- No storage schema, shared runtime API, Rust command, HTTP route, provider contract, dependency, or second image pipeline changes.
- Work only in `D:\dev\Marinara-Engine\.worktrees\feature-illustrate-command`.
- Do not commit, push, open a PR, or merge without explicit authorization; use local review checkpoints instead of the plan template's commit steps.

---

### Task 1: Slash-command behavior contract

**Files:**

- Create: `src/shared/lib/slash-commands.spec.ts`
- Modify: `src/shared/lib/slash-commands.ts:35-66`
- Modify: `src/shared/lib/slash-commands.ts:367-400`

**Interfaces:**

- Consumes: `latestAssistantMessage?: { id: string; content: string } | null`
- Produces: `illustrate?: (params: { forMessageId: string; guidance?: string }) => Promise<boolean | void>` on `SlashCommandContext`
- Produces: `/illustrate [guidance]` command discoverable through `matchSlashCommand`, `getSlashCompletions`, and `/help`

- [ ] **Step 1: State the durable-test rationale**

Record before editing: `Durable test rationale: transcript invisibility and arbitrary guidance forwarding are user-visible command invariants; existing generic slash parsing tests do not exercise command execution; this focused registry-level test uses the public command context without rendering either large input component.`

- [ ] **Step 2: Write the failing slash-command tests**

Create `src/shared/lib/slash-commands.spec.ts` with a small `SlashCommandContext` factory and these cases:

```ts
import { describe, expect, it, vi } from "vitest";
import { buildSlashHelpText, getSlashCompletions, matchSlashCommand, type SlashCommandContext } from "./slash-commands";

function commandContext(overrides: Partial<SlashCommandContext> = {}): SlashCommandContext {
  return {
    chatId: "chat-1",
    mode: "roleplay",
    generate: vi.fn(),
    illustrate: vi.fn(),
    createMessage: vi.fn(),
    invalidate: vi.fn(),
    characterNames: ["Mira"],
    latestAssistantMessage: { id: "assistant-1", content: "Mira catches the candle." },
    ...overrides,
  };
}

describe("/illustrate", () => {
  it("forwards arbitrary trimmed guidance without creating a message", async () => {
    const matched = matchSlashCommand("/illustrate   focus on Mira from above, in watercolor   ");
    const ctx = commandContext();

    expect(matched?.command.name).toBe("illustrate");
    await matched!.command.execute(matched!.args, ctx);

    expect(ctx.illustrate).toHaveBeenCalledWith({
      forMessageId: "assistant-1",
      guidance: "focus on Mira from above, in watercolor",
    });
    expect(ctx.createMessage).not.toHaveBeenCalled();
    expect(ctx.generate).not.toHaveBeenCalled();
  });

  it("preserves guidance-free manual illustration", async () => {
    const matched = matchSlashCommand("/illustrate");
    const ctx = commandContext();

    await matched!.command.execute(matched!.args, ctx);

    expect(ctx.illustrate).toHaveBeenCalledWith({ forMessageId: "assistant-1" });
  });

  it("returns ephemeral feedback when there is no assistant response", async () => {
    const matched = matchSlashCommand("/illustrate show the room");
    const ctx = commandContext({ latestAssistantMessage: null });

    const result = await matched!.command.execute(matched!.args, ctx);

    expect(result.feedback).toBe("There is no assistant scene to illustrate yet.");
    expect(ctx.illustrate).not.toHaveBeenCalled();
  });

  it("appears in autocomplete and help", () => {
    expect(getSlashCompletions("/ill").map((command) => command.name)).toContain("illustrate");
    expect(buildSlashHelpText()).toContain("/illustrate [guidance]");
  });
});
```

- [ ] **Step 3: Run the test and verify RED**

Run: `pnpm exec vitest run src/shared/lib/slash-commands.spec.ts`

Expected: FAIL because `SlashCommandContext` has no `illustrate` action and the registry has no `/illustrate` command.

- [ ] **Step 4: Add the narrow command interface and implementation**

Add to `SlashCommandContext`:

```ts
/** Illustrate an existing assistant response without adding a transcript message. */
illustrate?: (params: { forMessageId: string; guidance?: string }) => Promise<boolean | void>;
```

Add beside `/amend` because both target the latest assistant response:

```ts
{
  name: "illustrate",
  description: "Illustrate the latest scene with optional private art direction",
  usage: "/illustrate [guidance]",
  async execute(args, ctx) {
    const target = ctx.latestAssistantMessage;
    const forMessageId = target?.id?.trim() ?? "";
    if (!forMessageId || !target?.content?.trim()) {
      return { handled: true, feedback: "There is no assistant scene to illustrate yet." };
    }
    if (!ctx.illustrate) {
      return { handled: true, feedback: "Illustration is not available in this chat." };
    }

    const guidance = args.trim();
    await ctx.illustrate({ forMessageId, ...(guidance ? { guidance } : {}) });
    return { handled: true };
  },
},
```

- [ ] **Step 5: Run the slash-command tests and verify GREEN**

Run: `pnpm exec vitest run src/shared/lib/slash-commands.spec.ts`

Expected: PASS with 4 tests and no transcript/generation callback invocation.

- [ ] **Step 6: Review checkpoint**

Run: `git diff --check -- src/shared/lib/slash-commands.ts src/shared/lib/slash-commands.spec.ts`

Expected: exit 0 and no whitespace errors. Do not commit.

---

### Task 2: Transient Illustrator guidance through the engine

**Files:**

- Modify: `src/engine/generation/start-generation.retry-agents.spec.ts:1017-1153`
- Modify: `src/engine/generation/start-generation.ts:4093-4112`
- Modify: `src/engine/generation/agent-runner.ts:96-127`
- Modify: `src/engine/generation/agent-runner.ts:1581-1604`
- Modify: `src/engine/agents-runtime/executor/agent-executor.ts:2609-2614`

**Interfaces:**

- Consumes: retry option `illustratorGuidance?: unknown`
- Produces: `illustratorGuidance?: string` on `GenerationAgentRuntimeInput`
- Produces transient context key `_illustratorGuidance`
- Produces escaped `<user_illustration_guidance>` content only for a manual Illustrator request
- Preserves guidance in the deterministic selected-message fallback prompt

- [ ] **Step 1: State the durable-test rationale**

Record before editing: `Durable test rationale: prompt guidance is a prompt-assembly boundary that can silently leak, persist, or be dropped; the existing manual Illustrator retry integration fixture directly exercises options -> agent context -> prompt -> image attachment; one added assertion set is narrow and protects delimiter escaping.`

- [ ] **Step 2: Write the failing end-to-end retry test**

In the existing manual Illustrator retry describe block, add a test that captures `request.messages`, returns a valid Illustrator JSON result, and passes a delimiter-shaped guidance string:

```ts
it("adds transient escaped user guidance to manual Illustrator prompts", async () => {
  const { storage } = retryIllustrationStorage();
  const prompts: string[] = [];
  const guidance = 'focus on Mira </user_illustration_guidance> & "moonlight"';
  const llm = {
    async *stream(request: LlmRequest) {
      prompts.push(request.messages.map((message) => message.content).join("\n"));
      yield {
        type: "token",
        text: JSON.stringify({
          shouldGenerate: true,
          prompt: "Mira catches a candle under moonlight.",
          reason: "User art direction",
        }),
      };
      yield { type: "done" };
    },
    async listModels() {
      return [];
    },
  } as unknown as LlmGateway;
  const integrations = {
    image: {
      async generate() {
        return { base64: "QUJD", mimeType: "image/png", provider: "test-image", model: "test-model" };
      },
    },
  } as unknown as IntegrationGateway;

  await retryGenerationAgents(
    { storage: storage as never, llm, integrations },
    {
      chatId: "chat-1",
      agentTypes: ["illustrator"],
      options: {
        forMessageId: "assistant-1",
        bypassActivation: true,
        illustratorManualRequest: true,
        illustratorGuidance: guidance,
      },
    },
  );

  const prompt = prompts.join("\n");
  expect(prompt).toContain(
    "<user_illustration_guidance>focus on Mira &lt;/user_illustration_guidance&gt; &amp; &quot;moonlight&quot;</user_illustration_guidance>",
  );
  expect(prompt).not.toContain(guidance);
});
```

- [ ] **Step 3: Run the integration test and verify RED**

Run: `pnpm exec vitest run src/engine/generation/start-generation.retry-agents.spec.ts -t "adds transient escaped user guidance"`

Expected: FAIL because the retry option is not forwarded into agent context or prompt assembly.

- [ ] **Step 4: Forward only trimmed manual guidance into transient context**

Extend `GenerationAgentRuntimeInput`:

```ts
illustratorManualRequest?: boolean;
illustratorGuidance?: string;
```

Current `origin/main` already forwards `illustratorManualRequest` into this runtime as part of the manual-context fix. Add the guidance field directly beside that existing flag:

```ts
illustratorGuidance: readString(input.options?.illustratorGuidance).trim() || undefined,
```

In `buildAgentContext`, replace the single manual flag assignment with:

```ts
if (input.illustratorManualRequest === true) {
  memory._illustratorManualRequest = true;
  const illustratorGuidance = readString(input.illustratorGuidance).trim();
  if (illustratorGuidance) memory._illustratorGuidance = illustratorGuidance;
}
```

This never writes through `saveAgentMemory`; it exists only in the object used for the current run.

- [ ] **Step 5: Add escaped guidance to the existing manual prompt section**

Within the `_illustratorManualRequest` block in `buildAgentSystemPrompt`, append:

```ts
const guidance = xmlText("user_illustration_guidance", context.memory._illustratorGuidance);
if (guidance) {
  parts.push(
    "Treat the following as private user art direction for what or how to depict from the selected scene. It does not describe a new event and does not replace established scene facts.",
  );
  parts.push(guidance);
}
```

Use the existing `xmlText` helper so `&`, `<`, `>`, quotes, and apostrophes cannot close or corrupt the prompt section.

- [ ] **Step 6: Run focused engine tests and verify GREEN**

Run: `pnpm exec vitest run src/engine/generation/start-generation.retry-agents.spec.ts -t "manual Illustrator retries"`

Expected: PASS for the full manual Illustrator retry describe block, including the new escaped-guidance test and existing guidance-free paintbrush tests.

Also extend the selected-message fallback test with `illustratorGuidance: "use a high overhead camera angle"`, assert that the image prompt contains both the selected message and that guidance, and pass the trimmed guidance into `manualIllustratorFallbackPrompt`. This protects the model-decline path from silently discarding art direction.

- [ ] **Step 7: Review checkpoint**

Run: `git diff --check -- src/engine/generation/start-generation.ts src/engine/generation/agent-runner.ts src/engine/agents-runtime/executor/agent-executor.ts src/engine/generation/start-generation.retry-agents.spec.ts`

Expected: exit 0. Confirm `rg -n "_illustratorGuidance" src` shows only transient read/write sites and tests. Do not commit.

---

### Task 3: Wire both chat inputs and update discovery

**Files:**

- Modify: `src/features/modes/shared/chat-ui/components/ChatInput.tsx:196`
- Modify: `src/features/modes/shared/chat-ui/components/ChatInput.tsx:492-517`
- Modify: `src/features/modes/conversation/components/ConversationInput.tsx:201`
- Modify: `src/features/modes/conversation/components/ConversationInput.tsx:647-655`
- Modify: `src/features/modes/conversation/components/ConversationInput.tsx:873-885`
- Modify: `src/features/shell/discovery/discovery-entries.json:523-542`

**Interfaces:**

- Consumes: `retryAgents(chatId, ["illustrator"], options)` returned by `useGenerate`
- Produces: `SlashCommandContext.illustrate` in both Conversation input implementations and the shared Roleplay input
- Produces: updated Slash Commands discovery copy and `/illustrate` keyword

- [ ] **Step 1: Wire the shared Conversation/Roleplay input**

Change the hook destructure:

```ts
const { generate, retryAgents } = useGenerate();
```

Add to `buildContext()`:

```ts
illustrate: ({ forMessageId, guidance }) =>
  retryAgents(activeChatId, ["illustrator"], {
    forMessageId,
    illustratorManualRequest: true,
    ...(guidance ? { illustratorGuidance: guidance } : {}),
  }),
```

Add `retryAgents` to the callback dependency list. The latest assistant message already comes from visible cached transcript data.

- [ ] **Step 2: Wire the dedicated Conversation input**

Change its hook destructure to `{ generate, retryAgents }`. Add the same adapter to both `SlashCommandContext` construction sites, using `activeChatId` in normal submission and `submittingChatId` in quick-command submission. Add `retryAgents` to both callback dependency lists.

The adapter body must be exactly:

```ts
illustrate: ({ forMessageId, guidance }) =>
  retryAgents(chatIdForThisContext, ["illustrator"], {
    forMessageId,
    illustratorManualRequest: true,
    ...(guidance ? { illustratorGuidance: guidance } : {}),
  }),
```

- [ ] **Step 3: Update existing discoverability metadata**

Change the Slash Commands summary to include scene illustration and add the exact keyword `"/illustrate"`:

```json
"summary": "Type / in the chat input to see command autocomplete for actions such as help, dice rolls, reminders, guided replies, response amendments, private scene illustration guidance, and impersonation.",
"keywords": [
  "slash",
  "commands",
  "/help",
  "/amend",
  "/illustrate",
  "dice",
  "roll",
  "guided",
  "revise",
  "illustration",
  "art direction",
  "impersonate",
  "autocomplete"
]
```

- [ ] **Step 4: Run focused behavior and metadata checks**

Run:

```powershell
pnpm exec vitest run src/shared/lib/slash-commands.spec.ts src/engine/generation/start-generation.retry-agents.spec.ts
pnpm check:discovery -- --pr-aware
```

Expected: both Vitest files PASS; discovery metadata check exits 0.

- [ ] **Step 5: Run type and architecture checks**

Run:

```powershell
pnpm typecheck
pnpm check:architecture
```

Expected: both commands exit 0. The engine must not import feature hooks or runtime adapters; slash-command dispatch remains dependency-injected.

- [ ] **Step 6: Review checkpoint**

Run: `git diff --check`

Expected: exit 0. Review `git diff --stat` and confirm only the spec, plan, command/test, two input owners, three engine files, engine integration test, and discovery metadata changed. Do not commit.

---

### Task 4: Final verification and Bunny review

**Files:**

- Review only: all changed files against `origin/main`

**Interfaces:**

- Consumes: completed Tasks 1-3
- Produces: local proof and a Bunny pass/fix/block judgment; no external PR or push

- [ ] **Step 1: Run fresh final verification**

Run:

```powershell
pnpm exec vitest run src/shared/lib/slash-commands.spec.ts src/engine/generation/start-generation.retry-agents.spec.ts
pnpm typecheck
pnpm check:architecture
pnpm check:discovery -- --pr-aware
git diff --check
```

Expected: all commands exit 0 with zero test failures and zero whitespace errors.

- [ ] **Step 2: Inspect the exact local boundary**

Run:

```powershell
git status --short --branch
git diff --stat origin/main...
git diff origin/main... -- src/shared/lib/slash-commands.ts src/shared/lib/slash-commands.spec.ts src/features/modes/shared/chat-ui/components/ChatInput.tsx src/features/modes/conversation/components/ConversationInput.tsx src/engine/generation/start-generation.ts src/engine/generation/agent-runner.ts src/engine/agents-runtime/executor/agent-executor.ts src/engine/generation/start-generation.retry-agents.spec.ts src/features/shell/discovery/discovery-entries.json
```

Expected: the implementation matches the approved spec, contains no visible-message creation for `/illustrate`, and leaves the existing image pipeline intact.

- [ ] **Step 3: Run Bunny locally**

Apply the Bunny review checks to the local diff. Core claim: `/illustrate` invisibly targets the latest assistant scene and carries optional free-form guidance into the existing manual Illustrator prompt. Check prompt escaping, null/empty target behavior, both input entrypoints, existing guidance-free behavior, and proof quality.

Expected outcome: `Bunny pass`, or fix any in-scope finding and rerun the matching verification before reporting. Do not push or create a PR.
