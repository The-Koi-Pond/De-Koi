# Automatic Memory Hygiene Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reject low-value automatic captures before persistence and automatically maintain every chat, scene, and character memory scope without a review/apply workflow.

**Architecture:** Extract the existing aggressive value review into one React-free engine policy, then use it both before automatic persistence and during whole-scope maintenance. Rust owns two-phase transcript capture, mutation-triggered durable jobs, dual-store atomic apply/undo, and remote parity; a bounded TypeScript worker owns model analysis, fixed-point application, retries, foreground-generation deference, and startup discovery.

**Tech Stack:** TypeScript 5.9, React 19, Vitest 4, Tauri 2, Rust, Serde, existing JSON collection storage, existing LLM structured generation

## Global Constraints

- Automatic transcript and canonical candidates must pass the same low-value policy before storage.
- Automatic maintenance includes active and pinned memories from automatic, manual, imported, corrected, command, edited, and cleanup origins.
- `discard`, `keep_one`, and `combine` apply automatically; `conflict` never mutates either source.
- Chat-memory chunks and canonical memories are separate maintenance targets; do not consolidate across stores.
- Model work is sequential, cancellable, bounded, and paused behind foreground generation.
- Failed or malformed value review creates no automatic candidate memory.
- Every apply is atomic, stale-state checked, and recorded in the existing undo journal.
- Embedded Tauri and hostable remote runtime contracts must remain identical.
- Healthy no-op maintenance is silent.
- Do not hard-delete lifecycle history.
- Do not add a user setting that disables hygiene while Memory Recall is enabled.
- Do not commit, push, open a PR, or communicate externally without explicit authorization. Commit commands below are authorization gates, not standing permission.

## File structure

### New focused owners

- `src/engine/generation/memory-value-review.ts`: shared low-value prompt, structured response parsing, and discard-proposal generation.
- `src/engine/entities/memory-maintenance-sources.ts`: React-free conversion of chat chunks, canonical records, and ephemeral capture candidates into `MemoryCleanupSource`.
- `src/engine/generation/background-generation-coordinator.ts`: storage-scoped foreground lease and deferred background callbacks shared by capture and maintenance.
- `src/engine/generation/automatic-memory-maintenance-queue.ts`: durable target queue, analysis/apply loop, retries, fixed-point bounds, and startup discovery.
- `src/engine/capabilities/memory-maintenance.ts`: narrow engine port for target-aware apply and undo.
- `src/app/startup/automatic-memory-maintenance.ts`: app-edge dependency wiring and quiet scheduler lifecycle.
- `src/features/catalog/memory-maintenance/components/MemoryMaintenanceRecovery.tsx`: optional latest-batch summary and undo; no analysis or apply controls.
- `src-tauri/src/commands/storage/memory_maintenance/jobs.rs`: deterministic durable job upsert and undo suppression.

### Existing owners changed

- Capture: `src/engine/generation/automatic-memory-capture.ts`, `automatic-memory-capture-queue.ts`
- Cleanup analysis: `src/engine/generation/memory-cleanup.ts`
- Contracts: `src/engine/contracts/types/memory-maintenance.ts`, `src/engine/capabilities/storage.ts`
- Transcript storage: `src-tauri/src/commands/storage/chat_memory.rs`
- Cleanup storage: `src-tauri/src/commands/storage/memory_maintenance.rs`, `memory_maintenance/contracts.rs`, `chat.rs`, `canonical.rs`
- Runtime adapters: `src/shared/api/storage-api.ts`, `memory-maintenance-api.ts`, `remote-runtime.ts`
- Embedded/HTTP registration: `src-tauri/src/commands/storage/commands/chats.rs`, `commands/memory.rs`, `http_dispatch.rs`, `lib.rs`
- Collection registration: `src/engine/capabilities/storage-collections.ts`, `src-tauri/src/commands/storage/contracts.rs`, `src-tauri/src/commands/storage/admin.rs`
- Startup: `src/app/shell/AppShell.tsx`
- UI removal/recovery: `CharacterMemoriesTab.tsx`, `MemoryRecallMemoriesModal.tsx`, memory-maintenance public exports and tests
- Discovery: `src/features/shell/discovery/discovery-entries.json`

---

### Task 1: Extract one shared value-review policy and source adapters

**Durable test rationale:** Low-value classification is a risky model boundary used by two independent write paths. Session-only proof would not prevent capture and cleanup prompts from drifting apart. The existing focused cleanup suites provide a narrow stable seam.

**Files:**

- Create: `src/engine/generation/memory-value-review.ts`
- Create: `src/engine/generation/memory-value-review.spec.ts`
- Create: `src/engine/entities/memory-maintenance-sources.ts`
- Create: `src/engine/entities/memory-maintenance-sources.spec.ts`
- Modify: `src/engine/generation/memory-cleanup.ts:24-130,373-525`
- Modify: `src/engine/generation/memory-cleanup.spec.ts`
- Modify: `src/features/catalog/memory-maintenance/adapters.ts`
- Modify: `src/features/catalog/memory-maintenance/adapters.spec.ts`

**Interfaces:**

- Produces:

```ts
export interface MemoryValueReviewResult {
  proposals: MemoryCleanupProposal[];
  reviewedSourceIds: string[];
}

export async function reviewMemoryValues(input: {
  scope: MemoryCleanupScope;
  sources: MemoryCleanupSource[];
  connectionId: string;
  llm: LlmGateway;
  signal?: AbortSignal;
  onGroupComplete?: () => void;
}): Promise<MemoryValueReviewResult>;

export function chatMemoryCleanupSource(memory: ChatMemoryChunk, scope: MemoryCleanupScope): MemoryCleanupSource;

export function canonicalMemoryCleanupSource(memory: CanonicalMemoryRecord): MemoryCleanupSource;

export function canonicalInputCleanupSource(id: string, input: CanonicalMemoryInput): MemoryCleanupSource;

export function cleanupScope(scope: MemoryScope): MemoryCleanupScope;
export function memoryScope(scope: MemoryCleanupScope): MemoryScope;
```

- Consumes: existing `prepareMemoryCleanupCandidates(...).valueGroups`, `validateCleanupProposal`, `generateStructured`, and memory-maintenance contracts.

- [ ] **Step 1: Write failing policy tests**

Add tests that call the wished-for public API and assert every supplied source is reviewed and only valid discard proposals survive:

```ts
it("reviews every source with the aggressive shared policy", async () => {
  const llm = llmWithStructuredResponses([
    { proposals: [{ type: "discard", sourceIds: ["junk"], reason: "Low-value memory" }] },
  ]);
  const result = await reviewMemoryValues({
    scope: { kind: "chat", id: "chat-1" },
    sources: [source({ id: "junk" }), source({ id: "durable" })],
    connectionId: "connection-1",
    llm,
  });

  expect(result.reviewedSourceIds).toEqual(["durable", "junk"]);
  expect(result.proposals.map((proposal) => proposal.sourceIds)).toEqual([["junk"]]);
  expect(llm.complete).toHaveBeenCalledWith(
    expect.objectContaining({
      messages: expect.arrayContaining([
        expect.objectContaining({
          content: expect.stringContaining("generic or common knowledge"),
        }),
      ]),
    }),
    undefined,
  );
});

it("rejects malformed or cross-group discard proposals", async () => {
  const llm = llmWithStructuredResponses([
    {
      proposals: [
        { type: "discard", sourceIds: ["unknown"], reason: "Low-value memory" },
        { type: "combine", sourceIds: ["a", "b"], reason: "Overlapping memories" },
      ],
    },
  ]);

  await expect(
    reviewMemoryValues({
      scope: { kind: "chat", id: "chat-1" },
      sources: [source({ id: "a" }), source({ id: "b" })],
      connectionId: "connection-1",
      llm,
    }),
  ).rejects.toThrow("No valid value-review proposals");
});
```

Add adapter tests proving canonical chat/scene scopes are preserved rather than forced to `character`, and that automatic, manual, imported, corrected, command, pinned, and edited metadata map correctly.

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```powershell
pnpm vitest run src/engine/generation/memory-value-review.spec.ts src/engine/entities/memory-maintenance-sources.spec.ts
```

Expected: FAIL because both modules and their exports do not exist.

- [ ] **Step 3: Implement the shared reviewer**

Move `VALUE_SYSTEM_PROMPT` and `cleanupValuePrompt` out of `memory-cleanup.ts`. Implement bounded group execution in the new module:

