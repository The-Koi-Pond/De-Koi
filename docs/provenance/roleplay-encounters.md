# Roleplay Encounters: Behavior Spec

Status: agreed 2026-11-12, every decision as recommended. Part of the code provenance plan
(`docs/code-provenance-plan.md`, tracked in #1580).

This spec describes what Roleplay combat encounters must do. It is the only
input the builder uses for the encounter parts. It describes behavior, not the
old implementation.

## Rules for the builder

Build from this spec and the team-owned code around it. Don't open, search, or
read the history of the old encounter implementation:

- `src/engine/modes/roleplay/encounter/encounter-service.ts`
- `src/engine/contracts/types/combat-encounter.ts`
- `src/features/modes/roleplay/components/EncounterModal.tsx`
- `src/features/modes/roleplay/encounter/hooks/use-encounter.ts`
- `src/shared/stores/encounter.store.ts`
- the `combat` entry in `src/engine/contracts/constants/agent-prompts.ts`

You will edit `ChatRoleplaySurface.tsx` and `RoleplayModeRoute.tsx` (in
`src/features/modes/roleplay/components/`) to mount the new pieces. Replace
their encounter lines (lazy modal import, modal mount, Encounter button,
`combatAgentEnabled`, `encounterActive`) without copying them.

You may read every interface listed under "Neighbors". The current encounter
tests are team-owned and may be read, but rewrite them against the new module.
If this spec doesn't answer a question, ask the spec writer.

## Scope

Lines not yet team-owned, from `pnpm report:provenance --fast` at `b8d8d5528`,
plus line-range blame for pieces of shared files.

**Replaced, then deleted:**

| File                                                           | Not owned | Of lines |
| -------------------------------------------------------------- | --------: | -------: |
| `src/engine/modes/roleplay/encounter/encounter-service.ts`     |       733 |      825 |
| `src/features/modes/roleplay/components/EncounterModal.tsx`    |       670 |      766 |
| `src/engine/contracts/types/combat-encounter.ts`               |       191 |      194 |
| `src/features/modes/roleplay/encounter/hooks/use-encounter.ts` |       154 |      206 |
| `src/shared/stores/encounter.store.ts`                         |       145 |      208 |

**Rewritten in place:**

| Piece                                                                      | Not owned |
| -------------------------------------------------------------------------- | --------: |
| `combat` prompt in `agent-prompts.ts`                                      |       ~31 |
| `combat` catalog entry, default tools and id constant in `agent.ts`        |       ~10 |
| Encounter button, modal mount and lazy import in `ChatRoleplaySurface.tsx` |       ~20 |
| `combatAgentEnabled` and `encounterActive` in `RoleplayModeRoute.tsx`      |        ~2 |
| `combat` in the result-type map and JSON-agent set in `agent-executor.ts`  |         2 |
| The encounter export in `src/features/modes/roleplay/index.ts`             |         1 |

That's about **1,960 lines** not yet team-owned. The catalog and executor
entries are data contracts, so they come back with the same values.

**Tests to rewrite** (team-owned): `encounter-service.spec.ts`,
`encounter-service.test.ts`, `use-encounter.spec.tsx`, `encounter.store.spec.ts`.

### Neighbors (not rebuilt)

- `src-tauri/src/commands/storage/agents.rs`: the Rust copy of the built-in
  catalog, with `combat` and its default tools.
- `agent-context-profile.ts`: the `combat` agent sees the `description` and
  `rpgStats` card fields.
- The agent runner and executor: run the background `combat` agent like any
  other parallel agent.
- `ChatSettingsDrawer.tsx` and `AgentsPanel.tsx`: the generic agent pickers that
  switch `combat` on. Their "combat" words are category help text.
- `client-session-reset.ts`: clears encounter state on logout and profile
  switch.
- `resolveGenerationConnection` (`src/engine/generation/context.ts`),
  `parseGameJsonish`, the inline-thinking stripper, the `storage` and `llm`
  gateways and their `src/shared/api` wrappers, `useLorebooks("spellbook")`,
  `showConfirmDialog`, the shared motion helpers, the tracker (world) state.
- `model-routing.ts` and Helper Models: only for the later routing change.
- `.dependency-cruiser.cjs` treats a feature package's `encounter` folder as
  private, like `hooks`.

### Same word, different feature

These mention "combat" but aren't encounters. Leave them alone:
`CharacterStatsTab.tsx` and `PersonaStatsTab.tsx` (tracker help text),
`PersonaDescriptionTab.tsx` and `persona.ts` (the "Combat Skills" example),
`image-style-profiles.ts` and `sprites.rs` (pose words in image prompts),
`crates/assets/src/lib.rs` (the `combat` music folder means "intense"),
`music_spotify/matching.rs` (mood synonyms), `prompt-assembly.test.ts`
(fixture text), the `combat_start` and `combat_end` values of the
`trigger_event` tool, and passing mentions in other agents' prompts.

## The shape

- **An encounter is a separate turn-based fight** in an overlay over a Roleplay
  chat. The chat doesn't change until the fight ends, when one summary message
  is added.
- **The `combat` agent is the on-switch** for the Encounter button. Separately,
  as today, it also runs in the background after each reply (see "The Combat
  agent").
- **Three model calls:** setup, one per turn, and the summary. All go through
  one engine seam (see "Model calls").
- **State is memory-only.** Nothing about a fight in progress is saved.
- **Layers:** model calls, prompts, response checks and fight rules in
  `src/engine/modes/roleplay/encounter`; the overlay and button in
  `src/features/modes/roleplay`; state in a store the session reset can reach
  (`src/shared/stores` today). No new Tauri command or HTTP route: the calls
  use the existing storage and LLM wrappers, so hosted installs work the same.
  The calls run in the browser tab, so closing it ends a fight.

## Starting an encounter

- **The button:** a small "Encounter" button with a swords icon, centered just
  above the chat input, tooltip "Start Combat Encounter". It shows when the
  chat's enabled agents (`enabledChatAgentIds`: metadata `enableAgents` isn't
  false and `activeAgentIds` lists `combat`) include `combat`, and the chat
  isn't a concluded scene. `combat` exists in Roleplay (and visual novel), not
  Conversation or Fanfic. Nothing else starts an encounter: no model command,
  tag or agent output.
- **The setup dialog**, "Configure Combat Narrative":
  - **Combat Narration** and **Summary Narration**: tense (present, past),
    person (first, second, third), narration (omniscient, limited) and a
    point-of-view box (placeholder "narrator").
  - **Spellbook:** lorebooks of category `spellbook`, plus "None". Help text:
    "Attach a spellbook so the AI knows which spells and abilities are
    available in combat."
  - **Cancel** and **Begin Combat**. Tapping outside cancels.
- **Defaults:** combat narration present, third person, omniscient, "narrator";
  summary narration past, third person, omniscient, "narrator". Narration
  choices last until reload. The spellbook resets to None each time.
- **One encounter app-wide.** Opening the dialog, in any chat, throws away any
  earlier encounter and its pending calls.
- While the dialog or overlay is open, the chat's keyboard shortcuts are off.

## Setting up the fight

Begin Combat closes the dialog, opens the overlay with a spinner and
"Initializing combat encounter...", and makes the setup call.

**The model is told** it's the game master starting a fight and the user plays
the persona. It gets the context (see "Context"), recent history, and the JSON
shape. It must use configured max HP exactly, start everyone at full HP, write
in the chat's language and return one JSON object.

**On failure** the overlay shows "The AI could not create a valid combat
encounter. Try again." with **Retry** (same settings) and **Close** (see
decision 10). Junk output never starts a made-up fight.

