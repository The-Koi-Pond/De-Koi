# Custom Tool Editor: Behavior Spec

Status: agreed 2026-11-20 (decisions as recommended). Part of the code
provenance plan (`docs/code-provenance-plan.md`, tracked in #1580).

This spec describes the custom tool editor: the full-page screen that opens
when someone clicks a function (or **+**) in the **Functions** list of the
Presets panel, or a tool in the **Custom Tools** list of the Agents panel. It
edits one custom tool's name, description, parameters, execution type and its
static result or webhook URL, and it saves, creates or deletes the tool. It is
the only input the builder uses. It describes behavior, not the old
implementation.

## Rules for the builder

Build from this spec, the recordings, the screenshots and the team-owned code
around it. Don't open, search, or read the history of the old implementation:

- `src/features/catalog/agents/components/ToolEditor.tsx`

You may read every interface listed under "Neighbors". If this spec doesn't
answer a question, ask the spec writer.

**Safety.** The editor sends no model requests and never calls the webhook
(the webhook is only called when a model calls the tool during a chat). But
what it saves is a tool definition that goes into model requests: the name,
description and parameter schema are sent to the model as a function, and the
static result or webhook URL decides what the model gets back. So every saved
field is a compatibility contract and must stay exactly the same (see "Save").
Someone other than the builder records the old editor as a black box first (see
"Black-box recording plan"), the recordings become tests, and the builder sees
the recordings, never the old code. Where this text and a recording disagree,
the recording wins, except where a decision below changes the behavior on
purpose; tell the spec writer so the spec gets fixed.

## Scope

Lines not yet team-owned, from `node scripts/code-provenance.mjs --fast` at
`e752cf6c6d`:

| File                                                    | Not owned | Of lines |
| ------------------------------------------------------- | --------: | -------: |
| `src/features/catalog/agents/components/ToolEditor.tsx` |       382 |      407 |

Replaced, then deleted in the same change. The new module lives in
`src/features/catalog/agents/components/tool-editor/` and exports `ToolEditor`
(no props) with the same name. `src/features/catalog/agents/shell.ts`
re-exports it from the new path; nothing else changes for the callers.

### Neighbors (not rebuilt)

- `src/app/shell/detail-route-registry.tsx` lazy-loads the editor through
  `shell.ts` and shows it while `toolDetailId` is set.
- `src/features/catalog/presets/components/PresetsPanel.tsx` (Functions
  section) and `src/features/catalog/agents/components/AgentsPanel.tsx` (Custom
  Tools section) open it: `openToolDetail("__new__")` for a new tool,
  `openToolDetail(id)` for an existing one.
- UI store (`src/shared/stores/ui.store`): `toolDetailId`,
  `openToolDetail(id)`, `closeToolDetail()`, `setEditorDirty(dirty)`.
- `src/features/catalog/agents/hooks/use-custom-tools.ts`: `useCustomTools()`
  (the whole list), `useCreateCustomTool()`, `useUpdateCustomTool()`,
  `useDeleteCustomTool()`, type `CustomToolRow`. Create and update validate with
  `createCustomToolSchema` / `updateCustomToolSchema`
  (`src/engine/contracts/schemas/custom-tool.schema.ts`) and refresh the list on
  success. What storage receives is the schema's parsed output (for example
  the schema trims a webhook URL).
- `boolish(value, fallback)` from `src/engine/generation/runtime-records.ts`
  (how chats and the Functions list read `enabled`).
- `src/shared/components/ui/ExplicitSaveChrome.tsx`: `EditorSaveStatus`,
  `SaveErrorBanner`, `UnsavedChangesBar`.
- `src/shared/components/ui/HelpTooltip.tsx`, `src/shared/lib/app-dialogs.ts`
  (`showConfirmDialog`), `src/shared/lib/utils.ts` (`cn`), `lucide-react`
  icons.

How chats use a saved tool (for context, not rebuilt):
`src/engine/generation/tools-runtime.ts` skips a tool unless
`boolish(enabled, false)` is true and its type is `static` or `webhook`, and
sends `parametersSchema` to the model as the function's parameters. The server
(`src-tauri/src/commands/storage/custom_tools.rs`) calls the webhook and
refuses non-https or local addresses at that point.

## Which tool

- `toolDetailId` is `"__new__"`: a **new** tool (not saved yet).
- Otherwise the tool is the row in `useCustomTools()` with that id.
- No id, or an id with no row (including while the list is still loading):
  only the text **Tool not found.**, centered in the page, small muted text.
  Nothing else.

