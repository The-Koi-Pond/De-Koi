# Bot Browser: Behavior Spec

Status: agreed 2026-11-18 (all decisions as recommended). Part of the code provenance
plan (`docs/code-provenance-plan.md`, tracked in #1580).

This spec describes what the Bot Browser screen must do: finding characters on
outside sites and importing them. It is the only input the builder uses for the
screen. It describes behavior, not the old implementation.

## Rules for the builder

Build from this spec and the team-owned code around it. Don't open, search, or
read the history of the old implementation:

- `src/features/shell/bot-browser/components/BotBrowserView.tsx`
- `src/features/shell/bot-browser/components/BotBrowserPanel.tsx`
- `src/features/shell/bot-browser/api/bot-browser-api.ts`
- `src/shared/api/bot-browser-command-api.ts`
- `src/features/shell/bot-browser/shell.ts`

You may read every interface listed under "Neighbors", including the Rust side
(`src-tauri/src/commands/storage/bot_browser.rs`), which isn't rebuilt here.
`bot-browser-api.ts` has two team-owned pieces (the JannyAI browser fallback and
the import result type); both are described below, so rewrite them from this
spec rather than opening the file. If this spec doesn't answer a question, ask
the spec writer.

**Safety.** This screen sends requests to outside sites and writes characters
through the import command, so the plan's safety rules 2, 4 and 5 apply:

- Before the old files are deleted, someone other than the builder records the
  old screen as a black box: for each provider, the exact path and query it
  sends for a set of searches, the card it shows for a recorded response, the
  detail it shows, and the body it sends to `import_st_character`. The
  recordings become tests (see "Tests"). The builder sees the recordings, never
  the old code.
- The rebuild keeps every provider request and every import body exactly as
  described here. Decisions that would change either are marked "follow-up" and
  go in their own pull request after the rebuild.
- Independent checks (tests, spec coverage, odd input) before merging.

## Scope

Lines not yet team-owned, from `pnpm report:provenance --fast` at `c724819731`:

**Replaced, then deleted:**

| File                                                            | Not owned | Of lines |
| --------------------------------------------------------------- | --------: | -------: |
| `src/features/shell/bot-browser/components/BotBrowserView.tsx`  |     2,238 |    2,471 |
| `src/features/shell/bot-browser/components/BotBrowserPanel.tsx` |       111 |      178 |
| `src/features/shell/bot-browser/api/bot-browser-api.ts`         |        64 |      108 |

**Rewritten in place:**

| File                                        | Not owned | Of lines |
| ------------------------------------------- | --------: | -------: |
| `src/shared/api/bot-browser-command-api.ts` |         4 |        4 |
| `src/features/shell/bot-browser/shell.ts`   |         2 |        2 |

That's **2,419 lines** not yet team-owned. The view is one large file holding
six provider adapters, the screen, the login dialog, the card tile, the detail
view and a PNG card writer.

**Tests:** none exist for the view, panel or API file (they were removed long
ago). The folder's two team-owned tests stay (see "Tests").

### Neighbors (not rebuilt)

- **Mounting:** `AppShell.tsx` lazy-loads `BotBrowserView` from
  `bot-browser/shell.ts` inside `MountOnceWhenOpened` (it stays mounted after
  the first open, so its state survives closing and reopening).
  `right-panel-loaders.ts` lazy-loads `BotBrowserPanel` from the same file for
  the `bot-browser` right panel. Keep both export names (or update the two
  imports).
- **UI store:** `botBrowserOpen`, `openBotBrowser`, `closeBotBrowser`,
  `openCharacterDetail`. Opening the Browser closes detail views and the
  character library (store-owned).
- **Other ways in:** the Characters panel's "Browse online" button
  (`CharactersPanel.tsx`) and Discover's links to the `bot-browser` panel
  (`discovery-registry.ts`, `scripts/check-discovery-metadata.mjs`).
- **Team-owned files in the folder** (keep and use):
  `BotBrowserAssetImage.tsx` (lazy proxy images; it imports
  `fetchBotBrowserAssetBlob` from the API file, so keep that export and its
  `(src) => Promise<Blob>` use), `lib/asset-image-cache.ts`,
  `lib/character-detail-merge.ts` (`mergeCharacterDetailIntoCharacterJson`) and
  `types/provider-responses.ts` (the response shapes named below).
- **Runtime:** `invokeTauri` (`tauri-client`); `remote-runtime.ts` lists
  `bot_browser_get` and `bot_browser_post` as remote commands, so hosted
  installs reach the same Rust code over HTTP.
- **Rust (later, riskier module):** `src-tauri/src/commands/storage/bot_browser.rs`,
  its facade `commands/storage/commands/bot_browser.rs` and the
  `http_dispatch.rs` cases. They fetch from the outside sites, store the
  Pygmalion token and CharacterTavern cookie encrypted, and handle the JannyAI
  search token. Unchanged. It also serves routes this screen never calls
  (`janny/search` GET, `chartavern/top-tags`, `wyvern/search-users`,
  `wyvern/characters/user/{id}`, `datacat/creator/{id}` and
  `datacat/creator/{id}/characters`); leave them for that module.
- **Import:** `importApi.stCharacterJson` (the `import_st_character` command;
  its normalization in `imports/normalization.rs` writes the saved record),
  `parsePngCharacterCard`, `confirmEmbeddedLorebookImport`,
  `readEmbeddedLorebookFromCharacterPayload`, `hasLorebookEntries`,
  `importRegexScriptsForCharacter`, `offerCardLintReview`,
  `cacheCharacterListRecordFromResult`, `invalidateCharacterCollectionQueries`,
  `lorebookKeys.all`.
- **Other pieces:** `saveFileToUserSelectedLocation`, `toUserMessage`,
  `loadUrlBlob`, `useCharacterSummaries`, `CharacterAvatarImage`,
  `characterAvatarUrl`, `useStartChatFromCharacter`, `ContextMenu`, `toast`
  (sonner), the query client.

### Same word, different feature

The Imports panel (`features/shell/imports`) and the character library's import
dialog use the same `import_st_character` command for files; they aren't part of
this screen. The title bar's `webMode` prop is driven by `botBrowserOpen` but
belongs to the title bar.

## The shape

- **Two pieces:** the full-page **Browser** (search one site at a time, look at
  a character, import it) and the **sidebar panel** (the characters already
  imported from it, and a button to open the Browser).
- **Six providers** behind one screen: ChubAI, JannyAI, CharacterTavern,
  Pygmalion, Wyvern and DataCat. Each provider is a small adapter with the same
  parts: its settings (sorts, page size, filters, NSFW mode), a search, a detail
  fetch, and how its results become cards. One shared screen renders all of
  them. Keep that shape: no provider name checks scattered through the screen
  beyond what the provider's own settings say.
- **Every outside request goes through the Rust paths** below, except the
  JannyAI browser fallback. Nothing else talks to the sites.
- **Layers:** the provider adapters and the PNG card writer are plain
  TypeScript with no React (a `lib` or `providers` folder inside
  `bot-browser`); the screen, dialogs and panel are components; the command
  wrapper stays in `src/shared/api`.

## The Rust contract

The screen calls exactly two commands:

- `bot_browser_get` with `{ path }`
- `bot_browser_post` with `{ path, body }` (`body` is `null` when there is none)

`path` always starts with `/bot-browser/`; the screen adds it when a caller
passes a bare path like `chub/search?...`. Query strings are URL-encoded form
values (spaces as `+`); parameter order doesn't matter. Values in braces are
filled in as described; "raw" means inserted as is, "encoded" means
URL-component encoded.

**Binary responses** (avatars, PNG downloads) come back as
`{ base64, mimeType }`. The screen also accepts `data`, `body` or a plain
string for the bytes, `contentType` or `type` for the type, and a `data:` URL
in any of them (its own type wins). Anything else is treated as JSON text.

**Proxy image sources:** a card's picture is the string `tauri-api:` followed
by a Rust path (for example `tauri-api:/bot-browser/chub/avatar/{fullPath}`).
`BotBrowserAssetImage` resolves these through `fetchBotBrowserAssetBlob`, which
fetches the path and returns its Blob; a source without the prefix is loaded
as an ordinary URL.

| Method | Path                                                | Sent                                                           | Used for                    |
| ------ | --------------------------------------------------- | -------------------------------------------------------------- | --------------------------- |
| GET    | `chub/search?{query}`                               | see ChubAI                                                     | ChubAI search               |
| GET    | `chub/character/{fullPath}`                         | `fullPath` raw (contains `/`)                                  | ChubAI detail               |
| GET    | `chub/avatar/{fullPath}`                            | raw                                                            | ChubAI picture              |
| GET    | `chub/download/{fullPath}`                          | raw                                                            | ChubAI card PNG             |
| POST   | `janny/search`                                      | body `{ payload: <multi-search body> }`                        | JannyAI search              |
| GET    | `janny/token?force=true`                            | only for the browser fallback                                  | JannyAI search token        |
| GET    | `janny/character/{id}?slug=character-{slug}`        | `id` raw; slug rule below                                      | JannyAI detail              |
| GET    | `janny/avatar/{avatar}`                             | the hit's `avatar`, raw                                        | JannyAI picture             |
| GET    | `chartavern/search?{query}`                         | see CharacterTavern                                            | CharacterTavern search      |
| GET    | `chartavern/character/{author}/{slug}`              | the two parts of the card's path, raw                          | CharacterTavern detail      |
| GET    | `chartavern/avatar/{path}`                          | raw                                                            | CharacterTavern picture     |
| GET    | `chartavern/download/{path}`                        | raw                                                            | CharacterTavern card PNG    |
| GET    | `chartavern/session`                                | returns `{ active }`                                           | session check on open       |
| POST   | `chartavern/set-cookie`                             | body `{ cookie }` (the text box as typed)                      | log in                      |
| GET    | `chartavern/validate`                               | returns `{ valid, reason, hasNsfw }`                           | log in                      |
| POST   | `chartavern/logout`                                 | no body                                                        | log out                     |
| GET    | `pygmalion/search?{query}`                          | see Pygmalion                                                  | Pygmalion search            |
| GET    | `pygmalion/character?id={id}`                       | `id` raw                                                       | Pygmalion detail            |
| GET    | `pygmalion/avatar/{src}`                            | encoded when `src` starts with `http`, else raw                | Pygmalion picture           |
| GET    | `pygmalion/session`                                 | returns `{ active, hasToken }`                                 | session check on open       |
| POST   | `pygmalion/set-token`                               | body `{ token }` (the text box as typed)                       | log in                      |
| GET    | `pygmalion/validate`                                | returns `{ valid, reason }`                                    | log in                      |
| POST   | `pygmalion/logout`                                  | no body                                                        | log out                     |
| GET    | `wyvern/search?{query}`                             | see Wyvern                                                     | Wyvern search               |
| GET    | `wyvern/character/{id}`                             | `id` raw                                                       | Wyvern detail               |
| GET    | `wyvern/avatar/{src}`                               | encoded when `src` starts with `http`, else `{src}/public` raw | Wyvern picture              |
| GET    | `datacat/tags`                                      | no query                                                       | DataCat tag names           |
| GET    | `datacat/fresh?sortBy=score&limit24=80&limitWeek=0` | fixed                                                          | DataCat Fresh               |
| GET    | `datacat/recent?{query}`                            | see DataCat                                                    | DataCat search              |
| GET    | `datacat/download/{id}`                             | encoded                                                        | DataCat detail (first try)  |
| GET    | `datacat/character/{id}`                            | encoded                                                        | DataCat detail (second try) |
| GET    | `datacat/avatar/{src}`                              | encoded when `src` starts with `http`, else raw                | DataCat picture             |

`set-token`, `set-cookie` and the other calls return `{ ok }` on success; a
rejected value comes back as a command error with a worded reason.

### The JannyAI browser fallback

When `POST janny/search` fails because the site blocked the app (the error's
`details.code` is `upstream_blocked`, or its text mentions "cloudflare" in any
case), the screen fetches a fresh token with `GET janny/token?force=true`, then
sends the same multi-search body itself, from the web view, as a `POST` to
`https://search.jannyai.com/multi-search` with headers `Accept: */*`,
`Content-Type: application/json`, `Authorization: Bearer <token>` and
`x-meilisearch-client: Meilisearch instant-meilisearch (v0.19.0) ; Meilisearch JavaScript (v0.41.0)`.
No token: "JannyAI search token is unavailable". A non-OK reply: "JannyAI
browser fallback returned <status>". Any other first failure is raised as is.

## Providers

Each provider below lists its id (a stored contract: it keys the saved browser
settings and the `_botBrowserSource` marker), display name, switcher icon,
"View on" site name, page size, sorts (value, label, group), filters, NSFW mode,
the search request, how results become cards, the detail fetch, and links.

**A card** has: id, name ("Unnamed" when empty), creator, tagline, tags,
picture source, up to three stats (each a number, label and icon: star,
download, heart, eye, message or hash; a stat shows only when its number is
above 0 and it has a label), an NSFW flag, the outside link, and the raw hit
(kept for the detail fetch).

**A detail** may have: description, personality, scenario, first message,
example dialogs, alternate greetings, creator notes, system prompt,
post-history instructions, character version, provider extensions, "has a
lorebook", and the embedded lorebook. A fetch that throws is an error (shown
with Retry); a successful fetch with nothing usable is "no detail".

