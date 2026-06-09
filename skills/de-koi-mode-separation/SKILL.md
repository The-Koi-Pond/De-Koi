---
name: de-koi-mode-separation
description: "Enforce De-Koi's strict separation between chat/conversation, roleplay, and game mode. Use when changing mode engines, mode UI, autonomous chat, schedules, summaries, roleplay scenes, sprites, encounters, visual novel choices, game turns, game prompts, game state, generation guide routing, prompt assembly, or any shared code that could affect more than one mode."
---

# De-Koi Mode Separation

## Overview

Use this skill whenever a change touches chat, roleplay, game, or shared generation paths. The goal is to keep each product path explicit so a fix in one mode does not silently change another.

## Load First

Read `references/mode-impact-map.md` when you need owner paths, allowed sharing, or impact checks.

## Mode Owners

- Chat owns normal conversation, autonomous messaging, schedules, summaries, awareness, direct messages, impersonation, and character commands.
- Roleplay owns roleplay scenes, roleplay scene memory, scene analysis, roleplay encounters, roleplay sprites, and visual-novel choices.
- Game owns game turns, GM and party prompts, maps, state, combat, dice, loot, morale, perception, reputation, travel, weather, time, game assets, game scene analysis, and session repair.

## Required Checks

Before editing:

1. Identify the active mode or modes.
2. Identify the mode-owned entry point.
3. Identify lower-layer helpers that are safe to share.
4. Verify no top-level mode imports another top-level mode.
5. Verify shared mode UI is receiving mode-owned callbacks or lower-layer data, not learning a concrete mode's orchestration.
6. State whether generation, prompt assembly, storage, assets, or UI are also impacted.

After editing:

1. Verify the target mode path.
2. Check sibling modes for accidental behavior changes when a shared layer changed.
3. Document the mode impact in the final response.

## Sharing Rules

- Share only lower-layer primitives: contracts, storage ports, repositories, LLM transport, generic transcript helpers, deterministic parsers, asset IO, generic UI atoms.
- Do not share orchestration, prompts, memory semantics, state transitions, scene logic, or game turn logic across modes.
- If two modes need similar behavior, extract a smaller lower-layer primitive and keep each mode's orchestration separate.
- Do not add a mode flag to a generic function when a mode-owned service would make the behavior explicit.
- If a shared mode UI file needs concrete chat, roleplay, or game behavior, move that UI to the owning mode or pass a mode-owned callback from the concrete mode/router. Do not add new concrete mode engine imports to shared UI as a shortcut.

## Rejection Rules

Reject fixes that route game through roleplay, roleplay through chat, chat through game, or all modes through one generic prompt/orchestrator with guide strings. That hides product behavior and makes bugs spread.
