# Roleplay Opening Beat Contract Design

## Problem

Generated Roleplay scene openings can still sound over-written because the scene planner supplies `firstMessage` as finished prose. The Roleplay writer then receives that prose inside the Narrator Guide and predictably copies its dialogue, choreography, metaphors, and cadence even while the active preset tells it to write freshly.

The live `Scene: Everybody Gets Ice Cream` prompt demonstrated the failure: its planned opening beat was nearly the complete final response.

## Design

Keep `firstMessage` for schema compatibility, but define it as a compact beat brief rather than publishable prose. The planner prompt requires three machine-checkable lines—`Participants`, `Action`, and `Pressure`—rather than free-form sentences that cannot be reliably distinguished from finished prose. It rejects scripted dialogue, figurative flourishes, editorial asides, and camera-like staging. A brief exact line is allowed only when the user explicitly requested those words, and it remains inside the same hard limit.

Enforce the contract at the Roleplay scene-plan owner with a sentence-aware character ceiling and structural validation. Planner output that does not match the three labeled fields, contains unrequested quoted dialogue, or exceeds three sentences is replaced by a neutral beat directive. Exact dialogue remains allowed only when those words appear in the user's request. Only the locally constructed fallback may use the bounded `Premise` label; model output cannot grant itself that exemption. This prevents long, dialogue-heavy, and compact quote-free prose from becoming a second high-authority prose sample. The downstream Roleplay writer, preset, character examples, and scene-opening routing remain unchanged.

## Scope and Risk

- Owner: `src/engine/modes/roleplay/scene/scene-service.ts`.
- Affected path: generated openings for newly planned Roleplay scenes.
- Not affected: existing scenes, normal Conversation replies, Game mode, character cards, presets, or provider transport.
- Residual risk: a short non-dialogue beat can still contain weak wording, but it can no longer dominate the writer with a long response or unrequested scripted dialogue.

## Proof

Focused scene-service regressions capture the planner request and exercise both an overlong `firstMessage` and a short dialogue-heavy script. They prove the planner is told to produce a brief, invalid script-shaped output is replaced before writer consumption, exact user-requested dialogue survives, and the fallback cannot introduce its own prose sample.
