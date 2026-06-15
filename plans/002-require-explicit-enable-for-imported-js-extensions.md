# Plan 002: Require Explicit Enablement For Imported JavaScript Extensions

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving to the next step. If anything in the "STOP conditions" section occurs, stop and report. Do not improvise. When done, update the status row for this plan in `plans/README.md` unless a reviewer dispatched you and told you they maintain the index.
>
> **Drift check (run first)**: `git diff --stat 6bb7b49f..HEAD -- src/features/shell/settings/components/SettingsPanel.tsx src/app/providers/CustomThemeInjector.tsx src/features/shell/settings/hooks/use-extensions.ts src/engine/contracts/schemas/extension.schema.ts src/engine/contracts/types/extension.ts`
> If any in-scope file changed since this plan was written, compare the "Current state" excerpts against the live code before proceeding; on a mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: none
- **Category**: security
- **Planned at**: commit `6bb7b49f`, 2026-06-14

## Why This Matters

De-Koi lets users import local extension files that can inject CSS and/or JavaScript. The current import flow stores `.json`, `.js`, and `.css` extensions with `enabled: true`, and `CustomThemeInjector` executes enabled JavaScript extensions by dynamically importing a Blob URL. That means a JavaScript extension executes as soon as it is imported, before the user has a separate trust/enable step. The plan keeps extension power intact, but makes JavaScript activation explicit and reviewable.

## Current State

Relevant files:

- `src/features/shell/settings/components/SettingsPanel.tsx` - extension import UI and enable/disable controls.
- `src/app/providers/CustomThemeInjector.tsx` - executes enabled extension CSS/JS and exposes the extension API.
- `src/features/shell/settings/hooks/use-extensions.ts` - React Query mutations for extension rows.
- `src/engine/contracts/schemas/extension.schema.ts` and `src/engine/contracts/types/extension.ts` - extension row contract, if the implementation needs a metadata field.

Current import behavior:

```ts
// src/features/shell/settings/components/SettingsPanel.tsx:2872
const handleImportExtension = async (e: React.ChangeEvent<HTMLInputElement>) => {

// src/features/shell/settings/components/SettingsPanel.tsx:2887
enabled: true,

// src/features/shell/settings/components/SettingsPanel.tsx:2897
enabled: true,

// src/features/shell/settings/components/SettingsPanel.tsx:2907
enabled: true,

// src/features/shell/settings/components/SettingsPanel.tsx:2932
<Download size="0.875rem" /> Import Extension (.json, .css, or .js)

// src/features/shell/settings/components/SettingsPanel.tsx:2989
. Extensions can inject custom CSS and/or JavaScript to modify the UI.
```

Current execution behavior:

```ts
// src/app/providers/CustomThemeInjector.tsx:156
if (k === "innerHTML") el.innerHTML = v;

// src/app/providers/CustomThemeInjector.tsx:166
storage: {
  list: storageApi.list,
  get: storageApi.get,
  create: storageApi.create,
  update: storageApi.update,
  delete: storageApi.delete,
},

// src/app/providers/CustomThemeInjector.tsx:218
const moduleSource = buildExtensionModuleSource(apiKey, ext.name, ext.js);

// src/app/providers/CustomThemeInjector.tsx:222
void import(/* @vite-ignore */ objectUrl)
```

Product/design constraints:

- `PRODUCT.md` says De-Koi is for nontechnical users who need "clear setup flows, forgiving defaults, visible guidance, and mobile-friendly controls."
- `DESIGN.md` says advanced settings still need clear labels, forgiving defaults, and helpful validation.
- `AGENTS.md` treats extensions or injected JS/CSS as risky work.

Important boundary: this plan is not claiming installed local extensions are untrusted remote code. It is a defensive UX and safety fix: JavaScript should not execute until the user explicitly enables it after import.

## Commands You Will Need

| Purpose | Command | Expected On Success |
|---------|---------|---------------------|
| Typecheck | `pnpm typecheck` | exit 0, no TypeScript errors |
| Targeted tests | `pnpm test -- SettingsPanel` or a narrower matching test filter | all matching tests pass |
| Frontend check | `pnpm check:frontend` | exit 0 |

If no existing settings test can host this behavior cleanly, create a focused component or helper test and run it with `pnpm test -- <new-test-file-stem>`.

## Scope

**In scope**:

- `src/features/shell/settings/components/SettingsPanel.tsx`
- `src/app/providers/CustomThemeInjector.tsx` only if the execution guard needs a UI-independent safety check
- `src/features/shell/settings/hooks/use-extensions.ts` only if mutation typing needs adjustment
- `src/engine/contracts/schemas/extension.schema.ts` and `src/engine/contracts/types/extension.ts` only if adding a small metadata field such as `trustedAt` or `importedDisabledReason`
- One focused test file if needed

**Out of scope**:

- Removing extension JavaScript support.
- Removing extension CSS support.
- Replacing the extension sandbox model.
- Changing extension storage entity names or migrating existing extension rows.
- Broad settings panel redesign.
- Adding dependency packages.
- Changing custom themes. This plan is about extensions, not themes.

## Git Workflow

