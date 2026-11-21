# Generation parameters recordings

Black-box recordings of the old generation parameters editor (before the #1580
rebuild), made on `main` at `081beeaca6` by someone other than the builder. The
spec is `docs/provenance/generation-parameters.md`. Each JSON file is one line
so the provenance report doesn't count it as code. Recorded twice; both runs
were byte-identical.

## Encoding

JSON can't hold some values the helpers return, so every recorded value is
encoded: `undefined` is `{"$":"undefined"}` (also as an object value, so a key
that is present with `undefined` shows up), `NaN` is `{"$":"NaN"}`, `Infinity`
and `-Infinity` are `{"$":"Infinity"}` and `{"$":"-Infinity"}`, `-0` is
`{"$":"-0"}`. Object key order is the order the old code produced. Inputs in
`raw`, `values`, `metadata`, `presets` and `connections` are encoded the same
way; decode them before use.

## `recorded-helpers.json`

- `constants`: `EDITABLE_GENERATION_PARAMETER_KEYS`, `CHAT_PARAMETER_DEFAULTS`,
  `ROLEPLAY_PARAMETER_DEFAULTS`.
- `defaults`: three default sets by key (`chat`, `roleplay`,
  `custom-defaults`).
- `raw`: the raw inputs by key.
- `parseGenerationParameterRecord`: `[rawKey, result]` for the first 88 raw
  inputs.
- `parseEditableGenerationParameters`: `[rawKey, result]` for every raw input.
- `getEditableGenerationParameters`: `[defaultsKey, rawKey, result]` for every
  default set and raw input.
- `getEditableGenerationParameterOverrides`: `[defaultsKey, valueKey, value,
result]`; `value` is the (encoded) value passed in.
- `serviceTierOptionsForProvider`: `[provider, result]`.

## Fields recordings

`recorded-show.json`, `recorded-numbers.json`, `recorded-text.json`,
`recorded-tags.json`, `recorded-choices.json`, made in the repo's jsdom test
environment (`*.spec.tsx`), React 19 with `act()`, no StrictMode.

Every file has:

- `values`: the starting values, by key.
- `tiers`: the `serviceTierOptions` lists, by key (`none` is `undefined`,
  `empty` is `[]`, the others are `serviceTierOptionsForProvider(<key>)`).
- `scenarios`: `{ id, value, tiers, handsBack, start, steps }`.

**The caller.** A small component holds the value in state (starting from
`values[value]`) and renders `GenerationParametersFields` with that value and
`serviceTierOptions={tiers[tiers]}`. `onChange(next)` appends the encoded `next`
to the step's `calls`; when `handsBack` is true it also sets the state to `next`
(as the real callers do), when false it ignores it.

**A scenario.** Mount the caller, take a snapshot (`start`), then for each step
run its `action` inside `act()` and take a snapshot (`shown`); `calls` are the
values handed over during that step, in order.

**Fields** are named by key: `temperature`, `maxTokens`, `topP`, `topK`,
`frequencyPenalty`, `presencePenalty` (the number fields, in the order shown),
`prefill` (Assistant Prefill), `customParameters`, and `tag:<n>:open` /
`tag:<n>:close` (row n from 1). The old markup had no accessible names, so the
recorder found them by position; find yours by the names from decision 2.

**Actions** (`action.do`):

| `do`       | Meaning                                                                                                                                                                                                                         |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `focus`    | `field.focus()`                                                                                                                                                                                                                 |
| `blur`     | `field.blur()`                                                                                                                                                                                                                  |
| `fill`     | set the field's whole text to `text` through the native value setter, then one bubbling `input` event                                                                                                                           |
| `keys`     | for each character of `text`: append it through the native value setter, then one bubbling `input` event                                                                                                                        |
| `key`      | dispatch a bubbling, cancelable `keydown` on the field with `key`, `ctrlKey: ctrl`, `metaKey: meta`                                                                                                                             |
| `click`    | dispatch a bubbling `click` on: the option button labelled `option` in `group` (`tier`, `reasoning`, `verbosity`); or with `button: "add-tag"` the "Add tag" button; or with `button: "remove-tag"` the trash button of row `n` |
| `rerender` | the caller replaces its state with `{ ...state, ...patch }` (a change from outside; hands nothing over)                                                                                                                         |

**Compact snapshot** (every `shown`, and `start` except in `recorded-show.json`):

- `values`: the text in each number field, the prefill text area and the Custom
  Parameters text area, by key.
- `tags`: `[open, close]` text of every tag row, in order.
- `selected`: for each group, the labels of the selected option buttons (the
  recorder read the selection from the look; read yours from `aria-pressed`),
  or `null` when the group isn't shown.
