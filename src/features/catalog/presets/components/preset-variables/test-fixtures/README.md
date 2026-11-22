# Preset variables recordings

Black-box recordings of the old Preset Variables list (see `docs/provenance/preset-variables.md`), made from the old build
before the old code was replaced. One-line JSON, listed in `.prettierignore`, so the provenance report doesn't count
them as code. Don't edit them by hand. They show the old behavior; spec decisions 1 to 3 add attributes on purpose (see
"What the decisions change" at the end).

## Files

| File                            | Scenarios | Steps | What                                                                                                                                                                                     |
| ------------------------------- | --------: | ----: | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `recorded-show.json`            |        11 |    63 | starting states: every variables set mounted, each card expanded in turn, then collapsed; chevron vs name clicks                                                                         |
| `recorded-actions-fields.json`  |        70 |   493 | typing into the name, question, option label and value inputs: focus, blur, Enter, the 600 ms saves, refreshes while typing, two quick edits, failing and held saves, odd stored options |
| `recorded-actions-options.json` |        38 |   175 | remove and add options (incl. the last one and past `Z`), the Multi-Select and Random Pick switches, the separator                                                                       |
| `recorded-actions-editor.json`  |        26 |   185 | the value editor: open, typing, Tab, X, Done, backdrop, Escape, the 600 ms save, outside changes, failing and held saves                                                                 |
| `recorded-actions-list.json`    |        49 |   239 | Add Variable, Move up/down (incl. while a reorder is held or fails), drag to reorder, Delete with cancel and confirm, expansion across refreshes                                         |

194 scenarios, 1,155 step results in all. Scenario ids say what they are: `<group>:<what>` (`show:STD`, `name:type-blur`, `label:debounce`,
`quick:two-labels-blur-refresh-late`, `sep:append`, `ed:tab`, `move:held`, `drag:to-end-list`, `delete:cancel`, …).

A group that doesn't fit in about 1 MB is split into `-1`, `-2` parts; the parts are independent (each has its own
`pool` and `worlds`). Load every `*.json` in the folder.

## File shape

`{ format: 1, defaultWorld, worlds, pool, scenarios }`.

- `worlds`: `{ variables: { <set>: rows[] }, preset: { <set>: row } }`, the stored data behind the fakes.
  `defaultWorld` is `{ variables: "STD", preset: "ORDERED" }`; a scenario's `world` overrides it by kind.
- `pool`: shared values. In each step result `text`, `fields`, `buttons`, `labelled`, `cards` and `modal` are numbers:
  indexes into `pool`.
- `scenarios`: `{ id, world, pre, steps }`. `pre` is always `[]`. `steps` are the results, the first always
  `["mount"]`.

Variables sets (all rows have `presetId: "preset-1"`; ids say what each row is):

- `NONE`: no rows. `ONE`: `v-genre`. `TWO`: `v-genre`, `v-tags`.
- `STD`: `v-genre` (GENRE, single select, 3 options), `v-nsfw` (NSFW, one option: boolean), `v-tags` (TAGS,
  Multi-Select, separator `" | "`), `v-mood` (MOOD, Multi-Select + Random Pick).
- `ODD` (20 rows, in this order): `v-legacy` (only `variable_name`), `v-both` (`variableName` and `variable_name`),
  `v-noname` (no name, no question), `v-nullname` (`variableName: null`, `variable_name: "FALLBACK"`,
  `question: null`), `v-strtrue` (`multiSelect: "true"`, `randomPick: "false"`), `v-strrand` (both `"true"`),
  `v-strfalse` (`multiSelect: "false"`, one option), `v-emptysep` (separator `""`), `v-nosep` (no separator key),
  `v-nullsep` (separator `null`), `v-multi1` (Multi-Select with one option), `v-zero` (`options: []`), `v-optstr`
  (options as a JSON string), `v-optnull` (`options: null`), `v-optobj` (options an object), `v-blank` (values `""`
  and `"   "`, and an empty label), `v-desc` (options with `description` and an extra key `extra`), `v-vis` (a
  `visibilityRule`), `v-boolnum` (`multiSelect: 1`, `randomPick: 1`), `v-upper` (`multiSelect: "TRUE"`).
- `MANY`: `v-many` (26 options, `Option A`…`Option Z`), `v-many25` (25 options).
- `LONG`: `v-long` (100-character name, 500-character question, a 200-character label and a 2,000-character value,
  a value with newlines and a tab), `v-toolong` (101-character name, 501-character question).
