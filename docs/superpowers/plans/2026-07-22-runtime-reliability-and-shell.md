# Runtime Reliability and Shell Consistency Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make interrupted generations, Random selection, summaries, memories, character web research, Discover/Help navigation, and update identity reliable across desktop and Pi-hosted clients.

**Architecture:** Repair each behavior at its existing owner boundary: Rust owns provider transport and memory vectorization, the TypeScript engine owns connection and generation lifecycle rules, shared API owns hostable-runtime deadlines, and the app shell owns panel/surface arbitration. Each task is independently testable and lands as a focused commit on one coordinated PR branch.

**Tech Stack:** Rust, Tokio, reqwest, TypeScript, React 19, Zustand, Vitest, Testing Library, Tauri/hostable HTTP runtime.

## Global Constraints

- The post-header stream deadline is two minutes of inactivity, reset by every received stream item; it is not a total generation deadline.
- `llm_complete` has a finite five-minute remote invocation deadline; ordinary remote commands keep 30 seconds.
- Incomplete EOF and `length` finishes are interrupted results, never successful completions.
- Useful partial text is saved; zero-content failures create no assistant message.
- The `random` sentinel never reaches provider lookup, summary generation, memory embedding lookup, or resolved-connection metadata.
- Explicit embedding configuration remains strict; implicit automatic capture may use lexical embeddings.
- Quiet research may hide internal work but not the user-facing `pending -> researching -> completed | failed` lifecycle.
- Right panels coexist with Discover; center/detail destinations replace Discover.
- Update identity never treats an unavailable commit as an exact match.
- The unconfirmed general friend-only scrolling report is outside this change; the confirmed Discover scroll defect is in scope.

---

### Task 1: Enforce Stream Inactivity and Terminal Completion

**Durable test rationale:** A provider can leave a stream open or close it without a terminal marker, which strands typing state or silently truncates user-visible text. Session proof cannot guard every NanoGPT/OpenAI-compatible response, while narrow transport tests can permanently protect the terminal contract.

**Files:**
- Modify: `src-tauri/crates/llm/src/lib.rs`
- Modify: `src-tauri/crates/llm/src/providers/openai.rs`
- Modify: `src/shared/api/remote-runtime.ts`
- Modify: `src/shared/api/remote-runtime.spec.ts`

**Interfaces:**
- Produces: `PROVIDER_STREAM_IDLE_TIMEOUT_SECS = 120` and a reqwest per-read timeout.
- Produces: OpenAI-compatible streams that return `llm_stream_incomplete` when EOF arrives before `[DONE]` or a finish reason.
- Produces: `provider_metadata` containing `{ finishReason }` when a finish reason is present.
- Produces: remote SSE validation that requires a `done` event and aborts an idle browser read after 120 seconds.

- [ ] **Step 1: Write failing Rust parser/transport tests**

Add tests that assert `finish_reason: "length"` emits provider metadata, and that the post-loop completion guard rejects `completed == false` with `llm_stream_incomplete`.

```rust
#[test]
fn openai_chat_stream_emits_finish_reason_metadata() {
    // Process one terminal block and assert an emitted provider_metadata event
    // whose data.finishReason is "length".
}

#[test]
fn openai_stream_rejects_eof_without_terminal_event() {
    let error = ensure_stream_completed(false).expect_err("EOF must be incomplete");
    assert_eq!(error.code, "llm_stream_incomplete");
}
```

- [ ] **Step 2: Run Rust tests and verify RED**

Run: `cargo test --manifest-path src-tauri/Cargo.toml -p marinara-llm openai_stream -- --nocapture`

Expected: FAIL because finish metadata and `ensure_stream_completed` do not exist.

- [ ] **Step 3: Implement the Rust terminal contract and idle timeout**

Build the provider client with `read_timeout(Duration::from_secs(120))`, emit normalized finish metadata in `process_openai_sse_block`, and call:

```rust
fn ensure_stream_completed(completed: bool) -> AppResult<()> {
    if completed { return Ok(()); }
    Err(AppError::new(
        "llm_stream_incomplete",
        "LLM provider stream ended before a terminal event",
    ))
}
```

after flushing any final SSE buffer in both OpenAI chat-completions and Responses transports.

- [ ] **Step 4: Write failing remote SSE tests**

Use a controlled `ReadableStream` and fake timers to prove an idle read rejects, and a closed stream without `done` rejects with code `llm_stream_incomplete`.

- [ ] **Step 5: Run the remote tests and verify RED**

Run: `pnpm vitest run src/shared/api/remote-runtime.spec.ts`

Expected: FAIL because remote EOF currently returns success and reads have no inactivity deadline.

- [ ] **Step 6: Implement remote read deadline and terminal validation**

Track `terminalEventReceived`, race each `reader.read()` against a resettable 120-second timeout linked to the caller signal, and throw an `ApiError` with `remote_runtime_stream_timeout` or `llm_stream_incomplete` as appropriate.

- [ ] **Step 7: Verify and commit Task 1**

Run the focused Rust and Vitest commands above, then:

```text
git add src-tauri/crates/llm/src/lib.rs src-tauri/crates/llm/src/providers/openai.rs src/shared/api/remote-runtime.ts src/shared/api/remote-runtime.spec.ts
git commit -m "generation: reject stalled and incomplete streams"
```

### Task 2: Preserve Interrupted Partial Generations

**Durable test rationale:** Partial model text is user data. A regression test at `startGeneration` is the narrow stable seam proving a transport interruption ends typing, saves the partial, marks it interrupted, and avoids blank rows.

**Files:**
- Modify: `src/engine/contracts/types/chat.ts`
- Modify: `src/engine/generation/start-generation.ts`
- Create: `src/engine/generation/start-generation.interrupted-stream.spec.ts`
- Modify: `src/features/modes/shared/chat-ui/components/ChatMessage.tsx`
- Modify: `src/features/modes/shared/chat-ui/components/ChatMessage.spec.tsx`
- Modify: `src/features/modes/conversation/components/ConversationMessageShared.tsx`
- Modify: `src/features/modes/conversation/components/ConversationMessage.spec.tsx`
- Modify: `src/features/catalog/chats/lib/timeline-message.ts`
- Modify: `src/features/catalog/chats/lib/timeline-message.spec.ts`

**Interfaces:**
- Produces: `MessageExtra.generationInterrupted?: { reason: "idle_timeout" | "incomplete_stream" | "length" | "transport"; message: string } | null`.
- Produces: an interrupted save path that accepts the thrown cause, persists non-empty partials, and rethrows the original error.
- Produces: visible `Generation interrupted` status with Regenerate and the existing continuation affordance where supported.

- [ ] **Step 1: Write failing engine regressions**

Use an LLM generator that yields `Partial reply` and then throws `{ code: "llm_stream_incomplete" }`. Assert one assistant message is saved with the partial and interruption metadata. Add a second test that throws before yielding text and assert no assistant message is created.

- [ ] **Step 2: Run the focused engine test and verify RED**

Run: `pnpm vitest run src/engine/generation/start-generation.interrupted-stream.spec.ts`

Expected: FAIL because only user-aborted partials are saved.

- [ ] **Step 3: Implement interruption classification and save metadata**

Replace the abort-only helper with a failure-aware helper whose public behavior is:

```ts
type GenerationInterruption = NonNullable<MessageExtra["generationInterrupted"]>;

function generationInterruption(cause: unknown, providerMetadata: unknown): GenerationInterruption | null;
```

Save only when the signal was aborted or `generationInterruption` returns a value. Pass the typed metadata through `saveAssistantMessage`, and detect a normalized `length` finish after the stream before final save.

- [ ] **Step 4: Write and run failing UI/projection tests**