```ts
export async function reviewMemoryValues(input: MemoryValueReviewInput): Promise<MemoryValueReviewResult> {
  const scoped = input.sources.filter((source) => scopeKey(source.scope) === scopeKey(input.scope));
  const sourcesById = new Map(scoped.map((source) => [source.id, source]));
  const groups = prepareMemoryCleanupCandidates(scoped).valueGroups;
  const proposals: MemoryCleanupProposal[] = [];
  const reviewedSourceIds: string[] = [];

  for (const group of groups) {
    throwIfAborted(input.signal);
    const groupSources = group.sourceIds
      .map((id) => sourcesById.get(id))
      .filter((source): source is MemoryCleanupSource => Boolean(source));
    reviewedSourceIds.push(...groupSources.map((source) => source.id));
    const result = await generateStructured(
      { llm: input.llm },
      valueReviewStructuredRequest(input.connectionId, input.scope, groupSources),
      input.signal,
    );
    throwIfAborted(input.signal);
    if (!result.ok) throw new Error(result.failure.message);
    proposals.push(...normalizeDiscardProposals(result.data.proposals, groupSources, sourcesById));
    input.onGroupComplete?.();
  }

  return {
    proposals: resolveSingleSourceDiscards(proposals),
    reviewedSourceIds: Array.from(new Set(reviewedSourceIds)).sort(),
  };
}
```

Keep the current temperature, reasoning exclusion, 4,096-token output limit, repair count, untrusted-data wording, low-value criteria, and strict `Low-value memory` reason.

- [ ] **Step 4: Implement engine-owned source adapters**

Move the existing adapter rules below React and preserve real scopes:

```ts
export function canonicalMemoryCleanupSource(memory: CanonicalMemoryRecord): MemoryCleanupSource {
  const payload = memory.payload ?? {};
  const cleanupGenerated = isCleanupReplacement(payload);
  const imported = memory.tags.includes("imported") || typeof payload.importedFromMemoryId === "string";
  return {
    id: memory.id,
    scope: cleanupScope(memory.scope),
    content: memory.content,
    kind: memory.kind,
    status: memory.status,
    origin: cleanupGenerated ? "cleanup" : imported ? "imported" : payload.automatic === true ? "automatic" : "manual",
    confidence: memory.confidence,
    messageIds: [...memory.provenance.messageIds],
    sourceChatIds: memory.provenance.sourceChatId ? [memory.provenance.sourceChatId] : [],
    createdAt: memory.createdAt,
    updatedAt: memory.updatedAt,
    pinned: memory.status === "pinned",
    userEdited: payload.userEdited === true || (payload.automatic !== true && !cleanupGenerated),
  };
}
```

Leave the feature adapter file as a temporary direct re-export so Task 8 can remove it without breaking intermediate UI builds.

- [ ] **Step 5: Replace cleanup’s private value loop**

Call `reviewMemoryValues` from `analyzeMemoryCleanup`, add returned proposals to the existing ranked proposal set, and preserve progress:

```ts
const valueReview = await reviewMemoryValues({
  scope: input.scope,
  sources: scopedSources,
  connectionId: input.connectionId,
  llm: input.llm,
  signal: input.signal,
  onGroupComplete: advanceProgress,
});

for (const proposal of valueReview.proposals) {
  rankedProposals.push({ proposal, exact: false, groupId: "value-review" });
}
```

- [ ] **Step 6: Run focused regression tests and verify GREEN**

Run:

```powershell
pnpm vitest run src/engine/generation/memory-value-review.spec.ts src/engine/entities/memory-maintenance-sources.spec.ts src/engine/generation/memory-cleanup.spec.ts src/features/catalog/memory-maintenance/adapters.spec.ts
```

Expected: PASS with exhaustive value review, unchanged consolidation behavior, and no feature-to-engine ownership regression.

- [ ] **Step 7: Run the matching architecture gate**

Run:

```powershell
pnpm check:architecture
```

Expected: PASS; engine modules import only engine contracts, entities, capabilities, and generation utilities.

- [ ] **Step 8: Authorization-gated checkpoint**

If and only if commit authorization exists:

```powershell
git add src/engine/generation/memory-value-review.ts src/engine/generation/memory-value-review.spec.ts src/engine/entities/memory-maintenance-sources.ts src/engine/entities/memory-maintenance-sources.spec.ts src/engine/generation/memory-cleanup.ts src/engine/generation/memory-cleanup.spec.ts src/features/catalog/memory-maintenance/adapters.ts src/features/catalog/memory-maintenance/adapters.spec.ts
git commit -m "refactor: share memory value review policy"
```

Otherwise record the passing checkpoint and leave the files uncommitted.

---

### Task 2: Add two-phase transcript capture without persistence during preview

**Durable test rationale:** The current Rust refresh command writes transcript chunks before TypeScript can judge their value. A preview/commit split changes storage semantics and must prove stale rejection, no preview writes, idempotence, and remote parity.

**Files:**

- Modify: `src-tauri/src/commands/storage/chat_memory.rs:1179-1484`
- Modify: `src-tauri/src/commands/storage/commands/chats.rs:98-112`
- Modify: `src-tauri/src/http_dispatch.rs:987-1006`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src/shared/api/remote-runtime.ts:147-160`
- Modify: `src/shared/api/chat-command-api.ts`
- Modify: `src/shared/api/chat-command-api.spec.ts`
- Modify: `src/engine/capabilities/storage.ts`
- Modify: `src/shared/api/storage-api.ts:547-550`
- Modify: `src/shared/api/storage-api.spec.ts`

**Interfaces:**

- Produces:

```ts
export interface ChatMemoryCapturePreview {
  version: 1;
  chatId: string;
  sourceMessageIds: string[];
  fingerprint: string;
  candidate: ChatMemoryChunk | null;
}

export interface CommitChatMemoryCaptureInput {
  version: 1;
  chatId: string;
  sourceMessageIds: string[];
  fingerprint: string;
}

export interface CommitChatMemoryCaptureResult {
  operation: "created" | "updated";
  memory: ChatMemoryChunk;
}
```

Add optional `previewChatMemoryCapture(...)` and `commitChatMemoryCapture(...)` methods to `StorageGateway`.

- [ ] **Step 1: Write failing Rust preview/commit tests**

Add focused tests beside the existing focused-refresh tests:

```rust
#[tokio::test]
async fn capture_preview_does_not_persist_a_chat_memory() {
    let state = test_state("memory-capture-preview-no-write");
    seed_complete_exchange(&state, "chat-1");

    let preview = preview_chat_memory_capture(
        &state,
        "chat-1",
        vec!["message-user".into(), "message-assistant".into()],
    )
    .expect("preview should succeed");

    assert!(preview["candidate"].is_object());
    assert!(list_chat_memories(&state, "chat-1").as_array().unwrap().is_empty());
}

#[tokio::test]
async fn capture_commit_revalidates_and_is_idempotent() {
    let state = test_state("memory-capture-commit-idempotent");
    seed_complete_exchange(&state, "chat-1");
    let preview = preview_chat_memory_capture(&state, "chat-1", source_ids()).unwrap();

    let first = commit_chat_memory_capture(&state, preview.clone()).await.unwrap();
    let second = commit_chat_memory_capture(&state, preview).await.unwrap();

    assert_eq!(first["memory"]["id"], second["memory"]["id"]);
    assert_eq!(list_chat_memories(&state, "chat-1").as_array().unwrap().len(), 1);
}

#[tokio::test]
async fn capture_commit_rejects_a_stale_preview_without_writing() {
    let state = test_state("memory-capture-commit-stale");
    seed_complete_exchange(&state, "chat-1");
    let preview = preview_chat_memory_capture(&state, "chat-1", source_ids()).unwrap();
    state
        .storage
        .patch(
            "messages",
            "message-assistant",
            json!({ "content": "Edited after preview" }),
        )
        .unwrap();

    let error = commit_chat_memory_capture(&state, preview)
        .await
        .expect_err("stale preview must fail");

    assert_eq!(error.code, "invalid_input");
    assert!(error.message.contains("stale"));
    assert!(list_chat_memories(&state, "chat-1").as_array().unwrap().is_empty());
}
```

- [ ] **Step 2: Run the Rust tests and verify RED**

Run:

```powershell
cargo test --manifest-path src-tauri/Cargo.toml capture_preview_ -- --nocapture
cargo test --manifest-path src-tauri/Cargo.toml capture_commit_ -- --nocapture
```

Expected: FAIL because preview/commit functions do not exist.

- [ ] **Step 3: Refactor focused capture preparation**

Create an internal prepared value that contains no provider-derived embedding and performs no write:

```rust
struct PreparedFocusedCapture {
    chat_id: String,
    source_message_ids: Vec<String>,
    fingerprint: String,
    memory: Map<String, Value>,
}

