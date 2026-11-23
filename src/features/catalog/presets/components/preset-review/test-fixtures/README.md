# Preset AI Review tab recordings

Black-box recordings of the old preset editor **AI Review** tab (see `docs/provenance/preset-review.md`), made from the
old build before the old code was replaced. One-line JSON, listed in `.prettierignore`. Don't edit them by hand.
Spec decisions 1 to 3 add attributes on purpose.

They were made with the same recorder as the Overview recordings, so the file shape, the worlds, the fakes, the steps
and the step results are exactly as described in `../../preset-overview/test-fixtures/README.md` (read it first).
Only the differences are listed here. No recording makes a model call.

## Files

| File                           | Scenarios | Steps | What                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------------ | --------: | ----: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `recorded-show.json`           |        13 |    38 | the tab with every connection list (none, two, one, odd rows, 40 rows, `null`, an object), a held and a failing list, tab cycling, a blank preset, leaving while the list is held, focus                                                                                                                                                                                                    |
| `recorded-actions-pick.json`   |         8 |    37 | choosing and clearing, Start without a choice, odd ids, choosing once a held list arrives, the choice lost on remount and on a preset switch, many rows, an unknown value                                                                                                                                                                                                                   |
| `recorded-actions-review.json` |        22 |   172 | the scripted reviewer: tokens, `done`, odd token and error data, unknown events, thrown `Error` / `ApiError` (429, 500) / string / `AbortError`, restarting, Start while running, clearing the choice while running, leaving the tab, starting again after a remount (two streams), switching presets and closing the editor while running, long output, a dirty editor, Save while running |
| `recorded-actions-real.json`   |        11 |    79 | the real reviewer over a fake model stream: a JSON review, plain text, an empty stream, a thinking block, error chunks, a stream that throws, a missing preset, a failing `promptFull`, no sections, an odd preset                                                                                                                                                                          |

54 scenarios, 326 step results in all.

## Differences from the Overview recordings

### Worlds

`connections` sets: `NONE` (`[]`), `TWO` (default: `c-1` "OpenRouter", `c-2` "NanoGPT"), `ONE` (`c-1`), `ODD` (an
empty name, a `null` name, no name, an HTML name, a unicode name, an empty id, a numeric id `42`, two rows with id
`c-dup`, a 150-character name), `MANY` (40 rows `c-0`…`c-39`, with extra `provider` and `apiKey` keys), `NULL`
(`null`), `OBJECT` (a single object, not a list). The list fake returns a clone of the set as is.

### Extra fakes

- `storageApi.promptFull(presetId)` logs `["storage.promptFull", presetId]` (op `prompts.full`) and returns
  `{ preset, sections, groups, choiceBlocks }`: clones of the preset row and of the rows with that `presetId`, or `null`
  when the preset row is missing.
- `llmApi` (`shared/api/llm-api`): `stream(request, signal)` logs `["llm.stream", request, signal === undefined ? null : "signal"]`
  and returns a scripted stream (below); `complete(request)` logs `["llm.complete", request]` and throws (never called).
- `reviewPromptPreset` (`engine/generation/prompt-reviewer`) logs
  `["review", { keys: Object.keys(capabilities), storageIsStorageApi: capabilities.storage === <the storageApi fake>, llmIsLlmApi: capabilities.llm === <the llmApi fake> }, input, <number of extra arguments>]`.
  By default it returns a scripted stream. After a `realMode` step it calls the real `reviewPromptPreset` with the same
  arguments instead (which then uses the fakes above).
- **Scripted streams.** Each call to the reviewer fake (scripted mode) or to `llmApi.stream` creates a new stream,
  numbered from 0 in creation order within the scenario. A stream is an async generator that waits until the recorder
  gives it an item: yield a value, throw a value, or end.

### Extra steps

- `["realMode"]`: later reviewer calls run the real reviewer.
- `["choose", value]`: sets the value of the first `select` in the page through the native setter and dispatches a
  bubbling `change` event.
- `["start"]`: clicks the button whose whole text is `Start Review` or `Reviewing…` (even when disabled; a disabled
  button ignores it).
- `["focusSelect"]` / `["focusStart"]`: focus that `select` / that button.
- `["emit", value, n?]`: stream `n` (default: the newest) yields `value`. `["endReview", n?]`: stream `n` ends.
  `["throwReview", spec]`: the newest stream throws `new Error(spec.error)`, `new ApiError(spec.apiError[0], spec.apiError[1])`
  (from `shared/api/api-errors`), a `DOMException("The operation was aborted.", "AbortError")` for `spec.abort`, or
  `spec.raw` as is. Each of these then wakes the stream inside `act` and settles.
- `["deleteStored", id]`, `["save"]`, `["switchPreset", id]`, `["type", …]` and `["tab", label]` are as in the
  Overview README.

Steps on a stream that already ended do nothing.

### Render errors

`show:connections-NULL` and `show:connections-OBJECT` record a `renderError` (the tab throws while rendering, so the
editor shows nothing). Compare render errors by count and by the property being read (`map`), not by the exact engine
message.

## What the decisions change

Compare everything exactly, except:

- Decision 1 adds `aria-label="Connection"` to the connection `select` and `aria-hidden="true"` on the sparkles icon
  (svgs are not part of `labelled`).
- Decision 2 adds `aria-live="polite"` to the output box and `role="alert"` to the error box (so `labelled` gains them
  while they are shown).
- Decision 3 adds `type="button"` (not recorded).

A replay may set aside exactly those attributes (and the `labelled` entries that exist only because of them) after
checking their values, and nothing else.
