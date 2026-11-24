# Preset Sections Tab: Behavior Spec

Status: draft 2026-11-23. Part of the code provenance plan
(`docs/code-provenance-plan.md`, tracked in #1580). Second slice of the preset
editor (`PresetEditor.tsx`); the first was the Preset Variables list
(`docs/provenance/preset-variables.md`). The overview and AI review parts
follow as their own slices.

This spec describes the **Sections** tab of the preset editor: the toolbar
(Add Section menu, Groups button, lorebook warning), the groups panel, the
list of prompt sections with their editors, the expanded prompt editor and the
macros reference. The Preset Variables list under it is already rebuilt and is
only rendered here. This spec is the only input the builder uses. It describes
behavior, not the old implementation.

## Rules for the builder

Build from this spec, the recordings, the screenshots and the team-owned code
around it. Don't open, search, or read the history of the old implementation:

- `src/features/catalog/presets/components/PresetEditor.tsx`

You may read every interface listed under "Neighbors". If this spec doesn't
answer a question, ask the spec writer.

**Safety.** The tab sends no model requests. What it saves is the preset's
prompt: each section's content, role, position, depth, group and on/off state
decide what text is sent to the model in every chat that uses the preset, and
in which order. So every save call is a compatibility contract and must stay
exactly the same, including which calls happen, in which order and with which
payload (key order included). Someone other than the builder records the old
tab as a black box first (see "Black-box recording plan"); the recordings
become tests, and the builder sees the recordings, never the old code. Where
this text and a recording disagree, the recording wins, except where a
decision below changes the behavior on purpose; tell the spec writer so the
spec gets fixed.

## Scope

The Sections tab code in `src/features/catalog/presets/components/PresetEditor.tsx`
(about 1,050 lines: the tab, the section content textarea, the expanded editor
dialog, the macros reference dialog, the section name input, and the small
helpers only they use). The rest of the file stays as it is in this slice.

The new module lives in `src/features/catalog/presets/components/preset-sections/`
and exports `PresetSectionsTab`. `PresetEditor.tsx` renders it where it
rendered the old tab, with the same props, and the old code is deleted from
`PresetEditor.tsx` in the same change. The spec writer makes that edit (the
builder doesn't open the file).

### Props (the contract with `PresetEditor.tsx`)

- `presetId: string`
- `sections: PromptSectionRow[]`: the preset's sections in `sectionOrder`
  order (sections not in the order are left out). A row has `id`,
  `identifier`, `name`, `content`, `role`, `enabled`, `isMarker`,
  `forbidOverrides` (booleans or `"true"`/`"false"` strings), `groupId`,
  `markerConfig` (an object, JSON text, or `null`), `injectionPosition`,
  `injectionDepth`, `injectionOrder`. Rows come from storage as stored, so any
  field can be missing or odd.
- `groupMap: Map<string, PromptGroup>`: the preset's groups by id, in stored
  order.
- `choiceBlocks`, `onCreateVariable`, `onUpdateVariable`, `onDeleteVariable`,
  `onReorderVariables`: passed unchanged to `PresetVariablesEditor` (from
  `../preset-variables`), rendered last.
- `wrapFormat: WrapFormat`: accepted and not used.
- `onCreateSection`, `onUpdateSection`, `onDeleteSection`,
  `onReorderSections`, `onCreateGroup`, `onUpdateGroup`, `onDeleteGroup`: the
  mutation objects from `use-presets.ts`. The tab calls `mutate(…)`, except
  **Duplicate**, which uses `onCreateSection.mutateAsync` and
  `onReorderSections.mutateAsync`; it reads `onCreateSection.isPending` and
  `onReorderSections.isPending`.
- `hasLorebookMarker: boolean`, `parentChatHasLorebook: boolean`: worked out
  by `PresetEditor.tsx`; they only decide the lorebook warning.

### Neighbors (not rebuilt)

- `src/features/catalog/presets/hooks/use-presets.ts`: the section and group
  hooks. Create parses with `createPromptSectionSchema` /
  `createPromptGroupSchema` (adding `presetId`), stores the row and appends its
  id to `sectionOrder` / `groupOrder`. Update parses with the update schema.
  Delete removes the row. Reorder sends the full id list and reorders the
  cached preset at once. Each refreshes the preset, which hands the tab new
  props.
- `src/engine/contracts/schemas/prompt.schema.ts` (section name 1 to 200
  characters, role `system`/`user`/`assistant`, position `ordered`/`depth`,
  depth a whole number from 0).
- `src/shared/hooks/use-mutation.ts`: a failed `mutate` with no `onError`
  shows the shared failure toast; `mutateAsync` doesn't.
- `src/features/catalog/agents/index` (`useAgentConfigs`), the source of the
  Agent Sections menu items.
- `src/engine/shared/macros/macro-engine.ts` (`SUPPORTED_MACROS`: `syntax`,
  `description`, `category`), the source of the macros reference.
- `src/shared/components/ui/DraftNumberInput.tsx`,
  `src/shared/components/ui/HelpTooltip.tsx`, `src/shared/lib/app-dialogs.ts`
  (`showConfirmDialog`), `src/shared/lib/error-message.ts` (`toUserMessage`),
  `sonner` (`toast`), `src/shared/lib/utils.ts` (`cn`), `lucide-react`.
- `src/features/catalog/presets/components/preset-variables/`
  (`PresetVariablesEditor`).

How chats use sections (for context, not rebuilt):
`src/engine/generation/prompt-assembly.ts` assembles the enabled sections top
to bottom (or at a depth from the end of the chat), replaces macros, wraps
grouped sections, and fills markers from characters, lorebooks, the persona,
the chat history and agent output.

## Reading a row

- **On** (enabled), **marker**: only `true` or `"true"` (a missing `enabled`
  shows the section as off).
- **Role**: `role`, else `system`. Icon and color: `system` a settings icon in
  blue, `user` a person icon in green, `assistant` a bot icon in purple; any
  other role the settings icon in the default color.
- **Marker config**: an object, or JSON text parsed to one, with a text `type`;
  anything else counts as none.
- **Marker label** by type: `character` Character Info, `lorebook` Lorebook
  Marker (All), `persona` Persona, `chat_history` Chat History, `chat_summary`
  Chat Summary, `world_info_before` Lorebook Marker (Before),
  `world_info_after` Lorebook Marker (After), `dialogue_examples` Dialogue
  Examples, `agent_data` Agent Data; any other type Unknown.
- **Group**: `groupMap.get(groupId)` when `groupId` is set.

## Toolbar

Left to right:

1. A help tooltip (right side): Everything we send to a model is just text. A
   prompt is a formatted, written instruction we send to the model. Each
   section below becomes part of the final prompt.
2. **Add Section** (purple gradient, plus icon) toggles the add menu.
3. **Groups (<n>)** (folder icon; `<n>` = number of groups) toggles the groups
   panel; sky-tinted while the panel is open.
4. The **lorebook warning**, when the preset has no lorebook marker
   (`hasLorebookMarker` false), the active chat has lorebooks
   (`parentChatHasLorebook` true) and it hasn't been dismissed for this preset:
   an amber box (warning icon) Add a lorebook marker when this preset should
   receive active lorebook entries. with a dismiss X (title and name
   `Dismiss warning`). Dismissing stores `"true"` under
   `preset:loreWarning:dismissed:<presetId>` in `localStorage` and hides it;
   the stored flag is read when the tab opens and when `presetId` changes. A
   storage error counts as not dismissed (reading) or is ignored (writing).

### Add menu

Opens under the button over a full-page click-catcher (clicking outside
closes it): **Prompt Block** (message icon), a divider, **Markers**, one item
per marker type except `agent_data` in the order of the labels above (layers
icon), and, when any agent from `useAgentConfigs()` has
`settings.injectAsSection === true`, a divider, **Agent Sections** and one
item `<agent name> (Agent)` (sparkles icon) per such agent, in list order.
Choosing an item closes the menu and creates:

- Prompt Block:
  `onCreateSection.mutate({ presetId, identifier: "section_<now>", name: "New Section", content: "", role: "system", isMarker: false, markerConfig: null })`
- Marker: `{ presetId, identifier: "<type>", name: "<label>", content: "", role: "system", isMarker: true, markerConfig: { type: "<type>" } }`
- Agent: `{ presetId, identifier: "agent_<agent type>", name: "<agent name, else type> (Agent)", content: "{{agent::<agent type>}}", role: "system", isMarker: true, markerConfig: { type: "agent_data", agentType: "<agent type>" } }`

Keys in those orders; `<now>` is `Date.now()`.

## Groups panel

A sky-tinted box: **Groups** and **New Group** (plus icon), which creates
`onCreateGroup.mutate({ presetId, name: "New Group" })`; the note Groups wrap
adjacent sections in a single XML/Markdown container. Assign sections to groups
below. With no groups: No groups yet. Create one to organize sections.
Otherwise one row per group in `groupMap` order:

- The name (title `Click to rename`); clicking it swaps it for a focused text
  input with the name. Enter blurs it; Escape leaves without saving; blur
  saves `onUpdateGroup.mutate({ presetId, groupId, name: <trimmed> })` when the
  trimmed text isn't empty (even if unchanged), then shows the name again.
- `<n> sections`: sections whose `groupId` is this group.
- A trash button: `showConfirmDialog({ title: "Delete Group", message: 'Delete group "<name>"? Sections will be ungrouped.', confirmLabel: "Delete", tone: "destructive" })`,
  then `onDeleteGroup.mutate({ presetId, groupId })` if confirmed.

## Section list

No sections: a layers icon and No sections yet. Add one to get started.
Otherwise one card per section; under the list (when there are sections)
Click to expand · Sections are assembled top-to-bottom. Then the Preset
Variables list.

Any number of cards can be expanded; which ones is kept by section id.

### A section's card

The card is faded when the section is off. Header, left to right:

1. A grip (title `Drag to reorder`), **Move up** / **Move down** arrows
   (titles `Move up` / `Move down`, names `Move <name> up` / `Move <name> down`;
   disabled on the first / last card and on every card while a reorder is
   pending). Moving sends the ids with that section moved one place:
   `onReorderSections.mutate({ presetId, sectionIds })`.
2. The chevron, the role icon, and the name (clicking the name or the chevron
   toggles the card).
3. **MARKER** pill for a marker; the group's name as a sky pill when it has a
   group; the role text, hidden below `sm`.
4. **Duplicate** (copy icon, title `Duplicate`, name `Duplicate <name>`;
   disabled while a create or a reorder is pending): see below.
5. The on/off eye (title `Disable` when on, `Enable` when off; green eye when
   on, crossed eye when off): `onUpdateSection.mutate({ presetId, sectionId, enabled: !on })`.
6. **Delete** (trash, title `Delete`): at once, with no confirmation:
   `onDeleteSection.mutate({ presetId, sectionId })`.

**Duplicate** awaits
`onCreateSection.mutateAsync({ presetId, identifier: "<identifier, else section>_copy_<now>", name: "<name, else Prompt Block> Copy", content: <content, else "">, role: <role, else "system">, enabled: <on>, isMarker: <marker>, groupId: <groupId, else null>, markerConfig: <marker config as read, else null>, injectionPosition: <position, else "ordered">, injectionDepth: <depth, else 0>, injectionOrder: <order, else index × 100>, forbidOverrides: <forbidOverrides read like on> })`.
When the result has an id, it awaits
`onReorderSections.mutateAsync({ presetId, sectionIds })` with the new id
placed right after the original, then expands the copy. Then
`toast.success('Duplicated "<name>"')` (also when the result had no id). A
failure anywhere shows `toast.error` with the error's user message, or
`Couldn't duplicate prompt block. Try again.`.

### Expanded body

1. **Name** (placeholder `Section name`) and a **role** dropdown (System,
   User, Assistant). The name input selects its text on focus; on blur, and on
   Enter (which then blurs), it saves the trimmed text
   `onUpdateSection.mutate({ presetId, sectionId, name })` when it isn't empty
   and differs from the stored name, else puts the stored name back. A new
   stored name replaces the text. Changing the role saves `{ role }` at once.
2. For a section that isn't a marker: the **content** editor (below).
3. For a marker with a marker config:
   - `agent_data`: a box Agent section: **<name>**, and The
     `{{agent::<agentType, else agent>}}` macro will be replaced with the latest
     output from the agent at assembly time. You can add additional
     instructions around it. Then the content editor showing the content, or
     `{{agent::<agentType, else agent>}}` when the content is empty.
   - any other type: a violet box Marker type: **<label>** and Content is
     auto-generated at assembly time from your characters, lorebooks, etc.;
     for `lorebook`, `world_info_before` and `world_info_after` also (amber)
     This is where active lorebook entries are inserted.
     A marker without a marker config shows neither.
4. **Position:** a dropdown Ordered (in sequence) / Depth (from end of chat)
   showing `injectionPosition`, else ordered; a change saves
   `{ injectionPosition }`. When the stored position is `depth`: **Depth:** a
   number box (`DraftNumberInput`, min 0, selects on focus) with
   `injectionDepth`, else 0, saving `{ injectionDepth }` when committed, and
   (0 = after last message).
5. **Group:** a dropdown No group + each group by name, showing `groupId`;
   a change saves `{ groupId: <id, or null for No group> }`. With no groups:
   (open Groups panel to create one).

Every save here is `onUpdateSection.mutate({ presetId, sectionId, <field> })`.

### Content editor

A monospace textarea (placeholder `Prompt content… (supports {{user}}, {{char}}, {{// comment}}, {{trim}} macros)`)
with two small buttons at its top right: **Expand editor** and **Macros
reference** (titles).

- The text follows the stored content, except while the textarea has focus.
- Typing saves 800 ms after the last keystroke, when the text differs from
  the stored content at the time of that keystroke: `{ content }`.
- Blur cancels a pending save and saves at once when the text differs from the
  stored content.
- Tab inserts two spaces at the cursor (replacing a selection) and saves 800
  ms later like typing.
- **Expand editor** opens the expanded editor with the current text.
- **Macros reference** opens the macros reference.

### Expanded editor

A full-screen dialog over the page (dimmed, blurred backdrop), rendered into
`document.body`: title **Edit: <section name>** (or **Edit Prompt** without a
name) and a close X; a large monospace textarea filled once when it opens,
focused 100 ms after opening, placeholder
`Prompt content… (supports macros like {{user}}, {{char}}, etc.)`, Tab inserts
two spaces; footer Changes auto-save. Press Escape to close. and **Done**.
Typing hands the text to the content editor 600 ms after the last change; the
content editor then saves it 800 ms later as above. Closing (X, Done, the
backdrop, or Escape anywhere) hands over unsaved text at once and closes; the
content editor then saves its current text at once if it differs from the
stored content, and the 800 ms timer saves the handed-over text (**changed by #FIXPR**, follow-up 10: closing
no longer saves the current text at once; the handed-over text is saved once, by its timer, or when the content
editor goes away). Several
expanded editors can be open at once (from different sections); Escape closes
all of them. The recordings decide the exact calls.

### Macros reference

A dialog rendered into `document.body` (dimmed, blurred backdrop): a book
icon and **Macros Reference**, a close X; the notes Use these macros in your
prompt sections. They will be replaced with actual values at generation time.
and In group chats, a bracketed block containing character macros like
`{{char}}` and `{{description}}` repeats once per character.; then, per
category of `SUPPORTED_MACROS` in first-seen order, the category name and one
row per macro (its syntax in amber code style, its description); a **Close**
button. Escape, the backdrop, X and Close close it.

### Drag to reorder

As in the variables list: a card can be dragged only after a mouse-down on its
grip; the dragged card fades; a thin purple line shows above the card under
the pointer (top half) or below it (bottom half). Over the list's empty space
the line goes after the last card when the pointer is below the last card, and
before the first card when it is above the first card; elsewhere in the gaps
it stays where it was. No line at the dragged card's own place. Dropping moves
the id and sends `onReorderSections.mutate({ presetId, sectionIds })`;
dropping at its own place sends nothing.

## Layout

Use the screenshots (old build, real Chrome, at 1366 and 660 wide, dark and
light: the empty tab, the list with every kind of section collapsed, each kind
expanded, the add menu with agent sections, the groups panel with a group being
renamed, the lorebook warning, the expanded editor and the macros reference).

## Decisions

The rebuild keeps every save call, payload and visible text. These change on
purpose (accessibility only):

1. **Names and states.** The chevron is named `Expand <name>` /
   `Collapse <name>` with `aria-expanded`; the eye is named `Disable <name>` /
   `Enable <name>` with `aria-pressed` (pressed when on); the trash is named
   `Delete <name>`; **Add Section** and **Groups** have `aria-expanded`; the
   group trash is named `Delete group <name>`; the content editor's buttons are
   named `Expand editor` / `Macros reference`; the name input is named
   `Section name` and the role, position, depth and group controls are tied to
   their labels (the role dropdown named `Role`); decorative icons and the grip
   are `aria-hidden` (the grip keeps its title).
2. **Buttons** all have `type="button"`.
3. **Dialogs.** The expanded editor and the macros reference are
   `role="dialog"` with `aria-modal="true"`, named by their titles; their X
   buttons are named `Close`.

## Follow-ups after the rebuild

Kept as recorded in the rebuild; each is its own small pull request after it. Items marked **Fixed** changed
recorded behavior on purpose: the replay spec keeps the recordings as they are and lists every step a fix changes
(`INTENDED` in the replay spec), and the fix's new step sequences are in the module's `fixes` spec.

1. **Delete** removes a section at once, with no confirmation or undo.
2. A failed save shows only the shared failure toast (an empty name is put
   back without a word).
3. Two edits to different fields of the same section in quick succession are
   sent as separate updates; check the recordings for lost edits.
4. The group name is a clickable span (not keyboard reachable); renaming saves
   even when unchanged.
5. A marker without a usable marker config shows no content and no note.
6. Dragging works only with a mouse (the arrow buttons cover keyboard use).
7. The add menu doesn't close on Escape.
8. **Fixed in #FIXPR** (Enter blurs, and the blur saves once). Was: Enter in the name input saves twice.
9. A section without a name breaks the name input's blur; duplicating it
   toasts `Duplicated "undefined"`.
10. **Fixed in #FIXPR.** Text not saved yet (inline or in the expanded editor) is saved when the content
    editor goes away (the card collapses, the tab or the editor closes); a deleted section gets no save;
    closing the expanded editor saves once. (An 800 ms timer that fires while a delete is still running still
    saves, as recorded.) Was: pending content edits are lost when a card collapses, or when the section
    is deleted or collapsed with the expanded editor open; closing the expanded
    editor after a hand-over saves twice.
11. An unknown role shows System in the dropdown; duplicating it fails.
12. The depth box saves on every blur and reads `3.7` as 3.
13. Deleting a group leaves its sections pointing at it.
14. Found by the old-vs-new fuzz (not in the recordings; the rebuild keeps them,
    tested in `PresetSections.legacy.spec.tsx`):
    - Duplicate keeps an empty name or identifier (`" Copy"`, `_copy_<now>`).
    - An agent with an empty or missing `type` in the add menu creates a plain
      Prompt Block.
    - An agent marker with `agentType: ""` shows `{{agent::}}`.
    - Tab in a section whose content is null or not text throws and inserts
      nothing.
    - A drag that starts without the last one ending can show a stale drop
      line.
    - Move does nothing on a section with an empty id.

## Recorded details

Found while recording the old tab; the rebuild keeps them (the recordings show
each one):

- **Name input.** Enter saves twice (Enter saves, then the blur it causes saves
  again, before the refresh; **changed by #FIXPR**, follow-up 8: once). A trimmed name equal to the stored one sends
  nothing and puts the stored text back. On a row with no `name`, blur throws
  (in the event handler) and saves nothing.
- **Expanded editor timing.** Opening it flushes a pending inline edit (it
  takes focus 100 ms after opening, which blurs the inline textarea, which saves
  at once). If a 600 ms hand-over already happened and more was typed, closing
  saves the handed-over text and then the newer text 800 ms later. Collapsing
  the card or deleting the section while it is open loses the pending text.
  (**Changed by #FIXPR**, follow-up 10: closing saves once; collapsing saves the
  pending text; deleting still drops it.)
- **Collapsing a card** with a pending content edit loses it (nothing saved;
  **changed by #FIXPR**, follow-up 10: it is saved).
- **Quick edits to two fields** go out as separate updates, in the order they
  finish; none were lost.
- **Group rename.** Escape closes the input without saving. Closing the groups
  panel while renaming saves nothing, and the input with its typed text comes
  back when the panel reopens. Enter saves once (through the blur). Before the
  refresh arrives, renaming again starts from the old name. The rename input
  gets focus with the cursor at the end (not selected).
- **Unknown role** (or missing / `null`): the header shows the raw role text
  (`system` for missing / `null`), the dropdown shows System. Duplicating such a
  row (or a marker of an unknown type) fails the schema: the error toast and no
  storage call.
- **Markers.** A marker without a usable config (null, missing, `""`, bad JSON,
  no or non-text `type`, an array) shows no note and no content editor. An
  agent config on a row that isn't a marker shows the plain content editor and
  no MARKER pill.
- **Duplicate.** A section with no name toasts `Duplicated "undefined"`. The
  payload carries a parsed JSON-text config with every key (the schema then
  drops unknown ones). Errors show the fallback text. While the create is held,
  every Duplicate button is disabled.
- **Agent menu items.** An agent with `name: null` shows as `(Agent)` and
  creates `<type> (Agent)`; `name: ""` creates ` (Agent)`. Settings stored as
  JSON text, or `injectAsSection: "true"`, don't count.
- **Depth box.** Every blur or Enter saves, even unchanged. Text is read like
  `parseInt` (`3.7` saves 3, ` 05x` saves 5); empty, `abc` and `-1` put the
  stored value back without saving.
- **Deleting a group** leaves its sections' `groupId` (no pill, the dropdown
  shows No group).
- A `sectionOrder` that isn't a list shows no sections.
- **Switching presets** shows nothing while the other preset loads, so the tab
  starts fresh: expanded cards, the add menu and the groups panel reset.
- **Dragging an off section** shows only the drag fade, not the off fade.

## Tests

The new module's tests use the recordings:

- For every recorded starting state: the shown state (text, inputs and their
  values, dropdowns, buttons and their disabled state, which cards are
  expanded, the menus and dialogs) matches.
- For every recorded action sequence: the shown state after each step and
  every mutation call (which one, `mutate` or `mutateAsync`, its payload as
  JSON so key order counts), toast and `localStorage` write match, except
  where decisions 1 to 3 add attributes.
- Each decision has a test.

## Acceptance checks

- Real Chrome, a local server with a throwaway preset, at 1366x900 and
  660x900, dark and light: the recorded step lists give the same stored
  `prompt-sections`, `prompt-groups` rows and preset `sectionOrder` /
  `groupOrder` as the old build, and the screenshots match the old ones.
- A local read-only copy of the Pi data: every stored preset's sections show
  the same in both builds (no saves).
- The old Sections tab code is gone from `PresetEditor.tsx` and nothing else
  changed there except rendering the new module.

## Black-box recording plan

Recorded by someone other than the builder, on `main`, with no real data and
no model calls (this tab makes none). Saved under
`src/features/catalog/presets/components/preset-sections/test-fixtures/` as
one-line JSON (listed in `.prettierignore`), each file under about 1 MB.

1. **Component recordings**: the old tab rendered in the test environment as a
   black box (the recorder may add `export` locally; not committed), fed the
   way the real editor feeds it (`usePresetFull` → ordered sections, group map,
   choice blocks), with the real hooks over a fake storage (`prompt-sections`,
   `prompt-groups`, `prompt-variables`, `prompts`, `agents` and the reorder
   command; can fail, hold a call or refresh late), a fixed `Date.now()`, a
   manual clock for every timer, a fake `localStorage`, the confirm dialog
   answered by the recorder, and every `mutate` / `mutateAsync` logged.
   Starting states: no sections; every kind of section (prompt blocks of each
   role and an unknown role, every marker type, agent markers with and without
   content, markers with JSON-text, bad and missing configs, depth sections,
   grouped sections, `"true"`/`"false"` strings, missing fields), no groups and
   several, agents with and without `injectAsSection`, the lorebook warning on
   and dismissed. Action sequences: every toolbar and menu item, the groups
   panel (create, rename with Enter, Escape, blur, empty, delete with cancel and
   confirm), expand and collapse, move up and down, drag with fake positions
   (including the list's empty space above and below), duplicate (success, no
   id, create failure, reorder failure, held), on/off, delete, every body
   control including the depth box, the content editor (typing, the 800 ms
   timer, blur, Tab, quick edits before the refresh), the expanded editor
   (typing, Tab, X, Done, backdrop, Escape) and the macros reference; each with
   a failing save where it applies. After each step: the shown state and every
   call.
2. **Real Chrome** (the spec writer): the same kinds of step lists through the
   real preset editor at 1366x900 and 660x900, dark and light, with the stored
   rows after each save, and the screenshots for the builder.

The builder gets the recordings, the screenshots and this spec. The recordings
show the old behavior that decisions 1 to 3 change on purpose.
