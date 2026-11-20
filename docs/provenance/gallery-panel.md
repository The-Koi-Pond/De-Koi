# Global Gallery Panel: Behavior Spec

Status: agreed 2026-11-20 (decisions as recommended). Part of the code
provenance plan (`docs/code-provenance-plan.md`, tracked in #1580).

This spec describes the global gallery panel: the right-hand panel that opens
from **Gallery** in the navigation (desktop top bar; on phones the Tools tab).
It shows the profile-wide image library, files images into flat folders, sorts
them, uploads, downloads and deletes images, opens one image in a lightbox, and
hosts the custom emoji / sticker tag control on each card. It is the only input
the builder uses. It describes behavior, not the old implementation.

## Rules for the builder

Build from this spec, the recordings, the screenshots and the team-owned code
around it. Don't open, search, or read the history of the old implementation:

- `src/features/catalog/gallery/components/GlobalGalleryPanel.tsx`
- `src/features/catalog/gallery/components/GlobalGalleryPanel.spec.tsx` (its
  test reads the old structure)

You may read every interface listed under "Neighbors". If this spec doesn't
answer a question, ask the spec writer.

**Safety.** The panel sends no model requests and makes no paid calls. It does
change real data: **deleting an image deletes the image file and its
thumbnails on disk** (the server removes them with the row), uploads write
files, and moves, tags and folder changes rewrite rows. Both real users keep
their gallery on the Pi. So every storage call is a contract and must stay
exactly the same (see "Storage calls"). Someone other than the builder records
the old panel as a black box first (see "Black-box recording plan"), only on
throwaway data in a scratch data folder, and the recordings become tests. Where
this text and a recording disagree, the recording wins, except where a decision
below changes the behavior on purpose; tell the spec writer so the spec gets
fixed.

## Scope

Lines not yet team-owned, from `node scripts/code-provenance.mjs --fast` at
`3a0afc9c06`:

| File                                                             | Not owned | Of lines |
| ---------------------------------------------------------------- | --------: | -------: |
| `src/features/catalog/gallery/components/GlobalGalleryPanel.tsx` |       481 |      530 |

Replaced, then deleted in the same change, with its old test. The new module
lives in `src/features/catalog/gallery/components/global-gallery/` and exports
`GlobalGalleryPanel` (no props) with the same name.
`src/features/catalog/gallery/shell.ts` re-exports it from the new path;
nothing else changes for the callers.

### Neighbors (not rebuilt)

- `src/app/shell/RightPanel.tsx` (through `right-panel-loaders.ts` and
  `shell.ts`) lazy-loads the panel and shows it inside the right panel, with
  its own title bar, while `rightPanel` is `"gallery"`.
- `src/features/catalog/gallery/hooks/use-global-gallery.ts`:
  - `useGlobalGalleryImages()`: an infinite query, newest first, 48 per page
    (`GLOBAL_GALLERY_PAGE_SIZE`); `data` is the loaded images as one list;
    `isLoading`, `hasNextPage`, `fetchNextPage()`, `isFetchingNextPage`. Each
    image is normalized (`folderId` blank → `null`, `url` falls back to
    `filePath`). Type `GlobalGalleryImage`.
  - `useGalleryFolders()`: every folder, oldest first. Type `GalleryFolder`
    (`id`, `name`, `createdAt`).
  - Mutations (the app's `useMutation` wrapper, see below):
    `useUploadGlobalGalleryImages()` (`{ files, folderId }`, resolves
    `{ uploaded, failures }`, throws only when every file failed),
    `useDeleteGlobalGalleryImage()` (image id), `useMoveGlobalGalleryImage()`
    (`{ imageId, folderId }`), `useTagGlobalGalleryImage()`
    (`{ imageId, patch }`), `useCreateGalleryFolder()` (name, resolves the new
    folder), `useRenameGalleryFolder()` (`{ folderId, name }`),
    `useDeleteGalleryFolder()` (folder id; the server moves the folder's images
    to Unfiled, it never deletes them). Each refreshes the lists it changes.
- `src/shared/hooks/use-mutation.ts`: a `mutate()` call with no `onError` of
  its own shows an error toast when it fails (the error's user message, or
  "Couldn't save that change. Try again.").
- `src/shared/components/ui/ImageUploadDropzone.tsx`: the upload button and
  drop target (it filters files, checks count and size, and shows its own
  toasts).
- `src/shared/components/ui/CustomEmojiTagButton.tsx`: the tag control on each
  card (its menu, size check, name prompt and red flash). The panel only passes
  the image and applies the patch it gives.
- `src/shared/components/ui/HelpTooltip.tsx`: its button is named
  `Help: <first sentence>`.
- `src/shared/lib/app-dialogs.ts`: `showConfirmDialog`, `showPromptDialog`.
- `src/shared/lib/gallery-upload.ts`: `describeGalleryUploadFailures`.
- `src/shared/lib/error-message.ts`: `toUserMessage(error, { fallback })`.
- `src/shared/api/local-file-api.ts`: `galleryThumbnailPath(filename,
filePath)`, `resolveManagedAssetThumbnailFileUrl("gallery", path, 256)`,
  `resolveGalleryFileUrl(filename, filePath)`.
- `sonner` (`toast.error`, `toast.warning`), `@tanstack/react-virtual`
  (`useVirtualizer`), `lucide-react` icons, `cn` from `src/shared/lib/utils.ts`.

## What shows

From top to bottom, with 1rem between blocks and 0.75rem padding around the
panel:

1. **Count and sort row.**
2. **Folder chips.**
3. **Folder bar** (only while a folder is selected).
4. **Upload button.**
5. **The grid**, or loading tiles, or the empty box.
6. **Load older images** (only while there are more pages).

The lightbox opens on top of everything.

### Count and sort row

Left: `<n> image` / `<n> images` (`1 image`, `0 images`), where n is the number
of **loaded** images (all loaded pages, every folder), small muted text,
followed by a help button with the text: "Tag an image as a custom emoji or
sticker with the tag button on its corner. Emojis must be ≤256×256px, stickers
≤512×512px — larger images flash red."

Right: a dropdown named `Sort images` with, in order: **Newest first**
(default), **Oldest first**, **Name A → Z**, **Name Z → A**. It sorts the shown
images (below). The choice isn't saved; the panel opens on Newest first.

### Folder chips

A wrapping row of pill buttons, in this order:

- **All** with the loaded image count;
- **Unfiled** with the count of loaded images that have no folder;
- one chip per folder (oldest folder first), a folder icon, the name (cut with
  an ellipsis past 7rem) and its loaded image count;
- a dashed **New** button with a folder-plus icon, named `New folder` (title
  `New folder`).

Each chip shows the count after its label in smaller, faded text. The selected
chip is primary-colored; the others are secondary with muted text. The panel
opens on **All**.

Clicking a chip selects it. When the selected folder disappears from the folder
list (deleted here or elsewhere), **All** is selected.

### Folder bar

Only while a folder chip is selected and that folder has a name: a rounded,
lightly tinted bar with a folder icon in the primary color and the folder's
name in small bold text (ellipsis when long), and on the right two small icon
buttons: **Rename folder** (pencil, muted, named and titled `Rename folder`)
and **Delete folder** (trash in the destructive color, named and titled
`Delete folder`).

### Upload button

The shared upload dropzone, full width, with an upload icon. Label:
`Upload to "<folder name>"` while a folder is selected, otherwise
`Upload Images`. While an upload runs it shows `Uploading…` and is disabled;
while files are dragged over it, `Drop images to upload`.

### Images shown

The loaded images, filtered by the selected chip (All: every image; Unfiled:
images with no folder; a folder: images in it), then sorted:

- **Newest first** / **Oldest first**: by `createdAt` (an unreadable date
  counts as the earliest possible);
- **Name A → Z** / **Name Z → A**: by `filename`, or `prompt` when there's no
  filename, lowercased, compared with `localeCompare`.

### Loading, empty

- While the first page loads: four square shimmering tiles in two columns.
- No images to show: a dashed box with a camera icon, `No images yet` (when
  **All** is selected) or `No images here` (any other chip), and under it
  `Upload images to build a reusable, profile-wide library.`

### The grid

Two columns of square cards, 0.5rem apart, inside a scroll box at most 60% of
the window height. The grid is virtualized by rows of two with
`useVirtualizer` (an estimated row height of 180px, two rows of overscan), so a
large library only mounts the rows near the view; the recordings render it
with the virtualizer replaced by one that shows every row.

Each card (rounded, bordered, card background; the border tints and a shadow
appears on hover):

- is draggable, titled `Drag onto a folder to move it`, and fades to 40% while
  it is being dragged;
- the whole square is a button showing the image's thumbnail (cover-cropped),
  with alt text `filename`, else `prompt`, else `Gallery image`; clicking it
  opens the lightbox;
- the custom emoji / sticker tag control in its corner;
- a bottom strip on a dark gradient: the date (`createdAt` as the browser's
  local date) in small white text, then a **Download** link (titled `Download`,
  the image's `url`, downloads) and a **Delete** button (red tint, titled
  `Delete`). On desktop the strip only shows while the card is hovered; on
  phone widths (below the `md` breakpoint) it always shows.

**Thumbnail.** While it resolves, an empty secondary-colored square (hidden
from screen readers). Then the 256px gallery thumbnail
(`resolveManagedAssetThumbnailFileUrl("gallery", galleryThumbnailPath(filename,
filePath), 256)`), or the image's own `url` when that gives nothing or fails.
It reloads when the image's file changes. Lazy-loaded, not draggable.

### Load older images

Under the grid while the library has more pages: a full-width secondary button
`Load older images` that loads the next page; while it loads it shows
`Loading older images…` and is disabled.

## Actions

### Upload

Choosing or dropping files (the dropzone has already filtered them) uploads
them into the selected folder, or with no folder while **All** or **Unfiled**
is selected. When some files failed:
`toast.warning("Some images didn't upload — <describeGalleryUploadFailures(failures)> Try those again.")`.
When the whole upload fails:
`toast.error(toUserMessage(error, { fallback: "Couldn't upload gallery images. Try again." }))`.
An empty file list does nothing.

### Delete an image

From a card's **Delete** or the lightbox's **Delete**: a confirm dialog
`{ title: "Delete Image", message: "Delete this gallery image?", confirmLabel: "Delete", tone: "destructive" }`.
Cancel does nothing. Confirm deletes the image (its file goes too) and, when
that image is open in the lightbox, closes the lightbox. A failed delete shows
the wrapper's error toast.

### New folder

**New** opens a prompt
`{ title: "New Folder", message: "Name this gallery folder.", placeholder: "e.g. Reactions", confirmLabel: "Create" }`.
Cancel or a blank name does nothing. Otherwise the folder is created with the
trimmed name and selected. On failure:
`toast.error("Couldn't create the folder. Try again.")`.

### Rename folder

A prompt
`{ title: "Rename Folder", message: "Enter a new name for this folder.", defaultValue: <current name>, confirmLabel: "Rename" }`.
Cancel, a blank name, or the same name after trimming does nothing. Otherwise
it renames to the trimmed name. On failure:
`toast.error("Couldn't rename the folder. Try again.")`.

### Delete folder

A confirm dialog with `title: "Delete Folder"`, `confirmLabel: "Delete"`,
`tone: "destructive"` and the message
`Delete "<name>"? The <n> image(s) inside will move to Unfiled.` (`image` when
n is 1, `images` otherwise; n = loaded images in it), or `Delete "<name>"?`
when it holds no loaded images. Confirm deletes the folder and selects **All**.
On failure: `toast.error("Couldn't delete the folder. Try again.")`.

### Move by dragging

Dragging a card onto **Unfiled** or a folder chip moves the image there: the
chip under the drag gets a 2px primary ring (offset by 1px) and the drag
effect is "move". **All** isn't a drop target. Dropping onto the folder the
image is already in does nothing. The image id travels as the drag's
`text/plain` data. Ending the drag anywhere clears the fading and the ring. A
failed move shows the wrapper's error toast.

### Tag as emoji / sticker

The tag control calls back with a patch; the panel saves it on that image
unchanged. A failed tag shows the wrapper's error toast.

## Lightbox

A full-window dialog (`role="dialog"`, `aria-modal="true"`, named by the
image's `filename`, else `prompt`, else `Gallery image preview`) on an 80%
black backdrop above everything (z-index 100). Clicking the backdrop closes
it; clicking inside the content doesn't.

Content, at most 90% of the window height and `min(90vw, 40rem)` wide:

- the image at full size (contain, at most 70% of the window height, rounded,
  large shadow), alt text as on the card. It starts with the image's `url` and
  switches to `resolveGalleryFileUrl(filename, filePath)` when that gives a
  URL (errors ignored);
- a dark bar with: a folder icon and a dropdown named `Move image to folder`
  (**Unfiled**, then every folder by name, the image's folder selected;
  disabled while a move is running); a **Download** link (titled `Download`,
  the full-size URL); a **Delete** button (red tint, titled `Delete`); a
  **Close** button (titled `Close`).

Keyboard: focus moves to **Close** when it opens and back to what had focus
when it closes. Escape closes it. Tab and Shift+Tab cycle inside the dialog
(links, enabled buttons, enabled selects).

**Moving from the lightbox.** Picking a folder shows it at once, then saves.
When the save fails: `toast.error("Couldn't move this image. Putting it back.")`
and the dropdown goes back to the previous folder, but only if the lightbox
still shows that image with the failed choice (a later choice is never
undone).

## Storage calls

Exactly these, with these arguments (through the hooks):

| Action             | Call                                                             |
| ------------------ | ---------------------------------------------------------------- |
| Open               | list `global-gallery` (newest first, 48), list `gallery-folders` |
| Load older images  | list `global-gallery` with the next cursor                       |
| Upload             | `global_gallery_upload` per file, `{ folderId: <id or null> }`   |
| Delete image       | delete `global-gallery` `<id>`                                   |
| Move (drag or box) | update `global-gallery` `<id>` `{ folderId: <id or null> }`      |
| Tag                | update `global-gallery` `<id>` with the tag control's patch      |
| New folder         | create `gallery-folders` `{ name: <trimmed> }`                   |
| Rename folder      | update `gallery-folders` `<id>` `{ name: <trimmed> }`            |
| Delete folder      | delete `gallery-folders` `<id>`                                  |

Nothing else is written. No call reaches a model.

## Layout

Text sizes are fixed so the rebuild can't drift:

| Element                                                          | Size     |
| ---------------------------------------------------------------- | -------- |
| Image count, sort dropdown, chips, folder bar name, upload label | 0.75rem  |
| Chip counts, card date                                           | 0.625rem |
| Empty box title                                                  | 0.875rem |
| Empty box hint                                                   | 0.75rem  |
| Load older images, lightbox folder dropdown                      | 0.75rem  |

Icons: chip folder icon 0.75rem; New folder-plus 0.75rem; folder bar folder
0.8125rem, pencil and trash 0.75rem; upload 1rem; empty-box camera 1.75rem at
40% muted; card download and trash 0.6875rem; lightbox folder, download, trash
and close 0.875rem.

Everything uses the theme tokens (primary, secondary, card, border, muted,
accent, destructive, ring), so light and dark themes both follow the app; the
card strip and the lightbox are dark in both themes.

Details checked against the old screen in real Chrome:

- Chips: fully rounded, 0.75rem across and 0.25rem down, 0.375rem apart.
  The New button: dashed border, its border tints primary at 40% on hover.
- The folder bar: secondary at 60%, rounded, 0.75rem across, 0.375rem down.
- The sort dropdown: secondary background, border, rounded, 0.5rem across and
  0.25rem down; a 1px ring on focus.
- Cards: rounded-xl; the strip 0.375rem padding; its buttons rounded with
  0.375rem padding, Download white at 15% (25% on hover), Delete red at 35%
  (55% on hover).
- Load older images: secondary background, border, rounded, 0.75rem across,
  0.5rem down, medium weight.

The builder gets screenshots of the old panel at 1366x900 and 660x900, in dark
and light theme: empty, a full library (All), a folder selected with its bar,
Unfiled, a card hovered, the lightbox, and the confirm/prompt dialogs. Match
them.

## Decisions

The rebuild keeps every storage call and every visible text exactly as above,
except:

1. **Folder chips don't say which one is selected** except by color.
   Recommended: `aria-pressed` on **All**, **Unfiled** and each folder chip
   (true on the selected one). Screen readers only.
2. **A card's Download and Delete can't be seen with the keyboard.** On desktop
   the strip only shows on hover, so tabbing to them focuses invisible buttons.
   Recommended: the strip also shows while anything in the card has keyboard
   focus. No change with a mouse or on phones.
3. **Not in this rebuild** (unchanged, possible follow-ups): the counts and
   sorting only cover the loaded pages (a library over 48 images says
   `48 images` until **Load older images** is used, and Oldest first only sorts
   what is loaded); a card's Download uses the stored `url` while the lightbox
   uses the resolved full-size URL; folder names aren't checked for length or
   duplicates; a second click on Delete while its confirm dialog is open opens
   another dialog.

More decisions may be added in the build PR if the recordings show a problem;
each gets the spec writer's sign-off first.

## Tests

The new module's tests use the recordings:

- For every recorded starting state (empty library, folders with and without
  images, odd rows: no filename, a prompt only, an unreadable date, a blank
  `folderId`, a tagged image, more than one page): the count, the chips and
  their counts and order, the folder bar, the upload label, the shown cards in
  order with their alt text and date, the empty box, and Load older images
  match the recording.
- For every recorded action sequence: the visible state after each step, every
  storage call (with its exact arguments), every dialog's options and every
  toast match the recording, except where decisions 1 and 2 change them on
  purpose.
- The lightbox's focus, Escape, Tab cycle and the move rollback (including a
  newer choice that must not be undone) have tests.
- Each decision has a test.

## Acceptance checks

- Real Chrome, a local server with a scratch data folder and throwaway images,
  at 1366x900 and 660x900: the recorded step lists give the same stored rows,
  the same files on disk after a delete, and the same visible states as the old
  build (except the decisions), and the screenshots match the old ones by eye
  (dark and light).
- A local copy of the Pi data (connections blanked first, deleted afterwards):
  the panel shows the real library the same way in both builds (count, chips,
  order, first cards); uploads, moves, tags and deletes only on throwaway
  images added for the test.
- `GlobalGalleryPanel.tsx` and its old test are gone and nothing imports them.

## Black-box recording plan

Recorded by someone other than the builder, on `main` before the old file is
deleted, with no real data and nothing deleted outside a scratch folder made
for the recording. Saved under
`src/features/catalog/gallery/components/global-gallery/test-fixtures/` as
one-line JSON (listed in `.prettierignore`, so the provenance report doesn't
count recordings as code), each file under about 1 MB.

1. **Component recordings**: the old panel rendered in the test environment as
   a black box: a fake storage behind the real gallery hooks (list with pages,
   create, update, delete, upload; can be told to fail, to fail some files, or
   to hold a call), the file URL resolvers faked, the virtualizer replaced by
   one that shows every row, the dialogs answered by the recorder, and toasts
   recorded. Starting states as listed under "Tests". Action sequences: every
   chip, every sort, upload (success, partial, total failure, into a folder),
   delete (cancel, confirm, from the lightbox, failure), new / rename / delete
   folder (cancel, blank, same name, success, failure), drag onto each kind of
   chip (including **All** and its own folder), tag patches, Load older images,
   the lightbox (open, move, failed move, a newer move after a failed one,
   Escape, backdrop, Close, Tab). After each step: the shown state and every
   call, dialog and toast.
2. **Real Chrome**, headless Chrome with a local server whose data folder is a
   scratch folder, seeded with generated test images: the same kinds of step
   lists through the real **Gallery** navigation at 1366x900 and 660x900 in
   dark and light, recording after each step the shown state and every
   `/api/invoke` call the panel makes, the stored rows after each write, and
   which image files exist on disk; plus the builder's screenshots.

The builder gets the recordings, the screenshots and this spec. The recordings
show the old behavior that decisions 1 and 2 change on purpose.