Assert the timeline projection requests `generationInterrupted`, and both chat renderers show `Generation interrupted` plus Regenerate for an interrupted assistant message.

- [ ] **Step 5: Implement the UI/projection behavior and verify GREEN**

Render a compact status row from persisted metadata without inventing a second message. Reuse existing regeneration callbacks and continuation behavior.

- [ ] **Step 6: Commit Task 2**

```text
git add src/engine/contracts/types/chat.ts src/engine/generation/start-generation.ts src/engine/generation/*.spec.ts src/features/modes/shared/chat-ui/components/ChatMessage.tsx src/features/modes/shared/chat-ui/components/ChatMessage.spec.tsx src/features/modes/conversation/components/ConversationMessageShared.tsx src/features/modes/conversation/components/ConversationMessage.spec.tsx src/features/catalog/chats/lib/timeline-message.ts src/features/catalog/chats/lib/timeline-message.spec.ts
git commit -m "generation: preserve interrupted partial replies"
```

### Task 3: Resolve Random Before Modes and Lengthen Summary Invocation

**Durable test rationale:** `random` is a UI selection sentinel, not a storage ID. Public resolver and scene-summary tests prevent mode-specific precedence from leaking it into provider lookup again.

**Files:**
- Modify: `src/engine/generation/context.ts`
- Modify: `src/engine/generation/context.spec.ts`
- Modify: `src/engine/modes/roleplay/scene/scene-service.ts`
- Modify: `src/engine/modes/roleplay/scene/scene-service.spec.ts`
- Modify: `src/engine/modes/roleplay/encounter/encounter-service.ts`
- Modify: `src/engine/modes/game/mechanics/combat-init.service.ts`
- Modify: `src/shared/api/tauri-client.ts`
- Modify: `src/shared/api/llm-api.ts`
- Create: `src/shared/api/llm-api.spec.ts`

**Interfaces:**
- Produces: `resolveGenerationConnection(storage, chat, input, options?) -> Promise<JsonRecord>` supporting explicit, Random, chat, and default selection without returning `random`.
- Produces: `invokeTauri` options `{ signal?: AbortSignal; timeoutMs?: number }`.
- Consumes: existing `invokeRemote` timeout option.

- [ ] **Step 1: Add failing resolver tests**

Cover explicit `random`, chat `random`, disabled pool entries, concrete override, and default fallback. Inject `randomIndex` or `selectIndex` so selection is deterministic in tests.

- [ ] **Step 2: Verify RED**

Run: `pnpm vitest run src/engine/generation/context.spec.ts`

Expected: FAIL for default fallback and eligibility handling.

- [ ] **Step 3: Implement and adopt the shared resolver**

Return only an existing connection record with a non-empty ID. Remove the three local `resolveConnectionId` implementations and map the shared result to `.id` at scene, encounter, and combat call sites.

- [ ] **Step 4: Add the scene regression**

Pass `connectionId: "random"` to the summary path and assert the LLM request receives the selected NanoGPT connection ID, never `random`.

- [ ] **Step 5: Add failing deadline tests and implement the five-minute override**

Mock `invokeTauri` in `llm-api.spec.ts` and assert `llm_complete` is invoked with `{ timeoutMs: 300_000 }`. Extend `invokeTauri` options and forward them to `invokeRemote`; embedded IPC ignores the deadline because Rust owns its cancellation.

- [ ] **Step 6: Verify and commit Task 3**

```text
pnpm vitest run src/engine/generation/context.spec.ts src/engine/modes/roleplay/scene/scene-service.spec.ts src/shared/api/llm-api.spec.ts
git add src/engine/generation/context.ts src/engine/generation/context.spec.ts src/engine/modes/roleplay/scene/scene-service.ts src/engine/modes/roleplay/scene/scene-service.spec.ts src/engine/modes/roleplay/encounter/encounter-service.ts src/engine/modes/game/mechanics/combat-init.service.ts src/shared/api/tauri-client.ts src/shared/api/llm-api.ts src/shared/api/llm-api.spec.ts
git commit -m "generation: resolve random selections before execution"
```

