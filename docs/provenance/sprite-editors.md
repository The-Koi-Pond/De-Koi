# Saved Sprite Editors: Behavior Spec

Status: agreed 2026-11-19 (all decisions as recommended; "if confirmed" ones only once a recording shows the problem). Part of the code
provenance plan (`docs/code-provenance-plan.md`, tracked in #1580).

This spec describes the two editors for sprites that are already saved to a
character or persona: the **frame editor** (crop the four edges) and the
**cleanup editor** (a wand that removes connected background and five brushes
that erase, clean, paint, restore and smooth). Both open from the Sprites tab and
hand an edited picture back to the tab, which saves it over the old sprite. This
spec is the only input the builder uses for the editors. It describes behavior,
not the old implementation.

## Rules for the builder

Build from this spec, the recordings and the team-owned code around it. Don't
open, search, or read the history of the old implementation:

- `src/shared/components/ui/SpriteFrameEditor.tsx`
- everything in `src/shared/components/ui/sprite-wand-cleanup/`

You may read every interface listed under "Neighbors". `Modal.tsx` and
`url-blob.ts` are shared neighbors that aren't fully team-owned yet: import them
and read their exported props and functions, but don't copy their markup or
bodies. The sprite generation dialog in `src/features/catalog/sprites/generation/`
is team-owned; read it freely, reuse what "Sharing with the generation dialog"
allows, and don't change its behavior. If this spec doesn't answer a question,
ask the spec writer.

**Safety.** The editors produce the pictures that are written over saved sprite
files, so the plan's safety rules 2, 4 and 5 apply:

- Before the old files are deleted, someone other than the builder records the
  old editors as a black box (see "Black-box recording plan"): the saves they
  cause and the exact pixels they produce for a set of inputs and user steps.
  The recordings become tests. The builder sees the recordings, never the old
  code.
- The rebuild produces the same pixels for the same picture and the same steps,
  and causes the same `sprite_upload` calls with the same arguments. Decisions
  that would change a saved picture, a call, its arguments, or which files exist
  are marked **follow-up** and go in their own pull request after the rebuild.
- Where this text and a recording disagree, the recording wins; tell the spec
  writer so the spec gets fixed.
- Independent checks (tests, spec coverage, odd input) before merging.

## Scope

Lines not yet team-owned, from `node scripts/code-provenance.mjs --fast` at
`96b84fb102`:

**Replaced, then deleted:**

| File                                                     | Not owned | Of lines |
| -------------------------------------------------------- | --------: | -------: |
| `src/shared/components/ui/SpriteFrameEditor.tsx`         |       120 |      126 |
| `sprite-wand-cleanup/useSpriteCleanupEditor.ts`          |       555 |      568 |
| `sprite-wand-cleanup/sprite-cleanup-wand-edge.ts`        |       285 |      288 |
| `sprite-wand-cleanup/sprite-cleanup-brush.ts`            |       205 |      205 |
| `sprite-wand-cleanup/BrushCleanupControls.tsx`           |       194 |      194 |
| `sprite-wand-cleanup/sprite-cleanup-model.ts`            |       155 |      155 |
| `sprite-wand-cleanup/SpriteCleanupControls.tsx`          |       145 |      145 |
| `sprite-wand-cleanup/sprite-cleanup-selection.ts`        |       108 |      108 |
| `sprite-wand-cleanup/sprite-cleanup-wand.ts`             |        98 |       98 |
| `sprite-wand-cleanup/SpriteCleanupToolbar.tsx`           |        96 |       97 |
| `sprite-wand-cleanup/SpriteCleanupCanvasStage.tsx`       |        84 |       85 |
| `sprite-wand-cleanup/SpriteCleanupFooter.tsx`            |        79 |       80 |
| `sprite-wand-cleanup/WandCleanupControls.tsx`            |        70 |       70 |
| `sprite-wand-cleanup/SpriteCleanupControlPrimitives.tsx` |        65 |       65 |
| `sprite-wand-cleanup/SpriteWandCleanupEditor.tsx`        |        64 |       64 |
| `sprite-wand-cleanup/sprite-cleanup-canvas.ts`           |        39 |       39 |
| `sprite-wand-cleanup/sprite-cleanup-types.ts`            |        39 |       39 |
| `sprite-wand-cleanup/PreviewBackgroundPicker.tsx`        |        25 |       25 |
| `sprite-wand-cleanup/sprite-cleanup-pixels.ts`           |        12 |       12 |
| `sprite-wand-cleanup/sprite-cleanup-color.ts`            |        10 |       10 |

(`sprite-wand-cleanup/` is `src/shared/components/ui/sprite-wand-cleanup/`.)
That's **2,448 lines** not yet team-owned in 20 files (2,473 lines in all).

**Why only these files.** The editors' close helpers were checked and left out:

| File                                                                        | Not owned | Of lines | Why it isn't in scope                                                                       |
| --------------------------------------------------------------------------- | --------: | -------: | ------------------------------------------------------------------------------------------- |
| `src/features/catalog/characters/components/CharacterSpriteEditors.tsx`     |         0 |       37 | Team-owned wrapper that mounts both editors for the character tab.                          |
| `src/features/catalog/personas/components/sprites/PersonaSpriteEditors.tsx` |         0 |       39 | Same for the persona tab.                                                                   |
| `CharacterSpritesTab.tsx`, `PersonaSpritesTab.tsx`                          |         5 |      750 | Team-owned callers; they own the save, the toasts, saved-sprite cleanup and restore points. |
| `src/shared/lib/sprite-frame-crop.ts`                                       |         0 |       62 | Team-owned crop helper, shared with the generation dialog.                                  |
| `src/shared/components/ui/Modal.tsx`                                        |        71 |      123 | Shared by most dialogs in the app; a module of its own.                                     |
| `src/shared/lib/url-blob.ts`                                                |        39 |       49 | Shared loader for pictures and downloads.                                                   |
| `src/shared/api/image-generation-api.ts`                                    |        39 |      181 | Shared wrapper for all image, gallery and sprite commands.                                  |
| `src-tauri/src/commands/storage/sprites.rs`                                 |     1,447 |    3,738 | Rust storage; a later, riskier module (safety rule 1).                                      |

**Tests:** none exist for either editor. Nothing reads their source as text.

**Saved-sprite cleanup and restore points are not part of this module.** The
Sprites tab's "Clean sprites" (`sprite_cleanup_saved`) and "undo last cleanup"
(`sprite_cleanup_restore`) live in the tabs and their upload panels, which are
team-owned. The editors never call them. They are mentioned below only where
they interact with an editor save (decision 2).

### Neighbors (not rebuilt)

- **Callers.** `CharacterSpritesTab.tsx` and `PersonaSpritesTab.tsx` each keep
  "the sprite being framed" and "the sprite being cleaned" (a `SpriteInfo`, or
  nothing) plus a saving flag for each, and render the wrappers
  `CharacterSpriteEditors` / `PersonaSpriteEditors`. The wrappers mount the
  frame editor while a sprite is being framed and the cleanup editor while one
  is being cleaned (each mounts fresh per sprite and unmounts on close), and
  pass:
  - `imageUrl`: the sprite's `url` from `sprite_list` (see "The picture's
    address").
  - `label`: the tab's display name for the sprite: the stored name, with a
    leading `full_` removed while the tab shows its Full-body category.
  - `applying`: the tab's saving flag for that editor.
  - `onApply(dataUrl)`: the tab's save (see "Saving").
  - `onClose()`: clears the tab's sprite for that editor.

  Keep these five props, or change both wrappers in the same change.

- **How the editors are opened** (grid tiles, team-owned): clicking a tile's
  picture (a button titled "Open wand cleanup", named by the picture's alt text,
  the stored sprite name) opens the cleanup editor; the tile's icon button
  titled "Frame" opens the frame editor. Opening the frame editor for another
  sprite while one is open swaps the sprite in place (same mounted editor, new
  `imageUrl`).
- **The save** (in the tabs): `useUploadSprite` from
  `src/features/catalog/sprites/hooks/use-sprites.ts`, which calls
  `spriteApi.upload` in `src/shared/api/image-generation-api.ts`, which sends
  `sprite_upload` (see "Saving"). On success the hook refreshes the owner's
  sprite list (`sprite_list`).
- **Rust:** `upload_sprite` in `src-tauri/src/commands/storage/sprites.rs`
  through `commands/storage/commands/media.rs` (desktop) and `http_dispatch.rs`
  (hosted); `load_url_binary` in `commands/storage/commands/profile.rs` and
  `http.rs` (used to load a picture, see below).
- **Picture loading:** `loadUrlBlob` (`src/shared/lib/url-blob.ts`), which uses
  `urlBinaryApi.load` (`src/shared/api/url-binary-api.ts`).
- **Crop:** `cropSpriteDataUrl` and `SpriteFrameAdjustments`
  (`src/shared/lib/sprite-frame-crop.ts`).
- **Dialog shell:** `Modal` (`open`, `onClose`, `title`, `width`, children):
  `role="dialog"` named by its title, a close button named "Close <title>",
  Escape and a backdrop click close it, focus moves to the close button on open,
  Tab stays inside, focus returns afterwards.
- **Errors:** `getErrorMessage` / `toUserMessage`
  (`src/shared/lib/error-message.ts`). A plain error (no worded code) shows the
  fallback text, never its own message.

### The picture's address

`imageUrl` is whatever `sprite_list` resolved for the sprite file. It can be:

- on the desktop app, a local asset address (`http://asset.localhost/…` or
  `asset:…`) with `?v=<cacheKey>`;
- on a hosted install without a password, the runtime's own address
  `<runtime>/api/assets/sprite/<character|persona>/<ownerId>/<filename>?…`;
- on a hosted install with a password, a `blob:` address of a copy the app
  already fetched with the password;
- in principle a `data:` address.

How each editor loads it today, and where that may fail, is under each editor
and in decisions 4 and 5.

## The shape

- **Two editors, one module.** The frame editor is an inline panel; the cleanup
  editor is a dialog. Neither sends any command itself: each hands a finished
  PNG data URL to `onApply`, and the tab saves it.
- **Layers:** the pixel rules (wand, brushes, history) are plain TypeScript with
  no React and no DOM, working on a width, a height and RGBA bytes (4 bytes per
  pixel, rows top to bottom, not premultiplied), so they can be tested in plain
  unit tests. Loading a picture into RGBA and turning RGBA back into a PNG are a
  thin browser layer. The editors are components.
- **Suggested home:** `src/features/catalog/sprites/editors/` (`lib/` and
  `components/`), exported through `src/features/catalog/sprites/index.ts`,
  which both tabs already import. The old files sit in `src/shared/components/ui`
  but only the two catalog wrappers use them.

### Sharing with the generation dialog

The generation dialog (`src/features/catalog/sprites/generation/`) has its own
frame tool with the same limits and its own background cleanup (which is a
server call, `sprite_cleanup`, unrelated to the wand and brushes). Sharing is
allowed only by importing; don't edit files under `generation/`:

- **Do reuse** `setFrameEdge`, `ZERO_FRAME` and `MAX_FRAME_EDGE` from
  `generation/lib/frame-limits.ts`: they are exactly this spec's frame limits.
  Also reuse `PercentSlider` (`generation/components/PercentSlider.tsx`), whose
  slider is named by its label alone (decision 13).
- **May reuse** `generation/components/FrameEditor.tsx` for the panel, wrapped
  so the saved-sprite editor can still show its own error line and loading. Its
  wording ("Apply frame", "Reset frame", preview alt "Framed preview of …")
  matches decision 14.
- Add any export you need to `src/features/catalog/sprites/index.ts` (or import
  the file directly if the architecture check allows it). Nothing in the cleanup
  editor overlaps with the generation dialog.

## Saving (the compatibility contract)

The editors never call `invokeTauri`. The contract they must keep is what they
hand to `onApply` and the call the tabs then make.

**What the editors hand over:** one string, a PNG data URL
(`data:image/png;base64,…`) of the whole edited picture at its own size, made
the way the browser's 2D canvas makes PNGs (`toDataURL("image/png")`) from the
edited pixels. The frame editor's picture is `cropSpriteDataUrl`'s output.

**What the tabs send** (unchanged by this rebuild), once per Apply, through
`spriteApi.upload`:

| Command         | Arguments                                                 |
| --------------- | --------------------------------------------------------- |
| `sprite_upload` | `{ characterId, ownerType, body: { expression, image } }` |

- `characterId`: the owner's id for both owner types (the persona id from the
  persona tab).