## Loading the form

When the editor opens a tool, and again whenever the id changes (also to an id
with no row, or to `"__new__"`) or the list gives a changed copy of that row
(for example after a save refreshes the list), the form is filled and reset. A
refresh that returns the row unchanged keeps the same row object (the query's
structural sharing), so it resets nothing and keeps unsaved edits (recordings
`refetch:keeps-edits` and `refetch:changed-row`):

| Field          | From a stored row                                                       | New tool |
| -------------- | ----------------------------------------------------------------------- | -------- |
| Name           | `name`                                                                  | empty    |
| Description    | `description`                                                           | empty    |
| Execution type | Webhook when `executionType` is `"webhook"`, else Static Result         | Static   |
| Webhook URL    | `webhookUrl`, or empty when null                                        | empty    |
| Static result  | `staticResult`, or empty when null                                      | empty    |
| Parameters     | one row per entry of `parametersSchema.properties`, in the object order | none     |

A name, description, URL or static result that is missing or not a string
loads as empty.

**Parameters.** `parametersSchema` that isn't an object, or has no
`properties` object, gives no rows. Each property gives a row with:

- **name**: the property key, as stored;
- **type**: the property's `type` when it is a string, else `string`;
- **description**: the property's `description` when it is a string, else
  empty;
- **required**: true when `parametersSchema.required` is an array that contains
  the key (non-string entries are ignored; a `required` that isn't an array
  means none are required).

The server stores object keys in sorted order, so in the real app the rows of a
stored tool come back sorted by name after every save (Chrome recordings). The
editor just shows the order it gets.

Every reset also clears unsaved state and the save error (and see decision 2
for the unsaved bar).

**Script tools.** A stored row whose `executionType` is `"script"` loads as a
Static Result tool (its `staticResult`, if any) and shows the script warning
(see Body). Any other unknown type also loads as Static Result, without the
warning.

**Unsaved state.** Any edit marks the form unsaved, including typing a value
back to what it was, clicking the execution type that is already selected,
adding or removing a parameter. The editor tells the store through
`setEditorDirty` whenever its unsaved state changes.

## Header

One row across the top, on the card background with a bottom border, in this
order:

1. **Back** button, an arrow icon, `aria-label="Back to tools"`. With unsaved
   edits it shows the unsaved bar (below) instead of leaving; otherwise it
   calls `closeToolDetail()`.
2. A small square tile on the primary color with a wrench icon in the primary
   foreground color.
3. The **name** input: no border, transparent background, large semibold
   monospace text, placeholder `tool_name`, fills the free width.
4. `EditorSaveStatus` with `dirty`, `saving` (a save is in progress), `saved`
   (the 1.5 s flash after a save) and `error` (the save error).
5. **Delete** (only for a stored tool): trash icon and `Delete`, destructive
   color text, no background.
6. **Save**: save icon and `Save`, primary background and primary foreground
   text, a shadow. Disabled while a save is in progress.

## Unsaved bar and error banner

- **Unsaved bar** (`UnsavedChangesBar`, right under the header): shown after
  Back with unsaved edits (Back again while it shows changes nothing). **Keep
  editing** hides it. **Discard** closes the editor without saving. **Save &
  close** saves, then closes only when the save succeeded; on a failure the
  editor stays open with the error and the bar. Its `saving` is the
  save-in-progress state. See decision 2 for when else it hides.
- **Save error banner** (`SaveErrorBanner`, under that): shows the save error;
  dismissing it clears the error.

## Body

A scrolling area under those, with a centered column (max width 48rem) of
blocks spaced 1.5rem apart. Each group has a header row (a small icon in the
primary color, the label in small semibold text and, where given, a
`HelpTooltip` with the help text) and its controls under it. In order:

### Name hint

Tiny muted text, no group header:
`Tool name must be lowercase snake_case (e.g. check_weather). This is the identifier the AI will use to call this function.`
with `check_weather` as inline code (secondary background, small padding,
rounded).

### Script warning

Only for a stored row whose `executionType` is `"script"`: an amber box
(amber border and tint, amber text, rounded, small text) saying
`Script custom tools are disabled in this runtime. Convert this tool to a static result or webhook before saving.`

### Description

Icon: info. Help:
`Tell the AI what this tool does. Be descriptive — the AI reads this to decide when and how to call your tool.`