**Filling gaps** in a response that parses but leaves things out:

- No party: the player plus up to three allies. Player: the persona's name
  ("Player" if none), max HP from the persona's HP bar else 24, up to six
  enabled spellbook entries as single-target attacks (described by the first
  120 characters of the entry) else one "Attack", and the tracker inventory
  ("Name xN" when over 1) else "Healing Potion x1". Allies: the chat's
  characters, max HP from their RPG stats else 24, one basic attack each.
- No enemies: "Enemy 1", 18/18 HP, with a "Strike" attack.
- No environment: the tracked location, else "the current area".
- Missing style notes: "plains", "tense", "day", "clear".
- Old Game-mode chats: `metadata.gameCharacterCards` (first card the player,
  the rest allies; `name`, `rpgStats.hp.max`) and `metadata.gameMap.name` are
  read as extra inputs when present.

## The overlay

A centered window (85% of the screen height, up to 600px wide) over a dimmed,
blurred backdrop, titled "Combat Encounter".

- **Tint** from the style notes' environment type (forest, dungeon, desert,
  cave, city, ruins, snow, water, castle, wasteland, plains, mountains, swamp,
  volcanic, spaceship, mansion; anything else neutral).
- **Environment line:** the environment, or "Battle Arena".
- **Enemy cards:** sprite glyph (decision 8), name, HP bar, status badges,
  description. **Party cards:** initial-letter avatar, name, "(You)" on the
  player, HP bar, status badges. At 0 HP a card greys out with a skull.
