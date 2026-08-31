# Roleplay Opening Beat Contract Design

## Problem

Generated Roleplay scene openings can still sound over-written because the scene planner supplies `firstMessage` as finished prose. The Roleplay writer then receives that prose inside the Narrator Guide and predictably copies its dialogue, choreography, metaphors, and cadence even while the active preset tells it to write freshly.

The live `Scene: Everybody Gets Ice Cream` prompt demonstrated the failure: its planned opening beat was nearly the complete final response.

## Design

Keep `firstMessage` for schema compatibility, but define it as a compact beat brief rather than publishable prose. The planner prompt will request one to three plain sentences describing concrete participants, actions, and immediate pressure; it will reject scripted dialogue, figurative flourishes, editorial asides, and camera-like staging. A brief exact line is allowed only when the user explicitly requested those words, and it remains inside the same hard limit.

Enforce the contract at the Roleplay scene-plan owner with a sentence-aware character ceiling. This prevents an overlong or noncompliant planner response from becoming a second high-authority prose sample. The downstream Roleplay writer, preset, character examples, and scene-opening routing remain unchanged.

## Scope and Risk

- Owner: `src/engine/modes/roleplay/scene/scene-service.ts`.
- Affected path: generated openings for newly planned Roleplay scenes.
- Not affected: existing scenes, normal Conversation replies, Game mode, character cards, presets, or provider transport.
- Residual risk: a short beat can still contain weak wording, but it can no longer dominate the writer with a near-complete scripted response.

## Proof

A focused scene-service regression will capture the planner request and return an intentionally overlong `firstMessage`. It must prove both sides of the contract: the planner is told to produce a brief rather than prose, and the sanitized plan cannot carry a near-complete opening into the writer.
