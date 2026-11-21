# Color picker recordings

Black-box recordings of the old color picker (before the #1580 rebuild), made on
`main` at `47964795aa` by someone other than the builder. The spec is
`docs/provenance/color-picker.md`. Each JSON file is one line so the provenance
report doesn't count it as code.

## jsdom recordings

`recorded-show.json`, `recorded-solid.json` and `recorded-gradient.json` were
made in the repo's jsdom test environment (`*.spec.tsx`), React 19 with
`act()`, no StrictMode.

Every file has:

- `props`: the prop sets, by key. `headerAction: "switch"` means the caller
  passed `<input type="checkbox" aria-label="<label> channel" defaultChecked />`.
- `values`: the starting values, by key.
- `scenarios`: `{ id, props, value, handsBack, start, steps }`.
  `recorded-show.json` also has `names`: every solid preset's
  `[aria-label, title]` and every gradient preset's `aria-label`, for the
  "Name Display Color" picker.

**The caller.** A small component holds `value` in state (starting from
`values[value]`) and renders the picker with `props[props]` and that value.
`onChange(next)` appends `next` to the step's `calls`; when `handsBack` is true
it also sets the state to `next` (as the real callers do), when false it ignores
it.

**A scenario.** Mount the caller, take a snapshot (`start`), then run each
step's `action` and take a snapshot (`shown`); `calls` are the values handed
over during that step, in order. Every scenario except the `outside:*-closed`
ones starts with a `toggle` step (opening the panel). `disable-while-open` and `disable-while-open-gradient`: mount `name`/`preset` (or
`name`/`grad3`), open the panel (not a step), then re-render the caller with the
same props plus `disabled: true` (the first step, `do: "rerender"`), then poke
the disabled controls (jsdom still delivers events to disabled inputs); they
have no `start`.

**Actions.**

| `do`                    | What the recorder did                                                                                                              |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `toggle`                | clicked the swatch button (the button with `aria-expanded`)                                                                        |
| `click` + `text`        | clicked the button whose trimmed text is exactly `text` (`Clear`, `Solid`, `Gradient`, `Add`)                                      |
| `click` + `name`        | clicked the element whose `aria-label` is `name`                                                                                   |
| `set` + `name`, `value` | set the input's value with the native `value` setter and dispatched a bubbling `input` event, in one `act()`                       |
| `type` + `name`, `text` | for each character: set the input's value to its current value plus that character and dispatched `input`, each in its own `act()` |
| `value` + `value`       | the caller set its state to `value` (a change from outside)                                                                        |

jsdom sanitizes `type="color"` values like a browser: lower case, and anything
that isn't `#rrggbb` reads back as `#000000`.

**A snapshot.**

- `texts`: every non-blank text node inside the caller's host element, in DOM
  order, trimmed; text nodes that follow each other under the same parent
  element are joined (`"90"` + `"°"` → `"90°"`).
- `trigger`: the swatch button. `name` = its `aria-label`; `expanded` = its
  `aria-expanded` attribute (`"true"`/`"false"`); `controlsPanel` = `null` when
  it has no `aria-controls`, else whether that id exists in the document;
  `disabled` (only when true); `swatch` = the swatch element's inline style:
  `{ checker: true }` for the checkerboard, `{ background }` when a gradient was
  set as the `background` (the value is what jsdom reports as
  `style.backgroundImage`, colors normalized to `rgb()`), `{ backgroundColor }`
  for a color, `{}` when no valid color was set.
- `clear`: `null` when there is no Clear button, else `{}` or
  `{ disabled: true }`.

Only while open:

- `switch`: `null` without the Solid/Gradient switch, else
  `{ solid: { selected?, disabled? }, gradient: { selected?, disabled? } }`.
- `mode`: `"solid"` or `"gradient"`.
- `solid`: `pickSwatch` (the "Pick color" row's swatch style, same rules),
  `native` (`{ value, disabled? }` of the input named "Pick <label> color"),
  `field` (`{ value, disabled?, placeholder }` of "<label> hex or CSS color"),
  `presets` (`count`, `selected`: indexes of the selected solid presets,
  `disabled`: true when all are disabled).
- `gradient`: `preview` (the preview bar's `style.background` as jsdom reports
  it), `add` (`{ disabled? }`), `stops` (per stop: `color` and `text` inputs as
  `{ value, disabled? }`, `remove`: `null` or `{ disabled? }`), `angle`
  (`{ value, disabled?, min, max }` of "Gradient angle"), `presets` (as above,
  for the 12 gradient presets).

Selection was visual only in the old picker (`selected` above was read from its
highlight); the rebuild exposes it as `aria-pressed` (decision 1).

## Real Chrome recording

`recorded-chrome.json`: headless Chrome against a throwaway local server, the
old build, a throwaway character, in the character editor's Colors tab, at
1366x900 and 660x900, light and dark. Flows (`flow`):

- `name` ("Name Display Color", no stored color): open, solid preset
  `#e056fd`, type `#123` into Hex / CSS (after emptying it), native color
  `#2a4b6c`, Gradient, Add, angle 120, type `#0f0` into stop 2 (after emptying
  it), remove stop 1, Save, gradient preset 9, Save, Solid, Save, Clear, Save.
- `box` ("Message Box Color", stored `rgba(255, 255, 255, 0.08)`): open, preset
  `#22a6b3`, type `rgba(0,0,0,.5)`, Save, close, reopen.
- `paint` (tracker card Custom paint "Display", stored
  `{ mode: "custom", nameColor: "linear-gradient(90deg, #ff6b6b, #ffd93d)" }`):
  open, angle 45, stop 1 color `#336699`, Save, Solid, preset `#6ab04c`, Save,
  Clear, Save.

Each step records `shown` (the picker's accessible name, `expanded`, its texts,
the swatch's computed style, the inputs' values, the stops, the angle, the
mode) and, after a Save, `stored`: the character's stored `nameColor`,
`boxColor` and `trackerCardColors`.

Note: in `paint`, Clear followed by Save keeps the old stored color. That is
the tracker card config and the editor's save, not the picker (the picker hands
over `""`); it is outside this rebuild.
