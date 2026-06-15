# Plan 003: Add shadcn Configuration For The Real De-Koi Tailwind Entrypoint

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving to the next step. If anything in the "STOP conditions" section occurs, stop and report. Do not improvise. When done, update the status row for this plan in `plans/README.md` unless a reviewer dispatched you and told you they maintain the index.
>
> **Drift check (run first)**: `git diff --stat 6bb7b49f..HEAD -- components.json src/app/main.tsx src/app/App.css src/styles/globals.css src/shared/lib/utils.ts package.json pnpm-lock.yaml`
> If any in-scope file changed since this plan was written, compare the "Current state" excerpts against the live code before proceeding; on a mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: dx
- **Planned at**: commit `6bb7b49f`, 2026-06-14

## Why This Matters

The current shadcn CLI can identify De-Koi as a Vite, TypeScript, Tailwind v4 project, but it detects `src/app/App.css` as the Tailwind CSS file because there is no `components.json`. The app actually imports `src/styles/globals.css`, which contains the real De-Koi theme tokens and Tailwind setup. Without an explicit config, future `shadcn add` or registry operations can write to the wrong paths or use aliases that do not match De-Koi's shared UI layout.

## Current State

Relevant files:

- `components.json` - missing today; should be created.
- `src/app/main.tsx` - imports the real global stylesheet.
- `src/styles/globals.css` - real Tailwind v4 and De-Koi theme entrypoint.
- `src/app/App.css` - stale/default Vite CSS file with `@import "tailwindcss"` and unused starter classes.
- `src/shared/lib/utils.ts` - contains existing `cn` utility using `clsx` and `tailwind-merge`.
- `src/shared/components/ui/` - existing shared UI component home.
- `package.json` and `pnpm-lock.yaml` - should not change in this plan unless the operator separately approves dependency changes.

Observed CLI output from `pnpm dlx shadcn@latest info`:

```text
Project
  framework         Vite (vite)
  srcDirectory      Yes
  rsc               No
  typescript        Yes
  tailwindVersion   v4
  tailwindConfig    -
  tailwindCss       src/app/App.css
  importAlias       @

Configuration
  No components.json found.
```

Current app import:

```ts
// src/app/main.tsx:6
import "../styles/globals.css";
```

Current stale CSS evidence:

```css
/* src/app/App.css:1 */
@import "tailwindcss";

/* src/app/App.css:19 */
.container {

/* src/app/App.css:28 */
.logo {

/* src/app/App.css:89 */
#greet-input {
```

Existing utility:

```ts
// src/shared/lib/utils.ts
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

Repo constraints:

- `DESIGN.md` defines De-Koi's blush/violet theme tokens and says to use existing semantic tokens before adding one-off colors.
- `src/styles/globals.css` already contains De-Koi's Tailwind v4 `@theme` mapping and `@custom-variant dark`.
- `AGENTS.md:45` says TypeScript/UI/engine changes should run `pnpm typecheck`.
- `CONTRIBUTING.md:108` says import graph or bundling changes usually require `pnpm check:architecture` and `pnpm build`.

## Commands You Will Need

| Purpose | Command | Expected On Success |
|---------|---------|---------------------|
| Inspect shadcn | `pnpm dlx shadcn@latest info` | reports `tailwindCss src/styles/globals.css` after config |
| Typecheck | `pnpm typecheck` | exit 0, no TypeScript errors |
| Build | `pnpm build` | exit 0, Vite build completes |
| Git scope | `git status --short -- components.json src/app/App.css package.json pnpm-lock.yaml` | only intended files changed |

## Scope

**In scope**:

- `components.json` (create)
- `src/app/App.css` only if deleting or removing stale Tailwind import is needed after confirming it is not imported
- `plans/README.md` status update after completion

**Out of scope**:

- Running `shadcn init` if it would modify dependencies or overwrite project CSS.
- Adding shadcn components.
- Moving existing shared UI components.
- Editing `src/styles/globals.css` theme tokens.
- Editing `src/shared/lib/utils.ts` unless the existing `cn` utility is missing or drifted.
- Changing `package.json` or `pnpm-lock.yaml` without explicit operator approval.

## Git Workflow

- Branch: continue on the operator's current branch unless told otherwise.
- Commit style in recent history is short imperative/chore/doc messages, for example `Use main as De-Koi workflow base` and `chore: point repo identity at De-Koi`.
- Do not commit, push, or open a PR unless the operator explicitly asks.

## Steps

### Step 1: Confirm App.css Is Not Imported

Search for `App.css` imports/usages. The audit found `src/app/main.tsx` imports `../styles/globals.css`, not `App.css`.

**Verify**: `rg -n "App\\.css|\\.\\./styles/globals\\.css" src` -> expected result includes `src/app/main.tsx:6` for `globals.css` and no live import of `App.css`.

### Step 2: Create components.json With De-Koi Paths

Create `components.json` at the repo root. Use De-Koi's existing aliases and shared UI layout.

Target content:

```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "new-york",
  "rsc": false,
  "tsx": true,
  "tailwind": {
    "config": "",
    "css": "src/styles/globals.css",
    "baseColor": "neutral",
    "cssVariables": true,
    "prefix": ""
  },
  "aliases": {
    "components": "@/shared/components",
    "ui": "@/shared/components/ui",
    "utils": "@/shared/lib/utils",
    "lib": "@/shared/lib",
    "hooks": "@/shared/hooks"
  },
  "iconLibrary": "lucide"
}
```

If the current shadcn CLI rejects the `style` value or schema shape, STOP and report the exact validation error instead of guessing a different config.

**Verify**: `pnpm dlx shadcn@latest info` -> expected output has `Configuration` populated and `tailwindCss src/styles/globals.css`.

### Step 3: Retire Or Neutralize The Stale Vite CSS File

If Step 1 confirms `src/app/App.css` is not imported, either delete `src/app/App.css` or remove the stale `@import "tailwindcss"` and starter selectors from it. Prefer deletion if no code imports it.

Do not touch `src/styles/globals.css`; it is the real stylesheet and contains De-Koi's theme architecture.

**Verify**: `rg -n "App\\.css|@import \"tailwindcss\"" src/app src/styles` -> expected result includes `@import "tailwindcss"` only in `src/styles/globals.css`, and no `App.css` import.

### Step 4: Run Typecheck And Build

Because this is configuration/CSS-entrypoint work, run TypeScript and build checks.

**Verify**: `pnpm typecheck` -> exit 0.

**Verify**: `pnpm build` -> exit 0.

### Step 5: Confirm No Dependency Churn

This plan should not change dependencies. Confirm the manifest and lockfile are unchanged by this plan.

**Verify**: `git status --short -- package.json pnpm-lock.yaml` -> expected no new changes from this plan.

## Test Plan

No unit tests are required. This is a tooling/configuration fix. Verification is:

- `pnpm dlx shadcn@latest info` reports `tailwindCss src/styles/globals.css`.
- `pnpm typecheck` exits 0.
- `pnpm build` exits 0.
- `git status --short -- package.json pnpm-lock.yaml` shows no dependency churn from this plan.

## Done Criteria

All must hold:

- [ ] `components.json` exists at repo root.
- [ ] `components.json` points shadcn `tailwind.css` to `src/styles/globals.css`.
- [ ] shadcn aliases point generated UI at `@/shared/components/ui` and utilities at `@/shared/lib/utils`.
- [ ] `pnpm dlx shadcn@latest info` reports `tailwindCss src/styles/globals.css`.
- [ ] `src/app/App.css` is no longer a competing Tailwind entrypoint if it is unused.
- [ ] `pnpm typecheck` exits 0.
- [ ] `pnpm build` exits 0.
- [ ] No package dependency files were changed by this plan.
- [ ] `plans/README.md` status row updated.

## STOP Conditions

Stop and report back if:

- `src/app/App.css` is imported by live code after all.
- `pnpm dlx shadcn@latest info` rejects the proposed `components.json` shape.
- shadcn tries to modify `package.json`, `pnpm-lock.yaml`, or `src/styles/globals.css`.
- The existing `cn` utility is missing or moved.
- The fix requires changing De-Koi theme tokens or adding shadcn components.

## Maintenance Notes

- Future shadcn component additions should land under `src/shared/components/ui` and use `@/shared/lib/utils`.
- Reviewers should check that generated shadcn code does not bypass De-Koi's semantic tokens in `src/styles/globals.css`.
- Keep `components.json` aligned with any future shared UI directory moves.
