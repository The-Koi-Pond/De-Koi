# Preset Editor Shell and Overview Tab: Behavior Spec

Status: draft 2026-11-23. Part of the code provenance plan
(`docs/code-provenance-plan.md`, tracked in #1580). Third slice of the preset
editor (`PresetEditor.tsx`); the first two were the Preset Variables list
(`docs/provenance/preset-variables.md`) and the Sections tab
(`docs/provenance/preset-sections.md`). The AI Review tab is the last slice and
stays in `PresetEditor.tsx` for now.

This spec describes the preset editor **shell** (loading and not-found states,
the header with the name, Save, Export and Delete, the saved notice, the
unsaved-changes bar, the save error bar and the tab rail) and the **Overview**
tab (Name, Description, Wrap Format, Author and the two counts). The shell is in
this slice because the Overview fields are the shell's own draft state and its
Save is the only thing that writes them. The Sections tab (already rebuilt) and
the AI Review tab (next slice) are only rendered here. This spec is the only
input the builder uses. It describes behavior, not the old implementation.

## Rules for the builder

Build from this spec, the recordings, the screenshots and the team-owned code
around it. Don't open, search, or read the history of the old implementation:

- `src/features/catalog/presets/components/PresetEditor.tsx`

You may import `PresetEditor` from that file in tests (see "Tests"); you may
read every interface listed under "Neighbors". If this spec doesn't answer a
question, ask the spec writer.

**Safety.** The editor sends no model requests (the AI Review tab can, but it
isn't part of this slice, and nothing here starts it). What it saves is the
preset row: its name, description, wrap format, author and generation
parameters. The wrap format decides how every section is wrapped in the prompt
of every chat that uses the preset, and the parameters go into every model
request. So every save call is a compatibility contract and must stay exactly
the same, including which calls happen, in which order and with which payload
(key order included). Someone other than the builder recorded the old editor as
a black box first (see "Black-box recording plan"); the recordings become
tests, and the builder sees the recordings, never the old code. Where this text
and a recording disagree, the recording wins, except where a decision below
changes the behavior on purpose; tell the spec writer so the spec gets fixed.

## Scope

In `src/features/catalog/presets/components/PresetEditor.tsx`: the
`PresetEditor` component (about 370 lines: data loading, the derived values the
Sections tab gets, the header, the bars, the tab rail and the tab switch), the
Overview tab (about 100 lines) and the stat card. The AI Review tab, its
connection picker and the small field-group wrapper it uses stay in the file.

The new module lives in `src/features/catalog/presets/components/preset-overview/`
and exports `PresetEditorShell`. `PresetEditor.tsx` keeps exporting
`PresetEditor`, which becomes

```tsx
export function PresetEditor() {
  return <PresetEditorShell renderReviewTab={(presetId) => <ReviewTab presetId={presetId} />} />;
}
```

and the old shell and Overview code is deleted from `PresetEditor.tsx` in the
same change. The spec writer makes that edit (the builder doesn't open the
file).

### Props (the contract with `PresetEditor.tsx`)

- `renderReviewTab: (presetId: string) => ReactNode`: called while the AI
  Review tab is active. Its result goes straight into the content column (the
  same parent as the Overview fields, with no wrapper of its own), because the
  review tab returns a fragment whose parts are spaced by that column.

Everything else the shell reads itself, as the old one did:

- `useUIStore`: `presetDetailId` (which preset is open), `closePresetDetail`,
  `setEditorDirty`.
- `useChatStore`: `activeChatId`; `useChat(activeChatId)` from
  `src/features/catalog/chats/index` for the active chat's metadata.
- From `../hooks/use-presets`: `usePresetFull(presetDetailId)`,
  `useUpdatePreset`, `useDeletePreset`, and the eleven section, group and
  variable hooks it hands to the Sections tab (`useCreateSection`,
  `useUpdateSection`, `useDeleteSection`, `useReorderSections`,
  `useCreateGroup`, `useUpdateGroup`, `useDeleteGroup`, `useCreateVariable`,
  `useUpdateVariable`, `useDeleteVariable`, `useReorderVariables`).

### Neighbors (not rebuilt)

- `src/features/catalog/presets/hooks/use-presets.ts`: `usePresetFull` loads
  the preset row (`storage.get("prompts", id)`; a missing row throws), then its
  sections, groups and variables (each listed by `presetId`). `useUpdatePreset`
  takes `{ id, ...fields }`, parses the fields with `updatePromptPresetSchema`
  and stores them with `storage.update("prompts", id, parsed)`, then refreshes
  the preset list and the preset. `useDeletePreset` deletes the row and
  refreshes every preset query. All of them use the shared `useMutation`.
- `src/engine/contracts/schemas/prompt.schema.ts`: `updatePromptPresetSchema`
  (name 1 to 200 characters, wrap format `xml` / `markdown` / `none`,
  parameters through `patchSchema(generationParametersSchema)`; the parsed
  object's key order is the schema's, unknown keys are dropped).
- `src/shared/hooks/use-mutation.ts`: a failed `mutate` with no `onError`
  shows the shared failure toast `Couldn't save that change. Try again.`;
  `mutateAsync` doesn't.
- `src/features/catalog/presets/components/preset-sections/`
  (`PresetSectionsTab`, rebuilt in slice 2; its props are listed in
  `docs/provenance/preset-sections.md`).
- `src/shared/api/export-api.ts` (`exportApi.prompt(presetId)`),
  `src/features/shared/lib/export-feedback.ts` (`triggerDownloadWithToast`,
  `toastExportError`).
- `src/shared/lib/app-dialogs.ts` (`showConfirmDialog`),
  `src/shared/lib/error-message.ts` (`toUserMessage`),
  `src/shared/components/ui/HelpTooltip.tsx`, `src/shared/lib/utils.ts`
  (`cn`), `lucide-react`.
- `src/app/shell/detail-route-registry.tsx` renders `PresetEditor` while
  `presetDetailId` is set; `AppShell.tsx` asks before the app closes while
  `editorDirty` is true.

## Data

From `usePresetFull(presetDetailId)`'s `data`:

- **Draft fields.** Whenever `data` changes (a new object from the query: the
  first load, a refresh with different content, another preset), the draft is
  set from the preset row: name `name ?? ""`, description `description ?? ""`,
  wrap format `wrapFormat ?? "xml"`, author `author ?? ""`, parameters
  `parameters ?? {}`. Values are used as stored (a number shows as its text).
  A refresh that returns the same content keeps the same `data` object, so the
  draft stays.
- **Ordered sections**: the preset's `sectionOrder` (anything but a list counts
  as empty), each id mapped to its section row; ids with no row are left out,
  repeated ids repeat.
- **Lorebook marker**: some ordered section is on (`enabled` `true` or
  `"true"`), is a marker (`isMarker` `true` or `"true"`), and has a marker
  config (an object, or JSON text parsed to one, with a text `type`) of type
  `lorebook`, `world_info_before` or `world_info_after`.
- **Chat has lorebooks**: the active chat's `metadata` (an object, or JSON text;
  bad JSON counts as none) has a non-empty list `activeLorebookIds`. No active
  chat, a chat still loading or failing: no.