fn prepare_focused_capture(
    state: &AppState,
    chat_id: &str,
    source_message_ids: Vec<String>,
) -> AppResult<Option<PreparedFocusedCapture>> {
    let chat = get_required(state, "chats", chat_id)?;
    let requested = source_message_ids
        .into_iter()
        .map(|id| id.trim().to_string())
        .filter(|id| !id.is_empty())
        .collect::<HashSet<_>>();
    let messages = chats::messages_for_chat(state, chat_id)?
        .into_iter()
        .filter(|message| {
            !is_hidden_from_ai(message)
                && message
                    .get("id")
                    .and_then(Value::as_str)
                    .is_some_and(|id| requested.contains(id))
        })
        .collect::<Vec<_>>();
    if messages.is_empty()
        || messages
            .last()
            .is_none_or(|message| message_role(message) != "assistant")
    {
        return Ok(None);
    }

    let ordered_ids = capture_message_ids(&messages);
    let persona_name = chat_persona_name(state, &chat)?;
    let character_names = chat_character_names(state, &chat)?;
    let fallback_name = (character_names.len() == 1)
        .then(|| character_names.values().next())
        .flatten()
        .map(String::as_str);
    let content = capture_memory_content(
        &messages,
        persona_name.as_deref(),
        &character_names,
        fallback_name,
    );
    let fingerprint = focused_capture_fingerprint(chat_id, &messages);
    let memory = focused_capture_memory(chat_id, &messages, content, &fingerprint)?;
    Ok(Some(PreparedFocusedCapture {
        chat_id: chat_id.to_string(),
        source_message_ids: ordered_ids,
        fingerprint,
        memory,
    }))
}
```

Extract the existing field construction at lines 1257-1306 into
`focused_capture_memory(chat_id, messages, content, fingerprint)`. It must set
`id`, `chatId`, `content`, `messageCount`, `messageIds`, first/last message IDs
and timestamps, `createdAt`, canonical transcript fields, creation reason
`Automatic exchange capture`, and the fingerprint. Implement
`focused_capture_fingerprint` with SHA-256 over the JSON serialization of
`chatId` plus each ordered message’s `id`, `role`, `characterId`, `createdAt`,
and exact `content`. Expose `preview_chat_memory_capture` as a synchronous
read-only function returning the exact candidate and fingerprint.

- [ ] **Step 4: Implement stale-safe commit**

`commit_chat_memory_capture` must re-run preparation, compare fingerprints, embed only the accepted candidate, replace an existing automatic exchange capture with the same ordered message IDs, preserve unrelated/manual/imported memories, and patch once:

```rust
pub(crate) async fn commit_chat_memory_capture(
    state: &AppState,
    body: Value,
) -> AppResult<Value> {
    let request: CommitCaptureRequest = parse_commit_capture_request(body)?;
    let current = prepare_focused_capture(state, &request.chat_id, request.source_message_ids)?
        .ok_or_else(|| AppError::invalid_input("Automatic memory capture is no longer eligible"))?;
    if current.fingerprint != request.fingerprint {
        return Err(AppError::invalid_input("Automatic memory capture preview is stale"));
    }
    let committed = persist_prepared_focused_capture(state, current).await?;
    Ok(json!({ "operation": committed.operation, "memory": committed.memory }))
}
```

Keep `refresh_chat_memories_for_source_messages` for the explicit Repair from chat history path; do not route automatic capture through its full transcript rebuild.

- [ ] **Step 5: Add embedded and remote command routing**

Add Tauri commands `chat_memory_capture_preview` and `chat_memory_capture_commit`, explicit HTTP dispatch arms, remote allowlist entries, and registrations in `src-tauri/src/lib.rs`. The preview command is blocking/read-only; commit is async.

- [ ] **Step 6: Add typed storage port methods**

Wire the shared API:

```ts
previewChatMemoryCapture: (chatId, sourceMessageIds) =>
  invokeTauri<ChatMemoryCapturePreview>("chat_memory_capture_preview", {
    body: { version: 1, chatId, sourceMessageIds },
  }),
commitChatMemoryCapture: (body) =>
  invokeTauri<CommitChatMemoryCaptureResult>("chat_memory_capture_commit", { body }),
```

- [ ] **Step 7: Run focused Rust, adapter, and parity tests**

Run:

```powershell
cargo test --manifest-path src-tauri/Cargo.toml capture_preview_ -- --nocapture
cargo test --manifest-path src-tauri/Cargo.toml capture_commit_ -- --nocapture
pnpm vitest run src/shared/api/chat-command-api.spec.ts src/shared/api/storage-api.spec.ts src/shared/api/remote-runtime.spec.ts
pnpm check:architecture
```

Expected: PASS with zero preview writes, stale commit rejection, one idempotent stored row, and both commands routed remotely.

- [ ] **Step 8: Authorization-gated checkpoint**

If authorized:

```powershell
git add src-tauri/src/commands/storage/chat_memory.rs src-tauri/src/commands/storage/commands/chats.rs src-tauri/src/http_dispatch.rs src-tauri/src/lib.rs src/shared/api/remote-runtime.ts src/shared/api/chat-command-api.ts src/shared/api/chat-command-api.spec.ts src/engine/capabilities/storage.ts src/shared/api/storage-api.ts src/shared/api/storage-api.spec.ts src/shared/api/remote-runtime.spec.ts
git commit -m "feat: preview automatic chat memories before storage"
```

---

### Task 3: Gate transcript and canonical automatic candidates before persistence

**Durable test rationale:** This is the core “never intentionally collect low-value memories” invariant. It spans extraction, value review, two stores, retry semantics, and idempotent persistence.

**Files:**

- Modify: `src/engine/generation/automatic-memory-capture.ts:15-51,340-435`
- Modify: `src/engine/generation/automatic-memory-capture.spec.ts`
- Modify: `src/engine/generation/automatic-memory-capture-queue.ts:293-349,410-543`
- Modify: `src/engine/generation/automatic-memory-capture-queue.spec.ts`
- Modify: `src/engine/generation/start-generation.memory-recall.e2e.spec.ts`

**Interfaces:**

- Consumes: `reviewMemoryValues`, `canonicalInputCleanupSource`, `chatMemoryCleanupSource`, `previewChatMemoryCapture`, and `commitChatMemoryCapture`.
- Produces:

```ts
export interface AutomaticMemoryValueGateResult {
  acceptedCanonicalCandidates: CanonicalMemoryInput[];
  acceptTranscriptCandidate: boolean;
  rejectedCandidateCount: number;
}
```

- [ ] **Step 1: Write failing mixed-candidate queue tests**

Build a queue harness whose transcript preview and canonical extraction return one low-value and one durable candidate:

```ts
it("persists only candidates that pass shared value review", async () => {
  const harness = queueHarness({
    transcript: chatChunk({ id: "transcript-candidate", content: "Generic conversational residue." }),
    canonical: canonicalInput({ content: "Mira promised to guard the north door." }),
    valueReview: {
      proposals: [discardProposal("transcript-candidate")],
    },
  });

  await enqueueAutomaticMemoryCaptureJob(harness.storage, scheduleInput());
  const result = await processAutomaticMemoryCaptureQueue(harness.dependencies);

  expect(result.completed).toBe(1);
  expect(harness.storage.commitChatMemoryCapture).not.toHaveBeenCalled();
  expect(harness.storage.createMemory).toHaveBeenCalledOnce();
  expect(harness.createdCanonical[0]?.content).toBe("Mira promised to guard the north door.");
});

it("fails closed and retries when value review fails", async () => {
  const harness = queueHarness({ valueReviewError: new Error("invalid structured response") });
  await enqueueAutomaticMemoryCaptureJob(harness.storage, scheduleInput());
  const result = await processAutomaticMemoryCaptureQueue(harness.dependencies);

  expect(result.retryable).toBe(1);
  expect(harness.storage.commitChatMemoryCapture).not.toHaveBeenCalled();
  expect(harness.storage.createMemory).not.toHaveBeenCalled();
});

it("fails closed against an older runtime without two-phase capture", async () => {
  const harness = queueHarness({ omitTwoPhaseCaptureMethods: true });
  await enqueueAutomaticMemoryCaptureJob(harness.storage, scheduleInput());

  const result = await processAutomaticMemoryCaptureQueue(harness.dependencies);

  expect(result.retryable).toBe(1);
  expect(harness.storage.refreshChatMemories).not.toHaveBeenCalled();
  expect(harness.storage.createMemory).not.toHaveBeenCalled();
});

