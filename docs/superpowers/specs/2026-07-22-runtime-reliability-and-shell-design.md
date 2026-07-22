# Runtime Reliability and Shell Consistency Design

**Date:** 2026-07-22

**Status:** Approved

**Branch:** `fix/runtime-reliability-shell`

## Outcome

De-Koi will stop treating incomplete provider streams as successful generations, preserve useful partial text when a stream is interrupted, resolve Random connections before any mode or background job invokes an LLM, make character web research visibly stateful and recoverable, restore reliable scene summarization and memory capture, keep Discover usable while side panels are open, and expose the running source commit in Update Checker.

The changes are root-cause repairs. They do not add silent retries, fake successful messages, or UI-only guards over failed runtime contracts.

## Confirmed Failures

### Streaming generation

On the Pi, a NanoGPT GLM-5.2 stream emitted 1,095 characters and then remained open for 10 minutes and 50 seconds. De-Koi had no post-header inactivity deadline, so typing remained active indefinitely. Pressing Stop aborted the request and persisted the already received text.

The OpenAI-compatible parser also accepts transport EOF without `[DONE]` or a terminal finish reason. That makes a dropped stream look successful and explains replies that simply cut off.

### Random connection leakage

Scene generation forwards a chat connection value of `random` as if it were a stored connection ID. Its resolver returns any non-empty override before considering the Random pool, producing the observed error `connections/random was not found`. Similar resolution logic is duplicated across modes, and memory capture can receive the same sentinel.

### Scene summary deadline mismatch

Hosted/mobile runtime invocation has a 30-second default deadline. Scene summary uses non-stream LLM completion and may make more than one provider call. The frontend can therefore abandon valid work long before the provider's five-minute response deadline.

### Memory capture selection

Automatic memory jobs reuse the chat connection for embeddings. A normal chat connection may not have an embedding model, and `random` is not a real connection. The storage layer already supports lexical embeddings, but currently uses them only when there are no connection rows at all. This turns an optional semantic capability into a high-volume failure path for automatic memory capture.

An explicit memory embedding connection remains an intentional user configuration and must fail visibly if it is invalid.

### Character web research lifecycle

After approval, research regenerates the consent message. During regeneration, the display resolver intentionally replaces that message's content with an empty string. Quiet mode hides intermediate narration and tool activity. A failed tool result is available only to the model and is not persisted as a durable research outcome, so the user can see a blank message with no useful explanation or retry state.

### Discover and Help shell ownership

Discover is a center-surface overlay, but current arbitration hides it whenever a right panel opens. Its root container also prevents vertical overflow. Actions that open another center surface do not close Discover, so the new surface opens behind it.

The titlebar Search button duplicates Home's Open Discover action. Help is the only titlebar navigation action implemented as a local modal instead of a normal side panel, producing inconsistent behavior.

### Update identity

Builds already embed `DE_KOI_SOURCE_COMMIT`, and server source metadata exposes it. Update Checker only reports semantic versions, so users cannot identify the exact code they are running or distinguish an exact match from an unknown build.

## Scope and Ownership

This work crosses several established owner lanes without introducing a new feature-local transport or storage stack:

- **Rust LLM provider transport:** stream inactivity, terminal-event validation, and finish-reason propagation.
- **Shared API remote runtime:** per-command finite invocation deadlines.
- **TypeScript engine:** one mode-neutral connection resolver used by scene, encounter, combat, conversation-adjacent jobs, and memory scheduling.
- **Conversation feature UI/state:** interrupted generation presentation and character web research lifecycle.
- **Rust storage memory:** explicit semantic embedding selection versus automatic lexical fallback.
- **App shell and panel registry:** Help panel ownership, Discover arbitration, scrolling, and center-surface transitions.
- **Rust update command and Settings UI:** current and target commit identity.

The friend's general intermittent sidebar/main-view scrolling report is not independently reproducible yet. This change fixes the confirmed Discover overflow/arbitration defects. It will not alter unrelated scrolling containers without a device, browser, and affected-panel reproduction.

## Design

### 1. Streaming completion is a terminal-state contract

Each streaming request receives a two-minute **inactivity** deadline after response headers arrive. The timer resets whenever the transport receives another stream item, including reasoning, text, tool-call, usage, or terminal metadata. It is not a total generation deadline.

The provider stream must end in one of these states:

| Terminal state | Runtime result | Conversation result |
| --- | --- | --- |
| Explicit normal finish | Success | Save the completed reply |
| Explicit `length` finish | Interrupted/truncated | Save useful partial text and mark it interrupted |
| User abort | Cancelled | Preserve useful partial text under the existing Stop behavior |
| Two-minute inactivity | Interrupted | End typing; save useful partial text; expose Continue and Regenerate |
| EOF before terminal event | Interrupted | Same as inactivity; never report success |
| Provider/transport error | Failed or interrupted | Preserve useful partial text if present; otherwise create no blank assistant message |

The parser will propagate finish metadata instead of collapsing every clean socket close into success. Existing provider adapters that have a different terminal representation will normalize into the same stream result contract.

Interrupted messages use existing message metadata where possible. If the present metadata cannot distinguish a user-stopped partial from a provider-interrupted partial, add the smallest typed field required for that distinction. The visible label is **Generation interrupted**. Continue starts from the saved partial; Regenerate replaces it through the normal regeneration path.

### 2. Random is resolved once, before mode execution

A shared engine resolver accepts:

- the requested connection selection,
- eligible stored connections,
- Random pool membership and enabled state,
- the caller's required capability,
- the existing deterministic/random selection dependency used by tests.

It returns a concrete stored connection ID or a typed error. The sentinel `random` must never cross into provider lookup, summary generation, memory embedding selection, or persisted "resolved connection" metadata.

Scene, encounter, and combat remove their local precedence variants and call the shared resolver. Explicit concrete overrides retain precedence. Random selection continues to choose only enabled pool members that satisfy the operation's capability.

If Random has no eligible member, the user sees a capability-specific error that names Random rather than a misleading missing-record error.

### 3. Long non-stream LLM commands opt into a finite longer deadline

`invokeTauri` gains an optional `timeoutMs` parameter while retaining the existing 30-second default. The `llm_complete` remote invocation uses a five-minute deadline because it covers scene-summary and other deliberate non-stream completion calls. The timeout remains finite and abortable.

No global timeout is raised. Storage, health, and ordinary commands keep their existing deadlines.

Scene summary resolves Random before invoking `llm_complete`. Timeout and provider errors keep the scene open and present a retryable error; they do not save an empty or misleading summary.

### 4. Automatic memory capture degrades to lexical; explicit configuration stays strict

Memory embedding selection separates two intents:

- **Explicit semantic embedding connection:** resolve exactly that connection and require a usable embedding model. Invalid configuration returns an actionable error.
- **Implicit automatic capture:** try the resolved chat/default connection only if it supports embeddings. Otherwise use the existing local lexical embedding implementation.

Random is resolved before this decision. If no eligible semantic connection exists for implicit capture, lexical fallback is a normal supported path, not an error. Job records should reflect the method actually used so diagnostics can distinguish semantic and lexical capture.

This fixes new jobs. Existing failed and stale jobs are not bulk-mutated by this PR; recovery uses the normal retry/requeue mechanisms after deployment.

### 5. Character web research uses an explicit lifecycle

The research request attached to the visible assistant card moves through:

`approval requested -> researching -> completed | failed`

Approval does not blank the card. The existing consent content remains visible while the card shows **Researching...** and the tool runs. Quiet mode may still suppress internal reasoning and tool chatter, but it may not suppress the user-facing lifecycle.

On success:

- save the final prose and sanitized source metadata,
- clear the active request state,
- render the completed reply in the same card.

On failure or a provider response with no final prose:

- keep the card and approval context,
- persist a sanitized failure outcome suitable for reload,
- show a concise failure reason and Retry,
- do not create or leave a blank assistant row.

The raw provider/tool payload is not persisted. Existing source sanitation rules continue to apply.

### 6. Discover remains a center surface while side panels coexist

Shell arbitration changes from "Discover is visible only when no right panel is open" to "Discover is visible unless another center/detail surface owns the center." Therefore:

- opening a right-side panel keeps Discover visible on desktop,
- on mobile, the side-panel overlay can cover Discover and closing it returns to Discover,
- opening another center surface closes Discover first,
- opening a detail view closes Discover first.

Discover owns a `min-height: 0` vertical scroll region with contained overscroll. This makes the complete view scrollable within the app shell without moving the titlebar.

All Discover actions are classified by destination. Right-panel actions preserve Discover. Center/detail actions close Discover before dispatching their destination event, so views such as Sample Game Showcase and Deki appear in front.

The duplicate titlebar Search/Discover button is removed. Home's Open Discover remains the entry point, along with existing contextual Discover entry points.

