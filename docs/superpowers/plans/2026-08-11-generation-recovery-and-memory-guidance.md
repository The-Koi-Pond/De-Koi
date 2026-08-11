# Generation Recovery and Memory Guidance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep failed generations visibly retryable and make Memory Recall fall back cleanly—with actionable guidance—when semantic embeddings are not configured.

**Architecture:** A pure engine resolver owns effective embedding identity and is shared by generation and settings presentation. Foreground generation emits a typed nonfatal warning and passes only a valid semantic identity into prompt assembly. UI generation failures remain ephemeral per-chat store state rendered by the conversation and roleplay input owners; no synthetic message is persisted and no request is retried automatically.

**Tech Stack:** TypeScript, React 19, Zustand, TanStack Query, Vitest, Tauri/remote-runtime capability adapters.

## Global Constraints

- Preserve lexical Memory Recall when embeddings are unavailable.
- Never automatically retry a provider request.
- Never persist failure notices as chat messages.
- Do not expose connection credentials or add a new Tauri/HTTP route.
- Conversation and roleplay receive the new recovery UI; game keeps its existing recovery flow.
- No commit, push, PR, merge, or deployment without a later explicit shipping request.

---

### Task 1: Resolve embedding capability before semantic recall

**Files:**

- Create: `src/engine/generation/effective-embedding-configuration.ts`
- Create: `src/engine/generation/effective-embedding-configuration.spec.ts`
- Modify: `src/engine/contracts/types/generation.ts`
- Modify: `src/engine/generation/start-generation.ts`
- Modify: `src/engine/generation/prompt-assembly.ts`
- Modify: `src/engine/generation/start-generation.memory-recall.e2e.spec.ts`

**Interfaces:**

- Produces: `EffectiveEmbeddingConfiguration`, `classifyEffectiveEmbeddingConfiguration(...)`, and `resolveEffectiveEmbeddingConfiguration(...)`.
- Produces: `agent_warning` code `memory_embedding_unavailable` with `connectionId`, `connectionName`, and `reason`.
- Consumes: public connection records through `StorageGateway`; no secret-bearing adapter.

- [ ] **Step 1: Write the pure resolver failing tests**

Cover direct model, dedicated connection model, dedicated-model fallback to the generation connection's explicit model, missing dedicated record, missing model, and unsupported subscription provider without a dedicated connection.

```ts
expect(
  classifyEffectiveEmbeddingConfiguration({
    connection: { id: "chat", provider: "custom", embeddingModel: "" },
    chatEmbeddingConnectionId: null,
    embeddingConnection: null,
  }),
).toEqual({
  available: false,
  connectionId: "chat",
  connectionName: "chat",
  reason: "missing_model",
});

expect(
  classifyEffectiveEmbeddingConfiguration({
    connection: { id: "chat", embeddingConnectionId: "embed", embeddingModel: "" },
    chatEmbeddingConnectionId: null,
    embeddingConnection: { id: "embed", embeddingModel: "text-embedding-3-small" },
  }),
).toMatchObject({ available: true, connectionId: "embed", model: "text-embedding-3-small" });
```

- [ ] **Step 2: Run the resolver test and confirm RED**

Run: `pnpm vitest run src/engine/generation/effective-embedding-configuration.spec.ts`

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement the resolver**

Use the precedence `chat.embeddingConnectionId -> connection.embeddingConnectionId -> connection.id`. If the target differs from the selected connection, load only that record with `storage.get("connections", targetId)`. Resolve the model as `target.embeddingModel || connection.embeddingModel`. Treat missing target, missing model, `openai_chatgpt`, and `claude_subscription` without a dedicated target as unavailable.

```ts
export type EffectiveEmbeddingConfiguration =
  | { available: true; connectionId: string; connectionName: string; model: string }
  | {
      available: false;
      connectionId: string | null;
      connectionName: string;
      reason: "missing_connection" | "missing_model" | "unsupported_provider";
    };
```

- [ ] **Step 4: Verify resolver GREEN**

Run: `pnpm vitest run src/engine/generation/effective-embedding-configuration.spec.ts`

Expected: PASS.

- [ ] **Step 5: Add the foreground regression test**

Extend `start-generation.memory-recall.e2e.spec.ts` with Memory Recall enabled, a selected connection lacking both `embeddingModel` and `embeddingConnectionId`, and spies for `llm.embed` and `storage.querySemanticMemories`. Assert:

```ts
expect(events).toContainEqual(
  expect.objectContaining({
    type: "agent_warning",
    data: expect.objectContaining({ code: "memory_embedding_unavailable", reason: "missing_model" }),
  }),
);
expect(llm.embed).not.toHaveBeenCalled();
expect(storage.querySemanticMemories).not.toHaveBeenCalled();
expect(savedPrompt).toContain("<memories>");
```

