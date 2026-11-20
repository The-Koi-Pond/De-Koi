# Regex Script Editor: Behavior Spec

Status: agreed 2026-11-20 (decisions as recommended). Part of the code
provenance plan (`docs/code-provenance-plan.md`, tracked in #1580).

This spec describes the regex script editor: the full-page screen that opens
when someone clicks a regex script (or **New**) in the Regex Scripts list. It
edits one script's name, on/off switch, find pattern, replacement, flags, where
it applies, which characters it is for, trim strings, mode, order and depth
range; it has a Live Test box; and it saves, creates or deletes the script. It
is the only input the builder uses. It describes behavior, not the old
implementation.

## Rules for the builder

Build from this spec, the recordings, the screenshots and the team-owned code
around it. Don't open, search, or read the history of the old implementation:

- `src/features/catalog/regex-scripts/components/RegexScriptEditor.tsx`

You may read every interface listed under "Neighbors". If this spec doesn't
answer a question, ask the spec writer.

**Safety.** The editor sends no model requests. But what it saves is a regex
script, and saved scripts rewrite chat text: what the AI reads, what is shown,
and (for a global script in **Both** mode) the saved messages themselves. So
every saved field is a compatibility contract and must stay exactly the same
(see "Save"). Someone other than the builder records the old editor as a black
box first (see "Black-box recording plan"), the recordings become tests, and the
builder sees the recordings, never the old code. Where this text and a
recording disagree, the recording wins, except where a decision below changes
the behavior on purpose; tell the spec writer so the spec gets fixed.

## Scope

Lines not yet team-owned, from `node scripts/code-provenance.mjs --fast` at
`42434c163a`:

| File                                                                  | Not owned | Of lines |
| --------------------------------------------------------------------- | --------: | -------: |
| `src/features/catalog/regex-scripts/components/RegexScriptEditor.tsx` |       500 |      646 |

Replaced, then deleted in the same change. The new module lives in
`src/features/catalog/regex-scripts/components/regex-script-editor/` and
exports `RegexScriptEditor` (no props) with the same name.
`src/features/catalog/regex-scripts/shell.ts` re-exports it from the new path;
nothing else changes for the callers.

### Neighbors (not rebuilt)

- `src/app/shell/detail-route-registry.tsx` lazy-loads the editor through
  `shell.ts` and shows it while `regexDetailId` is set.
- `src/features/catalog/regex-scripts/components/RegexScriptsSection.tsx` opens
  it: `openRegexDetail("__new__")` for a new script, `openRegexDetail(id)` for
  an existing one.
- UI store (`src/shared/stores/ui.store`): `regexDetailId`,
  `openRegexDetail(id)`, `closeRegexDetail()`, `setEditorDirty(dirty)`.
- `src/features/catalog/regex-scripts/hooks/use-regex-scripts.ts`:
  `useRegexScripts()` (the whole list), `useCreateRegexScript()`,
  `useUpdateRegexScript()`, `useDeleteRegexScript()`, type `RegexScriptRow`.
  Create and update validate with `createRegexScriptSchema` /
  `updateRegexScriptSchema` (`src/engine/contracts/schemas/regex.schema.ts`)
  and refresh the list on success.
- `useCharacterSummaries()` from `src/features/catalog/characters/index`.
- `src/features/catalog/regex-scripts/lib/regex-script-editor-state.ts`:
  `REGEX_APPLY_MODE_LABELS`, `regexApplyModeHelp(mode, characterScoped)`,
  `nextRegexScriptTargetCharacterIds(current, id)`.
- `src/features/catalog/regex-scripts/lib/regex-script-filter.ts`:
  `regexScriptTargetCharacterIds(row)`.
- `src/engine/shared/regex/regex-apply-mode.ts`: `REGEX_APPLY_MODES`,
  `regexScriptApplyMode(row)`, type `RegexApplyMode`.
- `src/engine/shared/macros/macro-engine.ts`: `resolveMacros`, type
  `MacroContext`.
- `src/engine/shared/regex/regex-script-application.ts`:
  `applyRegexScriptReplacement(text, regex, replace, trimStrings, resolve)`.
- `src/shared/components/ui/ExplicitSaveChrome.tsx`: `EditorSaveStatus`,
  `SaveErrorBanner`, `UnsavedChangesBar`.
- `src/shared/components/ui/HelpTooltip.tsx`, `src/shared/lib/app-dialogs.ts`
  (`showConfirmDialog`), `src/shared/lib/utils.ts` (`cn`), `lucide-react`
  icons. Type `RegexPlacement` from `src/engine/contracts/types/regex`.

## Which script

- `regexDetailId` is `"__new__"`: a **new** script (not saved yet).
- Otherwise the script is the row in `useRegexScripts()` with that id.
- No id, or an id with no row (including while the list is still loading):
  only the text **Regex script not found.**, centered in the page, small muted
  text. Nothing else.

## Loading the form

When the editor opens a script, and again whenever the id changes (also to an
id with no row, which still clears unsaved state) or the list
gives a changed copy of that row (for example after a save refreshes the list),
the form is filled and reset. A refresh that returns the row unchanged keeps the
same row object (the query's structural sharing), so it resets nothing and keeps
unsaved edits (recording `refetch:resets-edits`):

| Field           | From a stored row                                                                                            | New script         |
| --------------- | ------------------------------------------------------------------------------------------------------------ | ------------------ |
| Name            | `name`                                                                                                       | `New Regex Script` |
| Enabled         | `enabled` is `true`, `"true"` or `"1"` (anything else is off)                                                | on                 |
| Find pattern    | `findRegex`                                                                                                  | empty              |
| Replace with    | `replaceString`                                                                                              | empty              |
| Trim strings    | `trimStrings` if it is an array, else none                                                                   | none               |
| Apply to        | `placement` if it is an array, keeping only `ai_output` and `user_input` (so it can end up empty), else none | `ai_output` only   |
| Characters      | `regexScriptTargetCharacterIds(row)`                                                                         | none (global)      |
| Flags           | `flags`                                                                                                      | `gi`               |
| Shows in (mode) | `regexScriptApplyMode(row)`                                                                                  | `both`             |
| Execution order | `order`                                                                                                      | 0                  |
| Depth min / max | `minDepth` / `maxDepth`                                                                                      | empty / empty      |

Every reset also clears: unsaved state, the save error, and the Live Test text
(but see decision 2).

**Unsaved state.** Any edit to a saved field (everything above) marks the form
unsaved. Typing in Live Test doesn't. The editor tells the store through
`setEditorDirty` whenever its unsaved state changes.

## Header

One row across the top, on the card background with a bottom border, in this
order:

1. **Back** button, an arrow icon, `aria-label="Back to regex scripts"`. With
   unsaved edits it shows the unsaved bar (below) instead of leaving; otherwise
   it calls `closeRegexDetail()`.
2. A small square tile with an orange-to-red gradient and a white regex icon.
3. The **name** input: no border, transparent background, large semibold text,
   placeholder `Script name…`, fills the free width.
4. `EditorSaveStatus` with `dirty`, `saving` (a save is in progress), `saved`
   (the 1.5 s flash after a save) and `error` (the save error).
5. The **on/off switch**: a toggle icon only (green "on" toggle, muted "off"
   toggle), tooltip `Enabled` or `Disabled`. Click flips Enabled.
6. **Delete** (only for a stored script): trash icon and `Delete`, destructive
   color.
7. **Save**: save icon and `Save`, white text on an orange-to-red gradient.
   Disabled while a save is in progress or while the find pattern has an error.

## Unsaved bar and error banner

- **Unsaved bar** (`UnsavedChangesBar`, right under the header): shown after
  Back with unsaved edits. **Keep editing** hides it. **Discard** closes the
  editor without saving. **Save & close** saves, then closes (but see decision
  1). Its `saving` is the save-in-progress state. The bar hides once nothing is
  unsaved: after a successful Save from the header, and whenever the form resets
  (another script or **New** opens, or the id has no row).
- **Save error banner** (`SaveErrorBanner`, under that): shows the save error;
  dismissing it clears the error.

## Body

A scrolling area under those, with a centered column (max width about 48rem)
of groups spaced apart. Each group has a header row (a small orange icon, the
label in small semibold text, and a `HelpTooltip` with the help text) and its
controls under it. In order:

### Find Pattern (Regex)

Help: `The regular expression pattern to search for. Written without delimiters. Macros resolve with sample values in Live Test and chat values at runtime.`

One-line monospace input, placeholder `e.g. \\*([^*]+)\\*`. Typing sets the
find pattern. With a pattern error the input's ring turns red and the error
text shows right under it in small red text.

**Pattern error.** Empty pattern: no error. Otherwise resolve the pattern's
macros with the **sample context** (below) and the current Live Test text; an
empty result is no error; otherwise `new RegExp(resolved, flags)`; if it
throws, the error is the thrown message (the browser's own text, for example
`Invalid regular expression: /(/gi: Unterminated group`).

**Sample context** (`MacroContext`, macros resolved with `trimResult: false`):
user `User`, char `Character`, characters `["Character"]`, no variables,
`lastInput` = the Live Test text or `Sample input` when it is empty, character
fields description/personality/backstory/appearance/scenario/example/systemPrompt/postHistoryInstructions
= `Character description`, `Character personality`, `Character backstory`,
`Character appearance`, `Character scenario`, `Character example`,
`Character system prompt`, `Character post-history instructions`, persona
fields description/personality/backstory/appearance/scenario = `Persona
description` … `Persona scenario` in the same pattern.

### Replace With

Help: `The replacement string. Supports capture groups ($1, $2), named groups ($<name>), and case transforms like \u$1, \U$1\E, \l$1, and \L$1\E. Leave empty to delete matched text.`

One-line monospace input, placeholder `e.g. $1 or leave empty to remove`.

### Regex Flags

Help: `Standard regex flags: g (global), i (case-insensitive), m (multiline), s (dotAll), u (unicode).`

Five small square buttons `g`, `i`, `m`, `s`, `u` (bold monospace), selected
(orange tint and ring) when the flags contain that letter. Clicking a selected
one removes the first occurrence of that letter from the flags; clicking an
unselected one appends it. Other letters already in the stored flags stay
untouched.

### Apply To

Help: `Where this regex is applied. AI Output transforms incoming responses; User Input transforms your messages before sending.`

Two buttons side by side (two equal columns), each a label over a tiny
description:

- **AI Output**: `Applied to AI responses before they are displayed.`
- **User Input**: `Applied to your messages before they are sent.`

Selected ones are orange. Clicking toggles that place, except that the last
selected place can't be turned off (the click does nothing to the selection,
but still marks the form unsaved). A newly selected place is added at the end.

### Character Scope

Help: `Leave global to run this regex in every chat, or choose characters to run it only in their chats. Character scripts never change saved messages.`

- A full-width **Global** button, selected (orange, with a check mark at the
  right) when no character is chosen. Clicking it clears the chosen characters.
- When there are characters: a list box (max height about 11rem, scrolls) with
  one row per character, sorted by display name (`data.name` trimmed, or the id
  when that is empty) with `localeCompare`. Each row has a small checkbox square
  (orange with a white check when chosen) and the name (truncated). Clicking a
  row uses `nextRegexScriptTargetCharacterIds` (adds at the end or removes).

### Trim Strings

Help: `Additional strings to remove from the result after the regex replacement. One per row.`

One row per trim string: a small monospace input (placeholder
`String to trim…`) and a red X button that removes that row. Under them an
**Add trim string** button (plus icon, tiny text) that appends an empty row.

### Advanced Options

Help: `Fine-tune when and how the regex runs.`

- **Shows in**: a label (`Shows in`, small medium text) and a group of three
  buttons labeled with `REGEX_APPLY_MODE_LABELS` (Prompt, Display, Both) in
  `REGEX_APPLY_MODES` order, `aria-pressed` on the selected one, the group
  labelled by the `Shows in` label. Under them in tiny muted text:
  `regexApplyModeHelp(mode, at least one character chosen)`.
- **Execution Order**: label `Execution Order`, a number input (about 5rem
  wide), and muted text `Lower numbers run first`. Each input event sets the
  order to `parseInt(text) || 0` (so clearing the box shows 0 right away, and
  `1.5` becomes 1).
- **Depth Range**: label `Depth Range`, a number input (placeholder `Min`),
  `to`, a number input (placeholder `Max`), and muted text
  `message depth (empty = unlimited)`. Each input event sets the value to
  `parseInt(text)` when the box isn't empty, else empty (null).

### Live Test

Help: `Test your regex pattern against sample text. Macros use sample User and Character values here.`

A three-row monospace text area (resizable vertically), placeholder
`Paste sample text to test…`. When it isn't empty, a card under it with
`Result:` (tiny muted text) and the result in green monospace, keeping line
breaks.

**Result**: the Live Test text unchanged if the find pattern is empty or has an
error, or resolves (with the sample context) to empty, or anything throws.
Otherwise `applyRegexScriptReplacement(text, new RegExp(resolvedPattern,
flags), replaceString, trimStrings, resolve)` where `resolve` resolves macros
with the sample context.

### About card

A card with the heading `About Regex Scripts` and, in small muted text:

- `Regex scripts are applied to text during chat — either transforming AI responses before display, or modifying your input before it's sent.`
- `Scripts run in order (lowest first). Use capture groups ($1, $2) in the replacement to reference matched groups. Use \u$1 to capitalize the first character of a capture, or \U$1\E to uppercase a capture.` (with `$1`, `$2`, `\u$1`, `\U$1\E` as inline code)
- **Examples:** (bold, foreground color), then a bulleted list: `Remove asterisks: \\*([^*]+)\\* → $1`, `Remove OOC: \\(OOC:.*?\\) → (empty)`, `Censor words: \\bbadword\\b → ***`, `Capitalize replacement: \U$1` (patterns and replacements as inline code).
- For a stored script only: **ID:** and the script's id.

## Save

Save (the button, or Save & close) does nothing without a `regexDetailId`.
Otherwise it clears the save error and sends this **payload**, field for field,
in this order:

| Field                | Value                                         |
| -------------------- | --------------------------------------------- |
| `name`               | the name as typed (not trimmed)               |
| `enabled`            | true/false                                    |
| `findRegex`          | the find pattern as typed                     |
| `replaceString`      | as typed                                      |
| `trimStrings`        | the rows, in order, as typed (empty rows too) |
| `placement`          | the selected places, in selection order       |
| `flags`              | the flags string                              |
| `promptOnly`         | true only when the mode is `prompt`           |
| `applyMode`          | the mode                                      |
| `order`              | the order number                              |
| `minDepth`           | number or null                                |
| `maxDepth`           | number or null                                |
| `characterId`        | the first chosen character, or null           |
| `targetCharacterIds` | the chosen characters, in order               |

- Stored script: `useUpdateRegexScript().mutateAsync({ id, ...payload })`.
- New script: `useCreateRegexScript().mutateAsync(payload)`; if the result has
  an id, `openRegexDetail(thatId)` (the editor now shows the stored script).
- On success: not unsaved any more, and `Saved` shows for 1.5 s.
- On failure: the save error is the error's message (or
  `Failed to save regex script` when it isn't an `Error`); the form keeps its
  edits. The schemas reject an empty name, a name over 200 characters, an empty
  find pattern and an empty placement list; the old editor shows the schema's
  raw message for these (but see decision 4).

## Delete

Only for a stored script. Asks with `showConfirmDialog({ title: "Delete Regex
Script", message: "Delete this regex script? This cannot be undone.",
confirmLabel: "Delete", tone: "destructive" })`. Cancel: nothing. Confirm:
`useDeleteRegexScript().mutateAsync(id)`, then `closeRegexDetail()` (but see
decision 3 for a failure).

## Layout

The editor fills the detail area (column, page background). The header is one
row. Exact text sizes, so the rebuild looks the same:

| Element                                                                                                                                                             | Size                           |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| Name input                                                                                                                                                          | 1.125rem, semibold             |
| Group labels                                                                                                                                                        | 0.875rem, semibold             |
| Find / Replace inputs                                                                                                                                               | 0.875rem, monospace            |
| Header buttons (Delete, Save), enable switch, Global and character rows, Apply To labels, Execution Order / Depth Range / Shows in labels, About heading (semibold) | 0.75rem                        |
| Trim string inputs, Live Test text area and result                                                                                                                  | 0.75rem, monospace             |
| Shows in buttons, About card text                                                                                                                                   | 0.6875rem                      |
| Pattern error, Add trim string, Result label, mode help, order and depth notes                                                                                      | 0.625rem                       |
| Apply To descriptions                                                                                                                                               | 0.5625rem                      |
| Header icon tile                                                                                                                                                    | 2.5rem square, 0.75rem corners |
| Flag buttons                                                                                                                                                        | 2rem square                    |

Inputs use the secondary background with a 1px border-color ring and a 2px
ring color on focus; rounded corners (0.75rem for big inputs and cards,
0.5rem for small ones). The body has 1.5rem padding and 1.5rem between groups.
At 660px wide the same single column fits without sideways scrolling; the
header still fits on one row (the name input shrinks). Selected options use the
orange accent (`orange-400`) as in the screenshots; everything else uses the
theme tokens, so light and dark themes both follow the app.

The builder gets screenshots of the old editor at 1366x900 and 660x900, in
dark and light theme, for a new script, a stored script with characters and
trim strings, the unsaved bar, a pattern error and a Live Test result. Match
them.

## Removed

- The `try`/`catch` around reading `trimStrings` and `placement`: reading an
  array can't throw.

## Decisions

The rebuild keeps every saved payload and every visible text exactly as above,
except:

1. **Save & close closes even when the save failed.** The edits are lost and
   the error is never seen. Recommended: on a failed save, stay open with the
   error banner showing and the unsaved bar hidden. Changes behavior on
   purpose (the recording shows the old close).
2. **A save clears the Live Test text.** The list refresh after a save gives a
   new copy of the row, which resets the form, Live Test included.
   Recommended: keep the Live Test text when the same script reloads; still
   clear it when another script, or **New**, opens. The first save of a new
   script, after which the editor shows the created script, counts as the same
   script, so the text stays. Changes behavior on purpose.
3. **A failed delete says nothing.** The error is unhandled and the editor
   stays open. Recommended: show the error in the save error banner (`Couldn't
delete: <message>`), stay open. The header's save status doesn't change (it
   says nothing about the delete).
4. **Validation errors are raw.** Saving with an empty name, a name over 200
   characters, an empty find pattern or no place to apply shows the schema's
   raw JSON message. Recommended: check these before sending and show one plain
   message in the save error banner, in this order: `Give the script a name.`,
   `Keep the name to 200 characters or fewer.`, `Add a find pattern.`,
   `Pick where it applies: AI Output, User Input or both.` Nothing is sent.
5. **Toggles aren't announced.** The on/off switch has only a tooltip; the
   flag, Apply To, Global and character buttons show their state only by
   color. Recommended: the switch gets `role="switch"`,
   `aria-checked` and `aria-label="Enabled"`; the flag, Apply To, Global and
   character buttons get `aria-pressed`; the trim row's X gets
   `aria-label="Remove trim string"`. Screen readers only.
6. **Not in this rebuild** (unchanged, possible follow-ups): Execution Order
   jumping to 0 while the box is cleared, a min depth larger than the max being
   accepted, the last Apply To place marking the form unsaved when it can't be
   turned off, and an edit in another tab being overwritten when this editor
   saves.
7. **Follow-ups, shipped after the rebuild.** Four bugs carried over from the
   old editor, fixed in their own PR:
   - **A decimal depth became NaN.** Typing `.5` in a Depth Range box set the
     depth to `NaN`, which the storage schema rejects with a raw message. Now
     the box's text is read as the number it is and cut to its whole part:
     `.5` and `-.5` give 0, `2.9` gives 2, `1e3` gives 1000.
   - **Save & close sent a pattern that doesn't compile.** Save is disabled
     while the find pattern has an error, but Save & close in the unsaved bar
     wasn't. Now it shows `Fix the find pattern first: <error>` in the save
     error banner, sends nothing and stays open.
   - **Live Test could freeze the page.** A pattern that backtracks
     catastrophically, like `(a+)+$` or `.*.*.*.*=`, ran on every keystroke.
     Now every Live Test first runs the same replace, on the same text, in a
     background worker (one is kept between runs). Only when that finishes
     within 300 ms does the page run it. If it doesn't, the worker is ended and
     Live Test shows `Live Test stopped: this pattern took too long on this
text and could freeze the app. Patterns with repeats inside repeats, like
(a+)+, or many repeats in a row, like .*.*.*, often do this.` While a run
     is being tried (a few milliseconds), the previous result stays shown.
     Where no worker can run it shows `Live Test can't run here: it needs a
background worker to try the pattern safely.` The pattern's macros are
     resolved once, so the pattern error, the trial and the page all see the
     same pattern (`{{random}}` would otherwise differ). Saving is still
     allowed.
   - **Typing during a save was lost.** The list refresh after a save reset
     the form, dropping anything typed while the save was on its way. Now a
     refreshed row that matches what one of this editor's saves sent doesn't
     reset the form, so those edits stay, still unsaved. This covers several
     saves in a row and a new script's first save; while a new script's row is
     on its way the form stays up instead of showing "not found". Only the
     newest save, while its script is still open, marks the form saved, and
     Save & close stays open when more was typed during its save. A row that
     doesn't match a sent save (a change from anywhere else) still reloads
     the form, as before.

## Tests

The new module's tests use the recordings:

- For every recorded starting state (stored rows with legacy and odd values,
  a new script, a missing id, character lists): every field's shown value, every
  selected option, which groups and rows show, the save status, the header
  buttons' presence and disabled state, the pattern error text and the Live
  Test result match the recording.
- For every recorded action sequence: the visible state after each step, every
  storage call (create, update, delete, with the exact payload) and every store
  call (`openRegexDetail`, `closeRegexDetail`, `setEditorDirty`) match the
  recording, except where decisions 1 to 4 change them on purpose.
- Each decision has a test.

## Acceptance checks

- Real Chrome, a local server with throwaway characters and scripts, at
  1366x900 and 660x900: the recorded step lists give the same stored rows and
  the same visible states as the old build, and the screenshots match the old
  ones by eye (dark and light).
- A local copy of the Pi data (connections blanked first): opening every stored
  regex script shows the same form in the new build as in the old one, and
  saving without changes stores the same row.
- `RegexScriptEditor.tsx` is gone and nothing imports it.

## Black-box recording plan

Recorded by someone other than the builder, on `main` before the old file is
deleted, with no real data and no model calls (this screen makes none).
Saved under
`src/features/catalog/regex-scripts/components/regex-script-editor/test-fixtures/`
as one-line JSON (listed in `.prettierignore`, so the provenance report doesn't
count recordings as code), each file under about 1 MB.

1. **Component recordings**: the old editor rendered in the test environment as
   a black box: a fake storage behind the regex hooks (list, create, update,
   delete; can be told to fail), a fake character list, the real UI store, and
   the confirm dialog answered by the recorder. Starting states: a new script,
   a missing id, and stored rows covering every field (legacy string `enabled`,
   `promptOnly` without `applyMode`, each mode, empty and odd placements, a
   `characterId` only, `targetCharacterIds` as an array and as a JSON string,
   extra flag letters, depths set and empty, trim strings, macros in the
   pattern), with no characters and with several. For each: the shown state,
   then action sequences (typing into each field, every flag, place, scope,
   trim and mode button, order and depth values including empty and `1.5`,
   Live Test texts with and without matches and macros, a pattern error, Save
   success and failure, Back with and without edits and each unsaved-bar
   button, Delete with cancel and confirm), recording after each step the shown
   state and every call made.
2. **Real Chrome**, headless Chrome with a local server and throwaway
   characters and scripts: the same kinds of step lists through the real
   Regex Scripts list at 1366x900 and 660x900, recording after each step the
   shown state and every `/api/invoke` storage call, and the stored row after
   each save; plus the builder's screenshots (dark and light).

The builder gets the recordings, the screenshots and this spec. The recordings
show the old behavior that decisions 1 to 5 change on purpose.
