@AGENTS.md

# De-Koi: guide for Claude Code

`AGENTS.md` (loaded above) holds the binding rules for coding agents in this repo. This file only adds the
orientation those rules assume: the stack, the commands, where things live, and the traps.

## What this is

De-Koi is a local-first AI chat / roleplay / fanfic app. It is a Tauri v2 desktop app (Tauri = Rust backend plus a
system web view for the UI). It can also run as a self-hosted web app plus a Rust HTTP server (Docker, Raspberry Pi, VPS).
It began as a fork of Marinara Engine (github.com/Pasta-Devs/Marinara-Engine) and has since been rebuilt. See `NOTICE.md`.
License: AGPL-3.0-or-later.

## Tech stack

- Frontend: React 19, TypeScript 5.9, Vite 7, Tailwind 4, Zustand (state), TanStack Query (server data), zod, DOMPurify.
- Backend: Rust (version pinned in `rust-toolchain.toml`), Tauri 2. Cargo workspace in `src-tauri/` with crates in
  `src-tauri/crates/` (`core`, `storage`, `llm`, `assets`, `integrations`, `security`, `sidecar`).
- Package manager: pnpm (version pinned via `packageManager` in `package.json`). Node 22.
- Tests: Vitest (unit), Playwright (browser/UI), `cargo test` / `cargo nextest` (Rust).

## Commands

```sh
pnpm install
pnpm tauri dev          # normal desktop dev loop
pnpm dev                # web UI only; Tauri-only features won't work
cargo run --manifest-path src-tauri/Cargo.toml --bin de-koi-server   # hostable Rust HTTP runtime (no UI)
pnpm build              # tsc -b then vite build
pnpm tauri build        # installer
pnpm test               # vitest run
pnpm lint               # eslint .
pnpm check:rust:clippy
pnpm docs:dev           # the developer docs in docs/developer
```

Which check to run for which change is in `AGENTS.md` ("Verification"). The other `check:*` scripts in `package.json`
are what `pnpm check` and CI run.

## Where things are

- `src/app`: React bootstrap, shell layout, providers, startup effects.
- `src/features`: React UI. `shell/` (settings, imports, onboarding, Deki-senpai, discovery), `modes/` (chat,
  roleplay, fanfic, conversation, shared transcript UI), `catalog/` (characters, personas, lorebooks, presets,
  connections...), `runtime/` (generation, world-state, visuals, tracker).
- `src/engine`: React-free product logic: generation, prompt assembly, agents, mode engines, contracts.
- `src/shared/api`: the only place that talks to Tauri (`invoke`) or the remote HTTP runtime. One focused wrapper per area.
- `src/shared/lib`: shared helpers (markdown rendering, chat CSS sanitising in `chat-css.ts`, etc.).
- `src/runner` + `vite.runner.config.ts`: Node bundle that runs replies on the server for hosted installs.
- `src-tauri/src`: Tauri commands (`commands/storage/**`), HTTP server and dispatch (`http_server.rs`,
  `http_dispatch.rs`, `http_storage_dispatch.rs`), runner supervisor, server binary in `src/bin/de-koi-server.rs`.
- `src-tauri/crates/llm`: provider transport, request logging with secret redaction.
- `docs/developer`: static HTML developer docs. `docs/uml/Refactor`: architecture diagrams.
- `skills/`: repo-local agent skills (listed at the end of `AGENTS.md`).
- `tests/`: Playwright and extra unit tests. `scripts/`: the `check:*` scripts.

The detailed map of feature areas is the "Current Map" in `AGENTS.md`.

## Conventions not spelled out in AGENTS.md

- Anything that must work on hosted installs needs both an embedded Tauri path and an HTTP dispatch path.
- Prettier: 120 columns, double quotes, semicolons, trailing commas, LF line endings (`.cmd`/`.bat` are CRLF).
- Model/user HTML in chat is rendered through DOMPurify plus a custom CSS sanitiser
  (`src/features/modes/shared/chat-ui/components/ChatMessage.tsx`, `src/shared/lib/chat-css.ts`). Never add a new
  `dangerouslySetInnerHTML` / `innerHTML` without going through these.
- API keys are stored encrypted (`apiKeyEncrypted`) and masked on read (`connection_secrets.rs`, `list_helpers.rs`
  under `src-tauri/src/commands/storage/`); backups and profile exports strip them and have tests for it. Keep it that
  way, and never log keys or headers.
- When adding or changing a user-facing feature, update `src/features/shell/discovery/discovery-entries.json`, run
  `pnpm docs:readme-features`, and update the "Current Map" in `AGENTS.md`.
- Before reporting code-review findings, read `docs/REVIEW-NOTES.md`: claims already checked and settled, which
  shouldn't be raised again unless their "Reopen if" condition has happened.

## Relationship to upstream Marinara Engine

- Full upstream history is kept (`git log --reverse` starts with Spicy_Marinara's commits from March 2026).
- There is no `upstream` remote; `origin` is github.com/The-Koi-Pond/De-Koi.
- The code has since been restructured (Tauri + Rust capabilities), and the team is rebuilding the remaining
  inherited modules itself: see `docs/code-provenance-plan.md`. A rebuild starts from a behavior spec in
  `docs/provenance/`, and the builder works without the old implementation open. Don't port code from Marinara
  Engine.
- Legacy names survive on purpose (e.g. `mari-*` CSS classes, the `marinara` object extensions receive, Marinara
  profile import). They're public or compatibility surfaces: don't rename them without checking import and
  compatibility code.

## Gotchas

- **Attribution:** `AGENTS.md` forbids AI authorship in branch names, commit subjects, PR text and trailers (no
  `claude-*` branches, no AI `Co-Authored-By` lines). That rule beats Claude Code's default attribution.
- `pnpm dev` alone runs without the Rust backend, so many features fail there. That's expected, not a bug.
- `pnpm check:scratch` fails if `scratch/` has leftover files. `pnpm check:line-endings` enforces LF.
- The checkout holds generated or local-only folders (`dist`, `node_modules`, `src-tauri/target`, `test-results`,
  `.worktrees`). Don't search or edit inside them.
- Deki-senpai (the in-app coding assistant) has its own runtime in `src-tauri/src/commands/storage/deki*`. Its
  approval-gated edits are a security boundary. Read `docs/deki-data-approvals.md` before changing them.