One-line input, placeholder
`Describe what this tool does — the AI reads this to decide when to call it…`.

### Parameters

Icon: code. Help:
`The input arguments the AI can pass when calling this tool. Each parameter has a name, type, and description.`

Tiny muted text `Define the arguments the AI can pass when calling this tool.`,
then one card per parameter row and an **Add Parameter** button.

Each row card (card background, border-color ring, rounded, padded) has, on
the left, two lines:

1. a monospace **name** input (placeholder `param_name`, 8rem wide), a **type**
   dropdown with the options `string`, `number`, `boolean`, `array`, `object`
   (in this order; and see decision 5), and a **Required** checkbox with the
   tiny muted label `Required`;
2. a full-width **description** input, placeholder
   `Description of this parameter…`.

On the right, a small muted minus button that removes that row (red on hover).

**Add Parameter**: full width, dashed border, muted text with a plus icon;
appends a row with an empty name, type `string`, empty description, not
required.

### Execution Type

Icon: wrench. No help tooltip.

Two buttons side by side (two equal columns), each an icon over a label:

- **Static Result** (file icon), tooltip `Returns a fixed string when called.`
- **Webhook** (globe icon), tooltip `Sends a POST request to an external URL.`

The selected one has a primary tint, primary ring and primary text; the other
a border ring and muted text. Clicking one selects it (and marks unsaved).
Under them in tiny muted text: the selected type's tooltip text.

Switching type keeps what was typed in the other type's box: switching back
shows it again (it is only left out of the save, see "Save").

### Static Result (only when Static Result is selected)

Icon: file. A five-row monospace text area (resizable vertically), placeholder
`{"result": "OK"}`. Under it in tiny muted text:
`This string is returned as-is when the AI calls this tool. Useful for informational tools or placeholders.`

### Webhook URL (only when Webhook is selected)

Icon: globe. A one-line monospace input, placeholder
`https://api.example.com/my-tool`. Under it in tiny muted text:
`A POST request will be sent with { tool, arguments } as JSON body. Response is returned to the AI.`
with `{ tool, arguments }` as inline code.

## Save

Save (the button, or Save & close) does nothing without a `toolDetailId`.
Otherwise it clears the save error, then checks, in this order, stopping at the
first problem (the message goes to the save error banner and nothing is sent):

1. name empty after trimming: `Tool name is required.`
2. name doesn't match `^[a-z][a-z0-9_]*$` (checked on the name as typed, so
   spaces fail): `Tool name must be lowercase snake_case (e.g. my_tool).`
3. description empty after trimming: `Description is required.`
4. Static Result selected and the static result empty after trimming:
   `Static result is required for a static custom tool.`
5. Webhook selected and the URL empty after trimming:
   `Webhook URL is required for a webhook custom tool.`

(and see decision 4). Then it sends this **payload**, field for field, in this
order:

| Field              | Value                                                           |
| ------------------ | --------------------------------------------------------------- |
| `name`             | the name as typed                                               |
| `description`      | the description as typed (not trimmed)                          |
| `parametersSchema` | `{ type: "object", properties, required }` (below)              |
| `executionType`    | `"static"` or `"webhook"`                                       |
| `webhookUrl`       | Webhook: the URL as typed; Static Result: `null`                |
| `staticResult`     | Static Result: the text as typed (not trimmed); Webhook: `null` |
| `enabled`          | `true` (but see decision 1)                                     |

**`properties`**: for each row in order whose name isn't empty after trimming,
key = the name as typed (not trimmed), value = `{ type, description }` (but see
decision 5). Rows with an empty or blank name are left out silently. When two
rows have the same name, the later row's value wins, at the first row's
position. **`required`**: the names (as typed) of the included rows marked
Required, in row order (a duplicated name can appear twice).

- Stored tool: `useUpdateCustomTool().mutateAsync({ id, ...payload })`.
- New tool: `useCreateCustomTool().mutateAsync(payload)`; if the result has an
  id, `openToolDetail(thatId)` (the editor now shows the stored tool). If it
  has none, the editor stays on the new tool, saved and not unsaved.
- On success: not unsaved any more, and `Saved` shows for 1.5 s.
- On failure: the save error is the error's message (or `Failed to save tool`
  when it isn't an `Error`); the form keeps its edits. The schemas reject a
  name over 100 characters, a description over 500 and a webhook URL that
  isn't a URL; the old editor shows the schema's raw message for these (but see
  decision 4).

