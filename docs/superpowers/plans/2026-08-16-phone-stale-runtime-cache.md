# Phone Stale Runtime Cache Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Chrome recover automatically when a Pi deployment invalidates an already-open De-Koi frontend, while preventing Nginx from returning HTML for missing hashed assets.

**Architecture:** A browser-only utility in `src/shared/lib` owns disposable runtime-cache cleanup and guarded Vite preload recovery. App startup and existing reload controls consume that utility. The Pi Nginx config separately owns document revalidation, immutable hashed assets, and true asset 404s.

**Tech Stack:** TypeScript, Vitest/jsdom, Vite preload-error events, Cache Storage and Service Worker browser APIs, Nginx, Docker.

## Global Constraints

- Never clear De-Koi `localStorage`, IndexedDB, chats, settings, or server data.
- Automatic recovery may run once per 20-second session cooldown; a repeated failure must surface instead of looping.
- Missing `/assets/` files return 404. Existing hashed assets are immutable. HTML revalidates.
- Work only in the isolated `fix/phone-stale-runtime-cache` worktree.
- Do not commit, push, open a PR, or deploy without separate authorization.

---

### Task 1: Browser runtime recovery owner

**Files:**

- Create: `src/shared/lib/browser-runtime.ts`
- Test: `src/shared/lib/browser-runtime.spec.ts`

**Interfaces:**

- Produces: `clearBrowserRuntimeCaches()`, `forceRefreshSpa(options?)`, and `registerPreloadErrorRecovery(options?)`.
- `forceRefreshSpa` accepts optional cache-clear, current-URL, location-replace, query-key, and query-value seams so tests can exercise the public behavior without navigating jsdom.
- `registerPreloadErrorRecovery` accepts optional event-target, session-storage, clock, and refresh seams; it returns an unregister function.

- [ ] **Step 1: Write the failing cache-cleanup and refresh tests**

  Cover successful and rejected service-worker unregistration, successful and rejected Cache Storage deletion, unsupported APIs, preservation of unrelated storage, and a refresh URL that preserves existing query/hash state while adding `spa_refresh`.

- [ ] **Step 2: Run the focused test and confirm RED**

  Run: `pnpm vitest run src/shared/lib/browser-runtime.spec.ts`

  Expected: FAIL because `./browser-runtime` does not exist.

- [ ] **Step 3: Implement cache cleanup and cache-busted replacement**

  Add best-effort `Promise.allSettled` cleanup for registrations and cache names. Build the replacement URL with `new URL(currentUrl)`, set the requested query parameter, then call the replacement dependency. Do not touch local storage or IndexedDB.

- [ ] **Step 4: Run the focused test and confirm GREEN**

  Run: `pnpm vitest run src/shared/lib/browser-runtime.spec.ts`

  Expected: all cache-cleanup and force-refresh tests PASS.

- [ ] **Step 5: Add a failing guarded preload-recovery test**

  Dispatch `vite:preloadError`; assert the first event is prevented and requests `forceRefreshSpa({ queryParamKey: "chunk_reload" })`. Dispatch again within 20 seconds; assert it is not prevented and no second refresh occurs. Advance beyond 20 seconds and assert recovery is allowed again.

- [ ] **Step 6: Implement and verify guarded preload recovery**

  Store `de-koi-preload-recovery-at` in session storage, use a 20,000 ms cooldown, prevent only the event that will be handled, and return a listener cleanup function.

  Run: `pnpm vitest run src/shared/lib/browser-runtime.spec.ts`

  Expected: PASS.

### Task 2: Wire recovery into startup and reload controls

**Files:**

- Modify: `src/app/main.tsx`
- Modify: `src/app/GlobalErrorBoundary.tsx`
- Modify: `src/app/GlobalErrorBoundary.spec.ts`
- Modify: `src/features/shell/settings/components/settings/SettingsSurfaces.tsx`

**Interfaces:**

- Consumes: `forceRefreshSpa()` and `registerPreloadErrorRecovery()` from Task 1.

- [ ] **Step 1: Add a failing error-boundary reload test**

  Mock `forceRefreshSpa`, render a throwing child without the `onReload` override, click `Reload De-Koi`, and assert the shared recovery function is called once.

- [ ] **Step 2: Run the error-boundary test and confirm RED**

  Run: `pnpm vitest run src/app/GlobalErrorBoundary.spec.ts`

  Expected: FAIL because the boundary still calls `window.location.reload()`.

- [ ] **Step 3: Wire all callers to the shared owner**

  Register preload recovery in `main.tsx` before `createRoot`. Change the error boundary fallback reload and Advanced Settings `Refresh App` handler to await/call `forceRefreshSpa()` while preserving their existing optional test override and toast/error behavior.

- [ ] **Step 4: Verify caller tests**

  Run: `pnpm vitest run src/shared/lib/browser-runtime.spec.ts src/app/GlobalErrorBoundary.spec.ts`

  Expected: PASS.

### Task 3: Correct Pi static-file caching and fallback

**Files:**

- Modify: `docker/nginx/pi-web.conf`

**Interfaces:**

- Produces: `/assets/` exact-file serving with immutable caching; revalidating `index.html`; SPA route fallback retained.

- [ ] **Step 1: Run a temporary config-contract assertion and confirm RED**

  Assert the config contains an `/assets/` location with `try_files $uri =404`, an immutable cache policy, and an exact `/index.html` location with `no-cache`/revalidation. The current config must fail these assertions.

- [ ] **Step 2: Implement the Nginx policy**

  Add:

  ```nginx
  location /assets/ {
    try_files $uri =404;
    add_header Cache-Control "public, max-age=31536000, immutable";
  }

  location = /index.html {
    add_header Cache-Control "no-cache, must-revalidate";
  }
  ```

  Keep SPA navigation fallback in `location /` and add `Cache-Control: no-cache, must-revalidate` there as well.

- [ ] **Step 3: Re-run the config assertion and confirm GREEN**

  Expected: all policy assertions PASS.

- [ ] **Step 4: Build and smoke-test the real image when Docker is available**

  Run `docker build -f Dockerfile.web -t de-koi-stale-cache-proof .`, start it on an unused loopback port, and verify:
  - `/` returns 200 plus `Cache-Control: no-cache, must-revalidate`.
  - a real `/assets/*.js` returns 200 plus the immutable policy.
  - `/assets/does-not-exist.js` returns 404 and not HTML.
  - `/some/spa/route` returns the application HTML with the revalidation policy.

### Task 4: Matching lane verification

**Files:**

- Review all files changed above plus both design/plan documents.

- [ ] **Step 1: Run focused tests**

  Run: `pnpm vitest run src/shared/lib/browser-runtime.spec.ts src/app/GlobalErrorBoundary.spec.ts`

- [ ] **Step 2: Run TypeScript and architecture checks**

  Run: `pnpm typecheck`

  Run: `pnpm check:architecture`

- [ ] **Step 3: Run the production build**

  Run: `pnpm build`

- [ ] **Step 4: Review the diff and worktree status**

  Confirm no unrelated files, temporary instrumentation, built assets, or user data are included. Report the remaining gap if Docker image proof could not run.
