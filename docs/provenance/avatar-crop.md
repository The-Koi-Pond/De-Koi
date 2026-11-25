# Avatar Crop Widget: Behavior Spec

Status: agreed 2026-11-25 (decisions as recommended). Part of the code
provenance plan (`docs/code-provenance-plan.md`, tracked in #1580).

This spec describes the **avatar crop widget**: the "Avatar Crop" card at the
top of the character editor's Metadata tab and the persona editor's Description
tab, where you drag a square over the avatar picture to choose which part shows
in round avatars. It is the only input the builder uses. It describes behavior,
not the old implementation.

## Rules for the builder

Build from this spec, the recordings, the screenshots and the team-owned code
around it. Don't open, search, or read the history of the old implementation:

- `src/shared/components/ui/AvatarCropWidget.tsx`

You may read every file listed under "Callers" and "Neighbors". If this spec
doesn't answer a question, ask the spec writer.

**Safety.** The widget touches only the screen: it reads and writes no stored
data, sends no requests and makes no model calls. It hands a crop object to its
caller's `onChange`, and both callers save that object as it is when the user
presses Save (see "Callers"). So every handed-over crop is a compatibility
contract: the same numbers, computed the same way, in the same key order, at
the same moments. Opening the editor must hand over nothing (that would mark
the editor unsaved). Someone other than the builder recorded the old widget as
a black box first (see "Black-box recording plan"); the recordings become
tests, and the builder sees the recordings, never the old code. Where this text
and a recording disagree, the recording wins, except where a decision below
changes the behavior on purpose; tell the spec writer so the spec gets fixed.

## Scope

Lines not yet team-owned, from `node scripts/code-provenance.mjs --fast` at
`18febf9a25`:

| File                                            | Not owned | Of lines |
| ----------------------------------------------- | --------: | -------: |
| `src/shared/components/ui/AvatarCropWidget.tsx` |       327 |      345 |

Replaced, then deleted in the same change. The new module lives in
`src/shared/components/ui/avatar-crop/` and exports `AvatarCropWidget` and the
`AvatarCropWidgetProps` type with the same props:

```ts
{
  src: string;                                   // picture URL or data URL
  alt: string;
  crop: AvatarCrop | LegacyAvatarCrop | null;    // the saved crop, as the caller has it
  onChange: (next: AvatarCrop) => void;
}
```

The spec writer deletes the old file and points both callers at
`./avatar-crop` (the builder doesn't open the old file).

## Callers

Not rebuilt. Each renders the widget only while it has an avatar picture.

| Caller                                                                      | `crop` it passes                                                                                  | What it does with `onChange`                                                                                  |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `src/features/catalog/characters/components/CharacterMetadataTab.tsx`       | `formData.extensions.avatarCrop ?? null`, **unparsed** (whatever the stored character JSON holds) | `updateExtension("avatarCrop", next)`; the editor's Save stores it in the character's `extensions.avatarCrop` |
| `src/features/catalog/personas/components/editor/PersonaDescriptionTab.tsx` | `formData.avatarCrop`, already parsed by `persona-editor-model.ts` (a valid crop, legacy or null) | `updateField("avatarCrop", next)`; the persona editor's Save stores it                                        |

Both callers hand the new value straight back as `crop` on the next render.

### Neighbors (not rebuilt)

- `src/shared/lib/utils.ts`: the `AvatarCrop` and `LegacyAvatarCrop` types,
  `isLegacyAvatarCrop(crop)` (true when the object has a `zoom` key, checked with
  `"zoom" in crop`) and `getAvatarCropStyle(crop)` (the inline style that shows a
  crop in a round avatar; `{}` for no crop).
- `src/shared/hooks/use-escape-overlay.ts` (for decision 2):
  `useEscapeOverlay(onEscape, active?)` puts the caller on the shared overlay
  stack; Escape goes to the topmost active overlay only.
- `lucide-react` icons, `src/shared/lib/utils.ts` (`cn`).

## Words used here

- **Display size** (`w` × `h`): the picture fitted inside 360 × 360 px, never
  enlarged. With the picture's natural size `nw` × `nh` (a natural size of 0
  counts as 1), `scale = min(360 / nw, 360 / nh, 1)`, `w = nw * scale`,
  `h = nh * scale`. No rounding anywhere.
- **The square**: `{ x, y, size }` in display px, top-left corner and side.
- `clamp(v, lo, hi)` is `max(lo, min(hi, v))`. So a `NaN` stays `NaN`, and when
  `lo > hi` the result is `lo`.
- **A current crop**: a `crop` prop that is truthy and not legacy (no `zoom`
  key). Any object without `zoom` counts, even `{}` or `[]`.
- **The default square**: `size = min(w, h)`, `x = (w - size) / 2`,
  `y = (h - size) / 2`.
- **Handing over** the square: calling `onChange` with exactly
  `{ srcX: x / w, srcY: y / h, srcWidth: size / w, srcHeight: size / h }`
  (this key order, these divisions, nothing else).

## The card

Top to bottom:

1. A header row: **Avatar Crop** (with a crop icon) on the left; on the right
   two buttons, **Full image** (`title="Open full image"`, expand icon) and
   **Reset** (`title="Reset to centered max-square crop"`, rotate icon), both
   `type="button"`.
2. The hint: `Drag the square to pan, the corners to resize. The avatar shows
exactly the region inside the square.`
3. A row (stacked and centered below the `md` breakpoint) with:
   - **The stage**: always 360 × 360 px. Inside it, centered, **the frame**
     holding the picture (`draggable="false"`, stretched to the frame) and, once
     ready, the square. Before the widget is ready the frame is 360 × 360 and
     hidden (`visibility: hidden`); after, it is exactly `w` × `h` px and
     visible.
   - **The preview**: the label **Preview** over a 96 px circle showing the
     picture with `getAvatarCropStyle(previewCrop)` as its inline style (see
     "Preview").
4. While open, the full image view (see "Full image").

The picture is shown at `src` with `alt` in the stage, the preview and the full
view. An empty `src` renders no `src` attribute.

## Getting ready

The widget is **ready** once it knows the display size. It becomes ready:

- when the stage picture fires `load` (a natural size of 0 then counts as 1, so
  a 0 × 0 picture gives a 1 × 1 display); or
- after any render where the stage picture is already complete with a natural
  width above 0 and the widget isn't ready yet (a cached picture whose `load`
  was missed).