- `ownerType`: `"character"` from the character tab, `"persona"` from the persona
  tab.
- `expression`: the sprite's **stored** name exactly as listed (with `full_` for
  full-body sprites), not the label.
- `image`: the data URL from the editor, unchanged.
- On hosted installs this is the `args` of `POST /api/invoke`
  `{ command: "sprite_upload", args }`, with the default hosted time limit.

**What Rust does with it:** applies the name rule (trim, lowercase, every
character other than `a`–`z`, `0`–`9`, `_`, `-` becomes `_`), refuses an empty
name ("Expression label is required"), checks the bytes are an image, and writes
`<name>.png` into the owner's sprite folder, replacing a file of that exact name
without asking. It doesn't touch any other file. It replies with the sprite
record (`expression`, `filename`, `absolutePath`, `ownerId`, `ownerType`, `size`,
`cacheKey`, `url`); the tab reads nothing from it.

**What the tab shows:**

| Editor  | Success                                                    | Failure                                                               |
| ------- | ---------------------------------------------------------- | --------------------------------------------------------------------- |
| Frame   | toast "Framed <label> sprite.", the frame editor closes    | toast "Couldn't save framed sprite. Try again." (or the worded text)  |
| Cleanup | toast "Cleaned <label> sprite.", the cleanup editor closes | toast "Couldn't save cleaned sprite. Try again." (or the worded text) |

"Worded text" means the error's own message for codes `toUserMessage` treats as
already worded, for example `invalid_image` and `request_body_too_large`. On
failure the editor stays open with everything as it was. The tab catches its own
errors, so `onApply` never rejects with today's callers. If it ever does, the
frame editor shows "Couldn't frame sprite. Try again." and the cleanup editor
"Couldn't save sprite cleanup. Try again." in their error lines.

While the tab's saving flag is on, each editor shows it as described below. The
tab's sprite list refreshes after a successful save, and the tile shows the new
picture.

## Frame editor

An inline card rendered by the tab above the sprite grid (below the upload
panel). Nothing else on the page changes while it's open.

**Layout:** a square preview (about 9 rem; full width on phones) beside the
controls: a heading "Frame <label>" with a crop icon (shown with each word
capitalised), a round close button named "Close frame editor" (tooltip "Close"),
four sliders in two columns (one column on phones), an error line when there is
an error, then **Reset** and **Apply Frame**.

**Sliders:** **Top**, **Bottom**, **Left**, **Right**, each 0 to 80, step 0.5,
starting at 0, with the value shown beside it as "x.x%".

- **Limits:** each value is kept between 0 and 80 (anything not a number is 0).
  Top + bottom and left + right may not pass 90: setting one side lowers the
  opposite side by the excess, never below 0. (This is `setFrameEdge`.)
- **Opening for another sprite** while the panel is open sets all four back to
  0, clears the preview and the error.

**Preview:** the picture at `imageUrl` cropped with `cropSpriteDataUrl` and the
four values, redone on every change; a newer change wins over an older one still
running. Shown fitted inside the square with the label as its alt text. Before
the first crop finishes it shows the uncropped picture. If a crop fails, it shows
the uncropped picture and the error line says "Frame preview failed. Try again."
(cleared by the next successful crop).

**Crop rule** (owned by `cropSpriteDataUrl`, listed so the recordings can be
checked): with W×H the picture's own size, each edge's crop in pixels is its
percentage of W (left, right) or H (top, bottom), rounded to the nearest pixel;
the result is the rest of the picture at its own size, as a canvas PNG.

**Reset** sets all four to 0. It isn't locked while saving (decision 8).

**Apply Frame** crops the picture at `imageUrl` with the current values (the
same rule, from the original file, not from the preview) and hands the PNG to
`onApply`. While the tab saves, the button shows a spinner instead of its crop
icon and is disabled; the sliders, Reset and close stay active (decision 8). A
crop failure shows "Couldn't frame sprite. Try again." and hands nothing over.
Apply with all four at 0 still hands over a full-size copy, which is saved
(decision 6; since that follow-up, Apply stays disabled at 0).

**Close** (the X) closes without saving and without asking (decision 3).

