# Color Picker: Behavior Spec

Status: agreed 2026-11-20 (decisions as recommended). Part of the code
provenance plan (`docs/code-provenance-plan.md`, tracked in #1580).

This spec describes the shared color picker: a labelled swatch button that
opens a panel for picking one solid color or, where allowed, a linear gradient.
It is the only input the builder uses. It describes behavior, not the old
implementation.

## Rules for the builder

Build from this spec, the recordings, the screenshots and the team-owned code
around it. Don't open, search, or read the history of the old implementation:

- `src/shared/components/ui/ColorPicker.tsx`

You may read every caller listed under "Callers". If this spec doesn't answer a
question, ask the spec writer.

**Safety.** The picker touches only the screen: it reads and writes no stored
data, sends no requests and uses no browser storage. It only hands a color
string to its caller's `onChange`. But the callers save that string as it is
(see "Callers"), so every handed-over value is a compatibility contract and must
stay exactly the same, character for character (see "What `onChange` gets").
Someone other than the builder records the old picker as a black box first (see
"Black-box recording plan"), the recordings become tests, and the builder sees
the recordings, never the old code. Where this text and a recording disagree,
the recording wins, except where a decision below changes the behavior on
purpose; tell the spec writer so the spec gets fixed.

## Scope

Lines not yet team-owned, from `node scripts/code-provenance.mjs --fast` at
`47964795aa`:

| File                                       | Not owned | Of lines |
| ------------------------------------------ | --------: | -------: |
| `src/shared/components/ui/ColorPicker.tsx` |       302 |      365 |

Replaced, then deleted in the same change. The new module lives in
`src/shared/components/ui/color-picker/` and exports `ColorPicker` with the same
name and props, so the callers only change their import path.

## Callers

Not rebuilt. Each saves exactly what `onChange` hands over.

| Caller                                                                                                                                                                        | Picker                         | Props beyond `value`/`onChange`/`label`                                                         | Where the value goes                                                                                                                                                                                                                                                                                                                                                                 |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/features/catalog/characters/components/CharacterColorsTab.tsx`                                                                                                           | "Name Display Color"           | `gradient`, `helpText`                                                                          | `updateExtension("nameColor", value)`, saved by the character editor's Save into the character's `extensions.nameColor`                                                                                                                                                                                                                                                              |
| same                                                                                                                                                                          | "Message Box Color"            | `helpText`                                                                                      | `extensions.boxColor`, same Save                                                                                                                                                                                                                                                                                                                                                     |
| `src/features/catalog/personas/components/editor/PersonaColorsTab.tsx`                                                                                                        | "Name Display Color"           | `gradient`, `helpText`                                                                          | `updateField("nameColor", value)`, saved by the persona editor into the persona's `nameColor`                                                                                                                                                                                                                                                                                        |
| same                                                                                                                                                                          | "Message Box Color"            | `helpText`                                                                                      | the persona's `boxColor`, same Save                                                                                                                                                                                                                                                                                                                                                  |
| `src/shared/components/ui/tracker-card-color-controls/PaintChannels.tsx` (Custom paint rows of the tracker card color controls, see `docs/provenance/tracker-card-colors.md`) | "Display", "Accent", "Surface" | `gradient`, `compact`, `helpText`, `emptyText`, `disabled`, `headerAction` (the channel switch) | the tracker card config's `nameColor`, `dialogueColor` or `boxColor` with `mode: "custom"`, cleaned by `cleanTrackerCardColorConfig` (an empty value is dropped). Shown in the character editor's Colors tab (full) and in tracker settings' Card colors (compact); each caller's Save stores it in `extensions.trackerCardColors` (character) or the persona's tracker card colors. |

Other code that must keep working:

- `src/features/catalog/characters/components/CharacterColorsTab.spec.tsx` finds
  the pickers by an accessible name starting with "<label>:".
- `src/shared/components/ui/tracker-card-color-controls/TrackerCardColorControls.spec.tsx`
  mocks the picker module by path; point the mock at the new path.

What the stored values mean elsewhere (unchanged, for context): name colors
whose text contains `gradient(` are drawn as gradient text, anything else as a
text color; box colors are a CSS background color; tracker paint follows
`src/shared/lib/tracker-card-colors.ts`.

## The shape

```ts
interface ColorPickerProps {
  value: string; // "" = no color set
  onChange: (value: string) => void;
  gradient?: boolean; // default false: allow switching to a gradient
  compact?: boolean; // default false: tighter spacing for narrow drawers
  label: string;
  helpText?: string;
  emptyText?: string; // default "No color set — uses default"
  disabled?: boolean; // default false
  headerAction?: ReactNode; // shown right after the label
}
```

## Reading `value`

- A value **is a gradient** when it starts with `linear-gradient`. Any other
  value (including `radial-gradient(...)`, `rgba(...)`, `red`, text with spaces)
  is a solid value.
- **Gradient stops** of a gradient value: take everything after the first comma
  inside `linear-gradient(` up to the final `)`, split it at every comma and trim
  each piece. A value that doesn't fit gives the default stops `#ff6b6b`,
  `#ffd93d`. Consequences kept on purpose (decision 4): a stop like
  `rgb(1, 2, 3)` becomes three pieces, and a gradient with no angle part
  (`linear-gradient(#fff, #000)`) loses its first color.
- **Gradient angle** of a gradient value: the whole number right after
  `linear-gradient(` when it is followed by `deg` (so `45.5deg` gives no angle,
  `-30deg` gives none, `to right` gives none). No angle keeps the angle the
  picker had (90 when it mounted).
- **Built gradient**: `linear-gradient(<angle>deg, <stop>, <stop>, ...)`, stops
  joined with a comma and one space, exactly.

The picker keeps a little state of its own: expanded or not, the mode (solid or
gradient), the gradient stops and the angle.

- On mount: mode is gradient if the value is a gradient, else solid; stops come
  from the value if it is a gradient, else the default stops; angle from the
  value, else 90.
- Whenever `value` changes: a gradient value sets mode gradient, the stops from
  the value, and the angle if the value has one; a non-empty solid value sets
  mode solid; `""` changes nothing (mode and stops stay).
- The picker never shows anything the caller didn't hand back, except its own
  stops and angle in gradient mode.

## What `onChange` gets

Every action hands over exactly one string, once. Nothing is handed over on
mount, on a `value` change, on expand or collapse, or while `disabled`.

| Action                                            | Hands over                                                                                                       |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Clear                                             | `""` (and the panel collapses)                                                                                   |
| Solid button, while in gradient mode              | the first gradient stop, unless it is empty (an emptied first stop switches to solid and hands over nothing)     |
| Gradient button, while in solid mode              | the built gradient from the current stops and angle                                                              |
| Solid or Gradient button that is already selected | nothing (decision 3)                                                                                             |
| Native color input (solid)                        | the input's value as the browser gives it (lower-case `#rrggbb`)                                                 |
| Hex / CSS text field                              | the field's whole text after each edit, unchecked (each keystroke hands over the text so far; `""` when emptied) |
| Solid preset swatch                               | that preset, exactly as listed below                                                                             |
| Gradient stop color input or stop text field      | the built gradient with that stop replaced (text unchecked)                                                      |
| Add (stop)                                        | the built gradient with `#ffffff` added at the end                                                               |
| Remove stop (only offered with 3+ stops)          | the built gradient without that stop                                                                             |
| Angle slider                                      | the built gradient with the new whole-number angle, 0–360                                                        |
| Gradient preset                                   | that preset string exactly as listed below (the picker also takes its stops and angle)                           |

Presets, in order. Solid (20): `#ff6b6b`, `#ee5a24`, `#f0932b`, `#ffd93d`,
`#6ab04c`, `#22a6b3`, `#4834d4`, `#6c5ce7`, `#e056fd`, `#fd79a8`, `#fdcb6e`,
`#00cec9`, `#2ed573`, `#1e90ff`, `#a29bfe`, `#ff7979`, `#badc58`, `#7ed6df`,
`#e17055`, `#d63031`.

Gradient (12):

1. `linear-gradient(90deg, #ff6b6b, #ffd93d)`
2. `linear-gradient(90deg, #a29bfe, #fd79a8)`
3. `linear-gradient(90deg, #6c5ce7, #00cec9)`
4. `linear-gradient(90deg, #e056fd, #4834d4)`
5. `linear-gradient(90deg, #f0932b, #ee5a24)`
6. `linear-gradient(90deg, #22a6b3, #6ab04c)`
7. `linear-gradient(90deg, #1e90ff, #a29bfe)`
8. `linear-gradient(90deg, #ff7979, #e056fd)`
9. `linear-gradient(135deg, #667eea, #764ba2)`
10. `linear-gradient(135deg, #f093fb, #f5576c)`
11. `linear-gradient(135deg, #4facfe, #00f2fe)`
12. `linear-gradient(135deg, #43e97b, #38f9d7)`

Stop and angle edits build from the picker's own stops and angle at that
moment, not from `value`. A caller that ignores `onChange` still sees the stops
and angle move in the panel.

## What shows

Top to bottom:

1. **Header row.** The `label` (one line, cut off with an ellipsis when too
   long), then `headerAction` right after it. On the right, while `value` isn't
   `""`: a **Clear** button (an X icon and the word "Clear"), disabled while
   `disabled`.
2. **Help text** (`helpText`, when given), small and faint.
3. **The swatch button**, full width. Its accessible name is
   "<label>: <value or emptyText>"; `aria-expanded` says whether the panel is
   open, and while open it points at the panel (`aria-controls`). It shows:
   - a swatch: a gradient value as a CSS `background`, another value as a CSS
     `background-color`, and no value as a small checkerboard;
   - the text: the value, or `emptyText` when there is none (one line, cut
     off);
   - a pipette icon at the end.

   Clicking it opens or closes the panel (not while `disabled`). It is disabled
   while `disabled`. The panel starts closed each time the picker mounts.

4. **The panel**, only while open.
   - With `gradient`: a two-button switch, **Solid** (pipette icon) and
     **Gradient** (sparkles icon); the current mode is highlighted.
   - **Solid mode**:
     - a "Pick color" row: a swatch (the value when it is a non-empty solid
       value, else `#6c5ce7`), the text "Pick color" and a pipette icon. The
       whole row is the browser's native color input (invisible, covering the
       row), named "Pick <label> color", showing the value when it is exactly
       `#` + 6 hex digits, else `#6c5ce7`;
     - a text field labelled "Hex / CSS", named "<label> hex or CSS color",
       placeholder "#hex or color name", in a monospace font, holding the value
       when it is a solid value, else empty;
     - "Presets" and the 20 solid swatches in a wrapping row, each named
       "Use <color> for <label>" with the color as its tooltip; the one equal to
       `value` is ringed and slightly larger.
   - **Gradient mode**:
     - a preview bar showing the built gradient from the picker's stops and
       angle;
     - "Color Stops" with an **Add** button (plus icon, "Add") on the right;
     - one row per stop: a small native color input named
       "<label> gradient stop <n> color" holding the stop, a monospace text
       field named "<label> gradient stop <n> CSS color" holding the stop, and,
       only while there are 3 or more stops, a trash button named
       "Remove <label> gradient stop <n>";
     - "Angle" with "<angle>°" on the right (monospace, fixed width), then a
       range slider named "Gradient angle", 0–360, step 1;
     - "Presets" and the 12 gradient swatches in a 4-column grid, each named
       "Use gradient preset <n> for <label>"; the one equal to `value` is ringed
       and slightly larger.

   In gradient mode the panel shows the gradient editor even when `gradient` is
   off (for example an imported gradient in a box color picker); there is then
   no switch.

## Disabled

With `disabled`: the swatch button, Clear, the switch, both color inputs, the
text fields, Add, Remove, the slider and every preset are disabled and hand
over nothing. A panel that was open when `disabled` turned on stays open (with
its controls disabled). The swatch button is drawn faded.

## Layout and text targets

Use the app's theme tokens for every color (`--border`, `--secondary`,
`--card`, `--background`, `--foreground`, `--muted-foreground`, `--primary`,
`--accent`, `--destructive`); selected options in the primary color. The
screenshots handed to the builder with the recordings (old build, real Chrome,
1366 and 660 wide, light and dark, closed and open in each mode, full and
compact; not committed) are the visual target. Sizes:

| Part                                    | Normal                                                                                                                                            | Compact                                                     |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Gap between header, help, button, panel | 0.5rem                                                                                                                                            | 0.375rem                                                    |
| Label                                   | 0.75rem, medium weight, muted                                                                                                                     | same                                                        |
| Clear                                   | 0.625rem, muted, red on hover, X icon 0.625rem                                                                                                    | same                                                        |
| Help text                               | 0.625rem, muted at 70%                                                                                                                            | same                                                        |
| Swatch button                           | rounded 0.75rem, padding 0.625rem, gap 0.75rem, swatch 2rem                                                                                       | rounded 0.5rem, padding 0.375rem, gap 0.5rem, swatch 1.5rem |
| Button text / pipette                   | 0.75rem muted / 0.8125rem                                                                                                                         | same                                                        |
| Open button                             | primary-tinted border and a faint primary ring                                                                                                    | same                                                        |
| Panel                                   | rounded 0.75rem, card background, border, padding 0.75rem, 0.75rem between groups                                                                 | padding 0.5rem, 0.5rem between groups                       |
| Switch                                  | secondary background, 0.125rem inset; buttons share the width, text 0.6875rem medium, icons 0.6875rem; selected = background color + small shadow | same                                                        |
| "Pick color" row                        | at least 2.75rem tall, rounded 0.5rem, secondary background, border; swatch 1.5rem; text 0.75rem medium; pipette 0.75rem                          | same                                                        |
| "Hex / CSS"                             | label 0.625rem medium muted; field 0.75rem monospace, rounded 0.5rem                                                                              | same                                                        |
| "Presets", "Color Stops", "Angle"       | 0.625rem muted                                                                                                                                    | same                                                        |
| Solid swatches                          | 1.5rem squares, rounded 0.375rem, 0.375rem apart                                                                                                  | same                                                        |
| Gradient preview bar                    | 2rem tall, full width, rounded 0.5rem                                                                                                             | same                                                        |
| Stop row                                | color input 1.75rem square; text field 0.6875rem monospace; trash icon 0.6875rem                                                                  | same                                                        |
| Angle value                             | 0.625rem monospace, tabular digits, at least 2.75rem wide, right-aligned                                                                          | same                                                        |
| Angle slider                            | 0.375rem tall, primary accent                                                                                                                     | same                                                        |
| Gradient swatches                       | 4 columns, 1.5rem tall, 0.375rem apart                                                                                                            | same                                                        |

