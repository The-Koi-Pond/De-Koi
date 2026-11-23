# Preset editor shell and Overview recordings

Black-box recordings of the old preset editor shell and **Overview** tab (see `docs/provenance/preset-overview.md`),
made from the old build before the old code was replaced. One-line JSON, listed in `.prettierignore`, so the
provenance report doesn't count them as code. Don't edit them by hand. They show the old behavior; spec decisions 1 to 3
add attributes on purpose.

## Files

| File                           | Scenarios | Steps | What                                                                                                                                                                                                                                                                                                                            |
| ------------------------------ | --------: | ----: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `recorded-show.json`           |        69 |   191 | every stored preset set mounted, then Sections, AI Review, Overview; every section, group and variable set and every active chat on the Sections tab (the probe props); loading (preset read held, sections read held), missing preset, failing reads, no preset open, connections empty / failing, tab cycling                 |
| `recorded-actions-edit.json`   |        27 |   113 | typing in each field, focus and selection, Enter / Escape, each wrap button (also from an unknown or `null` format), edits kept across tabs, refreshes while editing / clean / focused, a Sections tab save while editing, switching presets (dirty, held, back and forth), closing, a missing preset, changing the active chat |
| `recorded-actions-save.json`   |        44 |   168 | Save unchanged / edited / twice / held (with Back and with typing during it) / failing / refused by the schema (empty, whitespace, 200 and 201 characters), Save of every stored preset set, refreshes after a save, a deleted row, after a preset switch, from the Sections tab, the notice across a tab switch                |
| `recorded-actions-header.json` |        24 |    92 | Back (clean, dirty with Keep editing / Discard / Save & close working, failing, held, refused), Back twice, Back with the error showing; Delete (cancel, confirm, failing, held and clicked twice, dirty); Export (working, with one / five skipped items, failing, dirty, held and clicked twice)                              |

164 scenarios, 564 step results in all. Scenario ids say what they are: `<group>:<what>`.

## File shape

`{ format: 1, defaultWorld, worlds, pool, scenarios }`.

- `worlds`: the stored data behind the fakes, by kind, each `{ <set>: rows }`: `preset` (the row `preset-1`),
  `sections`, `groups`, `variables`, `chat` (the active chat row, `null` for none), `preset2` (the row `preset-2`,
  always present) and `connections`. `defaultWorld` is
  `{ preset: "STD", sections: "STD", groups: "ONE", variables: "ONE", chat: "NOCHAT", preset2: "STD", connections: "TWO" }`;
  a scenario's `world` overrides it by kind.
- `pool`: shared values. In each step result `text`, `fields`, `buttons`, `labelled`, `rail`, `wrap` and `sections`
  are numbers: indexes into `pool`.
- `scenarios`: `{ id, world, pre, presetDetailId, steps }`. `pre` holds config steps applied before mount (`hold` /
  `fail`); `presetDetailId` is the store's open preset at mount (`"preset-1"` unless the scenario says otherwise:
  `"preset-missing"` or `null`). `steps` are the results, the first always `["mount"]`.

Values that JSON can't hold are encoded everywhere: `{ "$undefined": true }`, `{ "$number": "NaN" }`,
`{ "$error": message }`, `{ "$function": true }`, `{ "$blob": type, "size": n }`.

### Building the stored data from a world

- `prompts`: `[worlds.preset[w.preset], worlds.preset2[w.preset2]]`.
- `prompt-sections`: `worlds.sections[w.sections]`; for every set except `STD` and `NONE`, also append the `STD` set's
  last row (`s-other-preset`, `presetId: "preset-2"`, built the same way as in `STD`).
- `prompt-groups`, `prompt-variables`: the set's rows.
- `chats`: `[worlds.chat[w.chat]]` unless it is `null` or `{ "$missingChat": true }` (then empty). The chat store's
  `activeChatId` is `"chat-1"` unless the set is `NOCHAT` (`null`). `MISSING` means an active id with no row.
