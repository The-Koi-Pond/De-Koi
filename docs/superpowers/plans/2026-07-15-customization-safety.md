# Customization Safety Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship issues #1023-#1028 as one reviewable PR that makes themes recoverable and atomic, fonts remotely uploadable, and extension data and execution consent explicit and safe.

**Architecture:** Product validation stays in React-free engine contracts, browser-local consent stays in a feature-neutral shared helper, UI stays in shell Settings/app startup, runtime calls use focused shared APIs, and durable/privileged operations use focused Rust owners exposed through both Tauri and HTTP. Each vertical slice is test-first and independently committed.

**Tech Stack:** React 19, TypeScript 5.9, Zod, TanStack Query, Vitest/jsdom, Rust stable, Tauri 2, serde_json, De-Koi atomic `FileStorage` collection updates.

## Global Constraints

- Target `origin/main` from `fix/customization-safety`; push only to `origin`.
- Theme CSS maximum is 256 KiB and font upload maximum is 10 MiB.
- Engine code may not import React, Zustand, feature internals, or shared API adapters.
- Feature code uses focused `src/shared/api` wrappers; no new raw `invokeTauri` or runtime `fetch` imports.
- Every remote-capable command must be in the TypeScript allowlist and explicit Rust HTTP dispatch.
- Extension JavaScript remains trusted page-level code; never describe manifest declarations as a sandbox.
- Profile import never creates device-local extension consent.
- No extension package may choose or automatically claim a retained plugin-memory namespace.
- Existing user changes outside the isolated worktree remain untouched.

## Durable Test Rationale

The protected invariants involve storage atomicity, destructive user-data choices, executable extension consent, remote file validation, and recovery from destructive CSS. Session-only proof would not guard these high-risk paths against later regressions. Tests remain narrow at public schemas/helpers, focused shared APIs, React surfaces, Rust command owners, and dispatch boundaries; no snapshots or broad fixtures are added.

---

### Task 1: Shared customization contracts

**Files:**
- Modify: `src/engine/contracts/constants/defaults.ts`
- Modify: `src/engine/contracts/schemas/theme.schema.ts`
- Create: `src/engine/contracts/schemas/theme.schema.spec.ts`
- Modify: `src/engine/contracts/types/extension.ts`
- Modify: `src/engine/contracts/schemas/extension.schema.ts`
- Create: `src/engine/contracts/text-bytes.ts`
- Create: `src/engine/contracts/extension-compatibility.ts`
- Create: `src/engine/contracts/extension-compatibility.spec.ts`

**Interfaces:**
- Produces: `MAX_THEME_CSS_BYTES`, `MAX_FONT_UPLOAD_BYTES`, and `extensionCompatibilityStatus(range, appVersion)`.

- [ ] **Step 1: Add failing theme-limit and compatibility tests**

```ts
expect(createThemeSchema.safeParse({ name: "Huge", css: "x".repeat(MAX_THEME_CSS_BYTES + 1) }).success).toBe(false);
expect(extensionCompatibilityStatus(">=1.6.0 <2.0.0", "1.6.1")).toBe("compatible");
expect(extensionCompatibilityStatus(">=2.0.0", "1.6.1")).toBe("incompatible");
expect(() => assertValidExtensionCompatibility("not a range")).toThrow(/semantic version range/i);
```

- [ ] **Step 2: Run red tests**

Run: `pnpm vitest run src/engine/contracts/extension-compatibility.spec.ts src/engine/contracts/schemas/theme.schema.spec.ts`  
Expected: FAIL because the limit and compatibility functions do not exist.

- [ ] **Step 3: Implement the documented semantic comparator-range grammar and engine contracts**

```ts
export const MAX_THEME_CSS_BYTES = 256 * 1024;
export const MAX_FONT_UPLOAD_BYTES = 10 * 1024 * 1024;

export type ExtensionCompatibilityStatus = "compatible" | "incompatible" | "not-declared";
export function extensionCompatibilityStatus(range: string | null | undefined, appVersion = APP_VERSION) {
  if (!range?.trim()) return "not-declared";
  const normalized = assertValidExtensionCompatibility(range);
  return satisfiesComparatorRange(appVersion, normalized) ? "compatible" : "incompatible";
}
```

