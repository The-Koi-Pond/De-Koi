# Sprite Generation: Behavior Spec

Status: agreed 2026-11-19 (all decisions as recommended). Part of the code provenance
plan (`docs/code-provenance-plan.md`, tracked in #1580).

This spec describes what the sprite generation dialog must do: turning an
appearance description into a sheet of expression or full-body sprites with an
image generation connection, letting the user fix the cuts, frame and clean up
each sprite, name them, and save them to a character or persona. It is the only
input the builder uses for the dialog. It describes behavior, not the old
implementation.

## Rules for the builder

Build from this spec and the team-owned code around it. Don't open, search, or
read the history of the old implementation:

- `src/shared/components/ui/SpriteGenerationModal.tsx`

Also don't open these, even though they aren't rebuilt here. They aren't
team-owned yet and will be rebuilt as their own module, so nothing should be
copied from them:

- `src/shared/components/ui/SpriteFrameEditor.tsx` (the saved-sprite frame
  editor; it has a similar frame control)
- everything in `src/shared/components/ui/sprite-wand-cleanup/`

You may read every interface listed under "Neighbors", including the Rust side
(`src-tauri/src/commands/storage/sprites.rs`, `images.rs`), which isn't rebuilt
here. `ImagePromptReviewModal.tsx` is a shared neighbor that isn't team-owned
yet: import it and read its exported types and props, but don't copy its markup.
If this spec doesn't answer a question, ask the spec writer.

**Safety.** The dialog sends paid image requests and writes sprite files, so the
plan's safety rules 2, 4 and 5 apply:

- Before the old file is deleted, someone other than the builder records the
  old dialog as a black box (see "Black-box recording plan"): the exact command
  calls and bodies it sends for a set of user steps, and what it shows for
  recorded replies. The recordings become tests. The builder sees the
  recordings, never the old code.
- The rebuild sends exactly the commands and bodies described here, in the same
  order, and saves the same file names. Decisions that would change a body, the
  calls sent, or the saved names are marked "follow-up" and go in their own pull
  request after the rebuild.
- Independent checks (tests, spec coverage, odd input) before merging.

## Scope

Lines not yet team-owned, from `node scripts/code-provenance.mjs --fast` at
`b5df84f4a6`:

**Replaced, then deleted:**

| File                                                 | Not owned | Of lines |
| ---------------------------------------------------- | --------: | -------: |
| `src/shared/components/ui/SpriteGenerationModal.tsx` |     1,583 |    1,683 |

That's **1,583 lines** not yet team-owned, in one file holding the setup step,
the waiting step, the review step, the cut and frame tools, the matched
full-body batch runner and the save loop.

**Why only this file.** The dialog's close helpers were checked and left out:

| File                                                  | Not owned | Of lines | Why it isn't in scope                                                                 |
| ----------------------------------------------------- | --------: | -------: | ------------------------------------------------------------------------------------- |
| `src/shared/lib/sprite-frame-crop.ts`                 |         0 |       62 | Already team-owned; shared with `SpriteFrameEditor`.                                  |
| `src/shared/components/ui/ImagePromptReviewModal.tsx` |       116 |      126 | Shared with avatar generation and `ImagePromptReviewHost`. A small module of its own. |
| `src/shared/components/ui/ImagePromptReviewHost.tsx`  |        30 |       64 | Not used by this dialog.                                                              |
| `src/shared/api/image-generation-api.ts`              |        41 |      176 | Shared wrapper for all image, gallery and sprite commands.                            |
| `src/shared/components/ui/SpriteFrameEditor.tsx`      |       120 |      126 | Used by the Sprites tabs for saved sprites, not by this dialog.                       |
| `src/shared/components/ui/sprite-wand-cleanup/*`      |     2,328 |    2,347 | Used by the Sprites tabs for saved sprites, not by this dialog.                       |
| `src-tauri/src/commands/storage/sprites.rs`           |     1,447 |    3,738 | Rust storage; a later, riskier module (safety rule 1).                                |
| `CharacterSpritesTab.tsx`, `PersonaSpritesTab.tsx`    |         5 |      750 | Team-owned callers.                                                                   |

The frame editor and the wand cleanup folder are the natural next module, "saved
sprite editors" (2,448 lines not yet team-owned).

**Tests:** none exist for the dialog. Nothing reads its source as text.

### Neighbors (not rebuilt)

- **Callers:** `CharacterSpritesTab.tsx` and `PersonaSpritesTab.tsx` mount the
  dialog once and keep it mounted, toggling `open`. They pass: `open`, `onClose`,
  `entityId` (the character or persona id), `entityKind` (`"persona"` from the
  persona tab; the character tab leaves it out, meaning `"character"`),
  `initialSpriteType` (`"full-body"` when the tab's Full-body category is shown,
  else `"expressions"`), `existingExpressionNames` (the names of the owner's
  saved sprites that don't start with `full_`), `defaultAppearance`,
  `defaultAvatarUrl` (or null), `imageConnections`, `spriteCapabilities` and
  `onSpritesGenerated` (they refresh the sprite list). Keep these props, or
  update both callers in the same change.
- **Command wrapper:** `spriteApi` in `src/shared/api/image-generation-api.ts`:
  `generateSheetPreview(body)`, `generateSheet(body)`, `cleanup(body)`,
  `upload(ownerId, body, { ownerType })`. Each passes the body as `{ body }`.
  Unchanged (see decision 4).
- **Rust:** `sprite_generate_sheet_preview`, `sprite_generate_sheet`,
  `sprite_cleanup`, `sprite_upload` in `sprites.rs`, through
  `commands/storage/commands/media.rs` (desktop) and `http_dispatch.rs` (hosted).
  How Rust reads the body: `image_generation_options` and `image_prompt_override`
  in `images.rs`, `build_sprite_plan` in `sprites.rs`.
- **Prompt review:** `ImagePromptReviewModal` (`open`, `items`, `isSubmitting`,
  `onCancel`, `onConfirm(overrides)`), with the types `ImagePromptReviewItem`
  and `ImagePromptOverride`.
- **Negative prompt:** `compileImagePrompt` and `spriteImageNegativePrompt` from
  `src/engine/generation/image-style-profiles.ts`.
- **UI store:** `reviewImagePromptsBeforeSend` (Settings > "Expose image prompts
  before sending") and `imageStyleProfiles`.
- **Other pieces:** `Modal` (title, close button named "Close <title>", Escape
  and backdrop close, focus trap), `cropSpriteDataUrl` and
  `SpriteFrameAdjustments` (`src/shared/lib/sprite-frame-crop.ts`),
  `getErrorMessage` / `toUserMessage`, `isDefaultImageGenerationConnection` and
  `ImageGenerationConnectionOption`, `SpriteCapabilities`.

## The shape

- **One dialog, three steps:** setup, generating, review. Steps are internal
  state of one dialog titled "Generate sprites" (decision 16 for the case).
- **Two sprite types:** expressions (portraits) and full-body. Full-body has a
  second way in, **matched batches**: full-body sprites named after the owner's
  existing portrait expressions, generated four at a time.
- **Layers:** the request body, the expression and pose lists, name rules,
  batch planning and the cut geometry are plain TypeScript with no React; the
  dialog is components. A suggested home is
  `src/features/catalog/sprites/generation/` (`lib/` and `components/`),
  exported through `src/features/catalog/sprites/index.ts`, which both tabs
  already import. The old file sits in `src/shared/components/ui` but only the
  two catalog tabs use it.
- **Commands go through `spriteApi` only.** The dialog never calls
  `invokeTauri` itself.

## The command contract

The dialog calls exactly four commands, all through `spriteApi`. Each command's
arguments are shown as sent to `invokeTauri` (on hosted installs these are the
`args` in the `POST /api/invoke` body `{ command, args }`). Fields shown as
"omitted" are left out of the JSON entirely. Key order doesn't matter.

### The generation body

Used by both `sprite_generate_sheet_preview` and `sprite_generate_sheet`, as
`{ body: <generation body> }`:

| Field                    | Type     | Value                                                                                                                                                                                                             |
| ------------------------ | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `connectionId`           | string   | The chosen connection's id (see "Connection").                                                                                                                                                                    |
| `appearance`             | string   | The Appearance box exactly as typed, not trimmed.                                                                                                                                                                 |
| `referenceImages`        | string[] | The reference pictures (see "Reference pictures"), at most 4, the avatar first. **Omitted** when there are none.                                                                                                  |
| `expressions`            | string[] | The names to draw, in order (see "Expressions and poses" and "Matched batches").                                                                                                                                  |
| `cols`                   | number   | Grid columns.                                                                                                                                                                                                     |
| `rows`                   | number   | Grid rows.                                                                                                                                                                                                        |
| `spriteType`             | string   | `"expressions"` or `"full-body"`: the type selected at the moment Generate runs.                                                                                                                                  |
| `fullBodyExpressionMode` | boolean  | `true` only for matched batches; else `false`.                                                                                                                                                                    |
| `nativeTransparentPng`   | boolean  | The "Prefer transparent PNG" box.                                                                                                                                                                                 |
| `negativePrompt`         | string   | See below. **Omitted** when empty.                                                                                                                                                                                |
| `noBackground`           | boolean  | Always `false`. The dialog cleans backgrounds itself afterwards, so Rust always returns the provider's raw output.                                                                                                |
| `promptOverrides`        | array    | Only on `sprite_generate_sheet` after the prompt review was confirmed: the review's overrides, each `{ id, prompt, negativePrompt? }` exactly as `ImagePromptReviewModal` hands them over. **Omitted** otherwise. |

**Negative prompt:** call `compileImagePrompt` with kind `sprite`, an empty
prompt, the negative prompt from `spriteImageNegativePrompt` given the selected
sprite type and whether this is a matched batch, the style profiles from the UI
store, and their default profile id as the profile. Take the compiled negative
prompt, trimmed. So matched batches and plain full-body sheets get different
negative prompts.

### Commands

| Command                         | Arguments                                                                        | When                                                                                    |
| ------------------------------- | -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `sprite_generate_sheet_preview` | `{ body: <generation body without promptOverrides> }`                            | Before each generation request, only while "Expose image prompts before sending" is on. |
| `sprite_generate_sheet`         | `{ body: <generation body> }`                                                    | Each generation request.                                                                |
| `sprite_cleanup`                | `{ body: { cleanupStrength, engine: "auto", cells: [{ expression, base64 }] } }` | Background cleanup, after generation or on Apply cleanup.                               |
| `sprite_upload`                 | `{ characterId, ownerType, body: { expression, image } }`                        | Once per saved sprite, one at a time.                                                   |

- **Cleanup body:** `cleanupStrength` is the strength slider's whole number
  (0 to 100, starts at 35); `engine` is always `"auto"`; `cells` lists every
  sprite being cleaned, in grid order, with `expression` its current name as
  held (not the save form) and `base64` its **original** picture (not the
  cleaned one) as a full data URL, `data:` prefix included.
- **Upload arguments:** `characterId` is the owner's id for both owner types
  (personas too); `ownerType` is `"character"` or `"persona"`; `expression` is
  the save name (see "Saving"); `image` is the sprite's shown picture as a data
  URL (always `data:image/png;base64,…`).

### Replies the dialog reads

- **Preview:** `items`, a list of `ImagePromptReviewItem`
  (`id`, `kind`, `title`, `prompt`, `negativePrompt`, `width`, `height`). An empty
  list skips the review and sends the plain generation request.
- **Generation:** `sheetBase64` (bare base64 of the whole sheet; an empty string
  means the reply has no sheet, for example when Rust drew each expression
  separately), `cells` (each `{ expression, base64 }`, bare base64 of one
  sprite), and `failedExpressions` (optional, each `{ expression, error }`). The
  dialog shows every picture as `data:image/png;base64,` plus the base64,
  whatever the provider's format.
- **Cleanup:** `cells`, matched to the sent cells **by position**. A position
  with no `base64` keeps that sprite's current picture. The other reply fields
  (`engine`, counts) aren't read.
- **Upload:** nothing is read.

A command error is shown through `getErrorMessage` with the fallback named in
each section below. Today that shows the error's own text only for codes
`toUserMessage` treats as already worded (provider errors such as
`*_provider_error`, `remote_runtime_*`, `rate_limited`,
`request_body_too_large`); every other error shows the fallback (decision 5).

## Opening, closing and resets

The callers keep the dialog mounted, so its state lives between opens.

- **Close:** the dialog's close button ("Close <title>"), Escape, the
  backdrop, and Cancel on the setup step all close it at any step, including
  while generating or saving. Nothing is cancelled: a running request finishes
  in the background and its results land in the hidden dialog.
- **Each time it opens:** the sprite type becomes `initialSpriteType`, the count
  becomes 6 (2×3), the picks become that count's default list for that type,
  and "Match existing expression sprites", "Prefer transparent PNG" and the
  review step's "Transparent background" turn off. The step, results, error,
  appearance text, reference pictures, chosen connection and cleanup strength
  are kept as they were (decision 1).
- **When the owner changes** (any of `entityId`, `entityKind`,
  `defaultAvatarUrl`, `defaultAppearance`; also once on mount): the appearance
  becomes `defaultAppearance` (or empty), uploaded reference pictures are
  cleared, "Use current avatar" turns on when there is an avatar and off when
  there isn't, the step goes back to setup, all results, the paused batch, the
  progress line, the cut settings and the frame editor are cleared, matching,
  "Prefer transparent PNG" and "Transparent background" turn off, and the error
  is cleared. The type, count, picks,
  connection and strength are kept.

## Setup step

Top to bottom:

1. **Type tabs:** "Expressions (portrait)" and "Full-body", the current one
   highlighted. Choosing Expressions sets the picks to the current count's
   expression list and turns matching off. Choosing Full-body sets the picks to
   the current count's pose list (matching is left as it was).
2. **Error banner** (when there is an error) and, when
   `spriteCapabilities.spriteGenerationAvailable` is false, a note with
   `spriteCapabilities.reason` (else "Sprite generation is unavailable on this
   platform.").
3. **Connection** (see below).
4. **Reference pictures** (see below).
5. **Appearance** text box, three rows, placeholder "blue eyes, blonde hair,
   anime style, wearing a hoodie, female, chubby...".
6. **Prefer transparent PNG** box, with the note "Adds transparent-output
   instructions when the selected model supports them, then applies cleanup
   before review when needed." Turning it on also turns on the review step's
   "Transparent background"; turning it off turns that off too. While on, and
   the chosen connection's model (trimmed, any case) is `gpt-image-2` or starts
   with `gpt-image-2-`, a second note: "GPT-Image-2 does not support native
   transparent backgrounds right now, so cleanup is the fallback."
7. **Count and picks** (see "Expressions and poses") or the matched-batch panel.
8. **Footer:** Cancel (closes) and the Generate button.

### Connection

Label "Image generation connection". With no connections: the text "No image
generation connections found. Add one in Settings → Connections with the "Image
Generation" provider type." Otherwise a select listing each connection as its
name, then " — <model>" when it has a model, then " (Default)" when
`isDefaultImageGenerationConnection` says so. Until the user picks one, the
selection is the first default connection, else the first in the list. The
user's pick is kept across opens.

### Reference pictures

Label "Reference images (optional, up to 4)", with the hint "Upload reference
images of the character to improve consistency. Multiple angles or the existing
avatar work well."

- **Current avatar:** shown only when `defaultAvatarUrl` is set: a box "Use
  current avatar as a reference image" with a thumbnail. While on, the avatar
  shows first in the row with an "Avatar" badge. Turning it on keeps only the
  first 3 uploaded pictures.
- **Uploads:** an Upload tile opens a file picker for one image file. The file
  is read as a data URL (its own type, no resizing or size check) and added to
  the end. The tile shows while there are fewer than 3 uploads with the avatar
  on, or fewer than 4 otherwise. Each upload has a remove button.
- **Sent as** `referenceImages`: the avatar (when its box is on and there is an
  avatar), then the uploads in order, cut to 4. The avatar is sent as whatever
  string `defaultAvatarUrl` is.

### Expressions and poses

The counts are the same for both types, shown as buttons labelled exactly
`1 (1×1)`, `6 (2×3)`, `9 (3×3)`, `12 (3×4)`, `16 (4×4)` (the label is the
count and the grid as columns × rows). The section is "Expression count" or
"Pose count". Choosing a count sets the picks to that count's default list for
the current type, dropping any custom picks.

**Default expression lists:**

| Count    | Grid | Expressions, in order                                                                                                                            |
| -------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1 (1×1)  | 1×1  | neutral                                                                                                                                          |
| 6 (2×3)  | 2×3  | neutral, happy, sad, angry, surprised, smirk                                                                                                     |
| 9 (3×3)  | 3×3  | neutral, happy, sad, angry, surprised, scared, disgusted, thinking, laughing                                                                     |
| 12 (3×4) | 3×4  | neutral, happy, sad, angry, surprised, scared, disgusted, thinking, laughing, crying, determined, confused                                       |
| 16 (4×4) | 4×4  | neutral, happy, sad, angry, surprised, scared, disgusted, thinking, laughing, crying, blushing, smirk, embarrassed, determined, confused, sleepy |

**Default pose lists:**

| Count    | Poses, in order                                                                                                        |
| -------- | ---------------------------------------------------------------------------------------------------------------------- |
| 1 (1×1)  | idle                                                                                                                   |
| 6 (2×3)  | idle, walk, battle_stance, casting, defend, victory                                                                    |
| 9 (3×3)  | idle, walk, run, battle_stance, attack, defend, casting, hurt, victory                                                 |
| 12 (3×4) | idle, walk, run, battle_stance, attack, defend, casting, hurt, jump, thinking, cheer, victory                          |
| 16 (4×4) | idle, walk, run, battle_stance, attack, defend, casting, hurt, jump, thinking, cheer, victory, wave, sit, kneel, point |

**All expressions** (the chips, in this order): neutral, happy, sad, angry,
surprised, scared, disgusted, thinking, laughing, crying, blushing, smirk,
embarrassed, determined, confused, sleepy. **All poses:** idle, walk, run,
battle_stance, attack, defend, casting, hurt, jump, thinking, cheer, victory,
wave, sit, kneel, point. Chips show the name with `_` as a space and a capital
first letter; the stored and sent value is the plain name.

**Picking** (section "Expressions (N selected)" or "Poses (N selected)"; a
picked chip is highlighted):

- Clicking a picked chip removes it.
- With the 1×1 count, clicking an unpicked chip makes it the only pick.
- Otherwise an unpicked chip is added at the end; when the picks already fill
  the grid, the oldest pick is dropped first.
- The picks keep their order; that order is the `expressions` sent, cut to the
  grid's size.

**Hint under the chips:** with 1×1, "Generate one portrait sprite. Pick the
expression you want to render." or "Generate one full-body pose image. Pick the
pose you want to render."; otherwise "Select exactly N expressions for a C×R
grid. Extra or fewer expressions will be adjusted." or "Select exactly N general
poses for a C×R full-body sheet." (decision 11).

Fewer picks than the grid holds are allowed: the request keeps the count's
`cols` and `rows` and sends only the picked names.

### Matched batches (full-body only)

- **The box** "Match existing expression sprites" shows on the Full-body tab only
  when there is at least one existing portrait name, with the note "Generates
  idle full-body sprites named after the portrait expressions, saved as
  full_neutral, full_happy, and so on."
- **The names:** each of `existingExpressionNames` trimmed, lowercased, every
  character other than `a`–`z`, `0`–`9`, `_` and `-` turned into `_`, and a
  leading `full_` removed; empty names and repeats dropped, first seen kept, in
  the given order. The first 16 are used.
- **Matched mode is on** when the type is Full-body, the box is on, and there is
  at least one name. Then the count and pose picks are hidden and a panel shows
  "Matched expressions (N)", "B batch(es) of up to 4", "First 16 used" when there
  were more than 16, the names as chips (`_` as spaces), and the note "Each batch
  generates a 2×2 idle full-body sheet for higher per-sprite resolution and
  cleaner slicing. Only the face and mood should change to match the expression
  name." (decision 11).
- **Batches:** the names split into groups of 4 in order. A batch's grid: 1 name
  is 1×1, 2 names are 2 columns × 1 row, 3 or 4 names are 2×2. Each batch is one
  generation body with that batch's names, its grid, `spriteType` `"full-body"`
  and `fullBodyExpressionMode` `true`.
- **The overall grid** (for the review's column count and the one-sprite check)
  follows the number of names: 1 is 1×1, 2 is 2×1, 3 is 3×1, 4 is 2×2, 5–6 are
  3×2, 7–9 are 3×3, 10–12 are 4×3, 13–16 are 4×4.

### Generate button

Disabled while sprite generation is unavailable (with the reason as its
tooltip), with no connection, with no picks, or while the appearance is blank
after trimming (decision 17). Its label: "Generate matched batches" (matched
mode), "Generate pose" or "Generate pose sheet" (Full-body, 1×1 or not),
"Generate sprite" or "Generate sheet" (Expressions, 1×1 or not).

## Generating

Pressing Generate clears the error, all results, the paused batch, the progress
line, the cleanup state and the frame editor, resets the cut settings to zero
for the grid (one column cut per inner column line and one row cut per inner row
line of the grid, or of the batch grid in matched mode), and shows the waiting
step:

- A spinner and a heading: "Generating matched full-body batches...",
  "Generating full-body pose…", "Generating full-body pose sheet…", "Generating
  portrait sprite…" or "Generating expression sheet…".
- The progress line (matched mode only, below).
- A note: matched mode "Each 2×2 batch gets one automatic retry before pausing
  for your decision."; full-body sheet "This may take 30–60 seconds depending on
  the provider. The sheet will be sliced into poses after generation."; the
  others "This may take 30–60 seconds depending on the provider."

### One request (everything except matched mode)

1. **Prompt review** (only while the setting is on): send
   `sprite_generate_sheet_preview`. When its `items` aren't empty, open the
   review with them. Cancel (or the review closing any other way): back to
   setup, no error, nothing more sent. Generate: send `sprite_generate_sheet`
   with `promptOverrides`. When `items` is empty: send the plain request.
2. **Without the review:** send `sprite_generate_sheet`.
3. **Results:** one result per reply cell, in order, named by the cell's
   `expression`, all selected, each remembering the reply's sheet (when it has
   one), the sheet's grid and its position on it.
4. **Cleanup after generation:** when "Transparent background" is on (only
   through "Prefer transparent PNG" at this point), send `sprite_cleanup` for all
   results and show the cleaned pictures; the cleanup counts as applied.
5. **Show the review step.** When the reply had `failedExpressions`, the banner
   says "Some expressions failed to generate: a, b. You can regenerate them
   individually." (or "Some poses failed to generate: …" for Full-body)
   (decision 11).
6. **Errors:** a failed preview, generation or after-generation cleanup goes
   back to setup with the error "Image generation failed. Try again." (or the
   worded text), and every result is discarded (decision 2).

### Matched batches

The batches run one after another. For each batch:

1. The progress line shows "Batch N of M: name, name" (names with `_` as
   spaces), with " (retrying once)" after "M" on the second try.
2. Up to **two tries**. A try is the same steps as "One request" 1–2 for this
   batch's body (so with the review on, each try previews and opens the review).
   A try fails when the request fails, when the reply has any
   `failedExpressions` (reason: each "expression: error" joined by "; "), or when
   it returns fewer cells than the batch's names ("The provider returned fewer
   sprites than requested"). When "Transparent background" is on, a successful
   reply is cleaned with `sprite_cleanup` inside the same try, and a cleanup
   failure fails the try (decision 2). Cancelling the review also fails the try
   today (decision 3).
3. A successful batch adds its results (named by the reply's cells) and its
   sheet, labelled "Batch N", to those collected so far.

**When a batch fails both tries:** show the review step with everything collected
so far (possibly nothing), the error "Batch N of M failed after one automatic
retry: <reason>" (the reason is the last try's message through
`getErrorMessage` with the fallback "Image generation failed. Try again."), and a
paused card: "Batch N of M paused", the batch's names, "The batch already
retried once automatically. Retry it here when the provider is ready; successful
batches above are preserved.", and **Retry batch** (disabled while generation is
unavailable or there is no connection). The later batches aren't run.

**Retry batch** clears the error and the frame editor, shows the waiting step,
and runs the paused batch and every batch after it the same way, adding to the
results already collected. The cut settings aren't reset.

**When every batch succeeds:** show the review step with all results and no
error.

## Review step

Top to bottom:

1. **Error banner** (warnings and errors from generation, cleanup, cuts, frame
   and save).
2. **Paused batch card** (matched mode, above).
3. **Sheets** (when any result came with a sheet): a collapsed disclosure
   "View full generated sheet", "View generated source image" (1×1), or "View N
   generated batch sheets" (more than one). Open, it shows each sheet with the
   caption "<label> · C×R" ("Generated sheet" or "Batch N").
4. **Cut panel** (decision 16 for its labels), when at least one result came
   with a sheet and the grid is bigger than 1×1. See "Adjusting the cuts".
5. **Cleanup bar.** See "Background cleanup".
6. **Frame editor** for one sprite, when open. See "Framing one sprite".
7. **The sprites:** the heading "Review & label sprites (N selected)" ("poses"
   for Full-body, "full-body expressions" in matched mode), the hint "Click an
   item to toggle selection. Assign or edit names as needed. Only selected items
   will be saved.", and a grid with as many columns as the generation grid
   (decision 15). Each tile has:
   - the picture (fitted, square); clicking it selects or unselects the sprite.
     Unselected tiles are dimmed; a corner badge shows a check or a cross.
   - a **name list**: the sprite's name in list form, then the options (below);
     choosing one renames the sprite.
   - a **name box**: the name as held; typing renames the sprite (see "Names").
   - a **Frame** button (opens the frame editor for this sprite; highlighted
     while it's the one open).
8. **Footer:** "Regenerate" (decision 10) and "Save N sprites" (decision 6).

### Names

- **Rename rule** (both the list and the box): the new value trimmed,
  lowercased, every character other than `a`–`z`, `0`–`9`, `_` and `-` turned
  into `_`. It applies on every keystroke, so a typed trailing space vanishes
  (decision 9). An empty name is allowed.
- **List form** of a name: the rename rule plus a leading `full_` removed.
- **List options:** the generation's names (the picks cut to the grid, or the
  matched names), then all expressions (matched mode or the Expressions type) or
  all poses (plain Full-body), each in list form, empty ones and repeats dropped.
  A sprite whose list form isn't among them gets it added at the top of its own
  list. Options show `_` as spaces.

### Background cleanup

- **"Transparent background"** box. Turning it off puts every sprite back to its
  original picture and marks cleanup as not applied. Turning it on only shows
  the controls; it doesn't run cleanup.
- While on: a **strength** slider from "Soft" (0) to "Aggressive" (100), step 1,
  with the number beside it; and **Apply cleanup** ("Reapply cleanup" once
  applied, "Applying..." while running), disabled while running, while there are
  no sprites, or while `spriteCapabilities.cleanupEngine.installed` is false
  (its tooltip is then `cleanupEngine.reason`, else "Sprite cleanup is not
  available."; otherwise "Run background cleanup") (decision 12).
- **Apply cleanup** sends `sprite_cleanup` for every sprite (selected or not)
  from its original picture and shows the cleaned pictures; cleanup is applied.
  A failure shows "Couldn't apply background cleanup. Try again." and changes
  nothing.
- **"Use original"** (while applied) puts the originals back; cleanup is not
  applied.
- Always the note "Cleanup is applied after generation when enabled. Use Apply
  cleanup to rerun it on the current slices without regenerating." and, while
  the box is on and the engine isn't installed, the reason in a warning colour.

Each sprite keeps two pictures: the **original** (what generation, cuts and
frames produce) and the **shown** one (the original, or its cleaned copy).
Cleanup always starts from the original. Save sends the shown one.

### Adjusting the cuts

Re-cuts each sprite from its own sheet without a new request. Sliders, each with
its value shown as "x.x%":

| Slider            | Range     | Step | Starts at |
| ----------------- | --------- | ---: | --------: |
| Side margin       | 0 to 18   |  0.1 |         0 |
| Top/bottom margin | 0 to 18   |  0.1 |         0 |
| Column gap        | 0 to 24   |  0.1 |         0 |
| Row gap           | 0 to 24   |  0.1 |         0 |
| Nudge X           | −12 to 12 |  0.1 |         0 |
| Nudge Y           | −12 to 12 |  0.1 |         0 |
| Crop top          | 0 to 40   |  0.5 |         0 |
| Crop bottom       | 0 to 40   |  0.5 |         0 |
| Crop left         | 0 to 40   |  0.5 |         0 |
| Crop right        | 0 to 40   |  0.5 |         0 |
| Row cut 1…        | −12 to 12 |  0.1 |         0 |
| Column cut 1…     | −12 to 12 |  0.1 |         0 |

One row cut per inner row line and one column cut per inner column line of the
grid (in matched mode, of the batch grid for up to 4 names). The note under
them: "Use this when the generated sheet has borders, gutters, or uneven
spacing. Applying re-slices the original source sheet(s) without regenerating."
("sheet" for one sheet, "sheets" otherwise).

**Reset** sets every slider back to zero (cuts sized as above). **Apply slice**
("Applying..." while running; both buttons disabled while running) cuts every
sprite that has a sheet; sprites without one are left as they are. All numbers
below are in pixels of that sprite's own sheet; "% of S" means the slider value
as a percentage of S, rounded to the nearest pixel. For each axis, with S the
sheet's width (columns) or height (rows) and N the sheet grid's columns or rows:

1. **Lines:** the outer lines are at margin + nudge and S − margin + nudge
   (margin and nudge as % of S). Inner line k (1 to N−1) is at the outer start
   plus k/N of the span between the outer lines, plus cut k as % of S.
2. **Minimum spacing:** lines must be at least max(8, 3% of S rounded down) px
   apart. Going forward from the second line, a line too close to the one before
   it moves forward; then going backward from the second-to-last line, a line
   too close to the one after it moves back.
3. **The sprite's box:** its column and row come from its position on its
   sheet (left to right, top to bottom). Its box runs between its two lines on
   each axis, minus half the gap (gap as % of S) on each side that has a
   neighbour; the start is rounded up and the end rounded down. A box with no
   width or height fails.
4. **Edge crops:** move the box's left edge in by Crop left as % of the box's
   width, the right edge by Crop right, the top by Crop top as % of the box's
   height, the bottom by Crop bottom; then keep the box inside the sheet. No
   width or height left fails.
5. **The new picture:** that box of the sheet, at its own size, as a PNG data
   URL. It becomes both the original and the shown picture.

After applying: cleanup is not applied (the box stays as it was), the frame
editor closes, names and selection are kept. Any failure (a sheet that won't
load, "Slice settings leave no usable cell area") shows "Couldn't adjust sprite
slices. Try again." and changes nothing (decision 5).

### Framing one sprite

Opening the frame editor for a sprite closes any other, starts at zero, and
clears the error. The panel shows a square preview, "Frame <name>", a close
button ("Close frame editor"), four sliders **Top**, **Bottom**, **Left**,
**Right** (0 to 80, step 0.5, shown as "x.x%"), **Reset** (back to zero) and
**Apply frame** (a spinner while running, disabled while running).

- **Limits:** each value is kept between 0 and 80 (anything not a number is 0).
  Top + bottom and left + right may not pass 90: raising one side lowers the
  opposite side by the excess, never below 0.
- **Preview:** the shown picture cropped with `cropSpriteDataUrl` and the four
  values, updating as they change; if cropping fails, the uncropped picture.
- **Apply frame:** crop the original with `cropSpriteDataUrl`; when the shown
  picture differs from the original (it's cleaned), crop it too, else use the
  cropped original. Both replace the sprite's pictures; the editor closes. A
  failure shows "Couldn't frame sprite. Try again.".
- Frames are lost when the cuts are applied again (the sprite is re-cut from its
  sheet).

## Saving

**Save N sprites** shows the number of selected sprites ("Saving…" with a
spinner while running) and is disabled while saving or when none is selected.

1. The sprites to save are the selected ones with a non-empty name, in grid
   order. With none, nothing happens (decision 6).
2. **Save name** of each: the rename rule applied again, then for Full-body a
   leading `full_` added unless it's already there; for Expressions a leading
   `full_` removed. The **type selected at the moment Save is pressed** decides
   (decision 1).
3. Send `sprite_upload` for each, one at a time, waiting for each.
4. **All saved:** call `onSpritesGenerated`, close the dialog, and go back to the
   setup step with the results, paused batch, progress line and frame editor
   cleared.
5. **A failure** stops the loop: the error "Couldn't save sprites. Try again." (or
   the worded text). Sprites sent before it stay saved; `onSpritesGenerated`
   isn't called; the dialog stays on the review step with everything as it was
   (decision 7).

## Regenerate

"Regenerate" goes back to the setup step without sending anything: it clears the
results, paused batch, progress line, frame editor, cleanup state and cut
settings (to zero with no cut sliders), and the error. The setup is kept as it
was, so Generate sends the same body again (decision 10).

## Prompt review

The shared `ImagePromptReviewModal`, opened over the dialog with the preview's
items. Its title, editing, empty-prompt check and buttons are its own. The
dialog passes `isSubmitting` false. Confirm hands back one override per item;
the dialog sends them as `promptOverrides` unchanged. When the dialog is
unmounted while the review is open, the review counts as cancelled.

## Saved data

| What            | Exact contract                                                                                                                                      | Rule                                                                                                                        |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Sprite file     | Rust writes `<expression>.<extension>` in the owner's sprite folder; the extension comes from the data URL's type, so always `png` from this dialog | Rust-owned. Same `expression` and image.                                                                                    |
| Full-body names | `full_` + the name (once); portrait names never start with `full_`                                                                                  | Same rule. The Sprites tabs, the roleplay sprite display and image references split portraits and full-body by this prefix. |
| Owner           | `ownerType` `"character"` or `"persona"`, the owner id always as `characterId`                                                                      | Same names and values.                                                                                                      |
| Name characters | lowercase `a`–`z`, `0`–`9`, `_`, `-` (Rust applies the same rule again)                                                                             | Same rule.                                                                                                                  |
| Overwrite       | a sprite with the same name and extension is replaced without asking                                                                                | Same in the rebuild (decision 8).                                                                                           |

The dialog stores nothing else: no local storage, no settings. The settings it
reads (`reviewImagePromptsBeforeSend`, `imageStyleProfiles`) belong to the UI
store.

## Removed

- The prompt review's busy state while the image request runs. The dialog sets
  it after the review has already closed, so it never shows.
- Re-cutting a sprite that has no sheet of its own against the first sheet.
  It can't happen: only replies without a sheet make such sprites, and then
  there is no first sheet either.
- The header comment ("Generates a character expression sheet…"), which
  predates full-body and matched batches.

## Decisions

The rebuild keeps every command, body and saved name exactly as above.
Decisions marked **follow-up** change one of those (or which calls are sent)
and wait for their own pull request after the rebuild. The rest change only
what the dialog shows. Line numbers point into the old file for the reviewer.

1. **Reopening keeps the results but resets the settings beneath them.** Each
   open resets the type, count, picks, matching and both transparent boxes
   (lines 609–621), but not the step or results. Generate full-body poses,
   close the dialog, open it again from the Facial Expressions category, and
   Save writes `idle.png`, `walk.png` as portrait expressions instead of
   `full_idle.png` (the save name uses the type at Save time, lines
   1228–1233). Cleaned sprites also show with "Transparent background" off.
   **Follow-up:** when the dialog reopens with unsaved results, keep the
   settings those results were made with; reset only when it opens on the setup
   step. No change in the rebuild. **Done after the rebuild:** reopening resets
   the setup only on the setup step, and Save, its count and the "Needs a name"
   marks use the type the results were made as.
2. **A cleanup failure throws away the generated pictures.** With "Prefer
   transparent PNG" on, the cleanup runs inside the generation step (lines 917
   and 814). If it fails, a single sheet's paid results are discarded and the
   dialog goes back to setup with "Image generation failed. Try again." (lines
   935–943); in matched mode the failure counts as a failed try, so the batch
   is generated again (a second paid request). Recommended: a single sheet shows
   its uncleaned results with "Couldn't remove the background. Use Apply cleanup
   to try again." (screen only, in the rebuild). **Follow-up:** in matched mode,
   a cleanup failure keeps the batch uncleaned instead of generating it again.
   **Done after the rebuild:** the batch stays uncleaned with that same note.
3. **Cancelling the prompt review in matched mode counts as a failure.** The
   batch's try loop catches the cancel like any error (lines 805–817), so the
   review opens a second time (a second preview request), and cancelling again
   pauses the batch with "Batch 1 of 2 failed after one automatic retry: Image
   generation failed. Try again." The code meant to return to setup on cancel
   (lines 851–856) is never reached. **Follow-up:** a cancel stops the run at
   once and shows the batches finished so far on the review step, with the
   cancelled batch paused and no error. **Done after the rebuild:** as
   described, with the hint "You cancelled its prompt review."; a cancel before
   any batch finished goes back to setup, like a single sheet. A run whose owner
   changed (or that Back to setup replaced) also sends no further batch.
4. **Hosted installs give up after 30 seconds.** `spriteApi.generateSheet` and
   `spriteApi.cleanup` use the default 30-second limit for hosted requests
   (`REMOTE_FINITE_REQUEST_TIMEOUT_MS`), while `image_generate` was given no
   limit in #1218 for this reason. The dialog itself says generation takes
   30–60 seconds. On a hosted install (like the Pi) a slow provider shows "The
   De-Koi server didn't answer within 30 seconds…" while the server keeps
   generating; the result is lost, and in matched mode the automatic retry sends
   a second paid request while the first is still running. Seen in the code, not
   yet reproduced on the Pi. **Follow-up** in `image-generation-api.ts` (a
   neighbor): no client limit for `sprite_generate_sheet` and `sprite_cleanup`,
   like `image_generate`. Bodies unchanged. Recommended as the first follow-up.
5. **Errors hide the reason.** `getErrorMessage` shows an error's own text only
   for worded codes, so the dialog's own checks never show theirs: "Slice
   settings leave no usable cell area" (line 1149), "The provider returned fewer
   sprites than requested" (line 811), the per-expression failures (line 808),
   Rust's "Sprite generation timed out after N seconds"
   (`sprite_generation_timeout`) and "All expression generations failed"
   (`sprite_generation_failed`) all become "Image generation failed. Try again."
   or "Couldn't adjust sprite slices. Try again.". Recommended: the dialog's own
   checks show their own words ("These cut settings leave no room for a sprite.
   Lower the margins, gaps or crops."), and the two Rust codes get worded
   messages ("Sprite generation took longer than N seconds. Try again, or pick
   a smaller grid."). Screen only.
6. **The save count includes sprites that won't be saved.** "Save N sprites"
   counts selected sprites, but those with an empty name are skipped without a
   word (line 1216); with only unnamed ones selected, Save does nothing. It also
   says "Save 1 Sprites". Recommended: count only selected sprites with a name,
   mark an unnamed selected sprite "Needs a name", disable Save when none can be
   saved, and say "Save 1 sprite". Bodies unchanged.
7. **A save that fails half way.** Uploads go one at a time; when one fails, the
   ones before it are saved but the tab's list isn't refreshed, and the message
   is the generic "Couldn't save sprites. Try again." (lines 1223–1254).
   Recommended: refresh the list after a failure too (call
   `onSpritesGenerated`) and say "Saved 3 of 6. Couldn't save sad: <reason>."
   (in the rebuild). **Follow-up:** unselect the saved ones so the next Save
   sends only the rest (today it sends all of them again, which overwrites them
   with the same pictures). **Done after the rebuild:** the saved ones are
   unselected.
8. **Same-name sprites replace each other without warning.** Two sprites with
   the same save name: the second replaces the first. A save name that already
   exists for the owner replaces the saved sprite. Recommended in the rebuild: a
   warning on the tiles, "Two sprites are named happy; only the last one will be
   kept." (no change to what's sent). **Follow-up:** confirm before replacing
   existing sprites ("Replace 2 saved sprites: happy, sad?"); this needs the tabs
   to pass every saved name, including `full_` ones.
9. **The name box eats spaces.** The rename rule runs on every keystroke, and it
   trims first, so typing "very happy" gives `veryhappy` (line 1199–1213).
   **Follow-up:** keep the text as typed while editing and apply the rule when
   the box loses focus, so it saves as `very_happy`. That changes the saved name
   for the same keys, so not in the rebuild. **Done after the rebuild.**
10. **"Regenerate" doesn't regenerate.** It goes back to setup and drops every
    result without asking (lines 1260–1273). Recommended: label it "Back to
    setup" and, when there are results, ask "Discard these N sprites?" first.
    Nothing sent changes.
11. **Hints that promise things that don't happen.** "You can regenerate them
    individually" (there is no way to regenerate one sprite); "Select exactly N
    … Extra or fewer expressions will be adjusted" (a pick past N drops the
    oldest; fewer picks leave the rest of the grid unused); matched mode says
    each batch is 2×2 when a batch of 1 or 2 names is 1×1 or 2×1. Recommended:
    "Some expressions didn't generate: a, b. Generate again to retry them.";
    "Pick up to N. A pick past N replaces the oldest one."; "Each batch of up to
    4 is one sheet, for sharper sprites and cleaner cuts.". Screen only.
12. **Apply cleanup is blocked while automatic cleanup still runs.** Apply
    cleanup is disabled when `cleanupEngine.installed` is false (only when the
    server forces the external remover and it's missing), but the cleanup after
    generation runs anyway with the same `"auto"` request, which falls back to
    the built-in cleanup. **Follow-up** (low priority, rare): enable the button
    and show the reason as a note, since it allows a request that's blocked
    today.
13. **Reference pictures have no size check.** Any image file is sent as is,
    in every request (and in every matched batch), and a large photo can hit
    `request_body_too_large` on hosted installs. **Follow-up:** shrink large
    pictures before sending, or refuse files over the upload limit with a
    worded message. Changes the bodies.
14. **Accessibility.** The type tabs, counts and chips are buttons with no
    pressed state; the connection select, appearance box and cleanup strength
    slider have no names (their labels aren't tied to them); the reference
    picture's remove button has no name and shows only on hover (invisible on
    touch); a tile's selection is shown only by a dimmed picture and a
    check/cross badge; the error banner and the batch progress aren't announced;
    the name box's name changes as you type ("Sprite filename for …"); the cut
    and frame sliders read as "Side margin0.0%". Recommended: the type and count
    as radio groups and chips with `aria-pressed`; labels tied to the select,
    box and slider ("Cleanup strength"); "Remove reference image N" always
    visible; each tile's selection as a labelled checkbox ("Keep happy"); the
    error with `role="alert"` and the progress line polite live text; the name
    box named "Sprite N name"; slider names without the value. Screen only.
15. **Phone layout.** The review grid uses the sheet's column count (up to 4) at
    every width, so on a phone each tile with its two name fields is about 70 px
    wide. Recommended: at most 2 columns on narrow screens.
16. **Wording.** Labels are Title Case ("Generate Sprites", "Image Generation
    Connection", "Reference Images", "Appearance Description", "Expression
    Count", "Adjust Slice", "Apply Slice", "Apply Cleanup", "Use Original",
    "Apply Frame", "Retry Batch", "Review & Label"), "Nudge X/Y" is jargon, and
    "..." and "…" are mixed. Recommended: sentence case everywhere (this spec
    already writes them that way), "Move sideways" and "Move up or down" for the
    nudges, "…" throughout. The count labels (`6 (2×3)`) and the stored and sent
    names don't change.
17. **Why Generate is disabled isn't said.** It's disabled with a blank
    appearance, no picks or no connection, with no hint (only the "unavailable"
    case has a tooltip, which touch can't show). Recommended: a line under the
    button naming what's missing ("Describe their appearance to generate.").

## Tests

No tests cover the old dialog. New behavior tests, built from the recordings
(see "Black-box recording plan"):

- **Bodies:** for each recorded scenario, the exact command sequence and bodies:
  each count and type, custom picks and the drop-oldest rule, fewer picks than
  the grid, the avatar and uploaded references (order, the cap of 4, omitted
  when none), the negative prompt for portrait, full-body and matched bodies,
  `nativeTransparentPng`, `noBackground` always false, the preview-then-generate
  pair with `promptOverrides`, an empty preview, and a cancelled review.
- **Matched batches:** names cleaned and deduplicated, the first 16, batches of
  4 with their grids, two tries per batch, the three failure kinds, the paused
  card, Retry batch continuing from the failed batch.
- **Cleanup:** the body (strength, `"auto"`, originals as data URLs, every
  sprite), cleaned pictures by position, Use original, unchecking the box.
- **Save:** the save names (full-body prefix, portrait prefix removed, the type
  at Save time), owner type and id for a character and a persona, one call at a
  time in grid order, unselected and unnamed sprites skipped, the stop on
  failure.
- **Cuts:** for a recorded sheet and settings, each sprite's new size and pixels
  (compare decoded pixels, not PNG bytes); the "no usable area" failure; frames
  lost after re-cutting.
- **Frame:** the 80 and pair-of-90 limits; Apply crops the original and the
  cleaned picture.
- **Resets:** what opening, changing owner, Regenerate and a finished save keep
  and clear (decision 1 as a follow-up).
- New: decisions 2 (single sheet), 5, 6, 7 (refresh and message), 8 (warning),
  10, 11, 14, 15 and 17.

The cut and frame tests need a real canvas, so run them in the browser
(Playwright), not jsdom. Test what people see, what's sent and what's saved.
Don't read source files as text.

## Acceptance checks

1. From a character's Sprites tab, Generate sprite opens on Expressions with 6
   (2×3); a generated sheet shows six named sprites; Save writes six portrait
   sprites that show in the tab.
2. From the Full-body category the dialog opens on Full-body; a pose sheet saves
   as `full_<pose>` sprites.
3. With portrait sprites saved, matched batches generate `full_<expression>`
   sprites four at a time; a failing batch retries once, pauses, and Retry batch
   finishes the rest without losing earlier batches.
4. With "Expose image prompts before sending" on, the review shows the prompt,
   an edited prompt is what's sent, and Cancel sends nothing more.
5. Prefer transparent PNG cleans the sprites after generation; Apply cleanup at
   another strength, Use original and unchecking the box behave as described.
6. Adjusting the cuts and framing a sprite change exactly what's saved.
7. A persona's Sprites tab saves to the persona, not a character.
8. Every recording replays with the same commands and bodies.
9. Existing sprites (made by the old dialog) still list, show and are used in
   chat; nothing about their names or files changes.
10. Keyboard only: every control has a name and can be reached; the dialog and
    the review trap focus and close with Escape (decision 14).
11. Phone width and the Pond, Default and SillyTavern themes in light and dark
    look right.
12. The desktop app and a hosted install behave the same (apart from decision
    4, which is a follow-up).
13. `pnpm typecheck`, `pnpm check:architecture`, `pnpm check:text-size` and the
    tests pass, and the old file in "Scope" is gone.

## Black-box recording plan

For whoever records the old dialog before it's deleted (not the builder).

### Setup

- Drive the web app in headless Chrome against a throwaway server with a copy
  of test data (never the live install), and intercept `POST /api/invoke`. The
  request body is `{ command, args }`; record `command` and `args` for every
  call whose command starts with `sprite_`, in order.
- **Fake** `sprite_generate_sheet_preview`, `sprite_generate_sheet` and
  `sprite_cleanup` (they would call a paid provider). Let `sprite_upload`,
  `sprite_list` and `sprite_capabilities_command` go through to the throwaway
  server, so the saved file names are recorded too (list the sprite folder
  after each save), or fake them with the shapes below.
- Create one test character with an avatar and one test persona, and one image
  generation connection with model `gpt-image-1` (plus one with `gpt-image-2`
  for the GPT-Image-2 note). Faked replies don't depend on the model.
- Turn the prompt review on and off through Settings > "Expose image prompts
  before sending".
- For a reply, an HTTP 200 with the JSON result is a success. For an error,
  answer HTTP 500 with `{ "code": "...", "message": "..." }`. Use
  `image_provider_error` for a worded error (its message is shown) and
  `sprite_generation_failed` for a generic one (the fallback is shown).

### Reply shapes to fake

- `sprite_generate_sheet_preview`: `{ "items": [{ "id": "sprite:expressions:sheet:2x3-neutral,happy,sad,angry,surprised,smirk", "kind": "sprite", "title": "Expression sprites: 2x3", "prompt": "…", "negativePrompt": "…", "width": 1024, "height": 1536 }] }`.
  Any id works; the confirmed override echoes it. Also record one item without
  `negativePrompt`, and `{ "items": [] }`.
- `sprite_generate_sheet` with a sheet: `{ "sheetBase64": "<bare base64 PNG>", "cells": [{ "expression": "neutral", "base64": "<bare base64 PNG>" }, …] }`.
  Use a sheet whose cells are solid, different colours with a visible border,
  sized like Rust's (512 px wide cells; 512 high for portraits, 768 for
  full-body), and cells cut from it, so cut changes are easy to see.
- `sprite_generate_sheet` without a sheet (Rust's one-by-one mode):
  `{ "sheetBase64": "", "cells": [...], "failedExpressions": [{ "expression": "sad", "error": "content policy" }] }`.
- `sprite_cleanup`: `{ "cells": [{ "expression": "neutral", "base64": "<bare base64 PNG>" }, …], "engine": "auto", "externalCleanupProcessed": 0, "backgroundRemoverProcessed": 0, "builtinProcessed": 6 }`.
- `sprite_upload` (if faked): `{ "expression": "happy", "filename": "happy.png", "absolutePath": "/tmp/happy.png", "ownerId": "<id>", "ownerType": "character", "size": 1234, "cacheKey": "1", "url": "" }`.
- `sprite_capabilities_command` (if faked): `{ "imageProcessingAvailable": true, "spriteGenerationAvailable": true, "backgroundRemovalAvailable": true, "reason": null, "cleanupEngine": { "engine": "auto", "installed": true, "command": null, "source": "builtin", "runtimeDir": "", "reason": null } }`.
  Also record with `spriteGenerationAvailable: false, reason: "…"` and with
  `cleanupEngine.installed: false`.
- `sprite_list` (if faked): a list of the upload shape. Include portrait names
  like `Happy`, `very sad`, `neutral`, a repeat, and a `full_idle` for matched
  mode.

### Driving the dialog

- **Open:** the character editor's Sprites tab, the category buttons "Facial
  Expressions" or "Full-body", then the button "Generate Sprite". The dialog is
  `role="dialog"` named "Generate Sprites". Scope every lookup to it: the tab
  also has a "Full-body" button.
- **Setup:** type tabs are buttons "Expressions (Portrait)" and "Full-body";
  counts are buttons named exactly `1 (1×1)`, `6 (2×3)`, … (× is U+00D7); chips
  are buttons named by the lowercase name (poses with a space, "battle stance").
  The connection is the dialog's first `select` (it has no name); the appearance
  is the `textarea` (no name; placeholder starts "blue eyes"). Checkboxes:
  "Use current avatar as a reference image", "Prefer transparent PNG", "Match
  existing expression sprites" (names include their extra text; match by
  substring). Reference uploads: the hidden `input[type=file]` inside the
  dialog. Generate is the button whose name starts with "Generate " (Sheet,
  Sprite, Pose, Pose Sheet, Matched Batches). Cancel is "Cancel".
- **Review:** "Retry Batch", "Reset", "Apply Slice"; sliders are
  `role="slider"` with names starting "Side margin", "Top/bottom margin",
  "Column gap", "Row gap", "Nudge X", "Nudge Y", "Crop top", "Crop bottom",
  "Crop left", "Crop right", "Row cut 1", "Column cut 1" (set them with fill).
  "Transparent background" checkbox; the strength slider is the only
  `input[type=range][max="100"]`; "Apply Cleanup" / "Reapply Cleanup" and
  "Use Original". Per tile: the picture button (named by the sprite's name),
  the select "Assign expression for sprite N", the text box "Sprite filename
  for <name>", and "Frame <name>". Frame editor: sliders "Top", "Bottom",
  "Left", "Right", buttons "Reset", "Apply Frame", "Close frame editor".
  Footer: "Regenerate" and "Save N Sprites".
- **Prompt review:** a second dialog named "Review Image Prompt" (or "Review
  Image Prompts"), with text areas and the buttons "Cancel" and "Generate".

### Scenarios

Record the command sequence and bodies for each; for saves, also the files
written. Must-have first.

1. Expressions, default 6 (2×3), avatar on, no uploads, review off: Generate,
   then Save all six.
2. Same, avatar off, two uploaded pictures, appearance with leading and
   trailing spaces.
3. Avatar on plus four uploads attempted (only three are kept).
4. Each other count: 1 (1×1) picking "happy", 9, 12 and 16 (4×4).
5. Custom picks: on 6 (2×3), unpick two, pick three others (the oldest
   dropped); and a run with only 4 picks.
6. Full-body: default 6 poses, then 1 (1×1) "Generate Pose"; Save.
7. Matched batches with 6 existing names (incl. `Happy` and `very sad`):
   two batches (2×2 and 2×1); Save.
8. Matched with more than 16 existing names (four batches).
9. Matched failure: batch 2 fails twice (generic error), paused card, Retry
   Batch succeeds; Save. Repeat with a reply that has `failedExpressions` and
   one with too few cells.
10. Prefer transparent PNG on: Generate (records the cleanup call after it),
    then Save.
11. Review step cleanup: box on, strength 70, Apply Cleanup, Use Original,
    Reapply Cleanup, uncheck the box; Save.
12. Cleanup failure after generation (fake `sprite_cleanup` error): single
    sheet and matched (records decision 2 as it is today).
13. Prompt review on: preview, edit the prompt and the negative prompt,
    Generate; then Cancel in a second run; then an empty `items` reply; then
    an item without `negativePrompt`.
14. Prompt review on with matched batches, Cancel at batch 1 (records decision
    3 as it is today: a second preview).
15. Reply without a sheet and with `failedExpressions` (warning text; no cut
    panel); Save.
16. Generation errors: a worded (`image_provider_error`) and a generic
    (`sprite_generation_failed`) error; record the text shown.
17. Cuts: Side margin 2.0, Column cut 1 at 3.0, Crop top 5.0, Apply Slice, Save
    (record each saved picture's size and pixels); then settings with no room
    left (record the error text).
18. Frame: Frame on sprite 2, Top 10, Left 85 (Right drops), Apply Frame, Save.
    Then frame, then Apply Slice again (the frame is lost).
19. Names: rename one through the list, one by typing "Very Happy!" (record what
    the box shows and the saved name), clear one name; unselect two; Save
    (record "Save N" before saving and the calls).
20. Persona: scenario 1 from a persona's Sprites tab.
21. Save failure: the third upload fails (fake it); record the text, then press
    Save again (all six are sent again).
22. Close during review, reopen from the other category, Save (records decision
    1 as it is today).
23. Regenerate, then Generate again with the same setup (the same body).
24. Screen states only: no connections; generation unavailable; cleanup engine
    not installed; the GPT-Image-2 note.
25. Hosted install only: delay the fake `sprite_generate_sheet` by 35 seconds
    and record what shows (decision 4).
