# Chat Setup Wizard: Behavior Spec

Status: agreed 2026-11-18, every decision as recommended. Part of the code provenance
plan (`docs/code-provenance-plan.md`, tracked in #1580).

This spec describes what the new-chat setup must do. It is the only input the
builder uses for the setup parts. It describes behavior, not the old
implementation.

## Rules for the builder

Build from this spec and the team-owned code around it. Don't open, search, or
read the history of the old implementation:

- `src/features/modes/shared/chat-ui/components/ChatSetupWizard.tsx`

You may read every interface listed under "Neighbors". The current test,
`ChatSetupWizard.spec.tsx`, is team-owned and may be read, but rewrite it
against the new module. If this spec doesn't answer a question, ask the spec
writer.

## Scope

Lines not yet team-owned, from `pnpm report:provenance --fast` at `1b32210e7`:

| File                                                               | Not owned | Of lines |
| ------------------------------------------------------------------ | --------: | -------: |
| `src/features/modes/shared/chat-ui/components/ChatSetupWizard.tsx` |     1,170 |    1,650 |

**Test to rewrite** (team-owned): `ChatSetupWizard.spec.tsx`.

### Neighbors (not rebuilt)

- **Mounting:** `ChatCommonOverlays.tsx` lazy-loads the module and mounts
  `ChatSetupWizard` with `chat`, `onFinish` and `onCancel`. Keep that export
  name and those props (or update the one import).
- **Leaving:** `use-new-chat-draft.ts` owns what `onFinish` and `onCancel` do:
  a new chat nobody used (no characters, no messages) is deleted; otherwise
  setup just closes. `onCancel` also deletes a new chat with no messages yet.
- **Quick setup entry:** `chat.store.ts`'s `shouldOpenWizardInShortcutMode`
  flag, set by `use-chat-overlays.ts` when a new chat's setup intent asks for
  it (onboarding starting a chat from a character does). Setup reads it once
  when it opens and clears it.
- **Pieces it uses:** `CharacterPickerEmptyState.tsx` (empty, no-match,
  loading, error and all-added states, create, import and starter characters)
  and `chat-setup-start.ts` (`createChatSetupStartGate`, the Conversation start
  sequence), both team-owned; `RoleplayWorkflowProfileChooser`
  (`onPendingApplyChange`, `onNavigateAway`, `entryPoint="wizard"`);
  `ChoiceSelectionModal`; `GenerationParametersFields`,
  `getEditableGenerationParameters`, `parseEditableGenerationParameters`,
  `CHAT_PARAMETER_DEFAULTS`, `ROLEPLAY_PARAMETER_DEFAULTS`,
  `serviceTierOptionsForProvider`; the character, persona, preset, chat preset,
  lorebook and connection hooks and avatar components from the catalog
  packages; `characterAvatarUrl`, `estimateCharacterCardTokens`,
  `getInlineCardTokenWarning`; `parseCharacterDisplayData`,
  `getCharacterTitle`, `normalizeChatCharacterIds`;
  `lorebookCanBeSelectedForContext`; `filterLanguageGenerationConnections`,
  `isConnectionReadyToReply`; `generateConversationSchedules`,
  `maybeRefreshConversationStatusMessages`; `ROLEPLAY_STARTER_CHARACTERS`;
  `useApplyChatPreset`; the chat update, metadata and message hooks;
  `storageApi.get` and `storageApi.addChatMessageSwipe`; the UI store
  (`customConversationPrompt`, `scheduleGenerationPreferences`,
  `openRightPanel`, `openModal`, `modal`); `motionStyle`.
- `resolveGenerationConnection`: a chat without a connection replies with the
  app's default connection, else the first enabled one (decision 6).

## The shape

- **One component, two layouts by chat mode:** Conversation chats get a
  one-page **New conversation** card; every other mode (Roleplay, and the
  legacy visual novel) gets the **step-by-step Roleplay wizard**, which can
  switch to a one-page **Quick setup**.
- **It edits the open draft chat directly.** Every pick saves at once (chat
  fields and metadata), so the chat behind the overlay is always the truth and
  nothing is lost if setup closes. The only values held back until the end are
  custom generation parameters (and the Conversation toggles).
- **It overlays the chat:** a dimmed, blurred backdrop over the chat area and a
  centered card (up to `max-w-lg`; the workflow step is wider). On phones it
  respects the safe areas and fits the screen height; the card scrolls inside.
- **Leaving:** Skip and finishing call `onFinish`; the close button, Escape,
  tapping the backdrop and any "go elsewhere" action call `onCancel` (falling
  back to `onFinish` when no `onCancel` is given).

## Shared pieces

### Persona picker

- Lists every persona with avatar (or initial), name, and a second line with
  its title (`comment`) and "Your default persona" for the active persona.
- **The pick shown** is the chat's `personaId`, else the active persona: a
  chat without a persona speaks as the active one. "None" (Stay anonymous) is
  offered only when there's no active persona.
- Picking saves `personaId` at once. With no personas: "No personas created
  yet."

### Character list

- **Source:** the character summaries hook with the search text (debounced
  about 180 ms), merged with the chat's own characters by id so selected ones
  always show.
- **Search** matches every word (any case) against id, name, title, creator,
  creator notes, version and tags.
- **Rows:** avatar (or initial), name, italic title, a token-size warning
  badge when the card is large (`getInlineCardTokenWarning`), and an add icon.
  Selected characters are left out of the list.
- **Empty states** come from `CharacterPickerEmptyState` with: whether a
  search is active, whether the unfiltered library has characters (a second,
  unfiltered query runs only while searching), pending (fetching, or the
  search not yet debounced), error, and whether any character is unselected.
  Its create action adds the new character to this chat; its import action
  opens the import dialog over setup; its "open Characters" action opens the
  Characters panel and leaves setup through `onCancel`.

### Generation parameters

A **Customize parameters** switch, off by default (on when the chat's
`metadata.chatParameters` already holds valid parameters). Help text: leave it
off to use the connection's saved defaults. On, it shows
`GenerationParametersFields` filled from the chat's saved parameters over the
connection's defaults (Conversation defaults for Conversation, Roleplay
defaults otherwise), with the connection provider's service tiers. Its value is
saved as `chatParameters` when setup finishes (the parameters, or null when the
switch is off). It follows changes to the connection.