- **HP bars** show "current/max". Party: green above 50%, yellow above 25%, red
  below. Enemies: red, orange, light red. Defeated: grey.
- **Status badges:** emoji and turns left; tooltip "name (N turns)".
- **Combat log:** starts with "Combat begins!"; new lines appear one at a time
  (about every 350 ms) and it scrolls to the newest. Kinds: system, "You: …",
  enemy action, ally action, narration, each its own color.
- **Your Actions:** **Attacks** (one button each, marked single-target, AoE or
  both), **Items** (one button each), and **Custom Action** (text box
  "Describe what you do...", send button, Enter sends, empty can't send). With
  no party: "Waiting for combat data...". With the player missing or at 0 HP:
  "You have been defeated..." and no controls.
- **Select Target:** AoE attacks offer only "All Enemies"; "both" offers All
  Enemies, "or", then single targets; single-target attacks and all items offer
  each living enemy and party member, with HP. Cancel or tapping outside closes
  it.
- **Header:** "Conclude" while the fight runs, and a close button (X).

## Turns

There's no initiative order. Each player action is one round: the player acts,
then the model decides every enemy and ally action in the same call.

- **Action text:** "Uses <attack or item> on <target>!", "Uses <attack>
  targeting all enemies!", or the custom text. The log gets "You: <text>" at
  once. While the turn resolves, the controls give way to "Processing
  action..." and nothing else can be sent.
- **The model is told** it's the game master and must not play the persona. It
  gets the characters, persona and spellbook, recent history, this fight's
  earlier rounds, the current state (environment; each combatant's HP,
  attacks, items, statuses; enemy descriptions), the action, the JSON shape and
  the end rules (all enemies down is victory, all party down is defeat).
  Narration follows the combat style, stays under 150 words, has no asterisks,
  and uses the chat's language.
- **Applying a turn:** the returned party, enemies and player actions replace
  the current ones after the checks below. The log gets "Name: action" per
  enemy action, the same per ally action, then each non-empty narration line.
- **The fight record:** each round keeps the action text plus the enemy and
  ally lines, and the narration (or "Action resolved"). Later turns and the
  summary read it.
- **Items and statuses** change only through what the model returns
  (decision 2).
- **A bad turn** (unparseable output or a failed call) shows "AI returned an
  invalid response. Try again." under the controls and changes nothing. It
  never falls back to made-up results.

## Ending

- **The fight ends** when a turn reports a `victory`, `defeat` or `fled`
  result (decision 1), or on **Conclude**, confirmed ("Conclude Encounter",
  "Conclude this encounter early?", button "Conclude"), which ends it as
  `interrupted`.
- **End screen:** VICTORY (trophy), DEFEAT (skull), FLED (running figure) or
  INTERRUPTED (flag); then "Generating combat summary..."; then "Combat summary
  has been added to the chat." with **Close Combat Window**, or "Failed to
  generate summary." with **Close Anyway** (decision 6).
- **X** asks "End Combat" / "Close and end this combat?" (button "End Combat")
  and throws the encounter away. Before the end, no summary is written. Once
  the fight has ended (the end screen shows), X and Escape close the window
  without asking.
- **The summary call** gets the characters and persona (no chat history), the
  result, every round (or "No detailed combat rounds were recorded.") and the
  summary style. It asks for a narrative summary of the whole fight, the
  player's actions in indirect speech, dialogue only if the record has it, and
  only the summary text. Leading thinking blocks and a `[FIGHT CONCLUDED]`
  marker are removed; an empty result is a failure.
- **Writing back:** one new chat message (see "Saved data"), then the chat's
  message list refreshes. A failed summary writes nothing. Nothing else in the
  chat changes: no metadata, tracker state or memories.

## Leaving, reloading, errors

- **Switching chats** hides the overlay; the encounter stays with its chat. A
  pending call is cancelled (decision 5) and its late result ignored: a pending
  setup drops the encounter; a pending turn leaves the fight with "Encounter
  action canceled when you left this chat."; a pending summary shows the
  summary failure.
- **Coming back** shows the encounter where it was, with its whole log
  (decision 9).
- **Late results** from a call that's no longer current (closed, replaced, or a
  newer call started) never change state.
