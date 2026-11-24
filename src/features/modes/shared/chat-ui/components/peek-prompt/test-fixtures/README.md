# Peek Prompt viewer recordings

Black-box recordings of the old Peek Prompt viewer (see `docs/provenance/peek-prompt.md`), made from the old build
before the old code was replaced. One-line JSON, listed in `.prettierignore`. Don't edit them by hand. Spec decisions
1 to 4 change some steps on purpose.

## Files

| File                     | Scenarios | Steps | What                                                                                   |
| ------------------------ | --------: | ----: | -------------------------------------------------------------------------------------- |
| `recorded-inputs.json`   |         - |     - | The `data` props (by name) and the preset lists every scenario uses.                   |
| `recorded-messages.json` |        28 |   213 | Every block rule, with and without context kinds; open every block, close one, Escape. |
| `recorded-panels.json`   |        74 |   819 | Preview messages, loading, error, note, badges, settings, budget, attribution.         |
| `recorded-presets.json`  |        26 |    29 | The preset label against five preset lists, and a list that arrives late.              |
| `recorded-close.json`    |        12 |    40 | Close button, backdrop, clicks inside, Escape and other keys, a new `onClose`.         |
| `recorded-overlays.json` |         6 |    17 | Escape with other overlays above, below, inactive, removed and opened later.           |
| `recorded-changes.json`  |         8 |    42 | `data` changing while open (load to data, data to data, patches, to a crash).          |
| `recorded-toggles.json`  |         3 |    27 | Opening and closing chat history entries and blocks in different orders.               |
| `recorded-crash.json`    |        15 |    37 | Data shapes that throw while rendering (and two that don't).                           |

## Inputs

`recorded-inputs.json` is `{ format: 1, data: { <name>: PeekPromptData }, presets: { <name>: list } }`. The preset
list `"__undefined__"` means `usePresetSummaries()` returns `{ data: undefined }` (still loading).

## Harness

Each scenario renders, into a fresh `div` appended to `document.body` with `createRoot`, inside `act`:

```
<>
  {overlays where "before": <OtherOverlay result active />}
  <ErrorBoundary onError={record}>   // renders null after an error
    <PeekPromptModal data={data} onClose={onCloseVersion(n)} />
  </ErrorBoundary>
  {overlays where "after": <OtherOverlay result active />}
</>
```

`OtherOverlay` calls `useEscapeOverlay(() => { log("other"); return result }, active)` and renders nothing.
`usePresetSummaries` from `src/features/catalog/presets/index` is mocked to return `{ data: <current preset list> }`.
Data and lists are passed as fresh JSON copies. `onClose` handlers are numbered from 1; calling one appends its number
to `closes`.

## Steps

`do` is the step:

| Step                  | Action                                                                                                |
| --------------------- | ----------------------------------------------------------------------------------------------------- |
| `["open"]`            | First render.                                                                                         |
| `["toggle", k]`       | Click the k-th `button` in the container that isn't `aria-label="Close"` (document order, right now). |
| `["close"]`           | Click `button[aria-label="Close"]`.                                                                   |
| `["backdrop"]`        | Click `container.firstElementChild` (the backdrop). See decision 4 below.                             |
| `["dialog"]`          | Click the `[role="dialog"]` element.                                                                  |
| `["pre", k]`          | Click the k-th `pre`.                                                                                 |
| `["heading"]`         | Click the first `h1`-`h4`.                                                                            |
| `["key", key]`        | Dispatch a bubbling, cancelable `keydown` with that `key` on `document`; `prevented` is recorded.     |
| `["focusClose"]`      | Focus the Close button.                                                                               |
| `["keyOnClose", key]` | Focus the Close button, dispatch the `keydown` on it; `prevented` is recorded.                        |
| `["data", name]`      | Re-render with `data` = inputs `name`.                                                                |
| `["patch", partial]`  | Re-render with `{ ...data, ...partial }`.                                                             |
| `["presets", name]`   | Switch the mocked preset list and re-render.                                                          |
| `["newOnClose"]`      | Re-render with the next numbered `onClose`.                                                           |
| `["rerender"]`        | Re-render with the same props.                                                                        |
| `["overlays", list]`  | Re-render with this overlay list.                                                                     |
| `["unmount"]`         | Unmount the root.                                                                                     |

A step whose target doesn't exist has `missing: true`. A scenario stops at the first step that crashed.

## Step results

Files are `{ format: 1, pool, scenarios: [{ id, data, presets, overlays, steps }] }`. In each step, `text`,
`buttons`, `labelled`, `pres`, `widths`, `tones` and `icons` are indexes into `pool`.

| Field       | Meaning                                                                                                                                                                                                                      |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `shown`     | `"modal"` when the container has an element child, else `"nothing"`.                                                                                                                                                         |
| `text`      | `container.textContent` with whitespace runs collapsed to one space and trimmed.                                                                                                                                             |
| `buttons`   | Every `button`: `{ text }` (normalized) plus its `aria-*`, `title` and `role` attributes (sorted by name) and `disabled: true` when disabled.                                                                                |
| `labelled`  | Every non-button, non-SVG element with a `title`, `role` or `aria-*` attribute: `{ tag, text }` plus those attributes.                                                                                                       |
| `pres`      | `textContent` of every `pre`, exactly (not normalized).                                                                                                                                                                      |
| `widths`    | `style.width` of every element with a `style` attribute that sets a width, in document order.                                                                                                                                |
| `tones`     | For every non-SVG element whose `class` has color utilities matching `(bg\|text\|border)-(red\|amber\|emerald\|blue\|purple\|green)-<n>[/<n>]`: `[text (normalized, first 120 chars), the matches sorted and space-joined]`. |
| `icons`     | For every `svg`: its `lucide-*` classes sorted and space-joined, plus ` +spin` when it has `animate-spin`.                                                                                                                   |
| `closes`    | The `onClose` numbers called so far.                                                                                                                                                                                         |
| `others`    | The other overlays' Escape calls so far.                                                                                                                                                                                     |
| `focus`     | `null` (body), `{ where: "modal", button: i }` (index in `buttons`), `{ where: "modal", tag, role }` or `{ where: "other", tag }`.                                                                                           |
| `prevented` | For key steps: whether the event's default was prevented.                                                                                                                                                                    |
| `crash`     | Present when rendering threw: `"<name>: <message>"` (compare presence only).                                                                                                                                                 |
| `missing`   | Present when the step's target wasn't there.                                                                                                                                                                                 |

## Changed on purpose (spec decisions)

1. Toggle buttons gain `aria-expanded` (`"true"`/`"false"`) and `type="button"` (`type` isn't recorded).
2. Icons and the budget bars gain `aria-hidden="true"`; that adds bars to `labelled`.
3. The loading area gains `role="status"` and `aria-label="Assembling prompt"`; the error box `role="alert"`. Both
   add a `labelled` entry.
4. The backdrop closes only when the press and the release are both on it. The recordings' `backdrop` step was a bare
   `click()`; replay it as the full sequence on the backdrop (`pointerdown`, `mousedown`, `pointerup`, `mouseup`,
   `click`), which closed the old viewer the same way.
