## De-Koi Naming Policy

- De-Koi is the project and fork identity. Public repository, documentation, support, issue, and release references should point to De-Koi and clearly state that De-Koi is an unofficial Marinara Engine fork under AGPL-3.0.
- Do not rename compatibility-sensitive identifiers such as `marinara-server`, `marinara_engine`, Tauri bundle identifiers, storage/export labels, backup text, provider headers, Home Assistant domains, or existing app data paths without an explicit migration plan.

## Hard Rules

- Product behavior belongs in `src/engine`; React UI belongs in `src/features`; runtime wrappers belong in `src/shared/api`; privileged/hostable capabilities belong in `src-tauri`.
- Engine code must not import React, Zustand stores, `@tauri-apps/api`, feature internals, or concrete `src/shared/api` adapters.
- New or touched feature code should use focused shared API wrappers, not raw `invokeTauri` imports or raw remote-runtime `fetch`.
- Remote-capable behavior must follow the explicit HTTP pipeline documented in `marinara-architecture-guard`.
- Chat, roleplay, and game remain separate mode owners.
- Fix root causes; do not add fake success, silent catches, broad fallbacks, or UI-only guards over broken contracts.

## Credit And Workflow Budget

- Preserve coding quality: use high/adaptive reasoning for code edits, reviews, risky debugging, and architecture. Save credits by avoiding unnecessary agents, browser proof, and PR loops rather than weakening coding reasoning.
- Ordinary bugfix language means local fix and verification by default. Commit, push, draft PR creation, Bunny Review, CI polling, ready marking, and merge require an explicit shipping request such as "ship it", "open a PR", "push this", or "ready for review".
- Use the tiny local bug path for narrow, low-risk, machine-provable fixes: no full ledger by default, just a short claim/proof/validation/files/risk/vault receipt. Escalate to the full workflow as soon as the bug is nontrivial, PR-affecting, cross-boundary, storage/import/export/prompt/provider/security-sensitive, browser-evidence-dependent, or uncertain.
- Before local bugfix edits, name only the cheap gate: core claim, likely owner/lane, risk level, and proof target. Broaden the gate only after a hypothesis is falsified or a risk boundary appears.
- Use the cheapest proof that proves the claim. Prefer static inspection, targeted tests, scratch harnesses, route/module repros, or jsdom/component proof before Playwright; use browser proof when visual layout, interaction, routing, responsive behavior, screenshots, console/network behavior, or browser-only behavior is the claim.
- Keep `workflow-health.mjs` for nontrivial Marinara work, PR work, issue selection, and risky workflow changes. Do not spend it on a tiny one-file local bug unless repo policy or visible risk requires it.
- Bunny Review means the trusted GitHub workflow and commit status implemented under `.github/bunny-review/`; personal/global Bunny skills are optional wrappers, not the repo-shared gate.

## Contract Lane Gate

For contract or boundary issues, name this before implementation:

- Broken contract:
- Producer:
- Consumer:
- Implied contract:
- Actual enforcement:
- Primary owner lane:
- Consumer-only lanes:
- Wrong-lane fix to avoid:
- Regression proof:

Canonical lanes are `src/engine`, `src/features`, `src/shared/api`, `src-tauri`, `docs/workflow`, and `cross-boundary`. Use `cross-boundary` only when more than one lane must change, and still name the primary owning lane. Broad tracker issues are classification-only until sliced into owner-lane implementation PRs.

## Verification

Run checks that match the change:

- TypeScript/UI/engine: `pnpm typecheck`
- Build/import graph/bundling: `pnpm build`
- Rust commands/capabilities/provider transport/hostable runtime: `cargo check --manifest-path src-tauri/Cargo.toml`
- Docs/skills/agent guidance: `pnpm check:docs`
- Agent workflow/proof gates: `pnpm check:agent-workflow`
- Architecture/import rules: `pnpm check:architecture`
- PR boundary/ready-for-review: `pnpm check` plus any targeted proof the change needs. Unused-code checking stays an advisory CI report unless explicitly run with `pnpm check:unused`.

Ordinary local bugfixes should run the focused proof and matching lane check.
Do not turn every "fix the bug" request into full `pnpm check`; run full
`pnpm check` when the work becomes PR/shipping/ready-for-review, risky,
cross-lane, or otherwise needs the full baseline.

For code changes, final responses must include behavior changed, primary files/modules touched, impact/dependent areas reviewed, verification, and remaining risk.

## Professor Mari Codebase Agent

- Professor Mari is a codebase-research agent, not a static knowledge-base bot. For Marinara implementation questions, she should inspect the current repository through her code search/read tools before answering.
- When adding, moving, or deleting a durable feature area, update this section in the same change so Professor Mari's map stays current.
- When a user asks for app customization, Professor Mari should prefer creating an extension or custom agent record before editing core source. If core source edits are needed, use narrow exact-match edits and keep the same architecture boundaries listed above.
- Professor Mari must not read secrets, private chat transcripts, generated dependency/build output, or files outside the Marinara Engine repository.
- User-facing feature discovery lives in `src/features/shell/discovery`; keep its registry current when adding or changing discoverable product behavior.

### Current Map

- `src/app`: React bootstrap, shell layout, app providers, startup effects, top bars, sidebars, and panel composition.
- `src/features/shell/mari`: Professor Mari's standalone assistant UI surface.
- `src/features/shell/discovery`: In-app Discover guide, feature metadata registry, search/filter helpers, and discoverability action routing.
- `src/engine/mari`: TypeScript request/response contract for the Professor Mari entrypoint.
- `src-tauri/src/commands/storage/mari.rs`: Privileged Professor Mari agent execution, tool definitions, codebase search/read/edit access, and extension/custom-agent creation.
- `src/shared/api/mari-api.ts`: Focused frontend runtime wrapper for the Professor Mari command.
- `src/engine`: React-free product behavior and mode orchestration.
- `src/features`: React UI packages. Shell tools live in `src/features/shell`, catalog/resource editors live in `src/features/catalog`, mode surfaces live in `src/features/modes`, shared runtime UI lives in `src/features/runtime`.
- `src/shared/api`: Embedded Tauri and hostable runtime wrappers. Feature code should call these wrappers instead of raw Tauri or raw remote-runtime fetch.
- `src-tauri`: Rust command facades, hostable runtime dispatch, storage, LLM/provider transport, assets, imports, integrations, and other privileged capabilities.
- `public/sprites/mari`: Professor Mari visual assets used by onboarding, FAQ, title controls, and the Mari shell surface.
- `skills/marinara-architecture-guard`: Architecture guardrails for placement, import direction, and remote-capable command routing.
- `skills/marinara-agent-workflow`: Agent workflow references, source maps, handoff formats, and verification discipline.
