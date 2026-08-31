# Roleplay POV and Character Style Contract

## Goal

Make De-Koi Roleplay follow one coherent point-of-view instruction and let character-owned examples remain the primary evidence for voice, without adding another universal prose template, critic, planner, or rewrite pass.

## Root cause

Spawned scenes currently append a hardcoded instruction to use third-person narration unless another source overrides it. The same scene can select the Universal V2 second-person narration and limited user POV choices. Both instructions reach prompt assembly, leaving the writer model to reconcile contradictory authorities.

De-Koi already supplies character first messages and example dialogue through prompt assembly. Adding fixed positive prose excerpts at the universal guidance layer would compete with those character-owned examples and create another shared house style. The current compact Roleplay Prose Guidance should therefore stay provider-neutral and example-free.

## Design

### Scene POV ownership

The scene service will stop choosing third person. Its durable scene guideline will say to follow the active preset, originating chat, or explicit scene request, with newer and more specific direction winning. Universal preset resolution remains the owner of the selected `narration` and `pov` values.

This applies to newly spawned scenes. Existing saved `sceneSystemPrompt` values are user-editable durable data and will not be rewritten automatically.

### Character-owned voice evidence

No new global sample text or style field will be introduced. Existing character `first_mes` and `mes_example` content remains the positive voice evidence. The late Roleplay Prose Guidance remains compact and describes invariants only: character specificity, scene pressure, concrete causality, continuity, POV preservation, and user agency.

Prompt assembly tests will prove that character example dialogue is retained when the bounded Roleplay history default is used and that late prose guidance does not replace or contradict it.

### Boundaries

- Owner: `src/engine/modes/roleplay`; no React, shared API, Tauri, HTTP, provider, or storage changes.
- Conversation and Game behavior remain unchanged.
- The 50-message default Roleplay history tail remains unchanged.
- No migration rewrites existing chat or character data.
- No hidden agent, detector, blacklist, plot direction, completed-response rewrite, or model-specific instruction is added.

## Verification

Focused tests will prove:

1. New scene prompts contain no unconditional third-person demand.
2. Scene prompts explicitly defer to selected/current POV and narration direction.
3. Universal preset second-person and third-person choices remain intact in spawned scene metadata.
4. Character example dialogue still reaches assembled Roleplay prompts alongside exactly one compact Roleplay Prose Guidance message.
5. Conversation and Game prose-guidance routing remains unchanged.

Matching lane checks are the focused Vitest files, `pnpm typecheck`, and `pnpm check:architecture`.

## Remaining limitation

This removes a deterministic prompt conflict and protects character-owned style evidence. It cannot erase a writer model's native prose attractor or repair formulaic language already present in saved history. Clean behavioral comparison still requires a fresh scene or curated history and fixed-model A/B generation.