### Task 4: Fall Back to Lexical Memory for Implicit Capture

**Durable test rationale:** Automatic memory capture currently fails for ordinary chat connections without embedding models. Rust storage tests are the stable public seam for proving explicit configuration stays strict while implicit capture remains functional.

**Files:**
- Modify: `src-tauri/src/commands/storage/chat_memory.rs`

**Interfaces:**
- Produces: explicit `embeddingConnectionId` errors for missing/invalid embedding models.
- Produces: `Ok(None)` for implicit chat/default embedding selections that are absent, `random`, unavailable, or lack an embedding model, causing existing lexical vectorization.

- [ ] **Step 1: Write failing Rust tests**

Add one test with explicit `embeddingConnectionId` and no model that expects `invalid_input`. Add one with only `connectionId` and no embedding model that expects a stored memory with `embeddingSource == "lexical"` and null embedding connection/model.

- [ ] **Step 2: Run and verify RED**

Run: `cargo test --manifest-path src-tauri/Cargo.toml chat_memory::tests::refresh_chat_memories_ -- --nocapture`

Expected: implicit case fails with missing `embeddingModel`.

- [ ] **Step 3: Implement intent-aware selection**

Keep the explicit branch unchanged. For chat/default candidates, catch missing connection/model/no-embedding errors and return `None`; never pass the literal `random` to storage lookup.

- [ ] **Step 4: Verify and commit Task 4**

```text
git add src-tauri/src/commands/storage/chat_memory.rs
git commit -m "memory: use lexical capture without embedding config"
```

### Task 5: Persist Character Web Research Lifecycle

**Durable test rationale:** Approval currently replaces visible saved content with an empty regeneration draft, and failed research has no durable outcome. Engine and card tests protect the visible lifecycle and reload behavior without exposing raw tool payloads.

**Files:**
- Modify: `src/engine/contracts/types/chat.ts`
- Modify: `src/engine/generation/character-web-research.ts`
- Modify: `src/engine/generation/character-web-research.spec.ts`
- Modify: `src/engine/generation/start-generation.ts`
- Modify: `src/engine/generation/start-generation.web-research-presentation.spec.ts`
- Modify: `src/features/modes/conversation/lib/conversation-streaming-draft.ts`
- Modify: `src/features/modes/conversation/lib/conversation-streaming-draft.spec.ts`
- Modify: `src/features/modes/shared/chat-ui/components/CharacterWebResearchCard.tsx`
- Modify: `src/features/modes/shared/chat-ui/components/CharacterWebResearchCard.spec.tsx`

**Interfaces:**
- Produces: request status `pending | researching | completed | failed | declined` plus optional sanitized `failureMessage`.
- Produces: approval patch to the message (`researching`) before regeneration and success/failure message patches after it.
- Produces: regeneration display that preserves saved consent content while active research is running.

- [ ] **Step 1: Add failing display/card tests**

Assert active regeneration preserves `savedMessageContent`, the card renders `Researching...`, and a persisted failed request renders its message plus Retry.

- [ ] **Step 2: Verify RED and implement the lifecycle UI**

Run: `pnpm vitest run src/features/modes/conversation/lib/conversation-streaming-draft.spec.ts src/features/modes/shared/chat-ui/components/CharacterWebResearchCard.spec.tsx`

Patch message status to `researching` before `onRegenerate`; on rejection patch `failed` with `toUserMessage(..., "characterWebResearchRetry")`; preserve the consent card throughout.

- [ ] **Step 3: Add failing engine no-prose/failure tests**

Assert approved research with no final prose saves a `failed` outcome and no blank-success row. Assert success clears request activity while preserving completed status and sources.

- [ ] **Step 4: Implement sanitized outcome persistence**

