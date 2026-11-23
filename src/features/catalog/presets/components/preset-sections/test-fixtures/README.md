# Preset sections recordings

Black-box recordings of the old preset editor **Sections** tab (see `docs/provenance/preset-sections.md`), made from the
old build before the old code is replaced. One-line JSON, listed in `.prettierignore`, so the provenance report doesn't
count them as code. Don't edit them by hand. They show the old behavior; spec decisions 1 to 3 add attributes on purpose
(see "What the decisions change" at the end).

## Files

| File                            | Scenarios | Steps | What                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------------- | --------: | ----: | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `recorded-show.json`            |        36 |   203 | starting states: every section set mounted, each card expanded and collapsed in turn; several cards expanded; groups panel with no, two and odd groups; add menu with each agents set (incl. agents list held / failing); lorebook warning on, off, marker present / disabled / as strings / not a marker, dismissed, other preset dismissed, `"1"`, storage throwing; odd `sectionOrder`s                                                                                                                                                                                                                                              |
| `recorded-actions-toolbar.json` |        56 |   256 | add menu (open, toggle, click-catcher, Prompt Block, every marker, agent items incl. null / empty / HTML names; twice in one ms, held, failing create, failing order update, odd presets, late refresh); groups panel (toggle, New Group incl. failing / held; rename with Enter, blur, Escape, empty, unchanged, too long, failing, switching group, closing the panel, late refresh; delete with cancel, confirm, failing, odd names, while renaming); lorebook warning dismiss (incl. storage throwing), preset switches, prop changes, adding / disabling / deleting a lorebook marker                                              |
| `recorded-actions-cards.json`   |        66 |   293 | expansion across refreshes and moves; Move up / down (ends, held, failing, late refresh, partial order); drag to reorder (with and without the grip, top / bottom halves, the list's empty space above / below / in a gap, own place, drag end, held, failing, one card, empty list); Duplicate (success, last, marker, no id, failing create / order update / reorder, held create / reorder, late refresh, twice, odd rows incl. ones the schema refuses, JSON-text configs, agent); on/off (strings, odd values, failing, held, late refresh); Delete (expanded, failing, held, last)                                                |
| `recorded-actions-body.json`    |        59 |   402 | name input (Enter, blur, empty, unchanged, too long, failing, held, refresh while focused, collapse while typing, odd rows, select on focus); role (each, failing, unknown role, late refresh); position (incl. odd values); depth box (Enter, blur, unchanged, invalid / negative / decimal / empty / `" 05x"`, missing depth, failing); group (assign, none, dangling id, after New Group); content editor (800 ms save, restart, blur, unchanged, Tab, refresh while focused / unfocused, collapse while pending, failing, held, agent default text, odd rows, unicode); quick edits to two fields / two sections before the refresh |
| `recorded-actions-dialogs.json` |        37 |   264 | expanded editor (open, 100 ms focus, typing, X, Done, backdrop, Escape on body and text area, unchanged close, 600 ms hand-over then the 800 ms save, more typing after a hand-over, pending inline edit, Tab, nameless title, agent marker, outside changes, failing, held, card collapsed / section deleted while open, two open at once, long text); macros reference (Escape, backdrop, X, Close, with a pending edit, with the editor open)                                                                                                                                                                                        |

254 scenarios, 1,418 step results in all. Scenario ids say what they are: `<group>:<what>` (`show:MARKERS`, `menu:prompt-block`, `rename:escape`,
`groupdel:confirm`, `lore:dismiss`, `drag:to-end-list`, `dup:reorder-fail`, `name:enter`, `content:debounce`,
`quick:content-then-role`, `ed:handoff-then-more`, `macros:backdrop`, …).

A group that doesn't fit in about 1 MB is split into `-1`, `-2` parts; the parts are independent (each has its own
`pool` and `worlds`). Load every `*.json` in the folder.

## File shape

`{ format: 1, defaultWorld, worlds, pool, scenarios }`.

