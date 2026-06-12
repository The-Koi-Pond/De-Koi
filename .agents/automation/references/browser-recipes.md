# Marinara Browser Recipes

Use these recipes for repeatable Playwright or browser-use verification when
browser state is the claim. Marinara local browser verification is pre-approved
in those cases, but it is not the first proof tool for every UI-adjacent change.
Use the proof ladder first: static inspection, targeted tests, scratch harnesses,
route/module repros, and jsdom/component proof. Escalate to these browser
recipes for visual layout, interaction, routing, responsive behavior,
screenshot-dependent evidence, console/network inspection, or bugs that only
reproduce in a real browser. They are intentionally selector-light because
Marinara currently has a mix of titles, labels, component markers, and text
buttons. Prefer accessible names and stable `data-component` / `data-tour`
markers when present.

Default browser verification should be non-disruptive. Use a scripted
Playwright run with `headless: true` and an isolated profile/temp directory
before using any visible browser window. Put the script under `scratch/` when it
is reusable for the current bug, or run an equivalent one-shot Playwright
script. The script should open only localhost/file URLs, complete the full
recipe, capture real screenshots, and print a concise pass/fail summary.

Start from `.agents/automation/templates/ui-repro-playwright.mjs` for UI bugs
that truly need browser proof. Copy it into
`scratch/issue-<number>-ui-repro.mjs`, replace the action/assert block, and run
the same script before and after the fix by setting `REPRO_PHASE=before` or
`REPRO_PHASE=after`. The before run should capture the unexpected state; the
after run should prove the same path no longer fails.
The template also accepts `REPRO_ROUTE`, `REPRO_VIEWPORT_WIDTH`,
`REPRO_VIEWPORT_HEIGHT`, `REPRO_SCREENSHOT`, `REPRO_RECIPE`, and
`REPRO_ASSERT_SELECTOR` for simple route/viewport/assertion changes without
editing the harness.

Use a visible/in-app browser only when chai explicitly asks to watch it, the
bug requires interactive visual inspection, headless mode cannot reproduce the
bug, or a headless run fails in a way that needs visible debugging. If visible
browser automation is used as a fallback, record why in the ledger/report.

Always record the recipe name, viewport, result, and screenshot path in the
automation ledger when a browser recipe is used. For local-fix-only work,
screenshots stay local under `scratch/`. For UI bugfix PRs, the screenshot path
is only internal proof until reviewers can open it from GitHub. Before opening
or marking a UI bugfix PR ready, upload/attach the screenshots to GitHub or a
gist, record those URLs in the ledger, then embed or link the GitHub-viewable
images in the PR's UI evidence section. Do not commit temporary proof screenshots
under `docs/pr-evidence/`.

## Setup

1. Confirm browser proof is needed for the claim; otherwise use a cheaper proof.
2. Start `pnpm dev` if the app is not already running.
3. Open the local app with headless scripted Playwright by default, usually `http://localhost:3000` or the port printed by Vite/server logs.
4. Wait for the app shell:
   - `data-component="TopBar"`
   - `data-component="ChatSidebar"`
   - main content with `aria-label="Main content"`
5. Capture console errors before and after the flow.

## Recipe: App Shell Smoke

Purpose: prove the UI loads and the main surfaces are mounted.

Steps:

1. Use desktop viewport `1440x900`.
2. Verify `TopBar`, `ChatSidebar`, and main content are visible.
3. Open each top-bar panel by title or visible tooltip target: Browser, Characters, Lorebooks, Presets, Connections, Agents, Personas, Settings.
4. Verify the right panel region is visible and the app does not show a fatal error.
5. Capture a screenshot.

Run for:

- Any UI change touching layout, panels, settings, app shell, theme, or global styles.
- Any change where the failure mode could blank the app.

## Recipe: Mobile Shell Smoke

Purpose: catch cramped/hidden controls and viewport-only regressions.

Steps:

1. Use mobile viewport `390x844`.
2. Verify the top bar is visible and text does not overlap.
3. Toggle the chat sidebar with the Chats button.
4. Open Settings and one domain panel relevant to the change.
5. Capture a screenshot.

Run for:

- Any UI change with responsive layout risk.
- Any change touching toolbars, panels, modals, chat input, or sidebar rows.

## Recipe: Chat Input Draft

Purpose: verify chat input text entry, draft persistence, and disabled/enabled send state.

Steps:

1. Open or create a chat only when the task specifically touches chat behavior.
2. Type a unique draft into the chat textarea.
3. Navigate to another panel or editor, then return to the chat.
4. Verify the draft remains unless the task intentionally changed draft behavior.
5. If no model connection is configured, do not treat generation failure as a product failure; record the missing connection as a non-core blocker unless the task is about generation.
6. Capture before/after screenshots.

Run for:

- Chat input, draft, attachment, slash-command, send-button, streaming, persona, or connection switcher changes.

## Recipe: Panel Row Actions

Purpose: verify hover/mobile row actions remain discoverable and destructive actions confirm.

Steps:

1. Open the affected right panel.
2. Hover a row on desktop and verify action buttons appear.
3. Switch to mobile viewport and verify required actions remain visible without hover.
4. Trigger a destructive action only against disposable data, and verify a confirmation dialog appears.
5. Cancel the dialog unless the test explicitly creates disposable data.
6. Capture screenshots in desktop and mobile viewports.

Run for:

- Changes touching settings panels, resource panels, row actions, or destructive controls.

## Recipe: Modal Lifecycle

Purpose: verify modal registration, focus, escape/close behavior, and responsive bounds.

Steps:

1. Open the modal through the same UI path a user would use.
2. Verify the title and primary controls are visible.
3. Press `Escape` or click the close control and verify the modal closes.
4. Reopen it, resize to mobile, and verify content scrolls rather than overflowing the viewport.
5. Capture screenshots.

Run for:

- New or changed modals, import/export dialogs, editor overlays, confirmation flows.

## Recipe Selection Rule

Pick the smallest recipe set that proves the task's core claim plus obvious adjacent risk. Do not run every recipe by default. If a recipe cannot be run, record the exact missing dependency in the ledger.