"Stripped" text has HTML tags removed. "First 200" keeps the first 200
characters.

### ChubAI

- Id `chub`, name "ChubAI", icon "✦", site "Chub", page size 48, default sort
  `popular_all`. The default provider.
- **Sorts** (value: label, group; then what it sends as `sort`, days and
  special mode):

  | Value           | Label                   | Group     | `sort`             | Days | Special mode |
  | --------------- | ----------------------- | --------- | ------------------ | ---: | ------------ |
  | `popular_all`   | 👑 Most Downloaded      | Popular   | `download_count`   |    0 |              |
  | `popular_week`  | 🔥 Hot This Week        | Popular   | `download_count`   |    7 |              |
  | `popular_month` | 📈 Hot This Month       | Popular   | `download_count`   |   30 |              |
  | `rated_week`    | ⭐ Top Rated (Week)     | Quality   | `star_count`       |    7 |              |
  | `rated_all`     | ⭐ Top Rated (All Time) | Quality   | `star_count`       |    0 |              |
  | `newest`        | 🆕 Newest               | Discovery | `id`               |   30 |              |
  | `updated`       | 🔄 Recently Updated     | Discovery | `last_activity_at` |    0 |              |
  | `recent_hits`   | 🌟 Recent Hits          | Discovery | `default`          |    0 | `newcomer`   |
  | `random`        | 🎲 Random               | Discovery | `random`           |    0 |              |

  An unknown sort value uses `popular_week`'s settings.

