# Privacy and Data Controls Design

## Goal

De-Koi should minimize privileged access, make privacy behavior easy to understand, and let users reliably delete data without turning normal use into a consent chore. A complete wipe must be difficult to trigger accidentally and must remove every De-Koi-managed copy of user data.

## Decisions

- Add a dedicated **Privacy & Data** settings surface for plain-language storage, provider-sharing, Deki access, backup/export, and deletion controls.
- Keep routine item and category deletion lightweight. Only the complete wipe requires typed confirmation.
- The complete wipe requires the exact, case-sensitive phrase `yes, erase all my de-koi data`. The destructive action remains disabled until the phrase matches.
- A complete wipe includes current storage collections, Deki sessions and messages, managed assets, thumbnails, backups, temporary export/download staging, and locally stored secret material. It resets live client state after success.
- Scoped category deletion uses ownership-aware cleanup so database rows, managed files, thumbnails, and derived records do not diverge.
- Deki chat-access consent keeps its bounded scope/window/session expiry and gains a clear **Not now** action matching web-research consent.
- No onboarding wizard, recurring privacy prompts, retention-policy editor, or user classification work is introduced.

## Architecture

- React presentation and confirmation state remain under `src/features/shell/settings` and `src/features/shell/deki`.
- Deterministic confirmation matching is a small testable settings helper.
- Frontend mutations continue through focused wrappers in `src/shared/api`.
- Privileged deletion remains in the Rust storage owner and is reused by embedded Tauri and hostable HTTP dispatch.
- Full-wipe filesystem cleanup is explicit and fail-visible. It does not report success while De-Koi-managed data remains.

## Safety and Error Handling

- The server continues to require `confirm: true`; the UI phrase is an additional accidental-click barrier, not the security boundary.
- The confirmation explains exactly which categories are removed and that downloaded exports outside De-Koi cannot be recalled.
- Failures remain visible. The UI resets client state only after the backend succeeds.
- Deletion tests use isolated temporary data directories and verify both positive deletion and negative preservation boundaries.

## Verification

- Focused TypeScript tests cover phrase gating and Deki refusal behavior.
- Focused Rust tests prove full-wipe removal and scoped ownership cleanup.
- Architecture, TypeScript, Rust, documentation, and full repository checks run before shipping.
- Bunny reviews the branch diff and destructive-data risk matrix before PR publication and after any PR-affecting push.