- `UNI`: `v-uni` (name `NAMÉ_ß`, emoji, CJK and right-to-left text in question, labels and values).
- `CRASH`: `v-genre` and `v-numval` (an option whose `value` is the number `42`).
- `NOLABEL`: `v-nolabel` (an option without `label`, one with `label: null, value: null`), `v-noid` (options
  without `id`).

Preset sets: `ORDERED` (`{ id: "preset-1", name: "Test Preset", variableOrder: <the ids of the variables set> }`;
the JSON shows `"$ids"` for that), `STRING_ORDER` (`variableOrder: "v-genre"`), `NO_ORDER` (no `variableOrder`).

Values that JSON can't hold are encoded everywhere (calls, worlds, pool): `{ "$undefined": true }`,
`{ "$number": "NaN" }`, `{ "$error": message }`, `{ "$function": true }`.

## The harness

Each scenario: a fresh `QueryClient` (`retry: false` for queries and mutations) and this page component, which is how
the real preset editor feeds the list:

```tsx
function Page() {
  const { data } = usePresetFull("preset-1");
  const create = useCreateVariable(),
    update = useUpdateVariable(),
    del = useDeleteVariable(),
    reorder = useReorderVariables();
  const variables = useMemo(() => (data?.choiceBlocks ? data.choiceBlocks : []), [data?.choiceBlocks]);
  if (!data) return null;
  return (
    <PresetVariablesEditor
      presetId="preset-1"
      variables={variables}
      onCreateVariable={logged("create", create)}
      onUpdateVariable={logged("update", update)}
      onDeleteVariable={logged("delete", del)}
      onReorderVariables={logged("reorder", reorder)}
    />
  );
}
```

`logged(name, m)` is `{ ...m, mutate, mutateAsync }` where both record `["mutate", name, firstArg]` /
`["mutateAsync", name, firstArg]` and then call the hook's own function. The hooks (`use-presets.ts`) are real, so
schema parsing, the create's `variableOrder` update, the reorder's optimistic order and every refresh are real.
Fakes at the API boundary, installed with `vi.mock`:

| Module mocked                                            | Fake                                                                                                                                                                         | Op name (for `hold` / `fail`)                    | Call recorded                                                                                         |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| `shared/api/storage-api` `storageApi.get`                | `"prompts"`: a copy of the preset row when the id matches, else `null`                                                                                                       | `prompts.get`                                    | `["storage.get", entity, id]`                                                                         |
| `storageApi.list`                                        | `"prompt-variables"`: copies of the rows whose `presetId` equals `options.filters.presetId`, in stored order; `"prompt-sections"` / `"prompt-groups"`: `[]`                  | `variables.list`, `sections.list`, `groups.list` | `["storage.list", entity, options ?? null]`                                                           |
| `storageApi.create`                                      | `"prompt-variables"`: appends `{ ...payload, id: "created-var-<n>", createdAt: "2026-01-02T00:00:00.000Z", updatedAt: same }` (n counts from 1 per scenario), returns a copy | `variables.create`                               | `["storage.create", entity, payload]`                                                                 |
| `storageApi.update`                                      | `"prompt-variables"`: merges the payload into the row (`updatedAt` as above; unknown id throws `Not found: <id>`); `"prompts"`: merges into the preset row                   | `variables.update`, `prompts.update`             | `["storage.update", entity, id, payload]`                                                             |
| `storageApi.delete`                                      | removes the row, returns `null`                                                                                                                                              | `variables.delete`                               | `["storage.delete", entity, id]`                                                                      |
| `shared/api/prompt-nested-api` `promptNestedApi.reorder` | sorts the preset's rows by the given ids, sets the preset row's `variableOrder` to the ids, returns copies of the sorted rows                                                | `reorder`                                        | `["reorder", { presetId, kind, ids }]`                                                                |
| `shared/lib/app-dialogs` `showConfirmDialog`             | answers `true` unless a `confirm` step said otherwise                                                                                                                        |                                                  | `["confirm", options]`                                                                                |
| `sonner` `toast`                                         | records; `toast(m)` is kind `"message"`, `toast.success/error/info/warning/loading/promise/custom` their kind; `toast.dismiss(id)`                                           |                                                  | `["toast", kind, message]` or `["toast", kind, message, options]`; `["toast", "dismiss", id ?? null]` |

Every get/list/create/update/reorder returns copies, so a refresh hands React Query new objects (structural sharing
keeps old objects when the data is equal).