Add the negative row: a dedicated connection with a model calls the semantic gateways and emits no missing-embedding warning.

- [ ] **Step 6: Run the foreground test and confirm RED**

Run: `pnpm vitest run src/engine/generation/start-generation.memory-recall.e2e.spec.ts`

Expected: FAIL because current generation calls the embedding and semantic gateways.

- [ ] **Step 7: Route the resolved identity through generation**

Extend `GenerationAgentConnectionWarning` with:

```ts
interface GenerationMemoryEmbeddingUnavailableWarning {
  severity: "warning";
  code: "memory_embedding_unavailable";
  message: string;
  agentNames: [];
  connectionId: string | null;
  connectionName: string;
  reason: "missing_connection" | "missing_model" | "unsupported_provider";
}
```

In foreground generation, resolve embedding configuration after the foreground connection is selected. Emit the warning only when `getEffectiveMemoryRecallEnabled(...)` is true and configuration is unavailable. Build `turnEmbeddingSource` only for an available configuration, passing its exact `connectionId` and `model` to `llm.embed`.

Add `semanticConnectionId?: string | null` to prompt assembly input. `buildCanonicalMemoryContext` receives that value only when configuration is available; otherwise it receives null and uses its existing lexical path.

- [ ] **Step 8: Verify Task 1 GREEN**

Run: `pnpm vitest run src/engine/generation/effective-embedding-configuration.spec.ts src/engine/generation/start-generation.memory-recall.e2e.spec.ts src/engine/generation/canonical-memory-context.spec.ts`

Expected: PASS with no semantic gateway calls in the unavailable row.

### Task 2: Persist generation failure UI state until explicit recovery

**Files:**

- Modify: `src/shared/stores/chat.store.ts`
- Modify: `src/features/runtime/generation/hooks/use-generate.ts`
- Modify: `src/features/runtime/generation/hooks/use-generate.spec.ts`
- Create: `src/features/runtime/generation/components/GenerationFailureNotice.tsx`
- Create: `src/features/runtime/generation/components/GenerationFailureNotice.spec.tsx`
- Modify: `src/features/runtime/generation/index.ts`

**Interfaces:**

- Produces: `GenerationFailureState { message: string; failedAt: number }` keyed by chat ID.
- Produces: `setGenerationFailure(chatId, failure | null)`.
- Produces: `<GenerationFailureNotice chatId onRetry disabled />`.

- [ ] **Step 1: Write the runtime failure-state test**

Add one test where `runGenerationWithUi` throws a LinkAPI-style network error and assert the chat store retains the user-facing failure. Add negative rows for `AbortError` and a successful assistant message.

```ts
expect(useChatStore.getState().generationFailures.get(chatId)?.message).toContain("network error");
expect(useChatStore.getState().generationFailures.has(abortedChatId)).toBe(false);
```

- [ ] **Step 2: Run the runtime test and confirm RED**

Run: `pnpm vitest run src/features/runtime/generation/hooks/use-generate.spec.ts`

Expected: FAIL because `generationFailures` does not exist.

- [ ] **Step 3: Implement per-chat ephemeral failure state**

Add a `Map<string, GenerationFailureState>` and immutable-map setter to `chat.store.ts`; clear it in `reset`. In `runGenerationWithUi`, clear the target chat at request start and when an assistant message is accepted. In the non-abort catch, store the same normalized message sent to the toast before rethrowing.

- [ ] **Step 4: Verify runtime state GREEN**

Run: `pnpm vitest run src/features/runtime/generation/hooks/use-generate.spec.ts`

Expected: PASS.

- [ ] **Step 5: Write the notice component failing test**

Render the notice with store state populated. Assert `role="alert"`, provider failure copy, Retry, and Dismiss. Click Retry and assert one callback; click Dismiss and assert the store row is removed.

- [ ] **Step 6: Run the component test and confirm RED**

Run: `pnpm vitest run src/features/runtime/generation/components/GenerationFailureNotice.spec.tsx`

Expected: FAIL because the component does not exist.

- [ ] **Step 7: Implement the notice**

Render a compact destructive-tone status row above the composer. Retry calls the supplied callback once and remains disabled while generation is active. Dismiss calls `setGenerationFailure(chatId, null)`. Export it through `src/features/runtime/generation/index.ts`.

- [ ] **Step 8: Verify Task 2 GREEN**

Run: `pnpm vitest run src/features/runtime/generation/hooks/use-generate.spec.ts src/features/runtime/generation/components/GenerationFailureNotice.spec.tsx`

