# Settings Panel Container-Responsive Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent the redesigned settings navigation rail from cramping forms when De-Koi's right panel is narrow.

**Architecture:** Keep `SettingsPanel` as the sole owner of settings navigation and active-surface composition. Replace viewport-responsive split-layout utilities with Tailwind container-query utilities so the component chooses horizontal tabs or the descriptive rail from its own inline width.

**Tech Stack:** React 19, TypeScript, Tailwind CSS 4 container queries, Vitest, jsdom.

## Global Constraints

- Preserve settings icons, descriptions, page headings, selection, and roving keyboard focus.
- Use a `48rem` (`@3xl`) container threshold for the two-column layout.
- Keep the change inside the settings UI feature lane; do not change engine state, shared APIs, persistence, runtime adapters, or Tauri behavior.
- Do not introduce new dependencies.

---

### Task 1: Make the settings layout respond to its container

**Files:**

- Modify: `src/features/shell/settings/components/SettingsPanel.spec.tsx`
- Modify: `src/features/shell/settings/components/SettingsPanel.tsx`

**Interfaces:**

- Consumes: Tailwind CSS 4 `@container` and `@3xl:` utilities; existing `useUIStore` settings-tab state.
- Produces: The existing `SettingsPanel(): JSX.Element` behavior with a local `48rem` layout threshold.

**Durable test rationale:** This fixes a known regression where a wide viewport forced a narrow resizable panel into a two-column layout. Visual inspection alone cannot prevent viewport breakpoint utilities from being reintroduced. Extending the existing focused component test with exact layout invariants is narrow and follows the stable nearby test pattern.

- [ ] **Step 1: Write the failing regression test**

Replace the first test in `SettingsPanel.spec.tsx` with:

```tsx
it("uses its own width for the descriptive navigation layout", () => {
  const panel = container.querySelector(".de-koi-settings-panel")!;
  const layout = container.querySelector(".de-koi-settings-layout")!;
  const tablist = container.querySelector('[role="tablist"]')!;

  expect(container.querySelector("h2")?.textContent).toBe("General");
  expect(container.textContent).toContain("Everyday behavior, message controls, and generation defaults.");
  expect(panel.className).toContain("@container");
  expect(layout.className).toContain("@3xl:grid-cols-[14rem_minmax(0,1fr)]");
  expect(tablist.className).toContain("@3xl:flex-col");
  expect(tablist.className).not.toContain("lg:flex-col");
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```powershell
pnpm vitest run src/features/shell/settings/components/SettingsPanel.spec.tsx
```

Expected: one test fails because the panel lacks `@container` and still uses `lg:` layout utilities; the other two tests pass.

- [ ] **Step 3: Implement the minimal container-responsive layout**

In `SettingsPanel.tsx`, replace the current root opening tag with these two nested opening tags so container-query styles apply to a descendant:

```tsx
<div className="de-koi-settings-panel @container h-full min-h-0">
  <div className="de-koi-settings-layout h-full min-h-0 @3xl:grid @3xl:grid-cols-[14rem_minmax(0,1fr)]">
```

Keep the existing tab list and active settings body as children of `de-koi-settings-layout`, then add one matching `</div>` immediately before the root's existing closing tag.

```tsx
className =
  "de-koi-settings-tabs flex min-w-0 shrink-0 gap-1 overflow-x-auto border-b border-[var(--border)] bg-[var(--card)]/45 p-2 @3xl:flex-col @3xl:overflow-y-auto @3xl:border-b-0 @3xl:border-r @3xl:p-3";
```

Change the tab button's wide-layout alignment utility from `lg:w-full lg:items-start` to:

```tsx
@3xl:w-full @3xl:items-start
```

Change the tab description's visibility utility from `lg:block` to:

```tsx
@3xl:block
```

Do not change tab data, state, event handling, content padding, or active-surface rendering.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run:

```powershell
pnpm vitest run src/features/shell/settings/components/SettingsPanel.spec.tsx
```

Expected: 3 tests pass with no warnings or errors.

- [ ] **Step 5: Run lane and architecture verification**

Run:

```powershell
pnpm typecheck
pnpm check:architecture
```

Expected: both commands exit 0.

- [ ] **Step 6: Verify responsive behavior in the browser**

Run:

```powershell
pnpm dev -- --host 127.0.0.1
```

Open the reported local URL, open Settings, and inspect both widths:

- A normal narrow right panel shows one horizontal scrollable navigation row and a full-width settings form.
- A settings container at least `48rem` wide shows the `14rem` descriptive navigation rail and a comfortably wide settings form.
- Tab clicking and arrow-key focus continue to update the page heading and active surface.

- [ ] **Step 7: Commit the tested implementation**

```powershell
git add -- src/features/shell/settings/components/SettingsPanel.tsx src/features/shell/settings/components/SettingsPanel.spec.tsx docs/superpowers/plans/2026-07-10-settings-panel-container-responsive.md
git commit -m "Fix cramped settings panel layout"
```

### Task 2: Review and ship

**Files:**

- Review: all branch changes against `origin/main`

**Interfaces:**

- Consumes: committed Task 1 implementation and verification evidence.
- Produces: merged pull request on `main`.

- [ ] **Step 1: Run the full shipping gate**

Run:

```powershell
pnpm check
```

Expected: all required checks exit 0; warning-only unused-code output is reviewed for relevance.

- [ ] **Step 2: Run Bunny review and address actionable findings**

Use the repository Bunny workflow against the complete branch diff. Re-run focused and affected checks after any correction. Expected: Bunny returns no blocking finding.

- [ ] **Step 3: Inspect shipping scope**

Run:

```powershell
git status --short --branch
git diff --check origin/main...HEAD
git diff --stat origin/main...HEAD
git log --oneline origin/main..HEAD
```

Expected: a clean worktree; only the design, implementation plan, settings component, and focused settings test are included.

- [ ] **Step 4: Push and open a draft pull request**

Push `fix/settings-panel-responsive-layout` to `origin`, open a draft PR with the verified behavior and test evidence, and wait for required checks.

- [ ] **Step 5: Mark ready and merge**

After required checks and Bunny are clean, mark the PR ready, merge it using the repository's permitted merge method, and verify `origin/main` contains the merge.
