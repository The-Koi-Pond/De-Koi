# Agent editor recordings

Black-box recordings of the old agent editor (see `docs/provenance/agent-editor.md`), made on `main` before the old
file was deleted. One-line JSON, listed in `.prettierignore`, so the provenance report doesn't count them as code.
Don't edit them by hand. They show the old behavior; spec decisions 1 to 3 add attributes on purpose (see "What the
decisions change" at the end).

## Files

| File                                                                 | Scenarios |   Steps | What                                                                                                              |
| -------------------------------------------------------------------- | --------: | ------: | ----------------------------------------------------------------------------------------------------------------- |
| `recorded-show-1.json`, `recorded-show-2.json`                       |   127, 40 | 137, 54 | starting states: every agent kind, odd stored values, loading/failed lists, connection sets, odd tool schemas     |
| `recorded-save-unchanged-1.json`, `recorded-save-unchanged-2.json`   |    79, 34 | 158, 68 | open each starting state and press Save once (the stored payload contract)                                        |
| `recorded-actions-fields.json`                                       |        52 |     368 | typing into every text field and number box, max tokens blur, custom cadence                                      |
| `recorded-actions-toggles-1.json`, `recorded-actions-toggles-2.json` |    52, 24 | 273, 88 | toggles, dropdowns, phases, result types, turn data, lorebook writer, image settings, tools, prompt buttons       |
| `recorded-actions-knowledge.json`                                    |        28 |     138 | Knowledge Sources: chat-active, lorebook and file selection, coverage badge, upload, file delete, overlap warning |
| `recorded-actions-save-1.json`, `recorded-actions-save-2.json`       |    34, 14 | 192, 90 | Save success/failure/held, the Saved flash, writer validation, create of built-ins and custom agents              |
| `recorded-actions-flow.json`                                         |        69 |     252 | Back and the unsaved bar, switching agents, list refreshes, Delete, Export                                        |

553 scenarios, 1,818 step results in all. Scenario ids say what they are (`show:builtin-norow:<id>`,
`save0:custom:<row id>`, `cadence:keys:new`, …).

A group that didn't fit in about 1 MB is split into `-1`, `-2` parts; the parts are independent (each has its own `pool`
and `worlds`). Load every `*.json` in the folder.

## File shape

`{ format: 1, defaultWorld, worlds, pool, scenarios }`.

- `worlds`: named data sets for the fakes, by kind: `agents`, `connections`, `lorebooks`, `entries` (lorebook id →
  entries), `tools` (custom tool rows), `capabilities` (custom tool capabilities object), `knowledge` (knowledge
  sources). `defaultWorld` names the set of each kind a scenario uses unless its `world` overrides it.
- `pool`: shared values. In each step result, `text`, `fields`, `buttons` and `help` are numbers: indexes into `pool`.
- `scenarios`: `{ id, detailId, world, pre, steps }`. `detailId` is the UI store's `agentDetailId` at mount. `world`
  overrides `defaultWorld` by kind (`{ agents: "BUILTIN" }`). `pre` are setup steps (only the fake-control steps
  below: `hold`, `fail`, …) applied before mounting. `steps` are the results, the first always `["mount"]`.