- `worlds`: the stored data behind the fakes, by kind: `sections`, `groups`, `variables`, `agents`, `preset` (each
  `{ <set>: rows }`, `preset` `{ <set>: row }`), `preset2` and `preset2Sections` (always present, see below),
  `storage` (`{ <set>: { data, throwGet?, throwSet? } }`, the starting `localStorage`) and `lore`
  (`{ OFF: false, ON: true }`, the `parentChatHasLorebook` prop at mount).
  `defaultWorld` is `{ sections: "STD", groups: "STD", variables: "ONE", agents: "ONE", preset: "ORDERED",
storage: "EMPTY", lore: "OFF" }`; a scenario's `world` overrides it by kind.
- `pool`: shared values. In each step result `text`, `fields`, `buttons`, `labelled`, `cards`, `open` and `modals`
  are numbers: indexes into `pool`.
- `scenarios`: `{ id, world, pre, steps }`. `pre` holds config steps applied before mount (only `hold` / `fail` on
  `agents.list`, in `show:agents-held` / `show:agents-fail`); else `[]`. `steps` are the results, the first always
  `["mount"]`.

### Worlds

All rows have `presetId: "preset-1"` unless said otherwise, and `createdAt` / `updatedAt`
`"2025-01-01T00:00:00.000Z"`. A section row has, unless its set says otherwise: `identifier` (the id without `s-`),
`name`, `content: ""`, `role: "system"`, `enabled: true`, `isMarker: false`, `groupId: null`, `markerConfig: null`,
`injectionPosition: "ordered"`, `injectionDepth: 0`, `injectionOrder: 100`, `forbidOverrides: false`. A marker row has
`identifier: <type>`, `isMarker: true`, `markerConfig: { type }`. The JSON has every row in full.

Section sets (the stored order; ids say what each row is):

- `NONE`: none. `ONE`: `s-main`.
- `STD`: `s-main` (Main Prompt, system, `"You are {{char}}. Stay in character."`), `s-char` (Character Info marker),
  `s-rules` (Writing Rules, user, two-line content, group `g-style`), `s-hist` (Chat History marker), `s-prefill`
  (Prefill, assistant, `enabled: false`, `"Understood."`).
- `PROMPTS`: prompt blocks with role `system`, `user`, `assistant`, `narrator` (unknown), no `role` key, `role: null`,
  and one with `forbidOverrides: "true"`.
