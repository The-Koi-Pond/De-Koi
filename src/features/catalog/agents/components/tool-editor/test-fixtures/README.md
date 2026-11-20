# Custom tool editor recordings

Black-box recordings of the old custom tool editor (see `docs/provenance/tool-editor.md`), made on `main` before the
old file was deleted. One-line JSON, listed in `.prettierignore`, so the provenance report doesn't count them as
code. Don't edit them by hand. The recordings show the old behavior; spec decisions 1 to 6 change some of it on
purpose.

## `recorded-show.json` and `recorded-actions.json` (test environment)

The old editor rendered in jsdom with the real UI store and the real custom tool hooks inside a fresh `QueryClient`
(no retries) per scenario, `storageApi` replaced by an in-memory fake, and `showConfirmDialog` answered by the
recorder. Each file is `{ format: 1, rows, scenarios }`. `rows` is the stored custom-tools list every scenario starts
from unless the scenario has its own `rows` (`"ALL"` means `rows`).

Fake storage: `list("custom-tools")` returns copies of the stored rows (a new object every time), `create` stores
`{ ...payload, id: "created-<n>", createdAt, updatedAt }` and returns it, `update` merges and returns the row,
`delete` removes it. A `["fail", op, message]` step makes the next `op` throw `new Error(message)`; `["hold"]` makes
the next create/update wait until `["release"]`; `["createNoId"]` makes the next create return `{ ok: true }` (no
id); `["patchRow", id, patch]` changes a stored row behind the editor's back (seen after the next `refetch`).

A scenario: `id`, `detailId` (the store's `toolDetailId` at mount), `rows`, `steps`, `unhandled` (unhandled promise
rejections during the scenario). Each step result has `step` and then either `error` (the recorder couldn't find the
control) or:

- `text`: the editor's `textContent` with whitespace collapsed (help tooltips closed);
- `fields`: every `input`/`textarea`/`select` in page order. Inputs and text areas: `tag`, `type`, `placeholder`,
  `value`, `checked` (checkboxes), `aria-label` when present. Selects: `tag: "select"`, `value`, `selectedIndex`,
  `options` (the option values). jsdom shows a select whose value matches no option as its first option; real Chrome
  does the same (see the `legacy` Chrome flow);
- `buttons`: every `button` in page order: `text` (collapsed `textContent`), `aria-label`, `title`, `aria-pressed`
  when present, `disabled`;
- `store`: `toolDetailId` and `editorDirty` after the step;
- `calls`: storage calls and confirm dialogs since the previous step, in order: `["list", entity, options]`,
  `["get", ...]`, `["create", "custom-tools", payload]`, `["update", "custom-tools", id, payload]`,
  `["delete", "custom-tools", id]`, `["confirm", options]`. Payloads are what reached storage (after the schema).

The selected execution type has no field of its own: it shows in `text` (the note under the two buttons is the
selected type's tooltip, and only the selected type's box shows).

Step kinds: `["mount"]`; `["type", placeholder, value]` (set the value of the first input or text area with that
placeholder and fire `input`); `["typeAt", placeholder, index, value]`; `["select", index, value]` (the parameter type
dropdown of row `index`, fires `change`); `["check", index]` (click the Required checkbox of row `index`);
`["click", text]` / `["clickAt", text, index]` (a button by its collapsed `textContent`); `["clickLabel",
ariaLabel]`; `["removeParam", index]` (the minus button of parameter row `index`); `["dismissError"]` (the save error
banner's X); `["confirm", answer]` (how the next confirm dialog is answered); `["fail", op, message]`; `["hold"]`;
`["release"]`; `["createNoId"]`; `["patchRow", id, patch]`; `["wait", ms]` (real time passes, for the 1.5 s Saved
flash); `["refetch"]` (the custom-tools list query is invalidated, as another part of the app would); `["open", id]`
(the store's `toolDetailId` is set to `id`, as the lists would).

Help buttons: the shared `HelpTooltip` labels its button `Help: <first sentence>`.

## `recorded-chrome.json` (real Chrome)

Headless Chrome, the app on a local server with throwaway data, at 1366x900 and 660x900 in dark and light theme.
Three flows per viewport and theme, each opened through the real Functions list (Presets panel; on phones Tools →
Presets):

- `new`: Create function, Save empty (error), dismiss, name, description, three parameters (fill, Required, type,
  remove the third), Webhook + URL, back to Static Result + text, Save (create), rename, Back → unsaved bar → Save &
  close;
- `stored`: open a stored webhook tool (three parameters), a bad name and its error, fix, Required off/on, change a
  type, remove a parameter, edit the URL, Save, Delete → Cancel, Delete → Delete;
- `legacy`: open a disabled imported tool (`enum`, `items`, `additionalProperties`, an `integer` type), Save
  unchanged; open a tool created with a JSON-string schema (the server stored it as an object), Save unchanged; open
  a script tool, Save (error), type a static result, Save.

Each step has the same snapshot fields as above (taken from the part of the page that holds the editor; `open:
false` once it has closed), plus `width` (the editor's width), `scrollWidth` and `innerWidth` (no sideways scroll),
and `calls`: every `storage_create`/`storage_update`/`storage_delete` request for `custom-tools` with its `args`, HTTP
`status` and `reply` (without `id`/`createdAt`/`updatedAt`), and `{ other: command }` for any command that could
reach a model or a webhook (there are none). `stored`, `storedAfterSave`, `storedAfterDelete`, `legacyAfterSave`,
`stringAfterSave` and `scriptAfterSave` are the rows read back from the server (it stores object keys sorted). Ids
are replaced by `<id1>`, `<id2>`, … in order of first appearance within each flow.