- **Reload, closing the app, logout and profile switch** drop the encounter.
- **A crash in the overlay** shows "Combat Error", "Something went wrong during
  combat. This is usually caused by the AI returning unexpected data." and
  **Close Encounter**, instead of breaking the app.
- **Reduced motion:** the overlay follows the app's `prefers-reduced-motion`
  rules through the shared motion classes.
- **Keyboard today:** Enter sends a custom action. There's no Escape, focus
  handling or dialog labeling (decision 11).

## Model calls

### The seam

All three calls go through **one engine function** in the encounter module,
which takes the call kind (setup, turn, summary), the chat, the messages, the
parameters and an abort signal, and returns the text. Only it picks the
connection.

**Connection, unchanged:** `resolveGenerationConnection` with no override: the
chat's `connectionId` (`"random"` draws from the random pool on every call),
else the app default, else the first enabled connection. The `combat` agent's
own connection setting isn't used.

| Call    | Temperature | Max output tokens |
| ------- | ----------: | ----------------: |
| Setup   |         0.8 |            12,000 |
| Turn    |         0.8 |             8,192 |
| Summary |         0.9 |             8,192 |

No encounter-specific timeouts or retries: the user retries by hand. Closing
or replacing the encounter, switching chats, and the session reset abort a
running call through its signal (decision 5).

### Context

- **Persona:** the chat's `personaId`, else the active persona: name,
  description, personality, backstory, appearance. With `personaStats` enabled:
  each bar's max, and max HP from a bar named HP, Health, Hit point or Hit
  points (any case).
- **Characters:** each of `characterIds`: name, description, personality,
  scenario, and with RPG stats enabled, max HP and attributes.
- **Tracked context:** location, weather, time, date; inventory; the player's
  STR, DEX, CON, INT, WIS, CHA; present characters with mood and action.
- **Spellbook:** each enabled entry's name and text.
- **Recent history:** the last N messages (`historyDepth`, 8, at least 1),
  skipping ones hidden from the AI and empty ones; assistant and system roles
  kept, everything else sent as user.

### Response contract

Setup and turn expect one JSON object, maybe fenced or in loose text, after
removing leading thinking blocks. Parse it with `parseGameJsonish`. The setup
object may sit under `combatState`, the turn object under `result`.

- **Setup:** `party[]`, `enemies[]`, `environment`, `styleNotes`
  (`environmentType`, `atmosphere`, `timeOfDay`, `weather`).