- **Filters:** "Character must have" Image Gallery (`images`), Lorebook
  (`lore`), Expressions (`expressions`), Alt Greetings (`greetings`); sort
  direction; min and max tokens. NSFW: free toggle.
- **Search query:** `q` (always, may be empty), `page` (1-based), `nsfw`
  (`true`/`false`). With search text: `sort` from the sort's row unless it is
  `default`; no days or special mode. Without search text: `sort` always (also
  `default`), `max_days_ago` when days are above 0, `special_mode` when set.
  Then `asc=true` when ascending; `tags` and `excludeTags` (names joined by
  commas) when any; `min_tokens` and `max_tokens` (as typed) when not empty;
  `require_images`, `require_lore`, `require_expressions`,
  `require_alternate_greetings` as `true` when checked.
- **Response** (`ChubSearchResponse`): nodes and cursor from `data`, else the
  top level. Total: with a cursor, (page + 1) × 48; without, (page − 1) × 48 +
  the nodes on this page.
- **Card:** id `fullPath`; name `name`; creator the first segment of
  `fullPath`; tagline `tagline`; tags `topics`; picture
  `chub/avatar/{fullPath}`; stats Stars (`starCount`, star), Chats (`nChats`,
  message), Tokens (`nTokens`, hash); NSFW `nsfw`; link
  `https://chub.ai/characters/{fullPath}`.
