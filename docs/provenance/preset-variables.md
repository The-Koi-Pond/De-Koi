# Preset Variables Editor: Behavior Spec

Status: draft 2026-11-22. Part of the code provenance plan
(`docs/code-provenance-plan.md`, tracked in #1580). First slice of the preset
editor (`PresetEditor.tsx`, 1,834 of 1,973 lines not yet team-owned at the
baseline); the overview, sections and AI review parts follow as their own
slices.

This spec describes the **Preset Variables** part of the preset editor: the
list under the sections on the **Sections** tab where a preset's variables
(choice blocks) are added, edited, reordered and deleted. A variable is a
question with options that the user answers when they assign the preset to a
chat; `{{VARIABLE_NAME}}` in a section is replaced by the chosen value. This
spec is the only input the builder uses. It describes behavior, not the old
implementation.

## Rules for the builder

Build from this spec, the recordings, the screenshots and the team-owned code
around it. Don't open, search, or read the history of the old implementation:

- `src/features/catalog/presets/components/PresetEditor.tsx`

You may read every interface listed under "Neighbors". If this spec doesn't
answer a question, ask the spec writer.

**Safety.** The editor sends no model requests. What it saves is part of every
chat that uses the preset: the variable name decides which `{{…}}` macro is
replaced, and the chosen option's value is inserted into the prompt sent to the
model. So every saved field is a compatibility contract and must stay exactly
the same, including which save calls happen, in which order and with which
payload (see "Saves"). Someone other than the builder records the old editor as
a black box first (see "Black-box recording plan"); the recordings become
tests, and the builder sees the recordings, never the old code. Where this text
and a recording disagree, the recording wins, except where a decision below
changes the behavior on purpose; tell the spec writer so the spec gets fixed.

## Scope

The variables part of `src/features/catalog/presets/components/PresetEditor.tsx`
(about 600 lines: the list, each variable's card, its name, question and option
inputs). The rest of the file stays as it is in this slice.

The new module lives in `src/features/catalog/presets/components/preset-variables/`
and exports `PresetVariablesEditor`. `PresetEditor.tsx` renders it where it
rendered the old list, with the same props, and the old list's code is deleted
from `PresetEditor.tsx` in the same change. The spec writer makes that edit to
`PresetEditor.tsx` (the builder doesn't open it).

### Props (the contract with `PresetEditor.tsx`)

- `presetId: string`
- `variables: ChoiceBlockRow[]`: the preset's variables in stored order, as
  `usePresetFull(presetId).data.choiceBlocks` returns them (or `[]`). A row has
  `id`, `presetId`, `variableName` (older rows may have `variable_name`
  instead, or neither), `question`, `options`, `multiSelect` and `randomPick`
  (a boolean or the strings `"true"`/`"false"`), `separator`, and possibly
  `visibilityRule`. Rows come from storage as stored, so any field can be
  missing or odd (see "Reading a row").
- `onCreateVariable`, `onUpdateVariable`, `onDeleteVariable`,
  `onReorderVariables`: the mutation objects from `useCreateVariable()`,
  `useUpdateVariable()`, `useDeleteVariable()` and `useReorderVariables()`.
  The module calls only their `mutate(…)` (never `mutateAsync`) and reads
  `onReorderVariables.isPending`.

### Neighbors (not rebuilt)

- `src/features/catalog/presets/hooks/use-presets.ts`: the four hooks above.
  Create parses the payload with `createChoiceBlockSchema` (adding `presetId`),
  stores it in `prompt-variables`, then appends the new id to the preset's
  `variableOrder`. Update parses with `updateChoiceBlockSchema` and stores it.
  Delete removes the row. Reorder sends the full id list to the reorder command
  and reorders the cached preset at once (and puts it back on failure). Each
  refreshes the preset afterwards, which hands the module new `variables`.
- `src/engine/contracts/schemas/prompt.schema.ts`: `createChoiceBlockSchema`,
  `updateChoiceBlockSchema` (name 1 to 100 word characters, question 1 to 500
  characters, at least one option, separator up to 20 characters). A payload
  the schema refuses fails the mutation.
- `src/shared/hooks/use-mutation.ts`: a failed `mutate` with no `onError`
  shows the shared failure toast (`toast.error` with an `id`), so the module
  shows nothing of its own for failed saves.
- `src/engine/contracts/types/prompt.ts`: `ChoiceBlock`, `ChoiceOption`.
- `src/shared/lib/app-dialogs.ts` (`showConfirmDialog`), `sonner` (`toast`),
  `src/shared/lib/utils.ts` (`cn`), `lucide-react` icons.

How chats use a variable (for context, not rebuilt): the chat's preset choices
are picked in `ChoiceSelectionModal.tsx` (question, option labels and
descriptions), and `src/engine/generation/prompt-assembly.ts` replaces
`{{variableName}}` with the chosen value (joined with `separator` when
`multiSelect`, or one of them at random when `randomPick`).

## Reading a row

- **Name**: `variableName`, else `variable_name`, else empty.
- **Question**: `question`, else empty.
- **Options**: `options` when it is an array, else none. An option shows its
  `label` and `value` as stored.
- **Multi-Select** and **Random Pick** are on only for `true` or `"true"`
  (`"TRUE"`, `1` and anything else are off).
- **Separator**: `separator`, else `", "` (so an empty string shows as empty,
  and only a missing or `null` separator shows `", "`).
- **Boolean variable**: exactly one option and Multi-Select off. With
  Multi-Select on, one option shows the **multi** (or **random**) pill and the
  switches, not the boolean note. No options (`[]`, or options that aren't an
  array) shows `0 options` and the Multi-Select switch.

## The list

- A heading row: a hash icon, **Preset Variables**, and a pill with the number
  of variables; on the right an **Add Variable** button (plus icon).
- Under it the note: Define variables that users select when assigning this
  preset to a chat. Use `{{variable_name}}` in any section to insert the
  selected value. (`{{variable_name}}` in code style.)
- No variables: a dashed box with a hash icon and **No variables yet. Add one
  to let users customize prompts per chat.**
- Otherwise one card per variable, in the order given.
- At most one card is expanded at a time. Clicking a card's chevron or its name
  expands it, or collapses it when it is the expanded one. Which card is
  expanded is kept by id, so it stays expanded after a reorder or a refresh.

**Add Variable** creates at once (no form):
`onCreateVariable.mutate({ presetId, variableName: "VAR_<now>", question: "Choose an option", options: [{ id: "opt_<now>_a", label: "Option A", value: "value_a" }, { id: "opt_<now>_b", label: "Option B", value: "value_b" }] })`
with `<now>` the current `Date.now()` (the same value in all three places, as
recorded). Keys in that order. Nothing else happens until the refreshed list
arrives.

## A variable's card

Header, left to right:

1. A grip (drag handle, title `Drag to reorder`), **Move up** and **Move down** arrow buttons (titles
   `Move up` / `Move down`, names `Move <name> up` / `Move <name> down`, or
   `variable` when the name is empty). Move up is disabled on the first card,
   Move down on the last, and both on every card while a reorder is pending.
2. The chevron (right when collapsed, down when expanded).
3. A hash icon and the name (truncated; clicking it toggles like the chevron).
4. A pill `<n> options`.
5. A **boolean** pill for a boolean variable; for Multi-Select a pill
   **random** (Random Pick on) or **multi** (off).
6. `{{<name>}}` in code style, hidden below the `sm` breakpoint.
7. A trash button (title `Delete variable`).

**Delete** asks `showConfirmDialog({ title: "Delete Variable", message: 'Delete variable "<name>"?', confirmLabel: "Delete", tone: "destructive" })`
and, if confirmed, `onDeleteVariable.mutate({ presetId, variableId })`.

**Move up / Move down**: the ids of `variables` with this one moved one place,
then `onReorderVariables.mutate({ presetId, variableIds })`.

### Expanded body

1. **Variable Name**: a text input (placeholder `VARIABLE_NAME`, monospace).
   Typing removes every character that isn't an ASCII letter, digit or `_` as
   it is typed. Focusing selects the text. It saves on blur (and Enter blurs)
   when the text differs from the stored name: `update({ variableName })`. A
   new stored name replaces the text. Under it: Use `{{<name>}}` in any prompt
   section to insert the selected value. Must be alphanumeric/underscores only.
2. **Question (shown to user)**: a text input (placeholder `What should the
user choose?`). Focusing selects; saves on blur (Enter blurs) when changed:
   `update({ question })`. A new stored question replaces the text.
3. For a boolean variable: a **Boolean Toggle** note (toggle icon): This
   variable has only one option, so it behaves as a Boolean toggle. Users can
   switch it on or off in the Configure Preset Variables wizard.
   Otherwise a **Multi-Select** switch (list icon) with the note Allow users to
   select multiple options instead of just one. Clicking it saves
   `update({ multiSelect: !current })`. When Multi-Select is on, under a
   divider:
   - a **Random Pick** switch (shuffle icon); clicking saves
     `update({ randomPick: !current })`; its note is One of the user's
     selected options will be randomly picked each generation. when on, All
     selected options will be joined together with the separator below. when
     off;
   - when Random Pick is off, **Separator**: a small centered monospace input
     (placeholder `, `) showing the stored separator; focusing selects; **every
     change saves at once**: `update({ separator: <the input's value> })`. The
     input shows the stored value, so it only changes when the refreshed row
     arrives (as recorded). Beside it: e.g. ", " becomes Romance, Fantasy,
     Action.
4. **Options**: one row per option: its number (`1.`, `2.`, …), a **label**
   input (placeholder `Label…`), a **value** input (placeholder `Value…`,
   monospace), an expand button (title `Expand value editor`) and a remove
   button (title `Remove option`). A blank value (empty or only spaces) tints
   the row and the value input red and shows **Value cannot be empty.** under
   the row (it still saves).
   - Label and value inputs: focusing selects. Typing saves 600 ms after the
     last keystroke; blur (Enter blurs) cancels a pending save and saves at
     once when the text differs from the stored one. While an input has focus,
     a new stored value doesn't replace what is typed; otherwise it does. A
     save sends the whole option list with that one field changed:
     `update({ options })`, each option otherwise as given (the list sends
     every key it has; the update schema then keeps only `id`, `label`,
     `description` and `value`, in that order).
   - Remove: with one option left, `toast.error("A variable needs at least 1 option.")`
     and nothing else; otherwise `update({ options })` without that option.
   - **Add Option** (plus icon): `update({ options: [...options, { id: "opt_<now>", label: "Option <letter>", value: "" }] })`
     where `<letter>` is the character 65 + the current number of options
     (`A`, `B`, … and on past `Z` as recorded).
   - Expand opens the value editor (below) for that option.

`update(data)` is `onUpdateVariable.mutate({ presetId, variableId, ...data })`.
A save hands the list as it was when that input was last rendered, so the
recordings decide what two quick edits in a row send.

### Value editor

A full-screen dialog over the page (dimmed, blurred backdrop), rendered into
`document.body`:

- Title **Edit Value: <label>**, or **Edit Value: Option <n>** when the label is
  empty; a close (X) button.
- A large monospace textarea filled with the option's value when it opens
  (later stored changes don't replace it), focused 100 ms after opening,
  placeholder `Prompt content… (supports macros like {{user}}, {{char}}, etc.)`.
  Tab inserts two spaces at the cursor instead of moving focus.
- Typing (and Tab) saves 600 ms after the last change, as the option's value
  (`update({ options })`).
- Closing (X, **Done**, the backdrop, or Escape anywhere) cancels a pending
  save, saves at once when the text differs from the option's value, then
  closes.
- Footer: Changes auto-save. Press Escape to close.

### Drag to reorder

A card can be dragged only when the drag starts after a mouse-down on its grip.
While dragging, the dragged card is faded, and a thin amber line shows where it
will go: above the card under the pointer when the pointer is in its top half,
below it in the bottom half, and after the last card when over the empty part
of the list. No line shows at the dragged card's own place. Dropping moves the
id there and sends `onReorderVariables.mutate({ presetId, variableIds })`;
dropping at its own place sends nothing.

## Recorded details

Found while recording the old list; the rebuild keeps them (the recordings
show each one):

- **Saves are built from the list as last rendered.** Two edits to options of
  the same variable before the refreshed row arrives (two blurs, two 600 ms
  timers firing together, or a second edit while the first update is held)
  send the second list without the first edit, so storage loses it. The first
  input keeps showing its text even after the refresh, because the stored value
  it compares against never changed. With the refresh in between, both edits
  survive.
- **Separator.** Every keystroke saves the input's whole value. While the
  refresh is late the input shows the stored value again, so typing `a` then
  `b` after `|` sends ` | a`, then ` | b`.
- **Failed saves** (a storage failure or a payload the schema refuses: an
  empty name or question, a separator over 20 characters, an option with a
  missing or `null` label or value) show only the shared toast
  `Couldn't save that change. Try again.`. The typed text stays in the input;
  the Variable Name and Question inputs keep it even after a refresh (so they
  disagree with storage), and the next blur sends the same save again. A
  refused payload makes no storage call. A failed reorder shows the moved
  order, then the old order again, and toasts. When a create succeeds but
  adding it to `variableOrder` fails, it toasts and the new variable shows
  after the next refresh.
- **Variable Name and Question** replace the typed text whenever the stored
  value changes, even while focused; the blur after that sends nothing.
  Label and value inputs keep typed text while focused.
- **Collapsing a card** (or the card going away) drops a pending 600 ms label
  or value save, unblurred name or question text and the value editor's text,
  without saving (in the test environment; real Chrome may blur first, see the
  Chrome recordings).
- **Value editor.** Closing it without typing after the option's value changed
  elsewhere writes the text it opened with back over that change. If its option
  goes away, it closes and its text is lost. Tab before the 100 ms focus
  inserts at the start; Tab with a selection replaces the selection.
- **A numeric option value** (`value: 42`) crashes the whole list when its card
  is expanded. A missing label shows an empty input.
- **Add Option past `Z`** gives `Option [`, `Option \`, `Option ]`, …
- **Drag.** A mouse-down on a card's grip is remembered until a drag ends, so a
  later drag of that card works without pressing the grip again, and a grip
  press on one card blocks dragging another.
- **Repeated clicks.** While a delete is held, Delete on the same card asks
  again and sends a second delete. Two **Add Variable** clicks in the same
  millisecond create two variables with the same name and option ids.
- **Expanded card** is remembered by id, even when the card goes away and
  comes back. Which option's value editor is open is kept on the card (by the
  option's place), so collapsing and expanding the card again reopens the
  editor with the stored value.

## Layout

Use the screenshots (old build, real Chrome, at 1366 and 660 wide, dark and
light: the empty list, collapsed cards with each pill, an expanded single-select,
multi-select, random-pick and boolean variable, a blank value, and the value
editor). The cards are amber-tinted (`amber-400` accents) and the switches are
small pill switches (purple for Multi-Select, amber for Random Pick).

## Decisions

The rebuild keeps every save call, payload and visible text. These change on
purpose (accessibility only):

1. **Names and states.** The chevron is a button named `Expand <name>` /
   `Collapse <name>` with `aria-expanded`; the trash button is named
   `Delete <name>`; the expand and remove option buttons are named
   `Edit value of option <n>` / `Remove option <n>`; the label and value inputs
   are named `Option <n> label` / `Option <n> value`; the Variable Name,
   Question and Separator labels are tied to their inputs; the two switches
   are `role="switch"` with `aria-checked` and the names `Multi-Select` /
   `Random Pick`; decorative icons are `aria-hidden`. The grip keeps its
   `Drag to reorder` title and is `aria-hidden` (the arrow buttons are the
   keyboard way to reorder).
2. **Buttons** all have `type="button"`.
3. **Value editor** is a `role="dialog"` with `aria-modal="true"`, named by its
   title; its close button is named `Close`.

## Follow-ups after the rebuild

Kept as recorded in the rebuild; each is its own small pull request after it. Items marked **Fixed** changed
recorded behavior on purpose: the replay spec keeps the recordings as they are and lists every step a fix changes
(`INTENDED` in the replay spec), and the fix's new step sequences are in the module's `fixes` spec.

1. The separator saves on every keystroke and only shows a change after the
   refreshed row arrives, so fast typing can drop characters.
2. An empty name, an empty question, a separator over 20 characters or a name
   over 100 characters fails the save with only the shared failure toast; say
   what is wrong (and keep the typed text).
3. Two quick edits to different options of the same variable (or a field
   edit, then the value editor) can send an option list without the first
   edit, if the second save starts before the refreshed row arrives (see the
   recordings).
4. Option ids from **Add Option** clicked twice in the same millisecond
   collide; labels go past `Z` into punctuation.
5. Dragging works only with a mouse (the arrow buttons cover keyboard use).
6. A numeric (or otherwise non-text) option value crashes the list when its
   card is expanded; show it as text.
7. Collapsing a card drops unsaved typing (a pending option save, unblurred
   name or question, open value editor text); save or keep it.
8. Variable Name and Question lose typed text when the stored value changes
   while they're focused; a failed save leaves them showing text storage
   doesn't have.
9. Closing the value editor without typing can write an old value back over a
   newer one.
10. **Fixed in #1821** (a second Delete while that variable's confirm is open or its delete runs does
    nothing). Was: a second Delete while one is running asks again and deletes twice.
11. Deleting a variable leaves its id in the preset's `variableOrder` (seen in
    real Chrome, old and new alike).
12. Rows with non-text fields (a `null`, missing, number or boolean name,
    question, label or value; an empty or missing id) behave unevenly, as
    recorded: inputs compare typed text with the stored value strictly (so
    retyping `42` over a stored number saves `"42"`), a boolean name shows
    nothing in the header and an object name crashes the list, Tab in the
    value editor throws on a missing value, and moving a variable with no id
    does nothing. The schema refuses such rows on write, so they only come from
    older or imported data (the Pi has none); read them as text when loading.

## Tests

The new module's tests use the recordings:

- For every recorded starting state: the shown state (text, inputs and their
  values, buttons and their disabled state, which card is expanded) matches.
- For every recorded action sequence: the shown state after each step and
  every mutation call (which one, its payload as JSON so key order counts)
  match, except where decisions 1 to 3 add attributes.
- Each decision has a test.

## Acceptance checks

- Real Chrome, a local server with a throwaway preset, at 1366x900 and
  660x900, dark and light: the recorded step lists give the same stored
  `prompt-variables` rows and preset `variableOrder` as the old build, and the
  screenshots match the old ones by eye.
- A local read-only copy of the Pi data: every stored preset's variables show
  the same in both builds (no saves).
- The old variables code is gone from `PresetEditor.tsx` and nothing else
  changed there except rendering the new module.

## Black-box recording plan

Recorded by someone other than the builder, on `main`, with no real data and
no model calls (this part makes none). Saved under
`src/features/catalog/presets/components/preset-variables/test-fixtures/` as
one-line JSON (listed in `.prettierignore`, so the provenance report doesn't
count recordings as code), each file under about 1 MB.

1. **Component recordings**: the old variables list rendered in the test
   environment as a black box (the recorder may add `export` to it locally;
   that edit isn't committed), with the real four hooks over a fake storage
   (`prompt-variables`, `prompts` and the reorder command; can be told to
   fail, to hold a call, or to refresh late), a fixed `Date.now()`, a manual
   clock for the 600 ms and 100 ms timers, and the confirm dialog answered by
   the recorder. Starting states: no variables; variables covering every field
   (single, boolean, multi, random, legacy `variable_name`, no name, `"true"`
   strings, empty and missing separator, non-array options, a blank and an
   all-spaces value, options with `description`, many options, a long name and
   question, Unicode). For each: the shown state, then action sequences (expand
   and collapse each card, type into every input with and without blur and
   Enter, the 600 ms timers, quick edits to two options before the refresh,
   both switches, the separator, add and remove options including the last
   one, the value editor with typing, Tab, X, Done, backdrop and Escape, add,
   move up and down, drag with fake card positions, delete with cancel and
   confirm, and each with a failing save), recording after each step the shown
   state and every storage and reorder call.
2. **Real Chrome**, headless Chrome with a local server and a throwaway
   preset: the same kinds of step lists through the real preset editor at
   1366x900 and 660x900 in dark and light, recording after each step the shown
   state and every `/api/invoke` call for `prompt-variables`, `prompts` and the
   reorder command, and the stored rows after each save, including a real
   drag; plus the screenshots for the builder.

The builder gets the recordings, the screenshots and this spec. The recordings
show the old behavior that decisions 1 to 3 change on purpose.