- `MARKERS`: one marker per type in label order (`character`, `lorebook`, `persona`, `chat_history`, `chat_summary`,
  `world_info_before`, `world_info_after`, `dialogue_examples`, `agent_data` without `agentType` named "Agent Data
  Plain"), an unknown type `mystery`, and a renamed `persona` marker with stored content.
- `AGENTS`: `agent_data` markers with content around the macro (`s-a-content`), with `content: ""` (`s-a-empty`),
  `content: null` (`s-a-null`), without `agentType` (`s-a-notype`), and an agent config on a row with
  `isMarker: false` (`s-a-notmarker`).
- `CONFIGS`: markers whose `markerConfig` is JSON text (`'{"type":"persona"}'`, an `agent_data` one), bad JSON text,
  JSON text without `type`, an object without `type`, `{ type: 5 }`, an array, `null`, missing, `""`; plus
  `isMarker: "true"` + `enabled: "true"` (`s-c-strtrue`) and `isMarker: "false"` + `enabled: "false"` with a config
  (`s-c-strfalse`).
- `ODD` (15 rows, in this order): no `name` key, `name: ""`, no `content` key, `content: null`, no `enabled` key,
  `enabled: 1`, `injectionPosition: "depth"` + `injectionDepth: 4` (`s-o-depth`), depth without `injectionDepth`,
  `injectionPosition: "sideways"`, no `injectionPosition` key, `groupId: "g-gone"` (no such group), `groupId: ""`,
  a bare row (no `identifier`, `injectionOrder`, `forbidOverrides`, `groupId`, `role`, `content`), a 200-character
  name with 300-character content, a unicode name with emoji and a tab in the content.
- `GROUPED`: two sections in `g-style`, one in `g-format`, one ungrouped.
- `DUP` (for duplicate): `s-main` with group and `injectionOrder: 7`; a depth row with `enabled: "false"`,
  `forbidOverrides: "true"`; a marker with `isMarker: "true"` and JSON-text config with an extra key; a bare row (no
  identifier/order/position/depth/group/content/role/enabled/forbidOverrides); role `narrator`; marker type `mystery`;
  no `name`.
- `LORE_ON` / `LORE_DISABLED` / `LORE_STRINGS` / `LORE_NOTMARKER`: `s-main` plus an enabled `lorebook` marker; the
  same disabled; a `world_info_after` marker as JSON text with `isMarker: "true"`, `enabled: "true"`; a `lorebook`
  config on a row with `isMarker: false`.

Group sets: `NONE`; `ONE` (`g-style` "Style Rules"); `STD` (`g-style` "Style Rules", `g-format` "Formatting");
`ODD` (`g-style`, `g-empty` with `name: ""`, `g-long` a 126-character name, `g-uni` "Gruppe Ü 🎲"). Rows also have
`parentGroupId: null`, `order: 100`, `enabled: true`.

Variables sets: `NONE`; `ONE` (`v-genre`, two options). The Preset Variables list is rendered but not exercised here
(it has its own recordings); its text, fields and buttons are part of every snapshot.

Agent sets (`storageApi.list("agents")`, all rows): `NONE`; `ONE` (`ag-ws` "World State" type `world-state`
`settings: { injectAsSection: true }`, `ag-ex` "Expressions" `injectAsSection: false`); `OFF` (none injectable);
`MIXED` (`ag-ws`; `ag-ex`; `ag-noname` type `tracker` `name: null` injectable; `ag-str` with `settings` as JSON
**text**; `ag-truthy` `injectAsSection: "true"`; `ag-nosettings` no `settings` key; `ag-html` name
`Quest <Log> & "Notes"` injectable; `ag-emptyname` `name: ""` injectable). Only `settings.injectAsSection === true`
(an object) counts.

Preset sets (row `preset-1`, `name: "Test Preset"`): `ORDERED` (`sectionOrder`, `groupOrder`, `variableOrder` = the
ids of the world's rows in stored order; the JSON shows `"$ids"`); `PARTIAL` (`sectionOrder` = the section ids
reversed, the last of those dropped, then `"s-missing"`; the JSON shows `"$partial"`); `STRING_ORDER`
(`sectionOrder: "s-main"`); `NO_ORDER` (no `sectionOrder`). With a non-array `sectionOrder` the page passes no
sections at all (see `show:order-STRING`, `show:order-NONE`).

Always present too: preset row `preset-2` ("Other Preset", `sectionOrder: ["s-p2"]`) and its section `s-p2` "Other
Preset Section" (`presetId: "preset-2"`), used by `switchPreset`.

`localStorage` sets: `EMPTY`; `DISMISSED` (`preset:loreWarning:dismissed:preset-1` = `"true"`); `DISMISSED_OTHER`
(the same key for `preset-2`); `VALUE_1` (the `preset-1` key = `"1"`); `THROW_GET` (reads throw); `THROW_SET` (writes
throw).

Values that JSON can't hold are encoded everywhere (calls, worlds, pool): `{ "$undefined": true }`,
`{ "$number": "NaN" }`, `{ "$error": message }`, `{ "$function": true }`.

## The harness

Each scenario: a fresh `QueryClient` (`retry: false` for queries and mutations) and this page, which is how the real
preset editor feeds the tab (`PresetEditor.tsx` renders the tab only once the preset has loaded):

```tsx
function Page() {
  const [presetId, setPresetId] = useState("preset-1"); // changed by switchPreset steps
  const [parentChatHasLorebook, setLore] = useState(<world lore>); // changed by setLore steps
  const { data } = usePresetFull(presetId);
  // useCreateSection, useUpdateSection, useDeleteSection, useReorderSections, useCreateGroup, useUpdateGroup,
  // useDeleteGroup, useCreateVariable, useUpdateVariable, useDeleteVariable, useReorderVariables
  const sectionOrder = useMemo(() => (Array.isArray(data?.preset?.sectionOrder) ? data.preset.sectionOrder : []), [data]);
  const sections = useMemo(() => {
    const byId = new Map((data?.sections ?? []).map((s) => [s.id, s]));
    return sectionOrder.map((id) => byId.get(id)).filter(Boolean);
  }, [data?.sections, sectionOrder]);
  // true when some section has enabled and isMarker true or "true" and a marker config (object, or JSON text parsed
  // to an object, with a text `type`) of type lorebook, world_info_before or world_info_after
  const hasLorebookMarker = useMemo(() => sections.some(isEnabledLorebookMarker), [sections]);
  const groupMap = useMemo(() => new Map((data?.groups ?? []).map((g) => [g.id, g])), [data?.groups]);
  const choiceBlocks = useMemo(() => data?.choiceBlocks ?? [], [data?.choiceBlocks]);
  if (!data) return null;
  return (
    <PresetSectionsTab
      presetId={presetId}
      sections={sections}
      groupMap={groupMap}
      choiceBlocks={choiceBlocks}
      wrapFormat="xml"
      onCreateSection={logged("createSection", createSection)}
      onUpdateSection={logged("updateSection", updateSection)}
      onDeleteSection={logged("deleteSection", deleteSection)}
      onReorderSections={logged("reorderSections", reorderSections)}
      onCreateGroup={logged("createGroup", createGroup)}
      onUpdateGroup={logged("updateGroup", updateGroup)}
      onDeleteGroup={logged("deleteGroup", deleteGroup)}
      onCreateVariable={logged("createVariable", createVariable)}
      onUpdateVariable={logged("updateVariable", updateVariable)}
      onDeleteVariable={logged("deleteVariable", deleteVariable)}
      onReorderVariables={logged("reorderVariables", reorderVariables)}
      hasLorebookMarker={hasLorebookMarker}
      parentChatHasLorebook={parentChatHasLorebook}
    />
  );
}
```

`logged(name, m)` is `{ ...m, mutate, mutateAsync }` where both record `["mutate", name, firstArg]` /
`["mutateAsync", name, firstArg]` and then call the hook's own function (so `isPending` is the hook's). The hooks
(`use-presets.ts`, `useAgentConfigs`) are real, so schema parsing, the create's `sectionOrder` / `groupOrder`
update, the reorder's optimistic `sectionOrder` and every refresh are real. Fakes at the API boundary, installed with
`vi.mock`:

