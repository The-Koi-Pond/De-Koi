# Customization Safety and Portability Design

**Issues:** #1023, #1024, #1025, #1026, #1027, #1028
**Status:** Approved
**Scope:** One coordinated PR delivered as four independently testable vertical slices

## Goals

De-Koi will keep its broad theme, font, and extension customization while making customization recoverable, atomic across runtimes, portable where intended, and explicit about trust. The work must preserve the embedded Tauri and hostable HTTP paths and must not claim that page-level JavaScript is sandboxed.

The PR will:

1. isolate theme authoring from the live application and provide an unthemed recovery entrypoint;
2. make active-theme selection one durable atomic operation;
3. let remote-runtime clients upload validated local font files;
4. define atomic extension removal and retained-data recovery semantics;
5. separate profile-scoped extension installation from per-client activation consent; and
6. make declared extension capabilities and compatibility truthful while filtering the De-Koi-provided API by manifest permissions.

## Non-goals

- Building a secure JavaScript sandbox or claiming that manifest permissions constrain direct page access.
- Adding prompt-reading, generation-request, or new extension contribution APIs.
- Signing extension packages or establishing publisher identity.
- Reworking unrelated Settings surfaces or general storage APIs.
- Automatically trusting extensions that were enabled before this change or arrived through profile import.

## Architecture

### Ownership

- `src/features/shell/settings` owns customization controls, preview UI, confirmations, retained-data UI, and user-facing errors.
- `src/engine/contracts` owns theme and extension validation contracts and compatibility/capability types.
- `src/shared/api` owns focused frontend wrappers for theme selection, font upload, extension removal, and retained-data recovery.
- `src/app/providers` owns active customization injection and extension execution, but only after safe-mode and device-consent decisions.
- `src-tauri/src/commands/storage` owns durable theme, font, extension, and plugin-memory operations.
- `src-tauri/src/http_dispatch.rs`, `src-tauri/src/http_storage_dispatch.rs`, and the remote command registry own hostable routing parity.

No feature module will call raw Tauri IPC or remote `fetch`. Engine modules remain React-free and runtime-adapter-free.

### Slice 1: Theme containment, recovery, and atomic selection

Theme CSS is bounded to 256 KiB in both TypeScript and Rust-facing validation paths. Create, update, preview, save, and import reject larger CSS with a specific error.

The theme editor no longer inserts draft CSS into `document.head`. A focused `ThemePreview` component renders a representative De-Koi fixture in a sandboxed `iframe` using `srcDoc`. The preview starts disabled. Enabling it applies sanitized draft CSS only inside the iframe document; the editor and its controls remain outside the CSS boundary.

Customization safe mode is selected before `CustomThemeInjector` mounts. A stable `?safe-mode=customizations` entrypoint renders an unthemed recovery surface that deliberately omits custom theme and extension injection. It can:

- deactivate the active theme through the atomic theme capability;
- clear all local extension activation consent for the current client/runtime; and
- return to the normal application after recovery.

The recovery surface uses only built-in application styles and remains available when stored CSS is syntactically valid but visually destructive.

Theme selection moves from frontend fan-out to `theme_set_active(theme_id: Option<String>)`. The Rust owner validates that a non-null ID exists, updates every theme flag within one collection mutation under the storage write gate, and returns the selected theme or null. The command is exposed through Tauri, the explicit HTTP dispatch path, the remote command allowlist, and a focused `themesApi.setActive` wrapper. React Query may update optimistically, but the server response is authoritative and an error restores the previous cache.

Concurrent selections serialize through the existing storage gate. Each completed operation leaves exactly zero or one active theme; the last operation to acquire and commit the gate determines the final value.

### Slice 2: Remote-capable font upload

`fonts_upload` accepts `{ fileName, bytesBase64 }` through a focused `fontsApi.upload` wrapper. The browser reads the selected file as bytes and encodes it for the existing JSON command pipeline. The command is available through both embedded IPC and hostable HTTP dispatch.

The Rust capability:

- accepts `.ttf`, `.otf`, `.woff`, and `.woff2` only;
- rejects decoded files larger than 10 MiB;
- rejects invalid base64 and unsafe or empty filenames;
- verifies the file signature matches its extension (`0x00010000` or `true` for TTF, `OTTO` for OTF, `wOFF` for WOFF, and `wOF2` for WOFF2);
- writes only beneath the managed fonts directory using an atomic temporary-file replacement; and
- rescans installed fonts and returns the installed face metadata.

Settings checks the actual runtime target. Embedded desktop shows **Open Fonts Folder**. Remote and browser clients show **Upload Font** with accepted formats and the size limit. Success invalidates `custom-fonts` and dispatches the existing font-update event. Validation and transport failures remain visible through a toast.

### Slice 3: Extension uninstall and retained data

`extension_remove` accepts an extension ID and `dataPolicy: "retain" | "purge"`. One Rust-owned operation validates the extension, updates the `extensions`, `plugin-memory`, and `extension-data-retention` collections as one multi-collection transaction, and returns a removal summary.

For purge:

- the extension row is removed;
- all plugin-memory rows in its server-assigned storage namespace are removed; and
- any matching retention record is removed.

For retain:

- the extension row is removed;
- plugin memory stays in place; and
- a retention record captures the server-assigned storage namespace, original extension row ID, package ID when present, display name, version, row count, and retention timestamp.

