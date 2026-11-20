# Global gallery panel recordings

Black-box recordings of the old global gallery panel (see `docs/provenance/gallery-panel.md`), made on `main` before
the old file was deleted, on throwaway data only. One-line JSON, listed in `.prettierignore`, so the provenance report
doesn't count them as code. Don't edit them by hand. The recordings show the old behavior; spec decisions 1 to 5
change some of it on purpose.

## `recorded-show.json` and `recorded-actions.json` (test environment)

The old panel rendered in jsdom (`TZ=UTC`) inside a fresh `QueryClient` (no retries) per scenario, with the real
gallery hooks and these stand-ins:

- `storageApi` (`shared/api/storage-api`): an in-memory fake. `list("global-gallery", options)` returns the stored
  images newest first (by `createdAt` string, then `id`, both descending), after the `before` cursor
  (`"<createdAt>|<id>"`) when given, cut to `options.limit`. `list("gallery-folders")` returns the folders in stored
  order. `create("gallery-folders", { name })` stores and returns `{ name, id: "new-folder-<n>", createdAt:
  "2026-02-0<n>T12:00:00.000Z" }`. `update(entity, id, patch)` merges and returns the row. `delete("global-gallery",
  id)` removes the image; `delete("gallery-folders", id)` removes the folder and moves its images to `folderId: null`.
  `<n>` counts creates and uploads together within a scenario, from 1.
- `galleryApi.uploadGlobal(file, folderId)` (`shared/api/image-generation-api`): stores and returns
  `{ id: "up-<n>", folderId, filePath: "/data/gallery/<name>", filename: <name>, prompt: "", provider: "upload",
  model: "", width: 64, height: 64, createdAt: "2026-03-0<n>T12:00:00.000Z", url: "/api/gallery/file/<name>" }`, or
  throws `new Error(reason)` for a file named in a `failFile` step.
- `shared/api/local-file-api`: `galleryThumbnailPath(filename, filePath)` returns `` `${filename ?? "-"}~${filePath ??
  "-"}` ``; `resolveManagedAssetThumbnailFileUrl(kind, path, size)` returns `` `thumb:${kind}:${size}:${path}` ``,
  except it returns `null` when the path contains `img-2` and throws when it contains `raw.png`;
  `resolveGalleryFileUrl(filename, filePath)` returns `` `full:${filename}~${filePath ?? "-"}` `` when there is a
  filename, else `null`.
- `showConfirmDialog` / `showPromptDialog` (`shared/lib/app-dialogs`): recorded as `["confirm", options]` /
  `["prompt", options]`; each answers with the next queued `answer` step's value (default: confirm `true`, prompt
  `null`).
- `sonner`'s `toast` (and `toast.error`, `toast.warning`, `toast.success`, `toast.info`, `toast.message`): recorded as
  `["toast", kind, message]`.
- `CustomEmojiTagButton` (`shared/components/ui/CustomEmojiTagButton`): a stand-in `<button type="button"
  aria-label="Tag <image id>" data-kind={image.customKind ?? ""}>` (no text) whose click calls `onApply({ customKind:
  "sticker", customName: "n_<image id>", width: 64, height: 64 })`.
- `@tanstack/react-virtual`'s `useVirtualizer({ count, estimateSize })`: returns every row (`getVirtualItems()` gives
  `{ key: i, index: i, start: i * estimateSize() }` for each `i < count`), `getTotalSize()` = `count *
  estimateSize()`, `measureElement` does nothing.

Before mounting, an `outside` button is added to the page and focused (to see where focus returns).

The file holds `images` (the six stored images most scenarios start from, `"IMAGES"`), `many` (50 plain images,
`"MANY"`), `folders` (`"FOLDERS"`) and `scenarios`. A scenario: `id`, `images`, `folders` (the name of a list above,
or the rows), `before` (steps run before mounting), `steps`, `unhandled` (unhandled promise rejections during the
scenario). The first step is `["mount"]`. Each step result has `step` and then either `error` (the recorder couldn't
find the control) or:

- `text`: the panel container's `textContent` with whitespace collapsed (the lightbox renders inside it);
- `selects`: every `select` in page order: `aria-label`, `value`, `options` (`[value, text]`), `disabled` when set;
- `buttons`: every `button` in page order: `text`, `aria-label`, `title`, `aria-pressed`, `aria-disabled`,
  `data-kind` when present, `disabled` when set, `ringed: true` when the chip shows the drop-target ring (class
  `ring-2`);
