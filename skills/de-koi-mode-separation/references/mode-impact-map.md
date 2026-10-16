# Mode Impact Map

Use this before touching chat, roleplay, fanfic, or shared generation behavior.

## Chat

Owner paths:

- `src/engine/modes/chat`
- `src/features/modes/conversation`
- shared transcript/input UI under `src/features/modes/shared/chat-ui`
- chat data hooks and query keys under `src/features/catalog/chats`
- chat stores under `src/shared/stores` only when they are UI/session stores

Owns:

- normal message send/regenerate/branch/swipe flows
- conversation/autonomous behavior
- schedules, summaries, awareness, command side effects
- impersonation and direct-message prompt behavior

Must not own:

- roleplay scene lifecycle
- roleplay-specific prompt constraints

## Roleplay

Owner paths:

- `src/engine/modes/roleplay`
- `src/features/modes/roleplay`
- roleplay encounter UI/hooks under `src/features/modes/roleplay/encounter`

Owns:

- scene create/fork/conclude semantics
- scene memory and scene continuity
- roleplay scene analysis and postprocess
- roleplay encounters
- visual-novel choice flow when attached to roleplay
- roleplay sprite behavior

Must not own:

- chat autonomous schedules

## Shared Lower Layers

Allowed shared homes:

- `engine/contracts`: DTOs, schemas, constants.
- `engine/shared`: pure utilities such as macro/text/regex/parser helpers.
- `engine/entities`: pure entity selectors and normalizers.
- `engine/repositories`: storage-backed repositories.
- `engine/generation-core`: prompt/lorebook/regex/LLM message building blocks.
- `engine/generation`: shared generation lifecycle, but not mode-specific orchestration.
- `shared/components`: generic UI atoms.
- `features/modes/shared/chat-ui`: shared transcript, input, overlays, settings, branch, summary, and gallery UI.
- `features/modes/shared/scene-ui`: shared scene banner UI.
- `features/runtime/visuals`: shared visual primitives when more than one mode needs them.
- `features/runtime/generation`, `features/runtime/world-state`, `features/runtime/tracker`: shared runtime systems used by mode surfaces.

Shared mode UI should stay mode-neutral. If a shared component needs a concrete mode action, pass that action in from the owning mode/router or move the component to the owning mode package. Do not grow `features/modes/shared` with new direct imports from `engine/modes/chat`, `engine/modes/roleplay`, `engine/modes/fanfic`, or concrete mode feature packages.

## Impact Report Questions

For every mode-related change, answer:

- Which mode owns the entry point?
- Which lower layers changed?
- Which sibling modes could observe the shared change?
- What verifies the changed mode?
- What verifies no accidental sibling mode behavior changed?