The agents sets: `CUSTOM` (custom rows `cust-*` covering odd and legacy stored values; no built-in rows, so every
built-in id opens with its defaults), `BUILTIN` (a stored row `row-<type>` for every built-in, plus the first three
custom rows), `NONE`, `K_*` (knowledge router/retrieval rows with different `enabled` and `useChatActiveLorebooks`
values, for the overlap warning), `ODD` (built-in rows opened by their row id, a knowledge router row `odd-router`, and
two rows that both match the id `custom-dup`). Connections: `STD` (no agent defaults), `DEFAULT_TRUE`,
`DEFAULT_STRING`, `DEFAULT_IMAGE_ONLY` (an LLM row with `"TRUE"`, which doesn't count), `NONE`, `LLM_ONLY`, `CHANGED`.
Tools: `STD` (selectable and not), `NONE`, `ODD_SCHEMA`, `NULL_SCHEMA`.

Values that JSON can't hold are encoded everywhere (calls, worlds, pool): `{ "$undefined": true }`,
`{ "$number": "NaN" }` (also `"Infinity"`, `"-Infinity"`), `{ "$file": { name, size, type } }` (a `File`),
`{ "$error": message }`, `{ "$function": true }`.

## The fakes

Each scenario: a fresh `QueryClient` (`retry: false` for queries and mutations), the real UI store (`agentDetailId` set
to `detailId`, `editorDirty: false`), the real hooks (`use-agents`, `use-custom-tools`, connections, lorebooks,
knowledge), and fakes at the API boundary installed with `vi.mock`:

| Module mocked                                                            | Fake                                                                                                                                                                                                | Op name                                                       | Call recorded                                                                                                                  |
| ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `shared/api/storage-api` `storageApi.list`                               | `"agents"` → copy of the agents set; `"lorebooks"` → lorebooks; `"lorebook-entries"` with `{ filters: { lorebookId } }` → `entries[lorebookId] ?? []`; `"custom-tools"` → tools; anything else `[]` | `agents.list`, `lorebooks.list`, `entries.list`, `tools.list` | `["storage.list", entity, options ?? null]`                                                                                    |
| `storageApi.create`                                                      | agents only: stores `{ ...payload, id: "created-agent-<n>", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: same }` (n counts from 1 per scenario) and returns it                                 | `agents.create`                                               | `["storage.create", "agents", payload]`                                                                                        |
| `storageApi.update`                                                      | merges the payload into the row (`updatedAt: "2026-01-02T00:00:00.000Z"`), returns the row                                                                                                          | `agents.update`                                               | `["storage.update", "agents", id, payload]`                                                                                    |
| `storageApi.delete`                                                      | removes the row, returns `null`                                                                                                                                                                     | `agents.delete`                                               | `["storage.delete", "agents", id]`                                                                                             |
| `storageApi.get`                                                         | returns `null` (never called)                                                                                                                                                                       |                                                               | `["storage.get", entity, id]`                                                                                                  |
| `shared/api/connection-catalog-api` `connectionCatalogApi.listAvailable` | copy of the connections set                                                                                                                                                                         | `connections.list`                                            | `["connections.list"]`                                                                                                         |
| `shared/api/custom-tool-api` `customToolApi.capabilities`                | copy of the capabilities object                                                                                                                                                                     | `capabilities`                                                | `["tools.capabilities"]`                                                                                                       |
| `shared/api/integration-utility-api` `knowledgeSourcesApi.list`          | copy of the knowledge set                                                                                                                                                                           | `knowledge.list`                                              | `["knowledge.list"]`                                                                                                           |
| `knowledgeSourcesApi.upload(file)`                                       | appends and returns `{ id: "uploaded-<n>", originalName: file.name, filename: "uploaded-<n>-<name>", size: file.size, uploadedAt: "2026-01-01T00:00:00.000Z" }`                                     | `knowledge.upload`                                            | `["knowledge.upload", {"$file": …}]`                                                                                           |
| `knowledgeSourcesApi.delete(id)`                                         | removes it, returns `{ ok: true }`                                                                                                                                                                  | `knowledge.delete`                                            | `["knowledge.delete", id]`                                                                                                     |
| `shared/lib/app-dialogs` `showConfirmDialog`                             | answers `true` unless a `confirm` step said otherwise                                                                                                                                               |                                                               | `["confirm", options]`                                                                                                         |
| `shared/api/file-save-api` `saveTextFileToUserSelectedLocation`          | returns the `fileResult` (default `"saved"`); `{ throw: message }` throws `new Error(message)`                                                                                                      | `fileSave`                                                    | `["fileSave", options]`                                                                                                        |
| `sonner` `toast`                                                         | records; `toast(m)` is kind `"message"`, `toast.success/error/info/warning/loading/promise/custom` their kind; `toast.dismiss(id)`                                                                  |                                                               | `["toast", kind, message]` or `["toast", kind, message, options]` when options were passed; `["toast", "dismiss", id ?? null]` |
| `shared/components/ui/HelpTooltip`                                       | the real `HelpTooltip`, wrapped only to note each `text` prop (for `help` below)                                                                                                                    |                                                               |                                                                                                                                |

Every list and the create/update/delete/upload/file-save return copies, so a refetch hands React Query new objects;
React Query's structural sharing keeps the old objects when the data is equal.

Payloads are recorded as they reached the fake, so `storage.create` / `storage.update` show the agents hooks' own
schema parsing (`createAgentConfigSchema` / `updateAgentConfigSchema`): defaults filled, `activationKeywords` and
`activationScanDepth` normalised inside `settings`. A schema failure (for example an empty name) never reaches the fake:
there is no call, and the save error shows the message.

The call is recorded before the op waits or fails, so a held or failing op still shows its call.

Order inside a gate: if the op is held, it waits for its `release`; then, if a failure is queued, it throws.

Determinism: `crypto.randomUUID` returns `00000000-0000-4000-8000-000000000001`, `…002`, … (the counter restarts each
scenario), so `createCustomAgentType(name)` gives `custom-<slug>-00000000-0000-4000-8000-000000000001`. Only `Date` is
faked (`vi.useFakeTimers({ toFake: ["Date"] })`, system time `2026-01-01T00:00:00.000Z`, frozen), so the export
envelope's `exportedAt` is `2026-01-01T00:00:00.000Z`. Timers run in real time except those of exactly 1500 ms (the
Saved flash): `globalThis.setTimeout(fn, 1500)` was replaced so those go on a virtual clock that starts at 0 each
scenario and only `wait` steps move (`clearTimeout` removes them). So the flash shows from the Save until a `wait`
moves the clock 1.5 s past that Save, however long the steps really took. Each Save starts its own timer and none is
cancelled, so an earlier Save's timer ends a later Save's flash early (`save:flash-overlap`).

