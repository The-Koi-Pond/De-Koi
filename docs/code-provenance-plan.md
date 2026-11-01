# Code Provenance Plan

Status: tentative. Started 2026-11-02 by Xel. Team members are welcome to help,
but nobody is expected to. Progress is tracked in
[#1580](https://github.com/The-Koi-Pond/De-Koi/issues/1580).

## Goal

De-Koi began as a continuation of Marinara Engine's Tauri refactor. Much of the
code has been rewritten since, but some of it is still the code its original
contributors wrote. The goal is for all of De-Koi's code to be written by the
De-Koi team, so the team is free to make its own decisions about it later, for
example about licensing or app stores.

Until that's done, nothing changes about the license or the credit. De-Koi stays
AGPL-3.0, and [`NOTICE.md`](../NOTICE.md) keeps crediting Marinara Engine.

Not goals:

- Changing the license now. That's a separate decision, made only after the code
  is team-owned and after legal advice.
- Removing credit for where De-Koi came from.
- Dropping features or breaking existing user data.

## Measuring progress

```sh
pnpm report:provenance
```

The report blames every text file (it finds the commit that last changed each
line) and puts every line with letters or digits in one of three groups:

| Group                        | Meaning                                                              |
| ---------------------------- | -------------------------------------------------------------------- |
| team                         | Written by a De-Koi team member or a bot, before or after the split. |
| Marinara Engine contributors | Written before the split by someone outside the team.                |
| other contributors           | Written after the split by someone outside the team.                 |

The last two groups together are the code that is **not yet team-owned**. The
report lists the folders, files, and authors with the most of it.

Useful options:

- `--fast`: skips following code that moved between files. Runs in seconds
  instead of minutes, but credits moved code to whoever moved it.
- `--json <file>`: writes the full result, per file and per author, for comparing
  later runs.
- A list of paths limits the report to those paths, for example
  `pnpm report:provenance --fast src/features/shell/music`.

The team list is `TEAM_EMAILS` in
[`scripts/code-provenance.mjs`](../scripts/code-provenance.mjs). Add an email
there when a team member commits under a new one.

**The count is a map, not the finish line.** Blame credits a line to whoever
changed it last, so renaming a variable or reformatting a line moves it into the
team group without the code really being rewritten. Only modules rebuilt through
the process below count as done.

## Baseline (2026-11-02)

Full report at `adb7b18ac0`, following moved code. It covers 2,599 text files
and 521,097 lines with letters or digits.

| Group                                          |       Lines |     Share |
| ---------------------------------------------- | ----------: | --------: |
| team (and bots)                                |     380,336 |     73.0% |
| Marinara Engine contributors, before the split |     139,885 |     26.8% |
| other contributors, after the split            |         876 |      0.2% |
| **not yet team-owned**                         | **140,761** | **27.0%** |

Folders with the most code not yet team-owned:

| Folder                   | Not owned | Of lines |
| ------------------------ | --------: | -------: |
| `src-tauri/src/commands` |    31,782 |  105,747 |
| `src/features/modes`     |    21,133 |   53,589 |
| `src/features/catalog`   |    19,864 |   48,784 |
| `src/features/shell`     |     9,230 |   33,316 |
| `src/engine/generation`  |     9,080 |   58,384 |
| `src/features/runtime`   |     6,352 |   14,945 |
| `src/shared/components`  |     5,837 |   10,281 |

The largest single files are `ChatSettingsDrawer.tsx`, `crates/llm/src/lib.rs`,
`storage/commands/entities.rs`, `images/providers.rs` and `start-generation.ts`.
Three authors account for most of it. Run the report for the current numbers.

## Rebuilding a module

Work one module at a time, inside De-Koi. Everything the team has already built
stays as it is.

1. **Pick a module.** A feature or capability with a clear boundary. Start with
   the files the report ranks highest inside it.
2. **Write a behavior spec** in `docs/provenance/<module>.md`. Describe what the
   module does: user-visible behavior, inputs and outputs, edge cases, and the
   data it has to stay compatible with (storage keys, collections, chat metadata
   fields, command names, HTTP routes, file formats). Don't copy code into the
   spec, and don't write code-shaped pseudo-code that mirrors the old
   implementation.
3. **Build the replacement from the spec** and the surrounding De-Koi code,
   without the old implementation open. If an AI agent builds it, give it the
   spec and the interfaces it must plug into, not the old files. Whoever wrote
   the spec can review the result against the spec.
4. **Review the module's tests.** Keep tests that check behavior. Delete tests
   that check where code lives or how it's written, such as tests that read
   source files as text. Add behavior tests for the new module.
5. **Swap.** Delete the old files in the same change as the new module lands.
   Check that existing user data still loads and works.
6. **Log it** in the tracking issue,
   [#1580](https://github.com/The-Koi-Pond/De-Koi/issues/1580): tick the module
   and link its spec and pull request.

The specs stay in the repository. They're the record of how each replacement was
written.

## About the existing tests

Many tests from the months after the split check where code lives or how it's
written, not what it does. A quick search found 23 of 620 TypeScript test files
that read source files as text, and subtler cases won't show up in a search.
Don't treat the current tests as a definition of correct behavior. Review each
module's tests while rebuilding it (step 4) instead of auditing every test first.

## Pilot: music

Music is the first module, to test the process on something small before
taking on large areas like storage or chat settings. Mapped 2026-11-02.

### What's there

There are two music systems that share almost nothing:

- **Music Player** (agent type `music-dj`), the YouTube player. This is the
  current system, and all of it is team-owned. The `music-dj` agent returns a
  mood/intent object, the playback event bus (`src/shared/lib/music-playback-events.ts`)
  carries it to the widget (`src/features/shell/music/components/MusicMiniPlayer.tsx`),
  and the widget searches YouTube through `music_search_candidates` (yt-dlp in
  `src-tauri/src/commands/storage/integrations/music.rs`), ranks the results
  (`src/shared/lib/music-candidate-ranking.ts`) and plays the top one in an
  embedded player.
- **Spotify DJ** (agent type `spotify`), an LLM agent that calls `spotify_*`
  tools to control playback on the user's own Spotify device. It was retired
  when the Music Player replaced it (#750, 2026-07-01): it isn't in the agent
  catalog, Conversation chats filter it out, and Roleplay chats swap it for
  `music-dj`. The only part still reachable is the Conversation command
  `[spotify: title="…", artist="…"]`, for accounts connected before then.

Code not yet team-owned (`pnpm report:provenance --fast` plus line-range blame):

- `src-tauri/src/commands/storage/integrations/spotify.rs` and
  `spotify_callback.rs`: about 1,700 lines. This is most of it.
- Smaller pre-split pieces inside shared files: the Spotify fallback in
  `src/engine/agents-runtime/executor/agent-executor.ts` (about lines 603–1113),
  the `spotify_*` tool cases in `src/engine/generation/tools-runtime.ts`, and
  the Spotify connection panel in
  `src/features/catalog/agents/components/AgentEditor.tsx`.

### Decision: fold Spotify into the Music Player

Decided 2026-11-02. Retiring Spotify completely was the other option.

Don't rebuild Spotify DJ as a separate system. Make Spotify a second **provider**
inside the Music Player design. This brings Spotify back as a Music Player
source:

- One DJ agent (`music-dj`) that returns intent. No separate `spotify` agent
  type or `spotify_*` LLM tools.
- A provider turns intent into a track: YouTube (exists) or Spotify (rebuilt).
  `MusicCandidate` in `src/shared/api/music-api.ts` already allows a `"spotify"`
  provider, and `MusicGateway` in `src/engine/capabilities/integrations.ts` is
  the place for it.
- One ranking and one recently-played history for both providers. Today
  ranking is written twice (TypeScript for YouTube, Rust for Spotify) and
  history three ways.
- The Spotify provider covers only connect (sign in), search, play, pause and
  volume.

This puts the team's own design at the center and means the Spotify rebuild
is smaller than what it replaces. It removes the 500-line Spotify fallback from
the generic agent executor and the Spotify cases from the generic tool runtime.

**Open question for the Music Player's author:** does this shape fit how the
Music Player is meant to grow? The spec lists the detailed choices to review.

### Delete instead of rebuilding

- `spotify_dj_deki_playlist` / `spotify_dj_mari_playlist`: a Rust-side LLM
  playlist builder. Nothing in the app has ever called it; the only frontend
  reference is an unused wrapper in `src/shared/api/integration-utility-api.ts`.
- Game mode leftovers in the Spotify code (`gameSpotify*` metadata). These go
  when the Spotify code is replaced.

Two other unused pieces are team-owned, so they aren't part of this work. They're
listed in the spec as questions for their author: the `music_*` LLM tools (the
models are offered them, but calls return nothing), and the `music-dj-playlists`
storage collection, which nothing reads or writes.

### Must stay compatible (or migrate)

- The Spotify redirect URI `http://127.0.0.1:8754/spotify/callback` and the
  `GET /spotify/callback` server route. Users registered this URI in their own
  Spotify developer app.
- Stored Spotify sign-in data in agent settings: `spotifyClientId`,
  `spotifyAccessTokenEncrypted`, `spotifyRefreshTokenEncrypted`,
  `spotifyExpiresAt`, `spotifyScope`, and pending sign-ins in `app-settings`
  (`spotify-pending-{state}`). Keep reading these, or migrate them.
- Agent records with type `spotify` and their `enabledTools`: migrate to
  `music-dj`.
- Chat metadata `spotifySourceType`, `spotifyPlaylistId`, `spotifyPlaylistName`,
  `spotifyArtist`, `spotifyRecentTracks`: migrate to provider-neutral fields.
- UI settings `spotifyPlayerEnabled`, `spotifyMobileWidgetCollapsed`,
  `spotifyMobileWidgetPosition`. The YouTube widget uses these despite the
  names. Rename them with a migration.
- The conversation command `[spotify: title="…", artist="…"]`: keep it working,
  at least as an alias.
- The playback events `de-koi:music-playback` and `de-koi:music-ai-pick-request`.
- Character `extensions.musicProfile` (favorite songs).

### Pilot steps

1. Write `docs/provenance/music.md`: the provider-neutral behavior, the Spotify
   provider's behavior, and the compatibility list above.
2. Agree on the spec with the Music Player's author.
3. Delete the playlist builder, in its own change.
4. Build the Spotify provider from the spec, without the old `spotify.rs` open.
5. Move the remaining Spotify behavior out of the generic executor and tool
   runtime, review the music tests (step 4 of the process), then delete the
   old Spotify files.
6. Check with an existing Spotify connection and existing chats that sign-in,
   search and playback still work, then log the result.

## Finish line

- The report shows no meaningful code that isn't team-owned, and every module
  ticked in the tracking issue was rebuilt through the process above.
- Code from contributors outside the team who joined after the split is either
  rebuilt or covered by their written permission.
- Before changing the license or `NOTICE.md`, get legal advice.
