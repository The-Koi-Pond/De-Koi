# Avatar crop widget recordings

Black-box recordings of the old avatar crop widget (before the #1580 rebuild),
made on `main` at `18febf9a25` by someone other than the builder. The spec is
`docs/provenance/avatar-crop.md`. Each JSON file is one line so the provenance
report doesn't count it as code.

## jsdom recordings

`recorded-init-1.json`, `recorded-init-2.json`, `recorded-drag-<size>.json` (7
files) and `recorded-special.json` were made in the repo's jsdom test
environment (`*.spec.tsx`), React 19 with `act()` around every step, no
StrictMode. 1,073 scenarios, 4,768 steps. Every file is
`{ format: 1, scenarios: [...] }`; a scenario is
`{ id, images, props, handsBack, start, steps }`.

**Numbers.** A number that isn't finite is written as `{ "$num": "NaN" }` (or
`"Infinity"`, `"-Infinity"`), everywhere.

**Fake pictures.** `images` maps a `src` to `{ state, w, h }`. Every
`HTMLImageElement` reads `complete`, `naturalWidth` and `naturalHeight` from
that map by its `src` attribute: `pending` (and unknown srcs) → not complete,
natural size 0; `loaded` → complete, natural `w` × `h`; `broken` → complete,
natural size 0.

**Pointer capture.** jsdom has none. `Element.prototype.setPointerCapture(id)`
remembers the element for that pointer id (and logs it);
`releasePointerCapture(id)` forgets it if it is that element (and logs it);
`hasPointerCapture(id)` answers from the same map. All three are installed by
the harness.

**The caller.** A component holds `{ src, alt, crop }` in state (starting from
`props`) and renders, inside an error boundary,
`<div data-rec="parent" onPointerDown onPointerMove onPointerUp onPointerCancel onClick onKeyDown>`
(each React handler logs `parent:<event type>`) around
`<AvatarCropWidget src alt crop onChange />`. `onChange(next)` appends `next`
to the step's `calls`; when `handsBack` is true it also sets the state's `crop`
to `next` (as the real callers do), when false it ignores it. A `document`
listener (bubbling) logs `document:<type>` for `pointerdown`, `pointermove`,
`pointerup`, `pointercancel`, `click` and `keydown`. The error boundary renders
`<div data-rec="crashed" />` after a render error.

**The widget root** is the first element child of `[data-rec="parent"]`.

**Parts.** The replay finds the square and corners by the test hooks
(`[data-crop="box"]`, `[data-crop="tl"]` …) in the new widget. The full view is
the element with `data-crop-full`; its picture is the `img` inside it and its
close button the `button` inside it.

**A scenario.** Mount the caller, take a step record (`start`), then run each
action inside `act()` and take a step record. A step record is:

- `calls`: the values handed to `onChange` during the step, in order;
- `captures` / `releases`: `{ on, id }` for each `setPointerCapture` /
  `releasePointerCapture` call, where `on` names the element (`box`, `tl`, `tr`,
  `bl`, `br`, else its tag name);
- `outer`: the `parent:` and `document:` log lines, in order;
- `events` (not on `start`): one `{ type, prevented }` per event the action
  dispatched (`prevented` = `defaultPrevented` after dispatch), or
  `{ type, prevented: false, missing: true }` when the target wasn't there;
- `action` (not on `start`);
- `shown`: the snapshot below.

**Actions** (`action.do`):

- `load` (`src`): set that picture to `loaded` and dispatch a non-bubbling
  `Event("load")` on every `img` in the document with that `src`.
- `loadSilent` (`src`): set it to `loaded`, no event.
- `break` (`src`): set it to `broken` and dispatch `Event("error")` on every
  `img` with that `src`.
- `rerender`: the caller sets its state to a shallow copy (same values, same
  `crop` object).
- `props` (`src?`, `alt?`, `crop?`): the caller merges the given keys into its
  state (a key present with any value, including `null`, is set).
- `down` (`on`, `x`, `y`, `id` = 1, `button` = 0): dispatch
  `PointerEvent("pointerdown", { bubbles, cancelable, clientX: x, clientY: y, pointerId: id, button, buttons: 1, isPrimary: id === 1 })`
  on that part.