- **Turn:** `combatStats` (`party[]`, `enemies[]`), `playerActions`
  (`attacks[]`, `items[]`), `enemyActions[]` (`enemyName`, `action`, `target`),
  `partyActions[]` (`memberName`, `action`, `target`), `narrative`, and on the
  last turn `combatEnd: true` and `result`.
- **Party member:** `name`, `hp`, `maxHp`, `attacks[]`, `items[]` (strings),
  `statuses[]`, `isPlayer`. **Enemy:** `name`, `hp`, `maxHp`, `attacks[]`,
  `statuses[]`, `description`, `sprite`.
- **Attack:** `name`, `type` (`single-target`, `AoE`, `both`), optional
  `description`, `power`, `cooldown`, `element`, `statusEffect`.
- **Status:** `name`, `emoji`, `duration`, optional `modifier` and `stat`
  (`attack`, `defense`, `speed`, `hp`).
- **Result:** `victory`, `defeat`, `fled` or `interrupted`.

**Checks:** numbers may come as numeric strings. `maxHp` must be positive, else
the previous value (or 1). `hp` is clamped to 0 to `maxHp`; missing keeps the
previous value (full at setup). Attacks, statuses and items without a name are
dropped; an unknown attack type becomes `single-target`; an unknown `stat` is
dropped; a missing `duration` is 1. Enemy and ally actions without a name or
action text are dropped. A missing name keeps the previous one ("Unknown" or
"Enemy" when new). Exactly one party member is the player (decision 4).

### Debug output

With the app's debug mode on, the setup call sends three entries to the agent
debug log, level `debug`, phase `roleplay-encounter-init`:
`[debug/roleplay/encounter:init] request` (chat id, connection override, history
count, settings, messages), `[debug/roleplay/encounter:init] raw response`
(chat id, length, raw text) and `[debug/roleplay/encounter:init] parsed response`
(chat id, checked state). Turns and summaries send none.

## The Combat agent

Its catalog entry stays exactly as it is, in TypeScript and Rust: id `combat`
(`BUILT_IN_AGENT_IDS.COMBAT`), name "Combat", description "Manages combat
encounters, initiative, HP tracking, and turn-based actions.", phase
`parallel`, `enabledByDefault: false`, category `misc`, default tools
`roll_dice` and `update_game_state`, result type `game_state_update`, and a
JSON-output agent.

When enabled, it runs after each reply and reports the fight state in the
latest message. Rewrite its default prompt in your own words with the same
output fields, because saved agent runs and users' edited prompts expect them:
`encounterActive` (boolean), `event` (`none`, `start`, `turn`, `end`),
`roundNumber`, `currentTurn`, `lastAction`, `summary`, and `combatants[]` with
`id`, `name`, `hp` (`current`, `max`), `status` (`active`, `unconscious`,
`dead`, `fled`), `conditions[]` and `initiativeOrder`. Its rules: only real
fighting counts, not threats; estimate HP from how bad a hit sounds; with no
fight, return the inactive empty state; keep continuity with its last state;
keep fled or unconscious combatants with an updated status.

Nothing reads these fields. Its `game_state_update` result goes through the
world-state rules, which find no world-state fields in it. With chat tools on,
it can still call its tools. The overlay ignores it. See decision 12.

## Saved data

| What            | Exact contract                                                                                                         | Rule                                    |
| --------------- | ---------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| Agent           | `combat` as above: `agents` rows by `type`, chat metadata `activeAgentIds` and `enableAgents`, `settings.enabledTools` | Unchanged. Edited prompts keep working. |
| Summary message | chat message `role: "assistant"`, `characterId: null`, `content`; no `extra`                                           | Same shape as old summaries.            |
| Encounter state | none: no browser storage, no persisted store, no chat metadata                                                         | Memory-only. No old encounters to load. |

**Read, never written:**

- chat `personaId`, `characterIds`, `connectionId`,
  `metadata.gameCharacterCards`, `metadata.gameMap.name`;
