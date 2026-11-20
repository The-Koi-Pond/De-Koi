# Regex script editor recordings

Black-box recordings of the old regex script editor (see `docs/provenance/regex-script-editor.md`), made on `main`
before the old file was deleted. One-line JSON, listed in `.prettierignore`, so the provenance report doesn't count
them as code. Don't edit them by hand. The recordings show the old behavior; spec decisions 1 to 5 change some of it
on purpose.

## `recorded-show.json` and `recorded-actions.json` (test environment)

The old editor rendered in jsdom with the real UI store, the real regex and character hooks inside a fresh
`QueryClient` (no retries) per scenario, `storageApi` replaced by an in-memory fake, and `showConfirmDialog` answered
by the recorder. Each file is `{ format: 1, rows, scenarios }`. `rows` is the stored regex-script list every scenario
starts from unless the scenario has its own `rows` (`"ALL"` means `rows`).

Fake storage: `list("regex-scripts")` returns copies of the stored rows (a new object every time),
`list("characters", options)` the scenario's `characters`, `create` stores `{ ...payload, id: "created-<n>",
createdAt, updatedAt }` and returns it, `update` merges and returns the row, `delete` removes it. A `["fail", op,
message]` step makes the next `op` throw `new Error(message)`; `["hold"]` makes the next create/update wait until
`["release"]`.

A scenario: `id`, `detailId` (the store's `regexDetailId` at mount), `characters`, `rows`, `steps`, `unhandled`
(unhandled promise rejections during the scenario). Each step result has `step` and then either `error` (the
recorder couldn't find the control) or:

- `text`: the editor's `textContent` with whitespace collapsed (help tooltips closed);
- `inputs`: every `input`/`textarea` in page order: `tag`, `type`, `placeholder`, `value`, `invalid` (the find
  pattern shows its error ring);
- `buttons`: every `button` in page order: `text` (collapsed `textContent`), `aria-label`, `title`, `aria-pressed`
  when present, `disabled`, `selected` (shown in the orange selected style), `checked` (character rows: the checkbox
  square is filled), `icon` (the on/off switch: `lucide-toggle-right` on, `lucide-toggle-left` off);
- `result`: the Live Test result text, or null when no result card shows;
- `patternError`: the pattern error text under the find input, or null;
- `store`: `regexDetailId` and `editorDirty` after the step;
- `calls`: storage calls and confirm dialogs since the previous step, in order: `["list", entity, options]`,
  `["get", ...]`, `["create", "regex-scripts", payload]`, `["update", "regex-scripts", id, payload]`,
  `["delete", "regex-scripts", id]`, `["confirm", options]`. Payloads are what reached storage (after the schema).

Step kinds: `["mount"]`; `["type", placeholder, value]` (set the value of the first input with that placeholder and
fire `input`; `#order` is the Execution Order number input); `["typeAt", placeholder, index, value]`;
`["click", text]` / `["clickAt", text, index]` (a button by its collapsed `textContent`); `["clickTitle", title]`;
`["clickLabel", ariaLabel]`; `["removeTrim", index]` (the X next to trim row `index`); `["dismissError"]` (the save
error banner's X); `["confirm", answer]` (how the next confirm dialog is answered); `["fail", op, message]`;
`["hold"]`; `["release"]`; `["wait", ms]` (real time passes, for the 1.5 s Saved flash); `["refetch"]` (the regex
list query is invalidated, as another part of the app would).

Help buttons: the shared `HelpTooltip` labels its button `Help: <first sentence>`.

## `recorded-chrome.json` (real Chrome)

Headless Chrome, the app on a local server with throwaway data, at 1366x900 and 660x900 in dark and light theme.
Three flows per viewport and theme, each opened through the real Regex Scripts list (Presets panel; on phones
Tools → Presets):

- `new`: Create regex script, then every control, Live Test, Save (create), rename, Back → unsaved bar → Save &
  close;
- `stored`: open a stored script (two characters, two places, trims, display mode, depths), Live Test, a pattern
  error and its fix, on/off, Global, remove a trim, Save, Delete → Cancel, Delete → Delete;
- `plain`: open a legacy script (`promptOnly: true`, no `applyMode`, disabled), Save unchanged, Back.

Each step has the same snapshot fields as above (taken from the part of the page that holds the editor; `open:
false` once it has closed), plus `width` (the editor's width), `scrollWidth` and `innerWidth` (no sideways scroll),
and `calls`: every `storage_create`/`storage_update`/`storage_delete` request for `regex-scripts` with its `args`,
HTTP `status` and `reply` (without `id`/`createdAt`/`updatedAt`). `stored`, `storedAfterSave` and
`storedAfterDelete` are the stored rows read back from the server. Ids are replaced by `<id1>`, `<id2>`, … in order of
first appearance within each flow.
