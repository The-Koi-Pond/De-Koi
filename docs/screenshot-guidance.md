# Screenshot Guidance

No current release screenshots are checked into this branch. Do not restore the
old screenshot set unless each image is recaptured from the current De-Koi
refactor UI.

## Required Release Captures

Use placeholders in release notes until fresh images are available:

| Slot | Placeholder copy | Capture target |
| --- | --- | --- |
| Conversation | Screenshot pending: current conversation mode | Character chat or direct-message workflow with no private content |
| Roleplay | Screenshot pending: current roleplay mode | Scene surface with character/persona context and safe sample text |
| Game mode | Screenshot pending: current game mode | Game master surface with party/state panels visible |
| Settings | Screenshot pending: current settings | Settings > Advanced showing update/remote-runtime areas without secrets |
| Connections | Screenshot pending: current provider connections | Connections panel with redacted provider details |

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
