# Review notes: settled findings

Things code reviews have raised that were checked and deliberately left as
they are, so later reviews don't report them again. **Reviewers: read this
before reporting.** Only raise a finding listed here again if its "Reopen
if" condition has happened, or you can show the reason no longer holds, and
say which.

Real bugs waiting to be fixed are tracked as issues or in the maintainers'
own notes, not here.

## Not bugs (checked, the claim doesn't hold)

- **Removing `spotify` from `HIDDEN_COMMAND_RE` makes `[spotify: …]` tags
  show up in chat.** It doesn't. That pattern
  (`src/engine/generation/conversation-context-focus.ts`) only skips old
  replies when picking voice examples for the prompt. The tag is removed
  from the shown and saved text by `character-commands.ts`, whether or not
  Spotify is connected. Review of PR #1584, 2026-11-02 (commit
  `964c2b3f`). Reopen if: the displayed message starts reading from that
  pattern.

## Not worth changing (real, but too small or too unlikely)

- **Encrypted Spotify tokens appear in raw storage reads and profile
  exports.** The `music-spotify-account` row in `app-settings` holds
  `accessTokenEncrypted` and `refreshTokenEncrypted`, and generic
  `storage_get` / profile export don't mask them. They can't be decrypted
  without the data folder's secrets key, which is never exported or served.
  The GIPHY key is stored the same way. Review of PR #1584, 2026-11-02.
  Reopen if: the secrets key becomes exportable or reachable over HTTP, or
  tokens are ever stored unencrypted.
- **`percent_decode` in `music_spotify/auth.rs` doesn't decode a `%XX` at
  the very end of a value** (`index + 2 < len` should be `<=`). Spotify's
  `code` and `state` values are URL-safe and never end in an escape, so it
  has no effect. Review of PR #1584, 2026-11-02. Reopen if: the parser is
  reused for values that can contain escapes.

- **A DJ cue asking for exactly the widget's current volume isn't sent to
  Spotify.** Spotify picks only send a volume that differs from the widget's
  (`MusicMiniPlayer.tsx`), because Fresh Pick passes the widget volume to the
  DJ and would otherwise reset the device on every pick. When the widget's
  number is stale (Spotify was idle at open, or changed in the Spotify app
  within 15 s), the first DJ pick plays at the device's own volume. It
  corrects itself at the next 15 s status refresh. Review of PR #1584 fixes,
  2026-11-02 (commit `31bd5894`). Reopen if: DJ volume changes are reported
  as ignored.
- **A pending character cue can show its YouTube link in the search box with
  Spotify selected.** The box text uses the on-screen source, which may not
  have loaded yet. The pick itself reads fresh settings and searches the
  title on Spotify. Cosmetic. Review of PR #1584 fixes, 2026-11-02. Reopen
  if: a later manual Fresh Pick is seen searching a URL on Spotify.

- **Encrypted legacy Spotify tokens that can't be decrypted stay in the old
  `spotify` agent record.** The migration only strips tokens once a sign-in
  has moved. If the old refresh token can't be decrypted and there's no
  plain copy, nothing moves and the unreadable ciphertext stays. Without
  the key it's useless. Review of PR #1584 fixes, 2026-11-02 (commit
  `257182ac`). Reopen if: the record is ever shown or exported in a way
  that makes it look like a live credential.

## Chosen behaviour (looks odd, decided on purpose)

- **Recently played tracks sink on every Music Player pick, typed searches
  included,** so typing the song you just heard can pick a different
  version. `docs/provenance/music.md` asks for this (decision 2 and "the
  ranker avoids every track in the list"). Kept on 2026-11-02, to be
  changed if it bothers someone in real use. Reopen if: users report it.
