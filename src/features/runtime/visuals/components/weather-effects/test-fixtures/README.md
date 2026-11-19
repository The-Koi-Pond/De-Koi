# Weather effects recordings

Black-box recordings of the old weather effects (see `docs/provenance/weather-effects.md`), made before the
old file was deleted. One-line JSON, listed in `.prettierignore`, so the provenance report doesn't count them as
code. Don't edit them by hand.

Each file is `{ format: 1, scenarios: [...] }`. A scenario has:

- `id`: `w:` weather rows, `t:` time rules, `wt:` both, `nocel:` `showCelestial: false`, `size:` canvas sizes,
  `tl:` timelines (resize, hidden tab, prop changes, frame gaps, unmount), `long:` long runs, `seed:` seeded
  random; ending in `:r<constant>` (fixed `Math.random`) or `:s<seed>`.
- `props`, `random` (a constant, or `{ seed }` for a mulberry32 generator), optional `rect` (the canvas's
  `getBoundingClientRect` size, default 640x360), `inner` (`window.innerWidth`/`innerHeight`, default 1366x900),
  `dpr` (default 1), `hiddenAtStart`.
- `steps`: the recorded output per step, in order. The first is `["mount"]`. Step kinds:
  - `["frame", ts]`: run the one pending animation frame with this timestamp (`ran: false` when none was
    pending);
  - `["frames", n, spacing, logged]`: run `n` frames, each `spacing` ms after the previous one; `counts` has
    the number of canvas calls per frame (-1 when no frame was pending), `logged` the full calls of the listed
    frame indexes;
  - `["resize", w, h]`: the canvas's size changes, then a window `resize` event;
  - `["ro", w, h]`: the canvas's size changes, then the `ResizeObserver` callback (a fake observer);
  - `["hide"]` / `["show"]`: `document.hidden` changes, then `visibilitychange`;
  - `["props", patch]`: re-render with the props merged with `patch`;
  - `["unmount"]`, with `listeners`: how many window `resize` and document `visibilitychange` listeners were
    added and removed over the whole run.
- Each step output also has `html` (the rendered markup without `width`/`height`), `size` (the canvas's
  `width`/`height`, or null), `events` (in order: `getContext`, `raf` with its id, `cancel` with the id,
  `ro:new`, `ro:observe`, `ro:disconnect`; a count for `frames` steps) and `ops`.

`ops` is every call on the 2D context and every property set, in order: `[name, ...args]` for a call and
`["=prop", value]` for a set. Numbers have 10 significant digits. Gradients are named `g0`, `g1`, … in the order
they are created, counting from `g0` again after each `globalAlpha = 1`; `createRadialGradient` and
`createLinearGradient` log the name first, `addColorStop` logs the gradient's name, and setting `fillStyle` to a
gradient logs its name. Runs of identical chunks (a chunk ends with `["=globalAlpha", 1]`) are stored as
`{ repeat: n, ops: [...] }`.

`recorded-chrome.json` is the same kind of log from real Chrome (headless, the app on a local server, a
throwaway roleplay chat per scene with weather effects on, fixed `Math.random` 0.5 from the moment the weather
canvas gets its context, and a manual frame clock), at 1366x900 and 660x900.