Pass completed/failed request metadata through `saveAssistantMessage`; never persist raw tool errors. Keep the exact approved query and domain allowlist for Retry.

- [ ] **Step 5: Verify and commit Task 5**

```text
git add src/engine/contracts/types/chat.ts src/engine/generation/character-web-research.ts src/engine/generation/character-web-research.spec.ts src/engine/generation/start-generation.ts src/engine/generation/start-generation.web-research-presentation.spec.ts src/features/modes/conversation/lib/conversation-streaming-draft.ts src/features/modes/conversation/lib/conversation-streaming-draft.spec.ts src/features/modes/shared/chat-ui/components/CharacterWebResearchCard.tsx src/features/modes/shared/chat-ui/components/CharacterWebResearchCard.spec.tsx
git commit -m "chat: make web research outcomes visible"
```

### Task 6: Unify Discover and Help with Shell Navigation

**Durable test rationale:** These are shell ownership and navigation regressions. Pure arbitration tests plus component tests are narrower and more stable than relying only on manual clicking.

**Files:**
- Modify: `src/shared/components/shell-navigation.ts`
- Modify: `src/shared/stores/ui/model.ts`
- Modify: `src/app/shell/right-panel-loaders.ts`
- Modify: `src/app/shell/RightPanel.tsx`
- Modify: `src/app/shell/PanelNavButtons.tsx`
- Modify: `src/app/shell/PanelNavButtons.spec.tsx`
- Modify: `src/app/shell/AppShell.tsx`
- Modify: `src/app/shell/app-shell-center-surfaces.ts`
- Modify: `src/app/shell/app-shell-center-surfaces.spec.ts`
- Modify: `src/app/shell/HelpHub.tsx`
- Modify: `src/app/shell/HelpHub.spec.tsx`
- Modify: `src/features/shell/discovery/components/DiscoverPanel.tsx`
- Modify: `src/features/shell/discovery/lib/discovery-actions.ts`
- Modify: `src/features/shell/discovery/lib/discovery-actions.spec.ts`

**Interfaces:**
- Produces: `help` as a `ShellPanelDestination` with a registered lazy loader.
- Produces: Discover visibility independent of `rightPanelOpen`.
- Produces: `discoveryActionReplacesCenter(action)` used to close Discover before center/detail actions.

- [ ] **Step 1: Add failing arbitration/navigation tests**

Assert Discover remains visible with a right panel, the titlebar has no Discover search button, Help is in the panel registry, right-panel actions preserve Discover, and `open-deki`/`open-showcase` replace it.

- [ ] **Step 2: Verify RED**

Run: `pnpm vitest run src/app/shell/app-shell-center-surfaces.spec.ts src/app/shell/PanelNavButtons.spec.tsx src/features/shell/discovery/lib/discovery-actions.spec.ts`

- [ ] **Step 3: Implement shell arbitration and destination classification**

Remove `!rightPanelOpen` from Discover visibility. Close Discover in `AppShell` before handling center/detail discovery events. Remove `onOpenDiscover` and the Search button from `PanelNavButtons`.

- [ ] **Step 4: Convert Help content to a panel**

Make HelpHub content panel-shaped (no modal `open/onClose` ownership), register it in `RIGHT_PANEL_LOADERS`, and route titlebar, keyboard `?`, mobile, desktop, and discovery help actions through `openRightPanel("help")`.

- [ ] **Step 5: Fix Discover scrolling**

Change the Discover root to:

```tsx
<div className="de-koi-discover flex min-h-0 w-full min-w-0 flex-1 flex-col gap-3 overflow-y-auto overscroll-contain p-3">
```

- [ ] **Step 6: Run focused tests, typecheck, and commit Task 6**