## Delete

Only for a stored tool. Asks with `showConfirmDialog({ title: "Delete Tool",
message: "Delete this custom tool? This cannot be undone.", confirmLabel:
"Delete", tone: "destructive" })`. Cancel: nothing. Confirm (also with unsaved
edits): `useDeleteCustomTool().mutateAsync(id)`, then `closeToolDetail()` (but
see decision 3 for a failure).

## Layout

The editor fills the detail area (column, page background). The header is one
row (padding 1rem across, 0.75rem down, 0.75rem gaps). Exact text sizes, so the
rebuild looks the same:

| Element                                                                                                     | Size                           |
| ----------------------------------------------------------------------------------------------------------- | ------------------------------ |
| Name input                                                                                                  | 1.125rem, semibold, monospace  |
| Description input                                                                                           | 0.875rem                       |
| Webhook URL input                                                                                           | 0.875rem, monospace            |
| Not found text                                                                                              | 0.875rem                       |
| Group labels                                                                                                | 0.75rem, semibold              |
| Header buttons (Delete, Save), script warning, Add Parameter, parameter type dropdown and description input | 0.75rem                        |
| Execution type buttons                                                                                      | 0.75rem, label medium          |
| Parameter name input, static result text area                                                               | 0.75rem, monospace             |
| Name hint, parameters intro, Required label, execution type note, static result note, webhook note          | 0.625rem                       |
| Header icon tile                                                                                            | 2.5rem square, 0.75rem corners |
| Header arrow and tile icons                                                                                 | 1.125rem                       |
| Header button icons                                                                                         | 0.8125rem                      |
| Execution type icons                                                                                        | 1rem                           |
| Group header icons                                                                                          | 0.875rem                       |
| Plus and minus icons                                                                                        | 0.75rem                        |

Inputs use the secondary background with a 1px border-color ring and a ring
color on focus (2px for the description, static result and URL; the parameter
controls keep 1px); rounded corners (0.75rem for the description, static
result, URL, row cards and execution type buttons, 0.5rem for parameter
controls and Add Parameter). The body has 1.5rem padding. At 660px wide the
same single column fits without sideways scrolling; the header still fits on
one row (the name input shrinks). Everything uses the theme tokens (primary,
secondary, card, border, muted, destructive), so light and dark themes both
follow the app; the script warning is amber.

The builder gets screenshots of the old editor at 1366x900 and 660x900, in
dark and light theme, for a new tool, a filled new tool (static and webhook), a
saved tool, the unsaved bar, a save error, a stored webhook tool (top and
bottom), an imported tool and a script tool. Match them.

## Decisions

The rebuild keeps every saved payload and every visible text exactly as above,
except:

1. **Save turns a turned-off tool back on.** `enabled` is always sent as
   `true`, so editing a tool that was switched off in the Functions list
   silently switches it on again for every chat. Recommended: keep its on/off
   state: a stored tool sends `boolish(row.enabled, false)` (the way chats and
   the list read it); a new tool sends `true`. Changes behavior on purpose (the
   recordings show the old `true`).
2. **The unsaved bar stays after it no longer applies.** After Back with edits,
   a successful Save from the header, or opening another tool or **New**,
   leaves the bar showing. Recommended: the bar hides once nothing is unsaved:
   after a successful save and whenever the form resets. A failed save keeps
   it. Changes behavior on purpose.
3. **A failed delete says nothing.** The error is unhandled and the editor
   stays open. Recommended: show the error in the save error banner
   (`Couldn't delete: <message>`), stay open. The header's save status doesn't
   change (it says nothing about the delete).
4. **Some validation errors are raw.** A name over 100 characters, a
   description over 500 or a webhook URL the schema rejects shows the schema's
   raw JSON message. Recommended: check these too, before sending, with the
   schema's own field rules (so the two can't disagree), and show one plain
   message. Full order: the five checks above, with
   `Keep the tool name to 100 characters or fewer.` right after check 2,
   `Keep the description to 500 characters or fewer.` right after check 3, and
   `Enter a full webhook URL, like https://api.example.com/my-tool.` last
   (Webhook selected only). Nothing is sent.