- Connections (`connectionsUtilityApi.list()`): the set's rows.

## The harness

Each scenario: a fresh `QueryClient` (`retry: false` for queries and mutations); `useUIStore` and `useChatStore`
reset to their initial state, then `useUIStore.setState({ presetDetailId })` and
`useChatStore.setState({ activeChatId })`; then `pre`; then `PresetEditor` (imported from `../PresetEditor`) is
rendered inside `QueryClientProvider` into a fresh `div` appended to `document.body`, and everything settles.

Fakes (each logs a call into one list, in order, with arguments encoded as above):

- `storageApi` (`shared/api/storage-api`):
  - `list(entity, options)` logs `["storage.list", entity, options ?? null]`; for `prompt-sections`,
    `prompt-groups`, `prompt-variables` (ops `sections.list`, `groups.list`, `variables.list`) returns clones of the
    rows with `presetId === options.filters.presetId`.
  - `get(entity, id, options)` logs `["storage.get", entity, id, options ?? null]`; `prompts` (op `prompts.get`) and
    `chats` (op `chats.get`) return a clone of the row with that id, or `null`.
  - `update(entity, id, data)` logs `["storage.update", entity, id, data]`; `prompts` (op `prompts.update`) and the
    three nested kinds (`sections.update`, …) merge `data` into the row, set `updatedAt: "2026-01-02T00:00:00.000Z"`,
    and return a clone; a missing row throws `Not found: <id>`.
  - `delete(entity, id)` logs `["storage.delete", entity, id]`; `prompts` (op `prompts.delete`) removes the row and
    returns `null`.
- `exportApi.prompt(presetId)` (`shared/api/export-api`) logs `["export.prompt", presetId]` (op `export`) and returns
  `{ blob: new Blob(["{}"], { type: "application/json" }), filename: "preset.dekoi.json" }` plus `report` when an
  `exportReport` step set one.
- `triggerDownload(payload)` (`shared/api/download-payload`) logs `["triggerDownload", payload.filename]`.
- `connectionsUtilityApi.list()` (`shared/api/integration-utility-api`) logs `["connections.list"]` (op
  `connections.list`).
- `reviewPromptPreset` (`engine/generation/prompt-reviewer`) logs and throws; it is never called.
- `showConfirmDialog(options)` (`shared/lib/app-dialogs`) logs `["confirm", options]` and answers the scenario's answer
  (`true` unless a `confirm` step said otherwise).
- `toast` from `sonner`: every method logs `["toast", kind, message]`, or `["toast", kind, message, options]` when
  options were passed (`dismiss` logs `["toast", "dismiss", id ?? null]`).
- The Sections tab module (`./preset-sections` from the old file; `../preset-sections` from yours, the same module) is
  replaced by a probe: `PresetSectionsTab(props)` keeps `props` for `sectionsMutate` steps and renders
  `<div data-probe="sections">{JSON of the summary}</div>`, the summary being
  `{ presetId, sections: ids, groups: [[id, name], …] in map order, choiceBlocks: ids, wrapFormat, hasLorebookMarker, parentChatHasLorebook, props: sorted prop names }`.

Ops can be **held** (the call waits until a `release` step) or made to **fail** once (it throws `Error(message)` after
any hold). The gate runs before the fake does its work, so a held `prompts.update` stores nothing until released.

Timers: `Date.now()` is fixed at `2026-01-01T00:00:00.000Z` and moves only with `wait`. Every `setTimeout` with a
positive delay goes on a manual clock (zero-delay timers run for real); `requestAnimationFrame` callbacks run while
settling. "Settle" is ten rounds of: a real zero-delay timeout plus the queued frames, each inside `act`.

## Steps

Config steps (no DOM action, but they still produce a result): `["hold", op]`, `["fail", op, message]`,
`["confirm", answer]`, `["exportReport", report]`.

