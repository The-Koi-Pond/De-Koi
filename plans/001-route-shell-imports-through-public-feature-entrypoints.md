# Plan 001: Route Shell Imports Through Public Feature Entrypoints

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving to the next step. If anything in the "STOP conditions" section occurs, stop and report. Do not improvise. When done, update the status row for this plan in `plans/README.md` unless a reviewer dispatched you and told you they maintain the index.
>
> **Drift check (run first)**: `git diff --stat 6bb7b49f..HEAD -- src/app/shell/AppShell.tsx src/features/modes/conversation/index.ts src/features/modes/conversation/hooks/autonomous/use-background-autonomous.ts src/features/catalog/characters/index.ts`
> If any in-scope file changed since this plan was written, compare the "Current state" excerpts against the live code before proceeding; on a mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: tech-debt
- **Planned at**: commit `6bb7b49f`, 2026-06-14

## Why This Matters

De-Koi's documented architecture says feature package internals are private and cross-package callers must use public entrypoints. The current branch fails the repo's own architecture gate with six dependency-cruiser violations, which blocks the PR-ready baseline. The likely fix is mechanical: route imports through existing `shell.ts` and `index.ts` entrypoints, adding a public export only where the entrypoint already represents the owning package.

## Current State

Relevant files:

- `src/app/shell/AppShell.tsx` - app shell composition; currently imports feature internals directly.
- `src/features/modes/conversation/hooks/autonomous/use-background-autonomous.ts` - conversation-owned background polling hook; currently imports a catalog character hook private path directly.
- `src/features/modes/conversation/index.ts` - existing public conversation package entrypoint.
- `src/features/catalog/characters/index.ts` - existing public catalog/characters entrypoint.
- `.dependency-cruiser.cjs` - enforces package-private import rules.

Current evidence:

```ts
// src/app/shell/AppShell.tsx:9
import { SpotifyMobileWidget } from "../../features/shell/spotify/components/SpotifyMiniPlayer";

// src/app/shell/AppShell.tsx:10
import { ChatNotificationBubbles } from "../../features/shell/notifications/components/ChatNotificationBubbles";

// src/app/shell/AppShell.tsx:11
import { AgentDebugPanel } from "../../features/catalog/agents/components/AgentDebugPanel";

// src/app/shell/AppShell.tsx:22
import { useBackgroundAutonomousPolling } from "../../features/modes/conversation/hooks/autonomous/use-background-autonomous";

// src/app/shell/AppShell.tsx:56
const ProfessorMariSurface = lazy(() =>
  import("../../features/shell/mari/components/ProfessorMariSurface").then((module) => ({
    default: module.ProfessorMariSurface,
  })),
);
```

```ts
// src/features/modes/conversation/hooks/autonomous/use-background-autonomous.ts:22
import { invalidateCharacterCollectionQueries } from "../../../../catalog/characters/hooks/use-characters";
```

Public entrypoints already exist for most of these targets:

```ts
// src/features/shell/spotify/shell.ts:1
export * from "./components/SpotifyMiniPlayer";

// src/features/shell/notifications/shell.ts:1
export * from "./components/ChatNotificationBubbles";

// src/features/shell/mari/shell.ts:1
export * from "./components/ProfessorMariSurface";

// src/features/catalog/agents/shell.ts:1
export * from "./components/AgentDebugPanel";

// src/features/modes/conversation/index.ts:4
export * from "./hooks/autonomous/use-background-autonomous";

// src/features/catalog/characters/index.ts:2
export * from "./hooks/use-characters";
```

The rule being violated is generated in `.dependency-cruiser.cjs`:

```js
// .dependency-cruiser.cjs:43
name: `no-cross-package-private-imports-${packageName}`,

// .dependency-cruiser.cjs:47
from: { path: outsidePackagePath },

// .dependency-cruiser.cjs:48
to: { path: privatePackagePath },
```

Repo constraints to honor:

- `AGENTS.md:10`: "New or touched feature code should use focused shared API wrappers, not raw `invokeTauri` imports or raw remote-runtime `fetch`."
- `AGENTS.md:50`: architecture/import rules are verified with `pnpm check:architecture`.
- `CONTRIBUTING.md:72`: the hard boundaries section defines layer ownership.
- `CONTRIBUTING.md:108`: import graph changes require `pnpm check:architecture` and usually `pnpm build`.

Verification already observed during audit:

- `pnpm typecheck` passed.
- `pnpm check:architecture` failed with six dependency-cruiser violations:
  - `src/app/shell/AppShell.tsx -> src/features/shell/spotify/components/SpotifyMiniPlayer.tsx`
  - `src/app/shell/AppShell.tsx -> src/features/shell/notifications/components/ChatNotificationBubbles.tsx`
  - `src/app/shell/AppShell.tsx -> src/features/shell/mari/components/ProfessorMariSurface.tsx`
  - `src/app/shell/AppShell.tsx -> src/features/modes/conversation/hooks/autonomous/use-background-autonomous.ts`
  - `src/features/modes/conversation/hooks/autonomous/use-background-autonomous.ts -> src/features/catalog/characters/hooks/use-characters.ts`
  - `src/app/shell/AppShell.tsx -> src/features/catalog/agents/components/AgentDebugPanel.tsx`