A picture that fails (`error`) or never loads leaves the widget not ready: the
frame stays hidden, there is no square, Reset does nothing, the preview has no
crop style. Full image still opens.

When it becomes ready the square is set from the `crop` prop (see
"Following the crop prop"). **Getting ready hands over nothing.**

When `src` changes, the widget is no longer ready (frame hidden, square gone)
until the new picture is ready as above. The stage picture is replaced, so the
new picture's `load` counts even when it is cached. A drag in progress is
**not** ended by a `src` change (see "Recorded details").

## Following the crop prop

Whenever the widget is ready and **no drag is in progress**, and either the
display size or the `crop` prop changes (by identity: the same values in a new
object count as a change; a re-render with the same object doesn't), the square
is set to:

- for a current crop: `size = clamp(crop.srcWidth * w, 24, min(w, h))`,
  `x = clamp(crop.srcX * w, 0, w - size)`, `y = clamp(crop.srcY * h, 0, h - size)`
  (`srcHeight` is ignored; text numbers are used as numbers the way `*` does);
- otherwise (null or legacy): the default square.

This hands over nothing. A `crop` change during a drag is ignored, and it is not
applied after the drag ends either (only the next change or a new display size
applies it).

The square is shown as an absolutely positioned box at `left: x`, `top: y`,
`width: size`, `height: size` (px numbers as computed, no rounding), with four
corner handles.

## Dragging

The square and each of its four corners can be pressed (`pointerdown`, any
pointer, any mouse button). Pressing a corner starts a **corner drag** for that
corner and not a pan; pressing the square elsewhere starts a **pan**. On a press
(only while ready):

- the press event's default is prevented and it doesn't reach the caller (it
  stops at the widget);
- the pressed element captures the pointer;
- the drag remembers the press point (`clientX`, `clientY`), which part was
  pressed and the square at that moment (the **start square**).

Each later `pointermove` that reaches the square or a corner while a drag is in
progress (from any pointer, not only the one that pressed) works out the new
square from the start square and `dx = clientX - pressX`, `dy = clientY - pressY`,
shows it, and hands it over. A move that reaches a corner hands the same crop
over **twice**; a move that reaches the square elsewhere hands it over once.
Moves reach the caller.

`pointerup` or `pointercancel` on the square or a corner ends the drag (from any
pointer). Moves with no drag in progress do nothing. A new press during a drag
starts a new drag from the current square.

**Pan:** `size = start.size`, `x = clamp(start.x + dx, 0, w - start.size)`,
`y = clamp(start.y + dy, 0, h - start.size)`.

**Corner drags** keep the square square and keep the opposite corner still. With
the start square's top-left `(L, T)` and bottom-right `(R, B) = (L + s, T + s)`:

| Corner | Pointer point `(px, py)` | `size`                                              | New square                     |
| ------ | ------------------------ | --------------------------------------------------- | ------------------------------ |
| `br`   | `(R + dx, B + dy)`       | `clamp(min(px - L, py - T), 24, min(w - L, h - T))` | `x = L`, `y = T`               |
| `tl`   | `(L + dx, T + dy)`       | `clamp(min(R - px, B - py), 24, min(R, B))`         | `x = R - size`, `y = B - size` |
| `tr`   | `(R + dx, T + dy)`       | `clamp(min(px - L, B - py), 24, min(w - L, B))`     | `x = L`, `y = B - size`        |
| `bl`   | `(L + dx, B + dy)`       | `clamp(min(R - px, py - T), 24, min(R, h - T))`     | `x = R - size`, `y = T`        |

(Because `clamp` puts the minimum last, a display side under 24 px lets the
square grow to 24 px, past the picture.)

## Reset

When ready, Reset sets the default square and hands it over. When not ready it
does nothing. During a drag it doesn't end the drag, so the next move goes back
to working from the start square.

## Preview

`previewCrop` is:

- the `crop` prop itself when it is legacy;
- else, when ready, `{ srcX: x / w, srcY: y / h, srcWidth: size / w, srcHeight: size / h }`
  from the square shown now;
- else `null`.

So the preview follows the square live, but a legacy crop keeps the preview on
the legacy look until the caller passes a current crop.

## Full image

**Full image** opens a view over the whole app: a fixed, full-screen black/80
backdrop above everything (`z-index: 100`), with the picture centered (at most
85 % of the viewport high and 90 % wide, kept whole, rounded, with a big shadow)
and a close button in the top-right corner (an X icon on a dark rounded square).
It is rendered inside the card. A click anywhere in the view, including on the
picture or the close button, closes it. Nothing is handed over. The square can
still be dragged while it is open (it is covered, so only through events that
reach it). Today Escape and other keys do nothing to it (decision 2 changes
Escape).

## Crashes

A `crop` prop that is a non-empty string, a number or another non-object truthy
value makes the widget throw while rendering (checking for a `zoom` key throws).
The recordings have the presence of the crash. The character editor passes the
stored value unparsed, so a character whose stored `avatarCrop` is such a value
would crash its Metadata tab (none on the Pi today; see follow-up 2).

## Layout

Use the screenshots (old build, real Chrome, at 1366 and 660 wide, dark and
light): a portrait picture with no crop, a landscape picture with a saved crop,
a small picture (100 × 50, not enlarged), the persona editor, a hovered Reset, a
focused Full image, mid-drag, after a corner drag and the full view. Colors,
spacing, type sizes, the dimmed outside (the square has a huge dark outer
shadow), the white outline, the white corner handles with a black border, and
the cursors (`move` on the square, diagonal resize cursors on the corners)
match them.

## Test hooks

For the replay tests only; no visible change. The square has
`data-crop="box"`, the corners `data-crop="tl" | "tr" | "bl" | "br"`, and the
full view's backdrop `data-crop-full`.

## Decisions

The rebuild keeps everything it shows and hands over. These change on purpose:

1. **Close button.** The full view's close button gets `type="button"` and
   `aria-label="Close full image"` (today it has no name and no type).
2. **Escape closes the full view.** While the full view is open it is on the
   shared overlay stack (`useEscapeOverlay`), so Escape closes it when it is the
   topmost overlay, and the key is marked handled. Today Escape does nothing
   while it is open.
3. **Hidden icons.** The icons in the header buttons, the heading and the close
   button are `aria-hidden` (their meaning is in the text or label next to
   them).

## Follow-ups after the rebuild

Kept as recorded in the rebuild; each is its own small pull request after it.

1. **Tiny pictures save crops bigger than the picture.** When the display side
   is under 24 px, a corner drag grows the square to 24 px and hands over
   `srcWidth` above 1 (1.2 for a 20 px picture). Round avatars then ignore the
   crop (the reader rejects it).
2. **Odd stored crops.** The character editor passes `extensions.avatarCrop`
   unparsed: `{}`, `[]` or a crop missing a field hands over `NaN`s on the first
   drag (saved as `null`s), and a string or number crashes the Metadata tab.
   Parsing it like the persona editor does would fix both.
3. **No keyboard use.** The square and corners can't be focused or moved with
   keys.
4. **Full view focus.** Opening doesn't move focus into it, Tab goes to the
   controls behind it, and closing doesn't return focus to Full image.
5. **Other pointers.** Any mouse button and any second finger drive a drag in
   progress, and either finger's release ends it.
6. **Picture change mid-drag.** A drag that is still in progress when the
   picture changes continues on the new picture from the old start square, and
   can hand over `srcWidth` above 1.
7. **Reset during a drag** is undone by the next move.
8. **Corner moves hand over twice** (same value; harmless, but wasteful).
9. **Broken pictures** leave an empty hidden stage with no message.
10. **Phone bottom bar over the full view.** At phone widths (660) the app's
    bottom bar (Chats, Deki-senpai, Tools) stays on top of the full view and
    covers the bottom of the picture.

## Recorded details

Found while recording the old widget; the rebuild keeps them (the recordings
show each one):

- **No hand-over on open**, also for a saved crop that is out of range (it is
  shown clamped, and the clamped value is handed over only on the first drag or
  Reset). A non-square saved crop shows a square from `srcWidth` and hands over
  a square.
- **Re-sync**: after a drag where the caller does not hand the value back, the
  square stays where it was dragged; passing the same crop values in a new
  object snaps it back.
- **Odd crop shapes** (the character editor can pass them): `{}`, `[]` and
  crops missing a number give `NaN` geometry (no square position or size shown,
  a preview style without size or position) and hand over `NaN`s on the first
  drag; text numbers act as numbers; `null` for one field acts as 0; extra keys
  are ignored; `{ x, y, zoom }` and other objects with `zoom` are legacy (their
  preview style may be invalid CSS and then shows nothing).
- **Legacy crops** show the default square; the preview keeps the legacy style
  until a current crop arrives, even after drags and Reset.
- **Sizes**: a 1 × 1 or 0 × 0 picture gives a 1 px square; a picture smaller
  than 360 isn't enlarged (100 × 50 stays 100 × 50); very thin pictures keep
  their exact fractional display size.
- **Two pointers**: a second pointer's moves drive the first pointer's drag; a
  second press restarts the drag; the first release ends it for both.
- **Release outside**: with pointer capture, a release outside the card still
  ends the drag (real Chrome).
- **Unmount mid-drag** hands over nothing more.
- **Real Chrome** (1366 and 660, dark and light): opening the editor leaves Save
  disabled; drags store exactly the handed-over numbers; Tab goes Full image →
  Reset → the next field; with the full view open, Escape leaves it (and the
  editor) open and Tab goes to Reset behind it; at 660 the app's bottom bar
  stays on top of the full view (see the `full-open-660-*` screenshots).

## Tests

The new module's tests use the recordings. They render `AvatarCropWidget` from
`./avatar-crop` inside the same caller as the recorder (a parent that records
the hand-overs and, per scenario, hands them back or not; an error boundary;
fake picture loading by `src`; pointer capture stubbed so moves and releases go
to the capturing element):

- For every recorded scenario and step: the hand-overs (exact numbers, `NaN`
  included, in order), the shown state (texts, buttons with title, type and
  label, pictures with `src`, `alt` and `draggable`, stage and frame size and
  visibility, the square's position and size and its four corners, the
  preview's style, the full view), which element captured the pointer, whether
  each dispatched event's default was prevented, and which events reached the
  parent and the document, match, except where decisions 1 to 3 add attributes
  or change a step. Render errors match by presence.
- Each decision has a test.

## Acceptance checks

- Real Chrome, a local server with throwaway data, at 1366x900 and 660x900, dark
  and light: the same states look the same as the old screenshots; hover and
  focus styles match; the stored crops after pan, each corner, Reset and a
  release outside the card are identical to the old build's; opening leaves Save
  disabled; the full view's close paths match except decision 2.
- A local copy of the Pi's saved crops and avatar picture sizes (read only,
  deleted after): for every character and persona, the old and new widget show
  the same square and preview on open and hand over the same crops for the same
  drags.
- The old file is gone.

## Black-box recording plan

Recorded by someone other than the builder, on `main` at `18febf9a25`, with no
real data and no model calls. Saved under
`src/shared/components/ui/avatar-crop/test-fixtures/` as one-line JSON (listed
in `.prettierignore`), each file under about 1 MB.

1. **Component recordings** (1,073 scenarios, 4,768 steps): the real old widget
   in the test environment inside a caller that hands values back or not, with
   fake picture loading (loaded, pending, loaded without a `load` event, broken,
   0 × 0) and stubbed pointer capture. Inputs: 10 picture sizes × 23 crop shapes
   (current, out of range, tiny, huge, negative, zero, non-square, legacy,
   `{ x, y, zoom }`, `{}`, partial, text numbers, `null` fields, a JSON string,
   a number, `[]`, extra keys). Actions: pans, every corner shrinking, growing
   and collapsing, release, cancel, moves without a press, two pointers, right
   button, Reset (also mid-drag), Full image and every close path, keys,
   picture loading, `src`, `alt` and `crop` changes (also mid-drag), unmount.
2. **Real Chrome** (the spec writer): screenshots and visible text of the old
   build for the builder, and the flows above with the stored crops read back
   after Save.

The builder gets the recordings, the screenshots and this spec. The recordings
show the old behavior that decisions 1 to 3 change on purpose.