### Connection picker

A select of language-generation connections (`filterLanguageGenerationConnections`)
plus "🎲 Random" (`"random"`) and a no-connection option (decision 6). Picking
saves `connectionId`. With no connections, a **Set up a connection** button
opens the Connections panel and leaves setup (Conversation: `onFinish`;
Roleplay: `onCancel`, decision 7).

## New conversation (Conversation chats)

One card, titled "New conversation" with a message icon and a close button.

- **On open:** if the UI store has a saved custom conversation prompt, save it
  to the chat's metadata as `customSystemPrompt` at once. If the chat has no
  connection and connections exist, pick the first one ready to reply
  (`isConnectionReadyToReply`), else the first one.
- **Name:** a text box with the chat's name. Leaving the box with a different,
  non-empty name saves it and stops auto-naming.
- **Connection**, then **Your persona**, then the characters: heading "Who do
  you want to message?" (with two or more: "Group chat · N members"), the
  selected characters as removable chips (avatar, name, token badge, remove
  icon; tooltip "name - title"), and the searchable list (search box focused
  on open). Empty text: "No characters yet. Create or import one before
  starting a conversation." / "All characters added."
- **Auto-naming:** until the name is edited, adding or removing a character
  renames the chat to the selected names joined by ", " ("New conversation"
  with none). Conversation adds no greeting messages.
- **Autonomous messages** switch (off): "Characters can message you first when
  you're inactive". When on, a **Generate schedule** switch (off): "Optional
  routines for availability and delayed replies".
- **Footer:** **Skip** (`onFinish`) and **Start chatting**, enabled only with a
  connection and at least one character.