The call is recorded before the op waits or fails, so a held or failing op still shows its call. Order inside an op:
if it is held, it waits for its `release`; then, if a failure is queued, it throws `new Error(message)`. A refresh is
`storage.get prompts` then the three lists; holding `variables.list` delays every refresh ("the refresh arrives late").

Payloads reach the storage fake after the hooks' schema parsing (`createChoiceBlockSchema` / `updateChoiceBlockSchema`
/ `updatePromptPresetSchema`), so defaults are filled and unknown keys dropped there; the `mutate` call before it shows
what the list itself sent, in its key order. A payload the schema refuses has a `mutate` call, no storage call, and the
shared failure toast.

### Clock

- `Date` is faked (`vi.useFakeTimers({ toFake: ["Date"] })`). `Date.now()` is `1767225600000`
  (`2026-01-01T00:00:00.000Z`) plus the manual clock below, so it only changes at `wait` steps.
- Every `setTimeout` with a delay above 0 (the 600 ms saves, the 100 ms focus, and anything else) runs on a manual
  clock that starts at 0 each scenario and only `wait` steps move; `clearTimeout` removes such timers. Zero-delay
  timers are real. A `wait` fires due timers in due order (ties in the order they were set), each with `Date.now()`
  set to its due time and followed by a settle.