it("does not duplicate canonical survivors after a partial retry", async () => {
  const harness = queueHarness({
    transcript: chatChunk({ id: "transcript-candidate", content: "A durable shared plan." }),
    canonical: canonicalInput({ content: "Mira promised to guard the north door." }),
    valueReview: { proposals: [] },
  });
  vi.mocked(harness.storage.commitChatMemoryCapture!).mockRejectedValueOnce(new Error("temporary write failure"));
  await enqueueAutomaticMemoryCaptureJob(harness.storage, scheduleInput(), "2026-07-30T10:00:00.000Z");

  const first = await processAutomaticMemoryCaptureQueue(harness.dependencies, {
    now: "2026-07-30T10:00:00.000Z",
  });
  const second = await processAutomaticMemoryCaptureQueue(harness.dependencies, {
    now: "2026-07-30T10:01:00.000Z",
  });

  expect(first.retryable).toBe(1);
  expect(second.completed).toBe(1);
  expect(new Set(harness.createdCanonical.map((memory) => memory.id))).toEqual(
    new Set(["canonical-consequence-stable"]),
  );
  expect(harness.chatMemories).toHaveLength(1);
});
```

- [ ] **Step 2: Run focused tests and verify RED**

Run:

```powershell
pnpm vitest run src/engine/generation/automatic-memory-capture-queue.spec.ts src/engine/generation/start-generation.memory-recall.e2e.spec.ts
```

Expected: FAIL because the queue still calls `refreshChatMemories` before model review.

- [ ] **Step 3: Build ephemeral review sources**

After transcript preview and canonical extraction, assign stable job-local IDs and call the shared value policy once:

```ts
const transcriptSource = preview.candidate ? chatMemoryCleanupSource(preview.candidate, cleanupScope(scope)) : null;
const canonicalSources = extraction.candidates.map((candidate, index) =>
  canonicalInputCleanupSource(`capture-candidate-${jobId}-${index}`, candidate),
);
const reviewSources = [transcriptSource, ...canonicalSources].filter(isPresent);
const review = await reviewMemoryValues({
  scope: cleanupScope(scope),
  sources: reviewSources,
  connectionId,
  llm,
  signal,
});
const rejectedIds = new Set(review.proposals.flatMap((proposal) => proposal.sourceIds));
```

Require the configured LLM gateway and connection. A missing gateway or value-review failure must throw so the durable job becomes retryable/failed rather than saving unreviewed data.

- [ ] **Step 4: Persist only accepted candidates**

Commit the transcript preview only when its ID is not rejected. Pass only accepted canonical inputs to `persistCanonicalMemoryConsequences`. Preserve canonical stable semantic IDs and partial-retry idempotence.

Rebuild the canonical lexical index only when an accepted canonical consequence
was created, updated, or superseded. Transcript commit owns its accepted
candidate embedding. A rejected-only batch must perform neither index write.

Record diagnostics on the capture job and assistant message:

```ts
valueReview: {
  status: "completed",
  reviewed: review.reviewedSourceIds.length,
  rejected: rejectedIds.size,
  accepted: reviewSources.length - rejectedIds.size,
}
```

Do not include rejected memory content in logs or job diagnostics.

- [ ] **Step 5: Remove automatic use of full refresh**

Replace the queue call to `storage.refreshChatMemories(chatId, { sourceMessageIds })` with preview/review/commit. Keep `refreshChatMemories` on `StorageGateway` for manual Repair from chat history and existing repair tests.

- [ ] **Step 6: Run RED-GREEN proof**

Run:

```powershell
pnpm vitest run src/engine/generation/automatic-memory-capture.spec.ts src/engine/generation/automatic-memory-capture-queue.spec.ts src/engine/generation/start-generation.memory-recall.e2e.spec.ts
pnpm typecheck
```

Expected: PASS. The test that returned low-value transcript text must prove no chat-memory commit; the failure test must prove no canonical create.

- [ ] **Step 7: Authorization-gated checkpoint**

If authorized:

```powershell
git add src/engine/generation/automatic-memory-capture.ts src/engine/generation/automatic-memory-capture.spec.ts src/engine/generation/automatic-memory-capture-queue.ts src/engine/generation/automatic-memory-capture-queue.spec.ts src/engine/generation/start-generation.memory-recall.e2e.spec.ts
git commit -m "feat: reject low-value automatic memories before save"
```

---

### Task 4: Add dual-store cleanup targets and a narrow engine gateway

**Durable test rationale:** Canonical memories can use chat and scene scopes, but current cleanup routes all chat/scene scopes to embedded chat chunks. Target-store ambiguity could silently leave canonical memories untidied or mutate the wrong store.

**Files:**

- Create: `src/engine/capabilities/memory-maintenance.ts`
- Modify: `src/engine/contracts/types/memory-maintenance.ts`
- Modify: `src/shared/api/memory-maintenance-api.ts`
- Modify: `src/shared/api/memory-maintenance-api.spec.ts`
- Modify: `src-tauri/src/commands/storage/memory_maintenance/contracts.rs`
- Modify: `src-tauri/src/commands/storage/memory_maintenance.rs`
- Modify: `src-tauri/src/commands/storage/memory_maintenance/canonical.rs`
- Modify: `src-tauri/src/commands/storage/memory_maintenance/chat.rs`
- Modify: `src-tauri/src/commands/storage/commands/memory.rs`
- Modify: `src-tauri/src/http_dispatch.rs`

**Interfaces:**

- Produces:

```ts
export type MemoryCleanupStore = "chat" | "canonical";

export interface MemoryCleanupTarget {
  store: MemoryCleanupStore;
  scope: MemoryCleanupScope;
}

export interface MemoryCleanupApplyRequestV2 {
  version: 2;
  target: MemoryCleanupTarget;
  proposals: MemoryCleanupProposal[];
}

export interface MemoryCleanupUndoRequestV2 {
  version: 2;
  target: MemoryCleanupTarget;
  batchId: string;
}