- persona `name`, `description`, `personality`, `backstory`, `appearance`,
  `isActive`, `personaStats.enabled`, `personaStats.bars[].name` and `.max`;
- character `data.name`, `.description`, `.personality`, `.scenario`,
  `data.extensions.rpgStats.enabled`, `.hp.max`, `.attributes[].name` and
  `.value`;
- world state `location`, `weather`, `time`, `date`,
  `playerStats.inventory[].name` and `.quantity`, `playerStats.attributes.str`
  through `.cha`, `presentCharacters[].name`, `.mood` and `.action`;
- lorebooks with `category: "spellbook"`; entries `name`, `content`, `enabled`
  (missing means enabled);
- messages `role`, `content`, `extra.hiddenFromAI` or `extra.hiddenFromAi`.

Backups and exports carry nothing encounter-specific beyond summary messages.
The type names in `combat-encounter.ts` are internal and may change.

## Removed

- The made-up fallback turn (guessed damage from the action text, keyword
  matching for flee, defend and heal, invented narration). It only leaked into
  partial responses (decision 1).
- The unused setup fields `itemEffects`, `dialogueCues`, `mechanics` and
  `visuals`: no longer requested, ignored if sent. Style notes stay.
- The second round of response checks in the hook: check once, in the engine.

## Decisions

1. **Ending a fight.** A turn missing `combatEnd` or `result` borrows them from
   the made-up fallback turn, so "I try to escape the grapple" can end the
   fight as fled, and guessed damage can declare a victory. Recommended: end
   only on `combatEnd: true` with a valid result, or when every enemy is at 0
   HP (victory) or every party member is (defeat). **Agreed.**
2. **Empty lists.** An empty `items` or `statuses` list is ignored, so the last
   potion never goes and statuses never wear off. Recommended: empty means
   empty; only a missing field keeps the old value. **Agreed.**
3. **Matching combatants.** Returned combatants are matched by position: one
   the model leaves out vanishes, and a new one past the end inherits the
   player's name, items and player flag. Recommended: match by name (any case),
   keep left-out combatants unchanged, add new ones as non-players. **Agreed.**
4. **One player:** the first member flagged `isPlayer`, else the one named like
   the persona, else the first. Bug fix.
5. **Real cancelling.** Cancelled calls keep running, and a cancelled summary
   is still written to the chat while the overlay says it failed. Recommended:
   abort the call, and write the summary only if it's still current when the
   model answers. **Agreed.**
6. **Summary retry.** Recommended: **Try again** beside Close Anyway, reusing the
   fight record. **Agreed.**
7. **Unused setup fields:** stop requesting them. Shorter prompt, nothing
   visible.
8. **Enemy glyph.** `sprite` is shown as large text, usually the word "enemy".
   Recommended: ask for one emoji, and show 👹 when the value isn't one. **Agreed.**
9. **Log after remount.** The visible log resets to "Combat begins!" when the
   overlay remounts (switching chats and back), and the "You: …" line can be
   lost when a turn's lines arrive. Recommended: keep the visible log in
   encounter state and only append.
10. **Setup error wording.** A missing connection or provider error shows the
    same "could not create a valid combat encounter" message as junk output.
    Recommended: show the real cause for those; keep the generic one for junk.
    **Agreed.**
11. **Accessibility.** Recommended: mark the overlay and dialogs as labeled
    dialogs, move focus in and back, name the X "End combat", let Escape cancel
    the setup and target dialogs, and let Escape on the overlay ask the "End
    Combat" question while the fight runs (after it ends, Escape just closes).
    **Agreed.**
12. **The background Combat agent** costs a model call per reply and nothing
    uses its answer. Recommended for this rebuild: keep it (same behavior, new
    prompt text). Stopping the per-reply run, or using its answer (like
    offering to start an encounter), is a separate change. **Agreed:** keep it
    for now.