At 660px wide nothing may scroll sideways. The panel opens with a short
slide-in, as before (motion only, may be skipped under reduced motion).

## Decisions

The rebuild keeps every handed-over value and every visible text as above.

1. **Selected options aren't announced.** The Solid/Gradient switch and the
   ringed preset show the selection by look only. Recommended: `aria-pressed`
   on both switch buttons and on every preset swatch (true for the selected
   one). Screen readers only.
2. **"Clear" doesn't say what it clears.** The character Colors tab shows five
   pickers, each with its own "Clear". Recommended: name it
   "Clear <label>" for screen readers; the visible word stays "Clear".
3. **Clicking the selected mode changed the color.** With `gradient` on, in
   solid mode, clicking **Solid** handed over the first gradient stop
   (`#ff6b6b` unless a gradient had been used), replacing the user's color; in
   gradient mode, clicking **Gradient** rewrote the value in the picker's own
   format (`to right` became `90deg`, spacing changed). Recommended: the
   selected mode button hands over nothing. Switching modes is unchanged.
4. **Not in this rebuild** (unchanged, possible follow-ups): stops with commas
   (`rgb(...)`, `hsl(...)`) split apart; a gradient without an angle loses its
   first color; only whole non-negative degrees are read; radial and conic
   gradients are treated as solid text; the text fields hand over every
   keystroke unchecked; Escape and clicking outside don't close the panel; the
   native inputs show `#6c5ce7` (solid) or the browser's fallback (stops) for
   values that aren't `#rrggbb`.