Package manifests do not choose storage namespaces. A package import receives a server/De-Koi-assigned namespace. A later unsigned package with the same manifest ID never gains retained data automatically. Settings can offer **Reconnect retained data** only when the package ID matches, and the user must explicitly confirm. `extension_reconnect_data` validates the match in Rust, assigns the retained namespace to the installed extension, and removes the retention record atomically. Legacy file extensions cannot automatically match retained data; their retained rows remain visible and purgeable.

The extension runtime storage adapter uses `storageNamespaceId ?? extension.id`. Namespace checks remain enforced by the host-facing storage API, so one extension cannot select another namespace.

Settings removal uses a confirmation dialog with **Remove extension** and **Remove extension and its data**. A retained-data section lists orphaned extension data, supports purge, and offers explicit package reconnection when a matching installed package exists.

### Slice 4: Device-local activation, compatibility, and capability truthfulness

Extension rows remain profile/runtime-scoped installation records. Their shared `enabled` field becomes an administrative availability flag for backward compatibility; it is not treated as proof of local execution consent.

A dedicated browser-local consent store records activation per runtime target and extension fingerprint. The runtime key is `embedded` or the normalized remote-runtime base URL. Consent has separate CSS and JavaScript booleans. The fingerprint is a SHA-256 digest of the extension row ID, package ID/version, JavaScript, CSS, and normalized permission declarations.

Consequences:

- existing enabled JavaScript does not run after upgrade until the current client confirms;
- profile import cannot transfer consent;
- another browser/device connected to the same runtime has no consent by default;
- changing source, package version, CSS, JavaScript, or permissions invalidates existing consent; and
- malformed or unavailable local storage fails closed.

Importing CSS directly on the current client may establish CSS-only consent after the import succeeds because file selection is an explicit local action. JavaScript always requires the enable confirmation. The confirmation states that JavaScript is trusted page-level code, can access the page directly, and is not sandboxed by manifest declarations.

Settings labels each row as installed for the profile, administratively available or disabled, and enabled or disabled on this device. CSS and JavaScript activation scope is explicit. A device-local disable removes consent without deleting the installed package.

Manifest compatibility uses semantic-version range validation against De-Koi's build version. Package import rejects malformed ranges. Settings reports **Compatible**, **Incompatible**, or **Not declared**. Incompatible packages remain installed but cannot receive local execution consent until the compatibility declaration changes or De-Koi satisfies it.

Declared permissions are shown by name and status:

- `ui:styles` gates the De-Koi `addStyle` helper;
- `storage:plugin-memory` gates the namespaced storage helper;
- `runtime:dom` gates De-Koi DOM/event/timer/observer helpers;
- currently unimplemented declarations (`ui:settings`, `ui:overlay`, `ui:messages`, `prompt:read`, and `generation:request`) are labeled unavailable;
- legacy file extensions without a manifest are labeled legacy/unscoped and receive the existing helper surface only after explicit local consent.

Filtering the injected `marinara` helper is real enforcement for De-Koi-mediated APIs, but the UI and documentation state that page-level code may still access browser globals directly. No sandbox claim is made.

## Data and migration behavior

- Existing theme rows require no migration. Oversized existing themes are not injected and safe mode can deactivate them; edits must satisfy the new limit.
- Existing extension rows remain installed. Shared `enabled` values do not create local consent.
- Existing extension plugin-memory continues using the extension row ID as its implicit namespace until an operation writes `storageNamespaceId` explicitly.
- Existing extension imports remain disabled for JavaScript. CSS imported directly on the active client can be locally enabled after creation.
- New retention records are included in normal profile storage/export behavior, but device consent is never included because it lives only in browser-local storage.

## Error handling

- Atomic commands validate before mutation and leave all collections unchanged on failure.
- A failed optimistic theme update restores the previous cache and surfaces the runtime error.
- Font validation errors identify extension, size, signature, or decode problems without exposing host paths.
- Failed font writes remove temporary files and do not invalidate the font cache as if successful.
- Missing or stale extension consent prevents injection and execution.
- Failed extension cleanup or reconnection leaves the extension, memory, and retention records in their prior state.
- Compatibility parsing never silently treats an invalid range as compatible.

## Verification

Focused TypeScript tests cover:

- theme byte limits and isolated-preview construction;
- safe-mode startup routing and recovery actions;
- atomic-theme shared API and React Query behavior;
- font upload payload encoding and runtime-specific controls;
- uninstall dialog choices and retained-data presentation;
- device-consent fingerprinting, runtime scoping, invalidation, and fail-closed behavior;
- compatibility status; and
- permission-filtered extension helpers and truthful warning copy.

Focused Rust tests cover:

- atomic theme selection, missing IDs, null selection, and concurrent calls;
- font extension, size, base64, signature, safe-path, atomic-write, and success cases;
- extension retain, purge, rollback, retention listing, namespace isolation, matching reconnection, and mismatched-package rejection; and
- embedded/HTTP dispatch parity for every new command.

Shipping verification is:

1. focused red/green tests for every slice;
2. `pnpm typecheck` and relevant Rust tests during implementation;
3. `pnpm check:architecture` after boundary changes;
4. `pnpm check` before publishing;
5. Bunny review with all actionable findings addressed;
6. GitHub Actions checks on the PR; and
7. merge confirmation on `main`.

## Documentation and discovery

Update the extension developer guide to distinguish declared De-Koi helper permissions from page-level trust, document per-device consent and compatibility behavior, and describe retained data. Update Discover metadata for theme safe mode, remote font uploads, and device-local extension activation where those behaviors are user-discoverable.