- **Detail:** `GET chub/character/{fullPath}`; the node is `data.node`, else
  `node`; none is "no detail". From its `definition`: description ←
  `personality`, personality ← `tavern_personality`, scenario ← `scenario`,
  first message ← `first_message`, example dialogs ← `example_dialogs`,
  alternate greetings ← `alternate_greetings` (an empty list when missing),
  creator notes ← `description`, system prompt ← `system_prompt`, post-history
  instructions ← `post_history_instructions`, character version ←
  `character_version`, provider extensions ← `extensions`, embedded lorebook ←
  `embedded_lorebook` (has a lorebook when it's set). Empty strings count as
  missing.
- **Import:** PNG (see "Importing").

### JannyAI

- Id `janny`, name "JannyAI", icon "🤖", site "JannyAI", page size 80, default
  sort `newest`.
- **Sorts:** `newest` "🆕 Newest" (Date, `createdAtStamp:desc`), `oldest`
  "🕐 Oldest" (Date, `createdAtStamp:asc`), `tokens_desc` "📊 Most Tokens"
  (Tokens, `totalToken:desc`), `tokens_asc` "📊 Least Tokens" (Tokens,
  `totalToken:asc`), `relevant` "🔍 Relevance" (Search, no sort). Unknown:
  as `newest`.
- **Filters:** min and max tokens; "Show Low Quality" (`showLowQuality`,
  icon 🚫). No sort direction. NSFW: free toggle.
- **Tags** are numbers on JannyAI. The fixed map (id: name): 1 Male, 2 Female,
  3 Non-binary, 4 Celebrity, 5 OC, 6 Fictional, 7 Real, 8 Game, 9 Anime,
  10 Historical, 11 Royalty, 12 Detective, 13 Hero, 14 Villain, 15 Magical,
  16 Non-human, 17 Monster, 18 Monster Girl, 19 Alien, 20 Robot, 21 Politics,
  22 Vampire, 23 Giant, 24 OpenAI, 25 Elf, 26 Multiple, 27 VTuber,
  28 Dominant, 29 Submissive, 30 Scenario, 31 Pokemon, 32 Assistant,
  34 Non-English, 36 Philosophy, 38 RPG, 39 Religion, 41 Books, 42 AnyPOV,
  43 Angst, 44 Demi-Human, 45 Enemies to Lovers, 46 Smut, 47 MLM, 48 WLW,
  49 Action, 50 Romance, 51 Horror, 52 Slice of Life, 53 Fantasy, 54 Drama,
  55 Comedy, 56 Mystery, 57 Sci-Fi, 59 Yandere, 60 Furry, 61 Movies/TV. An id
  not in the map shows as "Tag <id>". Names match any case.
- **Search:** `POST janny/search` (with the fallback above). The multi-search
  body has one query: `indexUid` `janny-characters`, `q` the search text,
  `facets` `["isLowQuality", "isNsfw", "tagIds", "totalToken"]`,
  `attributesToCrop` `["description:300"]`, `cropMarker` `...`,
  `attributesToHighlight` `["name", "description"]`, `highlightPreTag`
  `__ais-highlight__`, `highlightPostTag` `__/ais-highlight__`, `hitsPerPage`
  80, `page` (1-based), `sort` only when the sort has one, and `filter`, a list
  of strings in this order: `totalToken >= <min>` (the min as a whole number,
  else 29), `totalToken <= <max>` (else 100000), `isNsfw = false` unless NSFW
  is on, `isLowQuality = false` unless Show Low Quality is on, and, when any
  included tag is in the map, one string joining `tagIds = <id>` for each with
  `AND`.
- **Tags on this side:** included tags not in the map ("custom") and excluded
  tags are checked here against each hit's tag names (any case): a hit with an
  excluded tag is dropped; a hit must have every custom tag. When either is in
  use and fewer than 80 hits are left, it fetches the next pages (at most 3
  more, not past the last page) and adds their filtered hits (decision 15).
- **Response** (`JannySearchResponse`): the first result's `hits`,
  `totalPages` (1 when missing), `totalHits`. Total: `totalHits`, else
  `totalPages` × 80.
- **Card:** id `id`; name `name`; creator `creatorUsername`; tagline
  `description` stripped, first 200; tags from `tagIds` through the map;
  picture `janny/avatar/{avatar}` when there is one; stat Tokens
  (`totalToken`, hash); NSFW `isNsfw`; link
  `https://jannyai.com/characters/{id}_character-{name slug}` where the slug is
  the lowercased name with each run of other characters than a–z and 0–9
  turned into `-` (decision 10).
- **Detail:** the slug is the same rule plus leading and trailing `-` removed.
  `GET janny/character/{id}?slug=character-{slug}`. When the reply's
  `character` has a personality or first message: description ←
  `personality`, scenario, first message ← `firstMessage`, example dialogs ←
  `exampleDialogs`, creator notes ← `description` stripped and trimmed (only
  when it is text). Otherwise the search hit's description, stripped and
  trimmed, becomes the creator notes; none is "no detail".
- **Import:** JSON (see "Importing").

### CharacterTavern

- Id `chartavern`, name "CharacterTavern", icon "🍺", site "CharacterTavern",
  page size 60, default sort `most_popular`.
- **Sorts** (no groups; sent as is): `most_popular` "🔥 Most Popular",
  `trending` "📈 Trending", `newest` "🆕 Newest", `oldest` "🕐 Oldest",
  `most_likes` "❤️ Most Liked".
- **Filters:** Lorebook (`lore`); "Original Character" (`isOC`, icon ⭐); min
  and max tokens. NSFW: needs login.
- **Search query:** `q`, `page` (1-based), `limit=60`, `sort`, `nsfw`
  (`true`/`false`); `tags`, `excludeTags` (comma-joined) when any;
  `min_tokens`, `max_tokens` when not empty and not `0`; `hasLorebook=true`;
  `isOC=true`.
- **Response** (`ChartavernSearchResponse`): `hits`. Total: `totalPages` × 60
  when given, else `totalHits`, else the hits on this page.
- **Card:** id `path`; name `name`; creator `author`, else the first segment of
  `path`; tagline `tagline`; tags `tags` (a list, else none); picture
  `chartavern/avatar/{path}` when there is a path; stats Downloads
  (`downloads`, download), Likes (`likes`, heart), Tokens (`totalTokens`,
  hash); NSFW `isNSFW`; link `https://character-tavern.com/character/{path}`.
- **Detail:** a path without two segments is "no detail". Otherwise
  `GET chartavern/character/{first}/{second}`; from `card`: description ←
  `definition_character_description`, personality ←
  `definition_personality`, scenario ← `definition_scenario`, first message ←
  `definition_first_message`, example dialogs ←
  `definition_example_messages`, creator notes ← `description`, has a lorebook
  ← `lorebookId` is set.
- **Import:** PNG.

### Pygmalion

- Id `pygmalion`, name "Pygmalion", icon "🔥", site "Pygmalion", page size 48,
  default sort `downloads`.
- **Sorts** (sent as `orderBy`): `downloads` "⬇️ Downloads", `stars`
  "⭐ Stars", `views` "👁️ Views", `approved_at` "🆕 Newest", `token_count`
  "📝 Tokens", `display_name` "🔤 Name".
- **Filters:** sort direction only. NSFW: needs login.
- **Search query:** `q`, `page` (0-based: the screen's page − 1, never below
  0), `pageSize=48`, `orderBy`, `orderDescending` (`true` unless ascending);
  `tagsInclude`, `tagsExclude` (comma-joined) when any; `includeSensitive=true`
  when NSFW is on.
- **Response** (`PygmalionSearchResponse`): `characters`; total `totalItems`
  as a whole number (text or number; 0 when missing).
- **Card:** id `id`; name `displayName`; creator `owner.username`, else
  `owner.displayName`; tagline `description`; tags `tags`; picture from
  `avatarUrl` (see the table); stats Downloads (`downloads`, download), Stars
  (`stars`, star), Chats (`chatCount`, message); NSFW `isSensitive`; link
  `https://pygmalion.chat/character/{id}`.
- **Detail:** `GET pygmalion/character?id={id}`; from `character.personality`:
  description ← `persona`, first message ← `greeting`, example dialogs ←
  `mesExample`, creator notes ← `characterNotes`, alternate greetings ←
  `alternateGreetings` without empty ones.
- **Import:** JSON.

### Wyvern

- Id `wyvern`, name "Wyvern", icon "🐉", site "Wyvern", page size 48, default
  sort `popular`.
- **Sorts** (sent as is): `popular` "🔥 Popular", `nsfw-popular`
  "🔞 Popular NSFW", `recommended` "⭐ Recommended", `created_at` "🆕 New",
  `votes` "❤️ Most Likes", `messages` "💬 Most Messages".
- **Filters shown today:** Lorebook, Alt Greetings, min and max tokens; none
  of them is sent (decision 4). NSFW: through the sort only.
- **Search query:** `page` (1-based), `limit=48`, `sort`; `q` when there is
  search text; `tags` (comma-joined) when any; `rating=none` unless NSFW is on
  or the sort is `nsfw-popular`. Excluded tags are checked here (any case).
- **Response** (`WyvernSearchResponse`): `results`. Total: `total`, else with
  `hasMore` (page + 1) × 48, else the results kept on this page.
- **Card:** id `id`; name `name`; creator `creator.displayName`, else
  `creator.username`; tagline `tagline`; tags `tags`; picture from
  `avatar_url`, else `avatar`; stats from `statistics_record`, else
  `entity_statistics`: Likes (`likes`, else `total_likes`, else the
  character's `likes`; heart), Messages (same pattern; message), Views (same;
  eye); NSFW when `rating` is set and not `none`; link
  `https://app.wyvern.chat/characters/{id}`.
- **Detail:** `GET wyvern/character/{id}` (the reply is the character):
  description, personality, scenario, first message ← `first_mes`, example
  dialogs ← `mes_example`, creator notes ← `creator_notes`, alternate greetings
  ← `alternate_greetings` without empty ones, has a lorebook ← `lorebooks` is
  not empty (decision 11).
- **Import:** JSON.

### DataCat

- Id `datacat`, name "DataCat", icon "🐱", site "DataCat", page size 80,
  default sort `relevance`. Every DataCat character is NSFW.
- **Sorts:** `relevance` "🔍 Relevance", `fresh` "🔥 Fresh".
- **Filters:** none. NSFW: locked on.
- **Tag names:** DataCat tags are numbers. Once per app session, before the
  first search, the screen loads `GET datacat/tags`: the list is the reply
  itself when it's a list, else its `tags`, else `facets`. Each entry's id is
  `id`, else `tag_id`, else `tagId`; its name `name`, else `slug`; its count
  `count`. Entries without a number id or a name are skipped. The names (any
  case) map to ids and back. While DataCat is the provider, the tag panel also
  lists the 150 most-used names. A failed load isn't remembered (the next
  search tries again) and doesn't stop the search (decision 8).
- **Search:** Fresh is used only with the `fresh` sort, no included tags that
  resolve to ids, and no search text: `GET datacat/fresh?sortBy=score&limit24=80&limitWeek=0`.
  Its list is `windows.last24h` (else `last24h`): the value itself when it's a
  list, else its `characters`. Total: the number of characters returned. When
  `fallback.partial` is true and `fallback.unavailableWindows` includes
  `thisWeek`, show the notice "DataCat Fresh is using recent-public results
  while the weekly window is unavailable." Otherwise
  `GET datacat/recent?limit=80&offset={(page − 1) × 80}` plus `tagIds` (the
  resolved ids, comma-joined) when any and `q` (trimmed) when there is search
  text; list `characters`, total `totalCount`, else the number returned.
  Unknown tag names are left out. Excluded tags are checked here by name (any
  case).
- **Card:** a character's tags are `tags`, else `tagIds`; each is a name, an id
  (looked up), or an object (`name`, else `slug`, else its id looked up);
  empty names dropped. Id `characterId`, else `character_id`, else `id`; name
  `chatName`, else `chat_name`, else `name`; creator `creatorName`, else
  `creator_name`; tagline `description` stripped, first 200; picture from
  `avatar`; stats Chats (`chatCount`, else `chat_count`; message), Tokens
  (`totalTokens`, else `total_tokens`; hash); NSFW `isNsfw`; link
  `https://datacat.run/characters/{id}`.