**Loading today:** the preview and the crop draw the picture straight from
`imageUrl` (no `crossOrigin`). That works for `blob:`, `data:` and same-origin
addresses. On the desktop app the asset address is on another origin, so the
browser may refuse to read the drawn canvas back; then every preview shows the
uncropped picture with "Frame preview failed. Try again." and Apply shows
"Couldn't frame sprite. Try again." Seen in the code, not yet checked in the
desktop app (decision 4).

## Cleanup editor

A dialog (the shared `Modal`) titled "Clean <label>", nearly full screen on
phones and up to about 72 rem wide and 44 rem tall on larger screens. Top to
bottom:

1. **Tool row:** the tools **Wand**, **Clean**, **Erase**, **Brush**, **Blur**
   (one pressed at a time, `aria-pressed`), and on the right a small group:
   **Pan** (icon button named "Pan"), **Zoom out**, the zoom percentage (a button
   that fits the picture to the view, tooltip "Fit to view"), **Zoom in**.
2. **Settings row:** the current tool's settings on the left and the preview
   background buttons on the right.
3. **The stage:** the picture on a canvas over the chosen background, scrollable
   in both directions.
4. **Footer:** the status line, the pixel readout below it, then **Undo**,
   **Redo**, **Reset**, **Cancel**, **Apply Cleanup**.

Every open starts fresh: tool Wand, background Dark, all settings at their
defaults, no history, zoom fitted. Nothing is remembered between opens.

### Loading the picture

On open, the stage shows a spinner over a dimmed stage and every control except
Cancel, the background buttons and the dialog's own close is disabled. The
picture is fetched as bytes with `loadUrlBlob` (on the desktop app and for
`blob:` addresses that goes through the `load_url_binary` command; for a hosted
runtime's own `/api/assets/…` address the browser fetches it with the runtime's
headers; `data:` is decoded in place), decoded by the browser, drawn at its own
size onto the canvas and read back as RGBA. That RGBA is the **original**: the
picture as it was when the editor opened. It is also the starting **current**
picture.

The pixels the editor works on are the ones the browser's 2D canvas gives back
after drawing the decoded picture (for partly transparent pixels this can differ
by rounding from the file's own bytes). The rebuild must read them the same way,
or saved pixels will differ from the recordings.

**Failure:** the spinner goes away, the stage stays empty, and the status line
shows "Sprite image could not be loaded. Try again." in the error colour. There
is no retry; the user closes and reopens (decision 10). With a password-protected
hosted install the address is a `blob:` address that only the browser can read,
but today it is sent to the server's `load_url_binary`, which can't fetch it;
suspected to fail every time (decision 5).

After loading, the zoom is set to fit (below), once.

### Zoom, pan and preview background

- **Zoom** is between 12.5% and 800%. **Zoom in** multiplies it by 1.25,
  **Zoom out** divides by 1.25; Ctrl (or Cmd) with the mouse wheel over the stage
  multiplies by 1.15 per notch up and divides by 1.15 per notch down (a wheel
  event without a vertical move counts as down). It tries to stop the browser's
  own Ctrl+wheel page zoom, but React's wheel listeners are passive, so that
  probably has no effect (decision 16). A plain wheel scrolls the stage. Zoom changes the shown size only; the scroll
  position isn't adjusted to keep a point in place.
- **Fit** (the percentage button, and once after loading): the largest zoom at
  which the picture fits in a box 32 px narrower and 32 px shorter than the
  stage's inner size (at least 1 px), but never above 100%
  (small sprites show at 100%), kept within the zoom limits.
- **The percentage** shown is the zoom × 100, rounded.
- **Shown size:** the canvas is shown at its own size × the zoom, centred in the
  stage when smaller than it, with sharp pixels (no smoothing) at 200% and above.
- **Pan:** with the Pan tool, dragging on the picture with the main button
  scrolls the stage; with any tool, dragging with the middle button on the
  picture or the stage scrolls it (the middle click's default is blocked). The
  status shows "Panning" when a pan starts and keeps it afterwards.
- **Preview background** (buttons with `aria-pressed`): **Dark** (`#161321`,
  the default), **Grid** (a 20 px checkerboard in the theme's secondary and
  border colours), **Light** (`#f3eef8`), **Pink** (`#ff4fa3`). It colours the
  stage behind the picture and is never saved.

### Pointer, cursor and readout

- **Which pixel:** a pointer position maps to the picture pixel under it by
  taking its fraction across the shown canvas, times the picture's width or
  height, rounded down, kept inside the picture. Outside the shown canvas there
  is no pixel.
- **Readout** (second footer line): "x X, y Y · rgba(R, G, B, A)" for the pixel
  under the pointer in the current picture, or "Move over the sprite to sample
  pixels" when the pointer isn't over it.
- **Reticle:** a ring centred on the middle of the hovered pixel. For Clean,
  Erase, Brush and Blur (unless picking a colour) its diameter is the brush size
  × zoom, at least 8 px; otherwise 12 × zoom, at least 12 px. Hidden while
  loading and when the pointer isn't over the picture.
- **Cursor:** a grabbing hand while panning; an open hand with the Pan tool; a
  crosshair for the Wand and while picking a colour; hidden (the reticle shows
  instead) for the brushes.
- **Input:** only the main and middle buttons do anything. Nothing happens while
  loading or saving, or while another gesture is in progress (a second pointer
  is ignored). Touch works like the main button; the canvas blocks the browser's
  own touch scrolling and zooming.

### Status line

The first footer line shows the latest error in the error colour if there is
one, else the latest status, else "Wand ready" (whatever the tool, decision 9).
Status texts, exactly:

| When                             | Text                                                                                           |
| -------------------------------- | ---------------------------------------------------------------------------------------------- |
| Wand removed pixels              | "N px removed with wand (S% softness, F% feather) from rgba(R, G, B, A)"                       |
| Same, with Strong on             | "N px removed with strong wand (S% softness, F% feather) from rgba(R, G, B, A)"                |
| Wand clicked a see-through pixel | "No opaque pixels selected"                                                                    |
| A stroke changed pixels          | "N px target-cleaned" / "N px erased" / "N px painted" / "N px restored" / "N px edge-blurred" |
| A stroke changed nothing         | "No pixels changed"                                                                            |
| Pan started                      | "Panning"                                                                                      |
| Undo / Redo / Reset              | "Undo applied" / "Redo applied" / "Reset"                                                      |
| Wand Defaults                    | "Wand settings reset"                                                                          |
| Pick turned on / off             | "Click the sprite to pick a brush color" / "Brush color picker canceled"                       |
| A colour was picked              | "Brush color picked: rgba(R, G, B, A)"                                                         |

N is formatted with the browser's number grouping (`toLocaleString`). The wand's
R, G, B, A is the clicked pixel's colour. A stroke's N adds up the pixels each
stamp changed, so a pixel changed by several stamps counts several times
(decision 9). A wand click or stroke that changed pixels, Undo, Redo, Reset,
Defaults and the Pick texts also clear the error; "No opaque pixels selected",
"No pixels changed" and "Panning" don't (in practice the only error that can be
showing is a loading failure, which stops everything else).

### The wand

**Settings** (shown while the Wand tool is on):

| Control      | Kind     | Range    | Default | Tooltip                                                                   |
| ------------ | -------- | -------- | ------: | ------------------------------------------------------------------------- |
| **Defaults** | button   |          |         | "Reset wand controls to their defaults"                                   |
| Tolerance    | slider   | 4 to 128 |      36 |                                                                           |
| Strong       | checkbox |          |     off | "Reach farther into matching debris"                                      |
| Softness     | slider   | 0 to 100 |      55 | "0 is a hard cut; higher values leave a softer low-alpha edge"            |
| Feather      | slider   | 0 to 100 |      12 | "How much soft border the wand leaves behind, and how gradually it fades" |

Sliders move in whole steps of 1 and show their value beside them. **Defaults**
puts these four back (Tolerance 36, Strong off, Softness 55, Feather 12) and
nothing else.

**A wand click** (pointer down with the main button on the picture) removes the
connected area of colours like the clicked pixel and softens the cut. Each click
is one undo step. The parameters come from the settings:

| Parameter              | Strong off                    | Strong on                               |
| ---------------------- | ----------------------------- | --------------------------------------- |
| Tolerance used, T      | Tolerance                     | Tolerance × 1.55, rounded (at most 198) |
| Neighbours for growing | 4 (sides)                     | 8 (sides and corners)                   |
| Edge guard, g          | 0.55                          | 0.28                                    |
| Grow-out rounds        | 1                             | 2                                       |
| Softness s, feather f  | Softness ÷ 100, Feather ÷ 100 | the same                                |

The rules below define the result exactly. "Distance" between two colours is the
straight-line RGB distance, √(ΔR² + ΔG² + ΔB²), ignoring alpha. "Clamp" means
kept between 0 and 1. Every test reads the picture **as it was just before the
click** (the "before" picture); changes made during the click don't feed back.
The target colour t is the clicked pixel's RGB in the before picture.

1. **See-through click.** If the clicked pixel's alpha is 8 or less, nothing
   changes ("No opaque pixels selected") and no undo step is made.
2. **Which pixels can be taken.** A pixel p with RGB distance d to t can be
   taken, with a reach factor k (1 while growing, more while growing out), when
   all of these hold:
   - its alpha is above 8;
   - d ≤ max(1, T × k);
   - and either d ≤ T × (0.18 + 0.16 × (1 − g)), or the **edge check** passes.

   The edge check looks at the up to 8 pixels around p inside the picture whose
   alpha is above 32 (n of them). Among those, the **character-like** ones are
   those whose distance to t is above T × (1.05 − 0.18 × g) (m of them), and c
   is the smallest RGB distance between p and a character-like one. The check
   passes when m = 0; otherwise it fails only when all three hold:
   - d > T × (0.36 + 0.32 × (1 − g)) (a weak match),
   - c < d × (1.1 + 1.15 × g) + 10 × g (p is closer to the character than the
     target is),
   - m ÷ n > 0.18 + 0.42 × (1 − g) (crowded by character pixels).

   The thresholds inside the edge check always use T, never T × k.

3. **Growing.** The removed area starts at the clicked pixel (which can always
   be taken, since d = 0) and is every pixel connected to it through pixels that
   can be taken with k = 1, using the neighbours from the table.
4. **Growing out.** Then, for each grow-out round r = 0, 1, …, every pixel that
   is not yet in the area, touches the area as it was at the start of that round
   (same neighbours), and can be taken with k = 1.08 + 0.08 × r, joins it.
5. **Removing.** Every pixel in the area gets alpha 0 (its RGB is kept in
   memory, but see "The saved picture"). N in the status is the number of
   pixels in the area.
6. **Softening the kept edge** (skipped when s and f are both 0). With
   a = clamp(0.72 s + 0.42 f), band width B = 1 + round(2 s + 3 f), matte reach
   M = max(1, T × (1.14 + 0.82 a)), colour-pull amount q = clamp((0.65 s +
   0.55 f − 0.3) ÷ 0.7), sample radius Rs = B + 2:
   - **The band:** kept pixels (not in the area) whose step count to the area is
     1 to B, counting steps through kept pixels only, 8 neighbours per step. For
     a band pixel at step j, its edge weight is e = clamp((B − j + 1) ÷ B).
   - Band pixels whose alpha is 0 are left alone. For the others, with A its alpha, A₀ its alpha before, d its
     distance to t: matte likeness μ = 1 − d ÷ M when d ≤ M, else 0; fragility
     v = clamp((248 − A₀) ÷ (218 − 82 a)).
   - **Colour pull** (only when q > 0 and μ > 0.05): the **nearby character
     colour** is the weighted average of the before-picture RGB of pixels within
     straight-line distance Rs of p (a disc, not p itself, inside the picture),
     not in the area, with alpha above 48, and with separation
     σ = clamp((distance to t − 0.72 M) ÷ max(1, 1.55 M)) above 0; each weighs
     (1 − r ÷ (Rs + 0.001))^1.35 × (alpha ÷ 255)^1.1 × σ^1.25, r being its
     distance to p. Each channel of the average is rounded; W is the total
     weight. With none, there's no pull. Otherwise, with L the luma
     0.2126 R + 0.7152 G + 0.0722 B, Lt the target's luma, Lc the average's and
     Lp the pixel's own (before): light residue = clamp((Lp − Lc − 4) ÷ max(28,
     Lt − Lc)) when Lt > Lc, else 0; dark residue = clamp((Lc − Lp − 4) ÷
     max(28, Lc − Lt)) when Lt < Lc, else 0; residue = the largest of μ, light
     and dark residue; confidence = clamp(W ÷ (1.4 + 0.42 Rs)); pull =
     clamp(q × e^0.88 × residue × (0.42 + 0.28 v + 0.3 × confidence)). When
     pull > 0, each channel becomes round(own × (1 − pull) + average × pull),
     "own" being the before-picture channel.
   - **Alpha fade:** strength = a × e^(0.92 + 0.28 (1 − f)) × (0.16 + 0.58 μ +
     0.3 v); the alpha becomes the smaller of A and round(A × (1 −
     clamp(strength))).
   - **One smoothing pass** over the faded alphas (reading the faded values, not
     the ones being written): for each band pixel whose faded alpha F is above 0,
     take the weighted average of the faded alphas in its 3×3 block inside the
     picture, counting area pixels as 0, with weight 1.8 for the pixel itself, 1
     for side neighbours and 1/√2 for corner neighbours, rounded. With mix =
     a × e^0.72 × 0.64, the alpha becomes the smaller of F and round(F × (1 −
     mix) + average × mix).
   - The band pixels take these new values.