Add byte-length refinements to both theme create and update schemas and semantic-range validation to package compatibility data. The range grammar accepts exact versions, comparator intersections, caret/tilde ranges, and `||` alternatives. It rejects unsupported or malformed syntax instead of guessing.

- [ ] **Step 4: Run green contract tests**

Run: `pnpm vitest run src/shared/lib/extension-import.spec.ts src/engine/contracts/schemas/theme.schema.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit the contract slice**

```sh
git add docs/superpowers/plans/2026-07-15-customization-safety.md src/engine/contracts src/shared/lib/extension-import.ts src/shared/lib/extension-import.spec.ts
git commit -m "feat: define customization safety contracts"
```

---

### Task 2: Atomic active-theme capability

**Files:**
- Create: `src-tauri/src/commands/storage/customization.rs`
- Create: `src-tauri/src/commands/storage/commands/customization.rs`
- Modify: `src-tauri/src/commands/storage.rs`
- Modify: `src-tauri/src/http_dispatch.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src/shared/api/remote-runtime.ts`
- Create: `src/shared/api/customization-api.ts`
- Create: `src/shared/api/customization-api.spec.ts`
- Modify: `src/features/shell/settings/hooks/use-themes.ts`
- Modify: `src/features/shell/settings/hooks/use-themes.spec.tsx`

**Interfaces:**
- Rust: `theme_set_active(state: &AppState, theme_id: Option<&str>) -> AppResult<Value>`.
- Shared API: `themesApi.setActive(themeId: string | null): Promise<Theme | null>`.

- [ ] **Step 1: Add Rust red tests for null, missing, exactly-one, and serialized concurrent selection**

```rust
let selected = theme_set_active(&state, Some("theme-b"))?;
assert_eq!(selected["id"], "theme-b");
assert_eq!(active_theme_ids(&state), vec!["theme-b"]);
assert_eq!(theme_set_active(&state, None)?, Value::Null);
assert!(active_theme_ids(&state).is_empty());
```

Run: `cargo test --manifest-path src-tauri/Cargo.toml customization::tests::theme_set_active -- --nocapture`  
Expected: FAIL because the focused owner does not exist.

- [ ] **Step 2: Implement one-collection atomic mutation**

Use `state.storage.update_collections_atomically(vec!["themes"], ...)`, validate the selected ID before changing rows, write both `isActive` and `active`, update timestamps, and return the selected clone or null.

- [ ] **Step 3: Add embedded and HTTP routing**

```rust
#[tauri::command]
pub fn theme_set_active(state: State<'_, AppState>, theme_id: Option<String>) -> Result<Value, AppError> {
    customization::theme_set_active(&state, theme_id.as_deref())
}
```

Register `theme_set_active` in `src-tauri/src/lib.rs`, dispatch it explicitly in `http_dispatch.rs`, and add it to `REMOTE_COMMANDS`.

- [ ] **Step 4: Add shared-API and hook red tests, then replace frontend fan-out**

```ts
expect(invokeTauri).toHaveBeenCalledWith("theme_set_active", { themeId: "theme-b" });
await mutation.mutateAsync("theme-b");
expect(storageApi.update).not.toHaveBeenCalled();
```

Run: `pnpm vitest run src/shared/api/customization-api.spec.ts src/features/shell/settings/hooks/use-themes.spec.tsx`  
Expected: FAIL until the wrapper and hook use the command.

- [ ] **Step 5: Run green checks and commit**

Run: `cargo test --manifest-path src-tauri/Cargo.toml customization::tests::theme_set_active -- --nocapture`  
Run: `pnpm vitest run src/shared/api/customization-api.spec.ts src/features/shell/settings/hooks/use-themes.spec.tsx`  
Run: `pnpm check:architecture`  
Expected: PASS.

```sh
git add src-tauri/src/commands/storage/customization.rs src-tauri/src/commands/storage/commands/customization.rs src-tauri/src/commands/storage.rs src-tauri/src/http_dispatch.rs src-tauri/src/lib.rs src/shared/api/remote-runtime.ts src/shared/api/customization-api.ts src/shared/api/customization-api.spec.ts src/features/shell/settings/hooks/use-themes.ts src/features/shell/settings/hooks/use-themes.spec.tsx
git commit -m "fix: make active theme selection atomic"
```

---

### Task 3: Isolated theme preview and customization safe mode

**Files:**
- Create: `src/features/shell/settings/components/settings/ThemePreview.tsx`
- Create: `src/features/shell/settings/components/settings/ThemePreview.spec.tsx`
- Create: `src/app/CustomizationSafeMode.tsx`
- Create: `src/app/customization-safe-mode.ts`
- Create: `src/app/customization-safe-mode.spec.ts`
- Modify: `src/app/App.tsx`
- Modify: `src/app/AppExperience.tsx`
- Modify: `src/features/shell/settings/components/settings/SettingsSurfaces.tsx`
- Modify: `src/app/providers/CustomThemeInjector.tsx`
- Create: `src/app/providers/CustomThemeInjector.spec.tsx`

**Interfaces:**
- `isCustomizationSafeMode(location: Pick<Location, "search">): boolean`.
- `ThemePreview({ css, enabled })` writes sanitized CSS only into sandboxed iframe `srcDoc`.
- `CustomizationSafeMode` deactivates the active theme and clears local extension consent without mounting customization injectors.

- [ ] **Step 1: Add red tests proving draft CSS never reaches the parent document and safe mode bypasses injection**

```tsx
render(<ThemePreview enabled css={'button { display: none !important; }'} />);
expect(document.head.textContent).not.toContain("display: none");
expect(screen.getByTitle("Theme preview")).toHaveAttribute("sandbox", "");
expect(isCustomizationSafeMode({ search: "?safe-mode=customizations" })).toBe(true);
```

Run: `pnpm vitest run src/features/shell/settings/components/settings/ThemePreview.spec.tsx src/app/customization-safe-mode.spec.ts src/app/providers/CustomThemeInjector.spec.tsx`  
Expected: FAIL because the preview and route do not exist.

- [ ] **Step 2: Implement the isolated iframe and default preview-off editor state**

Build `srcDoc` from a fixed representative fixture, escaped theme CSS, and built-in fixture CSS. Do not use `allow-scripts` or `allow-same-origin`. Remove the global preview `<style>` effect from `SettingsSurfaces.tsx`.

- [ ] **Step 3: Implement the pre-provider recovery branch**

```tsx
export function App() {
  if (isCustomizationSafeMode(window.location)) return <CustomizationSafeMode />;
  return <Suspense fallback={<BootShellFallback />}><AppExperience /></Suspense>;
}
```

The recovery buttons call `themesApi.setActive(null)` and `extensionDeviceConsentStore.clearRuntime(currentRuntimeKey())`, report errors inline, and navigate back by removing the query parameter only after successful recovery.

- [ ] **Step 4: Refuse oversized stored theme or extension CSS at injection time**

Treat invalid stored data as inactive and log one bounded diagnostic. Safe mode remains the recovery path; do not silently truncate CSS.

- [ ] **Step 5: Run focused tests, typecheck, and commit**

Run: `pnpm vitest run src/features/shell/settings/components/settings/ThemePreview.spec.tsx src/app/customization-safe-mode.spec.ts src/app/providers/CustomThemeInjector.spec.tsx`  
Run: `pnpm typecheck`  
Expected: PASS.

```sh
git add src/features/shell/settings/components/settings/ThemePreview.tsx src/features/shell/settings/components/settings/ThemePreview.spec.tsx src/app/CustomizationSafeMode.tsx src/app/customization-safe-mode.ts src/app/customization-safe-mode.spec.ts src/app/App.tsx src/app/AppExperience.tsx src/features/shell/settings/components/settings/SettingsSurfaces.tsx src/app/providers/CustomThemeInjector.tsx src/app/providers/CustomThemeInjector.spec.tsx
git commit -m "feat: contain theme preview and add safe mode"
```

---

### Task 4: Validated remote font upload

**Files:**
- Modify: `src/shared/api/file-payload.ts`
- Create: `src/shared/api/settings-assets-api.spec.ts`
- Modify: `src/shared/api/settings-assets-api.ts`
- Modify: `src-tauri/src/commands/storage/fonts.rs`
- Modify: `src-tauri/src/commands/storage/commands/assets.rs`
- Modify: `src-tauri/src/http_dispatch.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src/shared/api/remote-runtime.ts`
- Create: `src/features/shell/settings/lib/font-settings-actions.ts`
- Create: `src/features/shell/settings/lib/font-settings-actions.spec.ts`
- Modify: `src/features/shell/settings/components/settings/SettingsSurfaces.tsx`

**Interfaces:**
- Shared API: `fontsApi.upload<T>(file: File): Promise<T>` sending `{ body: { file: UploadFilePayload } }`.
- Rust: `fonts_upload(state: &AppState, body: Value) -> AppResult<Value>`.
- UI helper: `fontManagementMode(remoteTarget): "folder" | "upload"`.

- [ ] **Step 1: Add Rust red tests for valid signatures and negative controls**

Cover TTF, OTF, WOFF, WOFF2; reject a `.ttf` containing text, a valid TTF named `.png`, path separators, invalid base64, and decoded bytes over 10 MiB. Assert the fonts directory remains unchanged after every rejection.

Run: `cargo test --manifest-path src-tauri/Cargo.toml fonts::tests::upload -- --nocapture`  
Expected: FAIL because upload is unavailable.

- [ ] **Step 2: Implement validation and atomic managed write**

Decode the existing upload payload shape, normalize to a basename, compare extension and magic signature, call `write_managed_file_atomically`, rescan via the existing font listing owner, and return `{ filename, family, files }` without exposing absolute paths in errors.

- [ ] **Step 3: Add Tauri/HTTP/shared API routing and red-green wrapper tests**

```ts
await fontsApi.upload(file);
expect(invokeTauri).toHaveBeenCalledWith("fonts_upload", { body: { file: expect.objectContaining({ name: "custom.woff2" }) } });
```

Run: `pnpm vitest run src/shared/api/settings-assets-api.spec.ts`  
Expected: FAIL, then PASS after wrapper implementation.

- [ ] **Step 4: Add runtime-specific Settings behavior test and UI**

Embedded shows **Open Fonts Folder**; a configured or same-origin remote target shows **Upload Font**. Successful upload invalidates `custom-fonts`, dispatches `marinara-fonts-updated`, and selects the returned family. Failure uses `toUserMessage` in a toast.

Run: `pnpm vitest run src/features/shell/settings/lib/font-settings-actions.spec.ts src/shared/api/settings-assets-api.spec.ts`  
Expected: PASS.

- [ ] **Step 5: Run Rust, architecture, type checks, and commit**

Run: `cargo test --manifest-path src-tauri/Cargo.toml fonts::tests::upload -- --nocapture`  
Run: `pnpm check:architecture`  
Run: `pnpm typecheck`  
Expected: PASS.

```sh
git add src/shared/api/file-payload.ts src/shared/api/settings-assets-api.ts src/shared/api/settings-assets-api.spec.ts src-tauri/src/commands/storage/fonts.rs src-tauri/src/commands/storage/commands/assets.rs src-tauri/src/http_dispatch.rs src-tauri/src/lib.rs src/shared/api/remote-runtime.ts src/features/shell/settings/lib/font-settings-actions.ts src/features/shell/settings/lib/font-settings-actions.spec.ts src/features/shell/settings/components/settings/SettingsSurfaces.tsx
git commit -m "feat: upload custom fonts across runtimes"
```

---

### Task 5: Atomic extension removal and retained-data recovery

**Files:**
- Modify: `src/engine/contracts/types/extension.ts`
- Modify: `src/engine/contracts/schemas/extension.schema.ts`
- Modify: `src/engine/capabilities/storage-collections.ts`
- Modify: `src-tauri/src/commands/storage/contracts.rs`
- Modify: `src-tauri/src/commands/storage/customization.rs`
- Modify: `src-tauri/src/commands/storage/commands/customization.rs`
- Modify: `src-tauri/src/http_dispatch.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src/shared/api/remote-runtime.ts`
- Modify: `src/shared/api/customization-api.ts`
- Modify: `src/shared/api/customization-api.spec.ts`
- Modify: `src/app/providers/extension-storage-api.ts`
- Create: `src/app/providers/extension-storage-api.spec.ts`
- Modify: `src/features/shell/settings/hooks/use-extensions.ts`
- Modify: `src/features/shell/settings/hooks/use-extensions.spec.ts`
- Create: `src/features/shell/settings/components/settings/ExtensionRemovalDialog.tsx`
- Create: `src/features/shell/settings/components/settings/ExtensionRemovalDialog.spec.tsx`
- Modify: `src/features/shell/settings/components/settings/SettingsSurfaces.tsx`

**Interfaces:**
- `extension_remove(extension_id, data_policy)` returns `{ extensionId, dataPolicy, removedMemoryRows, retentionId }`.
- `extension_retained_data_list()` returns retention DTOs without plugin values.
- `extension_reconnect_data(extension_id, retention_id)` validates package identity and assigns the host-controlled namespace.
- `extension_retained_data_purge(retention_id)` deletes memory and retention atomically.

- [ ] **Step 1: Add Rust red tests for retain, purge, rollback, and mismatched recovery**

Seed two extensions and both namespaces. Prove purge removes only the selected namespace, retain creates a metadata-only retention row, a missing extension changes nothing, matching package reconnection succeeds only after explicit call, and a different package ID cannot reconnect.

Run: `cargo test --manifest-path src-tauri/Cargo.toml customization::tests::extension_ -- --nocapture`  
Expected: FAIL because lifecycle commands do not exist.

- [ ] **Step 2: Implement the three-collection atomic owner and storage contracts**

Use `update_collections_atomically(vec!["extensions", "plugin-memory", "extension-data-retention"], ...)`. Generate `storageNamespaceId` inside De-Koi, never from manifest input. Retention DTOs expose counts and identity metadata, not stored values.

- [ ] **Step 3: Route focused APIs and update the runtime storage namespace**

```ts
const namespace = extension.storageNamespaceId ?? extension.id;
const storage = createExtensionStorageApi(storageGateway, namespace);
```

Do not permit extension source to set `storageNamespaceId`; only command responses/storage rows may contain it.

- [ ] **Step 4: Add hook/dialog red tests and implement explicit choices**

```tsx
expect(screen.getByRole("button", { name: "Remove extension" })).toBeVisible();
expect(screen.getByRole("button", { name: "Remove extension and its data" })).toBeVisible();
```

The dialog describes retained data and destructive purge precisely. A retained-data Settings section lists name, package ID/version, row count, retained date, purge action, and matching-package reconnect action.

- [ ] **Step 5: Run focused tests and commit**

Run: `cargo test --manifest-path src-tauri/Cargo.toml customization::tests::extension_ -- --nocapture`  
Run: `pnpm vitest run src/shared/api/customization-api.spec.ts src/app/providers/extension-storage-api.spec.ts src/features/shell/settings/hooks/use-extensions.spec.ts src/features/shell/settings/components/settings/ExtensionRemovalDialog.spec.tsx`  
Run: `pnpm check:storage-contracts`  
Expected: PASS.

```sh
git add src/engine/contracts/types/extension.ts src/engine/contracts/schemas/extension.schema.ts src/engine/capabilities/storage-collections.ts src-tauri/src/commands/storage/contracts.rs src-tauri/src/commands/storage/customization.rs src-tauri/src/commands/storage/commands/customization.rs src-tauri/src/http_dispatch.rs src-tauri/src/lib.rs src/shared/api/remote-runtime.ts src/shared/api/customization-api.ts src/shared/api/customization-api.spec.ts src/app/providers/extension-storage-api.ts src/app/providers/extension-storage-api.spec.ts src/features/shell/settings/hooks/use-extensions.ts src/features/shell/settings/hooks/use-extensions.spec.ts src/features/shell/settings/components/settings/ExtensionRemovalDialog.tsx src/features/shell/settings/components/settings/ExtensionRemovalDialog.spec.tsx src/features/shell/settings/components/settings/SettingsSurfaces.tsx
git commit -m "feat: define extension data removal lifecycle"
```

---

### Task 6: Device-local activation and truthful capabilities

**Files:**
- Modify: `src/shared/lib/extension-import.ts`
- Modify: `src/shared/lib/extension-import.spec.ts`
- Create: `src/shared/lib/extension-device-consent.ts`
- Create: `src/shared/lib/extension-device-consent.spec.ts`
- Modify: `src/app/providers/extension-runtime.ts`
- Modify: `src/app/providers/extension-runtime.spec.ts`
- Modify: `src/app/providers/CustomThemeInjector.tsx`
- Modify: `src/app/providers/CustomThemeInjector.spec.tsx`
- Create: `src/features/shell/settings/hooks/use-extension-device-activation.ts`
- Create: `src/features/shell/settings/hooks/use-extension-device-activation.spec.tsx`
- Create: `src/features/shell/settings/lib/extension-capability-view.ts`
- Create: `src/features/shell/settings/lib/extension-capability-view.spec.ts`
- Create: `src/features/shell/settings/components/settings/ExtensionActivationDialog.tsx`
- Create: `src/features/shell/settings/components/settings/ExtensionActivationDialog.spec.tsx`
- Modify: `src/features/shell/settings/components/settings/SettingsSurfaces.tsx`

**Interfaces:**
- Runtime: `executeCustomExtensionJavaScript(ext, { permissions, storageNamespaceId, ...deps })` exposes only declared De-Koi helpers for package extensions.
- Hook: `useExtensionDeviceActivation(extension)` returns compatibility, fingerprint, CSS/JS activation, grant, revoke, and stale state.
- View helper maps every declared permission to `available`, `unavailable`, or `legacy-unscoped` plus user-facing text.

- [ ] **Step 1: Add red tests for permission-filtered helpers and legacy behavior**

```ts
execute(packageWith(["ui:styles"]));
expect(api.addStyle).toBeTypeOf("function");
expect(api.storage).toBeUndefined();
expect(api.addElement).toBeUndefined();