- Branch: continue on the operator's current branch unless told otherwise.
- Commit style in recent history is short imperative/chore/doc messages, for example `Use main as De-Koi workflow base` and `chore: point repo identity at De-Koi`.
- Do not commit, push, or open a PR unless the operator explicitly asks.

## Steps

### Step 1: Change Imported JavaScript Extensions To Start Disabled

In `handleImportExtension`, change `.js` imports and `.json` imports containing non-empty `js` to store `enabled: false` by default.

Keep CSS-only imports enabled by default unless the operator asks for stricter behavior. CSS can still break visuals, but the audited high-risk path is JavaScript execution with storage access.

Suggested logic:

- Parse JSON extension imports.
- Determine `hasJavascript = typeof parsed.js === "string" && parsed.js.trim().length > 0`.
- For JSON imports, set `enabled: !hasJavascript`.
- For `.js` imports, set `enabled: false`.
- For `.css` imports, keep `enabled: true`.
- Adjust success toast copy so JS imports say the extension was installed disabled and must be enabled after review.

**Verify**: `pnpm typecheck` -> exit 0.

### Step 2: Add An Explicit Enable Confirmation For JavaScript Extensions

In the extension list toggle handler, when the user is enabling an extension that has non-empty `js`, show a confirmation dialog before calling `updateExtension.mutate({ id: ext.id, enabled: true })`.

Use the repo's existing `showConfirmDialog` helper if it is already imported in `SettingsPanel.tsx`; otherwise import it from the same app-dialog helper used elsewhere in settings. The dialog should clearly state:

- JavaScript extensions can modify the UI.
- They can access the extension API, including local extension storage operations exposed by the app.
- Only enable extensions from sources the user trusts.

Keep the copy concise and user-facing. Do not add alarmist security jargon.

**Verify**: `pnpm typecheck` -> exit 0.

### Step 3: Add A Runtime Defense In CustomThemeInjector

In `CustomThemeInjector`, before executing `ext.js`, make the execution condition explicit:

```ts
if (!ext.enabled || !ext.js?.trim()) continue;
```

This is a defense-in-depth cleanup. It should not replace the import and enable UI changes.

Do not remove `innerHTML` support or storage API support in this plan. Those are larger extension API design decisions and belong in a separate security design plan if desired.

**Verify**: `pnpm typecheck` -> exit 0.

### Step 4: Add Focused Tests

Add or update focused tests for the import/enable behavior. Prefer extracting small pure helpers from `SettingsPanel.tsx` if testing the full settings panel is too heavy.

Required cases:

- Importing a `.js` extension creates it with `enabled: false`.
- Importing a `.json` extension with non-empty `js` creates it with `enabled: false`.
- Importing a `.css` extension creates it with `enabled: true`.
- Enabling a JavaScript extension calls the confirmation path before mutation.
- Disabling any extension does not require the JavaScript trust confirmation.

Use existing test patterns in `src/features/shell/settings/components/ProfileImportSection.test.tsx` and nearby settings tests where possible.

**Verify**: `pnpm test -- SettingsPanel` or `pnpm test -- <new-test-file-stem>` -> all matching tests pass.

### Step 5: Run The Frontend Gate

Run the lane checks for a settings/UI change.

**Verify**: `pnpm check:frontend` -> exit 0.

## Test Plan

Write or update tests covering:

- JS file import starts disabled.
- JSON with JS starts disabled.
- CSS-only import remains enabled.
- Enabling JS requires confirmation.
- Disable path remains direct.

Then run:

- `pnpm test -- <new-test-file-stem>` -> all matching tests pass.
- `pnpm typecheck` -> exit 0.
- `pnpm check:frontend` -> exit 0.

## Done Criteria

All must hold:

- [ ] Imported `.js` extensions do not execute immediately after import because they are stored disabled.
- [ ] Imported `.json` extensions with non-empty `js` do not execute immediately after import because they are stored disabled.
- [ ] CSS-only extension import behavior is unchanged unless the operator explicitly approved a stricter policy.
- [ ] Enabling an extension with JavaScript shows an explicit trust confirmation before updating `enabled` to `true`.
- [ ] `CustomThemeInjector` only attempts JS execution for enabled extensions with non-empty JS.
- [ ] Focused tests for the above behavior exist and pass.
- [ ] `pnpm typecheck` exits 0.
- [ ] `pnpm check:frontend` exits 0.
- [ ] No files outside the in-scope list are modified, except `plans/README.md` status if the executor updates it.
- [ ] `plans/README.md` status row updated.

## STOP Conditions

Stop and report back if:

- Existing extension schema rejects additional metadata and the fix appears to require a migration.
- The settings panel is being split or heavily refactored in the current working tree, making a narrow import/enable change unsafe.
- Tests require broad mocking of unrelated settings areas; extract a small helper instead, or stop if extraction would touch out-of-scope areas.
- You discover existing docs promise imported JS extensions run immediately on import.
- The fix would remove extension JavaScript support rather than gating it.

## Maintenance Notes

- Reviewers should scrutinize the exact user-facing confirmation copy and the default `enabled` value for all import paths.
- This plan intentionally does not sandbox extensions further. A future security design plan could narrow `innerHTML`, storage API access, or extension capabilities.
- Keep extension behavior local-first and user-controlled; do not add network-based extension trust lists or remote allowlists in this plan.