7. **The soft halo** (skipped when f is 0). With halo width H = 1 +
   round(5 f), sample radius Rh = H + 2 + round(2 s), target reach Tt = max(1,
   T), top alpha Amax = 4 + f × (46 + 18 s), curve = 1.72 − 0.58 s − 0.46 f:
   - **The halo band:** area pixels that touch (8 neighbours) a kept pixel whose
     before alpha is above 8 are at step 1; from them, steps continue through
     area pixels only, 8 neighbours per step, up to H. Edge weight e =
     clamp((H − j + 1) ÷ H).
   - **Halo colour** for a halo-band pixel: the weighted average of before-
     picture RGB of pixels within distance Rh (disc, not itself, inside the
     picture), not in the area, with alpha above 28 and separation σ =
     clamp((distance to t − 0.45 Tt) ÷ (1.55 Tt)) above 0; each weighs (1 −
     r ÷ (Rh + 0.001))^1.6 × (alpha ÷ 255)^1.15 × σ^1.2. Channels rounded;
     influence = clamp(W ÷ (1.15 + 0.38 Rh)). With none, that pixel gets no halo.
   - **Halo alpha:** the smaller of its before alpha and round(Amax × e^curve ×
     (0.55 + 0.45 × influence)); 0 or less means no halo.
   - **Smoothing:** round(2 s + 2 f) passes, each reading the previous pass. For
     each halo-band pixel, over the area pixels in its 3×3 block inside the
     picture (itself weight 1.8, sides 1, corners 1/√2; every area pixel counts
     in the total weight, even with no halo): if the halo alphas there add up to
     more than 0, its colour becomes the alpha-and-weight-weighted average
     colour (rounded) and its alpha the weighted average alpha (rounded);
     otherwise it stays.
   - Area pixels whose final halo alpha is above 0 take the halo colour and
     alpha; the rest stay at alpha 0.

So a wand click leaves a faint, character-coloured fringe (at defaults, alpha
11 or less) just inside the removed area, and fades and de-tints the kept
pixels along the cut.

### The brushes

**Tools and their settings** (sliders in whole steps, value shown beside them):

| Tool  | Settings shown                                                                          |
| ----- | --------------------------------------------------------------------------------------- |
| Clean | Brush, Tolerance, Edge Guard, Feather                                                   |
| Erase | Brush, Opacity, Hardness                                                                |
| Brush | Brush, mode buttons **Color** / **Restore**, Color (Color mode only), Opacity, Hardness |
| Blur  | Brush, Strength                                                                         |
| Pan   | nothing (only the preview backgrounds)                                                  |