- `tierOptions`: the Service Tier button labels in order, or `null`.
- `addDisabled`: whether "Add tag" is disabled.
- `cpPlaceholder`: the Custom Parameters placeholder.
- `cpNote`: the text right under the Custom Parameters text area (the hint, or
  the error).

**Full snapshot** (`start` in `recorded-show.json`): the compact fields plus

- `texts`: every non-blank text node under the editor, trimmed, in document
  order, with adjacent text nodes of the same parent joined;
- `controls`: every `input`, `textarea` and `button` in document order:
  `tag`, `type` (the attribute, when present), `name` (`aria-label`, when
  present), `value` (fields), `placeholder` (when the attribute is present),
  `inputMode`, `rows` and `spellCheck` (when present), `text` (buttons),
  `selected` (option buttons, read from the look), `disabled` (when true).

Expected differences from decisions 2 and 3: field `name`s, the trash button
`name`s and option button `type`s in `controls`. Decision 4 changes
`values.customParameters` and `cpNote` after a rejected blur.

## Caller recordings

`recorded-advanced-1.json` and `recorded-advanced-2.json` (one recording split
in two) and `recorded-setup.json`, jsdom, with the real callers and the old
module. Top level: `connections` (the `ConnectionSummary` list), `metadata`
(chat metadata by key), `presets` (prompt preset parameters by key; `none` is
`undefined`), `scenarios`.

### `AdvancedParametersSection`

A caller holds chat metadata in state (starting from `metadata[metadata]`) and
renders `AdvancedParametersSection` inside a `QueryClientProvider` with
`chat={{ id: "chat-1" }}`, that metadata, `mode`, `connectionId`,
`connections`, `promptPresetParameters={presets[preset]}`, and
`updateMeta={{ mutate }}` where `mutate({ id, ...patch })` appends the encoded
`patch` to `chatPatches` and merges it into the state (`{ ...state, ...patch }`).
`useSaveConnectionDefaults` (from `src/features/catalog/connections/index`) is
mocked to `{ mutate: (v) => <append encoded v to connectionDefaults>, isPending: false }`.
The section is expanded first by clicking its "Advanced Parameters" header (not
a step).

Scenario: `{ id, metadata, connectionId, preset, mode, steps, start, rec }`;
`steps` names the step set. `start` is `{ texts, pressed, fields }` after
expanding. Each `rec` entry is `{ action, chatPatches, connectionDefaults,
pressed, buttons }`, plus `fields` on the last step; or `{ action, absent: true }`
when the step's button wasn't there (the scenario stops there).

- `pressed`: `[text, aria-pressed]` of the two "Generation profile" buttons.
  (The recorder listed every `[aria-pressed]` button; in the old markup those
  were the only two. Compare against the two group buttons only.)
- `buttons`: the texts of buttons without `aria-label` whose text contains
  Recommended, Custom, Clear, Save or Saving, in order.
- `fields`: `{ values, tags, selected, tierOptions }` as in the compact
  snapshot, or `null`.

Actions: `{ do: "button", pressed: i }` clicks the i-th "Generation profile"
button; `{ do: "button", text, last? }` clicks the (last) button with exactly
that text; `{ do: "edit", field, text }` focuses the field, sets its whole text
(one `input` event) and blurs it; `{ do: "touch", field }` focuses and blurs;
`{ do: "group", group, option }` clicks an option button.

### `SetupParametersPanel`

A caller holds a connection id in state (starting from `connectionId`), calls
`useSetupParameters({ metadata: metadata[metadata], isConversation,
connection: <that connection or null> })` and renders `SetupParametersPanel`
with the result. Scenario: `{ id, metadata, connectionId, isConversation,
steps, start, rec }`. `start` is `{ texts, enabled, chatParameters, value,
serviceTierOptions, fields }` (the hook's values, encoded); each `rec` entry has
the same minus `texts`, after its `action`. Actions: `switch` clicks the
`role="switch"` button; `enable` clicks it only when `aria-checked` isn't
`"true"`; `connection` sets the connection id to `to`; `edit` and `group` as
above.

## `recorded-chrome.json`

Real Chrome (headless), the old build on a throwaway local server with a
scratch data folder, at 1366x900 and 660x900, light and dark. Two flows, each
on a fresh throwaway OpenAI connection and an empty Conversation chat using it:

- `connection`: the connection editor; Custom defaults on, edits, Save, bad
  Custom Parameters, Save, Custom defaults off, Save.
- `chat`: the chat settings drawer, Advanced Parameters; edits, bad Custom
  Parameters, Save as Connection Default, Custom, Use Recommended, focus and
  leave Temperature, Recommended.

Each step has `shown.fields` (as the compact snapshot, plus `options`) and
`stored`: the connection's stored `defaultParameters` and the chat's stored
`chatParameters` and `generationProfileMode` after the step. The spec writer
replays this against the new build; it's here for reference.