- **Detail:** no id is "no detail". First `GET datacat/download/{id}`: when the
  reply has `data`, description ← `description`, else `personality`;
  personality ← `personality`; scenario; first message ← `first_mes`; example
  dialogs ← `mes_example`; creator notes ← `creator_notes`; alternate greetings
  ← `alternate_greetings` without empty ones. Any failure of this first call
  falls through (it is often missing). Then `GET datacat/character/{id}` (its
  errors are shown): the character is `character`, else the reply; description
  ← `personality`, scenario, first message ← `first_message`, creator notes ←
  `description` stripped and trimmed.
- **Import:** JSON.

## The Browser

### Header

**Back** (closes the Browser), the heading "Browser", and the **provider
switcher**: a button with the provider's icon and name and a chevron, opening a
list of all six (icon, name, a check on the current one), in the order above.
On the right, "Logged in" (Pygmalion) or "Session active" (CharacterTavern)
while logged in.

**Switching provider** resets the search text, sort (to the provider's
default), direction (descending), page (1), tags (included, excluded, the tag
search and the known tag list), the tag and filter panels (closed), token
fields, filters, results, total, error, the open character and the login
dialog. NSFW becomes the provider's saved value (DataCat: on, not saved). The
tag import mode and an import in progress are kept.

**DataCat warning:** the first time in an app session the user picks DataCat,
a dialog shows instead of switching: "⚠️ DataCat is NSFW only", "Every
character on DataCat is tagged NSFW upstream, so the NSFW filter is locked on
for this provider.", **Continue to DataCat** (switches, and the dialog won't
show again this session) and **Don't continue to DataCat**; the close button
and the backdrop also cancel.

### Toolbar

- **Search box** ("Search characters..."), with a clear button while it has
  text. Typing sets page 1 (decision 9 for clearing).
- **Sort** select: the provider's sorts, in groups when they have one. Changing
  it sets page 1.
- **Tags** button (toggles the tag panel), highlighted while open or while any
  tag is in use, with the count of included plus excluded tags.
- **Filters** button, shown when the provider has features, extra toggles,
  sort direction or token filters; highlighted while open or while any feature
  or toggle is on, with that count.
- **NSFW** toggle (see "NSFW").
- **Log in** / account chip and **Logout** for login providers; for Wyvern the
  hint "Use "🔞 Popular NSFW" sort for NSFW content".
- **Refresh** (runs the search again).

### Tag panel

A side panel (about 260 px) titled "Tags", with **Clear** (while any tag is in
use; clears both lists, page 1) and a close button.

- **Tag search** box ("Search tags..."). With 2 or more characters that aren't
  already included, two buttons offer the typed text, lowercased: "+ Add
  <text> as filter" (include) and "− Block <text> from results" (exclude);
  Enter adds it as an include. Either clears the box and sets page 1.
- **In use:** included tags as green "+ tag" chips and excluded ones as red
  "− tag" chips; clicking one removes it.
- **List:** every tag seen in results for this provider (merged as results
  arrive, sorted, cleared on provider switch), plus DataCat's popular names,
  filtered by the tag search (contains, any case). Each row has an include box
  (✓ when included), the name (struck through when excluded) and an exclude box
  (−). Including removes it from excluded and the other way round; both set
  page 1. Empty: "Tags will appear after searching", or "No tags match filter".

### Filters panel

- **Character must have:** the provider's features and extra toggles as check
  boxes (label with its icon). Toggling sets page 1.
- **Advanced options:** sort direction (Descending, Ascending) when the
  provider has it; min tokens (placeholder 50) and max tokens (placeholder
  100000, labelled "Max Output Tokens" today, decision 16) when it has token
  filters. Changing any sets page 1.

### NSFW

Saved per provider (see "Saved browser settings").

- **Free** (ChubAI, JannyAI): an ordinary toggle; changing it saves and sets
  page 1. Tooltip "Toggle NSFW content".