| Setting    | Range           | Default   | Tooltip                                                                                                                                                              |
| ---------- | --------------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Brush      | 2 to 96         | 18        | (none; a minus and a plus icon either side of the slider, not buttons)                                                                                               |
| Tolerance  | 4 to 128        | 36        | "How closely pixels must match the sampled cleanup color"                                                                                                            |
| Edge Guard | 0 to 100        | 45        | "How strongly the brush avoids character-like edge pixels"                                                                                                           |
| Feather    | 0 to 100        | 8         | "Soften the edge of the cleaned brush stroke"                                                                                                                        |
| Opacity    | 0 to 100        | 100       | Erase "How much alpha each eraser stroke removes"; Color "How much color each brush stroke applies"; Restore "How strongly each stroke restores the original sprite" |
| Hardness   | 0 to 100        | 100       | Erase "How crisp the eraser edge should be"; Color "How crisp the brush edge should be"; Restore "How crisp the restore brush edge should be"                        |
| Strength   | 0 to 100        | 65        | "How strongly the blur brush smooths alpha edges"                                                                                                                    |
| Mode       | Color / Restore | Color     | Color "Paint with the selected color"; Restore "Paint original pixels back in"                                                                                       |
| Color      | colour picker   | `#ffffff` | the group's tooltip "Brush color"; the input is named "Brush color"; the hex shows beside it                                                                         |
| **Pick**   | toggle button   | off       | "Pick brush color from the sprite"                                                                                                                                   |

The wand's Tolerance and Feather are separate from Clean's. Settings stay as set
when switching tools. Tool tooltips: Wand "Select connected pixels", Clean
"Brush away pixels matching the sampled color", Erase "Paint pixels transparent",
Brush "Paint color or restore original pixels", Blur "Paint alpha smoothing over
jagged edges", Pan "Pan (middle mouse drag also pans)".

**Picking a colour.** **Pick** turns picking on or off. While on (Brush tool,
Color mode), a main-button press on the picture sets the colour to that pixel's
RGB from the current picture (alpha ignored, so a see-through pixel gives
whatever colour it hides, often black; decision 11), turns picking off and shows
"Brush color picked: rgba(…)". Nothing is painted. Choosing a colour in the
picker, switching to Restore mode or switching to another tool also turns picking
off. The canvas tooltip is "Pick brush color" while picking, else "Edit sprite
transparency".

**A stroke** is one press-drag-release with the main button. Its settings are
fixed when it starts (changing a slider mid-stroke doesn't affect it).

- **Stamps.** The press puts one stamp on the pressed pixel. Each pointer move
  to a different pixel puts stamps along the straight line from the previous
  point to the new one: with distance D between them and radius r, the number
  of stamps is n = max(1, ceil(D ÷ max(1, 0.45 r))), placed at fractions 1/n,
  2/n, … 1 of the way (so not on the previous point again); stamp centres can be
  fractional. A move onto the same pixel does nothing.
- **Leaving the picture.** While the pointer is outside the picture nothing is
  drawn; when it comes back, one stamp goes at the point where it came back (no
  line joins the two).
- **Release** (or the browser cancelling the pointer) ends the stroke. If no
  pixel changed: "No pixels changed", no undo step. Otherwise one undo step for
  the whole stroke and "N px <action>".
- **Radius** r = max(1, Brush ÷ 2). A stamp centred at (cx, cy) covers the
  pixels (x, y) (whole-number pixel indices, not pixel centres) inside the
  picture with (x − cx)² + (y − cy)² ≤ r². For each covered pixel, its distance
  share is ρ = √((x − cx)² + (y − cy)²) ÷ r.
- **Hardness falloff** (Erase, Color, Restore), with h = Hardness ÷ 100: the core
  is 1 when h ≥ 0.99, else h^1.35; the falloff is 1 when ρ ≤ core, else
  clamp((1 − ρ) ÷ max(0.001, 1 − core))^(1 + 1.8 (1 − h)).
- **Reference picture.** Clean and Blur test pixels against a snapshot of the
  current picture: for the press stamp, the picture just before that stamp; for
  each pointer move, the picture just before that move's stamps (all stamps of
  one move test the same snapshot). Erase, Color and Restore read the picture as
  it is at each stamp, so overlapping stamps add up.

Per covered pixel, with A its current alpha and o = Opacity ÷ 100:

- **Erase:** skip when A is 0. The alpha becomes round(A × (1 − falloff × o)).
- **Color (paint):** the brush colour (alpha 255) is laid over the pixel with
  strength α = falloff × o; skip when α ≤ 0.001. With the pixel's alpha as a
  share Aₛ = A ÷ 255: kept share = Aₛ × (1 − α); total = α + kept share. Each
  channel becomes round((brush × α + own × kept share) ÷ total) and the alpha
  round(total × 255); a total of 0 gives (0, 0, 0, 0).
- **Restore:** amount = falloff × o; skip when 0. When amount ≥ 0.999 the pixel
  becomes exactly the original's pixel (RGBA). Otherwise, with own weight =
  Aₛ × (1 − amount) and original weight = (original alpha ÷ 255) × amount and
  total = their sum, each channel becomes round((own × own weight + original ×
  original weight) ÷ total) and the alpha round(total × 255); a total of 0 gives
  (0, 0, 0, 0). "Original" is the picture as it was when the editor opened (the
  saved file), not anything older.
- **Clean:** the target is the RGBA of the pressed pixel in the current picture
  at the press. If the target's alpha is 8 or less, the whole stroke changes
  nothing. With Tc = max(1, Tolerance), gc = Edge Guard ÷ 100, fc = Feather ÷
  100, and d the snapshot pixel's RGB distance to the target: skip when A is 0
  or d > Tc. When gc > 0, look at the up to 8 pixels around it in the snapshot
  with alpha above 32 (n of them); character-like ones are those with distance
  to the target above Tc × (1.04 − 0.18 gc) (m of them); skip when both d >
  Tc × (0.22 + 0.44 (1 − gc)) and n > 0 with m ÷ n > 0.22 + 0.45 (1 − gc).
  Otherwise the erase share is 1 when ρ ≤ core, else clamp((1 − ρ) ÷ max(0.001,
  1 − core))^1.65, with core = 1 when fc ≤ 0.01, else 1 − 0.84 fc; the alpha
  becomes round(A × (1 − erase share)).
- **Blur:** with b = Strength ÷ 100 (skip all when 0) and A₀ the snapshot alpha:
  skip when A₀ ≤ 8. Over the 3×3 block in the snapshot (inside the picture,
  itself included), take the lowest and highest alpha and the weighted average
  alpha (itself weight 1.75, sides 1, corners 1/√2, rounded). Skip when highest −
  lowest < 24. The alpha becomes the smaller of A₀ and round(A₀ × (1 − b) +
  average × b). Blur only ever lowers alpha; colours are untouched.
- A pixel counts as changed by a stamp when its new value differs: Erase, Clean
  and Blur compare the new alpha with the alpha they started from (current for
  Erase and Clean, the snapshot for Blur); Color and Restore compare all four
  channels with the current pixel.

### Undo, redo and reset

- Every wand click that removed pixels and every stroke that changed pixels
  saves the picture as it was before it as one undo step and clears the redo
  list. At most **12** undo steps are kept; the oldest is dropped.
- **Undo** (button, or Ctrl/Cmd+Z): the current picture goes onto the redo list
  (at most 12) and the last undo step comes back. **Redo** (button, Ctrl/Cmd+Y
  or Ctrl/Cmd+Shift+Z): the current picture goes onto the undo list (at most 12) and the last redo step comes back.
- The shortcuts work anywhere in the window while the editor is open, except
  while typing in a text box, text area, select or editable text (sliders,
  checkboxes, buttons and the colour input don't count as typing), while Alt is
  held, while loading or saving, and when there's nothing to undo or redo (then
  the key does whatever it normally does).
- **Reset** brings back the original and clears both lists.
- "Has changes" is true after any change and, after an undo or redo, whether the
  picture now differs from the original in any byte. Reset makes it false.
- Buttons: **Undo** (tooltip "Undo (Ctrl/Cmd+Z)") disabled with nothing to undo;
  **Redo** (tooltip "Redo (Ctrl/Cmd+Y or Ctrl/Cmd+Shift+Z)") disabled with
  nothing to redo; **Reset** disabled without changes; all three disabled while
  loading or saving.

### Apply and close

- **Apply Cleanup** (disabled while loading, while saving and without changes)
  hands the current picture to `onApply` as a canvas PNG of the whole picture at
  its own size. While the tab saves, it shows a spinner, and the tools, settings,
  canvas, Undo, Redo, Reset and Cancel are disabled.
- **The saved picture.** Because the PNG is made from the canvas, fully see-
  through pixels come out as (0, 0, 0, 0) and partly see-through pixels' colours
  are rounded the way the browser's canvas rounds them. The rebuild must make
  the PNG the same way.