## Tests

The new module's tests use the recordings:

- For every recorded starting state (props and value): every shown text, every
  accessible name, `aria-expanded`, which parts show, which mode, swatch
  styles, input values, selected presets, disabled states match the recording.
- For every recorded action sequence (with a caller that hands each new value
  back, as the real callers do, and with one that ignores it), the list of
  values handed to `onChange` equals the recorded one, and the shown state after
  each step matches. Expected differences are only the decisions' (3: the
  selected-mode clicks hand over nothing).
- With `disabled`, no recorded action hands anything over.
- Each decision has a test.
- The existing `CharacterColorsTab.spec.tsx` and the tracker card color
  controls tests pass unchanged except for the mock's import path.

## Acceptance checks

- Real Chrome, character editor Colors tab (Name Display Color with gradients,
  Message Box Color) and tracker card Custom paint (character editor, full;
  tracker settings Card colors, compact), at 1366x900 and 660x900, light and
  dark: the recorded steps hand over the same values, and after Save the stored
  `extensions.nameColor`, `extensions.boxColor` and `trackerCardColors` equal
  what the old build stored for the same steps (the replay), except decision 3.
- Screenshots of the same states look the same as the old build's apart from
  decision-free pixel noise; no sideways scroll at 660.
- A local copy of the Pi data: every character and persona with a stored name,
  box or tracker paint color shows the same swatch, text and mode in the new
  build as in the old one, and opening, closing and Cancel/close without
  changes stores nothing.
