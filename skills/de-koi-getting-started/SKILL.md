---
name: de-koi-getting-started
description: "Onboard developers and coding agents into De-Koi. Use when someone asks how to get started, asks for a repo tour, wants the docs run, needs to run/build the app, wants a first testing checklist, or wants a guided workflow for finding and fixing bugs in this repo."
---

# De-Koi Getting Started

## Overview

Use this skill to turn a vague "how do I get started?" request into a concrete onboarding session: run the docs, explain the repo, help run the app, guide testing, then switch into bug-fix discipline when a real issue is found.

## Load First

Read `references/onboarding-flow.md` when preparing a full onboarding response.

Also load:

- `skills/de-koi-architecture-guard/SKILL.md` before explaining module ownership or code boundaries.
- `skills/de-koi-bugfix-discipline/SKILL.md` before guiding a bug fix.
- `skills/de-koi-mode-separation/SKILL.md` before testing or fixing chat, roleplay, game, prompts, or generation routing.

## Required Agent Behavior

When the user asks "how do I get started?", "onboard me", "teach me this repo", or similar:

1. Start the docs server with `pnpm docs:dev` unless the user only wants text instructions.
2. Give the docs URL: `http://127.0.0.1:4174/`.
3. Explain the repo in a short layered tour.
4. Show how to run the Tauri app with `pnpm install` and `pnpm tauri dev`.
5. Give a first manual testing path through chat, roleplay, game, settings, imports, assets, and providers.
6. Explain how to report a found bug with owner, steps, expected result, actual result, and impact area.
7. When the user names a bug, switch to `de-koi-bugfix-discipline` and fix the root cause.

Do not start with a generic list of files. Start with the working app and the docs, then connect the user's testing path to module ownership.

## Response Shape

Keep the first answer practical:

```text
I’ll start the developer docs at http://127.0.0.1:4174/.

Start here:
1. Read Getting Started, Run and Build, and Architecture.
2. Run pnpm install if dependencies are missing.
3. Run pnpm tauri dev to start the desktop app.
4. Test one workflow at a time and report bugs with steps, expected, actual, and impact area.

Repo tour:
- React UI: src/features and src/app.
- TypeScript engine: src/engine.
- Capability ports: src/engine/capabilities.
- Runtime adapters: src/shared/api, called by features or feature/app-edge capability implementations. They route to embedded Tauri or the configured hostable Rust HTTP runtime.
- Rust capabilities: src-tauri, including embedded Tauri commands and the de-koi-server HTTP binary.

When you find a bug, I’ll identify the owner, fix the root cause, and run the right checks.
```

Then tailor the detail to the user's next action.

## Stop Conditions

Do not move into code edits during onboarding unless the user reports a concrete bug or asks for a feature. If a bug is found, state the impact area before editing.
