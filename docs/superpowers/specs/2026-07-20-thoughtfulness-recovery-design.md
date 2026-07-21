# Thoughtfulness recovery design

## Claim

De-Koi should preserve unfinished user work, honor explicit defaults, expose recovery paths when background work fails, and report destructive results precisely enough that the user always knows the next safe action.

## Scope

This pass closes the ten confirmed Thoughtfulness audit findings on current `origin/main`:

1. Restore submitted text and attachments when generation is aborted before the user message is accepted.
2. Honor the explicit setup connection, then the canonical default connection, before list order.
3. Protect dirty full-page editors during native and browser close.
4. Keep Roleplay and Game composite composer drafts isolated per chat without persisting image payloads to disk.
5. Return and display exact partial data-erasure receipts, then retry only remaining categories.
6. Detect an empty library from real storage and provide direct create/import recovery from empty character pickers.
7. Render backup-history loading, empty, error, and missing-admin-access states.
8. Surface failed Help/Discover external actions instead of swallowing them.
9. Give Roleplay background replies native-notification parity and route actionable browser/in-app notification activation to the originating chat without discarding dirty edits.
10. Correct stale Game tutorial discovery copy so it describes manual launch behavior.

## Ownership and boundaries

- App shell owns close orchestration, browser unload protection, and notification-driven shell navigation.
- Shared mode UI owns only mode-neutral attachment-draft primitives and shared ChatInput recovery. Roleplay and Game keep their own orchestration.
- The setup journey uses the existing shared connection catalog selector; it does not duplicate default-selection rules.
- Home/library presence uses a focused, read-only shared API query with `fields: ["id"]` and `limit: 1` for each relevant collection.
- Rust storage admin remains the destructive-operation owner. Tauri and remote HTTP continue to share that implementation through the existing command pipeline.
- Settings surfaces own human-readable recovery receipts and actions.

## Behavior design

### Pending work

- ChatInput restores the captured submission on any failure, including abort, until `onUserMessageAccepted` proves the message is durable. It never restores after acceptance.
- Roleplay attachment drafts live in an in-memory namespace keyed by chat ID. Text keeps its existing durable draft behavior; base64 attachments never enter local storage.
- Game keeps text and safe scalar composer state per chat while image attachments remain memory-only. Late file reads and async sends retain the originating chat key and cannot append to or clear another chat's composer.
- AppShell registers one editor-dirty close guard and one `beforeunload` handler using the same pending-work registry.

### Defaults and empty states

- Guided setup chooses a still-usable explicit intent connection first, then `selectDefaultTextConnectionId`, then no connection. Synthetic Local Model list position cannot override a stored default.
- Home checks characters, personas, lorebooks, and prompt presets through minimal presence reads and only declares the library empty once all reads resolve successfully.
- Empty character pickers offer an `Open Characters` action that closes setup and opens the existing Characters panel, where create/import already live.

### Recovery and support

- Backup history always has a visible state: loading, empty, failed with Retry, or remote admin access required with a direct settings action.
- Help and Discover external-action failures produce actionable toast copy; bug reporting keeps the support report on the clipboard when opening the issue form fails.
- Conversation and Roleplay use the same privacy-safe native-notification preference. Browser and in-app notification activation carries a chat ID, focuses De-Koi, and uses guarded shell navigation so dirty editor work is not silently discarded.
- The pinned Tauri notification plugin's desktop implementation exposes no activation callback or payload. Native desktop notification clicks therefore keep their platform-provided focus behavior; the existing in-app notification bubble provides the exact-chat action. This pass does not fake routing from an indistinguishable generic window-focus event.

### Destructive receipts

- Rust validates and deduplicates every requested expunge scope before the first mutation.
- Successful responses retain `success` and `clearedCollections` and add requested/completed/remaining scope fields.
- Operational failure remains a rejected command for compatibility, with `expunge_incomplete` details containing completed scopes, the failed and unattempted scopes, cleared collections, and the original cause.
- The client normalizes legacy success responses, conservatively falls back on legacy errors, refreshes client state after any partial mutation, names completed and remaining categories, and changes the selection so `Retry remaining` sends only the remainder.
- Receipts cover blocking record operations. Existing best-effort physical-file cleanup is not promoted to a stronger guarantee in this pass.

## Mode impact

- Conversation: shared ChatInput failure restoration and existing native notifications remain intact.
- Roleplay: attachment drafts survive chat/remount transitions; background native notifications gain parity.
- Game: composer drafts become chat-scoped; no prompt, turn, or game-state semantics change.
- Shared changes are lower-layer draft/notification/close primitives only; no mode imports another mode.

## Proof strategy

Durable regression tests are warranted because each invariant is user-data-loss, destructive-data, or silently failing recovery behavior that session-only proof would not guard. Tests stay narrow at public helpers, command contracts, or focused component seams:

- abort before/after message acceptance;
- per-chat draft isolation, late async completion, and memory-only attachments;
- editor close and browser unload behavior;
- explicit/default setup connection precedence;
- minimal library presence and empty-state action;
- all backup-history states and Help/Discover failure feedback;
- Conversation/Roleplay notification parity and browser/in-app activation routing;
- expunge pre-validation, success receipt, partial receipt, retry remainder, and embedded/remote serialization parity;
- discovery metadata validation for manual Game tutorial launch.

Full shipping proof remains `pnpm check`, focused Vitest/Rust tests, architecture checks, Bunny Review, required PR checks, and final merge-state confirmation.