| Module mocked                                            | Fake                                                                                                                                                                                                                                                                                                                                               | Op name (for `hold` / `fail`)                                            | Call recorded                                                                                         |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| `shared/api/storage-api` `storageApi.get`                | `"prompts"`: a copy of the preset row with that id, else `null`                                                                                                                                                                                                                                                                                    | `prompts.get`                                                            | `["storage.get", entity, id]`                                                                         |
| `storageApi.list`                                        | `"prompt-sections"` / `"prompt-groups"` / `"prompt-variables"`: copies of the rows whose `presetId` equals `options.filters.presetId`, in stored order; `"agents"`: copies of all agent rows                                                                                                                                                       | `sections.list`, `groups.list`, `variables.list`, `agents.list`          | `["storage.list", entity, options ?? null]`                                                           |
| `storageApi.create`                                      | appends `{ ...payload, id: "<prefix>-<n>", createdAt: "2026-01-02T00:00:00.000Z", updatedAt: same }` (prefix `created-sec` / `created-grp` / `created-var`, n counts from 1 per kind per scenario) and returns a copy; after a `createNoId` step the next create of that kind returns the copy **without** `id` (the row is still stored with one) | `sections.create`, `groups.create`, `variables.create`                   | `["storage.create", entity, payload]`                                                                 |
| `storageApi.update`                                      | merges the payload into the row (`updatedAt` as above; unknown id throws `Not found: <id>`); `"prompts"`: merges into the preset row                                                                                                                                                                                                               | `sections.update`, `groups.update`, `variables.update`, `prompts.update` | `["storage.update", entity, id, payload]`                                                             |
| `storageApi.delete`                                      | removes the row only (no cascade: a deleted group's sections keep their `groupId`; the id stays in `sectionOrder`), returns `null`                                                                                                                                                                                                                 | `sections.delete`, `groups.delete`, `variables.delete`                   | `["storage.delete", entity, id]`                                                                      |
| `shared/api/prompt-nested-api` `promptNestedApi.reorder` | sorts that kind's rows of the preset by the given ids, sets the preset row's `sectionOrder` / `groupOrder` / `variableOrder` to the ids, returns copies of the sorted rows                                                                                                                                                                         | `reorder`                                                                | `["reorder", { presetId, kind, ids }]`                                                                |
| `shared/lib/app-dialogs` `showConfirmDialog`             | answers `true` unless a `confirm` step said otherwise                                                                                                                                                                                                                                                                                              |                                                                          | `["confirm", options]`                                                                                |
| `sonner` `toast`                                         | records; `toast(m)` is kind `"message"`, `toast.success/error/info/warning/loading/promise/custom` their kind; `toast.dismiss(id)`                                                                                                                                                                                                                 |                                                                          | `["toast", kind, message]` or `["toast", kind, message, options]`; `["toast", "dismiss", id ?? null]` |
| global `localStorage` (`vi.stubGlobal`)                  | a `Map` filled from the world's `storage` set; `getItem` throws `Error("SecurityError: storage is blocked")` when `throwGet`; `setItem` / `removeItem` record, then throw `Error("QuotaExceededError: storage is full")` when `throwSet`, else store. Reads are **not** recorded                                                                   |                                                                          | `["localStorage.setItem", key, value]`, `["localStorage.removeItem", key]`                            |

Every get/list/create/update/reorder returns copies, so a refresh hands React Query new objects (structural sharing
keeps old objects when the data is equal).

The call is recorded before the op waits or fails, so a held or failing op still shows its call. Order inside an op:
if it is held, it waits for its `release`; then, if a failure is queued, it throws `new Error(message)`. A refresh is
`storage.get prompts` then the three lists; holding `sections.list` delays every refresh ("the refresh arrives late").

Payloads reach the storage fake after the hooks' schema parsing (`createPromptSectionSchema` /
`updatePromptSectionSchema` / `createPromptGroupSchema` / `updatePromptGroupSchema` / `updatePromptPresetSchema`), so
defaults are filled and unknown keys dropped there; the `mutate` / `mutateAsync` call before it shows what the tab
itself sent, in its key order. A payload the schema refuses has a `mutate` call, no storage call, and the shared
failure toast (`mutate`) or the tab's own error toast (`mutateAsync`, Duplicate).