```text
git add src/shared/components/shell-navigation.ts src/shared/stores/ui/model.ts src/app/shell/right-panel-loaders.ts src/app/shell/RightPanel.tsx src/app/shell/PanelNavButtons.tsx src/app/shell/PanelNavButtons.spec.tsx src/app/shell/AppShell.tsx src/app/shell/app-shell-center-surfaces.ts src/app/shell/app-shell-center-surfaces.spec.ts src/app/shell/HelpHub.tsx src/app/shell/HelpHub.spec.tsx src/features/shell/discovery/components/DiscoverPanel.tsx src/features/shell/discovery/lib/discovery-actions.ts src/features/shell/discovery/lib/discovery-actions.spec.ts
git commit -m "shell: unify help and discover navigation"
```

### Task 7: Report Current and Target Source Commits

**Durable test rationale:** Version-only status cannot identify a deployed Pi build. Rust payload tests and a pure UI formatter protect unknown, exact, and different-build semantics without depending on live GitHub availability.

**Files:**
- Modify: `src-tauri/src/commands/storage/updates.rs`
- Modify: `src/shared/api/updates-api.ts`
- Modify: `src/shared/api/updates-api.spec.ts`
- Modify: `src/features/shell/settings/components/settings/SettingsSurfaces.tsx`

**Interfaces:**
- Produces: `currentCommit`, `targetCommit`, and `targetChannel: "main" | "release"` in `UpdateCheckResponse`.
- Produces: `formatUpdateIdentity(version, commit)` returning `1.6.1 - f5094c3` or `1.6.1 - commit unavailable`.

- [ ] **Step 1: Add failing Rust payload tests**

Construct release info with a target SHA and assert server builds select channel `main`, desktop builds select `release`, current commit comes from `option_env!("DE_KOI_SOURCE_COMMIT")`, and missing commit remains null.

- [ ] **Step 2: Verify RED and implement GitHub commit resolution**

Fetch `/commits/main` for server builds. For release builds, read the selected tag ref and dereference annotated tag objects until a commit SHA is reached. Preserve release/version results if commit lookup fails.

- [ ] **Step 3: Add failing TypeScript formatting tests**

Assert short hashes, unavailable wording, and same-version different-build display.

- [ ] **Step 4: Implement types and Settings rendering**

Render separate Current and Latest lines, including channel and commit identity. Keep Open Release enabled only for actual installable version updates.

- [ ] **Step 5: Verify and commit Task 7**

```text
cargo test --manifest-path src-tauri/Cargo.toml updates::tests -- --nocapture
pnpm vitest run src/shared/api/updates-api.spec.ts
git add src-tauri/src/commands/storage/updates.rs src/shared/api/updates-api.ts src/shared/api/updates-api.spec.ts src/features/shell/settings/components/settings/SettingsSurfaces.tsx
git commit -m "updates: report exact source revisions"
```

### Task 8: Integrated Verification, Bunny, PR, and Merge

**Files:**
- Modify only files required by failures found in the gates.

- [ ] **Step 1: Run owner-boundary gates**

```text
pnpm check:architecture
pnpm typecheck
cargo check --manifest-path src-tauri/Cargo.toml --workspace
pnpm test
pnpm build
pnpm check
```

- [ ] **Step 2: Run browser proof**

Prove desktop and mobile Discover scrolling, side-panel coexistence, center replacement, Help panel parity, interrupted-card rendering, research lifecycle, and Update Checker identity. Record any provider/device proof gap honestly.

- [ ] **Step 3: Run Bunny review and repair every finding**

Run the Bunny workflow against the complete branch. Re-run focused and matching full gates after repairs.

- [ ] **Step 4: Push and open a draft PR**

Push only `fix/runtime-reliability-shell` to `origin`, open a draft PR with the repository template and proof receipts, and leave human validation checkboxes unticked.

- [ ] **Step 5: Run Bunny again after the push and babysit CI/review**

Address actionable failures, push repairs, and repeat Bunny after each PR-affecting push.

- [ ] **Step 6: Mark ready and merge**

When required CI and review gates pass, mark Ready for review, run the final Bunny gate, merge to `main`, and verify the merged commit is present on `origin/main`.
