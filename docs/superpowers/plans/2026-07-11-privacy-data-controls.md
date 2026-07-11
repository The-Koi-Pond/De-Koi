# Privacy and Data Controls Implementation Plan

**Goal:** Make De-Koi privacy controls discoverable and ensure deletion semantics match their user-facing claims without adding routine consent labor.

**Architecture:** Keep UI state in shell features, typed runtime calls in shared API wrappers, and destructive storage/filesystem behavior in Rust. Reuse explicit embedded/remote command routing and existing ownership cleanup contracts.

**Tech stack:** React 19, TypeScript, Vitest, Tauri 2, Rust.

## Task 1: Full-wipe contract

- Add failing Rust tests in `src-tauri/src/commands/storage/admin.rs` proving full wipe removes storage, Deki history, managed assets, backups, staging directories, thumbnails, and local secret material.
- Implement explicit De-Koi-managed root cleanup without touching files outside the app data directory.
- Run the focused Rust admin tests.

## Task 2: Scoped ownership cleanup

- Add failing Rust tests for character/persona/media expunge paths with owned files and derived rows.
- Refactor scoped expunge to apply collection ownership cleanup or explicitly clear the corresponding managed directories where the entire scope owns them.
- Verify unrelated scopes remain intact with negative-control assertions.

## Task 3: Privacy confirmation and settings surface

- Add a testable exact-match helper and failing Vitest coverage for the phrase `yes, erase all my de-koi data`.
- Add a Privacy & Data settings tab that consolidates explanations, backup/export entry points, scoped deletion, and complete wipe.
- Require the exact typed phrase only for complete wipe; leave scoped deletion on the existing confirmation pattern.
- Update UI tests for accessible labels, disabled state, and successful enablement.

## Task 4: Deki refusal parity

- Add a failing component test proving chat-access requests expose **Not now** and dismiss without granting access or resubmitting the request.
- Implement the refusal state using the existing handled-action/session model; do not weaken backend grant enforcement.

## Task 5: Verification and shipping

- Run focused Vitest and Rust tests, `pnpm check:architecture`, `pnpm typecheck`, `cargo check --manifest-path src-tauri/Cargo.toml --workspace`, and `pnpm check`.
- Run Bunny with a destructive-data risk matrix and address all blocking findings.
- Commit only intended files, push only to `origin`, open a draft PR targeting `main`, confirm checks, mark ready if required by merge policy, and merge after all gates pass.