- **Start chatting** (one run at a time, through `createChatSetupStartGate`):
  shows "Starting...", then saves metadata `autonomousMessages`,
  `conversationSchedulesEnabled` (true only with both switches on),
  `chatParameters`, and the saved custom prompt; with schedules on, the footer
  shows "Generating schedule(s)… hang tight!" while
  `generateConversationSchedules` runs for the chat's characters with the
  user's schedule preferences; then `maybeRefreshConversationStatusMessages`
  (refreshing the character lists if any were refreshed; a failure toasts
  "Chat started, but character status blurbs couldn't be created." with the
  reason, and setup still finishes). Then it finishes: at once, or with
  schedules after showing "Ready! Say hi to start the conversation." for about
  2 seconds. A failed save or schedule run toasts the reason and returns to the
  normal footer.
- **Escape** closes (`onCancel`) unless a dialog opened from setup (like
  import) is on top, or the key press was already handled.

## Roleplay wizard (every other mode)

### Steps

Each step shows the De-Koi koi mark (`/koi-mark.svg`), a title, a line of
help, and its controls. The footer shows progress dots (current, done, ahead),
then: **Back** (icon, from step 2 on), **Skip** (`onFinish`), **Use settings
presets** (switches to Quick setup; "Presets" on narrow screens), and
**Next** / **Done**.

1. **Choose a connection:** "Which AI provider should this chat use? If you
   haven't set one up yet, you can do that from the Connections panel." The
   connection picker and generation parameters.
2. **Pick a preset:** "A preset is the set of writing instructions the AI
   follows. The default works well for most chats, so you can just press
   Next." A select of prompt presets plus "None"; picking saves
   `promptPresetId`. When the chat has no preset and a default preset exists,
   setup picks it on open. **Next** waits while the picked preset's details
   load; if the preset has choice blocks, Next opens `ChoiceSelectionModal`
   (for this preset and chat) instead, and closing that modal moves on.
3. **Select your persona:** "Your persona tells the AI who you are. Pick one
   or skip to stay anonymous." The persona picker.
4. **Add characters:** "Characters bring your chat to life! Add one or more
   characters for the AI to roleplay as." Added characters as rows (avatar,
   name, title, token badge, remove button "Remove"), then the searchable
   list. Empty text: "No characters yet. Pick one to start with, or make or
   import your own." / "All characters already added.", and the empty state
   offers the starter characters (`ROLEPLAY_STARTER_CHARACTERS`).
5. **Attach lorebooks:** "Lorebooks are notes about your world (places,
   people, history) that the AI reads when they come up. Optional, so you can
   press Next." Attached lorebooks as rows with a remove button, then a
   searchable list (name contains the search, any case) of lorebooks that can
   be attached here (`lorebookCanBeSelectedForContext` with the chat, its
   characters and its persona) and aren't attached. Toggling saves
   `metadata.activeLorebookIds`. With nothing to attach and nothing attached:
   "No lorebooks yet. They are optional, so you can press Next to skip this
   step." Otherwise an empty list says "All lorebooks already added." or "No
   matches." (decision 3).
6. **Choose a workflow profile:** "Optional extras for longer or more visual
   stories. To start chatting now, press Done. If you pick one, Done becomes
   Apply & finish." `RoleplayWorkflowProfileChooser` with `entryPoint="wizard"`;
   its navigate-away leaves setup through `onCancel`; the card is wider on
   this step.

Moving between steps clears both searches. Characters load only on the
characters step (and in Quick setup).

### Adding characters

- **Auto-naming:** adding or removing a character renames the chat to the
  selected names joined by ", " ("New roleplay" with none). The wizard has no
  name box.
- **Greeting:** after adding a character is saved, setup reads the full card;
  if it has a first message (`data.first_mes`), it adds an assistant message
  with that text for the character, then each non-empty alternate greeting
  (`data.alternate_greetings`) as an inactive swipe on it, and refreshes the
  messages. A failure toasts "Couldn't add the character's greeting. Try
  again." (decision 1 for removing).

### Finishing