## Steps

After each step the recorder lets everything settle (8 rounds of `act` + a real `setTimeout(0)`; a `wait` step first moves
the virtual flash clock, firing due flash timers in order, each followed by a settle), then snapshots. Events go through `act`. Errors React rethrows from `act` and errors passed to the root's
`onUncaughtError` are recorded (see `renderError`), not fatal.

Locators (the builder may find controls any way that hits the same control):

- by **label**: the control (input, textarea, select) that follows the visible text `label` most closely: the group
  title (`Description`, `Author`, `Connection Override`, `Image Generation Connection Override`, `Triggers After`, `Run
Interval`, `Trigger Cadence`, `Prompt Template`) or the small label above it (`Target lorebook`, `Context Size`,
  `Max Output Tokens`, `Keywords`, `Scan Depth`, `Positive prompt / tags`, `Negative prompt`, `Character & persona
references`, `Image Generation Connection`);
- a **group** is the block under a group title (`Agent Status`, `Pipeline Phase`, …); its buttons are its buttons except
  the help button.

Step kinds:

| Step                                            | Meaning                                                                                                                                                                                    |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `["mount"]`                                     | the editor mounted (the first result)                                                                                                                                                      |
| `["typePh", placeholder, value]`                | set the value of the first input/textarea with that placeholder and fire `input` (used for the name, `Agent name…`)                                                                        |
| `["type", label, value]`                        | set the value of the control by label and fire `input` (no focus). Number inputs sanitize: jsdom turns a non-number like `abc` into `""` before React sees it, as browsers do              |
| `["select", label, value]`                      | set the select's value and fire `change`                                                                                                                                                   |
| `["focus", label]` / `["blur", label]`          | `element.focus()` / `blur()`; `blur` first focuses the element if it isn't focused (so its focus handler runs too)                                                                         |
| `["key", label, key]`                           | dispatch a cancelable `keydown` with `key`; the result has `defaultPrevented`                                                                                                              |
| `["check", text]`                               | click the checkbox inside the `<label>` with that text (`Generate avatar portraits for new NPCs`)                                                                                          |
| `["click", text]`                               | click the first button whose collapsed `textContent` is exactly `text` (`Save`, `Delete`, `Export`, `Keep editing`, `Discard`, `Save & close`, `Copy default to edit`, `Reset to default`) |
| `["clickLabel", ariaLabel]`                     | click the first button with that `aria-label` (`Back to agents`, `Increase trigger cadence`, `Decrease trigger cadence`)                                                                   |
| `["toggle", group]`                             | click the first button of the group (the toggle card of `Agent Status`, `Lorebook Writer`, `Background Image Generation`, `Add as Prompt Section`)                                         |
| `["groupButton", group, prefix]`                | click the first button of the group whose collapsed text starts with `prefix` (phases, result types, turn data cards)                                                                      |
| `["chatActive"]`                                | click the `Use this chat's active lorebooks: on/off` toggle                                                                                                                                |
| `["pickLorebook", name]`                        | click the Knowledge Sources lorebook row whose name line is exactly `name` (`""` is the lorebook with an empty name)                                                                       |
| `["pickFile", originalName]`                    | click the Files row (the select part) of that file                                                                                                                                         |
| `["deleteFile", originalName]`                  | click that file row's trash button (`title="Delete file"`)                                                                                                                                 |
| `["upload", { name, size, type }]`              | give the hidden file input one `new File(["x" * size], name, { type })` and fire `change`                                                                                                  |
| `["uploadNone"]`                                | fire `change` on the file input with no files                                                                                                                                              |
| `["clickUpload"]`                               | click the `Upload File` / `Uploading...` button (in jsdom it opens nothing)                                                                                                                |
| `["toggleTool", name]` / `["expandTool", name]` | click the toggle / the expand header of the tool card named `name`                                                                                                                         |
| `["dismissError"]`                              | click the save error banner's X                                                                                                                                                            |
| `["confirm", answer]`                           | the next confirm dialogs answer `answer`                                                                                                                                                   |
| `["fileResult", result]`                        | the file save returns `result` from now on (`"saved"`, `"downloaded"`, `"cancelled"`, `null`) or `{ throw: message }`                                                                      |
| `["fail", op, message]`                         | the next call of `op` throws `new Error(message)` (one call only)                                                                                                                          |
| `["hold", op]`                                  | every call of `op` from now on waits until `["release", op]`                                                                                                                               |
| `["release", op]`                               | let every waiting call of `op` go on and stop holding it                                                                                                                                   |
| `["createNoId"]`                                | the next agents create returns `{ ok: true }` (the row is still stored)                                                                                                                    |
| `["setWorld", kind, setName]`                   | replace that fake list behind the editor's back (seen at the next fetch of it)                                                                                                             |
| `["patchAgent", id, patch]`                     | merge `patch` into the stored agent row `id` behind the editor's back                                                                                                                      |
| `["refetch", key]`                              | `queryClient.invalidateQueries({ queryKey: [key] })`, as another part of the app would: `agents`, `connections`, `lorebooks`, `custom-tools`                                               |
| `["open", id]`                                  | `useUIStore.getState().openAgentDetail(id)`, as the Agents panel would; `["open", null]` is `closeAgentDetail()`                                                                           |
| `["wait", ms]`                                  | the virtual flash clock moves `ms` (see Determinism); no real time passes                                                                                                                  |

