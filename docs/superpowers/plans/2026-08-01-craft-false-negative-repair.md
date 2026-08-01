# Craft False-Negative Repair Implementation Plan

**Goal:** Keep Nano/GLM-5.2 as the visible Roleplay writer while using the configured Agent model for a bounded private beat plan and local code for fast false-negative repair.

## Constraints

- The writer connection and model never change.
- Roleplay receives at most one pre-writer Agent call, capped at 300 tokens and five seconds.
- Conversation receives no additional provider call.
- Local repair is extractive and preserves explicit style, repetition, question, and long-form requests.
- Game, tools, impersonation, and regeneration keep their existing behavior.
- Private live text and evaluation artifacts never enter git.

## Completed Work

- [x] Add bounded history and candidate detectors for contrast ladders, fragment ladders, repeated openings, doubled abstractions, Conversation mind-reading, and compulsory questions.
- [x] Include exact quoted assistant evidence in adaptive next-turn guidance.
- [x] Strengthen the Conversation and Roleplay baseline contracts.
- [x] Add a configured-Agent Roleplay beat planner with strict JSON validation and a 300-token request cap.
- [x] Inject the private plan into the existing Narrative Craft writer block while preserving the configured writer model.
- [x] Stop shaped Roleplay streams only at complete boundaries and honor explicit long-form requests.
- [x] Apply deterministic candidate repairs and record Roleplay correction evidence.
- [x] Remove the slow same-writer retry and the ineffective craft-triggered foreground editor rewrite.
- [x] Prove one Agent-plan request plus one writer request in integration tests.
- [x] Prove Conversation performs candidate repair with one writer request total.
- [x] Run live Harlequin/Nano latency and output proof without saving generated messages.
- [x] Run the pinned StoryScope comparison outside the repository and delete private artifacts.

## Remaining Verification

- [x] Run all focused suites, formatting, type checking, architecture checks, and the full repository check.
- [x] Run Bunny review against `origin/main` and resolve every actionable finding.
- [x] Confirm no temporary/private proof files remain and inspect the final diff.