- **Done** on the last step saves `chatParameters` and finishes. With a
  workflow profile picked, the button says **Apply & finish** and first applies
  it (with a spinner, Next disabled meanwhile); if the apply reports failure,
  setup stays open.
- **Skip** finishes without saving the parameters (decision 4).

### Quick setup

A one-page card titled "Quick setup" (wand icon) with Back (arrow) and Close.
Help: "Pick a preset, your persona, and any characters to instantly configure
this roleplay."

- **Chat preset:** a select of the Roleplay chat-settings presets (the default
  one listed as "Default"). It starts on the preset this chat last applied
  (`metadata.appliedChatPresetId`), else the user's starred preset, else the
  default. While the list loads: "Loading…".
- **Persona** picker and **Characters** (heading "Characters", or
  "Characters · N"), with chips and the searchable list. Empty text: "No
  characters yet. Create or import one before applying setup." / "All
  characters added." Adding a character adds its greeting as above.
- **Footer:** **Back** returns to the step-by-step wizard; **Apply & start**
  (disabled without a preset or while applying; "Applying…" with a spinner)
  applies the chat preset to this chat, then finishes. A failure toasts the
  reason (or "Couldn't apply the chat preset. Try again.") and stays open.
- **Only the newest apply counts:** going Back, closing, switching to another
  chat or closing setup while an apply runs means its result never finishes
  setup; a second apply can't start while one is still pending.
- Escape doesn't close setup while Quick setup or the choice modal is open
  (decision 5).

### Escape

In the step-by-step wizard, Escape closes setup (`onCancel`) unless Quick
setup or the choice modal is showing (decision 5).

## Saved data

| What                 | Exact contract                                                                                                                                                 | Rule                 |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| Chat fields          | `name`, `characterIds`, `connectionId` (an id, `"random"` or null), `personaId`, `promptPresetId`                                                              | Saved on each pick.  |
| Chat metadata        | `activeLorebookIds`, `chatParameters` (object or null), `customSystemPrompt`, `autonomousMessages`, `conversationSchedulesEnabled`; read `appliedChatPresetId` | Same keys.           |
| Greeting             | assistant message `{ role: "assistant", content: first_mes, characterId }`, alternate greetings as inactive swipes                                             | Same shape.          |
| Chat preset, choices | through `useApplyChatPreset` and `ChoiceSelectionModal`                                                                                                        | Their own contracts. |

Read, never written: character `data.name`, title fields, `first_mes`,
`alternate_greetings`, tags, creator fields, `extensions.avatarCrop`; persona
`name`, `comment`, avatar fields, `isActive`/`active`; connection `id`, `name`,
`provider`, `defaultParameters`, readiness; lorebook `id`, `name`, scope; chat
preset `id`, `name`, `isActive`/`active`, `isDefault`/`default`.

## Removed

- The unused `spriteFlip` option on steps, the unused `userEditedName` state in
  the Roleplay wizard, and the three hand-copied character lists (one shared
  list component serves all three layouts).

## Decisions

1. **Duplicate greetings.** Adding a character adds its greeting; removing the
   character leaves the greeting, so add, remove, add again gives two
   greetings, and a removed character's greeting stays in the chat.
   Recommended: removing a character during setup also deletes the greeting
   message setup added for it (only while the chat has no other messages from
   the user). **Agreed.**
2. **Toggles say what they are.** The Customize parameters, Autonomous
   messages and Generate schedule switches are plain buttons. Recommended:
   switches (`role="switch"`, `aria-checked`) named by their label. **Agreed.**