- `requestAnimationFrame` callbacks are queued and run during the settle after the step (so a cursor move done in
  one shows in that step's `focus`).

## Steps

After each step the recorder settles (10 rounds of `act` around a real `setTimeout(0)` plus queued animation frames),
then snapshots. Events go through `act`. Errors React rethrows from `act` and errors passed to the root's
`onUncaughtError` are recorded (`renderError`), not fatal.

Locators (the builder may find controls any way that hits the same control):

- **card n**: the n-th variable card (0-based, in list order).
- **fields** by placeholder, in the list (only one card is expanded at a time): `name` = `VARIABLE_NAME`, `question` =
  `What should the user choose?`, `separator` = `, `, `label:i` / `value:i` = the i-th `Label…` / `Value…` input;
  `editor` = the value editor's text area; `body` = `document.body` (for keys only).

| Step                                                                               | Meaning                                                                                                                                                 |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `["mount"]`                                                                        | the list mounted and settled (the first result)                                                                                                         |
| `["toggle", n]`                                                                    | click card n's chevron (expand/collapse)                                                                                                                |
| `["clickName", n]`                                                                 | click card n's name                                                                                                                                     |
| `["moveUp", n]` / `["moveDown", n]`                                                | click card n's Move up / Move down button                                                                                                               |
| `["delete", n]`                                                                    | click card n's trash button                                                                                                                             |
| `["addVariable"]` / `["addOption"]`                                                | click **Add Variable** / **Add Option**                                                                                                                 |
| `["removeOption", i]` / `["expandValue", i]`                                       | click the remove / expand button of the i-th option row of the expanded card                                                                            |
| `["switch", "Multi-Select" \| "Random Pick"]`                                      | click that switch                                                                                                                                       |
| `["close"]` / `["done"]` / `["backdrop"]`                                          | value editor: click the X / **Done** / the dimmed backdrop outside the panel                                                                            |
| `["focus", field]`                                                                 | `element.focus()`                                                                                                                                       |
| `["blur", field]`                                                                  | `element.blur()`, focusing it first if it isn't focused (so its focus handler runs too)                                                                 |
| `["type", field, value]`                                                           | set the value and fire `input` (no focus)                                                                                                               |
| `["append", field, text]`                                                          | set the value to the element's current value + `text` and fire `input` (one keystroke at the end; used for the separator)                               |
| `["select", field, start, end]`                                                    | `setSelectionRange(start, end)` (no events)                                                                                                             |
| `["key", field, key]`                                                              | dispatch a cancelable bubbling `keydown` with `key` at the field (`body`: at `document.body`); the result has `defaultPrevented`                        |
| `["gripDown", n]`                                                                  | `mousedown` on card n's drag grip                                                                                                                       |
| `["dragStart", n]` / `["dragOver", n, clientY]` / `["drop", n]` / `["dragEnd", n]` | dispatch `dragstart` / `dragover` / `drop` / `dragend` (bubbling, cancelable `MouseEvent` with `clientY`, 0 unless given) at card n's outermost element |
| `["dragOverList", clientY]` / `["dropList"]`                                       | dispatch `dragover` / `drop` at the list element that holds the cards (the empty part of the list)                                                      |
| `["confirm", answer]`                                                              | the next confirm dialogs answer `answer`                                                                                                                |
| `["fail", op, message]`                                                            | the next call of `op` throws `new Error(message)` (one call only)                                                                                       |
| `["hold", op]` / `["release", op]`                                                 | every call of `op` from now on waits / let them all go on and stop holding                                                                              |
| `["patchVariable", id, patch]`                                                     | merge `patch` into stored row `id` behind the list's back (seen at the next refresh)                                                                    |
| `["setVariables", set]`                                                            | replace all stored rows with a copy of that variables set                                                                                               |
| `["refetch"]`                                                                      | `queryClient.invalidateQueries({ queryKey: presetKeys.full("preset-1") })`, as another part of the app would                                            |
| `["wait", ms]`                                                                     | the manual clock moves `ms` (see Clock)                                                                                                                 |

Drag details: `dragStart` makes a new fake `dataTransfer` (`effectAllowed: "uninitialized"`, `dropEffect: "none"`,
`setData(type, value)` / `getData(type)`, `types: []`) used by every drag event until the next `dragStart`; drag
results have `dataTransfer: { effectAllowed, dropEffect, data }` after the event (`null` before any `dragStart`).
Card layout: `getBoundingClientRect()` of card n's element, or of anything inside it, is `{ top: 100n, height: 100,
bottom: 100n + 100, left: 0, width: 600, right: 600, x: 0, y: 100n }`, so `clientY` below `100n + 50` is card n's top
half.

At the end of a scenario the recorder releases any held op, unmounts, removes everything from `document.body`, and
clears the client.

## Step results

Each result has `step` and either `error` (the recorder couldn't find the control; nothing was done) plus `calls`, or a
snapshot:

- `text`: the list's `textContent` without its text areas' text, whitespace collapsed (`/\s+/g` → one space,
  trimmed). Adjacent elements run together with no space, as `textContent` does. The value editor (rendered into
  `document.body`) is not in it.
- `fields`: every `input`, `textarea` and `select` in the list, in page order: `tag`, `type`, `placeholder` (`null`
  when absent), `value`, then `disabled: true` when disabled and every `aria-*`, `title` and `role` attribute present.
- `buttons`: every `button` in the list, in page order: `text` (collapsed `textContent`), every `aria-*`, `title` and
  `role` attribute present, `disabled: true` when disabled. The `type` attribute is not recorded (decision 2).
- `labelled`: every other element in the list (not a button, field or SVG) that has a `title`, `role` or `aria-*`
  attribute: `{ tag, …those attributes }` (the drag grips).
- `cards`: one array of flags per card, in order: `expanded` (the card's body is shown), `chevronDown` (its chevron
  points down), `faded` (shown faded while it is dragged), `lineBefore` / `lineAfter` (the drop line shows just above
  / below this card).
- `modal`: `null`, or the value editor: `{ text, fields, buttons, labelled }` measured the same way over the dialog.
- `focus`: `null` when nothing (or `body`) has focus; else `{ where: "editor" | "dialog" | "other", field: i, sel:
[selectionStart, selectionEnd] }` (i indexes that scope's `fields`), or `{ where, button: i }`, or `{ where, tag }`.
- `calls`: every fake call and `mutate` call since the previous result, in order.
- `renderError` (only when there was one): the errors React threw during the step, as `"<name>: <message>"`. After a
  render error the list is gone (empty `text`, no controls), and later steps that need a card are `error` results.
- `defaultPrevented` (`key` and drag steps), `dataTransfer` (drag steps).
- `unhandled` (only when there were some): unhandled promise rejections during the step, as their messages.
- `unhandledAfterUnmount` (on the last result, only when there were some).

Not recorded: colors and other styling, layout and widths, icons other than the chevron's direction, and the `sm`
breakpoint. The amber card tint, the red tint of a blank value row, the switch colors and the dimmed backdrop come
from the spec and the screenshots.

## What the decisions change

The recordings show the chevron and trash buttons, the switches, the expand/remove option buttons and the value editor's
X with no name, no `aria-expanded` / `aria-checked` / `role="switch"`, no `role="dialog"`, labels not tied to their
inputs, and the grip as a `div` with `title="Drag to reorder"` (in `labelled`). The rebuild adds those (decisions 1 to
3), so a replay should compare `buttons` / `fields` / `labelled` / `modal` ignoring the attributes those decisions add,
and check the added ones in their own tests.
