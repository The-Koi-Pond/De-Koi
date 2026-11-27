# Generation Parameters Editor: Behavior Spec

Status: agreed 2026-11-21 (decisions as recommended; clarified during the
build). Part of the code provenance plan (`docs/code-provenance-plan.md`,
tracked in #1580).

This spec describes the shared generation parameters editor: the fields for
temperature, max output tokens, sampling, penalties, assistant prefill, custom
parameters, custom thinking tags, service tier, reasoning effort and verbosity,
plus the helpers its callers use to read stored parameters, fill in defaults and
work out what differs from them. It is the only input the builder uses. It
describes behavior, not the old implementation.

## Rules for the builder

Build from this spec, the recordings, the screenshots and the team-owned code
around it. Don't open, search, or read the history of the old implementation:

- `src/shared/components/ui/GenerationParametersEditor.tsx`

You may read every caller listed under "Callers" and everything they import
except that file. If this spec doesn't answer a question, ask the spec writer.

**Safety.** The module sends no requests and reads or writes no storage itself.
But what it hands over is saved as it is by its callers (see "Callers"), and the
saved values are merged into **paid model requests**: chat parameters and
connection defaults end up in every reply's request body. So every value the
helpers return and every value the fields hand over is a compatibility contract
and must stay exactly the same, key for key and number for number, including
key order where the recordings show it, `undefined` keys, `NaN` and `-0`. The
rebuild changes no stored or handed-over value, with one exception from
decision 4: after a rejected Custom Parameters entry, focusing and leaving the
field again hands nothing over (the old editor handed the saved object over
again, which in chat settings re-saved the same overrides, normalized, and set
the chat to Custom). Otherwise the decisions touch only what screen readers
hear and what the screen shows after bad Custom Parameters input.

Someone other than the builder recorded the old module as a black box first
(see "Black-box recordings"), the recordings become tests, and the builder sees
the recordings, never the old code. Where this text and a recording disagree,
the recording wins, except where a decision below changes the behavior on
purpose; tell the spec writer so the spec gets fixed.

## Scope

Lines not yet team-owned, from `node scripts/code-provenance.mjs --fast` at
`081beeaca6`:

| File                                                      | Not owned | Of lines |
| --------------------------------------------------------- | --------: | -------: |
| `src/shared/components/ui/GenerationParametersEditor.tsx` |       399 |      548 |

Replaced, then deleted in the same change. The new module lives in
`src/shared/components/ui/generation-parameters/` and exports, from its
`index.ts`, the same names with the same types (see "Exports"), so the callers
only change their import path.

## Callers

Not rebuilt. Each one saves what the module returns or hands over.

| Caller                                                                                                                                               | Uses                                                                                                                                                                                                                                                                        | Where the values go                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ---------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/features/modes/shared/chat-ui/components/settings/AdvancedParametersSection.tsx` (chat settings drawer, "Advanced Parameters")                  | `GenerationParametersFields`, both default sets, `EDITABLE_GENERATION_PARAMETER_KEYS`, `getEditableGenerationParameters`, `getEditableGenerationParameterOverrides`, `parseEditableGenerationParameters`, `parseGenerationParameterRecord`, `serviceTierOptionsForProvider` | Chat metadata patches `{ generationProfileMode, chatParameters }` (only the keys that differ from the inherited defaults, plus any stored keys the editor doesn't edit, such as `seed` or `minP`); "Save as Connection Default" saves the connection's `defaultParameters` through `useSaveConnectionDefaults`. The request builder (`src/engine/generation/generate-route-utils.ts`, `generationParameterSources`) merges connection defaults, prompt preset parameters, the recommended profile and `chatParameters` into the request. `generationProfileMode` is only read by this screen. |
| `src/features/modes/shared/chat-ui/components/chat-setup/SetupParametersPanel.tsx` (new Conversation and new Roleplay setup, "Customize parameters") | `GenerationParametersFields`, both default sets, `getEditableGenerationParameters`, `parseEditableGenerationParameters`, `serviceTierOptionsForProvider`                                                                                                                    | `chatParameters` (the whole value, or `null` when off) saved when setup finishes, by `NewConversationCard.tsx` and `RoleplaySetup.tsx`.                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `src/features/shell/connections/components/ConnectionEditor.tsx` (connection editor, "Generation Profile", "Custom defaults")                        | `GenerationParametersFields`, `ROLEPLAY_PARAMETER_DEFAULTS`, `getEditableGenerationParameters`, `parseEditableGenerationParameters`, `serviceTierOptionsForProvider`                                                                                                        | On Save, the whole value as the connection's `defaultParameters` (or `null` with Custom defaults off), through `saveConnectionDefaults`.                                                                                                                                                                                                                                                                                                                                                                                                                                                      |

Other code that must keep working:

- `src/features/modes/shared/chat-ui/components/settings/AdvancedParametersSection.test.tsx`
  (renders the section and finds buttons by text and `aria-pressed`).

## Exports

```ts
type EditableGenerationParameters = Pick<
  GenerationParameters, // from src/engine/contracts/types/prompt.ts
  | "temperature"
  | "maxTokens"
  | "topP"
  | "topK"
  | "frequencyPenalty"
  | "presencePenalty"
  | "reasoningEffort"
  | "verbosity"
  | "serviceTier"
  | "assistantPrefill"
  | "customThinkingTags"
  | "customParameters"
>;
type EditableGenerationParameterOverrides = Partial<EditableGenerationParameters>;
type GenerationServiceTier = EditableGenerationParameters["serviceTier"];

const EDITABLE_GENERATION_PARAMETER_KEYS; // readonly tuple, in this order:
// temperature, maxTokens, topP, topK, frequencyPenalty, presencePenalty,
// reasoningEffort, verbosity, serviceTier, assistantPrefill, customThinkingTags, customParameters
const CHAT_PARAMETER_DEFAULTS: EditableGenerationParameters;
const ROLEPLAY_PARAMETER_DEFAULTS: EditableGenerationParameters;

function parseGenerationParameterRecord(raw: unknown): Record<string, unknown> | null;
function parseEditableGenerationParameters(raw: unknown): EditableGenerationParameterOverrides | null;
function getEditableGenerationParameters(
  defaults: EditableGenerationParameters,
  overrides: unknown,
): EditableGenerationParameters;
function getEditableGenerationParameterOverrides(
  defaults: EditableGenerationParameters,
  value: EditableGenerationParameters,
): EditableGenerationParameterOverrides | null;
function serviceTierOptionsForProvider(provider: unknown): readonly GenerationServiceTier[] | undefined;

function GenerationParametersFields(props: {
  value: EditableGenerationParameters;
  onChange: (next: EditableGenerationParameters) => void;
  serviceTierOptions?: readonly GenerationServiceTier[];
}): JSX.Element;
```

Nothing else is exported.

## Defaults

Both default sets, key order as listed: temperature `1`, maxTokens `4096`
(conversation) or `8192` (roleplay), topP `1`, topK `0`, frequencyPenalty `0`,
presencePenalty `0`, reasoningEffort `"xhigh"`, verbosity `"high"`,
serviceTier `null`, assistantPrefill `""`, customThinkingTags `[]`,
customParameters `{}`.

## Helpers

`recorded-helpers.json` holds every input and output; these are the rules.

**`parseGenerationParameterRecord(raw)`.** A string is parsed as JSON (no
trimming beyond what JSON allows, no Python-boolean fixes); a string that isn't
JSON gives `null`. Then anything that isn't a plain object (`null`, arrays,
numbers, booleans, strings) gives `null`; a plain object is returned as it is.

**`parseEditableGenerationParameters(raw)`.** Reads the record as above (`null`
→ `null`) and builds a new object, in the key order above, with only the keys
that pass:

- the six numbers: any value whose type is number, unchecked (so `NaN`,
  `Infinity`, `-0`, out-of-range and fractional values pass; strings don't);
- `reasoningEffort`: `null`, `"none"`, `"minimal"`, `"low"`, `"medium"`,
  `"high"`, `"xhigh"` or `"maximum"`, exactly (a missing key is not `null`);
- `verbosity`: `null`, `"low"`, `"medium"` or `"high"`;
- `serviceTier`: `null`, `"auto"`, `"default"`, `"flex"`, `"scale"`,
  `"priority"` or `"standard_only"` (for every provider);
- `assistantPrefill`: any string, untrimmed;
- `customThinkingTags`: whenever the key is present at all (even `undefined`
  or not an array): an array value keeps, in order, every entry that is a plain
  object whose `open` and `close` are both strings that are non-empty after
  trimming, as a new `{ open, close }` with both trimmed (other keys dropped,
  duplicates kept), then only the first 20; anything that isn't an array gives
  `[]`;
- `customParameters`: a plain object with at least one key (even a key whose
  value is `undefined`), kept as it is.

Other keys (`seed`, `minP`, ...) are ignored. No passing key gives `null`.

**`getEditableGenerationParameters(defaults, overrides)`.** Parses `overrides`
as above. `null` gives `defaults` itself. Otherwise the result is `defaults`
with every parsed key on top, except `customParameters`: when the parsed value
has it, the result's is a deep merge of `defaults.customParameters` with it
(a new object: for each key of the override, `undefined` is skipped, two plain
objects merge recursively by the same rule, anything else replaces, arrays
included); without it, `defaults.customParameters`. Key order: the defaults'
keys first, in their order.

**`getEditableGenerationParameterOverrides(defaults, value)`.** For each key in
`EDITABLE_GENERATION_PARAMETER_KEYS` order, the key is kept, with `value`'s
value, when it differs from `defaults`. `customParameters` and
`customThinkingTags` are compared as JSON with object keys sorted at every
level (so key order doesn't count, `undefined` object values count as missing,
array order counts); everything else with `===` (so `NaN` always differs, `-0`
equals `0`, and a key missing from `value` differs from a set default and is
kept with `undefined`). Keys outside the list are ignored. No differences gives
`null`.

**`serviceTierOptionsForProvider(provider)`.** `"openai"`: `null`, `"auto"`,
`"default"`, `"flex"`, `"scale"`, `"priority"`. `"openrouter"`: `null`,
`"flex"`, `"priority"`. `"anthropic"`: `null`, `"auto"`, `"standard_only"`.
Anything else (other providers, other casing, non-strings): `undefined`.

## The fields

`GenerationParametersFields` shows `value` and hands over a whole new value
(`{ ...value, [key]: next }`, so every other key, including ones it doesn't
edit, passes through untouched and in place) through `onChange`. It hands over
nothing on mount or when `value` changes from outside. Top to bottom:

1. **Two columns:** Temperature (0–2), Max Output Tokens (1–128000), Top P
   (0–1), Top K (0–500).
2. **Two columns:** Frequency (−2–2), Presence (−2–2).
3. **Assistant Prefill**, a 3-row text area, resizable vertically, placeholder
   the literal text `e.g. <thinking>\n` (a backslash and an `n`, not a line
   break).
4. **Custom Parameters**, a 3-row monospace text area, resizable vertically,
   spellcheck off.
5. **Custom Thinking Tags**, a row per tag and an "Add tag" button.
6. **Service Tier** (only when `serviceTierOptions` has at least one entry).
7. **Reasoning Effort.**
8. **Verbosity.**

Every label is small, medium weight and muted, followed by a help button
(`HelpTooltip`, size 0.625rem) with this text, verbatim:

| Label                | Help text                                                                                                                                                                |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Temperature          | Controls randomness. Lower values make output more focused and deterministic; higher values make it more creative and varied.                                            |
| Max Output Tokens    | The maximum number of tokens the model can generate in a single response. Higher values allow longer replies.                                                            |
| Top P                | Nucleus sampling: only considers tokens whose cumulative probability reaches this threshold. Lower values make output more focused.                                      |
| Top K                | Limits the model to only consider the top K most likely tokens at each step. 0 disables this limit.                                                                      |
| Frequency            | Penalizes tokens based on how often they've already appeared. Positive values reduce repetition; negative values encourage it.                                           |
| Presence             | Penalizes tokens that have appeared at all, regardless of frequency. Positive values encourage the model to talk about new topics.                                       |
| Assistant Prefill    | Optional assistant-role text appended after the final user message. Use this only for models that support assistant prefill/continuation or need a specific opening tag. |
| Custom Parameters    | Optional raw JSON object merged into the provider request body. This can break requests if the provider does not support a key.                                          |
| Custom Thinking Tags | Optional open/close wrappers that should be stripped from streamed output and saved as thinking metadata.                                                                |
| Service Tier         | Optional provider processing tier. Unset sends no service_tier; provider defaults still apply.                                                                           |
| Reasoning Effort     | How much the model should 'think' before responding. Higher effort produces more thoughtful, nuanced output but uses more tokens and is slower.                          |
| Verbosity            | Controls how long and detailed responses should be. Low keeps things concise; high encourages elaborate, descriptive output.                                             |

### Number fields

A one-line text field (`inputMode="decimal"`, not a number input) holding a
draft text, which starts as `String(value[key])` and is reset to
`String(value[key])` whenever that number changes from outside, even while the
user is typing.

Typing changes only the draft. On blur (Enter blurs the field), the draft is
read with `parseFloat` rules (leading spaces skipped, trailing junk ignored:
`"1.5abc"` is `1.5`, `"1e1"` is `10`, `"0x10"` is `0`, `"Infinity"` is
`Infinity`). When that gives a number within the field's range, inclusive, the
fields hand over the value with that number, **even when it is the same number
as before**, and the draft becomes `String(number)` (`"1.50"` → `"1.5"`,
`"-0"` → `"0"`). Otherwise nothing is handed over and the draft goes back to
`String(value[key])`. There is no rounding: `100.7` max tokens and `2.5` top K
are handed over as they are. Stored values outside the range (for example a
stored temperature of `5`) show as they are; a blur without typing hands
nothing over for them (the draft is out of range), while an in-range stored
fraction such as `100.5` max tokens is handed over again.

### Assistant Prefill

Every edit hands over the value with the text area's whole text, unchecked and
untrimmed.

### Custom Parameters

The text area holds a draft. While it isn't focused, the draft follows
`value.customParameters`: `""` for an empty object, else
`JSON.stringify(customParameters, null, 2)`. While it is focused, outside
changes don't touch the draft. The placeholder is `{ "thinking": true }` while
not focused and empty while focused. Under the text area, a hint:
"Must be a JSON object. Use lowercase true, false, and null."

On blur (Ctrl+Enter or Cmd+Enter blurs it; plain Enter types a new line), the
draft is read:

1. Trimmed; empty text reads as `{}`.
2. Parsed as JSON. If that fails and the text contains a whole word `True`,
   `False` or `None`, every such word is replaced by `true`, `false` or `null`
   (anywhere, even inside quotes) and the result is parsed instead.
3. The first attempt that parses decides: a plain object is accepted; anything
   else (array, `null`, number, string) is rejected as "not an object". Text
   that parses in neither attempt is rejected as invalid JSON.

Accepted: the fields hand over the value with that object as
`customParameters`, **even when nothing changed** (focus and blur with no edit
hands over the same object again; an empty field hands over `{}`). The draft
then follows `value.customParameters` as above, so with a caller that hands
the value back it shows the object as 2-space JSON, and with one that ignores
it, the caller's unchanged value.

Rejected: nothing is handed over. In the old editor the draft then snaps back
to the last saved value and the hint stays; the error text is never seen
(decision 4 changes this).

### Custom Thinking Tags

One row per tag, in order: an "open" text field (placeholder `<analysis>`), a
"close" text field (placeholder `</analysis>`), both monospace, and a square
trash button. Typing in a field hands over the tags with that field of that row
replaced by the field's whole text (untrimmed, empty allowed). The trash button
hands over the tags without that row.

"Add tag" (plus icon) hands over the tags with one new row at the end: the
first of `<analysis>`/`</analysis>`, then `<analysis2>`/`</analysis2>` through
`<analysis20>`/`</analysis20>`, whose open text isn't already used by a row;
if all are used, `<custom-thinking>`/`</custom-thinking>`. With 20 or more rows
it is disabled and hands over nothing.

### Option buttons

Three groups of small rounded buttons in a wrapping row. Clicking any button
hands over the value with that option, **even when it is already selected**.
The selected one is tinted (service tier in the primary color, reasoning in
purple, verbosity in blue); a stored value that isn't one of the options
selects none.

| Group            | Options, in order (label → value)                                                                                                                          |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Service Tier     | `serviceTierOptions` in the given order; label `Unset` for `null`, else the value split at `_`, each part capitalized, joined by a space (`Standard Only`) |
| Reasoning Effort | Unset → `null`, None → `"none"`, Minimal, Low, Medium, High, X High → `"xhigh"`, Maximum                                                                   |
| Verbosity        | None → `null`, Low, Medium, High                                                                                                                           |

## Decisions

The rebuild keeps every returned and handed-over value as above, except the one call decision 4 notes.

1. **Selected options aren't announced.** The option buttons show the selection
   by color only. Recommended: `aria-pressed` on every option button (true for
   the selected one). Screen readers only.
2. **Fields have no accessible names.** The labels aren't tied to their fields,
   and every trash button is called "Remove custom thinking tag". Recommended:
   each field is named by its visible label ("Temperature", "Max Output
   Tokens", "Top P", "Top K", "Frequency", "Presence", "Assistant Prefill",
   "Custom Parameters"); tag fields are "Custom thinking tag <n> open" and
   "Custom thinking tag <n> close"; trash buttons are "Remove custom thinking
   tag <n>" (n from 1). The help buttons keep their names. Screen readers only;
   nothing visible changes.
3. **Buttons are plain buttons.** Recommended: every button in the module is
   `type="button"`, so it can never submit a form. No caller is inside a form
   today, so nothing changes now.
4. **Bad Custom Parameters vanish silently.** Recommended: after a rejected
   blur, keep the typed text and show the error in place of the hint, in amber:
   "Invalid JSON. Check quotes, commas, and boolean casing." or "Custom
   parameters must be a JSON object, not an array or scalar." (the one that
   applies, worded exactly so). The text and error stay until the next edit (an
   edit clears the error and shows the hint again) or until
   `value.customParameters` changes from outside while the field isn't focused
   (then the field follows it and the error clears). Still nothing is handed
   over, so nothing stored changes. One handed-over call disappears as a
   consequence: focusing and leaving the field again without editing after a
   rejection re-reads the kept bad text and hands nothing over, where the old
   editor had already put the saved text back and handed the saved object over
   again (in chat settings, that old call only switched the chat to Custom).
5. **Not in this rebuild** (unchanged, follow-ups):
   - focusing and leaving a number field or Custom Parameters without changing
     anything hands the same value over again; in chat settings that switches
     the chat to Custom (`generationProfileMode: "custom"`), which only this
     screen reads;
   - Max Output Tokens and Top K accept fractions; trailing junk after a number
     is ignored; stored numbers aren't range-checked;
   - Python-boolean replacement also rewrites quoted text when the first parse
     fails;
   - in chat settings, emptying a tag's open or close field drops the row on
     the next render (the stored value is re-read, and parsing drops empty
     tags), so a tag can't be retyped from empty there;
   - an empty verbosity is called "None" while an empty reasoning effort is
     "Unset" and "None" means something else;
   - a stored service tier the provider doesn't offer selects nothing and stays
     stored.
   - a `__proto__` key inside custom parameters is lost when they are merged
     with defaults (it sets the merged object's prototype instead of a key), so
     the next save drops it; confirmed identical in the old helpers;
   - Enter in a number field and Ctrl/Cmd+Enter in Custom Parameters also act
     during IME composition.
6. **Reasoning effort starts at X High.** Both default sets started reasoning
   effort at `"xhigh"`, so turning on custom parameters anywhere saved X High
   even for models that reject it (Gemini through Nano-GPT answered 400). Now
   both start at Unset (`null`): the model's own default. The replays check the
   callers against the recorded defaults (X High) and the constants test names
   this one difference. Under Reasoning Effort, the callers that know the
   connection add one line when its model gets a different level than the one
   picked ("This model doesn't take X High; it gets High."), read from what the
   request builder sends (`reasoningEffortSentAs`).

## Layout and text targets

Use the app's theme tokens (`--secondary`, `--border`, `--ring`, `--primary`,
`--accent`, `--foreground`, `--muted-foreground`) and the existing tints
(purple-400, blue-400, amber-500). The screenshots handed to the builder (old
build, real Chrome, 1366 and 660 wide, light and dark, chat settings drawer and
connection editor; not committed) are the visual target.

| Part                           | Look                                                                                                                                                                                                                 |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Whole editor                   | 0.75rem between groups 1–2 and the rest; 0.5rem between the rest                                                                                                                                                     |
| Number grids                   | 2 equal columns, 0.5rem gap                                                                                                                                                                                          |
| Labels                         | 0.625rem, medium, muted, help icon 0.625rem, 0.25rem gap                                                                                                                                                             |
| Number field                   | full width, 0.125rem below its label, rounded 0.5rem, secondary background, 0.625rem × 0.375rem padding, 0.75rem text, primary ring at 40% on focus                                                                  |
| Text areas                     | 0.25rem below the label, full width, rounded 0.5rem, secondary background, border-colored ring (ring color on focus), 0.75rem × 0.5rem padding, 0.75rem relaxed text                                                 |
| Custom Parameters hint / error | 0.25rem below, 0.5625rem; hint muted at 70%, error amber-500                                                                                                                                                         |
| Tag row                        | two equal columns and a 2rem square trash button (0.875rem icon), 0.375rem gaps, rows 0.375rem apart; fields like the number field, monospace                                                                        |
| Add tag                        | secondary background, border ring, 0.625rem medium muted text, 0.75rem plus icon, half opacity when disabled                                                                                                         |
| Option buttons                 | rounded 0.5rem, 0.5rem × 0.25rem padding, 0.625rem medium; unselected secondary background, muted text, border ring; selected tint at 15% with tint text and a 30% tint ring; 0.375rem gaps, 0.25rem below the label |

At 660px wide nothing may scroll sideways.

## Tests

The new module's tests use the recordings:

- **Helpers:** every recorded call in `recorded-helpers.json` gives the
  recorded result exactly (compare after the same encoding: `undefined`,
  `NaN`, `±Infinity` and `-0` are tagged; key order counts).
- **Fields:** for every scenario in `recorded-show.json`, `recorded-numbers.json`,
  `recorded-text.json`, `recorded-tags.json` and `recorded-choices.json`, the
  list of values handed to `onChange` at each step equals the recorded one
  (with a caller that hands each value back, and one that ignores it), and the
  shown state matches, except where decisions 2 and 4 change it (listed in one
  explicit table of intended differences, with a guard that every entry points
  at a real step and is really needed).
- **Callers:** `recorded-advanced-1.json`, `recorded-advanced-2.json` and
  `recorded-setup.json` replay `AdvancedParametersSection` and
  `SetupParametersPanel` with the new module: every chat metadata patch,
  connection default save and returned `chatParameters` equals the recording.
- Each decision has a test that fails without it.
- `AdvancedParametersSection.test.tsx` passes unchanged.

## Acceptance checks

- Real Chrome, a throwaway local server and data folder, at 1366x900 and
  660x900, light and dark: in the connection editor (Custom defaults on, edits,
  Save) and in the chat settings drawer's Advanced Parameters (Custom, edits,
  Save as Connection Default, Use Recommended), the stored connection
  `defaultParameters` and chat metadata after each recorded step equal what the
  old build stored (`recorded-chrome.json`).
- Screenshots of the same states look the same as the old build's apart from
  pixel noise; no sideways scroll at 660.
- A local copy of the Pi data: for every chat's `chatParameters`, every
  connection's `defaultParameters` and every prompt preset's parameters, the new
  helpers return exactly what the old ones return, in every combination the
  callers use; opening chat settings and the connection editor on them shows
  the same values and stores nothing.
- `src/shared/components/ui/GenerationParametersEditor.tsx` is gone and nothing
  imports it.

## Black-box recordings

Recorded by the spec writer on `main` at `081beeaca6`, before the old file is
deleted, with no real data and no model calls. Saved under
`src/shared/components/ui/generation-parameters/test-fixtures/` with a
`README.md` describing every field, one-line JSON files listed in
`.prettierignore`, each under ~1 MB.

1. `recorded-helpers.json`: the constants, and every helper over 99 raw
   inputs (strings, JSON text, non-objects, every enum value and near misses,
   odd numbers, tag lists of every shape, custom parameter shapes, extra keys),
   3 default sets and deep-merge cases, and 35 changed values per default set
   for the overrides helper.
2. `recorded-show.json`, `recorded-numbers.json`, `recorded-text.json`,
   `recorded-tags.json`, `recorded-choices.json`: the old fields in the test
   environment as a black box, with a caller that hands values back and one
   that ignores them: 9 starting values × 5 service tier lists (full
   snapshots), every number field with 26 typed texts, Enter, no-op blurs and
   outside changes while typing, prefill typing, 18 Custom Parameters texts on
   two starting values plus Ctrl/Cmd/plain Enter, repeated bad input and outside
   changes while focused, tag add to the limit, edits and removes, every option
   in every group clicked twice.
3. `recorded-advanced-1.json`, `recorded-advanced-2.json`,
   `recorded-setup.json`: the two chat-side callers rendered with the old
   module, recording every metadata patch, connection default save and returned
   `chatParameters`.
4. `recorded-chrome.json` and screenshots: see "Acceptance checks".