### 7. Help becomes a registered right panel

Help is added to the normal panel enum, loader, registry, and side-panel configuration. The existing Help content is rendered inside that panel rather than a locally owned modal.

The titlebar question-mark button, mobile Help action, desktop Help action, `?` keyboard shortcut, and help events all open the same right panel. Standard shell focus, dismissal, resizing, overlay, and back behavior apply. The old local `helpHubOpen` modal state is removed.

### 8. Update Checker reports version and source commit

Update status includes:

- current semantic version,
- current embedded source commit when available,
- target semantic version,
- target source commit when available,
- the target channel used for comparison.

The UI renders short hashes, for example `Current: 1.6.1 - f5094c3`. Missing build metadata is displayed as **commit unavailable** and never treated as an exact match.

Comparison targets are install-type aware:

- server/Pi rolling builds compare their source commit with the current `main` commit,
- desktop/release builds compare with the commit behind the latest installable release tag.

Annotated tags are dereferenced to their commit. A semver difference remains an available update. A same-version, different-commit result is described as a different build unless the comparison API proves which side is ahead; it is not falsely labeled newer solely because hashes differ.

GitHub lookup failures retain the current build identity and report target identity as unavailable. They do not erase a known current commit or claim the app is up to date.

## Error and Persistence Rules

- No generation path may save a zero-content assistant message as a successful result.
- Partial text is valuable user data and is preserved when transport failure occurs after content arrives.
- Incomplete streams are never silently normalized to success.
- Random-resolution errors occur before provider invocation and name the missing capability or empty pool.
- Web-research failure state survives reload without persisting raw tool/provider diagnostics.
- Automatic lexical memory fallback is observable in diagnostics but does not produce a warning toast during healthy capture.
- Update identity uses only non-secret repository metadata.

## Verification Strategy

Implementation is test-first and split into independently provable slices.

### Transport and generation

- Rust parser test: normal terminal event succeeds.
- Rust parser test: EOF without terminal event fails as interrupted.
- Rust parser test: `length` finish propagates truncation.
- Simulated-time inactivity test: timer resets on every stream item and fires after two idle minutes.
- Conversation tests: partial-on-timeout is saved and marked; zero-content failure creates no assistant row; Stop still preserves partials.
- UI test: interrupted card exposes Continue and Regenerate and typing ends.

### Connection, summary, and memory

- Shared resolver tests cover concrete override, Random member selection, disabled/ineligible members, and empty eligible pool.
- Scene, encounter, combat, summary, and memory regression tests prove `random` never reaches connection lookup.
- Remote runtime tests prove ordinary commands retain 30 seconds and `llm_complete` uses five minutes.
- Memory tests prove explicit invalid embedding configuration errors while implicit unsupported connections use lexical capture.

### Web research

- Approval keeps the original card visible and enters researching state.
- Success persists prose and sanitized sources.
- Tool failure persists a sanitized failed state and Retry.
- Provider success with no final prose is treated as failed, not blank success.
- Reload reconstructs completed and failed outcomes.

### Shell and update checker

- Shell arbitration tests cover Discover plus desktop right panel, mobile overlay return, and center/detail replacement.
- Discover component test proves the owned scroll region and destination classification.
- Help navigation tests prove all entry points open the registered right panel.
- Update API tests cover current/target hashes, unknown metadata, release-tag dereference, server main comparison, and same-version different-build wording.
- Browser proof covers Discover scrolling, opening side panels without dismissal, center destinations appearing in front, Help parity, and the Update Checker on desktop and mobile viewports.

### Final gates

- Focused TypeScript and Rust tests for each owner lane.
- `pnpm check:architecture`
- `pnpm typecheck`
- `cargo check --manifest-path src-tauri/Cargo.toml --workspace`
- `pnpm test`
- `pnpm build`
- Repository `pnpm check` before shipping.
- Bunny review before PR, after every PR-affecting push, and before Ready for review.

## Rollout and Remaining Risk

The transport timeout changes failure classification, so deployment verification must include a real streamed provider request and a controlled incomplete-stream test. The Pi must report the merged commit through `/source` and Update Checker after deployment.

Provider-specific terminal formats are the main compatibility risk. The normalized terminal contract will be applied at adapter boundaries and regression-tested against existing provider fixtures.

The broader friend-only scrolling complaint remains open pending a concrete affected panel, browser/webview version, and reproduction sequence. The confirmed Discover scrolling defect is included here.
