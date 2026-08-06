# `/illustrate` Command Design

## Goal

Add a scene-aware `/illustrate` slash command to Conversation and Roleplay chat inputs. The command reuses De-Koi's existing manual Illustrator pipeline and accepts arbitrary optional art direction without adding a message to the transcript.

## User Contract

- `/illustrate` illustrates the latest visible assistant response as the current scene moment.
- `/illustrate <guidance>` does the same while treating everything after the command as optional, free-form art direction.
- Guidance examples include subject focus, composition, camera angle, style, lighting, or any other request. The command does not impose a special grammar.
- The submitted command and its guidance remain invisible: they are not saved as chat messages, agent memories, scene state, or metadata.
- The generated image continues through the current Illustrator connection, reference-image, gallery, and message-attachment flow.
- If the Illustrator model omits a usable prompt and De-Koi uses its selected-message fallback, that fallback preserves the optional art direction.
- If the chat has no assistant response to target, the input shows ephemeral feedback and does not start generation.
- If the Illustrator cannot run, existing retry-agent error handling remains authoritative.

## Architecture

The slash-command registry in `src/shared/lib/slash-commands.ts` owns parsing, help text, autocomplete, empty-target feedback, and dispatch. `SlashCommandContext` gains a narrow injected illustration action so the shared command does not import React hooks or runtime stores.

Both chat input owners provide that action using the existing `retryAgents` function. They pass the latest assistant message ID, `illustratorManualRequest: true`, and a trimmed optional `illustratorGuidance` value. This preserves the paintbrush behavior while preventing a normal chat generation or visible user message.

The generation engine forwards `illustratorGuidance` only into the current agent run. Agent context records it as transient request memory alongside `_illustratorManualRequest`. Illustrator prompt assembly adds a clearly delimited user-guidance section when non-empty. The selected assistant response and recent scene context remain the factual source; the guidance controls what and how to depict it.

No storage schema, shared runtime API, Rust command, HTTP route, or image-generation provider contract changes.

## Data Flow

1. The user submits `/illustrate` with optional trailing text.
2. Slash parsing matches the command and removes it from the input like existing local-dispatch commands.
3. The command rejects a missing assistant target with ephemeral feedback.
4. The input owner calls `retryAgents(chatId, ["illustrator"], options)` for the latest assistant message.
5. The engine builds the normal scene-aware Illustrator context and includes transient guidance when present.
6. The Illustrator returns an image prompt; the existing image generation and attachment flow creates and displays the result.

## Prompt Safety and Precedence

Guidance is trimmed but otherwise preserved as free-form user input. Prompt assembly serializes it as a delimited value so punctuation, quotes, and multiline text cannot accidentally break the surrounding prompt structure. It is labeled as art direction for the current manual request, not as a new scene event. Existing safety/provider behavior still applies.

## Testing

Durable focused tests will cover:

- `/illustrate` matching, help/autocomplete discovery, and arbitrary argument forwarding.
- No-target feedback without invoking the illustration action.
- Empty guidance preserving the existing manual Illustrator behavior.
- Non-empty guidance reaching Illustrator prompt assembly without entering recent chat messages.
- Guidance surviving the deterministic selected-message fallback path.
- Whitespace normalization and delimiter-safe prompt representation.

Matching lane verification is the focused Vitest files, `pnpm typecheck`, and `pnpm check:architecture`. Bunny review runs after implementation because this changes De-Koi prompt assembly and cross-feature command dispatch.

## Scope Boundaries

This change does not add message-number targeting, alternate image providers, saved illustration presets, a new image UI, automatic scene summarization, or a second illustration pipeline.
