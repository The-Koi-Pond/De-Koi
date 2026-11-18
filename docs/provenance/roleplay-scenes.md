# Roleplay Scenes: Behavior Spec

Status: agreed 2026-11-18, every decision as recommended. Part of the code provenance
plan (`docs/code-provenance-plan.md`, tracked in #1580).

This spec describes what Roleplay scenes must do. It is the only input the
builder uses for the scene parts. It describes behavior, not the old
implementation.

## Rules for the builder

Build from this spec and the team-owned code around it. Don't open, search, or
read the history of the old scene implementation:

- `src/engine/modes/roleplay/scene/scene-service.ts`
- `src/engine/contracts/types/scene.ts`
- `src/features/modes/roleplay/hooks/use-scene.ts`
- `src/features/modes/shared/scene-ui/SceneBanner.tsx` (and its `index.ts`)
- the `scene` command in `src/shared/lib/slash-commands.ts`
- `createSceneFromCommand` in `src/engine/generation/connected-commands.ts`
- the `scene` parsing in `src/engine/modes/chat/commands/character-commands.ts`
  (`SceneCommand`, `SCENE_RE`, `parseSceneTextParam`,
  `parseUnquotedSceneParam`, `parseBareSceneScenario` and the scene loop)

You will edit `ChatRoleplaySurface.tsx`, `RoleplayModeRoute.tsx`,
`ConversationModeRoute.tsx` and `ConversationView.tsx` to mount the new pieces.
Replace their scene lines (the End scene bar, the concluded-scene card, the
origin card and the `sceneInfo` plumbing) without copying them. The same goes
for the concluded-scene send checks in `start-generation.ts` and
`use-generate.ts`, and the `scene_created` handling in `use-generate.ts`.

These scene files are team-owned. Read them and keep using them:
`scene-opening.ts` (the opening guide), `universal-preset.ts` (the scene's
starting preset), and the summary pipeline's story-consolidation helpers.

The current scene tests are team-owned and may be read, but rewrite them
against the new module (see "Tests"). If this spec doesn't answer a question,
ask the spec writer.

## Scope

Lines not yet team-owned, from `pnpm report:provenance --fast` at `2424075824`,
plus line-range blame for pieces of shared files.

**Replaced, then deleted:**

| File                                                 | Not owned | Of lines |
| ---------------------------------------------------- | --------: | -------: |
| `src/engine/modes/roleplay/scene/scene-service.ts`   |       602 |    1,129 |
| `src/features/modes/shared/scene-ui/SceneBanner.tsx` |       166 |      214 |
| `src/features/modes/roleplay/hooks/use-scene.ts`     |       138 |      203 |
| `src/engine/contracts/types/scene.ts`                |       119 |      129 |

**Rewritten in place:**

| Piece                                                                      | Not owned |
| -------------------------------------------------------------------------- | --------: |
| The `scene` command in `slash-commands.ts`                                 |       ~72 |
| `createSceneFromCommand` in `connected-commands.ts`                        |       ~46 |
| Scene command parsing in `character-commands.ts`                           |       ~18 |
| End scene bar and concluded-scene card in `ChatRoleplaySurface.tsx`        |       ~14 |
| The origin card's `sceneInfo` in `ConversationModeRoute.tsx`               |        ~9 |
| The banner mounts in `ConversationView.tsx`                                |        ~4 |
| The concluded-scene send check in `start-generation.ts`, `use-generate.ts` |        ~6 |

That's about **1,200 lines** not yet team-owned. The scene service is about
half team code already (the summary pipeline and its retries, story
consolidation, the universal preset, the opening beat rules); those behaviors
are described here so the rebuild keeps them.

**Tests to rewrite** (team-owned): `scene-service.spec.ts`,
`SceneBanner.spec.tsx`, `use-scene.continuity-director.spec.tsx`,
`slash-commands.scene.spec.ts`, and the scene cases in the
`character-commands` and `use-generate` specs.

### Neighbors (not rebuilt)

- `prompt-assembly.ts`: builds the scene prompt block (relationship history and
  origin context while the scene is short, the previous scene's summary, the
  scenario, the scene instructions), reads `roleplaySceneHistory` for scene
  memories, offers characters the `[scene: …]` tag when the `scene` command
  capability is on, and skips some blocks while `sceneStatus` is `active`.
- `canonical-memory-context.ts`, `automatic-memory-capture-queue.ts`,
  `summary-context.ts`, `story-consolidation-queue.ts`,
  `autonomous.service.ts` (no autonomous messages while a scene is active, and
  busy characters in `sceneBusyCharIds` stay quiet), `connected-commands.ts`
  (no influence notes into an active scene), `world-tick-offers.ts` (the offer
  after a scene returns to a Roleplay chat).
- `chat-preset.ts`: the list of scene metadata keys a chat preset never copies.
- `chats.rs` (`scene_delete_scope`, `clear_character_scene_memories`): deleting
  an origin chat deletes its scene chats; deleting a scene chat clears its
  origin pointers, its `roleplaySceneHistory` entry and the characters'
  scene memories. `chat_memory.rs` reads `roleplaySceneHistory` as a memory
  lane.
- `ChatSettingsDrawer.tsx` and `ModePromptSettingsSections.tsx`: show and edit
  `sceneSystemPrompt` as the scene's instructions.
- `use-chat-surface-data.ts`: loads the active scene chat for the origin card.
- `scheduleContinuityDirectorRefresh` (`scene_created`, `scene_concluded`
  triggers), `offerWorldTickAfterScene`, `resolveGenerationConnection`,
  `parseGameJsonish`, `hiddenFromAi`, `copyTrackerSnapshotsForRebasedMessages`,
  `characterExtensionsPatch`, `userFacingError`, `defaultBackgroundAgentIdsForNewChat`,
  the chat music source helpers, `showConfirmDialog`, the `storage` and `llm`
  gateways and their `src/shared/api` wrappers.

### Same word, different feature

These say "scene" but aren't scenes. Leave them alone: Roleplay scene sound
(`scene-sound`), starter staging and scene backgrounds
(`starter-staging.ts`, `scene-backgrounds.ts`), the Continuity Director's
`scene_events` refresh mode, Deki's pond scene (`deki-scene.ts`), `/illustrate`
("the latest scene"), the `/emote` "characters in the scene" list, and passing
mentions in prompts.

## The shape

- **A scene is a Roleplay chat branched off another chat** (usually a
  Conversation). It plays out one focused story, then ends with a summary that
  goes back to the chat it came from, as a memory.
- **Two ways in:** the user types `/scene` (or `/rp`), or a character's reply
  ends with a `[scene: …]` tag.
- **Lifecycle:** planned → active → concluded, with reopen, discard, clone and
  convert. One active scene per origin chat.
- **Model calls:** one planning call, the opening reply (through the normal
  Roleplay pipeline), and the summary calls when it ends.
- **Layers:** planning, creating, ending, forking and the prompts in
  `src/engine/modes/roleplay/scene`; the hook in `src/features/modes/roleplay`;
  the cards and the End scene bar in `src/features/modes/shared/scene-ui` (both
  modes mount them). No new Tauri command or HTTP route: everything uses the
  existing storage and LLM wrappers, so hosted installs work the same.

## Starting a scene

### `/scene [description]`

Alias `/rp`, usage `/scene [description]`, help text "Start a roleplay scene
branching from this conversation". It runs locally (it isn't sent to the
model as text).

