# Generation Recovery and Memory Guidance Design

## Problem

Two failures are visible on the deployed Pi:

1. A remote LLM request can remain idle for 120 seconds and then fail. De-Koi currently reports the failure with a ten-second toast and leaves the user message in place. Although an empty composer can retry the last user message, that recovery is represented only by a changed send icon, so the result can look like De-Koi never answered.
2. Memory Recall can be enabled while the effective connection has no embedding model. De-Koi correctly has a local lexical fallback, but prompt assembly still attempts semantic embedding and canonical-memory queries. Those calls fail, create repeated server errors, and do not tell the user that semantic recall is unavailable or how to configure it.

## Goals

- Make a failed foreground generation remain visibly actionable until the user retries, dismisses it, or a later generation succeeds.
- Never automatically repeat a provider request; recovery must not create duplicate replies or amplify an outage.
- Preserve the submitted user message and reuse the existing retry behavior.
- Resolve whether the selected chat connection has an effective embedding model before semantic recall work begins.
- When no effective embedding model exists, skip provider embedding and semantic-memory calls and continue with local lexical recall.
- Tell the user once per chat and effective connection during the browser session that lexical fallback is active, why, and how to enable semantic recall.
- Keep the same warning visible in Chat Settings while the configuration remains incomplete.
- Cover conversation and roleplay input owners; preserve the game's existing inline generation-retry flow.

## Non-goals

- Automatically retrying failed provider requests.
- Changing the 120-second provider or remote-stream timeout.
- Requiring an embedding model for Memory Recall.
- Disabling Memory Recall when semantic embeddings are unavailable.
- Changing memory scoring, capture semantics, provider credentials, or saved chat data.

## Architecture

### Generation failure recovery

`src/features/runtime/generation/hooks/use-generate.ts` remains the UI/runtime owner of foreground generation lifecycle. On a non-abort failure it records a per-chat UI failure containing the user-facing message and a stable failure identity. A new focused runtime-generation notice component renders that state without persisting a synthetic chat message.

Conversation's `ConversationInput` and the shared roleplay `ChatInput` mount the notice and supply their existing empty-input retry action. Retrying clears the prior notice at generation start; receipt of an assistant message or successful completion also clears it. Dismissal clears only the UI notice. The game's separate retry banner remains unchanged.

The toast remains as immediate feedback, but the inline notice is the durable recovery surface. No provider call is repeated until the user explicitly chooses Retry.

### Effective embedding capability

Embedding availability is a connection capability, not a memory-query error. A small engine-level resolver determines the effective embedding configuration from the selected generation connection and its optional dedicated embedding connection using the public connection records already available through the storage capability. It returns either a resolved connection/model identity or a typed unavailable reason; it never reads or exposes credentials.

`start-generation.ts` resolves that capability once for a generation and passes it into prompt assembly:

- configured: provider embedding and canonical semantic retrieval use the resolved identity;
- unavailable: `embeddingSource` and the canonical semantic connection are both null, so existing lexical Memory Recall runs without failed remote calls.

This keeps product meaning in the TypeScript engine, provider transport in Rust, and UI guidance at the feature edge. No new raw Tauri or HTTP route is required.

### User guidance

When Memory Recall is enabled and embedding capability is unavailable, generation emits a typed, nonfatal configuration-warning event before prompt assembly. `use-generate.ts` turns it into a warning toast only once per `chatId + effective connection identity` for the current browser session.

Copy:

> Memory Recall is using local matching because no Embedding Model is configured. It still works, but semantic recall is unavailable.

The toast action is **Open Connections**, which opens the existing Connections panel. Its description tells the user to edit the chat's connection and fill in **Embedding Model**, or choose an embedding-capable **Embedding Connection**.

`ChatSettingsDrawer` shows the same nonblocking explanation under Memory Recall whenever the toggle is on and the current connection lacks effective embedding configuration. The inline guidance disappears as soon as the connection query reports a valid effective model.

## Data flow

1. The user starts generation.
2. The engine loads the chat, selected connection, and public connection records.
3. The effective-embedding resolver checks the selected connection and any dedicated embedding connection.
4. If unavailable and Memory Recall is enabled, the stream emits one configuration warning and prompt assembly receives no semantic source.
5. Memory Recall uses its existing lexical scoring and canonical-memory fallback without invoking `llm_embed` or `memory_query_semantic`.
6. If the LLM stream later fails, `runGenerationWithUi` records the per-chat failure, shows the immediate toast, and releases the busy UI.
7. The input owner displays the persistent recovery notice. Retry starts generation from the existing last user message and does not create another user message.

## Error handling

- Abort/Stop remains an expected path and does not create a failure notice.
- Partial output follows the existing interrupted-generation persistence contract; the new notice covers only failures that still reject the foreground generation.
- Missing or stale dedicated embedding connection IDs are treated as unavailable and fall back lexically.
- Provider embedding failures after a valid configuration remain nonfatal and fall back lexically, but they are not mislabeled as missing configuration.
- Opening Connections is a UI action only; the warning never mutates connection settings.

## Testing

Durable test rationale: both regressions are silent and easy to reintroduce across shared generation paths. Existing toast-only proof cannot guarantee persistent recovery, and existing lexical-fallback tests do not prove semantic calls are skipped when configuration is absent. Focused tests at the public owner seams are narrow and stable.

- Engine test: missing embedding configuration resolves unavailable, emits the warning only when Memory Recall is enabled, skips both embedding and semantic-query gateways, and still returns lexical recall.
- Engine test: a valid dedicated embedding connection preserves semantic behavior.
- Runtime-generation test: a non-abort stream failure records a per-chat persistent failure; a successful retry clears it; abort does not create it.
- Component tests: conversation and roleplay inputs render the message and invoke the existing retry without duplicating the user message.
- Settings test: enabled Memory Recall plus missing effective model shows exact actionable guidance; configured embedding hides it.
- Matching checks: focused Vitest suites, `pnpm typecheck`, `pnpm check:architecture`, and `cargo check --manifest-path src-tauri/Cargo.toml` only if Rust changes become necessary.

## Success criteria

- A LinkAPI-style 120-second failure leaves a visible Retry action instead of appearing to do nothing.
- Retrying makes one new generation request and no new user message.
- Memory Recall without an embedding model produces no `llm_embed` or `memory_query_semantic` invalid-input errors.
- Lexical Memory Recall continues operating.
- The user receives accurate, deduplicated guidance with a working path to Connections.
- Existing configured semantic recall and game recovery behavior remain unchanged.
