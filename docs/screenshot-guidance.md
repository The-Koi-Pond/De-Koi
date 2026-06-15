# Screenshot Guidance

Current release-build screenshots are checked into
`docs/screenshots/release/`. Do not restore the old screenshot set unless each
image is recaptured from the current De-Koi refactor UI.

The current set was captured on 2026-06-15 from the production web preview of
`origin/main` at `001e88a9` after `pnpm build` and `pnpm preview`. The mode
captures show the web-shell setup path before a Remote Runtime URL and provider
connection are configured. Desktop release notes can replace these with
desktop-app captures once a packaged desktop build with seeded release-safe data
is available.

## Required Release Captures

| Slot | Current image | Capture target |
| --- | --- | --- |
| Conversation | `docs/screenshots/release/conversation.png` | Conversation setup path with no private content |
| Roleplay | `docs/screenshots/release/roleplay.png` | Roleplay setup path with no private content |
| Game mode | `docs/screenshots/release/game-mode.png` | Game setup path with no private content |
| Settings | `docs/screenshots/release/settings.png` | Settings panel without secrets |
| Connections | `docs/screenshots/release/connections.png` | Connections panel without provider keys |

## Capture Rules

- Capture from the release build or from the exact source commit described by the
  release notes.
- Use seeded or disposable data only.
- Redact provider keys, account identifiers, private chat text, local usernames,
  file paths, and server URLs that should not be public.
- Prefer windows wide enough to show the primary workflow without cropping
  controls.
- Keep the app theme, product name, and visible navigation consistent with the
  released build.
- If a screenshot cannot be captured, keep the placeholder copy and mention the
  blocker in the release notes.