1. With no description and no messages in the chat: feedback "No conversation
   history to base a scene on. Provide a description or chat first: /scene
   <description>". Nothing else happens.
2. A loading toast "Planning scene..." (🎬), then the planning call (see
   "Planning"), with no connection override.
3. If planning fails, the real reason shows as feedback and nothing is created
   (decision 1).
4. The toast becomes "Creating scene...", the scene chat is created with the
   opening left to the Roleplay writer (see "Creating"), the chat list
   refreshes, and the app opens the scene chat.
5. The opening reply starts in the scene chat through the normal generation
   path, with the opening guide from `scene-opening.ts` built from the plan's
   opening beat, as a narrator guide.
6. If the opening can't start (returns false or throws), the scene stays and
   the feedback says "Scene created, but its opening could not start. Send a
   message in the scene to continue."
7. Otherwise the toast ends as "Scene created: <name>" (🎬).
8. If creating fails, the real reason shows as feedback (decision 1).

Inside a scene chat, `/scene` doesn't start another scene (decision 7).

### A character's `[scene: …]` tag

- **The tag:** `[scene: …]` anywhere in a reply, any case. Parameters
  `scenario` (or `description` or `prompt`), `background` and `plan`, each
  quoted (straight or curly quotes) or unquoted up to the next known key. With
  no `key=` at the start, the whole parameter text (quotes stripped) is the
  scenario. A tag without a scenario is ignored. Like other command tags it's
  stripped from the shown reply.
- **When offered:** `prompt-assembly.ts` already offers it when the chat's
  `scene` command capability is on. Unchanged.
- **Running it:** the planning request is the scenario, then the plan, then
  the background as a setting hint (decision 6), joined by blank lines. Planning
  and creating use the reply's connection, the initiator is the replying
  character, and the opening is left to the Roleplay writer.