3. **A stale lorebook.** A lorebook id still attached to the chat after the
   lorebook was deleted shows nothing in the attached list, but makes the step
   say "All lorebooks already added." when there are none (the #1485 report).
   Recommended: ignore ids with no lorebook for every message on this step. **Agreed.**
4. **Skip drops parameters.** Turning on Customize parameters, then Skip, loses
   the parameters. Recommended: keep it; Skip means "leave the rest as it is".
   No change. **Agreed.**
5. **Escape in Quick setup** does nothing today. Recommended: Escape in Quick
   setup goes Back to the wizard (like its Back button), and Escape in a
   dialog opened from setup only closes that dialog. **Agreed.**
6. **"None" connection.** The no-connection option says "None", but a chat
   without a connection replies through the app's default connection.
   Recommended: label it "Default (<connection name>)", or "Default" when
   there's no default to name. **Agreed.**
7. **"Set up a connection" in Conversation** leaves through `onFinish`, the
   Roleplay one through `onCancel`. Recommended: both use `onCancel` (the
   tested rule for every "go elsewhere" action). **Agreed.**
8. **Dialog semantics.** Recommended: both cards are labeled dialogs
   (`role="dialog"`, `aria-modal`, named by their title), focus moves in on
   open and back on close, Tab stays inside, and the character chips' remove
   action has an accessible name ("Remove <name>"). **Agreed.**
9. **Wording.** Titles and buttons are Title Case ("Choose a Connection",
   "Start Chatting", "Use Settings Presets", "Apply & Start"). Recommended:
   sentence case per the app's writing rules, same meaning. **Agreed.**

## Tests

Keep these behaviors as tests, rewritten against the new module:

- A new conversation gets a connection that can reply, not a half-finished one
  listed first.
- Roleplay exits: the backdrop, "Set up a connection", "open Characters" (from
  the wizard and Quick setup), the workflow chooser's navigate-away and Escape
  use `onCancel`; Skip and Done use `onFinish`.
- Creating a character inside the empty Characters step adds it to this chat;
  picking a starter character adds it with its greeting.
- Lorebook messages: "No lorebooks yet" with none, the list with some, no
  "none" claim while one is attached, and decision 3's stale id.
- Import opens over setup; Escape closes that dialog without closing setup.
- The workflow step's help names the Done button; a picked profile is applied
  before finishing; a failed apply keeps setup open.
- Quick setup finishes only after the preset is saved; a cancelled, backed-out,
  switched-chat or unmounted apply never finishes setup; no second apply while
  one is pending; a rejected apply shows its error and stays open.
- New: decisions 1, 5, 6 and 7.

The current test doesn't read source files as text. Test what people see and
what's saved.

## Acceptance checks

1. A new Conversation opens the one-page card with a ready connection picked,
   the search box focused, and Start chatting disabled until a character is
   added.
2. Adding two characters names the chat "A, B" and shows "Group chat · 2
   members"; editing the name stops renaming.
3. Start chatting saves the toggles and parameters, creates status blurbs, and
   closes; with schedules on it shows the generating and ready lines first.
4. A new Roleplay opens the six-step wizard with the default preset picked;
   Back, Skip, Next and the dots work, and Next waits for a preset's details.
5. A preset with choice blocks opens the choice modal on Next, and closing it
   moves on.
6. Adding a character with a greeting and alternates adds one message with
   swipes; removing that character removes it (decision 1).
7. The lorebook step lists only lorebooks that can be attached here, and never
   says "All lorebooks already added." when there are none (decision 3).
8. Done applies a picked workflow profile, then finishes; a failed apply stays
   open.
9. Use settings presets opens Quick setup with the right preset picked; Apply &
   start applies it and finishes; Back during an apply never finishes setup.
10. Escape closes setup from the wizard and the Conversation card, goes back
    from Quick setup, and only closes a dialog opened over setup (decision 5).
11. Closing an untouched new chat's setup deletes the draft; Skip with
    characters keeps the chat (through `use-new-chat-draft.ts`).
12. With no connections, Set up a connection opens Connections and leaves
    setup through `onCancel` (decision 7).
13. Keyboard only: focus moves in, Tab stays inside, every control has a name,
    the switches announce on/off (decisions 2 and 8).
14. Phone width and the Pond, Default and SillyTavern themes in light and dark
    look right; the card scrolls inside the screen.
15. `pnpm typecheck`, `pnpm check:architecture` and the rewritten test pass,
    and the old file is gone.