Expected: PASS.

### Task 3: Mount recovery in mode owners and add embedding guidance

**Files:**

- Create: `src/features/runtime/generation/lib/memory-embedding-guidance.ts`
- Create: `src/features/runtime/generation/lib/memory-embedding-guidance.spec.ts`
- Modify: `src/features/runtime/generation/hooks/use-generate.ts`
- Modify: `src/features/runtime/generation/hooks/use-generate.spec.ts`
- Modify: `src/features/modes/conversation/components/ConversationInput.tsx`
- Modify: `src/features/modes/conversation/components/ConversationInput.saved-status-removal.spec.ts`
- Modify: `src/features/modes/shared/chat-ui/components/ChatInput.tsx`
- Modify: `src/features/modes/shared/chat-ui/components/ChatInput.submitted-input-recovery.spec.ts`
- Modify: `src/features/modes/shared/chat-ui/components/ChatSettingsDrawer.tsx`

**Interfaces:**

- Produces: exact warning title and instructions shared by runtime toast and Chat Settings.
- Consumes: `memory_embedding_unavailable` event data and the effective-embedding resolver.

- [ ] **Step 1: Write guidance and toast failing tests**

Assert the exact copy states lexical fallback still works and tells the user to set **Embedding Model** or **Embedding Connection**. Feed two identical warning events through `runGenerationWithUi`; assert one session warning. Invoke its action and assert `openRightPanel("connections")` and `openConnectionDetail(connectionId)`.

- [ ] **Step 2: Run guidance tests and confirm RED**

Run: `pnpm vitest run src/features/runtime/generation/lib/memory-embedding-guidance.spec.ts src/features/runtime/generation/hooks/use-generate.spec.ts`

Expected: FAIL because specialized guidance and action routing do not exist.

- [ ] **Step 3: Implement deduplicated actionable warning**

Keep a module-session `Set<string>` keyed by `chatId + connectionId + reason`. For `memory_embedding_unavailable`, call:

```ts
toast.warning(MEMORY_EMBEDDING_WARNING_TITLE, {
  description: MEMORY_EMBEDDING_WARNING_DESCRIPTION,
  duration: 15_000,
  action: {
    label: "Open Connections",
    onClick: () => {
      const ui = useUIStore.getState();
      ui.openRightPanel("connections");
      if (connectionId) ui.openConnectionDetail(connectionId);
    },
  },
});
```

Do not add a permanent “don't warn again” preference.

- [ ] **Step 4: Mount the failure notice in conversation and roleplay**

Place `GenerationFailureNotice` directly above each input shell. Its `onRetry` calls the existing empty-input retry path (`handleSend`) so it reuses the last user message rather than creating another one. Add focused component assertions that the notice renders and one Retry click calls one generation request.

- [ ] **Step 5: Add Chat Settings inline guidance**

Use the current chat connection plus `useConnections()` data with `classifyEffectiveEmbeddingConfiguration(...)`. When `getEffectiveMemoryRecallEnabled(...)` is true and the result is unavailable, render the shared description plus an **Open Connections** button under the Memory Recall toggle. Hide the row when a direct or dedicated embedding model is configured.

- [ ] **Step 6: Verify Task 3 GREEN**

Run: `pnpm vitest run src/features/runtime/generation/lib/memory-embedding-guidance.spec.ts src/features/runtime/generation/hooks/use-generate.spec.ts src/features/modes/conversation/components/ConversationInput.saved-status-removal.spec.ts src/features/modes/shared/chat-ui/components/ChatInput.submitted-input-recovery.spec.ts`

Expected: PASS.

### Task 4: Cross-lane verification and cleanup

**Files:**

- Review all files changed by Tasks 1-3.

**Interfaces:**

- Consumes: completed engine, runtime, and mode-owner changes.
- Produces: clean proof with no temporary instrumentation.

- [ ] **Step 1: Run focused regression set**

Run all Task 1-3 Vitest files together. Expected: PASS.

- [ ] **Step 2: Run TypeScript and architecture checks**

Run: `pnpm typecheck`

Run: `pnpm check:architecture`

Expected: both exit 0.

- [ ] **Step 3: Run diff hygiene**

Run: `git diff --check`

Run: `git status --short`

Expected: only the approved spec, plan, implementation, and focused regression tests are present; no debug output or generated artifacts.

- [ ] **Step 4: Run Bunny locally**

Review the diff against `origin/main` for issue match, mode separation, request duplication, stale failure state, false embedding warnings, and proof gaps. Fix blocking findings and rerun matching tests. Do not commit or publish.