- **Events:** on success, the reply's event stream gets a `scene_created` event
  with the scene `chatId`, `chatName`, `originChatId`, `background` (always
  null) and `openingGenerationGuide`. If planning or creating fails, the
  command throws so the existing command error event carries the reason
  (decision 1). The reply itself is unaffected either way.
- **The app on `scene_created`:** a toast "Scene created: <name>" ("Scene
  created." without a name) with a **Go to scene** action, both chats
  refresh, and the opening reply starts in the scene chat (as for `/scene`)
  without switching the user's view. If it can't start: warning toast "Scene
  created, but its opening could not start. Send a message in the scene to
  continue."

## Planning

The planner turns a request into a plan. It reads the origin chat, its
characters, its persona and its recent messages.

**The call:** the chat's connection (`resolveGenerationConnection` with the
override, if any), temperature 0.9, up to 4,096 output tokens. The model is
told:

- it plans a De-Koi roleplay scene and returns one JSON object with `name`,
  `description`, `scenario`, `firstMessage`, `background`, `characterIds`,
  `rating` and `relationshipHistory`;
- `name` starts with "Scene:", `rating` is `sfw` or `nsfw`, `characterIds` use
  only the listed IDs, `background` is always null (backgrounds are picked by
  hand or by the opt-in Background agent later);
- it doesn't add policy, safety, consent, participation or preset instructions
  (De-Koi applies those separately);
- `firstMessage` is a beat brief, not prose: exactly three labeled lines,
  `Participants: …`, `Action: …`, `Pressure: …`, at most 360 characters in
  all, with concrete participants, action and pressure; no scripted dialogue,
  metaphors, similes, asides or camera staging; a short exact line only when
  the user asked for those words; no explaining the theme and no forced
  interruption, reveal or choice;
- honor the requested premise, cast, genre and opening situation.

**It's given:** the allowed character IDs; each character's card (see
"Participant cards"); the active persona or "(none)"; the last 20 messages as
`role: content` (empty ones skipped) or "(none)"; and the request: "Plan a
complete roleplay scene based on this request: <request>", or with no request
"Plan a complete roleplay scene that naturally follows the recent
conversation."

**Participant cards:** id, name, and whichever of description, personality,
appearance, backstory, scenario, first message, example dialogue, system
prompt, post-history instructions and tags (up to 12) are set. Read from the
card's `data` (V2 cards, also when stored as a JSON string), else the row's own
fields; snake_case and camelCase names both work; backstory falls back to
`comment`. Whitespace collapses; each field is capped (name 120 characters,
description 1,200, first message 600, the rest 900; cut text ends in "...").
The persona is the chat's `personaId`, else the persona marked active.

**Checking the answer** (parsed with `parseGameJsonish`):

- Escaped line breaks and tabs (`\n` written as text) become real ones.
- `name`: whitespace collapsed, at most 60 characters, "Scene: " added when
  missing. Empty: the request, else "New Scene".
- `description`, `scenario`, `relationshipHistory`: as returned; empty falls
  back (see below).
- `characterIds`: only the chat's own characters. None returned: all of the
  chat's characters.
- `rating`: `nsfw` only if it says so, else `sfw`.
- **The opening beat** (`firstMessage`) is replaced by the generic beat "Open
  on the planned scene's immediate situation and pressure, with the listed
  participants already present." when it has more than three sentences, isn't
  the exact three-line shape, or quotes dialogue the user's request doesn't
  contain (any case, whitespace collapsed). Over 360 characters, it's trimmed
  at a sentence end, else a word, with "...".
- The plan's own system prompt is always the fixed line "Write immersive
  roleplay prose with consistent point of view, clear character agency, and
  continuity from the originating conversation."; whatever the model wrote for
  instructions or participation is dropped.

**Empty fields** in an otherwise valid answer fall back to what the request and
recent messages give: the description "The scene opens around this premise:
<premise>", the scenario built from the premise and the last 8 messages, and
the relationship history as those messages. The premise is the request, else
the last recent message, else "A focused roleplay scene continues from the
current conversation."

**Failure:** no connection, a failed call, or an answer that isn't a JSON
object is a planning failure with its real reason. No plan, no scene
(decision 1).

## Creating

Creating takes the origin chat id, the plan, the initiator (a character id or
null for `/scene`), an optional connection, and the opening mode (`planned` or
`generated`; both entry points use `generated`).

**Refused** (as a user-facing error, nothing created):

- "A scene is already being created for this conversation. Wait for it to
  finish." while another create for the same origin is running.
- "This conversation already has an active scene. Conclude or discard that
  scene first." when the origin's `activeSceneChatId` is set.