- **Login** (Pygmalion, CharacterTavern): before logging in, the toggle is
  dimmed with a login icon; clicking it opens the login dialog (tooltip "Click
  to log in to <name> for NSFW content"). Logged in, it shows checked and
  disabled with "(account)" (tooltip "NSFW depends on your account settings"),
  whatever the saved value is (decision 14).
- **Wyvern:** disabled; clicking shows the toast 'Use the "🔞 Popular NSFW"
  sort option to browse NSFW content on Wyvern.' (tooltip 'Use the "Popular
  NSFW" sort option').
- **DataCat:** disabled and on (tooltip "DataCat is NSFW-only").

### Searching

- Any change to the provider, search text, page, sort, NSFW, tags, direction,
  token fields, features or toggles runs a search: after 400 ms while there is
  search text, at once otherwise. Refresh and Retry run it at once.
- **Only the newest search counts:** a reply for criteria that are no longer
  current is ignored (neither results nor errors nor the spinner).
- **While loading:** a spinner replaces the results.
- **Error:** the reason (`toUserMessage`, fallback "Search didn't finish. Check
  your internet connection, then try again.") and **Retry**; results cleared.
- **Notice:** a provider notice (DataCat Fresh) shows above the results with a
  warning icon.
- **Empty:** "No characters found".
- **Grid:** 2 to 6 columns by width. Each tile is a button: the picture (lazy,
  through `BotBrowserAssetImage`; a hash icon when it has none or fails), an
  "NSFW" badge, the name, "by <creator>", the tagline (two lines) and the
  stats (icon and short number: 1.2K, 3.4M; the label as tooltip).

### Pages

Total pages = the total ÷ the provider's page size, rounded up, at least 1. The
pager shows when there is more than one page or the page is past 1:
**Previous** (disabled on page 1), "Page N" (plus " of T" when T is between 2
and 8,999), **Next** (disabled when the page is at or past T and T is above 1;
decision 13).

### Detail view

Clicking a tile opens the character in place of the grid; the detail is fetched
at once (decision 1).

- **Top:** **Back to results** (closes the detail) and "View on <site>" (the
  card's link, new tab).
- **Loading:** a spinner. **Error:** the reason (fallback "Couldn't load this
  character. Check your internet connection, then try again.") and **Retry**
  (fetches again); no import buttons.
- **Left:** the picture (or a hash icon); **Imported tags** with three choices:
  All tags ("Keep source tags.", value `all`, the default), No tags ("Skip
  source tags.", `none`), Existing only ("Keep tags already in De-Koi.",
  `existing`); the choice is kept across characters and providers but not
  saved. Then **Import** ("Importing..." with a spinner, disabled while
  running), **Download as PNG** ("Building PNG..." while running), and the
  stats as "<number> <label in lowercase>".
- **Right:** the name, "by <creator>", the tagline, the first 20 tags, then the
  detail's sections when present, in this order: Creator's Notes,
  Description / Personality (the description), Personality, Scenario, First
  Message, Alternate Greetings (<count>) (each greeting in its own box),
  Example Dialogues, and "Has embedded lorebook" when it has a lorebook. With no
  detail: "No detailed definition available. You can still import this
  character with basic info."

### Importing

**Which way:** ChubAI and CharacterTavern import the site's own card PNG; the
other four build a card from the detail.

**PNG import** (ChubAI, CharacterTavern):

1. Download `chub/download/{id}` or `chartavern/download/{id}` as a Blob, make
   it a file named `character.png` (`image/png`) and read it with
   `parsePngCharacterCard` (its card JSON and its picture as a data URL).
2. The detail: for ChubAI the open detail, else fetched now (a failure here
   means no detail; the import goes on); for CharacterTavern the open detail
   only.
3. With a detail, merge it into the card JSON with
   `mergeCharacterDetailIntoCharacterJson`, adding the card's name, creator and
   tags to the detail first.
4. Ask about the embedded lorebook (`confirmEmbeddedLorebookImport` with the
   card name and the detail's embedded lorebook, else the one read from the
   merged JSON by `readEmbeddedLorebookFromCharacterPayload`).
5. Send to `importStCharacter` (`import_st_character`): the merged JSON's
   fields at the top level, plus `_avatarDataUrl` (the PNG's picture),
   `_botBrowserSource`, `importEmbeddedLorebook` (the answer) and
   `tagImportMode`.

**Built import** (JannyAI, Pygmalion, Wyvern, DataCat):

1. The detail: the open one, else fetched now (a failure means no detail).
2. Ask about the detail's embedded lorebook as above.
3. Build one flat object: `name` (card), `description` (the detail's
   description, else its personality), `personality` (its personality only
   when it also has a description, else empty), `scenario`, `first_mes`,
   `mes_example`, `creator_notes`, `system_prompt`,
   `post_history_instructions`, `character_version` (each the detail's, else
   empty), `alternate_greetings` (else an empty list), `tags` (card), `creator`
   (card), `extensions` (the detail's provider extensions plus
   `{ <provider id>: { id: <card id> } }`), `character_book` (only when the
   detail's embedded lorebook has entries), `_botBrowserSource`,
   `tagImportMode`, `importEmbeddedLorebook`.
4. When the card has a picture, fetch it and add it as `_avatarDataUrl` (a
   data URL). A failure imports without a picture (decision 6).
5. Send to `importStCharacter`.

**Both ways, after the reply:**

- `success` false: an error with the reply's `error`, else "Import failed".
- Success: toast `Imported "<name>" successfully!` (the reply's name, else
  "character" for PNG imports or the card's name), put the new character in the
  character list cache (`cacheCharacterListRecordFromResult`; when that can't,
  invalidate the character lists), invalidate the lorebook lists when the reply
  has a lorebook, offer the card check (`offerCardLintReview`), and, when the
  reply has a character with data and an id (`characterId`, else the
  character's `id`), import its embedded regex scripts
  (`importRegexScriptsForCharacter`). The card check and the regex scripts run
  in the background (decision 6).
- Any failure: toast the reason (fallback "Couldn't import this character.
  Check your internet connection, then try again.").

**The import result** the screen reads: `success`, `characterId`, `name`,
`filename`, `character` (with `id` and `data`), `lorebook` (with
`lorebookId`, or null), `embeddedLorebook` (`hasEmbeddedLorebook`, `entries`,
`imported`, `skipped`), `error`.

### Download as PNG

Builds a SillyTavern card PNG from what the screen shows (not the site's file):

1. The same fields as the built import's step 3, from the open detail and the
   card (no detail: the card's name, creator and tags, the rest empty), and the
   extensions with `{ <provider id>: { id } }`.
2. Load the card's picture (through the proxy when needed) and redraw it as a
   PNG. No picture or a picture that won't load fails with "Failed to load
   avatar image" (decision 3).
3. Add one `tEXt` chunk just before `IEND`, with a correct CRC: keyword
   `chara`, then the base64 of the UTF-8 JSON card. The card has `spec`
   `chara_card_v2`, `spec_version` `2.0`, and `data` with `name`,
   `description`, `personality`, `scenario`, `first_mes`, `mes_example`,
   `creator_notes`, `system_prompt`, `post_history_instructions`, `tags`,
   `creator`, `character_version`, `alternate_greetings` and `extensions`
   (empty strings and lists for missing fields). Decision 2 for the lorebook.
4. Save through `saveFileToUserSelectedLocation` (file name: the character's
   name with every character other than letters, digits, `_` and `-` turned
   into `_`, plus `.png`, or `character.png`; title "Export character PNG";
   filter PNG). Toast `Saved "<name>" as PNG character card!` (or `Downloaded`
   when the browser downloaded it); nothing when cancelled. A failure toasts
   the reason (fallback "Couldn't download this character. Check your internet
   connection, then try again.").

### Logins

**On open** (once per mount), check `pygmalion/session` and
`chartavern/session`. Not active while the saved login flag is on: turn it off
and toast "Pygmalion session expired — please log in again." (or
"CharacterTavern session expired — please log in again."). Active: turn the
flag on. A failed check changes nothing (decision 7).

**The login dialog** (from Log in, or the NSFW toggle before login): a
backdrop and a card; the close button and the backdrop close it.

- **Pygmalion:** title "Pygmalion Authentication" (key icon). Two notes:
  "Browsing and downloading public characters works without logging in!" and
  "Optional: Paste your auth token to enable NSFW content and access
  authenticated character data." An **Auth Token** box (three rows, monospace,
  "Paste your Pygmalion auth token here"; disabled while logged in or busy).
  "How to get your auth token" (collapsed): 1. Go to pygmalion.chat (link) and
  log in; 2. Open DevTools (F12) → Application tab → Local Storage; 3. Find the
  entry named `authn`; 4. Copy its Value (a long string, ~705 characters) and
  paste it above. Logged in: "Token active — NSFW content enabled" and **Log
  Out**; otherwise **Save & Connect** (disabled while empty or busy, spinner
  while busy). A **Website** link to pygmalion.chat.
- **CharacterTavern:** title "CharacterTavern Session" (cookie icon). The same
  first note; second: "Optional: Paste your session cookies to see
  NSFW-tagged content." A **Cookie String** box ("Paste your session cookie
  value here"). Help: 1. Go to character-tavern.com (link) and log in; 2. Open
  DevTools (F12) → Application tab → Cookies; 3. Find the `session` cookie; 4. Copy its Value and paste it above. Logged in: "Session active — NSFW
  content enabled" and **Log Out**; otherwise **Save & Connect**. A
  **CharacterTavern** link.

**Save & Connect:** post the text (`set-token` / `set-cookie`); the reply must
have `ok` (else its `error`, or "Failed to save token" / "Failed to save
cookie"); then `validate`; it must say `valid` (else its `reason`, or "Token
validation failed" / "Cookie validation failed"). Then: login flag on (saved),
close the dialog, NSFW on (saved for that provider), page 1, toast "Logged in
to Pygmalion! NSFW content enabled." or "Logged in to CharacterTavern! NSFW
content detected." (when `hasNsfw`) / "… NSFW content enabled.". A failure
toasts the reason (decision 7).

**Log out** (toolbar or dialog): post `logout`, then flag off (saved), NSFW off
(saved), page 1, toast "Logged out of Pygmalion." / "Logged out of
CharacterTavern.".

**Toolbar while logged in:** a chip "NSFW depends on your account settings" and
**Logout**; otherwise **Log In**.

## The sidebar panel

The `bot-browser` right panel.

- **Browse Online** (globe icon) opens the Browser; highlighted while it's open.
- **Search** ("Search imported..."): the name contains the text, any case.
- **List:** characters from `useCharacterSummaries` whose `data` (an object, or
  JSON text of one) has `extensions.botBrowserSource` set, in the order given.
  Each row: the avatar (`CharacterAvatarImage` with the avatar URL, file path,
  file name, `extensions.avatarCrop`, 128 px thumbnail; a person icon when
  none) and the name ("Unnamed" when empty). Clicking opens the character
  (`openCharacterDetail`).
- **Right-click** a row: a context menu with **Quick Start Roleplay** and
  **Quick Start Conversation**, each calling `startChatFromCharacter` with the
  character's id, name and mode (decision 12).
- **States:** "Loading...", "No matches" (searching), "No imported characters
  yet".

Only characters imported through this screen show here (the 4 of 11
Chub-related characters on the main install that carry the marker); older
imports without the marker don't.

## Saved data

| What                  | Exact contract                                                                                                                                        | Rule                                     |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| Source marker         | import body `_botBrowserSource` = `<provider id>:<card id>`; the importer saves it as `data.extensions.botBrowserSource`                              | Same format. The panel lists by it.      |
| Provider marker       | built imports: `data.extensions.<provider id>` = `{ id: <card id> }` (`janny`, `pygmalion`, `wyvern`, `datacat`), after the detail's extensions       | Same key and shape.                      |
| Character fields      | PNG imports: the site's card merged with the detail; built imports: the fields listed under "Importing"                                               | Same fields, same rules.                 |
| Import options        | `tagImportMode` (`all`, `none`, `existing`), `importEmbeddedLorebook` (boolean), `_avatarDataUrl` (data URL)                                          | Same names and values.                   |
| Lorebook              | `character_book` in the body; the importer creates "<name>'s Lorebook" when the user said yes                                                         | Importer-owned.                          |
| Regex scripts         | created by `importRegexScriptsForCharacter` from the imported character                                                                               | Its own contract.                        |
| Browser settings      | `localStorage` key `marinara-bot-browser`: `{ nsfw: { <provider id>: boolean }, logins: { pygmalion?: boolean, chartavern?: boolean }, lastSource? }` | Same key and shape (decision 5).         |
| Pygmalion, CT secrets | stored by Rust (`set-token`, `set-cookie`), encrypted                                                                                                 | Rust-owned; the screen never reads them. |

Provider ids (`chub`, `janny`, `chartavern`, `pygmalion`, `wyvern`, `datacat`)
are stored in the marker, the extensions and the settings, so they never
change. The settings object is read, changed and written back whole, so any
other key in it (like `lastSource`, which nothing reads or writes today) is
kept. The NSFW map only ever gets keys for providers whose toggle can change
(ChubAI, JannyAI, and the login providers on login or logout).

The importer (`import_st_character`, neighbor) also writes
`extensions.importMetadata` (card spec and embedded lorebook counts),
`altDescriptions`, the avatar files and `comment`; the screen doesn't set
those directly.

## Removed

- The provider settings nothing reads: `getAvatarUrl`, `getExternalUrl` (the
  cards carry their own picture and link) and `nsfwAvailable` (the NSFW mode
  decides).
- The detail's `extra` sections (no provider fills them), the detail view's
  `onDetailUpdate` prop and the login dialog's `provider` prop (unused).
- The abort option on the get, post and blob helpers (nothing passes one).
- The greeting lookup before the panel's context menu (decision 12).
- The header comment that lists five providers.

## Decisions

The rebuild keeps provider requests and import bodies exactly as above.
Decisions marked **follow-up** change one of those and wait for their own pull
request after the rebuild. The rest change only what the screen shows.

1. **Detail from the wrong character.** Opening a character fetches its detail
   with no check that it's still the one open (`openDetail`, view lines
   1427–1446). Open A, go back, open B before A's reply lands, and A's detail
   shows on B; Import then merges A's definition into B (the import reads the
   open detail, lines 1465 and 1501). Recommended: only the newest open's reply
   counts, like searches; a reply for a character that's no longer open is
   dropped. No change for the normal case. **Agreed.**
2. **Downloaded PNG drops the lorebook.** Download as PNG sets the card's
   `character_book` (lines 2686–2688) but the PNG writer copies a fixed field
   list without it (lines 2944–2963), so the saved file has no lorebook while
   the detail says "Has embedded lorebook". Recommended: include
   `character_book` in the PNG's `data` when it has entries. Only the user's
   exported file changes. **Agreed.**
3. **Download as PNG without a picture.** A card with no picture (JannyAI,
   Pygmalion, Wyvern and DataCat cards can have none) still offers the button,
   and it fails with "Failed to load avatar image" (lines 2690 and 2924–2931).
   Recommended: disable it with the reason "This character has no picture to
   build a PNG from." **Agreed.**
4. **Wyvern filters that do nothing.** Wyvern shows Lorebook, Alt Greetings,
   min and max tokens (lines 841–847) but its search sends none of them (lines
   858–863). Recommended: hide them for Wyvern. Requests unchanged. **Agreed.**
5. **Saved settings that break the screen.** The settings are parsed with no
   shape check (lines 227–235), and reading `nsfw[...]` or `logins[...]` throws
   when the stored value is `null`, not an object, or lacks either map (lines
   245–262), which would fail the Browser on open. Recommended: treat a missing
   or wrong part as empty, keep the key and shape, and keep unknown keys when
   writing back. **Agreed.**
6. **Import problems nobody sees.** A picture that fails to load imports the
   character without one, silently (lines 1531–1541; and the picture read has
   no error path, so a read failure leaves Import spinning). The regex scripts
   and card check only log to the console when they fail (lines 1486–1495 and
   1549–1558). A failed PNG download replaces the real reason with "Failed to
   download character card" (lines 1456–1458). Recommended: the import still
   succeeds as today, then a warning toast says what was left out ("Imported
   without its picture: <reason>", "Couldn't import its regex scripts:
   <reason>"); the picture read fails instead of hanging; the download error
   keeps its reason. Saved data unchanged. **Agreed.**
7. **Login errors.** Log out has no error handling (lines 1669–1675 and
   1703–1709): a failure leaves the flags as they were, with no message. Login
   errors show only when they're `Error` objects (lines 1663 and 1697), so
   command errors fall back to the generic text. The session checks on open
   swallow failures (lines 1235 and 1243). Recommended: worded reasons through
   `toUserMessage` for login and logout failures; a failed session check is
   logged as a warning and leaves the saved flag as is. **Agreed.**
8. **DataCat tag filters dropped quietly.** If the tag list fails to load
   (line 950) or a typed tag isn't a DataCat tag, the included tag is left out
   of the request (line 1010) and the results look filtered but aren't.
   Recommended: a notice above the results, "Some tags weren't applied:
   <names>", plus the load error when there is one. Requests unchanged. **Agreed.**
9. **Clearing the search keeps the page.** Typing sets page 1 (lines
   1930–1933); the clear button doesn't (line 1939), so clearing on page 5
   shows page 5 of the unfiltered list. Recommended: clearing also sets page 1. **Agreed.**
10. **JannyAI link.** The card's link keeps a leading or trailing `-` in the
    slug (line 596) while the detail fetch trims them (lines 605–608), so "View
    on JannyAI" can point at a page that doesn't exist for names like
    "[Ellie]". Recommended: use the trimmed slug for the link too. **Agreed.**
11. **Wyvern's lorebook.** Wyvern says "Has embedded lorebook" (line 920), but
    its detail carries no lorebook, so none is imported (lines 1526–1528).
    Recommended: say "Has a lorebook on Wyvern (not imported)" for providers
    that only flag one. **Agreed.**
12. **The quick-start greeting lookup.** Right-clicking a panel row reads the
    character's greetings before the menu opens (panel lines 95–112 and
    155–180), and a failure toasts "Couldn't load the character's greetings.",
    but `startChatFromCharacter` ignores the greetings (it uses only the id and
    mode, `use-start-chat-from-character.ts` line 17). Recommended: drop the
    lookup and open the menu at once. **Agreed.**
13. **Next past the end.** When a page comes back empty and the total works out
    to one page (ChubAI's total is (page − 1) × 48 plus this page, line 416),
    Next stays enabled (lines 2245–2246) and can step on forever. Recommended:
    disable Next when the current page returned no characters. **Agreed.**
14. **Shown NSFW and sent NSFW can differ.** Logged in, the toggle shows on
    (line 2044), but searches send the saved value (lines 670 and 767), and a
    login found by the session check on open doesn't turn it on (lines
    1227–1243). A new browser on a hosted install shows "on" and searches
    without NSFW. **Follow-up:** when the session check finds an active
    session, turn that provider's NSFW on, as logging in does. No change in the
    rebuild. **Agreed** as a follow-up.
15. **JannyAI repeats.** When tag filters fetch extra pages (lines 563–577),
    the page number doesn't move past them, so Next shows those characters
    again. **Follow-up:** remember the last page fetched and continue from it.
    No change in the rebuild. **Agreed** as a follow-up.
16. **"Max Output Tokens".** The max token field filters the card's size, not
    the model's output (sent as `max_tokens` to the card search, lines 405, 521
    and 675). Recommended: label it "Max tokens" (and "Min tokens"). **Agreed.**
17. **Accessibility.** The login and DataCat dialogs have no dialog role, focus
    handling or Escape; the provider list doesn't close on Escape or outside
    clicks; the close, clear-search and tag include/exclude buttons have no
    names (the boxes show "✓" and "−"); the in-use tag chips are clickable text,
    not buttons; the quick starts need a right-click; the NSFW reasons live only
    in tooltips. Recommended: labeled dialogs (`role="dialog"`, `aria-modal`,
    named by the title, focus in and back, Escape closes); the provider list
    as a menu that closes on Escape and outside clicks; names like "Close",
    "Clear search", "Include <tag>", "Exclude <tag>", "Remove <tag>"; chips as
    buttons; a "More" button on each panel row opening the same menu; the
    toggles as switches; and the NSFW reason visible next to the toggle on
    phones, not only on hover. **Agreed.**
18. **Wording.** Labels and buttons are Title Case ("Browse Online", "Quick
    Start Roleplay", "Save & Connect", "Log In", "Character Must Have",
    "Advanced Options", "Creator's Notes", sort labels like "Hot This Week"),
    "Log In" and "Logout" mix, the panel says "Browse Online" where the
    Characters panel says "Browse online", and sort, filter and hint labels use
    emoji as icons. Recommended: sentence case per the app's writing rules,
    "Log in" and "Log out" everywhere, no emoji in labels or toasts (keep the
    provider icons in the switcher). Sort and filter values don't change. **Agreed.**

## Tests

No tests cover the old view, panel or API file. Keep the folder's team-owned
tests, unchanged and passing: `BotBrowserAssetImage.spec.tsx` (one fetch per
lazy picture; shared pictures stay alive when one copy unmounts) and
`asset-image-cache.spec.ts`. The importer's
`import_st_character_preserves_bot_browser_source_marker` (Rust) stays as the
check that the marker is saved.

New behavior tests, built from the recordings (see "Safety"):

- **Requests:** for each provider, the exact path and query (or JannyAI body)
  for: the default search, a search with text, each sort, page 2, ascending,
  included and excluded tags, token fields, each feature and toggle, NSFW on
  and off. ChubAI's two sort rules (with and without text); Pygmalion's 0-based
  page; Wyvern's `rating=none` rule; DataCat's Fresh-or-recent choice and
  offset; JannyAI's filter strings, custom tags and the extra pages.
- **Cards and details:** a recorded reply for each provider becomes the
  recorded card (name, creator, tagline, tags, stats, picture source, link) and
  detail; empty replies are "no detail"; failed ones are errors with Retry;
  DataCat's download-then-character order.
- **JannyAI fallback:** a blocked search gets a forced token and posts to the
  site with the listed headers; other failures aren't retried.
- **Binary replies:** `{ base64, mimeType }`, a `data:` URL and a plain string
  all become the right Blob.
- **Imports:** the exact `import_st_character` body for a PNG import (ChubAI
  with and without an open detail; CharacterTavern) and a built import (each
  other provider), including `_botBrowserSource`, the provider marker, tag mode,
  the lorebook answer and the picture; caches and lorebook lists refreshed;
  regex scripts and card check started.
- **PNG download:** the file opens as a card with the expected JSON.
- **Settings:** an existing `marinara-bot-browser` value loads; changes write
  the same shape and keep unknown keys.
- **Searches:** a stale reply never replaces a newer one.
- **Logins:** save, validate, fail, log out, and the expired-session toast.
- **DataCat warning** shows once per session; cancelling stays put.
- **Panel:** lists only characters with the marker; search; the two quick
  starts call `startChatFromCharacter` with the right mode.
- New: decisions 1, 2, 3, 5, 6, 8, 9, 12 and 13.

Test what people see, what's sent and what's saved. Don't read source files as
text.

## Acceptance checks

1. The Browser opens on ChubAI with "Most downloaded", the grid fills, and
   closing and reopening keeps where you were.
2. Each provider searches, sorts, pages, and filters by tags the way its
   section says, and its requests match the recordings.
3. JannyAI still searches when the app's request is blocked (the browser
   fallback).
4. A ChubAI import brings the site's card with its picture, lorebook (after
   asking) and regex scripts, shows the card check when the card has problems,
   and the character appears in the sidebar panel.
5. A JannyAI, Pygmalion, Wyvern and DataCat import each create a character
   with `extensions.botBrowserSource` and the provider marker; tag modes All,
   None and Existing work.
6. Characters imported by the old screen (the 4 on the main install with the
   marker) still show in the panel and open.
7. The existing `marinara-bot-browser` setting keeps each provider's NSFW
   choice and the login state; a broken value doesn't stop the screen
   (decision 5).
8. Pygmalion and CharacterTavern log in with a token or cookie, turn NSFW on,
   log out, and report an expired session on the next open.
9. DataCat asks first, then locks NSFW on; Wyvern's NSFW comes through its
   sort.
10. Opening one character and quickly another never shows or imports the first
    one's detail (decision 1).
11. Download as PNG saves a card that imports back with its lorebook (decision
    2), and is disabled without a picture (decision 3).
12. Keyboard only: every control has a name, dialogs trap focus and close with
    Escape, and the quick starts are reachable without a right-click (decision
    17).
13. Phone width and the Pond, Default and SillyTavern themes in light and dark
    look right.
14. The embedded app and a hosted install behave the same.
15. `pnpm typecheck`, `pnpm check:architecture` and the tests pass, and the old
    files in "Scope" are gone.