execute(legacyFileExtension);
expect(api.addStyle).toBeTypeOf("function");
expect(api.storage).toBeDefined();
```

Run: `pnpm vitest run src/app/providers/extension-runtime.spec.ts`  
Expected: FAIL because every helper is currently exposed.

- [ ] **Step 2: Implement the capability-filtered API without sandbox claims**

Map `ui:styles`, `runtime:dom`, and `storage:plugin-memory` to the existing helper groups. Leave unimplemented permissions absent. Legacy extensions receive the existing helper surface only after local consent.

- [ ] **Step 3: Add provider red tests for per-runtime consent, stale fingerprints, import behavior, and CSS scope**

Prove a shared enabled row does not execute without local consent, consent on runtime A does not apply on runtime B, source/permission changes revoke execution, CSS and JS flags act independently, and safe mode injects neither.

Add the dedicated consent-store test first, then implement fail-closed local storage and Web Crypto SHA-256 over canonical row ID, package identity/version, CSS, JavaScript, and sorted permissions. Consent records are `{ css, javascript, fingerprint, grantedAt }`, keyed by normalized runtime target plus extension row ID.

- [ ] **Step 4: Implement async consent resolution in the provider**

Cancel stale async fingerprint work on effect cleanup. Inject or execute only when the current fingerprint has matching local consent and the shared administrative flag remains enabled. Log execution errors without converting them to success.

- [ ] **Step 5: Add activation/capability UI red tests and implement Settings flows**

The activation dialog states: “JavaScript extensions run as trusted page-level code. Manifest permissions limit De-Koi-provided helpers, not direct browser-page access.” It lists requested, available, and unavailable declarations and blocks incompatible packages. Each row distinguishes profile installation/admin availability from this-device CSS/JS activation.

- [ ] **Step 6: Run focused tests, typecheck, and commit**

Run: `pnpm vitest run src/shared/lib/extension-import.spec.ts src/app/providers/extension-runtime.spec.ts src/app/providers/CustomThemeInjector.spec.tsx src/features/shell/settings/hooks/use-extension-device-activation.spec.tsx src/features/shell/settings/lib/extension-capability-view.spec.ts src/features/shell/settings/components/settings/ExtensionActivationDialog.spec.tsx`  
Run: `pnpm typecheck`  
Expected: PASS.

```sh
git add src/shared/lib/extension-import.ts src/shared/lib/extension-import.spec.ts src/app/providers/extension-runtime.ts src/app/providers/extension-runtime.spec.ts src/app/providers/CustomThemeInjector.tsx src/app/providers/CustomThemeInjector.spec.tsx src/features/shell/settings/hooks/use-extension-device-activation.ts src/features/shell/settings/hooks/use-extension-device-activation.spec.tsx src/features/shell/settings/lib/extension-capability-view.ts src/features/shell/settings/lib/extension-capability-view.spec.ts src/features/shell/settings/components/settings/ExtensionActivationDialog.tsx src/features/shell/settings/components/settings/ExtensionActivationDialog.spec.tsx src/features/shell/settings/components/settings/SettingsSurfaces.tsx
git commit -m "fix: keep extension activation device local"
```

---

### Task 7: Documentation, discovery, and integrated UI proof

**Files:**
- Modify: `docs/developer/extensions.html`
- Modify: `src/features/shell/discovery/discovery-entries.json`
- Modify: `src/features/shell/discovery/discovery-registry.spec.ts`
- Modify: `docs/superpowers/specs/2026-07-15-customization-safety-design.md` only if implementation decisions differ, with exact rationale.

- [ ] **Step 1: Update extension and recovery documentation**

Document trusted page-level execution, De-Koi helper permission filtering, per-device consent, compatibility status, retained-data choices, `?safe-mode=customizations`, and remote font upload. Do not call the runtime sandboxed.

- [ ] **Step 2: Update Discover metadata and run red-green registry tests**

Add searchable entries/actions for customization safe mode, custom font upload, and device-local extension activation using existing Settings destinations.

Run: `pnpm vitest run src/features/shell/discovery/discovery-registry.spec.ts`  
Run: `pnpm check:discovery`  
Run: `pnpm check:docs`  
Expected: PASS.

- [ ] **Step 3: Run browser proof for the actual UI claims**

Start `pnpm dev`, then use the in-app browser to verify desktop and narrow/mobile Settings layouts for: isolated preview controls, safe-mode recovery route, embedded/remote font control selection, extension activation dialog, removal choices, retained-data section, and no console errors. Capture screenshots for the PR.

- [ ] **Step 4: Commit documentation and discovery**

```sh
git add docs/developer/extensions.html src/features/shell/discovery docs/superpowers/specs/2026-07-15-customization-safety-design.md
git commit -m "docs: explain customization safety controls"
```

---

### Task 8: Full verification, Bunny, PR, CI, and merge

**Files:**
- Review all changes against `origin/main`.
- Create PR text from `.github/pull_request_template.md`; leave human checkboxes unchecked.

- [ ] **Step 1: Run focused and full local gates**

Run: `pnpm test -- --reporter=dot`  
Run: `cargo test --manifest-path src-tauri/Cargo.toml --workspace`  
Run: `pnpm check:architecture`  
Run: `pnpm check`  
Expected: all exit 0.

- [ ] **Step 2: Audit the final boundary and risk matrix**

Record positive and negative proof for theme recovery, concurrent storage, font signatures/path safety, retain/purge/reconnect, profile-import non-consent, remote-runtime isolation, compatibility, and unsigned package namespace denial. Confirm `git diff --check origin/main...HEAD`, commit list, and diff stat contain only the intended slice.

- [ ] **Step 3: Run Bunny before publishing**

Use the Bunny skill and repo packet against `origin/main...HEAD`. Fix every blocking or important finding, rerun affected tests and `pnpm check`, commit, then rerun Bunny until it passes.

- [ ] **Step 4: Push and open a draft PR**

Push `fix/customization-safety` to `origin` over authenticated HTTPS. Create a draft PR targeting `main`, link all six issues, include architecture boundaries, exact validation output, manual/browser gaps, screenshots, risk notes, and unchecked human validation boxes.

- [ ] **Step 5: Run Bunny after every PR-affecting push and pass CI**

Address actionable review comments and failed checks with test-first fixes. Do not trigger CodeRabbit. When local gates, Bunny, and GitHub checks are green, mark the PR ready.

- [ ] **Step 6: Merge and verify main**

Merge through GitHub without force push. Confirm the PR is merged, the merge commit is on `origin/main`, and all six issues closed. Preserve the worktree until merge verification completes, then remove only the worktree created for this task.