## Commands You Will Need

| Purpose | Command | Expected On Success |
|---------|---------|---------------------|
| Typecheck | `pnpm typecheck` | exit 0, no TypeScript errors |
| Architecture | `pnpm check:architecture` | exit 0, no dependency-cruiser violations |
| Build sanity | `pnpm build` | exit 0, Vite build completes |

## Scope

**In scope**:

- `src/app/shell/AppShell.tsx`
- `src/features/modes/conversation/hooks/autonomous/use-background-autonomous.ts`
- `src/features/modes/conversation/index.ts` only if its current export is missing or drifted
- `src/features/catalog/characters/index.ts` only if its current export is missing or drifted

**Out of scope**:

- `.dependency-cruiser.cjs`: do not weaken or suppress architecture rules.
- Any feature implementation files under `components/`, `hooks/`, `stores/`, `lib/`, or `api/` except the import line in `use-background-autonomous.ts`.
- UI behavior, polling behavior, notification behavior, Spotify behavior, Professor Mari behavior, and agent debug behavior.
- Any package/dependency changes.

## Git Workflow

- Branch: continue on the operator's current branch unless told otherwise.
- Commit style in recent history is short imperative/chore/doc messages, for example `Use main as De-Koi workflow base` and `chore: point repo identity at De-Koi`.
- Do not commit, push, or open a PR unless the operator explicitly asks.

## Steps

### Step 1: Replace AppShell Feature-Private Imports

In `src/app/shell/AppShell.tsx`, replace the direct component/hook imports with public entrypoint imports.

Target shape:

```ts
import { SpotifyMobileWidget } from "../../features/shell/spotify/shell";
import { ChatNotificationBubbles } from "../../features/shell/notifications/shell";
import { AgentDebugPanel } from "../../features/catalog/agents/shell";
import { useBackgroundAutonomousPolling } from "../../features/modes/conversation";
```

Replace the lazy Professor Mari import with the shell entrypoint:

```ts
const ProfessorMariSurface = lazy(() =>
  import("../../features/shell/mari/shell").then((module) => ({
    default: module.ProfessorMariSurface,
  })),
);
```

**Verify**: `pnpm typecheck` -> exit 0.

### Step 2: Replace The Conversation Hook's Catalog Private Import

In `src/features/modes/conversation/hooks/autonomous/use-background-autonomous.ts`, replace:

```ts
import { invalidateCharacterCollectionQueries } from "../../../../catalog/characters/hooks/use-characters";
```

with:

```ts
import { invalidateCharacterCollectionQueries } from "../../../../catalog/characters";
```

`src/features/catalog/characters/index.ts` currently re-exports `./hooks/use-characters`, so no new export should be needed unless the file drifted.

**Verify**: `pnpm typecheck` -> exit 0.

### Step 3: Run The Architecture Gate

Run the architecture command and confirm the six listed violations are gone.

**Verify**: `pnpm check:architecture` -> exit 0, no dependency-cruiser violations.

### Step 4: Run A Build Sanity Check

Because `AppShell.tsx` controls lazy imports and app composition, run a build after the import changes.

**Verify**: `pnpm build` -> exit 0.

## Test Plan

No new unit tests are required because this plan changes import paths only. The regression proof is the repo's architecture gate plus TypeScript/build resolution:

- `pnpm typecheck`
- `pnpm check:architecture`
- `pnpm build`

## Done Criteria

All must hold:

- [ ] `pnpm typecheck` exits 0.
- [ ] `pnpm check:architecture` exits 0.
- [ ] `pnpm build` exits 0.
- [ ] `rg "features/.+/(components|hooks|stores|state|lib|api|encounter)/" src/app/shell/AppShell.tsx src/features/modes/conversation/hooks/autonomous/use-background-autonomous.ts` returns no matches for the changed imports.
- [ ] No files outside the in-scope list are modified, except `plans/README.md` status if the executor updates it.
- [ ] `plans/README.md` status row updated.

## STOP Conditions

Stop and report back if:

- Any public entrypoint listed in "Current state" is missing or no longer exports the needed symbol.
- Fixing the architecture gate appears to require editing `.dependency-cruiser.cjs`.
- Typecheck fails for reasons unrelated to the import paths.
- `pnpm check:architecture` still reports violations after the import rewrites, and the remaining violations are not in the six-item audit list.
- The operator's working tree has unrelated changes in the in-scope files that make it unclear how to preserve their edits.

## Maintenance Notes

- Future app shell composition should import feature-owned UI from package entrypoints such as `shell.ts` or `index.ts`, not from `components/` or `hooks/` paths.
- Reviewers should confirm this is an import-only diff and that no architecture rule was relaxed.
- If a package does not have a suitable public entrypoint, create the narrowest public export in that package rather than importing private internals from `src/app`.