export interface MemoryMaintenanceGateway {
  apply(body: MemoryCleanupApplyRequestV2): Promise<MemoryCleanupApplyResult>;
  undo(body: MemoryCleanupUndoRequestV2): Promise<MemoryCleanupUndoResult>;
}
```

Keep request version 1 parsing for older clients during this change, but all new automatic callers use version 2.

- [ ] **Step 1: Write failing contract and router tests**

TypeScript adapter:

```ts
it("sends an explicit canonical scene target", async () => {
  await memoryMaintenanceApi.apply({
    version: 2,
    target: { store: "canonical", scope: { kind: "scene", id: "scene-1" } },
    proposals: [selectedDiscard],
  });
  expect(mocks.invokeTauri).toHaveBeenCalledWith("memory_cleanup_apply", {
    body: expect.objectContaining({
      version: 2,
      target: { store: "canonical", scope: { kind: "scene", id: "scene-1" } },
    }),
  });
});
```

Rust router:

```rust
#[test]
fn version_two_routes_canonical_chat_scope_to_canonical_storage() {
    let request = parse_apply_request(v2_request("canonical", "chat", "chat-1")).unwrap();
    assert_eq!(request.target.store, CleanupStore::Canonical);
    assert_eq!(request.target.scope.kind, "chat");
}
```

Add a negative test for unsupported stores and a positive canonical scene apply/undo test.

- [ ] **Step 2: Run focused tests and verify RED**

Run:

```powershell
pnpm vitest run src/shared/api/memory-maintenance-api.spec.ts
cargo test --manifest-path src-tauri/Cargo.toml version_two_ -- --nocapture
```

Expected: FAIL because version 2 and target store do not exist.

- [ ] **Step 3: Add discriminated version-2 contracts**

Use a Serde untagged request enum so version 1 remains accepted:

```rust
pub(crate) enum ParsedApplyRequest {
    V1(ApplyCleanupRequestV1),
    V2(ApplyCleanupRequestV2),
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct CleanupTarget {
    pub store: CleanupStore,
    pub scope: CleanupScope,
}
```

Normalize both versions into an internal `{ target, proposals }` request before validation. Version 1 keeps the legacy mapping (`character` -> canonical, `chat|scene` -> chat).

- [ ] **Step 4: Route by target store**

Change the Rust facade:

```rust
match request.target.store {
    CleanupStore::Chat => chat::apply_chat_cleanup(state, request).await,
    CleanupStore::Canonical => canonical::apply_canonical_cleanup(state, request),
}
```

Allow canonical apply/undo for canonical `chat`, `scene`, and `character` scopes. Keep source-scope equality and expected-state validation unchanged.

- [ ] **Step 5: Implement the narrow gateway**

Make `memoryMaintenanceApi` satisfy `MemoryMaintenanceGateway`. Do not import `invokeTauri` from engine code; pass this gateway at the app edge.

- [ ] **Step 6: Run focused storage and parity checks**

Run:

```powershell
pnpm vitest run src/shared/api/memory-maintenance-api.spec.ts
cargo test --manifest-path src-tauri/Cargo.toml memory_maintenance -- --nocapture
pnpm check:architecture
```

Expected: PASS for v1 compatibility, v2 chat target, v2 canonical chat/scene/character targets, stale rejection, atomic apply, and undo.

- [ ] **Step 7: Authorization-gated checkpoint**

If authorized:

```powershell
git add src/engine/capabilities/memory-maintenance.ts src/engine/contracts/types/memory-maintenance.ts src/shared/api/memory-maintenance-api.ts src/shared/api/memory-maintenance-api.spec.ts src-tauri/src/commands/storage/memory_maintenance/contracts.rs src-tauri/src/commands/storage/memory_maintenance.rs src-tauri/src/commands/storage/memory_maintenance/canonical.rs src-tauri/src/commands/storage/memory_maintenance/chat.rs src-tauri/src/commands/storage/commands/memory.rs src-tauri/src/http_dispatch.rs
git commit -m "feat: target both memory stores during cleanup"
```

---

### Task 5: Persist coalesced maintenance jobs from every memory mutation owner

**Durable test rationale:** Automatic maintenance must not depend on a React modal or a particular frontend entrypoint. Central Rust mutation owners are the only stable seam covering embedded, remote, import, command, and Deki writes.

**Files:**

- Create: `src-tauri/src/commands/storage/memory_maintenance/jobs.rs`
- Modify: `src-tauri/src/commands/storage/memory_maintenance.rs`
- Modify: `src-tauri/src/commands/storage/canonical_memory.rs:249-328`
- Modify: `src-tauri/src/commands/storage/chat_memory.rs:960-1135,1315-1484,2211-2360`
- Modify: `src-tauri/src/commands/storage/memory_maintenance/chat.rs`
- Modify: `src-tauri/src/commands/storage/memory_maintenance/canonical.rs`
- Modify: `src/engine/capabilities/storage-collections.ts:69-90`
- Modify: `src-tauri/src/commands/storage/contracts.rs`
- Modify: `src-tauri/src/commands/storage/admin.rs`
- Modify: `src/features/shell/settings/components/ProfileImportSection.tsx`

**Interfaces:**

- Produces durable `memory-maintenance-jobs` rows with:

```ts
interface MemoryMaintenanceJob {
  id: string;
  targetKey: string;
  target: MemoryCleanupTarget;
  policyVersion: 1;
  status: "pending" | "processing" | "retryable" | "completed" | "failed" | "suppressed";
  dirty: boolean;
  trigger: "capture" | "manual" | "import" | "correction" | "command" | "cleanup" | "undo" | "startup";
  attempts: number;
  maxAttempts: 3;
  totalPasses: number;
  recentFingerprints: string[];
  nextAttemptAt: string | null;
  lastBatchId: string | null;
  lastResult: MemoryCleanupApplyResult | null;
  createdAt: string;
  updatedAt: string;
}
```

- [ ] **Step 1: Write failing Rust job tests**

```rust
#[test]
fn repeated_mutations_coalesce_by_target() {
    let state = test_state("maintenance-job-coalesce");
    enqueue_memory_maintenance(&state, canonical_target("character", "char-1"), Trigger::Manual).unwrap();
    enqueue_memory_maintenance(&state, canonical_target("character", "char-1"), Trigger::Command).unwrap();

    let jobs = maintenance_jobs(&state);
    assert_eq!(jobs.len(), 1);
    assert_eq!(jobs[0]["status"], json!("pending"));
    assert_eq!(jobs[0]["trigger"], json!("command"));
}

#[test]
fn mutation_during_processing_marks_one_dirty_follow_up() {
    let state = test_state("maintenance-job-dirty");
    let target = canonical_target("character", "char-1");
    enqueue_memory_maintenance(&state, target.clone(), Trigger::Manual).unwrap();
    let id = maintenance_job_id(1, &target);
    state
        .storage
        .patch(
            "memory-maintenance-jobs",
            &id,
            json!({ "status": "processing", "dirty": false }),
        )
        .unwrap();

    enqueue_memory_maintenance(&state, target, Trigger::Command).unwrap();
    let job = state.storage.get("memory-maintenance-jobs", &id).unwrap().unwrap();
    assert_eq!(job["status"], json!("processing"));
    assert_eq!(job["dirty"], json!(true));
}

#[test]
fn undo_suppresses_reapplication_until_a_material_write() {
    let state = test_state("maintenance-job-undo-suppression");
    let target = canonical_target("character", "char-1");
    enqueue_memory_maintenance(&state, target.clone(), Trigger::Undo).unwrap();
    let id = maintenance_job_id(1, &target);
    let suppressed = state.storage.get("memory-maintenance-jobs", &id).unwrap().unwrap();
    assert_eq!(suppressed["status"], json!("suppressed"));

    enqueue_memory_maintenance(&state, target, Trigger::Manual).unwrap();
    let pending = state.storage.get("memory-maintenance-jobs", &id).unwrap().unwrap();
    assert_eq!(pending["status"], json!("pending"));
    assert_eq!(pending["totalPasses"], json!(0));
    assert_eq!(pending["recentFingerprints"], json!([]));
}
```

Add central-owner tests proving canonical create/update and chat create/update/pin/correct/import each leave one target job.

- [ ] **Step 2: Run focused tests and verify RED**

Run:

```powershell
cargo test --manifest-path src-tauri/Cargo.toml maintenance_job_ -- --nocapture
cargo test --manifest-path src-tauri/Cargo.toml mutation_enqueues_maintenance -- --nocapture
```

Expected: FAIL because the collection and enqueue helper do not exist.

- [ ] **Step 3: Register the internal collection**

Add `memory-maintenance-jobs` to TypeScript and Rust collection registries with JSON fields:

```ts
"memory-maintenance-jobs": {
  genericApi: true,
  readJsonFields: [
    { name: "target", kind: "object", fallback: "empty-object" },
    { name: "recentFingerprints", kind: "array" },
    { name: "lastResult", kind: "object", fallback: "null" },
  ],
},
```

Include the collection in full-wipe/profile counts, but treat it as rebuildable operational state rather than user memory content.

- [ ] **Step 4: Implement deterministic target upsert**

Use FNV-1a over `policyVersion + store + scope.kind + scope.id` for the stable job ID. Verify an existing row’s target matches before patching to guard the 32-bit collision case.

External material triggers reset pass/fingerprint history. A trigger during `processing` sets only `dirty=true`. Undo sets `suppressed`; a later non-cleanup material trigger returns it to `pending`.

- [ ] **Step 5: Call the helper from central mutation owners**

After successful persistence:

- canonical `create_memory`, `update_memory`, and lifecycle delete/restore paths enqueue the record’s actual canonical scope;
- chat create, update, delete, soft-delete, restore, pin, correct, import, clear, and accepted transcript capture enqueue the chat/scene target derived from the stored memory;
- cleanup apply does not enqueue its own internal row changes; the active worker owns fresh-source requery and fixed-point continuation;
- undo records `Trigger::Undo` so the restored state remains inspectable.

Do not enqueue from test-only helpers, read/query functions, index rebuilds, or prompt recall.

- [ ] **Step 6: Run focused mutation tests**

Run:

```powershell
cargo test --manifest-path src-tauri/Cargo.toml maintenance_job_ -- --nocapture
cargo test --manifest-path src-tauri/Cargo.toml mutation_enqueues_maintenance -- --nocapture
cargo test --manifest-path src-tauri/Cargo.toml memory_maintenance -- --nocapture
pnpm typecheck
```

Expected: PASS with one job per target, dirty follow-up semantics, undo suppression, and no cleanup recursion.

- [ ] **Step 7: Authorization-gated checkpoint**

If authorized:

```powershell
git add src-tauri/src/commands/storage/memory_maintenance/jobs.rs src-tauri/src/commands/storage/memory_maintenance.rs src-tauri/src/commands/storage/canonical_memory.rs src-tauri/src/commands/storage/chat_memory.rs src-tauri/src/commands/storage/memory_maintenance/chat.rs src-tauri/src/commands/storage/memory_maintenance/canonical.rs src/engine/capabilities/storage-collections.ts src-tauri/src/commands/storage/contracts.rs src-tauri/src/commands/storage/admin.rs src/features/shell/settings/components/ProfileImportSection.tsx
git commit -m "feat: queue maintenance after memory mutations"
```

---

### Task 6: Share the foreground lease and implement the bounded maintenance worker

**Durable test rationale:** This worker performs unattended model-assisted data changes. It must prove foreground priority, sequential calls, stale-state reanalysis, bounded fixed-point behavior, retries, conflicts, and automatic selection.

**Files:**

- Create: `src/engine/generation/background-generation-coordinator.ts`
- Create: `src/engine/generation/background-generation-coordinator.spec.ts`
- Create: `src/engine/generation/automatic-memory-maintenance-queue.ts`
- Create: `src/engine/generation/automatic-memory-maintenance-queue.spec.ts`
- Modify: `src/engine/generation/automatic-memory-capture-queue.ts:137-173,424-427,556-612`
- Modify: `src/engine/generation/automatic-memory-capture-queue.spec.ts`
- Modify: `src/engine/generation/start-generation.ts:4530-4554`

**Interfaces:**

- Produces:

```ts
export function beginForegroundGeneration(storage: StorageGateway): () => void;
export function foregroundGenerationActive(storage: StorageGateway): boolean;
export function deferUntilForegroundGenerationCompletes(
  storage: StorageGateway,
  key: object,
  callback: () => void,
): void;

export interface AutomaticMemoryMaintenanceDependencies {
  storage: StorageGateway;
  llm: LlmGateway;
  maintenance: MemoryMaintenanceGateway;
  resolveConnectionId(target: MemoryCleanupTarget): Promise<string>;
}

export async function processAutomaticMemoryMaintenanceQueue(
  dependencies: AutomaticMemoryMaintenanceDependencies,
  options?: { now?: string; limit?: number },
): Promise<{ processed: number; completed: number; retryable: number; failed: number; applied: number }>;

export function scheduleAutomaticMemoryMaintenanceQueueProcessing(
  dependencies: AutomaticMemoryMaintenanceDependencies,
): void;
```

Constants:

```ts
const MAX_MAINTENANCE_ATTEMPTS = 3;
const MAX_PASSES_PER_DRAIN = 3;
const MAX_TOTAL_PASSES = 12;
const HEARTBEAT_MS = 30_000;
```

- [ ] **Step 1: Write failing shared-lease tests**

```ts
it("resumes both deferred workers once the outermost foreground lease ends", () => {
  const releaseA = beginForegroundGeneration(storage);
  const releaseB = beginForegroundGeneration(storage);
  const capture = vi.fn();
  const maintenance = vi.fn();
  deferUntilForegroundGenerationCompletes(storage, captureKey, capture);
  deferUntilForegroundGenerationCompletes(storage, maintenanceKey, maintenance);

  releaseA();
  expect(capture).not.toHaveBeenCalled();
  releaseB();
  expect(capture).toHaveBeenCalledOnce();
  expect(maintenance).toHaveBeenCalledOnce();
});
```

- [ ] **Step 2: Write failing worker behavior tests**

Cover:

```ts
it("automatically applies every actionable proposal but never a conflict", async () => {
  const harness = maintenanceHarness({
    preview: {
      proposals: [
        proposal({ id: "discard", type: "discard" }),
        proposal({ id: "keep", type: "keep_one" }),
        proposal({ id: "combine", type: "combine" }),
        proposal({ id: "conflict", type: "conflict" }),
      ],
    },
  });
  await processAutomaticMemoryMaintenanceQueue(harness.dependencies);
  expect(harness.maintenance.apply).toHaveBeenCalledWith(
    expect.objectContaining({
      version: 2,
      proposals: expect.arrayContaining([
        expect.objectContaining({ id: "discard", selected: true }),
        expect.objectContaining({ id: "keep", selected: true }),
        expect.objectContaining({ id: "combine", selected: true }),
      ]),
    }),
  );
  expect(harness.maintenance.apply).not.toHaveBeenCalledWith(
    expect.objectContaining({
      proposals: expect.arrayContaining([expect.objectContaining({ id: "conflict" })]),
    }),
  );
});

it("processes manual pinned edited imported corrected and command sources", async () => {
  const sources = [
    source({ id: "manual", origin: "manual" }),
    source({ id: "pinned", origin: "manual", status: "pinned", pinned: true }),
    source({ id: "edited", origin: "automatic", userEdited: true }),
    source({ id: "imported", origin: "imported" }),
    source({ id: "corrected", origin: "correction" }),
    source({ id: "command", origin: "command" }),
  ];
  const harness = maintenanceHarness({ sources, preview: emptyPreview() });

  await processAutomaticMemoryMaintenanceQueue(harness.dependencies);

  expect(harness.analyzedSources.map((entry) => entry.id).sort()).toEqual(sources.map((entry) => entry.id).sort());
});

it("requeries after stale apply and never partially applies the old preview", async () => {
  const harness = maintenanceHarness({
    previews: [previewWith(discardProposal("old")), emptyPreview()],
    applyError: apiError("stale_state", "Memory changed after analysis"),
  });

  const result = await processAutomaticMemoryMaintenanceQueue(harness.dependencies);

  expect(result.retryable).toBe(1);
  expect(harness.maintenance.apply).toHaveBeenCalledTimes(1);
  expect(harness.appliedSourceIds).toEqual([]);
  expect(harness.job().status).toBe("retryable");
});

it("stops repeated fingerprints and the twelve-pass total budget", async () => {
  const repeated = maintenanceHarness({
    fingerprints: ["same", "same"],
    previews: [previewWith(combineProposal()), previewWith(combineProposal())],
  });
  await processAutomaticMemoryMaintenanceQueue(repeated.dependencies);
  expect(repeated.maintenance.apply).toHaveBeenCalledTimes(1);
  expect(repeated.job()).toMatchObject({ status: "failed", lastErrorCode: "maintenance_oscillation" });

  const exhausted = maintenanceHarness({
    initialTotalPasses: 11,
    fingerprints: ["twelfth-distinct"],
    previews: [previewWith(combineProposal())],
  });
  await processAutomaticMemoryMaintenanceQueue(exhausted.dependencies);
  expect(exhausted.maintenance.apply).toHaveBeenCalledTimes(1);
  expect(exhausted.job()).toMatchObject({ status: "failed", totalPasses: 12 });
});
```

Also prove provider calls never overlap, foreground work pauses between groups/passes, one owner runs at a time, and malformed analysis changes no memory.

Add a restart test that creates a `pending` job with one storage/gateway object,
constructs a fresh worker dependency object over the same persisted storage,
and proves the second worker completes that job. Add an older-runtime test in
which target-aware apply returns `unknown_command`; the job must become
retryable with zero source mutations rather than falling back to version 1.

- [ ] **Step 3: Run focused tests and verify RED**

Run:

```powershell
pnpm vitest run src/engine/generation/background-generation-coordinator.spec.ts src/engine/generation/automatic-memory-maintenance-queue.spec.ts
```

Expected: FAIL because both modules do not exist.

- [ ] **Step 4: Extract the storage-scoped foreground coordinator**

Move lease counts out of the capture queue. Store deferred callbacks by unique worker key so capture and maintenance do not overwrite each other. Keep release idempotent and invoke each callback once after the outermost lease.

Update the capture queue and `start-generation.ts` imports without changing current capture behavior.

- [ ] **Step 5: Implement source loading by explicit target**

```ts
async function loadTargetSources(storage: StorageGateway, target: MemoryCleanupTarget): Promise<MemoryCleanupSource[]> {
  if (target.store === "chat") {
    const chunks = await storage.listChatMemories<ChatMemoryChunk>(target.scope.id, { order: "stored" });
    return chunks
      .map((chunk) => chatMemoryCleanupSource(chunk, target.scope))
      .filter((source) => scopeKey(source.scope) === scopeKey(target.scope));
  }
  if (!storage.queryMemories) throw new Error("Canonical memory queries are unavailable");
  return (await storage.queryMemories({ scope: memoryScope(target.scope), statuses: ["active", "pinned"] })).map(
    canonicalMemoryCleanupSource,
  );
}
```

Never merge chat-store and canonical-store source arrays into one analysis.

- [ ] **Step 6: Implement automatic analysis/apply and fixed-point bounds**

For each due job:

1. mark `processing`, increment attempts;
2. resolve a text connection;
3. load current sources and fingerprint sorted expected-state fields;
4. stop successfully if no eligible sources;
5. run `analyzeMemoryCleanup`;
6. select every non-conflict proposal;
7. stop successfully if no actionable proposal;
8. apply one version-2 atomic batch;
9. store batch/result/pass/fingerprint diagnostics;
10. repeat with fresh sources up to three passes in this drain;
11. requeue if more work may remain, but fail safely on a repeated fingerprint or twelve total passes.

Treat stale-state apply errors as retryable reanalysis. Treat malformed model output and provider failure with the existing capture-style backoff. Store only safe error text, never memory contents.

Before marking a job completed, reload its current row. If `dirty=true` was
set by an external mutation during processing, clear `dirty`, reset pass
history, and return the job to `pending` exactly once instead of completing
the stale pass.

- [ ] **Step 7: Implement scheduler and heartbeat**

Use the capture queue’s active-worker/timer pattern, plus a 30-second quiet heartbeat when no due job exists. Defer immediately when a foreground lease is active and re-check between every model group and fixed-point pass.

- [ ] **Step 8: Run worker, capture, and generation tests**

Run:

```powershell
pnpm vitest run src/engine/generation/background-generation-coordinator.spec.ts src/engine/generation/automatic-memory-maintenance-queue.spec.ts src/engine/generation/automatic-memory-capture-queue.spec.ts src/engine/generation/start-generation.memory-recall.e2e.spec.ts
pnpm typecheck
pnpm check:architecture
```

Expected: PASS with no capture regression, sequential background work, foreground priority, automatic apply, and finite failure behavior.

- [ ] **Step 9: Authorization-gated checkpoint**

If authorized:

```powershell
git add src/engine/generation/background-generation-coordinator.ts src/engine/generation/background-generation-coordinator.spec.ts src/engine/generation/automatic-memory-maintenance-queue.ts src/engine/generation/automatic-memory-maintenance-queue.spec.ts src/engine/generation/automatic-memory-capture-queue.ts src/engine/generation/automatic-memory-capture-queue.spec.ts src/engine/generation/start-generation.ts
git commit -m "feat: run bounded automatic memory maintenance"
```

---

### Task 7: Add bounded startup discovery and app-edge scheduling

**Durable test rationale:** Existing memories and restart-pending jobs otherwise remain untouched until another chat reply. Startup discovery must be resumable and bounded so large profiles do not create an unbounded read or provider burst.

**Files:**

- Modify: `src/engine/generation/automatic-memory-maintenance-queue.ts`
- Modify: `src/engine/generation/automatic-memory-maintenance-queue.spec.ts`
- Create: `src/app/startup/automatic-memory-maintenance.ts`
- Create: `src/app/startup/automatic-memory-maintenance.spec.tsx`
- Modify: `src/app/shell/AppShell.tsx`
- Modify: `src/app/shell/app-shell-deki-session.spec.ts` or nearest startup-effect harness
- Modify: `src/engine/generation/automatic-memory-capture-queue.ts`

**Interfaces:**

- Produces:

```ts
export async function seedAutomaticMemoryMaintenanceJobs(
  storage: StorageGateway,
  options?: { pageSize?: number; now?: string },
): Promise<{ chatTargets: number; canonicalTargets: number; complete: boolean }>;

export function useAutomaticMemoryMaintenance(): void;
```

The sweep state uses the stable row ID `memory-maintenance-sweep-v1` and stores separate `chatBefore` and `canonicalBefore` cursors.

- [ ] **Step 1: Write failing bounded-sweep tests**

```ts
it("discovers existing targets in resumable pages", async () => {
  const harness = sweepHarness({ chats: 125, canonicalMemories: 205 });
  const first = await seedAutomaticMemoryMaintenanceJobs(harness.storage, { pageSize: 50 });
  expect(first.complete).toBe(false);
  expect(harness.maxListLimit).toBe(50);
  expect(harness.jobs.size).toBeLessThanOrEqual(100);

  let passes = 1;
  while (!(await seedAutomaticMemoryMaintenanceJobs(harness.storage, { pageSize: 50 })).complete) {
    passes += 1;
    expect(passes).toBeLessThan(20);
  }
  expect(harness.targets).toContain("chat:chat:chat-124");
  expect(harness.targets).toContain("canonical:character:character-204");
});

it("coalesces repeated canonical rows from the same scope", async () => {
  const harness = sweepHarness({
    canonicalRows: [
      canonicalRow({ id: "memory-1", scope: { kind: "character", id: "char-1" } }),
      canonicalRow({ id: "memory-2", scope: { kind: "character", id: "char-1" } }),
    ],
  });

  await seedAutomaticMemoryMaintenanceJobs(harness.storage, { pageSize: 50 });

  expect([...harness.targets].filter((key) => key === "canonical:character:char-1")).toHaveLength(1);
});
```

Add a startup-hook test proving mount schedules an immediate pass and unmount clears the heartbeat.

- [ ] **Step 2: Run focused tests and verify RED**

Run:

```powershell
pnpm vitest run src/engine/generation/automatic-memory-maintenance-queue.spec.ts src/app/startup/automatic-memory-maintenance.spec.tsx
```

Expected: FAIL because startup discovery and hook do not exist.

- [ ] **Step 3: Implement resumable discovery**

Page `chats` and `canonical-memories` with `orderBy: "updatedAt"`, stable `before: "<updatedAt>|<id>"`, `limit <= 100`, and projected fields only.

Queue every chat target discovered; loading the target later may turn it into a silent no-op. For canonical rows, derive the exact scope and coalesce repeated scope keys. Persist each cursor after its page so restart repeats at most one page.

After both lanes finish, mark the sweep completed for policy version 1. Future external mutations are covered by Task 5’s central Rust enqueue helper.

- [ ] **Step 4: Wire app-edge dependencies**

The startup hook passes:

```ts
{
  storage: storageApi,
  llm: llmApi,
  maintenance: memoryMaintenanceApi,
  resolveConnectionId: async (target) => {
    if (target.scope.kind === "chat" || target.scope.kind === "scene") {
      const chat = await storageApi.get<Record<string, unknown>>("chats", target.scope.id);
      const connection = await resolveGenerationConnection(storageApi, chat ?? {}, {});
      return String(connection.id);
    }
    return connectionCatalogApi.resolveDefaultTextConnectionId();
  },
}
```

Call the hook once from `AppShell`. Start discovery and queue processing through idle work; do not render status or block shell startup.

- [ ] **Step 5: Wake maintenance after accepted capture**

After Task 3 commits accepted transcript/canonical candidates, call `scheduleAutomaticMemoryMaintenanceQueueProcessing` with the same app/generation dependencies. This is a wake-up only; Rust mutation owners remain authoritative for durable job creation.

- [ ] **Step 6: Run startup and full queue tests**

Run:

```powershell
pnpm vitest run src/app/startup/automatic-memory-maintenance.spec.tsx src/engine/generation/automatic-memory-maintenance-queue.spec.ts src/engine/generation/automatic-memory-capture-queue.spec.ts
pnpm typecheck
pnpm check:architecture
```

Expected: PASS with bounded pages, persisted cursors, one app scheduler, and no requirement for a mounted memory modal.

- [ ] **Step 7: Authorization-gated checkpoint**

If authorized:

```powershell
git add src/engine/generation/automatic-memory-maintenance-queue.ts src/engine/generation/automatic-memory-maintenance-queue.spec.ts src/app/startup/automatic-memory-maintenance.ts src/app/startup/automatic-memory-maintenance.spec.tsx src/app/shell/AppShell.tsx src/engine/generation/automatic-memory-capture-queue.ts
git commit -m "feat: resume memory hygiene automatically"
```

---

### Task 8: Remove manual tidying and retain optional recovery

**Durable test rationale:** The user-facing invariant is the absence of a required Analyze/Review/Apply workflow. Focused component and discovery tests can prove that contract without broad browser snapshots.

**Files:**

- Create: `src/features/catalog/memory-maintenance/components/MemoryMaintenanceRecovery.tsx`
- Create: `src/features/catalog/memory-maintenance/components/MemoryMaintenanceRecovery.spec.tsx`
- Delete: `src/features/catalog/memory-maintenance/components/MemoryCleanupReviewModal.tsx`
- Delete: `src/features/catalog/memory-maintenance/components/MemoryCleanupReviewModal.spec.tsx`
- Delete: `src/features/catalog/memory-maintenance/hooks/use-memory-cleanup.ts`
- Delete: `src/features/catalog/memory-maintenance/hooks/use-memory-cleanup.spec.tsx`
- Delete: `src/features/catalog/memory-maintenance/adapters.ts`
- Delete: `src/features/catalog/memory-maintenance/adapters.spec.ts`
- Modify: `src/features/catalog/memory-maintenance/index.ts`
- Modify: `src/features/catalog/characters/components/CharacterMemoriesTab.tsx`
- Modify: `src/features/catalog/characters/components/CharacterMemoriesTab.spec.tsx`
- Modify: `src/features/modes/shared/chat-ui/components/settings/MemoryRecallMemoriesModal.tsx`
- Modify: `src/features/modes/shared/chat-ui/components/settings/MemoryRecallMemoriesModal.component.spec.tsx`
- Modify: `src/features/modes/shared/chat-ui/components/settings/MemoryRecallMemoriesModal.spec.ts`
- Modify: `src/features/shell/discovery/discovery-entries.json`
- Modify: `src/features/shell/discovery/discovery-registry.spec.ts`

**Interfaces:**

- Produces:

```tsx
export interface MemoryMaintenanceRecoveryProps {
  targets: MemoryCleanupTarget[];
  onChanged(): void | Promise<void>;
}
```

The component renders nothing for missing/no-op jobs. For the latest completed job with changes it renders a compact summary and an optional Undo button.

- [ ] **Step 1: Write failing product-surface tests**

```tsx
it("does not expose manual tidy controls", () => {
  renderCharacterMemories();
  expect(screen.queryByRole("button", { name: /tidy memories/i })).not.toBeInTheDocument();
  expect(screen.queryByText(/analyze memories/i)).not.toBeInTheDocument();
  expect(screen.queryByText(/apply cleanup/i)).not.toBeInTheDocument();
});

it("is silent for healthy no-op maintenance", async () => {
  api.listJobs.mockResolvedValue([{ status: "completed", lastResult: null }]);
  render(<MemoryMaintenanceRecovery targets={[target]} onChanged={vi.fn()} />);
  expect(document.body.textContent).toBe("");
});

it("offers optional undo after automatic changes", async () => {
  api.listJobs.mockResolvedValue([completedJob({ discarded: 2, combined: 1, lastBatchId: "batch-1" })]);
  render(<MemoryMaintenanceRecovery targets={[target]} onChanged={vi.fn()} />);
  expect(screen.getByText("Memory maintenance combined 1 and removed 2.")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: /undo/i }));
  expect(api.undo).toHaveBeenCalledWith({
    version: 2,
    target,
    batchId: "batch-1",
  });
});
```

Update discovery test expectations to require “automatic memory hygiene” and reject instructions to tidy/review/apply.

- [ ] **Step 2: Run component and discovery tests and verify RED**

Run:

```powershell
pnpm vitest run src/features/catalog/characters/components/CharacterMemoriesTab.spec.tsx src/features/modes/shared/chat-ui/components/settings/MemoryRecallMemoriesModal.component.spec.tsx src/features/catalog/memory-maintenance/components/MemoryMaintenanceRecovery.spec.tsx src/features/shell/discovery/discovery-registry.spec.ts
```

Expected: FAIL because manual Tidy controls and modal still exist.

- [ ] **Step 3: Implement quiet recovery**

Query `memory-maintenance-jobs` by target keys, select the newest completed job with `lastBatchId` and nonzero `lastResult`, and call version-2 undo. After undo, refetch memory data and the job row. Do not expose Analyze or Apply.

- [ ] **Step 4: Remove manual workflow ownership**

Remove:

- `cleanupOpen` state;
- connection resolution used only by cleanup;
- `Tidy memories` buttons and helper copy;
- modal mounts;
- manual cleanup hook/component exports;
- feature-owned source adapters now replaced by the engine adapters.

Mount `MemoryMaintenanceRecovery` unobtrusively in the chat and character memory management surfaces.

- [ ] **Step 5: Update discovery copy**

Replace the manual instruction with:

> De-Koi automatically rejects low-value captures and quietly combines or removes stored memories in the background. Manual, pinned, edited, imported, corrected, and tool-created memories use the same hygiene policy. Open Memory Console or Character Editor > Memories to inspect active memories or undo the latest automatic maintenance batch.

Keep Repair from chat history explicitly separate.

- [ ] **Step 6: Run focused UI and docs tests**

Run:

```powershell
pnpm vitest run src/features/catalog/characters/components/CharacterMemoriesTab.spec.tsx src/features/modes/shared/chat-ui/components/settings/MemoryRecallMemoriesModal.component.spec.tsx src/features/modes/shared/chat-ui/components/settings/MemoryRecallMemoriesModal.spec.ts src/features/catalog/memory-maintenance/components/MemoryMaintenanceRecovery.spec.tsx src/features/shell/discovery/discovery-registry.spec.ts
pnpm check:docs
pnpm typecheck
```

Expected: PASS with no Tidy/Analyze/Apply control, silent healthy state, and working optional undo.

- [ ] **Step 7: Authorization-gated checkpoint**

If authorized:

```powershell
git add -A src/features/catalog/memory-maintenance src/features/catalog/characters/components/CharacterMemoriesTab.tsx src/features/catalog/characters/components/CharacterMemoriesTab.spec.tsx src/features/modes/shared/chat-ui/components/settings/MemoryRecallMemoriesModal.tsx src/features/modes/shared/chat-ui/components/settings/MemoryRecallMemoriesModal.component.spec.tsx src/features/modes/shared/chat-ui/components/settings/MemoryRecallMemoriesModal.spec.ts src/features/shell/discovery/discovery-entries.json src/features/shell/discovery/discovery-registry.spec.ts
git commit -m "feat: make memory hygiene automatic"
```

---

### Task 9: Validate the complete behavior and run Bunny

**Files:**

- Modify only if proof exposes an in-scope defect.
- Optional shipping evidence is out of scope until explicit PR/shipping authorization.

**Interfaces:**

- Consumes: all prior tasks.
- Produces: local proof that low-value capture is pre-storage, both stores are maintained, no manual workflow remains, remote parity holds, and background work cannot outrun foreground generation.

- [ ] **Step 1: Run the focused TypeScript proof bundle**

Run:

```powershell
pnpm vitest run src/engine/generation/memory-value-review.spec.ts src/engine/entities/memory-maintenance-sources.spec.ts src/engine/generation/automatic-memory-capture.spec.ts src/engine/generation/automatic-memory-capture-queue.spec.ts src/engine/generation/memory-cleanup.spec.ts src/engine/generation/background-generation-coordinator.spec.ts src/engine/generation/automatic-memory-maintenance-queue.spec.ts src/engine/generation/start-generation.memory-recall.e2e.spec.ts src/app/startup/automatic-memory-maintenance.spec.tsx src/shared/api/memory-maintenance-api.spec.ts src/shared/api/storage-api.spec.ts src/shared/api/remote-runtime.spec.ts src/features/catalog/memory-maintenance/components/MemoryMaintenanceRecovery.spec.tsx src/features/catalog/characters/components/CharacterMemoriesTab.spec.tsx src/features/modes/shared/chat-ui/components/settings/MemoryRecallMemoriesModal.component.spec.tsx src/features/shell/discovery/discovery-registry.spec.ts
```

Expected: all focused files pass with zero failures.

- [ ] **Step 2: Run focused Rust proof**

Run:

```powershell
cargo test --manifest-path src-tauri/Cargo.toml capture_preview_ -- --nocapture
cargo test --manifest-path src-tauri/Cargo.toml capture_commit_ -- --nocapture
cargo test --manifest-path src-tauri/Cargo.toml maintenance_job_ -- --nocapture
cargo test --manifest-path src-tauri/Cargo.toml memory_maintenance -- --nocapture
```

Expected: all focused tests pass, including no-write preview, stale commit rejection, dual-store routing, mutation job creation, atomic apply, and undo.

- [ ] **Step 3: Run matching lane checks**

Run:

```powershell
pnpm typecheck
pnpm check:architecture
pnpm check:docs
cargo check --manifest-path src-tauri/Cargo.toml --workspace
git diff --check
```

Expected: every command exits zero.

- [ ] **Step 4: Run the full local baseline**

Run:

```powershell
pnpm check
```

Expected: exit zero; warning-only unused-code reports remain non-blocking only if the repository currently classifies them that way.

- [ ] **Step 5: Perform a mixed-scope manual harness proof**

Use a local test profile containing:

- a low-value automatic exchange candidate;
- a durable promise from the same turn;
- automatic, manual, pinned, edited, imported, corrected, command, and cleanup-created stored memories;
- exact duplicates, differently worded overlaps, and a contradiction;
- chat-store and canonical-store records sharing the same chat ID.

Prove:

1. the low-value candidate never appears in either store;
2. the durable candidate is saved once;
3. maintenance runs after foreground generation releases;
4. actionable proposals apply without opening Memory Console;
5. the contradiction remains unchanged;
6. both stores reach a fixed point;
7. the latest batch can be undone;
8. no Tidy/Analyze/Apply UI remains.

- [ ] **Step 6: Run Bunny on the local diff**

Review against `origin/main`:

```powershell
git log --oneline origin/main..HEAD
git diff --stat origin/main...HEAD
git diff --check origin/main...HEAD
```

Bunny must specifically judge pre-storage proof, dual-store coverage, foreground priority, job-loop bounds, malformed-output behavior, stale-state atomicity, undo suppression, remote parity, startup sweep bounds, UI claim honesty, and unrelated diff scope.

Expected outcome: **Bunny pass** or concrete in-scope findings to fix and reverify. Do not open or update a PR without explicit shipping authorization.

- [ ] **Step 7: Final authorization gate**

If commit authorization was granted only after implementation, create intentional task-sized commits now. If shipping authorization is absent, stop with the local branch, verification receipts, remaining manual gaps, and `No vault capture`.

---

### Task 10: Preserve nested cleanup history across newest-first undo

**Durable test rationale:** The Pi proved that a fixed-point worker can consume a
replacement created by an earlier batch. Undoing the newer batch currently
destroys the older batch's recovery metadata, so this risky storage invariant
needs a narrow regression in both chat and canonical owners.

**Files:**

- Modify: `src-tauri/src/commands/storage/memory_maintenance/chat.rs`
- Modify: `src-tauri/src/commands/storage/memory_maintenance/canonical.rs`

**Interfaces:**

- Existing apply/undo request and response contracts remain unchanged.
- A source row must snapshot its exact prior cleanup metadata before a newer
  batch replaces it.
- Undo must restore that snapshot before an older batch is inspected.

- [ ] **Step 1: Write failing consecutive-batch tests**

For each store, seed three active memories, combine the first two, combine that
replacement with the third memory, undo the newest batch, then undo the oldest
batch. Assert that the first replacement regains its original batch metadata
between undos and only the three original memories remain active afterward.

- [ ] **Step 2: Run the focused tests and verify RED**

```powershell
cargo test --manifest-path src-tauri/Cargo.toml cleanup_undoes_consecutive_combine_batches_newest_first -- --nocapture
```

Expected: both tests fail because the newer undo removes the older replacement's
`cleanupAppliedAt` / `memoryCleanup` metadata.

- [ ] **Step 3: Preserve and restore prior cleanup metadata**

Chat rows store an exact snapshot of their prior `cleanup*` fields before apply,
including any earlier snapshot. Canonical rows store the exact prior
`payload.memoryCleanup` value plus its presence bit. Newest-first undo restores
those snapshots instead of unconditionally deleting the prior batch marker.

- [ ] **Step 4: Run focused and lane verification**

```powershell
cargo test --manifest-path src-tauri/Cargo.toml cleanup_undoes_consecutive_combine_batches_newest_first -- --nocapture
cargo test --manifest-path src-tauri/Cargo.toml memory_maintenance -- --nocapture
cargo check --manifest-path src-tauri/Cargo.toml --workspace
pnpm check:architecture
git diff --check
```

Expected: all commands exit zero and both stores support newest-first chained
undo without changing public runtime contracts.