- **Group map**: the preset's groups by id, in stored order.
- **Choice blocks**: the preset's variables, as listed.

## States

- `presetDetailId` empty: nothing.
- Loading: a centered pair of shimmer bars (`h-8 w-48`, `h-4 w-32`).
- No `data` after loading (the preset row is missing, or any of the four reads
  failed): `Preset not found`, centered and muted.
- Otherwise the editor.

## The editor

A full-height column: the header, then the bars, then the tab rail and the
content.

### Header

Left to right:

1. **Back** (arrow icon): when the draft is unsaved, shows the unsaved-changes
   bar; otherwise `closePresetDetail()`.
2. A purple gradient tile with the file icon.
3. The **name** input (placeholder `Preset name…`, large semibold, no box),
   bound to the draft name; selects its text on focus. Typing sets the name and
   marks the draft unsaved.
4. **Save** (purple gradient, save icon): saves (below); disabled while a save
   is running.
5. **Export** (upload icon, title `Export preset`):
   `triggerDownloadWithToast(await exportApi.prompt(presetDetailId), "Preset exported.")`;
   a failure calls `toastExportError(error, "Failed to export preset.")`. It
   exports the stored preset (unsaved edits aren't in it) and is never
   disabled.
6. **Delete** (red trash icon): `showConfirmDialog({ title: "Delete Preset", message: "Delete this preset?", confirmLabel: "Delete", tone: "destructive" })`,
   then, if confirmed, `deletePreset.mutate(presetDetailId, { onSuccess: () => closePresetDetail() })`.
   No unsaved-changes check, no success toast; a failure shows the shared
   failure toast.

### Saving

Save sends
`updatePreset.mutateAsync({ id: presetDetailId, name, description, wrapFormat, author, parameters })`
with the draft values (keys in that order). Before it, the save error is
cleared. On success the draft counts as saved and **Changes saved** shows for
1.5 s (each save starts its own 1.5 s timer that hides it). On failure the
save error bar shows `toUserMessage(error, { fallback: "Couldn't save preset. Try again." })`
and the draft stays unsaved. Save runs even when nothing changed. The draft
being "unsaved" is mirrored to `setEditorDirty` whenever it changes.

### Bars

Under the header, in this order:

- **Changes saved**: a small emerald notice floating at the top center
  (`absolute left-1/2 top-14 z-50`, fade-in-up).
- **Unsaved changes** (amber): You have unsaved changes. with **Keep editing**
  (hides the bar), **Discard** (`closePresetDetail()` without saving) and
  **Save & close** (saves; closes only if the save worked; disabled while a
  save is running). The bar stays until one of these is used or the editor
  closes (a Save from the header leaves it up).
- **Save error** (red, warning icon): the message and an X named
  `Dismiss save error` that hides it.

### Tab rail and content

Three tabs, **Overview** (file icon), **Sections** (layers icon), **AI Review**
(sparkles icon); Overview is active when the editor mounts and stays the active
tab across preset switches. A vertical rail on the left (`w-44`); below the
`5xl` container width it becomes a horizontal, scrollable row above the content.
The content is a scrolling area with a centered `max-w-2xl` column:

- Overview: the Overview tab.
- Sections: `PresetSectionsTab` with `presetId`, the ordered sections, the group
  map, the choice blocks, `wrapFormat` = the draft wrap format, the eleven
  mutation objects, `hasLorebookMarker` and `parentChatHasLorebook` (see
  "Data").
- AI Review: `renderReviewTab(presetDetailId)`.

The draft lives in the shell, so it survives switching tabs.

## Overview tab

Four labeled fields (label text in small muted type with a help tooltip), then
the counts:

1. **Name** (help: The display name for this preset. Used in the Presets panel
   and chat settings.): a boxed input (placeholder `Preset name…`) bound to the
   same draft name as the header; it does **not** select on focus.
2. **Description** (help: A short summary of what this preset is designed
   for. Helps you remember its purpose when choosing between presets.): a
   textarea (placeholder `What does this preset do?`, at least 5 rem tall);
   selects on focus.
3. **Wrap Format** (help: Controls how prompt sections are formatted when sent
   to the AI. XML uses <tags>, Markdown uses ## headings, None sends raw
   content.): three buttons **XML** (code icon), **MARKDOWN** (hash icon),
   **NONE** (type icon); the one equal to the draft is highlighted purple;
   clicking any (even the current one) sets it and marks the draft unsaved.
   Under them: `xml` Sections wrapped in <xml_tags>. Groups become parent
   tags., `markdown` Sections wrapped with ## Headings. Groups become #
   Headings., anything else No automatic wrapping. Section content is sent
   as-is. (so an unknown stored format highlights nothing and shows the None
   line).
4. **Author** (help: Optional creator name, useful if you share presets with
   others.): a boxed input (placeholder `Your name (optional)`); selects on
   focus.
5. Two stat cards side by side: the number of ordered sections over
   **Sections**, the number of groups (all of the preset's group rows) over
   **Groups**.

Typing in any field sets the draft and marks it unsaved. Enter does nothing
special in any field.

## Layout

Use the screenshots (old build, real Chrome, at 1366 and 660 wide, dark and
light): the Overview of a filled preset and of a blank one, each wrap format,
focused fields, the unsaved bar, the save error, both bars together, the saved
notice, and the rail on the Sections and AI Review tabs.

## Decisions

The rebuild keeps every save call, payload and visible text. These change on
purpose (accessibility only):

1. **Names.** Back is named `Back`; Delete is named `Delete preset`; the header
   input is named `Preset name`; the Overview inputs are named by their labels
   (`Name`, `Description`, `Author`). Decorative icons are `aria-hidden`.
2. **States.** The active tab has `aria-current="page"`; the wrap buttons have
   `aria-pressed` (pressed when it is the draft format); the saved notice has
   `role="status"`; the save error bar has `role="alert"`.
3. **Buttons** all have `type="button"`.

## Follow-ups after the rebuild

Kept as recorded in the rebuild; each is its own small pull request after it:

1. **Lost edits on refresh.** Any refresh of the preset with new content (a
   save in the Sections tab, a variable edit, a save finishing) replaces the
   draft with the stored values, while the editor still says the changes are
   unsaved.
2. **Edits during a save are lost.** Typing while a save is running is replaced
   by the saved values when it lands, and the draft counts as saved.
3. **Unsaveable presets.** A stored preset the schema refuses (empty, missing
   or over-200-character name, an unknown wrap format, non-text fields,
   parameters that aren't an object or have out-of-range or `null` values,
   old-style thinking tags) can't be saved from the editor at all, and the only
   message is `Couldn't save preset. Try again.` with no reason.
4. **Save rewrites the parameters.** Saving the Overview also stores the
   preset's parameters back through the schema: unknown keys are dropped and
   thinking-tag text is trimmed, even when nothing was edited.
5. **Switching presets keeps the unsaved flag**: opening another preset with an
   unsaved draft shows the new preset as unsaved.
6. The unsaved bar stays after a successful Save from the header.
7. **Delete**: no check for unsaved changes; clicking Delete again before the
   first finishes asks again and sends a second delete; a failure says
   `Couldn't save that change. Try again.`.
8. **Export** exports the stored preset, not the draft, and has no busy state
   (two clicks, two downloads).
9. Two saves within 1.5 s: the first save's timer hides the second save's
   notice early.
10. The name is edited in two places (header and Overview), and only one of
    them selects on focus.
11. A whitespace-only name saves as is.

## Recorded details

Found while recording the old editor; the rebuild keeps them (the recordings
show each one):

- **Payload.** The stored payload is the schema's output, so its keys come in
  the schema's order: `name, description, parameters, wrapFormat, author`, and
  the parameters in their schema order (`temperature, topP, topK, minP,
maxTokens, …`), unknown keys dropped, tag text trimmed, nested
  `customParameters` kept as is. A preset with no parameters saves
  `parameters: {}`; with `null` description / author / wrap format it saves
  `""`, `""` and `"xml"`.
- **Errors.** A storage failure and a schema failure show the same
  `Couldn't save preset. Try again.` (the raw error text isn't shown). A second
  failing save shows the bar again; a working save clears it.
- **Save while saving.** Save and Save & close are disabled; a click on the
  disabled button does nothing. Back during a running save shows the unsaved
  bar; when the save lands the notice shows, the draft is clean, and the bar
  stays.
- **Save & close** after a failure stays open with the error under the bar; a
  second Save & close that works closes the editor.
- **Back** with only the error bar showing (draft clean) closes at once. Back
  twice keeps one bar. Typing while the bar is up keeps it.
- **Refresh with identical content** (for example right after a save, or an
  outside update that changes nothing) keeps the draft.
- **Loading** shows the shimmer until all four reads are done; switching to a
  preset that isn't cached shows the shimmer again. A failing read of any of
  the four shows `Preset not found`.
- **Counts.** `sectionOrder` that isn't a list counts 0; repeated ids count
  twice; ids of another preset's sections or of no section don't count. Groups
  count every group row of the preset, also those not in `groupOrder`.
- **Chat lorebooks** come from the chat row read with the chat summary fields;
  while it loads, or if it fails or is missing, the flag is off.
- **Closing** through the app's `closePresetDetail` also clears `editorDirty`
  (the store does it), so the editor isn't counted as unsaved after it closes.
- **Focus.** Focusing the header name, description or author selects all of
  it; the Overview name keeps the cursor where it was. A refresh while typing
  in a field replaces its text and puts the cursor at the end.

## Tests

The new module's tests use the recordings. They render `PresetEditor` from
`../PresetEditor` (after the cut it is the new shell with the old AI Review
tab), with the same fakes as the recorder:

- For every recorded starting state: the shown state (`shown`, text, inputs
  and their values, buttons and their disabled state, labelled elements, the
  rail, the active wrap button, the Sections tab props, the store values and
  focus) matches.
- For every recorded action sequence: the shown state after each step and every
  call (storage, export, download, confirm, toast; payloads compared as JSON so
  key order counts) match, except where decisions 1 to 3 add attributes.
- Each decision has a test.

## Acceptance checks

- Real Chrome, a local server with throwaway presets, at 1366x900 and 660x900,
  dark and light: the same edits and saves store the same `prompts` rows in
  both builds, and the screenshots match the old ones; hover, focus and
  disabled styles match.
- A local read-only copy of the Pi data: every stored preset's Overview shows
  the same in both builds (no saves).
- The old shell and Overview code is gone from `PresetEditor.tsx` and nothing
  else changed there except rendering the new module.

## Black-box recording plan

Recorded by someone other than the builder, on `main`, with no real data and
no model calls. Saved under
`src/features/catalog/presets/components/preset-overview/test-fixtures/` as
one-line JSON (listed in `.prettierignore`), each file under about 1 MB.

1. **Component recordings**: the old `PresetEditor` rendered in the test
   environment as a black box, with the real hooks and stores over a fake
   storage (`prompts`, `prompt-sections`, `prompt-groups`, `prompt-variables`,
   `chats`; any call can fail or be held), a fake export, download, connection
   list and confirm dialog, the Sections tab replaced by a probe that shows its
   props (and can call its mutations), a fixed `Date.now()`, a manual clock for
   every timer, and every call logged. Starting states: a full preset, each
   wrap format and an unknown one, `null` / missing / non-text / whitespace /
   unicode / 201-character fields, every kind of stored parameters (full,
   empty, unknown keys, out of range, `null` values, JSON text, an array,
   padded and old-style thinking tags, nested custom parameters), odd
   `sectionOrder`s, zero to three groups, lorebook markers in every form, and
   active chats with every kind of `metadata`; loading, missing and failing
   reads. Action sequences: typing in every field, focus, Enter and Escape,
   every wrap button, switching tabs, Save (unchanged, edited, twice, held,
   failing, refused by the schema), the unsaved bar (Keep editing, Discard,
   Save & close working, failing and held), Back, Delete (cancel, confirm,
   failing, held, twice), Export (working, with a report, failing, held),
   refreshes while editing, a Sections tab save while editing, switching and
   closing presets, and changing the active chat. After each step: the shown
   state and every call.
2. **Real Chrome** (the spec writer): the screenshots above, from the old build,
   for the builder; the same flows replayed in both builds for the stored rows.

The builder gets the recordings, the screenshots and this spec. The recordings
show the old behavior that decisions 1 to 3 change on purpose.
