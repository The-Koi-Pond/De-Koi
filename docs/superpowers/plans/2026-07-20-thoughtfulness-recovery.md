# Thoughtfulness recovery implementation plan

**Goal:** Close every confirmed Thoughtfulness audit finding with behavior-first recovery paths that preserve user work, report exact outcomes, and keep De-Koi's runtime and mode boundaries intact.

**Architecture:** Keep app lifecycle and navigation guards in the shell, reusable draft/notification mechanics in feature-neutral lower layers, mode orchestration in Roleplay or Game, default selection in the connection catalog, and destructive execution/receipts in Rust storage admin. Reuse the existing Tauri/remote command path.

**Tech Stack:** React 19, TypeScript, TanStack Query, Zustand, Tauri v2, Rust, Vitest, Cargo tests, pnpm.

---

## Task 1: Preserve submitted and dirty work

**Primary files:** `ChatInput.tsx`, `app-close-guard.ts`, `AppShell.tsx`, `chat-navigation.ts`, focused specs.

1. Add a failing public-helper test for abort-before-accept restoration and accepted-message non-restoration.
2. Restore captured ChatInput text/attachments before suppressing abort errors when acceptance has not occurred.
3. Add failing close-guard tests for central editor-dirty state and browser `beforeunload`.
4. Register the editor guard and unload listener once in AppShell.
5. Make shell chat navigation confirm dirty-editor loss before closing details.
6. Run focused tests and `pnpm typecheck`.

## Task 2: Isolate composite drafts by chat

**Primary files:** shared chat attachment-draft owner, `ChatInput.tsx`, `ChatRoleplaySurface.tsx`, Game composer draft owner, `GameInput.tsx`, focused specs.

1. Add failing tests for A/B attachment isolation, remount survival, origin-safe late file reads, and submitted-chat-only cleanup.
2. Move Roleplay/shared ChatInput image drafts to an in-memory namespaced owner and remove the destructive keyed remount.
3. Add failing Game draft tests for text, dice, address mode, attachments, failed sends, and mid-send chat switches.
4. Keep safe scalar Game state per chat, image data memory-only, and capture the origin key for async work.
5. Extend pending-work guards across cached unsent attachment state.
6. Run shared ChatInput, Roleplay, and Game focused tests plus mode-boundary checks.

## Task 3: Honor defaults and make empty libraries actionable

**Primary files:** `SetupReadinessJourney.tsx`, `ModeHomeSurface.tsx`, focused library-presence hook/helper, `ChatSetupWizard.tsx`, focused specs.

1. Add a failing setup test where Local Model is first but a stored connection is the default; retain explicit-selection precedence.
2. Resolve the canonical default through `connectionCatalogApi.selectDefaultTextConnectionId`.
3. Add failing minimal-presence tests for all four library collections, including unknown/error state.
4. Feed actual library emptiness into home suggestions.
5. Add direct `Open Characters` recovery actions to truly empty character pickers without showing them for loading, errors, search misses, or all-selected states.
6. Run focused tests and `pnpm check:architecture`.

## Task 4: Surface backup and support recovery states

**Primary files:** `BackupExportSettings.tsx`, `HelpHub.tsx`, `discovery-actions.ts`, related specs.

1. Add failing component tests for backup loading, empty, error/retry, and remote-admin-disabled states.
2. Render one explicit backup-history state and route admin setup to the existing Advanced settings destination.
3. Add failing Help/Discover tests for external-open rejection.
4. Replace silent catches with actionable toast feedback while preserving support-report clipboard behavior.
5. Run focused settings/help/discovery tests.

## Task 5: Make background notifications complete and actionable

**Primary files:** `local-notifications.ts`, `use-generate.ts`, AppShell notification listener/navigation, focused specs.

1. Add failing tests for Roleplay native-notification parity and chat identity in notification payloads.
2. Send privacy-safe notifications for both Conversation and Roleplay under the existing notification preference.
3. Dispatch browser notification activation with the originating chat ID; retain native desktop focus behavior because the pinned Tauri plugin exposes no desktop activation callback.
4. Focus De-Koi and navigate browser/in-app actions through the dirty-editor-aware shell path.
5. Run local-notification, generation, navigation, and shell tests.

## Task 6: Return exact partial erasure receipts

**Primary files:** `admin.rs`, `admin-api.ts`, `use-admin-data-reset.ts`, `PrivacyDataSettings.tsx`, HTTP/runtime and focused specs.

1. Add failing Rust tests for full pre-validation, deduplication, complete receipt, injected second-scope failure, and retryable remainder.
2. Validate every scope before mutation and add a testable sequential orchestration helper.
3. Preserve success compatibility and return `expunge_incomplete` with a structured receipt on operational failure.
4. Add failing TypeScript tests for modern/legacy success and structured/legacy error normalization.
5. Refresh client caches after partial mutation; show exact completed/remaining categories and retry only the remainder.
6. Prove Tauri/HTTP serialization parity and run Rust storage tests plus Cargo check.

## Task 7: Correct tutorial guidance

**Primary files:** `discovery-entries.json`, discovery metadata tests/checks.

1. Change Game tutorial copy from automatic first-game launch to the current manual Help/Discover action.
2. Run discovery validation and the affected registry test.

## Task 8: Integrate and ship

1. Run all focused tests, `pnpm typecheck`, `pnpm build`, `pnpm check:architecture`, and final `pnpm check`.
2. Review the complete diff for mode separation, storage/error contracts, data persistence, bloat, and silent fallbacks.
3. Run Bunny Review on the final local SHA and fix blocking findings.
4. Inspect intended files, commit intentionally, push only to `origin`, and open one PR against `main` using the repository template.
5. Re-run Bunny for every PR-affecting push, clear CI/review threads, mark ready, and merge to `main`.