- **Cancel** (disabled while saving), the dialog's close button ("Close Clean
  <label>"), Escape and a backdrop click close the editor and drop every change
  without asking (decision 3). The close button, Escape and the backdrop also
  work while saving; the save carries on and the tab still shows its toast.

## Saved data

| What        | Exact contract                                                                                               | Rule                                                                        |
| ----------- | ------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| Sprite file | Rust writes `<name>.png` in the owner's sprite folder (name rule above), replacing a file of that exact name | Rust-owned. Same `expression` and image.                                    |
| Picture     | a canvas PNG of the edited picture at its own size (frame: `cropSpriteDataUrl`'s output)                     | Same pixels for the same steps.                                             |
| Name        | the sprite's stored name (with `full_` for full-body), never the label                                       | Same.                                                                       |
| Owner       | `ownerType` `"character"` or `"persona"`, the owner id always as `characterId`                               | Same names and values.                                                      |
| Other files | none are touched: a `happy.jpg` stays next to a new `happy.png` (decision 1); no restore point (decision 2)  | Same in the rebuild. Decision 1's follow-up later changed this (see there). |

The editors store nothing else: no local storage, no settings, no remembered
tool or zoom.

## Removed

- The strong wand's cap at a tolerance of 224: the slider's top (128) gives 198,
  so the cap never applies. The rebuild doesn't need it.
- The canvas's `cache: "no-store"` request option: the picture loader ignores
  it for every address it handles.
- A brush colour with its own alpha: the colour picker only gives opaque colours,
  so painting always uses alpha 255.

## Decisions

The rebuild keeps every saved picture, call and argument exactly as above.
Decisions marked **follow-up** change one of those (or which files exist) and
wait for their own pull request after the rebuild. The rest change only what the
editors show. File and line references point into the old code for the reviewer.

1. **Editing a non-PNG sprite leaves two files.** Both editors always hand over
   a PNG, and Rust writes `<name>.png` and leaves `<name>.jpg` (or `.webp`,
   `.gif`, `.avif`, `.svg`) in place (`sprites.rs` 484–507). The tab then lists
   two sprites with the same name (the grid even uses the name as its React key),
   and which one a chat shows isn't defined. The same happens when the stored
   name isn't already in the name rule's form (a hand-placed `Very Happy.png`
   saves as `very_happy.png`). An animated GIF also becomes a still PNG of its
   first frame. "Clean sprites" in the tab already removes the old file when it
   writes a PNG (`sprites.rs` 666–668). **Follow-up:** an editor save replaces
   the sprite's old file whatever its extension (in Rust, or the tab deletes the
   old one after a successful save), and the cleanup editor notes "Saving turns
   this animated GIF into a still picture." for GIFs. No change in the rebuild.
   **Done after the rebuild:** `sprite_upload` and `sprite_upload_bulk` now
   remove the sprite's other files after a successful write: the same name with
   another extension, and the file named by the request's own expression before
   the name rule (`Very Happy.png`). Files the same save wrote always stay. Both
   editors note "Saving turns this GIF into a still picture." for any `.gif`
   (animated or not).
2. **An editor save can't be undone, and can be silently undone.** A frame or
   wand save overwrites the file with no restore point, unlike "Clean sprites",
   which keeps the last 5. And the tab's "undo last cleanup" button stays offered
   after an editor save; using it copies the pre-cleanup file back over the
   editor's work without a word. **Follow-up:** keep the previous file as a
   restore point on editor saves (Rust), and have the tab drop or warn about an
   older cleanup restore point that covers a sprite saved since.
3. **Closing throws away edits without asking.** Cancel, the close button,
   Escape and a backdrop click (cleanup editor) and the X (frame editor) drop
   unsaved changes at once (`SpriteCleanupFooter.tsx` 62, `SpriteWandCleanupEditor.tsx`
   25–31, `SpriteFrameEditor.tsx` 108–116). A stray Escape or a click beside the
   dialog loses a long cleanup. Recommended in the rebuild: when there are
   changes (cleanup: "has changes"; frame: any edge above 0), ask "Discard your
   changes to <label>?" (Discard / Keep editing). Nothing sent changes.
4. **The frame editor may not work on the desktop app.** It draws `imageUrl`
   straight onto a canvas (`SpriteFrameEditor.tsx` 50 and 90, through
   `cropSpriteDataUrl`). On the desktop app that's an asset address on another
   origin, which the browser normally refuses to read back from a canvas. Seen in
   the code, not checked in the app. Recommended, if the desktop check confirms
   it: load the picture as bytes the way the cleanup editor does, turn it into a
   `data:` URL, and crop that. Same pixels when it works today; screen only, in
   the rebuild.
5. **The cleanup editor may not load on a password-protected hosted install.**
   There the sprite address is a `blob:` address only the browser can read, but
   the loader sends it to the server's `load_url_binary` (`url-binary-api.ts`
   85–97), which can't fetch it, so it shows "Sprite image could not be loaded.
   Try again." every time. Seen in the code, not yet reproduced. Recommended, if
   the recording confirms it: decode `blob:` and `data:` addresses in the browser
   (`fetch` reads both) before falling back to `loadUrlBlob`. Same pixels;
   screen only, in the rebuild.
6. **Apply Frame at zero saves an unchanged copy.** With all four edges at 0,
   Apply still re-saves the picture (and, for a JPG, makes the second file of
   decision 1). **Follow-up:** disable Apply frame until an edge is above 0. It
   changes which calls are sent, so not in the rebuild. **Done after the
   rebuild:** Apply frame stays disabled while every edge is 0.
7. **The frame editor opens out of sight.** It appears above the grid while the
   user clicked Frame on a tile that may be far below, and focus stays on the
   tile. Recommended in the rebuild: scroll the panel into view and move focus to
   its heading when it opens or switches sprite; return focus to the tile's Frame
   button when it closes. Screen only.
8. **The frame editor isn't locked while saving.** Only Apply Frame is disabled
   (`SpriteFrameEditor.tsx` 123–131, 142–149); the sliders, Reset and the X stay
   active, and moving a slider during the save doesn't change what's saved.
   Recommended in the rebuild: disable the sliders and Reset while saving (the X
   may stay, as in the cleanup editor). Screen only.