13. **Wording.** Headings and buttons use Title Case ("Begin Combat", "Select
    Target"). Recommended: sentence case per the app's writing rules, same
    meaning. **Agreed.**
14. **Saving a fight in progress:** not in this rebuild. Memory-only, as today.

## Later, separate pull request: helper routing

**Done:** Helper Models now has an Encounters task (`encounters`), wired into
`requestEncounterText` as intended below. A broken route's message shows on the
setup failure screen, under the turn controls and on the summary failure;
scenes don't share the task.

Roadmap #1485, "Pick a model per task", lists "Later (#1267): scenes and
encounters". Connections > Helper Models already sends some background work to
its own connection (`src/engine/generation/model-routing.ts`; the Summarize chat
pick in `src/engine/modes/chat/core/summaries/summary-connection.ts` is a worked
example, and `noteHelperRun` records where each run went).

**This rebuild** keeps today's connection and sends all three calls through the
one seam with the call kind passed in, so the follow-up only changes the seam.

**The follow-up's intent** (not designed here): an encounters task in Helper
Models. Unrouted, encounters keep today's connection. Routed, all three calls
use that connection and never fall back: a broken route stops with the route's
message where today's errors show. "Keep on my device" works as for the other
tasks, and each run is noted so Helper Models can say where it ran. Whether
scenes share the task is for the follow-up.

## Tests

Keep these behaviors as tests, rewritten against the new module:

- Setup and turn calls read no more than `historyDepth` recent messages.
- Unparseable setup output fails and starts no fight.
- A failed summary writes no message.
- With debug mode on, setup sends the three debug entries, in order.
- A late setup, turn or summary result never changes a newer encounter, in the
  same chat or after switching chats.
- Switching chats during a pending call settles state as in "Leaving,
  reloading, errors", and a late answer doesn't undo it or refresh messages.
- The session reset (`client-session-reset.spec.ts`) leaves no encounter
  active or processing. Update that test to the new store.

No current encounter test reads source files as text. Drop the assertions on
internal counters (`requestId`, `beginRequest`) and test what the user sees.

## Acceptance checks

1. The Encounter button shows only in Roleplay chats with `combat` enabled,
   never in a concluded scene, Conversation or Fanfic.
2. The setup dialog has the defaults listed and lists only spellbooks. Cancel
   makes no model call.
3. Begin Combat makes one setup call on the chat's connection with the
   parameters in the table. Junk output shows the error; Retry calls again.
4. A setup answer without enemies shows "Enemy 1" at 18/18 HP; without a
   party, the player has the persona's name and HP bar max.
5. Target choices match the attack type, and items list living enemies and
   party members.
6. Each action adds "You: …" at once, hides the controls while it resolves,
   then adds enemy, ally and narration lines.
7. A junk turn shows the invalid-response message and changes nothing.
8. A turn bringing every enemy to 0 HP ends as a victory; a turn without
   `combatEnd` and with enemies standing never ends the fight, whatever the
   action text (decision 1).
9. Using the last item removes it; an expired status disappears (decision 2).
10. A combatant the model leaves out stays; a new one never becomes the player
    (decisions 3 and 4).
11. Conclude, confirmed, ends as INTERRUPTED and writes a summary.
12. After any ending, exactly one assistant message with `characterId: null`
    and the cleaned summary appears, and nothing else in the chat changes.
13. A failed summary writes nothing and offers Try again and Close Anyway.
14. Switching chats mid-turn and back shows the cancel message and the full
    log. Switching mid-summary writes no message later (decision 5).
15. X, confirmed, mid-fight writes nothing. Reload, logout and profile switch
    leave no encounter behind.
16. With reduced motion on, the overlay and dialogs appear without animation.
17. All three calls pass through the one seam; nothing else in the module picks
    a connection or calls the LLM gateway.
18. The `combat` catalog entry, tools and result type are unchanged in
    TypeScript and Rust, and an agent row with an edited prompt still runs.
19. The embedded app and a hosted install behave the same.
20. `pnpm typecheck`, `pnpm check:architecture` and the rewritten tests pass,
    and the old files in "Scope" are gone.
