# Phone stale runtime cache recovery

## Problem

After a Pi web deployment, Chrome can keep an older De-Koi page or an already-open tab that references hashed JavaScript files removed by the new image. The Pi Nginx fallback currently serves `index.html` with HTTP 200 for those missing asset paths. Chrome rejects that HTML as a JavaScript module, React never boots, and the page remains blank. Incognito works because it starts without the stale page and runtime caches.

The Settings "Refresh App" control also claims to unregister service workers and clear browser caches, but currently performs only an ordinary reload.

## Approved approach

Use defense in depth at the two correct owners:

1. Browser runtime recovery
   - Add a browser-only shared utility that unregisters service workers, clears Cache Storage, and reloads with a cache-busting query parameter.
   - Register a `vite:preloadError` listener before React renders. Recover once per cooldown window so a genuinely broken build cannot create a reload loop.
   - Route the Settings refresh control and crash-screen reload through the same utility.
   - Do not clear `localStorage`, `sessionStorage` except for the recovery cooldown key, IndexedDB, chats, settings, or server data.

2. Pi static asset serving
   - Serve `/assets/` as real files only; a missing hashed asset must return 404 instead of `index.html`.
   - Serve hashed assets with long-lived immutable caching.
   - Serve `index.html` and SPA navigation responses with revalidation/no-cache headers so Chrome sees new chunk names promptly after deployment.

## Error handling

- Cache and service-worker cleanup is best effort: one unsupported or failed browser API must not block the remaining cleanup or reload.
- Automatic recovery is guarded by a short session cooldown. A second preload failure inside the cooldown is allowed to surface for diagnostics instead of looping forever.
- The manual Refresh App action remains available and uses the same safe runtime-only cleanup.

## Proof

- Focused browser-runtime tests prove service-worker unregister, Cache Storage deletion, cache-busted reload, and cooldown behavior.
- Existing Settings and global error-boundary tests are extended only where needed to prove their reload actions use the shared recovery path.
- An Nginx contract check proves a missing `/assets/*.js` request returns 404, while SPA routes still return `index.html` and document responses carry revalidation headers.
- Run the focused Vitest suite, `pnpm typecheck`, `pnpm check:architecture`, and a production build. If Docker is available, validate the Nginx behavior against the built web image.

## Scope

This is limited to browser runtime recovery and Pi static-file delivery. It does not modify persisted De-Koi content, runtime storage, APIs, generation behavior, or native Tauri updates.