- `links`: every `a`: `href`, `download`, `title`, `draggable`;
- `images`: every `img`: `alt`, `src`, `draggable`, `loading`;
- `cards`: every `[draggable="true"]` element: `title` and `faded` (class `opacity-40`);
- `shimmer`: how many `.shimmer` elements show;
- `dialog`: the `[role="dialog"]` element's `aria-label` and `aria-modal`, or `null`;
- `focus`: `document.activeElement` as `<tag>:<aria-label, else title, else collapsed text>` (`null` for the body);
- `calls`: storage calls, uploads, dialogs and toasts since the previous step, in order: `["list", entity,
  options]`, `["create", entity, data]`, `["update", entity, id, patch]`, `["delete", entity, id]`, `["upload",
  fileName, folderId]`, `["confirm", options]`, `["prompt", options]`, `["toast", kind, message]`.

Step kinds:

- `["chip", label]`: click the folder chip whose label is `label` (`All`, `Unfiled`, a folder name, `""` for the
  folder with an empty name);
- `["sort", value]`: set the `Sort images` select;
- `["click", text, index?]`: click the button whose collapsed text is `text`;
- `["clickLabel", name, index?]`: click the button whose `aria-label` or `title` is `name`;
- `["cardDelete", imageId]` / `["cardOpen", imageId]`: a card's `Delete` button / its image button;
- `["tag", imageId]`: the stand-in tag button;
- `["upload", [[name, type], …]]`: set the upload `input[type=file]`'s files and fire `change`;
- `["dragStart", imageId]`, `["dragEnd", imageId]` (on the card) and `["dragOver", label]`, `["dragLeave", label]`,
  `["drop", label]` (on a chip): DOM events with a `dataTransfer` stand-in (`setData`/`getData`, `types`,
  `dropEffect`, `effectAllowed`) shared from the last `dragStart`;
- `["moveTo", folderIdOrEmpty]`: set the lightbox's `Move image to folder` select;
- `["lb", title]`: click the lightbox button with that title;
- `["key", key, "shift"?]`: a `keydown` on `document`;
- `["backdrop"]`: click the `[role="dialog"]` element; `["clickImage"]`: click the `img` inside it;
- `["focusFirst"]`: focus the dialog's first select, link or button;
- `["answer", value]`: queue the next dialog answer; `["fail", op, message]`: the next `op` (`create`, `update`,
  `delete`, `list:global-gallery`, `list:gallery-folders`) throws; `["failFile", name, reason]`;
  `["hold", op]` / `["release", op]`: `op` (`upload`, `update`, `create`, `delete`, `list:global-gallery`,
  `list:gallery-folders`) waits until released;
- `["removeFolderElsewhere", folderId]`: the folder is removed from storage and every query is invalidated (as another
  tab would).

## `recorded-chrome.json` (real Chrome)

Headless Chrome, the app on a local server whose data folder is a scratch folder, at 1366x900 and 660x900 in dark
and light theme, each flow opened through the real **Gallery** navigation (on phones Tools → Gallery):

- `empty`: open an empty gallery, New folder (prompt, `"  QA Folder "`, Create), select it, Delete folder (confirm);
- `library`: two folders (`Reactions`, `Scenery`) and six uploaded test images (`qa-red`, `qa-blue` in Reactions,
  `qa-green` in Scenery, `qa-yellow`, `qa-purple`, `qa-teal` unfiled); chips, every sort, hover a card, open the
  lightbox, move to Scenery, Escape (then reopen the panel when it closed), delete with Cancel and Delete, delete from
  the lightbox, rename Reactions to `" Faces "`, upload `qa-orange.png` into it, drag `qa-green` onto the Faces chip,
  delete Faces;
- `paging`: 50 small images, open, Load older images.

Each step has `label` and either `error` or: `open` (false when the panel isn't showing), `text` (the panel without
any dialog), `selects`, `buttons`, `links` (`title`, `download`, `hrefKind`: the href without origin, ids as
`<uuid>`), `images` (`alt`, `loaded`), `stripVisible` (per card, whether its Download/Delete strip is visible),
`lightbox` (label, text, which folder is selected, disabled, image loaded) or null, `appDialogs` (each open confirm
or prompt dialog's text and input value), `focus`, `width`, `scrollWidth`, `innerWidth`, and `calls`: every
`/api/invoke` storage call for `global-gallery` / `gallery-folders` and every `global_gallery_upload` (file name,
folder) with HTTP status. Steps that write also have `stored` (the stored images and folders, without ids and times;
the data folder as `<DATA>`) and, for deletes and uploads, `files` (every file under the data folder outside `data/`,
so a deleted image's file and thumbnail are seen to go). Each flow also has `errors` (page errors), `commands` (every
`/api/invoke` command the page sent) and, for `library`, `seeded` / `seededFiles`. Ids are replaced by `<id1>`,
`<id2>`, … in order of first appearance within each flow.