- `src/shared/components/ui/ColorPicker.tsx` is gone and nothing imports it.

## Black-box recording plan

Recorded by someone other than the builder, on `main` before the old file is
deleted, with no real data and no model calls (these screens make none).
Saved under `src/shared/components/ui/color-picker/test-fixtures/`, one-line
JSON files listed in `.prettierignore`, each under ~1 MB.

1. **Component recordings** (`recorded-show.json`, `recorded-solid.json`,
   `recorded-gradient.json`): the old picker rendered in
   the test environment as a black box (props in, rendered page and `onChange`
   calls out). Starting values: `""`, a preset, upper-case hex, 3-digit hex,
   `red`, `rgba(...)`, spaces only, two- and three-stop gradients, a 135deg
   preset, `to right`, no angle, `rgb()` stops, `45.5deg`, `-30deg`,
   `radial-gradient(...)`; props `gradient` on/off, `compact` on/off,
   `disabled` on/off, custom `emptyText`, `helpText`, `headerAction`. For each:
   the closed and open state, then every action (expand, collapse, Clear, each
   mode button including the selected one, native color, typing into the
   Hex / CSS field key by key, every solid preset, each stop's color and text,
   Add, Remove at each position, angle 0/37/360, every gradient preset) and
   short sequences (preset then Add then angle; switch to gradient and back;
   Clear then reopen), each from the same start, both with a caller that hands
   the value back and one that ignores it; plus `value` changed from outside
   (gradient to `""`, gradient to solid, solid to gradient while open).
2. **Real Chrome** (`recorded-chrome.json`), headless Chrome with a throwaway
   local server and a throwaway character and persona: in the character Colors
   tab (Name Display Color, Message Box Color, tracker Custom paint) and in
   tracker settings' Card colors (compact Custom paint), at 1366x900 and
   660x900, light and dark, a fixed list of steps (open, solid preset, typed
   hex, native color, switch to gradient, Add, angle, gradient preset, Remove,
   Clear), recording after each step the picker's shown text, accessible
   names, swatch styles and the values handed over, and after Save the stored
   colors.
3. **Screenshots** (PNG, handed to the builder, not committed): the states
   listed under "Layout and text targets", from recording 2.

The builder gets the recordings, the screenshots and this spec. Recording 1
shows the old behavior that decisions 1–3 change on purpose.
