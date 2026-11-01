# Music: Behavior Spec

Status: draft for review. Spec written 2026-11-02 by Xel. Part of the code
provenance plan (`docs/code-provenance-plan.md`, tracked in #1580).

This spec describes what the music features must do once Spotify becomes a
second source inside the Music Player. It is the only input the builder uses
for the Spotify parts. It describes behavior, not the old implementation.

## Rules for the builder

Build from this spec and the team-owned code around it. Don't open, search, or
read the history of the old Spotify implementation:

- `src-tauri/src/commands/storage/integrations/spotify.rs`,
  `spotify_callback.rs`, `spotify_query.rs`
- the `spotify_*` commands in
  `src-tauri/src/commands/storage/commands/integrations.rs` and
  `src-tauri/src/http_dispatch.rs`
- the Spotify parts of `src/engine/agents-runtime/executor/agent-executor.ts`,
  `src/engine/generation/tools-runtime.ts`, `src/engine/generation/agent-runner.ts`
  and `src/engine/generation/connected-commands.ts`
- the Spotify connection panel in
  `src/features/catalog/agents/components/AgentEditor.tsx` and the Spotify
  source picker in `src/features/modes/shared/chat-ui/components/ChatSettingsDrawer.tsx`

You may read the Music Player code (it's team-owned) and every interface the new
code plugs into. If this spec doesn't answer a question, ask the spec writer.
Don't look at the old code to find out.

Spotify's own public Web API and OAuth documentation are fine to use.

## The shape

- **One music system: the Music Player.** It has two sources, YouTube (as today)
  and Spotify (new). The user picks the source in the Music Player module
  settings. YouTube stays the default.
- **One DJ agent: `music-dj`.** It returns intent (mood, setting, intensity,
  search query, constraints, volume) exactly as today. It never picks a
  provider-specific track ID and never calls Spotify itself.
- **The source turns intent into a track.** The Music Player asks the selected
  source for candidates, ranks them with the shared ranker
  (`src/shared/lib/music-candidate-ranking.ts`), and plays the top one.
- **There is no separate `spotify` agent type and there are no `spotify_*` LLM
  tools.**

## What stays the same

All of this is team-owned and keeps its current behavior unless this spec says
otherwise:

- The `music-dj` agent, its prompt and its output format.
- The playback event bus: `de-koi:music-playback` (cue, context, volume, stop,
  pause) and `de-koi:music-ai-pick-request`, and their detail shapes.
- The Music Player widget (toolbar, floating and mobile variants), Fresh Pick,
  typed queries and direct links, and character music cues from
  `extensions.musicProfile`.
- YouTube search and playback.

The prompt text tells the agent the music comes from YouTube. When Spotify is
the source, the wording should say "music" in general instead of YouTube. The
output format doesn't change.

## Spotify source

### Connecting an account

The user brings their own Spotify developer app, as today.

1. In the Music Player settings, the user picks Spotify as the source. The
   settings show what's needed: a Spotify developer app (Web API), the redirect
   URI to register in it, and its Client ID. They also say that playback
   control needs Spotify Premium.
2. The user enters the Client ID and presses **Connect**. Connect is disabled
   until a Client ID is entered.
3. De-Koi opens Spotify's sign-in page in the browser, using the standard
   Authorization Code flow with PKCE. There's no client secret.
4. Sign-in completes in whichever of these happens first:
   - **Desktop:** a one-time local listener on the redirect URI receives the
     callback. The browser tab then shows "Spotify connected. You can close this
     tab." or "Spotify connection failed: <reason>".
   - **Hosted server:** the server route `GET /spotify/callback` receives it.
     This route needs no login, and it accepts only GET.
   - **Paste-back:** while waiting, the settings offer "Browser couldn't reach
     the callback? Paste the address here." The user pastes the full address
     they were sent to. This always works, including on a remote server over
     plain HTTP.
5. A sign-in attempt is valid for 10 minutes and can be used once. After that,
   or on a second use, show "This sign-in has expired or was already used.
   Press Connect to try again." The settings stop waiting after 10 minutes.
6. When it succeeds, the settings show "Connected to Spotify" and the account's
   display name, if the requested scopes allow reading it.

**Redirect URI:**

- The default is `http://127.0.0.1:8754/spotify/callback`. Keep it, because
  existing users registered it in their Spotify apps.
- A server operator can override it with the `SPOTIFY_REDIRECT_URI` environment
  variable. Accept only `https://` addresses or `http://127.0.0.1` addresses,
  with no user info, no fragment and no spaces. Reject anything else at startup
  with a clear log message.

**Scopes:** request only what the source uses:

- `user-read-playback-state`
- `user-modify-playback-state`
- `user-read-currently-playing`
- `user-library-read`
- `playlist-read-private`
- `playlist-read-collaborative`

If a granted token is missing a scope the user tries to use, say which feature
needs it and offer to reconnect.

**Disconnect** removes the tokens but keeps the Client ID. It doesn't contact
Spotify. It clears any cached library data.

### Tokens

- Store the access token, refresh token, expiry and granted scopes on the
  server side only, encrypted with the app's existing connection-secret store.
  Never send tokens to the frontend.
- The Client ID isn't secret and can be shown in settings.
- Refresh the access token when it's missing or has less than 60 seconds left,
  before making the call.
- If several requests need a refresh at the same time, only one refresh may
  happen. The others wait for it and use the new token.
- If Spotify returns no new refresh token, keep the old one.
- If refreshing fails, keep the stored tokens and show "Spotify sign-in needs
  renewing. Open Music Player settings and press Connect."
- If a call gets a 401 even though the token looked valid, refresh once and
  retry once. If it still fails, show the same message.
- "Connected" means a refresh token is stored. The settings can also say
  "Connected (renews automatically)" when the access token has expired.

### Per-chat source

When Spotify is the source, a chat's settings show **Spotify music from**:

| Choice                | Meaning                                                                          |
| --------------------- | -------------------------------------------------------------------------------- |
| Liked Songs (default) | Candidates come from the user's Liked Songs.                                     |
| A playlist            | Candidates come from one chosen playlist. The picker lists the user's playlists. |
| An artist             | Candidates come from a catalogue search limited to that artist.                  |
| Anything              | Candidates come from a catalogue search.                                         |

More rules:

- If a playlist or artist choice is missing its value, use Liked Songs.
- Playlists the account can't read (often playlists it follows but doesn't own)
  are labeled "(can't be read)" and can't be picked. If a chosen playlist
  becomes unreadable, show "Spotify won't let De-Koi read this playlist. Pick a
  playlist this account owns." and use Liked Songs for that pick.
- A new Roleplay scene copies the chat's music source, as it does with other
  chat settings.

### Choosing a track

The Music Player builds a search text from the cue: query, mood, setting and
constraints.

**Liked Songs and playlists:**

- Load the whole source, up to 2,500 tracks.
- Keep it in memory for 20 minutes per account and source, holding at most 24
  sources. Clear it on connect and disconnect.
- Keep the tracks that match the search text. A match in the title counts most,
  then the album, then the artist. Ignore case, accents and common filler words.
  Mood words should also match related words: a "battle" cue matches "fight" or
  "war", and a "calm" cue matches "peaceful" or "gentle".
- If too few tracks match, fill up with tracks spread evenly across the source.
  Start at a different point each time, so repeated picks vary.
- Hand the shared ranker at most 50 candidates.

**Artist and Anything:**

- Run a Spotify catalogue search for the search text, limited to the artist for
  the artist choice. Hand the shared ranker at most 20 candidates.

**For every source:**

- Candidates are `MusicCandidate` values with `provider: "spotify"`, the track
  URI as `id`, title, artist names as `channelOrArtist`, album art as
  `thumbnail`, and the duration.
- Recently played tracks are avoided (see below). If avoiding them leaves
  nothing, allow them.
- Fresh Pick skips the current track and the recent tracks, as it does for
  YouTube.

### Recently played

One history for both sources, stored per chat in chat metadata as
`musicRecentTracks`:

- It's a list of `{ provider, id }`, newest first, with duplicates removed,
  keeping 24.
- Add a track when playback of it is confirmed or accepted.
- The ranker avoids every track in the list when there are enough other
  candidates.
- For a chat without a history yet, read the old `spotifyRecentTracks` and
  `gameRecentSpotifyTracks` values as Spotify entries.
- The widget's current in-memory YouTube history (last 8) moves to this list,
  so it survives remounts and reloads.

### Playback

Playback happens on one of the user's Spotify devices, not inside De-Koi.

- **Which device:** the device that is currently playing. Otherwise the device
  Spotify reports as active. Otherwise, if the user picked a preferred device in
  Music Player settings and Spotify lists it, that device. Otherwise show "Open
  Spotify on the device you want to use, then try again."
- **Play:**
  - Start the chosen track on that device and set it to repeat, so the scene
    music loops the same way the YouTube player loops.
  - Then check for up to about 5 seconds that the device is playing that track.
  - If it isn't, try once more by transferring playback to the device and
    starting the track again.
  - If it still can't be confirmed but Spotify accepted the request, treat it
    as playing and show "Spotify accepted the track; waiting for <device>."
- **Pause and resume:** pause and resume on the device.
- **Stop:** pause on the device and clear the widget's now-playing state.
- **Volume:** set the device volume, from 0 to 100. If the device doesn't allow
  remote volume, show "This Spotify device doesn't allow volume control from
  De-Koi." and keep playing.
- **The widget** shows the track De-Koi started (title, artist, album art) with
  pause/resume, stop, volume and Fresh Pick. It doesn't embed a player. It
  refreshes the playback state from Spotify when it opens and after each
  control. While it's visible it refreshes at most every 15 seconds, so it
  notices when the user changed tracks in the Spotify app.
- **Premium:** if Spotify rejects a playback call because Premium is required,
  show "Playback control needs Spotify Premium." Searching and reading the
  library still work.

### Errors and limits

- Every Spotify call times out after 15 seconds. Show "Spotify didn't answer.
  Check your connection and try again."
- On HTTP 429, wait as long as `Retry-After` says (at most 5 seconds) and retry
  once. If that also fails, show "Spotify is limiting requests right now. Try
  again in a minute."
- Every error shown to the user names the next step, following the rest of the
  app.
- A failed pick never breaks the chat reply. The music cue fails on its own and
  the widget shows the message.

## The `[spotify: …]` command

Conversation characters can still use `[spotify: title="…", artist="…"]`:

- Both values are required. Straight and curly quotes are both accepted, and a
  `]` inside a quoted value doesn't end the command. The command is removed
  from the displayed message.
- It's offered to the model only when Spotify is the Music Player source and an
  account is connected.
- It searches for the title and artist, takes the best match, and plays it on
  repeat using the same device rules as above. The track becomes the widget's
  now-playing track and goes into the recent history.
- Failures show as a command error on the message: "Spotify didn't find
  '<title>' by <artist>.", the device message above, or "Spotify isn't
  connected. Open Music Player settings to connect it."

## Saved data

| Today                                                                                                                                                                                                                                                             | After                                                                                                                                                                                                            |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Client ID and encrypted tokens on the legacy `spotify` agent record's settings (`spotifyClientId`, `spotifyAccessTokenEncrypted`, `spotifyRefreshTokenEncrypted`, `spotifyExpiresAt`, `spotifyScope`, and old plain `spotifyAccessToken` / `spotifyRefreshToken`) | Moved once to the Music Player's Spotify settings, still encrypted. Plain tokens are encrypted on the move. If a legacy record has tokens, Spotify becomes the Music Player source, so those users keep working. |
| Pending sign-ins in `app-settings` (`spotify-pending-<state>`)                                                                                                                                                                                                    | Pending sign-ins under a key the new code owns. Old pending records can be ignored: they're at most 10 minutes old.                                                                                              |
| Legacy `spotify` agent records                                                                                                                                                                                                                                    | Left in place, but disabled and hidden, after their credentials are moved. Chats listing `spotify` in `activeAgentIds` use `music-dj`, as Roleplay already does.                                                 |
| Chat metadata `spotifySourceType`, `spotifyPlaylistId`, `spotifyPlaylistName`, `spotifyArtist`                                                                                                                                                                    | Read as the chat's Spotify source when the chat has no new value. New values go under a `musicSpotifySource` object.                                                                                             |
| Chat metadata `spotifyRecentTracks`, `gameRecentSpotifyTracks`                                                                                                                                                                                                    | Read into `musicRecentTracks` (see above).                                                                                                                                                                       |
| UI settings `spotifyPlayerEnabled`, `spotifyMobileWidgetCollapsed`, `spotifyMobileWidgetPosition`                                                                                                                                                                 | Renamed to `musicPlayer…` names. The old values are read once and then removed.                                                                                                                                  |
| Module ID `spotify-mini-player`                                                                                                                                                                                                                                   | Still read as `music-dj-mini-player`, as today.                                                                                                                                                                  |

The `spotify_*` Tauri commands and remote-runtime names don't need to stay,
because the frontend and the server ship together. Spotify operations go through
the Music Player's commands with a `provider` value, following the
`music_*` commands and the explicit HTTP pipeline in `AGENTS.md`.

## Removed

- The `spotify` agent type's prompt, its six `spotify_*` LLM tools, and the
  fallback that played tracks when that agent returned intent without calling
  tools.
- The `<spotify_dj_constraints>` prompt block and the `_spotifyDjConstraints`
  memory key. The `music-dj` constraints keep only what is provider-neutral.
- The Spotify connection panel in the agent editor.
- The "Assistant DJ" playlist builder (`spotify_dj_deki_playlist` /
  `spotify_dj_mari_playlist`). Nothing ever called it.
- Unused Spotify operations: next/previous track, shuffle, raw access token,
  and listing devices outside the preferred-device setting.

## Questions for the Music Player's author

1. **Fold shape.** Does Spotify as a source inside the Music Player, chosen in
   module settings, fit where the player is going?
2. **Persisted recent history.** Moving YouTube's in-memory "last 8" into
   per-chat `musicRecentTracks` (24 entries) changes YouTube behavior slightly:
   picks also avoid songs from earlier sessions. OK?
3. **Instrumental preference.** The shared ranker prefers instrumental and
   background tracks and penalizes vocals. With Liked Songs, most candidates
   will have vocals. Keep the preference for Spotify, or turn it off when
   the source is Liked Songs or a playlist the user chose?
4. **`music_*` LLM tools** (`music_get_current_playback`,
   `music_resolve_candidates`, `music_play`, `music_set_volume`,
   `music_feedback`). They're offered to `music-dj` and, when chat tools are on,
   to the main reply model, but nothing executes them, so calls return nothing.
   Build them, or remove them? This spec doesn't need them either way.
5. **`music-dj-playlists` collection.** It's registered but nothing reads or
   writes it. Keep it for a planned feature, or remove it?

## Acceptance checks

- With YouTube as the source, everything behaves as before, apart from the
  persisted history (question 2).
- A user who connected Spotify before this change opens the app after updating
  and finds Spotify selected and connected, without reconnecting.
- Connecting works through the local listener, the server route and paste-back.
  An expired or reused sign-in shows the expiry message.
- Two requests that both need a token refresh cause exactly one refresh.
- For each chat source (Liked Songs, playlist, artist, anything), a cue plays a
  matching track from that source and records it in `musicRecentTracks`.
- Fresh Pick never repeats the current track and avoids recent ones when
  alternatives exist.
- No active device, a non-Premium account, a device without volume control, a
  timeout and a 429 each show their message, and the chat reply still arrives.
- `[spotify: title="…", artist="…"]` plays on repeat and shows in the widget. It
  isn't offered when Spotify isn't the source or isn't connected.
- No code path offers `spotify_*` tools to any model.
- The embedded app and the hosted server behave the same, including sign-in
  through the server route.