- An origin that isn't a Conversation or Roleplay chat (legacy visual novel
  counts as Roleplay).

**The scene chat:**

- name: the plan's name (as checked above), mode `roleplay`;
- characters: the plan's, else the origin's;
- group, persona: the origin's; folder: none from a Conversation, the origin's
  folder from a Roleplay;
- connection: the requested one, else the origin's, else none;
- preset: the universal preset from `resolveSceneUniversalPreset` when it
  returns one, else the origin's;
- lorebooks: the origin's `activeLorebookIds` from metadata and from the chat,
  without repeats (the chat field and the metadata field both get them);
- linked to the origin (`connectedChatId`).

**Its metadata:** `sceneOriginChatId`, `sceneInitiatorCharId`,
`sceneDescription` (the plan's, else "A new scene begins."), `sceneScenario`,
`sceneBackground` (null), `sceneSystemPrompt` (the plan's system prompt plus
the scene guidelines below), `sceneRelationshipHistory`,
`sceneConversationContext` (see below), `sceneRating`, `sceneStatus: "active"`,
`enableMemoryRecall: true`, `enableAgents: true`, `activeAgentIds` from
`defaultBackgroundAgentIdsForNewChat("roleplay")`, the carried-over options
(see below), the origin's chat music source when it has one, and with a
universal preset `sceneUniversalPresetId`, `sceneUniversalPresetChoiceHints`
and `presetChoices`. No background is ever applied.

**Scene guidelines** (appended to the scene instructions, in your own words,
same meaning): it's a focused scene branched from the origin chat; keep
character knowledge and relationship continuity from it; the user controls
their persona's choices and words; follow the preset, origin chat and scene
request for narration and point of view, preferring the newest explicit
direction; spoken lines go in quotation marks; the first message sets the
scene and hands the next real choice to the user; carry on until the scene
ends or returns to the origin.

**Origin context:** the origin's last 24 messages that aren't hidden from the
AI (so earlier scenes' return messages are left out), as `role: content`,
empty ones skipped, separated by blank lines, at most 12,000 characters.

**Carried-over options:** from the origin's `lastRoleplaySceneOptions` when it
has any, else the origin's own metadata: `agentOverrides`, `enableAgents`,
`enableTools`, `toolSelectionMode`, `expressionAvatarsEnabled`, `spriteSide`
when present; `activeAgentIds` when non-empty (replacing the default list);
tools off when `enableTools` is false, else `activeToolIds` with tools on when
there are any, else `enableTools` as set.

**Then, on the origin:** `activeSceneChatId` = the scene, `sceneBusyCharIds` =
the scene's characters, and its link points at the scene (decision 2). With
opening mode `planned`, the scene gets one assistant message (the initiator or
the first character): the description, a blank line, and the opening beat
("The scene begins." if empty).

**If anything after the scene chat exists fails**, the scene chat and its
messages are deleted and the origin's pointers and link go back to how they
were, then the original error is raised. If the cleanup fails too, the error
names both.

**Returns** the scene `chatId`, `chatName`, `description` and `background`
(null).

**The app, after a create from the hook:** chat list refreshed, a Continuity
Director refresh queued for the origin (trigger `scene_created`, only on
success), the scene chat opened, toast "Scene started: <name>" (🎬). On
failure: the error toast, no refresh queued.

## In the scene

- **The End scene bar** sits above the input while `sceneStatus` is `active`:
  - **Back to conversation** (when there's an origin) opens the origin.
  - **End scene** turns into "End and save summary?" with **Yes** (shows
    "Saving..." while it runs, can't be pressed twice) and **No**.
  - **Discard** asks "Discard this scene?" / "This will permanently delete the
    scene without saving a summary or memory." (Discard, Keep scene;
    destructive), then shows "Discarding..." until done. Asking closes the End
    scene question.
  - **Convert** asks "Convert this scene into a standalone roleplay?" / "This
    will create a new roleplay chat from the current scene and detach the
    original scene from its conversation. No scene summary or character memory
    will be written back to the original conversation." (Convert, Cancel;
    destructive).
  - While one of them runs, the others are disabled, and Convert is also
    disabled while a reply streams. (Today Convert stays enabled while ending;
    that's a fix.)
- **Messages:** scene chats never offer Branch. Active scenes offer **Clone
  from here** instead (see "Forking"); it's disabled while a fork runs or a
  reply streams.
- **Prompting** is the neighbors' job (see `prompt-assembly.ts`).
- **The origin card:** while the origin's active scene exists and is active,
  the origin shows a card at the bottom of its messages: a film icon, "A scene
  is in progress", the scene's name, and **Go to scene**. Today this shows in
  Conversation origins only (decision 8).

## Ending

### Conclude

1. Load the scene and its origin. A chat without `sceneOriginChatId` is "Not a
   scene chat".
2. If the origin has Story Continuity on (`getEffectiveStoryConsolidationEnabled`)
   but storage can't write canonical memories, stop with "Story Continuity is
   enabled, but canonical memory persistence is unavailable". Nothing is
   written.
3. Write the summary (see "The summary"). A failure stops here, with the
   provider's error code kept so its worded message reaches the user. Nothing
   is written and the scene stays active.
4. With Story Continuity on, store the scene as one story episode through
   `persistCompletedSceneStoryEpisode` (owner the origin, the scene's
   messages, the summary and its sections, and the connection the summary
   used, with its provider and model). No episode, or a failed follow-up write, stops here with the scene
   still active; a failed later enqueue leaves a retryable job and carries on.
5. Write back to the origin (decision 3 for repeats):
   - one assistant message, no character, hidden from the AI
     (`extra.hiddenFromAI` and `hiddenFromAi`): `The scene "<name without
'Scene: '>" concluded.`, a blank line, the summary;
   - `roleplaySceneHistory`: this scene's entry replaced with `{ sceneChatId,
concludedAt, summary }`, newest 20 kept; `lastRoleplaySceneSummary`; and
     `lastRoleplaySceneOptions` (the carried-over options, read from the
     scene's metadata);
   - for each scene character: `extensions.characterMemories` gets `{ from:
<scene name without "Scene: ">, fromCharId: null, sceneChatId,
originChatId, summary: "[Scene on <YYYY-MM-DD>: <name>] <summary>",
createdAt }`, replacing this scene's earlier entry, newest 100 kept.
6. Mark the scene `sceneStatus: "concluded"`, clear the origin's
   `activeSceneChatId` and `sceneBusyCharIds`, and unlink both chats (decision
   2 for the origin's link).
7. Return the summary and origin id.

**The app:** a toast "Generating scene summary..." (✍️) when it starts. On
success: refresh both chats and their messages, queue a Continuity Director
refresh for the origin (`scene_concluded`), offer to let time pass
(`offerWorldTickAfterScene`; if it offers, refresh the origin and its world
tick state; if the offer fails, warning toast "Scene concluded, but couldn't
offer to let time pass" with the reason or "Use Let time pass in the toolbar
instead."), open the origin (decision 5), toast "Scene concluded — summary
added as a memory" (📖). On failure: the error toast, the scene stays active.

### The summary

Long scenes are summarized in sections, then once as a whole.

- **Transcript:** every scene message with text, as `Message <n> - <role>`
  (plus ` (<character id>)` when it has one) `: <text>`, with leading
  "Summary:"/"Scene summary:" and speaker labels removed and whitespace
  collapsed. Split into sections of at most 12,000 characters at message
  boundaries. No messages: one section "(No visible scene transcript.)".
- **Each section:** one call (temperature 0.45, up to 700 tokens) asking for a
  concise third-person summary of that section: concrete events, choices,
  emotional and relationship shifts, promises, conflicts, reveals, open hooks;
  invent nothing and leave out nothing big because it's intense. It gets the
  section number and count, the scene's details (name, today's date,
  description, scenario, background, rating, relationship history, origin
  context), the participant cards, the persona and the section text. The
  result is cleaned (below) and capped at 2,400 characters.
- **The whole:** one call (temperature 0.5, up to 1,400 tokens) asking for one
  or two compact paragraphs, 120–220 words and never more, covering premise,
  key events across the whole scene, shifts, outcomes, promises, conflicts,
  reveals and open hooks, built from every section summary; invent nothing; and
  return JSON with `summary` and `sections` (string arrays `events`, `choices`,
  `relationshipShifts`, `promises`, `reveals`, `unresolvedHooks`,
  `currentState`). It gets the scene's details, cards, persona and the section
  summaries as "Section <n>: …".
- **A second try** (temperature 0.35, up to 2,800 tokens), with the first
  answer and the reason, when the first summary is over 220 words, or when the
  scene is substantial (more than one section, 8 or more transcript lines, or
  1,800 or more characters) and the summary has fewer than three sentences. If
  the second is still under three sentences: "The model returned an incomplete
  scene summary. Try again, or switch to a stronger model."
- **Over 220 words** after that, the summary keeps its first 146 words, "…",
  and its last 73.
- **Empty answers:** when a call fails because the provider sent no assistant
  text (its error says the response "did not contain assistant text", "empty
  assistant" or "no final assistant text", anywhere in the error, its cause or
  its details), that call is retried once with a larger budget (sections 2,048,
  whole 2,800).
- **Every summary call** asks for no reasoning: `reasoningEffort: "none"`,
  `reasoning_effort: "none"`, and custom parameters `reasoning_effort: "none"`
  and `reasoning: { exclude: true }`.
- **Reading the whole-scene answer:** code fences removed; a JSON object with a
  `summary` and a `sections` object whose seven keys are all arrays (entries
  strings, or objects with `text`, each capped at 600 characters). JSON-looking
  output that doesn't fit is an error ("The model returned malformed structured
  scene summary JSON"); plain prose is accepted as the summary with empty
  sections (older providers). The whole summary is capped at 8,000 characters
  before the word rules.
- **Cleaning:** labels removed (as for the transcript), whitespace collapsed,
  trimmed at a sentence end (else a word, with "...") when over the cap, a
  final period added when missing. Empty is an error ("The model returned an
  empty scene summary").
- **The connection** is the scene chat's (`"random"` resolves once, before the
  first call, and every call uses that one), with the conclude request's
  override if given.
- Any failure is raised as "Scene summary generation failed: <reason>", keeping
  the provider's error code.

### Discard

Saves the scene's carried-over options to the origin's
`lastRoleplaySceneOptions`, clears the origin's scene pointers and link
(decision 2), deletes the scene's messages (one bulk delete) and then the scene
chat. "Not a scene chat" without an origin. **The app:** the origin card
disappears at once (the cached origin loses `activeSceneChatId` and
`sceneBusyCharIds`), the scene's cache is dropped, the list refreshes, the
origin opens, toast "Scene discarded" (🗑️).

### Reopen

For a concluded scene: refused with the "already has an active scene" message
if the origin has a different active scene. Otherwise the scene is `active`
again, the origin points at it (`activeSceneChatId`, `sceneBusyCharIds` = the
scene's characters) and the two are linked again. Earlier write-backs stay
until it's concluded again (decision 3). **The app:** refresh, open the scene,
toast "Scene reopened".

**The concluded-scene card** replaces the input in a concluded scene: a film
icon, "Scene", the description in italics, **Back to conversation** (when it
has an origin) and **Reopen scene**. A concluded scene's messages can't be
deleted, edited, regenerated, swiped, hidden, branched, cloned or selected, the
Encounter button and the let-time-pass offer are hidden, and sending is refused
in both the engine and the app with "This scene is concluded. Convert or reopen
it before sending new messages."

## Forking

A scene becomes a standalone Roleplay chat.

- **Clone** keeps the scene; optionally only up to and including one message
  ("Clone from here"). That message must be in the scene ("Message is not part
  of this scene").
- **Convert** copies the whole scene, then removes it: the origin's pointers
  and link are cleared (decision 2) and the scene and its messages are deleted.
  Convert can't stop at a message ("Convert cannot be limited to a message").
  Nothing is written back to the origin.
- **The new chat:** named "<scene name> Clone" or "<scene name> Converted"
  ("Scene" if unnamed), mode `roleplay`, the scene's characters, group,
  folder, persona, preset and connection; its metadata is the scene's without
  any key starting with `scene` and without `activeSceneChatId` and
  `sceneBusyCharIds`. Not linked to anything.
- **First,** a hidden narrator message (hidden from the user,
  `isSceneContinuity: true`): "Hidden continuity carried from the original
  scene branch.", then whichever of the origin context, relationship history
  and scene premise (scenario) exist, each under its own heading. None: no
  message.
- **Then** the scene's messages, oldest first (by creation time, then id), each
  copied whole (swipes and extra included) with a new id; tracker snapshots
  move with them (`copyTrackerSnapshotsForRebasedMessages`), and the newest
  visible snapshot becomes the new chat's tracker state.
- **The app:** one fork at a time (repeat clicks do nothing while one runs, and
  the controls show as disabled); refresh the lists, both chats and the new
  chat's messages and count; drop the scene's cache after Convert; open the new
  chat; toast "Scene converted to roleplay" or "Scene cloned as roleplay".

## Saved data

| What              | Exact contract                                                                                                                                                                                                                                                                                      | Rule                                             |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| Scene chat        | `chats` row, `mode: "roleplay"`, `connectedChatId` → origin while active                                                                                                                                                                                                                            | Same fields as today.                            |
| Scene metadata    | `sceneOriginChatId`, `sceneInitiatorCharId`, `sceneDescription`, `sceneScenario`, `sceneBackground`, `sceneSystemPrompt`, `sceneRelationshipHistory`, `sceneConversationContext`, `sceneRating`, `sceneStatus` (`active`, `concluded`), `sceneUniversalPresetId`, `sceneUniversalPresetChoiceHints` | Same keys and meaning. Old scenes load.          |
| Origin metadata   | `activeSceneChatId`, `sceneBusyCharIds`, `roleplaySceneHistory[]` (`sceneChatId`, `concludedAt`, `summary`), `lastRoleplaySceneSummary`, `lastRoleplaySceneOptions`                                                                                                                                 | Same keys. Plus decision 2's new key.            |
| Return message    | origin message, `role: "assistant"`, `characterId: null`, `extra.hiddenFromAI` and `extra.hiddenFromAi` true                                                                                                                                                                                        | Same shape. Plus decision 3's marker.            |
| Character memory  | `data.extensions.characterMemories[]` entry as in "Conclude"                                                                                                                                                                                                                                        | Same shape; `chats.rs` deletes by `sceneChatId`. |
| Fork continuity   | narrator message with `extra.hiddenFromUser` and `extra.isSceneContinuity` true                                                                                                                                                                                                                     | Same shape.                                      |
| Old guide message | old scenes may start with a narrator "participation guide" message                                                                                                                                                                                                                                  | Read as an ordinary message (decision 6).        |

The `scene_created` generation event (`chatId`, `chatName`, `originChatId`,
`background`, `openingGenerationGuide`) and the Continuity Director triggers
`scene_created` and `scene_concluded` keep their names. The type names in
`scene.ts` are internal and may change; `SceneFullPlan`'s fields that
`universal-preset.ts` reads (`description`, `scenario`, `firstMessage`,
`systemPrompt`, `relationshipHistory`, `rating`, `presetChoices`) stay.

## Model calls

All planning and summary calls go through **one engine function** in the
scene module that takes the call kind (plan, section summary, whole summary),
the chat, the messages and the parameters and returns the text. Only it picks
the connection. The opening reply isn't one of these: it's an ordinary
Roleplay generation.

| Call            | Temperature | Max output tokens | Retry budget |
| --------------- | ----------: | ----------------: | -----------: |
| Plan            |         0.9 |             4,096 |            — |
| Section summary |        0.45 |               700 |        2,048 |
| Whole summary   |         0.5 |             1,400 |        2,800 |
| Second try      |        0.35 |             2,800 |        2,800 |

## Removed

- **The made-up local plan** used when planning fails (decision 1).
- **The participation guide:** the plan's `participationGuide` (always empty),
  the narrator message it would create, and the fork option to skip it
  (decision 6).
- **The plan's `background`** (always null) and the background step in
  `/scene` that never fires; the tag's background becomes a planning hint
  (decision 6).
- **The `visuals` capability** passed to planning and creating, which neither
  uses.

## Decisions

1. **Failed planning.** When there's no connection, the call fails, or the
   answer isn't JSON, today's planner builds a made-up scene from the request
   or the last message, and `/scene` and the `[scene]` tag create it without
   showing the error. Recommended: no made-up plan; show the real reason
   (`/scene` feedback, the tag's command error) and create nothing.
   **Agreed.**
2. **The origin's existing link.** Starting a scene overwrites the origin's
   `connectedChatId`, and ending, discarding or converting sets it to null. A
   Conversation already linked to a Roleplay (Carry on, `chat_connect`) loses
   its side of that link for good, while the Roleplay still points back.
   Recommended: save the earlier link in origin metadata
   (`scenePreviousConnectedChatId`) when the scene starts or reopens, and put
   it back when the scene ends, is discarded or converted, and on a failed
   create, if that chat still exists and still links back to the origin. **Agreed.**
3. **One return message per scene.** Ending a reopened scene adds a second
   "concluded" message to the origin (history and character memories already
   replace). A failure after the return message (memories, status) leaves the
   scene active, and ending again adds another. Recommended: mark the return
   message with `extra.sceneChatId` and replace an existing one instead of
   adding. **Agreed.**
4. **Write-back order.** Recommended: write the history, memories and return
   message before marking the scene concluded (as today), so a failure always
   leaves the scene active and retryable; with decision 3, a retry is clean.
   **Agreed.**
5. **Leaving while it ends.** Ending takes a while on long scenes. Today the app
   opens the origin afterwards even if you've gone to another chat.
   Recommended: open the origin only if you're still in the scene; otherwise
   the success toast gets a **Go to conversation** action. **Agreed.**
6. **Dead fields.** Recommended: drop `participationGuide` and the plan's
   `background`; pass the tag's `background` to the planner as a setting hint
   instead of dropping it; keep writing `sceneBackground: null` so old readers
   see the same keys; never pick a library background. **Agreed.**
7. **A scene inside a scene.** `/scene` in an active scene chat creates a scene
   whose origin is the scene, which then points at the new scene. Recommended:
   refuse with "Finish this scene first." in an active scene chat. **Agreed.**
8. **Origin card in Roleplay.** A Roleplay chat can start a scene with
   `/scene`, but only Conversation shows the "A scene is in progress" card.
   Recommended: show the same card in Roleplay origins. **Agreed.**
9. **Wording.** "End Scene", "Go to Scene" and "Keep Scene" are Title Case, and
   two toasts use the letters "RP" as an icon. Recommended: sentence case per
   the app's writing rules, and no text icons. **Agreed.**
10. **Accessibility.** Recommended: buttons get accessible names that match
    their text, the End scene question is announced (a live region), and
    disabled actions say why in their tooltip. **Agreed.**
11. **Helper Models.** Scenes keep the chat's connection. The one seam means a
    later Helper Models task only changes it; not part of this rebuild.
    **Agreed.**

## Tests

Keep these behaviors as tests, rewritten against the new module:

- Planning reads no more than 20 recent messages; the origin context no more
  than 24 and skips messages hidden from the AI.
- The opening-beat rules: the three-line shape passes; prose, more than three
  sentences, and dialogue the user didn't ask for become the generic beat; the
  user's own quoted words survive; the 360-character cap; escaped line breaks.
- Planner instruction and participation fields are dropped.
- The universal preset cases (explicit scenes, genre-neutral scenes, planner
  preset choices not overriding explicit inference).
- Create refuses a second active scene and a concurrent create; a failed
  message write rolls the scene back; no origin-folder placement from a
  Conversation; no background; the default background agents; opening deferred
  for `generated`.
- Conclude: one story episode from the same summary pass; a retryable parent
  job after an enqueue failure; the scene stays active when the follow-up
  write fails, when canonical memory is unavailable, and when the summary
  fails; a `"random"` connection resolves once before the first call; every
  section is summarized before the whole; empty final synthesis fails; long
  summaries keep late facts and are hard-capped; empty-assistant retries with
  the larger no-reasoning budget; too-brief retries; speaker labels removed.
- Reopen restores the active scene and refuses when another is active.
- Discard and convert delete the transcript in one bulk delete before the chat.
- The hook queues a Continuity Director refresh only after a successful create
  or conclude.
- `/scene` defers the opening to the Roleplay writer, reports a partial
  success when the opening can't start or throws.
- The End scene bar: discard asks in the app dialog and shows progress;
  cancelling keeps the scene; the concluded card offers Reopen.
- New: decisions 1, 2, 3, 5 and 7.

`SceneBanner.spec.tsx` and the others don't read source files as text. Drop
assertions on internal call order that the user can't see, and test outcomes.

## Acceptance checks

1. `/scene a heist at the gala` in a Conversation plans, creates "Scene: …",
   opens it, and the opening reply streams in it.
2. `/scene` with no text in an empty chat shows the guidance and calls nothing.
3. With no connection, or junk planner output, `/scene` shows the real reason
   and no scene chat appears (decision 1).
4. A character reply with `[scene: scenario="…", background="a rainy pier"]`
   creates the scene, shows the toast with Go to scene, starts its opening
   without moving you, and the planner got the background hint (decision 6).
5. A second `/scene` while one is active, or inside a scene, is refused with
   its message (decision 7).
6. The origin shows "A scene is in progress" with Go to scene, in Conversation
   and Roleplay origins (decision 8).
7. End scene → Yes writes one hidden return message, a history entry and one
   memory per scene character, marks it concluded, and opens the origin.
8. A failed summary leaves the scene active and writes nothing.
9. Reopen, add a message, end again: still exactly one return message, one
   history entry and one memory per character (decision 3).
10. Leaving the scene while it ends keeps you where you went (decision 5).
11. Discard, confirmed, deletes the scene and its messages and the origin card
    disappears; cancelling keeps it.
12. Convert makes "<name> Converted" with the continuity note and every
    message, deletes the scene, and writes nothing to the origin.
13. Clone from here copies up to that message and leaves the scene active.
14. A Conversation linked to a Roleplay keeps that link after a scene starts
    and ends, is discarded, or is converted (decision 2).
15. A concluded scene can't be sent to and hides the message actions listed.
16. Existing scenes (active and concluded, with old guide messages) load, end,
    reopen and fork; deleting an origin still deletes its scenes.
17. All planning and summary calls pass through the one seam.
18. The embedded app and a hosted install behave the same.
19. `pnpm typecheck`, `pnpm check:architecture` and the rewritten tests pass,
    and the old files in "Scope" are gone.
