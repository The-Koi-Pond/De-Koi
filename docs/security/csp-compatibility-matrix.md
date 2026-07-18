# Desktop Content Security Policy

De-Koi's Tauri renderer enforces the same Content Security Policy in development,
pre-alpha, and release builds. Tauri remains responsible for adding the hashes
and nonces for bundled assets; `dangerousDisableAssetCspModification` must stay
disabled.

## Compatibility matrix

| Surface | Required sources | Evidence target |
| --- | --- | --- |
| App shell, chat, roleplay, and Game | `default-src 'self'`; Tauri-managed script hashes/nonces | Build and launch the Tauri renderer; exercise navigation and each mode |
| Embedded Tauri IPC | `connect-src ipc: http://ipc.localhost` | Load stored catalog data and invoke an embedded command |
| Remote runtime and provider connections | `connect-src http: https: ws: wss:` | Health-check an HTTP LAN runtime and an HTTPS runtime; stream a model reply |
| Managed images and catalog media | `img-src`/`media-src` with `asset:` and `http://asset.localhost` | Render an imported avatar, gallery image, Game image, and audio asset |
| Data and object URLs | `data:` and `blob:` only on image, font, and media directives | Render generated images, thumbnails, notification sounds, and TTS audio |
| Themes and custom fonts | `style-src 'unsafe-inline'`; asset/data/blob/HTTP(S) font sources | Apply a custom theme, preview it in the sandboxed frame, and load a custom font |
| Extension JavaScript | `script-src blob:` | Enable an installed extension and verify its cleanup path |
| Regex timeout worker | `worker-src blob:` | Exercise a regex rule through the bounded worker |
| Spotify playback | `script-src https://sdk.scdn.co`; HTTPS connections | Load the opt-in Spotify player |
| YouTube music fallback | `frame-src https://www.youtube.com` | Start and control the iframe fallback |
| Rendered message HTML | No script, object, or iframe source is added | Verify sanitized rich message output; DOMPurify remains the content boundary |

## Why some scheme sources are broad

De-Koi supports user-configured LAN runtimes, self-hosted providers, arbitrary
OpenAI-compatible endpoints, and remote managed assets. Their hosts are not
known at build time, so `connect-src`, image, font, and media policies allow only
the required URI schemes rather than a host wildcard. Script and frame execution
remain host-specific. `object-src 'none'`, `frame-ancestors 'none'`, a self-only
base URI, and a self-only form target preserve the default-deny boundary.

The asset protocol filesystem scope is a separate capability boundary. It must
not expand beyond the reviewed application-data, local-data, configuration, and
thumbnail paths recorded in `scripts/check-security-policy.mjs`.

## Verification

Before release:

1. Run `pnpm check:security-policy`, `pnpm build`, and `pnpm check`.
2. Launch `pnpm tauri dev --no-watch` and confirm the main window remains
   operational without CSP violations.
3. Exercise the applicable rows above in the Tauri renderer. Browser-only
   Playwright runs do not prove the desktop-injected policy.
4. Build the intended release artifact with `pnpm tauri build`.

Any newly required source must be added to this matrix and to the narrowest CSP
directive. Returning either desktop configuration to `csp: null`, adding `*`,
or disabling Tauri's CSP asset modification is a release blocker.