- `move` (`x`, `y`, `id` = 1): `pointermove` (same init, `buttons: 1`) on the
  element that captured that pointer if it is still connected, else on the
  square.
- `moveOn` (`on`, `x`, `y`, `id` = 1): `pointermove` on that part, ignoring
  capture.
- `up` (`x` = 0, `y` = 0, `id` = 1) / `cancel` (`id` = 1): `pointerup`
  (`buttons: 0`) / `pointercancel` (at 0, 0) on the capturing element if
  connected, else the square; then the harness forgets that pointer's capture.
- `click` (`name`): a bubbling, cancelable `MouseEvent("click")` on: `Full image`
  / `Reset` → the widget's button with that trimmed text; `closeFull` → the full
  view's close button; `fullBackdrop` → the full view element; `fullImage` → the
  full view's picture; `box` → the square; `heading` → the `span` whose trimmed
  text is `Avatar Crop`.
- `key` (`key`): a bubbling, cancelable `KeyboardEvent("keydown", { key })` on
  `document.activeElement` when it isn't `body`, else on the widget root.
- `unmount`: unmount the root.

**The snapshot** (`shown`): `{ crashed: true }` after a render error,
`{ empty: true }` when there is no widget root (after unmount), else:

- `texts`: every non-empty text node under the widget root, in document order,
  whitespace collapsed and trimmed;
- `buttons`: every `button` under the widget root:
  `{ text (trimmed), title, type, label (aria-label) }` (missing attributes are
  `null`);
- `images`: every `img` under the widget root: `{ src, alt, draggable }`
  (attributes, `null` when missing); the stage picture first, then the preview,
  then the full view's picture when open;
- `stage`: `{ width, height }` inline style of the stage (the frame's parent);
- `frame`: `{ width, height, visibility }` inline style of the frame (the stage
  picture's parent; `visibility` `null` when unset), or `null`;
- `box`: `null` without a square, else its inline `{ left, top, width, height }`
  (only the ones set; `NaN` values aren't set) plus `corners` (how many of
  `tl`, `tr`, `bl`, `br` exist);
- `preview`: the preview picture's inline style values that are set, out of
  `position`, `width`, `height`, `left`, `top`, `maxWidth`, `maxHeight`,
  `objectFit`, `transform`;
- `full`: `null` when closed, else `{ src, alt, close: { text, type, label } }`.

A step whose `shown` is `{ crashed: true }` compares by presence only.

**Ids.** `init:<size>:<crop>` (230: every picture size with every crop shape;
a pan, a corner drag and Reset), `drag:<size>:<crop>:<script>:<back|ignore>`
(812: drag scripts on seven sizes, three crops, handing back or not),
specials `load:*`, `src:*`, `alt:*`, `crop:*`, `full:*`, `unmount:*` (31).

**Decisions.** The recordings show the old behavior that decisions 1 and 2 in
the spec change on purpose: the close button's `type` and `label`
(`null` → `"button"` / `"Close full image"`), and Escape with the full view
open (`full:keys`: the view stays open; after decision 2 it closes on Escape
and the event is default-prevented). Decision 3 was dropped (the icons were
already `aria-hidden`).

## Real Chrome

`recorded-chrome.json` = `{ format: 1, flows, shots }`, from the old build in
real Chrome against a local server with throwaway rows (characters "QA Crop
Portrait" 800 × 1200 with no crop, "QA Crop Landscape" 1200 × 800 with
`{ srcX: 0.4, srcY: 0.1, srcWidth: 0.5, srcHeight: 0.75 }`, "QA Crop Small"
100 × 50, persona "QA Crop Persona" 800 × 1200; generated grid pictures), at
1366 × 900 dark and 660 × 900 light (opened at 1366, then resized):

- `flows["<flow>-<width>-<scheme>"].log`: the stored crop after Save
  (`stored`), the square's and frame's screen boxes, the Save button state, the
  full view close paths and focus, the Tab order. `errors` = page errors (none).
- `shots["<state>-<width>-<scheme>"]`: the card's visible text and boxes for the
  36 screenshots (the PNGs are with the spec writer, not in the repo).
