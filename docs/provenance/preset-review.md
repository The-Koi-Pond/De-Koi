# Preset AI Review Tab: Behavior Spec

Status: draft 2026-11-23. Part of the code provenance plan
(`docs/code-provenance-plan.md`, tracked in #1580). Fourth and last slice of the
preset editor (`PresetEditor.tsx`); the first three were the Preset Variables
list (`docs/provenance/preset-variables.md`), the Sections tab
(`docs/provenance/preset-sections.md`) and the editor shell with the Overview
tab (`docs/provenance/preset-overview.md`).

This spec describes the **AI Review** tab: the connection picker, the Start
Review button, the streamed review text and the error box. This spec is the
only input the builder uses. It describes behavior, not the old
implementation.

## Rules for the builder

Build from this spec, the recordings, the screenshots and the team-owned code
around it. Don't open, search, or read the history of the old implementation:

- `src/features/catalog/presets/components/PresetEditor.tsx`

You may import `PresetEditor` from that file in tests (see "Tests"); you may
read every interface listed under "Neighbors". If this spec doesn't answer a
question, ask the spec writer.

**Safety.** This tab starts a **paid model request**: Start Review sends the
whole assembled preset to the chosen connection. It saves nothing. So the
contract is which request starts, when, with which arguments, and what the tab
shows from the stream. Nothing in the tests or checks may make a real model
call: the recordings use a scripted fake reviewer and a fake model stream, and
the real-Chrome checks use a local stub model server. Someone other than the
builder recorded the old tab as a black box first (see "Black-box recording
plan"); the recordings become tests, and the builder sees the recordings,
never the old code. Where this text and a recording disagree, the recording
wins, except where a decision below changes the behavior on purpose; tell the
spec writer so the spec gets fixed.

## Scope

In `src/features/catalog/presets/components/PresetEditor.tsx`: the review tab,
its connection picker and the small labelled-field wrapper they use (about 125
lines). After this slice the file only exports `PresetEditor`.

The new module lives in `src/features/catalog/presets/components/preset-review/`
and exports `PresetReviewTab` with one prop, `presetId: string`.
`PresetEditor.tsx` becomes

```tsx
export function PresetEditor() {
  return <PresetEditorShell renderReviewTab={(presetId) => <PresetReviewTab presetId={presetId} />} />;
}
```

and the old tab code is deleted from it in the same change. The spec writer
makes that edit (the builder doesn't open the file). The shell
(`../preset-overview`) puts the tab's output straight into its content column
(a `max-w-2xl space-y-6` column), so the tab returns its parts as a fragment,
spaced by that column.

### Neighbors (not rebuilt)

- `src/engine/generation/prompt-reviewer.ts`: `reviewPromptPreset(capabilities, input)`
  is an async generator. It reads the preset and its sections, builds one
  system and one user message and streams them through `capabilities.llm`,
  yielding `{ type: "token", data }` for visible text, `{ type: "error", data }`
  for a failed stream or an empty review, and `{ type: "done", data }` at the end
  (the whole review, formatted). It throws when the preset is missing.
- `src/shared/api/storage-api.ts` (`storageApi`), `src/shared/api/llm-api.ts`
  (`llmApi`): the capabilities passed to the reviewer, as these exact objects.
- `src/shared/api/integration-utility-api.ts`: `connectionsUtilityApi.list()`
  resolves the stored connections (full rows; the tab only uses `id` and
  `name`).
- `src/shared/lib/error-message.ts` (`toUserMessage`),
  `src/shared/components/ui/HelpTooltip.tsx`, `lucide-react`.
- `src/features/catalog/presets/components/preset-overview/` (the shell that
  renders the tab; it unmounts the tab when another tab is chosen, while a
  preset loads, and when the editor closes).

## The tab

Top to bottom (each a direct part of the content column):

1. A labelled field, label **AI Prompt Review** (small muted label text, the
   same label style as the Overview fields, with no help icon), holding:
   - The note Have an AI analyze your prompt preset for clarity, consistency,
     coverage, and efficiency. This requires an active API connection. (small,
     muted, 0.75 rem gap below).
   - The **picker row**: a dropdown (grows to fill the row) whose first option
     is Select connection… (value `""`), then one option per connection in list
     order (value `id`, text `name`); and the **Start Review** button (purple
     gradient, sparkles icon), which reads **Reviewing…** while a review runs.
     The button is disabled while a review runs or while no connection is
     chosen.
2. **Error** (when there is an error text that isn't empty): a small rounded
   box in the destructive color with the text.
3. **Output** (when the output text isn't empty): a rounded secondary box with
   the text as small preformatted text that wraps (`whitespace-pre-wrap`).

### Connections

On mount the tab calls `connectionsUtilityApi.list()` once and shows the
result. Until it resolves (and if it fails) the list is empty; a failure is
ignored. The chosen connection starts empty and is local to the tab, so it is
lost whenever the tab unmounts. The result is used as is: a result that isn't
a list makes the tab throw while rendering (see Recorded details).

### Start Review

Clicking the enabled button:

1. Sets the tab to reviewing, clears the output and clears the error.
2. Calls `reviewPromptPreset({ storage: storageApi, llm: llmApi }, { presetId, connectionId, streaming: true, focusAreas: ["clarity", "consistency", "coverage", "token_efficiency"] })`
   (keys in those orders, two arguments).
3. For each event: `token` appends `String(event.data ?? "")` to the output;
   `error` sets the error to `String(event.data ?? "Review failed")`; any other
   type is ignored (including `done`).
4. If iterating throws, the error becomes
   `toUserMessage(error, { fallback: "Review failed. Try again." })`.
5. In the end the tab stops reviewing.

Nothing cancels a running review: leaving the tab, switching presets or
closing the editor lets the stream run on with nothing shown. (**Changed by #1821**, follow-up
1: Stop and the tab unmounting abort the review's request.)

## Layout

Use the screenshots (old build, real Chrome, at 1366 and 660 wide, dark and
light): the tab with no connection chosen, with one chosen, reviewing, with a
finished JSON review, with an error, and with an error and output together.

## Decisions

The rebuild keeps every call and visible text. These change on purpose
(accessibility only):

1. **Names.** The dropdown is named `Connection` (`aria-label`); the sparkles
   icon is `aria-hidden`.
2. **Live regions.** The output box has `aria-live="polite"` and the error box
   `role="alert"`.
3. **Buttons** have `type="button"`.

## Follow-ups after the rebuild

Kept as recorded in the rebuild; each is its own small pull request after it. Items marked **Fixed** changed
recorded behavior on purpose: the replay spec keeps the recordings as they are and derives the change from them
(every step changes the same way: the reviewer and the model stream get an abort signal, and a Stop button follows
"Reviewing…"), and the fix's new step sequences are in the module's `fixes` spec.

1. **Fixed in #1821.** The review gets an abort signal: a Stop button (shown while reviewing) and the
   tab unmounting abort its request; the output so far stays and no error shows. Was: **No cancel.** A running review can't be stopped, and leaving the tab,
   switching presets or closing the editor doesn't stop it (the paid request
   runs on and its result is lost).
2. **Raw output.** The tab shows the raw streamed text, not the reviewer's
   formatted `done` result, so a JSON review is shown unformatted.
3. **Generic errors.** Every thrown error (including a rate limit) shows
   `Review failed. Try again.`.
4. **Non-list connections crash the editor.** A connections result that isn't
   a list throws while rendering and blanks the editor.
5. **Connection rows.** The picker loads every connection row in full (keys
   included) to show names; nameless connections show as empty options,
   duplicate ids aren't handled, and a connection with an empty id can't be
   chosen.
6. **Choice lost.** The chosen connection is lost when the tab unmounts.
7. **Error text.** An `error` event with no data shows `Review failed`, an
   empty one hides the box, and a later error replaces an earlier one; output
   that arrived before an error stays.
8. **No label for the dropdown** (fixed by decision 1) and no visible state for
   a failed connection list (it looks empty).

## Recorded details

Found while recording the old tab; the rebuild keeps them (the recordings show
each one):

- **Odd event data.** `token` data `5` shows `5`, `null` / `undefined` /
  `""` add nothing, an object adds `[object Object]`, `false` adds `false`.
  `error` data `0` shows `0`, an object `[object Object]`.
- **Odd events.** A `null` event makes iterating throw, so the error becomes
  `Review failed. Try again.` and reviewing stops; a string event or one with
  no `type` is ignored.
- **Errors.** `Error`, `ApiError` (any status), a thrown string and an
  `AbortError` all show `Review failed. Try again.`; output already shown
  stays.
- **Restarting** clears the output and the error at once.
- **While reviewing** Start does nothing and the dropdown still works;
  clearing the choice while reviewing leaves the button disabled when the
  review ends.
- **Unmount.** Leaving the tab while reviewing shows a fresh tab when you come
  back (connections listed again, nothing chosen, no output); the old stream's
  later events change nothing (**changed by #1821**, follow-up 1: unmounting
  aborts the review). Switching presets unmounts the tab too (the shell shows
  its loading state).
- **Connections.** Listed again on every mount. A held list shows only the
  placeholder; choosing works once it arrives. Options for nameless rows are
  empty, numeric ids become text values.
- **Non-list result.** `null` or an object makes rendering throw
  (`… reading 'map'` / `connections.map is not a function`) and the editor
  shows nothing.
- **Focus.** The dropdown and the button take focus normally; choosing keeps
  focus on the dropdown.
- **With the real reviewer** (over a fake model stream): a missing preset
  throws (`Review failed. Try again.`); an empty stream ends with the error
  Prompt Reviewer returned an empty review. Try again or use a different
  model/provider.; a stream error chunk shows its message; thinking blocks are
  hidden from the output.

## Tests

The new module's tests use the recordings. They render `PresetEditor` from
`../PresetEditor` (after the cut it is the shell with the new tab), with the
same fakes as the recorder:

- For every recorded scenario and step: the shown state (`shown`, text, inputs
  and their values and options, buttons and their disabled state, labelled
  elements, the store values and focus) and every call (reviewer, model
  stream, storage, connections; payloads compared as JSON so key order counts)
  match, except where decisions 1 to 3 add attributes. Render errors match by
  presence and by the property being read (`map`).
- Each decision has a test.

## Acceptance checks

- Real Chrome, a local server with a stub model connection (a local
  OpenAI-compatible server on 127.0.0.1; no paid calls), at 1366x900 and
  660x900, dark and light: the same steps send the same request to the stub in
  both builds, show the same text, and the screenshots match the old ones;
  hover, focus and disabled styles match.
- A local copy of the Pi's connection list (names and ids only, no keys): the
  picker shows the same options in both builds; no review is started.
- The old tab code is gone from `PresetEditor.tsx`.

## Black-box recording plan

Recorded by someone other than the builder, on `main`, with no real data and
no model calls. Saved under
`src/features/catalog/presets/components/preset-review/test-fixtures/` as
one-line JSON (listed in `.prettierignore`), each file under about 1 MB.

1. **Component recordings**: the real `PresetEditor` rendered in the test
   environment (the shell is the rebuilt one; the old tab is a black box), with
   the same fakes as the Overview recordings (storage, export, download,
   confirm, toast, the Sections tab probe), plus a fake connection list (every
   kind of list, held and failing), a scripted fake `reviewPromptPreset` (a
   stream the recorder feeds event by event, ends, or makes throw), and a mode
   that runs the real reviewer over a fake `llmApi.stream` and a fake
   `storageApi.promptFull`. Action sequences: choosing and clearing
   connections, Start with and without a choice, every kind of event and error,
   restarting, Start while running, leaving the tab, switching presets and
   closing the editor while running, and long output. After each step: the
   shown state and every call.
2. **Real Chrome** (the spec writer): screenshots of the old build for the
   builder, and the same flows against the stub in both builds.

The builder gets the recordings, the screenshots and this spec. The recordings
show the old behavior that decisions 1 to 3 change on purpose.