At the end of a scenario the recorder releases any held op, unmounts, and clears the client.

Events are dispatched to the element even when it is disabled. React drops clicks on a disabled button (nothing
happens), but a `change` fired at a disabled `<select>` still reaches `onChange` (for example `writer:no-lorebooks` picks
a target in the disabled Target lorebook dropdown). A person can't do that; it is recorded because a rebuild that uses
a disabled `<select>` with `onChange` behaves the same way.

## Step results

Each result has `step` and either `error` (the recorder couldn't find the control; nothing was done) plus `calls`, or a
snapshot:

- `text`: the editor's `textContent` without its text areas' text (a React text area keeps its mount-time value as a
  text child, which isn't what it shows), whitespace collapsed (`/\s+/g` → one space, trimmed). Adjacent elements run
  together with no space, as `textContent` does. Help tooltips are closed (their text isn't in the page).
- `fields`: every `input`, `textarea` and `select` in page order. Inputs and text areas: `tag`, `type`, `placeholder`
  (`null` when absent), `value`, `checked` (checkboxes), `min`, `max`, `rows`, `accept`, `inputmode` (when present).
  Selects: `tag: "select"`, `value`, `selectedIndex`, `options` as `[value, collapsed text]` pairs. Then `disabled:
true` when disabled and every `aria-*` attribute and `title` present, by name. jsdom shows a select whose value
  matches no option as its first option (`selectedIndex` 0), like Chrome.
- `buttons`: every `button` in page order: `text` (collapsed `textContent`), every `aria-*` attribute and `title`
  present, `disabled: true` when disabled. The `type` attribute is not recorded (decision 3).
- `help`: the full `text` of each `HelpTooltip` in the editor, in page order. The shared `HelpTooltip` only shows its
  text when opened; its button's `aria-label` is `Help: <first sentence>` (in `buttons`). The recorder wrapped the real
  `HelpTooltip` to note `text` by that label.
- `store`: `{ agentDetailId, editorDirty }` from the UI store after the step.
- `calls`: every fake call since the previous result, in order (see the table above).
- `renderError` (only when there was one): the errors React threw during the step, as `"<name>: <message>"`. After a
  render error the editor is gone (empty `text`, no controls).
- `defaultPrevented` (only `key` steps).
- `unhandled` (only when there were some): unhandled promise rejections during the step, as their messages.
- `unhandledAfterUnmount` (on the last result, only when there were some): rejections that came after unmounting.

Not recorded: colors and other styling (class names), layout and widths. The phase tints, the coverage dot color, the
amber/red notes and the white-alpha Files list come from the spec and the screenshots.

## What the decisions change

The recordings show no `aria-pressed` on the toggles, no names on the tool toggles, the header name input or the file
trash button, no `aria-expanded` on the tool headers, and no `type="button"` on some buttons. The rebuild adds those
(decisions 1 to 3), so a replay should compare `buttons`/`fields` ignoring the attributes those decisions add, and check
the added ones in their own tests.

## What the follow-ups change

Follow-up 9 (a bad custom tool schema) changes three recordings from a step on: `show:tools-null-schema` (from the
mount), `show:tools-null-schema-appears` (from the refetch) and `show:tools-odd-schema` (from the first expanded card).
The replay compares the steps before those and sets the rest aside (`FOLLOW_UP_CHANGES`);
`AgentEditor.follow-ups.spec.tsx` checks what they show now.