9. **The status line misleads.** It says "Wand ready" whatever tool is chosen
   until something happens (`SpriteCleanupFooter.tsx` 37), and a stroke's
   "N px erased" counts pixels once per stamp, so a short drag can claim several
   times the pixels it touched. Recommended in the rebuild: an idle hint per tool
   ("Click the background to remove it.", "Drag over leftover background to
   clean it.", "Drag to erase.", "Drag to paint." / "Drag to bring back the
   original.", "Drag along jagged edges to smooth them.", "Drag to move the
   view."), and N as the number of distinct pixels the stroke changed. Screen
   only.
10. **Dead ends after a failure.** A picture that fails to load leaves an empty
    stage and "Sprite image could not be loaded. Try again." with no way to try
    again but closing; "Frame preview failed. Try again." can't be fixed by
    trying again. Recommended in the rebuild: a **Try again** button that reloads
    the picture, and "Couldn't show the framed preview." for the preview. Screen
    only.
11. **Picking a see-through pixel picks a hidden colour.** Pick takes the pixel's
    RGB even at alpha 0, which after loading is usually black
    (`useSpriteCleanupEditor.ts` 348–357). **Follow-up** (low priority): refuse
    pixels with alpha 0 ("That pixel is see-through. Pick a visible one."). It
    changes the colour that later strokes paint, so not in the rebuild.
12. **Undo can use a lot of memory.** Up to 24 full copies of the picture are
    kept (12 undo, 12 redo). A 1024×1536 sprite is 6 MB per copy; the largest
    sprite Rust accepts (8192×8192) is 256 MB per copy. Recommended in the
    rebuild (low priority): cap undo and redo together at about 256 MB, never
    fewer than 3 undo steps. Saved pictures don't change.
13. **Accessibility.** Every slider is named by its label plus its value
    ("Tolerance36", "Top0.0%"); the fit button is named only by its percentage
    ("100%"); the preview background buttons ("Dark", "Grid", …) have no group
    name; the status line, errors and the preview failure aren't announced; the
    picture can only be edited with a pointer, and nothing says so; the frame
    editor's close button has a tooltip "Close" that differs from its name.
    Recommended in the rebuild: sliders named by the label alone with the value
    as `aria-valuetext` (as `PercentSlider` does); the fit button named "Fit to
    view" with the percentage as its text; the backgrounds as a group named
    "Preview background"; the status line as a polite live region and errors as
    `role="alert"`; a short description on the canvas ("Click or drag on the
    picture with a mouse, pen or finger. Use Undo to step back."). The grid's
    tile buttons belong to the tabs (named by the stored sprite name only); a
    separate follow-up there. Screen only.
14. **Wording.** Labels are Title Case ("Apply Frame", "Apply Cleanup", "Edge
    Guard"), "Grid" means a checkerboard, "Strong" doesn't say what it does, and
    "Apply Cleanup" is the save button even after painting. Recommended in the
    rebuild: sentence case ("Apply frame", "Edge guard"), "Checkerboard", "Strong
    (reaches further)", the dialog titled "Clean up <label>" and its button "Save
    changes" ("Saving…" while saving). The status texts may follow the same case
    rule. Screen only.
15. **No way to compare with the original.** There's no before/after view; the
    only way to see the original is Reset or many Undos. Recommended (optional, in
    the rebuild): a press-and-hold **Show original** button that shows the
    original while held. Screen only.
16. **Ctrl+wheel may zoom the whole page too.** The stage's wheel handler calls
    `preventDefault`, but React attaches wheel listeners as passive, so in a
    browser Ctrl+wheel probably zooms both the picture and the page
    (`useSpriteCleanupEditor.ts` 628–633). Not yet checked. Recommended in the
    rebuild, if the recording confirms it: listen for the wheel with a non-passive
    listener so only the picture zooms. Screen only.

## Tests

No tests cover the old editors. New behavior tests, built from the recordings
(see "Black-box recording plan"):

- **Wand pixels** (plain unit tests on RGBA, no canvas): for each recorded case,
  the exact output picture and N: a background corner, an enclosed background
  island (not reached), a one-pixel diagonal channel (reached with Strong, not
  without), see-through clicks, tolerance 4 / 36 / 128, Strong on and off,
  softness and feather at 0, the defaults and 100, a partly see-through region.
- **Brush pixels:** each mode at sizes 2, 18 and 96, hardness 0 / 50 / 100,
  opacity 0 / 50 / 100, a press-only stroke, a multi-move stroke with fractional
  stamps, a stroke that leaves and re-enters the picture, Clean with edge guard 0
  and 100 and feather 0 and 100, Clean with a see-through target, Blur at 0 / 65 /
  100, Restore after a wand click.
- **History:** 13 changes then 13 undos (12 work), redo, a new change clears
  redo, Reset, "has changes" after undoing back to the original, the shortcuts
  and when they're ignored.
- **Frame:** the 80 and pair-of-90 limits; Apply crops the picture from the file
  with the shown values; the preview failure line.
- **Saving:** for a character and a persona sprite, portrait and `full_`, the
  `sprite_upload` arguments and the decoded pixels of the image; the tab's toasts
  and the editor closing on success, staying open on failure.
- **Screens:** zoom limits and steps, fit (never above 100%), pan, the readout
  text, the status texts, background buttons, disabled states while loading and
  saving.
- New: decisions 3, 4, 5 and 16 (if confirmed), 7, 8, 9, 10, 12, 13, 14 (and 15 if
  built).

Test what people see, what's saved and the pixels. Compare decoded pixels, never
PNG bytes. The tests that load or encode PNGs need a real canvas, so run them in
the browser (Playwright), not jsdom. Don't read source files as text.

## Acceptance checks

1. From a character's Sprites tab, clicking a sprite opens "Clean <name>"; a wand
   click on the background removes it; Apply saves; the tile shows the cleaned
   sprite and the toast says "Cleaned <name> sprite.".
2. Each brush changes the picture as recorded; Undo, Redo and Reset behave as
   described, by button and shortcut.
3. Framing a sprite saves exactly the cropped picture; the limits hold.
4. A full-body sprite (Full-body category) saves under its `full_` name; a
   persona's sprite saves to the persona.
5. Every recording replays with the same calls, arguments and decoded pixels.
6. Existing sprites (any extension, any size up to Rust's limits) open in both
   editors on the desktop app, a hosted install without a password and one with
   a password (decisions 4 and 5).
7. Keyboard only: every control has a name and can be reached; the cleanup
   dialog traps focus and closes with Escape (after decision 3's question when
   there are changes).
8. Phone width and the Pond, Default and SillyTavern themes in light and dark
   look right; the tools wrap and the stage stays usable.
9. A large sprite (1024×1536 or more) loads, fits, zooms and saves without the
   tab freezing.
10. `pnpm typecheck`, `pnpm check:architecture`, `pnpm check:text-size` and the
    tests pass, and the old files in "Scope" are gone.

## Black-box recording plan

For whoever records the old editors before they're deleted (not the builder).
Two layers: **pixel recordings** of the old pixel rules (exact, no canvas), and
**screen recordings** of the old editors in headless Chrome (calls, texts and
saved pictures).

### Test pictures

Make them with a small script in the recorder's scratch folder (not the repo),
keep each as a PNG and as raw RGBA (base64), and use the same ones in both
layers. Small sizes keep fixtures small and make the stage show them at 100%.

- **A, `happy.png`, 96×96:** background (240, 240, 240, 255); a filled circle of
  radius 30 at the centre in (200, 60, 90, 255) with a 2 px anti-aliased edge
  (blend steps toward the background) and a 1 px dark outline (30, 20, 40, 255);
  a pale fringe (225, 215, 220, 255) one pixel wide outside the outline on the
  left half; inside the circle, an island of background colour (8×8) that isn't
  connected to the outside; a one-pixel-wide diagonal line of background colour
  crossing the outline from outside to inside (connected only through corners);
  a 10×10 block at alpha 128 in a corner; and one 3×3 block at alpha 0.
- **B, `full_idle.png`, 96×128:** the same idea on a green background
  (0, 255, 0, 255), for the full-body category.
- **C, `sad.jpg`:** a JPEG version of A (records decision 1).
- **D, `Very Happy.png`:** a copy of A placed directly in the sprite folder
  (the upload would rename it; records decision 1's name case).
- **E, `big.png`, 1024×1536:** any picture (zoom and fit only, no pixel checks).
- **F:** a persona with a copy of A as `happy.png`.

### Pixel recordings (exact)

In a throwaway script in the recorder's scratch folder (vitest or node), import
the old pure functions from `src/shared/components/ui/sprite-wand-cleanup/`
(`removeWandSelection` from `sprite-cleanup-wand.ts`, `applyBrushStamp` and
`applyBrushLine` from `sprite-cleanup-brush.ts`) and run them on plain
`{ width, height, data }` objects of the test pictures' RGBA. Call them the way
the editor does:

- **Wand click:** `removeWandSelection(picture, x, y, tolerance, { neighborMode,
edgeGuard, expand, softness, feather })` with the values from the wand's
  parameter table (Strong off: tolerance as set, `"cardinal"`, 55, 1; Strong on:
  `min(224, round(tolerance × 1.55))`, `"all"`, 28, 2; softness and feather as
  set, 0–100).
- **Stroke:** for points p0, p1, …: `applyBrushStamp(current, original, p0.x,
p0.y, options)` then `applyBrushLine(current, original, p(i−1), p(i), options)`
  for each next point, where `options` is `{ mode, radius }` plus `hardness`,
  `opacity` (Erase, Restore), `paint: { color: [r, g, b, 255] }` with hardness and
  opacity (Color), `clean: { target, tolerance, edgeGuard, feather }` (Clean;
  target = the current RGBA at p0) or `blurStrength` (Blur); radius =
  max(1, size ÷ 2); all sliders as 0–100 numbers.

Record, per case: the picture (by name), the inputs in the spec's terms (tool,
settings, Strong, click point or stroke points), the output RGBA and the returned
counts (the wand's removed count and target; the sum of stamp counts for a
stroke). Cases: the lists under "Tests" (wand pixels, brush pixels). Store them as
`src/features/catalog/sprites/editors/test-fixtures/pixel-cases.json` (or hand
them to the builder to place).

### Screen recordings

- Drive the web build in headless Chrome (pinned version, locale `en-US`, device
  scale factor 1, viewport 1280×900) against a throwaway server with a copy of
  test data (never the live install). Put pictures A–F in the test character's
  and persona's sprite folders before starting.
- Intercept `POST /api/invoke` (body `{ command, args }`) and record `command`
  and `args` of every call, in order. Let `sprite_list`, `sprite_upload`,
  `sprite_capabilities_command` and `load_url_binary` go through to the
  throwaway server, and list the sprite folder after each save (file names and
  sizes).
- **Faked replies** only where a scenario says so: a failed `sprite_upload` as
  HTTP 500 with `{ "code": "sprite_save_failed", "message": "disk full" }` (generic:
  the fallback shows) and with `{ "code": "invalid_image", "message": "That file
isn't an image De-Koi can use. Pick a PNG, JPG, WEBP or GIF file." }` (worded:
  its message shows); a slow `sprite_upload` (delay 3 s, then let it through). A
  successful `sprite_upload` reply, if faked, is `{ "expression": "happy",
"filename": "happy.png", "absolutePath": "/tmp/happy.png", "ownerId": "<id>",
"ownerType": "character", "size": 1234, "cacheKey": "1", "url": "" }`; a
  `load_url_binary` reply is `{ "base64": "<bare base64>", "mimeType":
"image/png" }`.
- **Saved pictures:** take `args.body.image` from each `sprite_upload`, decode
  the PNG to RGBA in Node with a PNG library installed in the scratch folder (not
  added to the repo), and record width, height and RGBA (base64), plus the data
  URL itself so the replay test can decode old and new the same way in the same
  browser.
- **Pointer input:** with the picture at 100%, pixel (x, y) is at the canvas
  box's left + x + 0.5, top + y + 0.5. Use `page.mouse.down/move/up` and record
  every point sent (don't rely on `steps`), so the replay sends the same events.

**Labels and roles to drive the controls** (scope lookups to the dialog or the
panel; the tab has its own buttons with similar names):

- **Open:** the character editor's Sprites tab; categories "Facial Expressions"
  and "Full-body". Cleanup editor: the tile's picture button (name = the stored
  sprite name, e.g. "happy"; tooltip "Open wand cleanup"). Frame editor: the
  tile's button named "Frame" (icon only, named by its tooltip; shown on hover
  on desktop, always on phones; hover the tile first).
- **Cleanup dialog:** `role="dialog"` named "Clean <label>"; close button "Close
  Clean <label>". Tools: buttons "Wand", "Clean", "Erase", "Brush", "Blur" (with
  `aria-pressed`), "Pan", "Zoom out", "Zoom in"; the fit button has no name of
  its own (its text is the percentage, e.g. "100%"; tooltip "Fit to view").
  Wand: button "Defaults", checkbox "Strong", sliders whose names start with
  "Tolerance", "Softness", "Feather" (the value is glued on, e.g. "Tolerance36";
  match `/^Tolerance/`; set with `fill`). Brushes: slider starting "Brush" (not
  the "Brush" tool button: use role `slider`), "Tolerance", "Edge Guard",
  "Feather", "Opacity", "Hardness", "Strength"; mode buttons "Color" and
  "Restore"; the colour input labelled "Brush color" (set with `fill("#3366cc")`);
  toggle "Pick". Backgrounds: "Dark", "Grid", "Light", "Pink". Canvas: the
  `canvas` labelled "Wand cleanup canvas for <label>" (no role). Footer: "Undo",
  "Redo", "Reset", "Cancel", "Apply Cleanup"; the status and readout are plain
  text (no role) in the footer.
- **Frame panel:** heading text "Frame <label>" (not a heading element), close
  "Close frame editor", sliders whose names start with "Top", "Bottom", "Left",
  "Right" (value glued on, e.g. "Top0.0%"), buttons "Reset" and "Apply Frame";
  the preview `img` with alt = label.
- **Toasts:** the sonner toast text.

**Scenarios** (must-have first). For each, record the calls, the texts shown, the
files after any save and the decoded saved pictures.

1. Cleanup on A, defaults: record the dialog name, the initial status ("Wand
   ready"), readout before and while hovering (5, 5), zoom "100%", pressed tool
   and background. Wand click at (2, 2). Apply Cleanup; record the
   `sprite_upload` args, saved pixels, toast, file list.
2. Wand with Strong on, Tolerance 80, Softness 0, Feather 0, click (2, 2); Save.
3. Wand at Softness 100, Feather 100, click (2, 2); Save.
4. Wand click on the alpha-0 block: status, Apply still disabled.
5. Wand click on the enclosed island, then on the diagonal channel with Strong
   off and on (separate opens); Save each.
6. History: 13 wand clicks at different background points, then Undo 13 times by
   button (record which are enabled), Redo twice by Ctrl+Y, once by
   Ctrl+Shift+Z, Undo by Ctrl+Z, Reset; Apply disabled at the end.
7. Erase: Brush 18, Opacity 50, Hardness 0, a stroke of 6 points across the
   circle's edge; status; Save.
8. Brush Color: `#3366cc`, Hardness 50, a stroke; Pick on a circle pixel (record
   the colour shown), Pick on the alpha-0 block (decision 11); a second stroke;
   Save.
9. Brush Restore: wand click (2, 2), then a Restore stroke over part of the
   removed background at Opacity 100 and another at Opacity 40; Save.
10. Clean: a stroke starting on the pale fringe with Edge Guard 0, and again
    (new open) with Edge Guard 100 and Feather 100; Save each.
11. Blur: Strength 65 along the circle's anti-aliased edge after a wand click;
    Save.
12. A stroke that leaves the canvas and comes back in the middle; Save.
13. Screen only: Zoom in ×3, Zoom out ×1, Ctrl+wheel up ×2 and down ×1, fit;
    record each percentage and the canvas's shown size; Pan tool drag and a
    middle-button drag (record the stage's scroll); whether Ctrl+wheel also zooms
    the page (`visualViewport.scale`, decision 16); each background (record the
    stage's background colour); on E, the fitted percentage.
14. Closing with changes: Cancel, the close button, Escape and a backdrop click,
    each after a wand click; record that no `sprite_upload` is sent (decision 3).
15. Save failures: generic and worded `sprite_upload` errors; record the toast
    and that the dialog stays open with the edit (press Apply again: the same
    call is sent).
16. Close during a slow save (Escape after Apply): record whether the upload
    completes, the toast, and the list.
17. Full-body: category Full-body, open B: dialog "Clean idle", `expression`
    `"full_idle"`; Save.
18. Decision 1: cleanup on C (`sad.jpg`) and on D (`Very Happy.png`); Save; the
    file lists (expect `sad.jpg` + `sad.png`, `Very Happy.png` +
    `very_happy.png`) and what the tab shows.
19. Persona: scenario 1 on F from the persona's Sprites tab (`ownerType`
    `"persona"`, `characterId` = the persona id).
20. Frame on A: Top 10, Left 80, then Right 20 (record Left dropping to 70),
    Bottom 5; record the preview's size; Apply Frame; record args, saved pixels
    and size, toast, the panel closing.
21. Frame: Reset, then Apply with all at 0 (records decision 6); then frame on C
    (records decision 1 for frames).
22. Frame: open on A, set Top 20, then click Frame on another sprite (values back
    to 0); a save failure (toast, panel stays); change a slider during a slow
    save (decision 8).
23. Loading failure: block the picture's load (route the `/api/assets/…` request
    or the `load_url_binary` call to an error); record the status text.
24. Password-protected hosted install: set a password on the throwaway server,
    sign in, open both editors on A; record the `load_url_binary` call and its
    `url`, what each editor shows, and whether a save works (decisions 4 and 5).
25. Desktop app (manual, if possible): open the frame editor on a sprite and
    record whether the preview crops and Apply saves (decision 4); open the
    cleanup editor and save one wand click.

Store the screen recordings like the generation dialog's
(`test-fixtures/recorded-calls.json`), with picture fields replaced by labels and
the decoded pixels kept beside them.

### Comparing

- Calls: `command` and `args` exactly, except `args.body.image`, compared as
  decoded pixels (width, height, RGBA), never as PNG bytes.
- Pixel recordings: exact RGBA.
- Screen recordings: exact RGBA when old and new pictures are decoded the same
  way in the same Chrome build (both editors make PNGs through the canvas, so
  see-through pixels are (0, 0, 0, 0) and partly see-through colours are rounded
  the same way). If a different decoder is used, alpha must match exactly and
  colours exactly wherever alpha is 255.
- Texts: exact, in `en-US`.