### Clock

- `Date` is faked (`vi.useFakeTimers({ toFake: ["Date"] })`). `Date.now()` is `1767225600000`
  (`2026-01-01T00:00:00.000Z`) plus the manual clock below, so it only changes at `wait` steps.
- Every `setTimeout` with a delay above 0 (the 800 ms content save, the 600 ms expanded-editor hand-over, the 100 ms
  focus, and anything else) runs on a manual clock that starts at 0 each scenario and only `wait` steps move;
  `clearTimeout` removes such timers. Zero-delay timers are real. A `wait` fires due timers in due order (ties in the
  order they were set), each with `Date.now()` set to its due time and followed by a settle.
- `requestAnimationFrame` callbacks are queued and run during the settle after the step (so a cursor move done in
  one shows in that step's `focus`).

## Steps

After each step the recorder settles (10 rounds of `act` around a real `setTimeout(0)` plus queued animation frames),
then snapshots. Events go through `act`. Errors React rethrows from `act` and errors passed to the root's
`onUncaughtError` are recorded (`renderError`); errors thrown by event handlers reach `window`'s `error` event and are
recorded (`eventError`); neither is fatal. jsdom doesn't move focus on a click and doesn't fire `blur` when a focused
element is removed; steps that need focus say so.

Locators (the builder may find controls any way that hits the same control):

- **card n**: the n-th section card (0-based, in list order; the Preset Variables cards below don't count).
- **fields** in card n's body: `name:n` = the `Section name` input, `role:n` = the role dropdown, `content:n` = the
  content text area, `position:n` = the position dropdown, `depth:n` = the depth box, `group:n` = the group dropdown;
  `groupName` = the group rename input in the groups panel; `editor` = the expanded editor's text area; `body` =
  `document.body` (for keys only).
- **dialog**: the expanded editor and the macros reference are rendered into `document.body`; "the dialog" is the last
  one added.

| Step                                                                                             | Meaning                                                                                                                                                                                      |
| ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `["mount"]`                                                                                      | the tab mounted and settled (the first result)                                                                                                                                               |
| `["toggle", n]` / `["clickName", n]`                                                             | click card n's chevron / name                                                                                                                                                                |
| `["moveUp", n]` / `["moveDown", n]` / `["duplicate", n]` / `["eye", n]` / `["deleteSection", n]` | click card n's Move up / Move down / Duplicate / on-off eye / trash button                                                                                                                   |
| `["addSection"]`                                                                                 | click **Add Section**                                                                                                                                                                        |
| `["menuItem", text, i?]`                                                                         | click the i-th (default 0) button whose collapsed text is `text` (the add menu items: `Prompt Block`, the marker labels, `<agent name> (Agent)`; a null or empty agent name gives `(Agent)`) |
| `["menuBackdrop"]`                                                                               | click the full-page click-catcher behind the add menu                                                                                                                                        |
| `["groups"]`                                                                                     | click **Groups (n)**                                                                                                                                                                         |
| `["newGroup"]`                                                                                   | click **New Group**                                                                                                                                                                          |
| `["renameGroup", i]` / `["groupDelete", i]`                                                      | click group row i's name / trash button                                                                                                                                                      |
| `["dismissWarning"]`                                                                             | click the lorebook warning's X                                                                                                                                                               |
| `["expandEditor", n]` / `["macros", n]`                                                          | click the **Expand editor** / **Macros reference** button in card n's body                                                                                                                   |
| `["close"]` / `["done"]` / `["closeText"]` / `["backdrop"]`                                      | the dialog: click its header X / **Done** / **Close** / the dimmed backdrop outside the panel                                                                                                |
| `["focus", field]`                                                                               | `element.focus()`                                                                                                                                                                            |
| `["blur", field]`                                                                                | `element.blur()`, focusing it first if it isn't focused (so its focus handler runs too)                                                                                                      |
| `["type", field, value]`                                                                         | set the value and fire `input` (no focus)                                                                                                                                                    |
| `["choose", field, value]`                                                                       | set a dropdown's value and fire `change` (also when the value is the one shown)                                                                                                              |
| `["select", field, start, end]`                                                                  | `setSelectionRange(start, end)` (no events)                                                                                                                                                  |
| `["key", field, key]`                                                                            | dispatch a cancelable bubbling `keydown` with `key` at the field (`body`: at `document.body`); the result has `defaultPrevented`                                                             |
| `["gripDown", n]`                                                                                | `mousedown` on card n's drag grip                                                                                                                                                            |
| `["dragStart", n]` / `["dragOver", n, clientY]` / `["drop", n]` / `["dragEnd", n]`               | dispatch `dragstart` / `dragover` / `drop` / `dragend` (bubbling, cancelable `MouseEvent` with `clientY`, 0 unless given) at card n's outermost element                                      |
| `["dragOverList", clientY]` / `["dropList"]`                                                     | dispatch `dragover` / `drop` at the list element that holds the cards (the empty part of the list)                                                                                           |
| `["switchPreset", id]`                                                                           | the page's `presetId` becomes `id` (as when the editor opens another preset)                                                                                                                 |
| `["setLore", bool]`                                                                              | the page's `parentChatHasLorebook` becomes `bool`                                                                                                                                            |
| `["confirm", answer]`                                                                            | the next confirm dialogs answer `answer`                                                                                                                                                     |
| `["fail", op, message]`                                                                          | the next call of `op` throws `new Error(message)` (one call only)                                                                                                                            |
| `["hold", op]` / `["release", op]`                                                               | every call of `op` from now on waits / let them all go on and stop holding                                                                                                                   |
| `["createNoId", kind]`                                                                           | the next create of `kind` (`sections`) returns no `id`                                                                                                                                       |
| `["patchSection", id, patch]`                                                                    | merge `patch` into stored section `id` behind the tab's back (seen at the next refresh)                                                                                                      |
| `["setSections", set]`                                                                           | replace the stored `preset-1` sections with a copy of that set                                                                                                                               |
| `["refetch"]`                                                                                    | `queryClient.invalidateQueries({ queryKey: presetKeys.full(<current presetId>) })`, as another part of the app would                                                                         |
| `["wait", ms]`                                                                                   | the manual clock moves `ms` (see Clock)                                                                                                                                                      |

Drag details: `dragStart` makes a new fake `dataTransfer` (`effectAllowed: "uninitialized"`, `dropEffect: "none"`,
`setData(type, value)` / `getData(type)`, `types: []`) used by every drag event until the next `dragStart` (a drag
event before any `dragStart` makes one too); drag results have `dataTransfer: { effectAllowed, dropEffect, data }`
after the event. Card layout: `getBoundingClientRect()` of card n's element, of anything inside it, or of the list's
wrapper element around it, is `{ top: 100n, height: 100, bottom: 100n + 100, left: 0, width: 600, right: 600, x: 0,
y: 100n }`, so `clientY` below `100n + 50` is card n's top half; `dragOverList` with `clientY` above 0 / below
`100 × count` is above the first / below the last card, anything else is "in a gap".

At the end of a scenario the recorder releases any held op, unmounts, removes everything from `document.body`, and
clears the client.

## Step results

Each result has `step` and either `error` (the recorder couldn't find the control; nothing was done) plus `calls`, or a
snapshot:

- `text`: the tab's `textContent` (toolbar, menus, groups panel, list, hint, Preset Variables) without its text areas'
  text, whitespace collapsed (`/\s+/g` → one space, trimmed). Adjacent elements run together with no space, as
  `textContent` does. The dialogs are not in it.
- `fields`: every `input`, `textarea` and `select` in the tab, in page order: `tag`, `type`, `placeholder` (`null`
  when absent), `value`; for a `select` also `options` (`[value, text]` pairs) and `selectedIndex`; `inputMode` when
  the attribute is set (the depth box: `"numeric"`); `disabled: true` when disabled; every `aria-*`, `title` and
  `role` attribute present.
- `buttons`: every `button` in the tab, in page order: `text` (collapsed `textContent`), every `aria-*`, `title` and
  `role` attribute present, `disabled: true` when disabled. The `type` attribute is not recorded (decision 2).
- `labelled`: every other element in the tab (not a button, field or SVG) that has a `title`, `role` or `aria-*`
  attribute: `{ tag, text, …those attributes }` (the drag grips, the group names' `Click to rename`).
- `cards`: one array of flags per section card, in order: `expanded` (its body is shown), `chevronDown` (its chevron
  points down), `off` (shown faded because the section is off), `dragging` (shown faded while it is dragged),
  `lineBefore` / `lineAfter` (the drop line shows just above / below this card).
- `open`: which of `addMenu`, `groupsPanel`, `lorebookWarning`, `groupRename` are showing.
- `modals`: the dialogs in `document.body`, in the order added: `{ text, fields, buttons, labelled }` each, measured
  the same way.
- `focus`: `null` when nothing (or `body`) has focus; else `{ where: "tab" | "dialog" | "other", dialog?: i, field: i,
sel: [selectionStart, selectionEnd] | null }` (i indexes that scope's `fields`; `sel` is `null` for a `select`), or
  `{ where, button: i }`, or `{ where, tag }`.
- `calls`: every fake call, `mutate` / `mutateAsync` call, toast, confirm and `localStorage` write since the previous
  result, in order.
- `renderError` / `eventError` (only when there was one): as `"<name>: <message>"`.
- `defaultPrevented` (`key` and drag steps), `dataTransfer` (drag steps).
- `unhandled` (only when there were some): unhandled promise rejections during the step, as their messages.
- `unhandledAfterUnmount` (on the last result, only when there were some).

Not recorded: colors and other styling (the purple Add Section gradient, the sky tint of the Groups button while the
panel is open, the amber warning, the role icon colors, the violet / amber marker notes), layout and widths, icons
other than the chevron's direction, and the `sm` breakpoint that hides the role text. Those come from the spec and the
screenshots. The macros reference lists `SUPPORTED_MACROS` as it was when recorded; if that list changes, the
recorded dialog text changes with it.

## What the decisions change

The recordings show the chevron, eye and trash buttons, the group trash, the content editor's two buttons and the
dialogs' X buttons with no name, no `aria-expanded` / `aria-pressed`, **Add Section** and **Groups** without
`aria-expanded`, no `role="dialog"` / `aria-modal`, the name input, role, position, depth and group controls not tied
to labels, and the grip as a `div` with `title="Drag to reorder"` (in `labelled`). The rebuild adds those (decisions 1
to 3), so a replay should compare `buttons` / `fields` / `labelled` / `modals` ignoring the attributes those decisions
add, and check the added ones in their own tests.
