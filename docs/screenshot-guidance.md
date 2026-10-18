# Screenshot Guidance

The README screenshots live in `docs/screenshots/readme/`. They are taken by a script from the current build with an
invented demo cast, so they can be retaken in one command whenever the UI changes.

## Retake the screenshots

```sh
pnpm build
cargo build --manifest-path src-tauri/Cargo.toml --bin de-koi-server
pnpm docs:readme-screenshots
```

The script starts `de-koi-server` on a throwaway data folder, serves `dist/` in front of it, seeds the demo cast and
chats, and writes:

| Image                | Shows                                                                  |
| -------------------- | ---------------------------------------------------------------------- |
| `roleplay.jpg`       | The Halcyon roleplay with its background (also the README's top image) |
| `conversation.png`   | The Wren conversation                                                  |
| `fanfic-request.png` | The fanfic request form, filled in from the demo fic's saved request   |
| `fanfic-reader.png`  | The demo fic in the reader, with its title card and tools              |
| `phone.jpg`          | The same three chats on a phone-sized screen, side by side             |

It needs no model, API key, or network: the chats are replayed from `docs/screenshots/demo/chats.json`. Set
`DE_KOI_SERVER_BIN` if your server binary is not in `$CARGO_TARGET_DIR/debug` (or `src-tauri/target/debug`).

Retake them when a change visibly alters these screens, and commit the new PNGs with that change. Look at every image
at full size before committing: a dialog, toast, or error state in a screenshot is a bug in the screenshot.

## The demo cast and chats

- Characters, persona, and background: `scripts/readme-screenshots/cast.mjs`. All original; portraits and the
  background are public-domain paintings credited in `docs/screenshots/demo/CREDITS.md`.
- Chats: `docs/screenshots/demo/chats.json`. These were written by a real model (Claude Opus 5.5) through the app.
  To re-record them, run a local `de-koi-server` with a working connection, seed the cast, chat through the app, then
  save the chats with:

  ```sh
  node scripts/readme-screenshots/export-demo.mjs --runtime http://127.0.0.1:8787 --chats "Wren,Aunt Vera,The Halcyon,Before the Lamps Are Lit"
  ```

## Rules

- Demo data only. Never capture real chats, provider keys, account names, file paths, or private server URLs.
- Any new demo art must be public domain or otherwise clearly free to publish, and credited in `CREDITS.md`.
- Keep the default theme and window sizes so the set stays consistent.