5. **Imported tools lose details on save.** A parameter's other keys (`enum`,
   `items`, `default`, nested `properties` and so on) and the schema's other
   top-level keys (like `additionalProperties`) are dropped, and a stored type
   that isn't one of the five (like `integer`) shows as `string` in the
   dropdown while it saves as stored. Recommended:
   - each row keeps its property's other keys, and saves
     `{ type, description, ...other keys in stored order }`, also when the row
     is renamed;
   - the schema saves as
     `{ type: "object", properties, required, ...other top-level keys in stored order }`
     (other = not `type`, `properties` or `required`);
   - a row whose stored type isn't one of the five shows that type as a sixth
     option in its own dropdown, selected; picking another type drops it from
     that row.

   Tools made in the editor have none of these, so their payloads don't change.
   Changes behavior on purpose for imported tools only.

6. **Controls aren't announced.** The execution type buttons show their state
   only by color, the remove button and the row controls have no names.
   Recommended: `aria-pressed` on Static Result and Webhook,
   `aria-label="Remove parameter"` on the minus button, and the labels
   `Tool name` on the header name input and `Parameter name`,
   `Parameter type`, `Parameter description` on the row controls. Screen
   readers only.
7. **Not in this rebuild** (unchanged, possible follow-ups): two parameters
   with the same name (the later wins, `required` lists it twice), parameter
   rows with no name dropped without a word, the schema accepting non-https
   URLs that the server refuses when the tool is called, parameters reordering
   by name after a save (the server sorts keys), and an edit in another tab
   being overwritten when this editor saves.

## Tests

The new module's tests use the recordings:

- For every recorded starting state (stored rows with legacy and odd values, a
  new tool, a missing id, an empty list): every field's shown value, the
  selected execution type, which groups and rows show, the save status, the
  header buttons' presence and disabled state and the visible text match the
  recording.
- For every recorded action sequence: the visible state after each step, every
  storage call (create, update, delete, with the exact payload) and every store
  call (`openToolDetail`, `closeToolDetail`, `setEditorDirty`) match the
  recording, except where decisions 1 to 6 change them on purpose.
- Each decision has a test.

## Acceptance checks

- Real Chrome, a local server with throwaway tools, at 1366x900 and 660x900:
  the recorded step lists give the same stored rows and the same visible states
  as the old build (except the decisions), and the screenshots match the old
  ones by eye (dark and light).
- A local copy of the Pi data (connections blanked first): the editor opens,
  creates, saves and deletes a throwaway tool the same way in both builds. (The
  Pi has no custom tools today.)
- `ToolEditor.tsx` is gone and nothing imports it.

## Black-box recording plan

Recorded by someone other than the builder, on `main` before the old file is
deleted, with no real data, no model calls and no webhook calls (this screen
makes none). Saved under
`src/features/catalog/agents/components/tool-editor/test-fixtures/` as one-line
JSON (listed in `.prettierignore`, so the provenance report doesn't count
recordings as code), each file under about 1 MB.

1. **Component recordings**: the old editor rendered in the test environment as
   a black box: a fake storage behind the custom tool hooks (list, create,
   update, delete; can be told to fail, to hold a save, or to return no id),
   the real UI store, and the confirm dialog answered by the recorder. Starting
   states: a new tool, a missing id, an empty list, and stored rows covering
   every field (static and webhook with left-over values in the other field,
   `enabled` false / `"false"` / `1`, script and unknown types, empty, null,
   string and odd parameter schemas, extra schema keys and an `integer` type,
   `required` that isn't an array or names a missing key, a name that isn't
   snake_case, an empty description, a blank static result, a name over 100, a
   description over 500, a bad and an `ftp:` URL, macros and Unicode). For
   each: the shown state, then action sequences (typing into each field, adding,
   editing, retyping and removing parameters, every type, Required on and off,
   blank and duplicate names, switching execution type and back, Save success
   and failure, a held save, each validation message in order, Back with and
   without edits and each unsaved-bar button, opening another tool or New with
   edits, a list refresh with and without a changed row, Delete with cancel,
   confirm and failure), recording after each step the shown state and every
   call made.
2. **Real Chrome**, headless Chrome with a local server and throwaway tools:
   the same kinds of step lists through the real Functions list at 1366x900 and
   660x900 in dark and light, recording after each step the shown state and
   every `/api/invoke` storage call for `custom-tools` (and any command that
   could reach a model or the webhook: there are none), and the stored row
   after each save; plus the builder's screenshots.

The builder gets the recordings, the screenshots and this spec. The recordings
show the old behavior that decisions 1 to 6 change on purpose.
