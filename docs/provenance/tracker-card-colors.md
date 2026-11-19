# Tracker Card Color Controls: Behavior Spec

Status: agreed 2026-11-19 (decisions as recommended). Part of the code
provenance plan (`docs/code-provenance-plan.md`, tracked in #1580).

This spec describes the tracker card color controls: the panel that picks where
a character's or persona's tracker card gets its colors (theme default, the
chat colors, or custom paint), the portrait stage background, the card's finish
(material, glow, contrast) and how strongly each paint channel shows. It appears
in two places: the character editor's Colors tab (full size) and the tracker
settings' **Card colors** section (compact). It is the only input the builder
uses. It describes behavior, not the old implementation.

## Rules for the builder

Build from this spec, the recordings and the team-owned code around it. Don't
open, search, or read the history of the old implementation:

- `src/shared/components/ui/TrackerCardColorControls.tsx`

You may read every interface listed under "Neighbors". `ColorPicker.tsx` is a
shared neighbor that isn't fully team-owned yet: import it and read its props,
but don't copy its markup or body. If this spec doesn't answer a question, ask
the spec writer.

**Safety.** The controls touch only the screen: they read and write no stored
data and send no requests. But what they hand to `onChange` is what the callers
save into the character's or persona's `trackerCardColors`, so every handed-over
value is a compatibility contract and must stay exactly the same (see "What
`onChange` gets"). Someone other than the builder records the old controls as a
black box first (see "Black-box recording plan"), the recordings become tests,
and the builder sees the recordings, never the old code. Where this text and a
recording disagree, the recording wins, except where a decision below changes
the behavior on purpose; tell the spec writer so the spec gets fixed.

## Scope

Lines not yet team-owned, from `node scripts/code-provenance.mjs --fast` at
`8647899e6b`:

| File                                                    | Not owned | Of lines |
| ------------------------------------------------------- | --------: | -------: |
| `src/shared/components/ui/TrackerCardColorControls.tsx` |       676 |      873 |

Replaced, then deleted in the same change. The new module lives in
`src/shared/components/ui/tracker-card-color-controls/` and exports
`TrackerCardColorControls` and the type `TrackerCardColorEntityLabel` with the
same names and props, so the callers only change their import path.

### Neighbors (not rebuilt)

- `src/features/catalog/characters/components/CharacterColorsTab.tsx` (full
  variant). Passes the character's stored `extensions.trackerCardColors` as
  `value` (an object, a JSON string, or nothing), saves what `onChange` hands
  over into `extensions.trackerCardColors` (the form's Save writes it), and
  passes `chatColors = { nameColor, boxColor }` from the same tab's chat color
  pickers, with `entityLabel="Character"`.
- `src/features/runtime/tracker/components/TrackerCardColorSettings.tsx`
  (compact variant). Picks a target (the chat's persona or a present character),
  passes its draft config as `value`, `onChange` updates the draft (a preview
  until Save), `chatColors` from that target, `entityLabel` from the target,
  `disabled` while saving.
- `src/features/runtime/tracker/lib/tracker-card-color-manager.ts` imports only
  the type `TrackerCardColorEntityLabel`.
- `src/shared/lib/tracker-card-colors.ts` (team-owned helpers): reading,
  cleaning and defaults. Use these; don't re-implement them. The names this spec
  uses: `parseTrackerCardColorConfig`, `cleanTrackerCardColorConfig`,
  `normalizeTrackerCardColorMode`, `getTrackerCardFinish`,
  `getTrackerCardPaintEnabled`, `getTrackerCardPaintOpacity`,
  `getTrackerCardPortraitStageBackground`, and the types
  `TrackerCardColorConfig`, `TrackerCardPaintColors`, `TrackerCardFinish`,
  `TrackerCardPaintEnabled`, `TrackerCardPaintOpacity`.
- `src/shared/components/ui/ColorPicker.tsx` (props: `value`, `onChange`,
  `gradient`, `compact`, `label`, `helpText`, `emptyText`, `disabled`,
  `headerAction`).
- `src/shared/lib/utils.ts` (`cn`), `lucide-react` icons.

## The shape

```ts
export type TrackerCardColorEntityLabel = "Character" | "Persona";

interface TrackerCardColorControlsProps {
  value: TrackerCardColorConfig | string | null | undefined;
  onChange: (value: TrackerCardColorConfig) => void;
  chatColors: TrackerCardPaintColors;
  entityLabel: TrackerCardColorEntityLabel;
  variant?: "full" | "compact"; // default "full"
  disabled?: boolean; // default false
}
```

## Reading `value`

On every render the controls work from a **current config**:

- a string `value` goes through `parseTrackerCardColorConfig` (bad JSON or a
  non-object gives `{ mode: "chat" }`);
- anything else goes through `cleanTrackerCardColorConfig` (nothing gives
  `{ mode: "chat" }`; a legacy `tintIntensity` without `materialBrightness`
  becomes a lower Surface strength and disappears).

From the current config, the helpers give: the **mode**
(`normalizeTrackerCardColorMode`), the **finish** (`getTrackerCardFinish(config,
mode)`: material, glow and contrast, each 0–100, with per-mode defaults: Default
50/25/55, Chat colors and Custom 50/45/55), the **channels on/off**
(`getTrackerCardPaintEnabled`, all on unless stored `false`), the **strengths**
(`getTrackerCardPaintOpacity`, each 0–100, default 100) and the **stage**
(`getTrackerCardPortraitStageBackground`, default `ambient`).

The controls keep no copy of the config: they show whatever `value` says on the
next render. A caller that ignores `onChange` sees no change on screen.

**Effective colors** (for the swatches and the "has paint" rules): Custom uses
the current config's `nameColor`, `dialogueColor`, `boxColor`; Chat colors uses
`chatColors`; Default uses none. A `chatColors` value that isn't a string (a
number, object or array from an imported card) counts as no color, here and
when Custom starts from the chat colors (follow-up after the rebuild; before it,
such a value crashed the panel).

## What `onChange` gets

Every change hands over exactly one new config, built from the **current
config** (as read above, not the raw `value`) with the change applied, then
passed through `cleanTrackerCardColorConfig`. Nothing else is called, and
nothing is handed over on render, on collapse or on expand.

| Action                                | Change applied before cleaning                                                                                                                                                                             |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Source button (also the selected one) | `mode` = that mode. For **Custom** only, also `nameColor`, `dialogueColor`, `boxColor` each = the config's own color if non-empty, else `chatColors`' color if non-empty, else `""` (cleaning drops `""`). |
| Stage button (also the selected one)  | `portraitStageBackground` = that value (cleaning drops `ambient`, the default).                                                                                                                            |
| Finish preset (also the selected one) | Soft: tint 100, material 54, glow 24, contrast 58. Crisp: 100/50/46/64. Vivid: 100/44/82/86. (`tintIntensity` is applied too; cleaning drops it.)                                                          |
| Finish slider                         | `materialBrightness`, `glowIntensity` or `contrastIntensity` = the slider's number. One hand-over per input event.                                                                                         |
| Strength slider                       | `nameColorOpacity` (Display), `dialogueColorOpacity` (Accent) or `boxColorOpacity` (Surface) = the slider's number. One hand-over per input event.                                                         |
| Channel toggle                        | `displayEnabled`, `accentEnabled` or `surfaceEnabled` = the new checked state (cleaning keeps only `false`).                                                                                               |
| Color picker (Custom paint)           | `mode` = `custom` and `nameColor`, `dialogueColor` or `boxColor` = the picker's value (an empty value is dropped by cleaning).                                                                             |

Clicking the selected option still hands over a config (the same values).
Sliders hand over whole numbers 0–100. Fields the controls don't edit
(`portraitFocusX`, `portraitFocusY`, `portraitZoom`, and any color in Chat or
Default mode) pass through as cleaning leaves them.

## Header

A full-width button at the top that collapses and expands the body. It starts
expanded each time the controls mount; collapsed or not isn't stored.
`aria-expanded` is true while expanded; its tooltip is "Collapse tracker card
colors" while expanded and "Expand tracker card colors" while collapsed. The
header stays usable while `disabled`.

It shows:

- the title: full **"<entityLabel> Tracker Card"**, compact **"<entityLabel>
  card"**;
- the summary line: **"<mode label>, <stage label in lower case> stage, finish
  M/G/C <material>/<glow>/<contrast>."**, e.g. "Chat colors, ambient stage,
  finish M/G/C 50/45/55." Mode labels: Default, Chat colors, Custom. Stage
  labels: Ambient, Spotlight, Haze (value `soft`), Plain;
- three swatches, Display, Accent, Surface in that order (hidden from screen
  readers), each showing its effective color: a value containing `gradient(` is
  used as a CSS `background`, any other non-empty value as `background-color`,
  and no value shows a small checkerboard. A spaces-only value counts as a
  value here (an invalid color, so the swatch shows neither a color nor the
  checkerboard). A swatch whose channel is off is dimmed (35% opacity);
- a chevron that points down when expanded and right when collapsed.

## Body

Shown only while expanded. Groups, top to bottom:

1. **Source**: three buttons, Default, Chat colors, Custom, each with its icon
   (palette, speech bubble, sparkles); the selected one is highlighted and
   shows a check mark instead of its icon.
2. **Stage**: four buttons, Ambient (layers icon, tooltip "Balanced color
   wash"), Spotlight (circle, "Focused center glow"), Haze (picture, "Diffused
   portrait glow"), Plain (square, "Quiet neutral stage"); selected as above.
3. **Finish**: three preset buttons, Soft ("Brighter material with gentle glow
   and mild separation"), Crisp ("Neutral material with clearer edges and
   medium glow"), Vivid ("Darker material with strong glow and high
   contrast"). A preset is highlighted when material, glow and contrast all
   equal its values. Then three sliders, 0–100, each labelled with its name and
   showing "<value>%":
   - Material, "Brightness of neutral and Surface card material";
   - Glow, "Light from edges, portrait, stats, and nameplate";
   - Contrast, "Text readability and neutral panel separation".
4. **Source strength** (Chat colors mode only) or **Custom paint** (Custom mode
   only); nothing in Default mode. Both have a heading and, on the right, the
   **strength summary** "<Display>/<Accent>/<Surface>", where each part is the
   strength number or `off` when that channel is off (e.g. `100/off/80`). Then
   one row per channel, Display, Accent, Surface:

   | Channel | Color           | Strength field         | Tooltip                                             | Empty text                        |
   | ------- | --------------- | ---------------------- | --------------------------------------------------- | --------------------------------- |
   | Display | `nameColor`     | `nameColorOpacity`     | "Names, readable field tint, and identity emphasis" | "No display color set"            |
   | Accent  | `dialogueColor` | `dialogueColorOpacity` | "Borders, icons, highlights, buttons, and glow"     | "No accent color set"             |
   | Surface | `boxColor`      | `boxColorOpacity`      | "Card body, panels, shelves, and field material"    | "No surface color - neutral card" |

   **Has paint**, from the colors that row looks at (Chat colors: the effective
   colors, i.e. `chatColors`; Custom: the current config's own colors). A color
   counts when it has non-space text. Surface has paint when its own color does;
   Display and Accent each have paint when **either** the Display or the Accent
   color does.

   Each row has:

   - a **channel toggle**: a small switch (a visually hidden checkbox named
     "<Channel> channel", tooltip "Disable <Channel>" when on, "Enable
     <Channel>" when off), checked when the channel is on, disabled when the
     row has no paint or the controls are disabled;
   - a **strength slider** 0–100, disabled unless the channel is on and the row
     has paint (and the controls aren't disabled); while the channel is off or
     the row has no paint it shows 0 (the stored strength doesn't change); when
     only the whole panel is disabled it shows the real strength;
   - a **value label**: `off` when the channel is off, else `none` when the row
     has no paint, else "<strength>%".

   **Source strength** rows: the channel name, the toggle, the slider and the
   value label. The row's tooltip is the channel tooltip while on, and
   "<Channel> channel is off." while off.

   **Custom paint** rows: a `ColorPicker` with `gradient`, `compact`, `label` =
   the channel name, `emptyText` and `helpText` from the table, `value` = the
   config's color or `""`, `disabled`, and the channel toggle as its
   `headerAction`; then "<Channel> strength" with the value label, and the
   slider. A row whose channel is off is drawn fainter.

Every slider's accessible name is "<Label>: <tooltip>" (e.g. "Glow: Light from
edges, portrait, stats, and nameplate", "Surface: Card body, panels, shelves,
and field material"), and its tooltip is the tooltip.

## Disabled

With `disabled`, the whole panel is drawn at 75% opacity; every Source, Stage
and Finish button, slider and toggle is disabled; the Custom paint rows ignore
pointer input and their color pickers get `disabled`. Nothing is handed to
`onChange`. The header still collapses and expands.

## Layout

Both variants are a rounded card with the app's card background and border
tokens, and use the theme tokens for every color (selected options in the
primary color).

- **Full** (character editor): roomy. On medium screens and wider, Source and
  Stage sit side by side, and Finish presets sit beside the three finish
  sliders; the sliders sit in three columns from small screens up; the
  Stage buttons are two columns on phones, four from small screens up; strength
  rows are three columns from small screens up (Source strength) or large
  screens up (Custom paint).
- **Compact** (tracker settings, a narrow drawer): tighter spacing and smaller
  text; every group is one column; each finish slider is one row (label,
  slider, value); the four Stage buttons stay in one row; Source strength rows
  are one row each (name and toggle, slider, value).

The exact sizes needn't match the old build; the recordings record structure,
text, states and handed-over values, not pixels.

## Removed

- The fallback labels for an unknown mode or stage: the helpers always return a
  known one.

## Decisions

The rebuild keeps every handed-over config and every visible text exactly as
above. These change only what screen readers get:

1. **Selected options aren't announced.** The Source, Stage and Finish buttons
   show the selection only by color and a check mark. Recommended: give each
   `aria-pressed` (true for the selected one). Screen only.
2. **The title isn't a heading for screen readers.** It sits inside the
   collapse button.
   Recommended: keep it as it is (moving it would change the layout); not in
   this rebuild.
3. **Not in this rebuild** (unchanged, possible follow-ups): the strength
   slider showing 0 while disabled (the stored strength is kept, which is what
   a user wants back when they turn the channel on), a toggle that can't be
   turned back on when its channel has no paint, and the sliders handing over
   one config per input event (both callers treat it as a preview until Save).

## Tests

The new module's tests use the recordings:

- For every recorded starting state (value, chat colors, variant, disabled):
  the header title, summary line, swatch styles and dimming, `aria-expanded`,
  which body groups show, which options are selected, every slider's value and
  disabled state, every toggle's checked and disabled state, every value label
  and strength summary match the recording.
- For every recorded action from every recorded starting state, the single
  config handed to `onChange` deep-equals the recorded one; collapsing and
  expanding hand over nothing.
- With `disabled`, no recorded action hands anything over, and the header still
  collapses.
- Decision 1 has a test.

## Acceptance checks

- Real Chrome, character editor Colors tab, at desktop size and 660px wide:
  every Source, Stage and Finish choice, slider and toggle works, the summary
  and swatches follow, and after Save the stored `extensions.trackerCardColors`
  equals what the old build stored for the same steps (the replay).
- Real Chrome, tracker settings Card colors with a persona target: the same
  steps preview, Save stores the same config as the old build, Revert restores.
- A local copy of the Pi data: every character and persona with stored
  `trackerCardColors` shows the same title, summary, swatches, selections and
  slider values in the new build as in the old one.
- `TrackerCardColorControls.tsx` is gone and nothing imports it.

## Black-box recording plan

Recorded by someone other than the builder, on `main` before the old file is
deleted, with no real data and no model calls (these screens make none; the
local server has no connection set up). Saved under
`src/shared/components/ui/tracker-card-color-controls/test-fixtures/`.

1. **Component recordings** (`recorded-controls.json`): the old component
   rendered in the test environment as a black box (props in, rendered page and
   `onChange` calls out), for about 30 starting states: no value, `""`, bad
   JSON, a JSON string, each mode, each stage, finish values at 0, 50, 100 and
   each preset, legacy `tintIntensity` with and without `materialBrightness`,
   channels off, strengths at 0 and 100, out-of-range and non-number strengths,
   whitespace-only colors, gradients, only a Display color, only an Accent
   color, only a Surface color, chat colors empty and set, both variants,
   `disabled` on and off. For each: the rendered state (as listed under
   "Tests"), then every action (each Source, Stage and Finish button, each
   finish and strength slider set to 0, 37 and 100, each toggle, each color
   picker set to a color, a gradient and empty, collapse/expand) with the
   config handed over, starting from the same state each time.
2. **Real Chrome** (`recorded-chrome.json`), headless Chrome with a local
   server and a throwaway character, persona and chat: in the Colors tab and in
   tracker settings' Card colors, at 1366x900 and 660x900, a fixed list of
   steps (switch source, pick stage, pick a preset, move sliders, turn channels
   off and on, set custom colors), recording after each step the header text,
   summary, selections and slider values, and after Save the stored
   `trackerCardColors`.

The builder gets the recordings and this spec. Recording 1 shows the old
behavior that decision 1 changes on purpose (no `aria-pressed`).