- `["release", op]`: releases every waiting call of that op.
- `["wait", ms]`: runs the due timers in order, settling after each.
- `["tab", label]`: clicks the button in the `nav` whose text is `label`.
- `["wrap", fmt]`: clicks the button whose text is `fmt` upper-cased.
- `["back"]`, `["delete"]`: click the button holding `svg.lucide-arrow-left` / `svg.lucide-trash-2`. `["save"]`,
  `["keepEditing"]`, `["discard"]`, `["saveClose"]`: click the button whose whole text is `Save` / `Keep editing` /
  `Discard` / `Save & close`. `["export"]`: the button with title `Export preset`. `["dismissError"]`: the button
  named `Dismiss save error`.
- Fields, by placeholder: `headerName` the first `[placeholder="Preset name…"]`, `name` the second, `description`
  `[placeholder="What does this preset do?"]`, `author` `[placeholder="Your name (optional)"]`.
  `["focus", f]`: `el.focus()`. `["blur", f]`: focus it if it isn't, then `el.blur()`. `["type", f, value]`: sets the
  value through the native setter and dispatches a bubbling `input` event. `["key", f, key]`: dispatches a bubbling,
  cancelable `keydown`; the result adds `defaultPrevented`.
- `["refresh", patch]`: merges `patch` into the stored row of the open preset, then
  `client.invalidateQueries({ queryKey: presetKeys.full(<open preset id>) })`.
- `["deleteStored", id]`: removes that preset row from the fake storage (no call is logged).
- `["sectionsMutate", prop, arg]`: calls `props[prop].mutate(arg)` on the probe's last props.
- `["switchPreset", id]`: `useUIStore.getState().openPresetDetail(id)`, or `closePresetDetail()` for `null`.
- `["setChat", id]`: `useChatStore.setState({ activeChatId: id })`.

A step whose target isn't there records `{ step, error, calls }` instead of a snapshot.

## Step results

`{ step, shown, text, fields, buttons, labelled, rail, wrap, sections, ui, focus, calls }`, plus `defaultPrevented`
for `key`, and `renderError` / `unhandled` / `eventError` / `unhandledAfterUnmount` when something threw (none of the
recordings have them). Everything is read from the `div` the editor is rendered into:

- `shown`: `"nothing"` (no child), `"loading"` (a `.shimmer` inside), `"notFound"` (its whole text is
  `Preset not found`), else `"editor"`.
- `text`: `textContent` with `textarea`s and the probe removed, whitespace collapsed and trimmed.
- `fields`: every `input, textarea, select`: `{ tag, type, placeholder, value, disabled? }` plus every `aria-*`,
  `title` and `role` attribute, sorted by name.
- `buttons`: every `button`: `{ text, …aria-* / title / role, disabled? }`.
- `labelled`: every other element (not `svg` ones) that has a `title`, `role` or `aria-*` attribute:
  `{ tag, text, …those attributes }`.
- `rail`: the `nav`'s buttons as `[text, active]`, active when the class list has `ring-1`; `null` without a `nav`.
- `wrap`: the texts of the `XML` / `MARKDOWN` / `NONE` buttons whose class list has `text-purple-400`; `null` when the
  buttons aren't shown.
- `sections`: the probe's summary, or `null`.
- `ui`: `{ presetDetailId, editorDirty }` from `useUIStore`.
- `focus`: `null` when nothing in the page has focus; else `{ where: "editor", field: i, sel: [start, end] }` (index
  among the `input, textarea, select`), `{ where: "editor", button: i }`, or `{ where, tag }`.
- `calls`: every call logged since the previous result.

## What the decisions change

Compare everything exactly, except:

- Decision 1 adds `aria-label` to the Back and Delete buttons and to the four inputs, and `aria-hidden="true"` on
  icons (svgs are not part of `labelled`).
- Decision 2 adds `aria-current="page"` to the active rail button, `aria-pressed` to the wrap buttons, and the notice /
  error roles (`labelled` then gains the notice and the error bar).
- Decision 3 adds `type="button"` (not recorded).

So a replay may ignore exactly those attributes (and the `labelled` entries that exist only because of them), and
nothing else.
