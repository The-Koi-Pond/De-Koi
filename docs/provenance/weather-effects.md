# Weather Effects: Behavior Spec

Status: agreed 2026-11-19 (decisions as recommended). Part of the
code provenance plan (`docs/code-provenance-plan.md`, tracked in #1580).

This spec describes the roleplay weather effects: the canvas behind a roleplay
chat that draws rain, snow, fog, sand, embers and the other ambient particles,
a time-of-day tint, a lightning flash, and a sun or moon, from the tracker's
`weather` and `time` text. It is the only input the builder uses. It describes
behavior, not the old implementation.

## Rules for the builder

Build from this spec, the recordings and the team-owned code around it. Don't
open, search, or read the history of the old implementation:

- `src/features/runtime/visuals/components/WeatherEffects.tsx`

You may read every interface listed under "Neighbors", including the existing
team-owned test `WeatherEffects.spec.tsx` (it moves with the module and must
keep passing). If this spec doesn't answer a question, ask the spec writer.

**Safety.** The effects touch only the screen: they read and write no stored
data and send no requests. A mistake is visual. Someone other than the builder
records the old effects as a black box first (see "Black-box recording plan"),
the recordings become tests, and the builder sees the recordings and
screenshots of the old screen, never the old code. Where this text and a
recording disagree, the recording wins, except where a decision below changes
the behavior on purpose; tell the spec writer so the spec gets fixed.

## Scope

Lines not yet team-owned, from `node scripts/code-provenance.mjs --fast` at
`fa6b882de4`:

| File                                                         | Not owned | Of lines |
| ------------------------------------------------------------ | --------: | -------: |
| `src/features/runtime/visuals/components/WeatherEffects.tsx` |       657 |      760 |

Replaced, then deleted in the same change. The new module lives in
`src/features/runtime/visuals/components/weather-effects/` and exports
`WeatherEffects` and `capWeatherParticleMotionFrames` with the same names and
signatures. `src/features/runtime/visuals/index.ts` re-exports them from there,
so `ChatRoleplaySurface.tsx`'s lazy import keeps working unchanged.
`WeatherEffects.spec.tsx` moves into the new folder (import path only).

## Neighbors

- `src/features/modes/roleplay/components/ChatRoleplaySurface.tsx` (team-owned
  caller). Lazy-loads `WeatherEffects` from `runtime/visuals/index` and renders
  `<WeatherEffects weather={state?.weather ?? null} timeOfDay={state?.time ?? null} />`
  inside the chat area when Settings > Appearance > **Weather effects** is on.
  It never passes `showCelestial`.
- `src/features/runtime/visuals/index.ts`: the public barrel.
- `WeatherEffects.spec.tsx`: the existing tests (frame cap, 30 FPS, static
  scene, resize, hidden tab, unmount). Read it for the canvas and frame stubs.

## The shape

```ts
interface WeatherEffectsProps {
  weather?: string | null;
  timeOfDay?: string | null;
  showCelestial?: boolean; // default true
}

export function WeatherEffects(props: WeatherEffectsProps): JSX.Element | null;
/** Clamp to 0..4. */
export function capWeatherParticleMotionFrames(elapsedFrames: number): number;
```

When it renders anything, it renders exactly one element:
`<canvas class="pointer-events-none absolute inset-0 z-0 h-full w-full">`.
Otherwise it renders nothing.

## Reading the weather

Lower-case `weather`, then the **first** matching row wins ("contains" means a
plain substring test). No weather (null, undefined, `""`) means type dust,
count 0, no overlay, no lightning.

| #   | Contains any of                           | Type   | Count                   | Overlay                  | Lightning                         |
| --- | ----------------------------------------- | ------ | ----------------------- | ------------------------ | --------------------------------- |
| 1   | `thunder`, `lightning`                    | rain   | 200                     | `rgba(50,80,120,0.10)`   | yes                               |
| 2   | `rain`, `storm`, `downpour`               | rain   | 200 if heavy, else 80   | `rgba(50,80,120,0.08)`   | if heavy **and** contains `storm` |
| 3   | `hail`                                    | hail   | 60                      | `rgba(180,200,230,0.06)` | no                                |
| 4   | `blizzard`                                | snow   | 150                     | `rgba(200,220,255,0.10)` | no                                |
| 5   | `snow`, `sleet`                           | snow   | 120 if `heavy`, else 50 | `rgba(200,220,255,0.06)` | no                                |
| 6   | `frost`, `cold`, `freez`                  | snow   | 15                      | `rgba(180,210,240,0.06)` | no                                |
| 7   | `fog`, `mist`, `haze`                     | fog    | 20                      | `rgba(180,180,200,0.12)` | no                                |
| 8   | `sand`, `dust storm`, `sirocco`           | sand   | 100                     | `rgba(180,150,100,0.12)` | no                                |
| 9   | `ash`, `volcanic`, `smoke`                | ash    | 40                      | `rgba(80,60,60,0.10)`    | no                                |
| 10  | `ember`, `fire`, `inferno`                | ember  | 35                      | `rgba(120,40,10,0.08)`   | no                                |
| 11  | `wind`, `breez`, `gust`                   | leaf   | 25                      | none                     | no                                |
| 12  | `cherry`, `blossom`, `petal`              | petal  | 30                      | `rgba(255,180,200,0.04)` | no                                |
| 13  | `aurora`, `northern light`, `polar light` | aurora | 6                       | `rgba(20,60,40,0.08)`    | no                                |
| 14  | `clear`, `sunny`, `bright`                | dust   | 12                      | none                     | no                                |
| 15  | `cloud`, `overcast`, `grey`, `gray`       | dust   | 8                       | `rgba(100,100,120,0.05)` | no                                |
| 16  | anything else                             | dust   | 10                      | none                     | no                                |

Row 2 "heavy" means it contains `heavy`, `storm` or `downpour`. Row 5 "heavy"
means it contains `heavy`. Because row 2 comes first, `sandstorm` and
`dust storm` read as heavy rain (with lightning), so row 8's `dust storm` never
matches (see decision 3).

**Clear sky** is true when there is no weather, or the original text matches
`/clear|sunny|bright/i`, or it does **not** match
`/(rain|storm|snow|blizzard|fog|mist|haze|hail|sand|ash|smoke|overcast|cloud|grey|gray)/i`.

## Reading the time of day

Lower-case `timeOfDay`. No time gives: no tint, no fireflies, no stars, body
none, hour unknown (-1), no sun rays, no sunset glow.

**Hour** (0–23, or -1 when none is found), tried in order on the lower-cased
text:

1. `\b(\d{1,2})[:.h](\d{2})\b` (`14:30`, `2.15`, `14h30`): the first number;
   +12 if the text contains `pm` anywhere and it is under 12; 0 if the text
   contains `am` anywhere and it is 12. Used if 0–23.
2. `\b(\d{1,2})\s*(am|pm)\b` (`2 pm`, `11am`): +12 for pm under 12, 12 am is 0.
   Used if 0–23.
3. `\b(\d{4})\s*(?:hours?|hrs?)?\b` (`1400`): the first two digits. Used if
   0–23.

Then the first matching rule wins ("weather type" is the type from the weather
table):

| Rule                                             | Tint                   | Fireflies                | Stars                   | Body | Hour                       | Rays | Sunset glow |
| ------------------------------------------------ | ---------------------- | ------------------------ | ----------------------- | ---- | -------------------------- | ---- | ----------- |
| contains `night` or `midnight`                   | `rgba(10,10,40,0.15)`  | unless type rain or snow | unless type fog or snow | moon | found hour, else 0         | no   | no          |
| contains `dusk`, `sunset`, `twilight`, `evening` | `rgba(80,30,20,0.10)`  | unless type rain         | no                      | sun  | found hour, else 18        | no   | yes         |
| contains `dawn`, `sunrise`, `morning`            | `rgba(120,80,40,0.06)` | no                       | no                      | sun  | found hour, else 7         | yes  | no          |
| hour found, 21–23 or 0–4                         | `rgba(10,10,40,0.15)`  | unless type rain or snow | unless type fog or snow | moon | found hour                 | no   | no          |
| hour found, 17–20                                | `rgba(80,30,20,0.10)`  | unless type rain         | no                      | sun  | found hour                 | no   | yes         |
| hour found, 5–8                                  | `rgba(120,80,40,0.06)` | no                       | no                      | sun  | found hour                 | yes  | no          |
| hour found, 9–16                                 | none                   | no                       | no                      | sun  | found hour                 | yes  | no          |
| contains `noon`, `midday`, `afternoon` or `day`  | none                   | no                       | no                      | sun  | 15 if `afternoon`, else 12 | yes  | no          |
| anything else                                    | none                   | no                       | no                      | none | found hour (-1)            | no   | no          |

## When it renders and animates

- **Shows the sun or moon**: `showCelestial` and the body isn't none.
- **Renders** (the canvas exists) when: count > 0, or fireflies, or stars, or it
  shows the sun or moon, or sunset glow, or clear sky. Otherwise it returns
  nothing and schedules no frames.
- **Animates** (keeps drawing) when: count > 0, or fireflies, or stars, or
  lightning, or (it shows the sun or moon **and** clear sky **and** sun rays).
  A scene that renders but doesn't animate is **static**: drawn once, and again
  after each resize.

Everything below (canvas size, particles, frames) starts over whenever the
weather or the time of day changes, or a `showCelestial` change flips whether
it shows the sun or moon (a change that doesn't flip it, e.g. on a rainy scene,
does nothing). It stops on unmount.

## Canvas size

Let `dpr = window.devicePixelRatio || 1` and `rect` the canvas's
`getBoundingClientRect()`. Width: `rect.width` (0 if not a finite number),
clamped to at most `window.innerWidth` (when that is a finite number above 0)
and at most 4096, and at least 1; times `dpr`, rounded up. Height the same with
`rect.height` and `window.innerHeight`. If width × height is above 16,777,216,
both are scaled by `sqrt(16,777,216 / area)` and rounded down (at least 1).
The canvas's `width` and `height` are set to these, then
`setTransform(dpr, 0, 0, dpr, 0, 0)`. All drawing below is in CSS pixels:
`W = canvas.width / dpr`, `H = canvas.height / dpr`.

The size is set at start and again on every `resize` event on the window and
on every `ResizeObserver` callback for the canvas (when `ResizeObserver`
exists). A static scene schedules one more frame after each of these; an
animated one doesn't (its loop picks the new size up).

## Particles

At start, in this order: `count` particles of the weather type, then 15
fireflies if fireflies, then 30 stars if stars, all created with the `W` and
`H` from the start.

Each random number `r` below is a fresh `Math.random()` (0 ≤ r < 1). Every
particle starts with: `x = r·W`, `y = r·H`, `wobble = r·2π`, `life = 0`, and
then per type (a field listed here replaces the start value):

| Type    | vy          | vx          | size      | opacity      | maxLife     | Other                                                                                 |
| ------- | ----------- | ----------- | --------- | ------------ | ----------- | ------------------------------------------------------------------------------------- |
| rain    | 8 + 6r      | −1 − 2r     | 1.5       | 0.25 + 0.2r  | 200         |                                                                                       |
| snow    | 0.5 + 1.2r  | −0.3 + 0.6r | 2 + 3r    | 0.4 + 0.3r   | 800         |                                                                                       |
| leaf    | 0.8 + r     | 1.5 + 2r    | 4 + 3r    | 0.5 + 0.3r   | 500         |                                                                                       |
| petal   | 0.4 + 0.8r  | 0.5 + r     | 3 + 3r    | 0.4 + 0.3r   | 600         |                                                                                       |
| firefly | −0.2 + 0.4r | −0.3 + 0.6r | 2 + 2r    | 0            | 300 + 300r  |                                                                                       |
| star    | 0           | 0           | 1 + 1.5r  | 0            | 400 + 400r  | `y = r·H·0.4`                                                                         |
| fog     | 0           | 0.2 + 0.4r  | 60 + 80r  | 0.03 + 0.04r | 1000        |                                                                                       |
| dust    | −0.1 + 0.2r | −0.1 + 0.2r | 1 + 2r    | 0.15 + 0.15r | 600 + 400r  |                                                                                       |
| ember   | −1.5 − 1.5r | −0.5 + r    | 2 + 2r    | 0.6 + 0.3r   | 300 + 200r  | `y = H + 10`                                                                          |
| ash     | 0.3 + 0.6r  | −0.4 + 0.8r | 2 + 3r    | 0.2 + 0.2r   | 700 + 300r  | color `rgba(R,G,B,0.6)`, R = ⌊100 + 40r⌋, G = ⌊90 + 30r⌋, B = ⌊90 + 30r⌋              |
| sand    | 0.5 + r     | 4 + 4r      | 1 + 2r    | 0.3 + 0.3r   | 250 + 150r  | `x = −10`; color `rgba(R,G,B,0.7)`, R = ⌊200 + 30r⌋, G = ⌊170 + 30r⌋, B = ⌊110 + 20r⌋ |
| hail    | 10 + 6r     | −1 − r      | 2 + 3r    | 0.4 + 0.3r   | 150         |                                                                                       |
| aurora  | 0           | 0.1 + 0.2r  | 80 + 120r | 0.04 + 0.03r | 1200 + 600r | `y = r·H·0.35`                                                                        |

A **respawned** particle is created the same way with the current `W` and `H`,
except its start `y` is −10 (before the per-type fields, so ember, star and
aurora still set their own `y`, and sand still sets `x = −10`).

Because firefly and star opacity is 0, they are never drawn (see decision 1).

## Frames

Frames come from `requestAnimationFrame`. At most one frame is pending at a
time; none is scheduled while the document is hidden, while a frame is being
drawn, or after stop. The first frame is scheduled at start (unless the
document is hidden then).

On each frame callback with `timestamp`:

1. If stopped or hidden: do nothing.
2. If animated, a frame has been drawn before, and less than 1000/30 ms passed
   since the last drawn frame: schedule the next frame and stop here (30 FPS
   cap).
3. `elapsed` = 1000/60 ms for the first drawn frame (or the first after the tab
   becomes visible again), else `max(0, timestamp − last drawn timestamp)`.
   `frames` = `elapsed / (1000/60)` when animated, else 0. `motion` =
   `capWeatherParticleMotionFrames(frames)` (0..4). The **animation clock**
   grows by `elapsed`, except on the first drawn frame (and the first after the
   tab becomes visible again). Remember `timestamp` as the last drawn one.
4. Draw (below).
5. If animated, schedule the next frame.

When the tab is hidden, the pending frame is cancelled. When it becomes visible
again, the "first drawn frame" rules in step 3 apply again and a frame is
scheduled. Unmount (or a restart) cancels the pending frame and removes the
listeners and the observer.

## Drawing one frame

In this order, all in CSS pixels on the whole `W × H`:

1. `clearRect(0, 0, W, H)`.
2. Tint: if any, `fillStyle = tint`, `fillRect(0, 0, W, H)`.
3. Overlay: if any, `fillStyle = overlay`, `fillRect(0, 0, W, H)`.
4. Lightning (only when lightning): the first flash is due when the animation
   clock reaches `(200 + 400r) · 1000/60` ms (`r` drawn at start). When due:
   flash strength `a = 0.45 + 0.15r`, next one due at clock +
   `(400 + 800r) · 1000/60` ms. While `a > 0`: `fillStyle =
"rgba(220,230,255,a)"`, `fillRect(0, 0, W, H)`, then `a = a · 0.88^frames`
   (the uncapped `frames`); below 0.01 it becomes 0.
5. Sun or moon: only when it shows the sun or moon **and** clear sky. Radius
   `R = min(W, H) · 0.035`; hour = the time's hour, or 12 when unknown.
   - Sun at `x = W·0.08 + t·W·0.84`, `y = H·0.05 + (1 − sin(t·π))·H·0.25`,
     with `t = clamp((hour − 6) / 12, 0, 1)`; drawn as in "The sun".
   - Moon at `x = W·0.1 + clamp(n, 0, 1)·W·0.8`, where `n` is
     `((hour − 21 + 24) mod 24) / 10` for hour ≥ 12, else `(hour + 3) / 10`;
     `y = H·0.05 + (1 − sin(clamp(m, 0, 1)·π))·H·0.2`, where `m` is
     `(hour − 21) / 7` for hour ≥ 12, else `(hour + 3) / 7`; radius `R·1.1`;
     drawn as in "The moon".

6. Particles, from the **last created to the first** (so stars, then fireflies,
   then the weather type, each in reverse). For each particle:
   - `life += motion`, `x += vx·motion`, `y += vy·motion`;
   - snow, leaf, petal, ash: `wobble += 0.02·motion`, `x += sin(wobble)·0.5·motion`;
   - ember: `wobble += 0.04·motion`, `x += sin(wobble)·0.6·motion`;
   - firefly: `wobble += 0.03·motion`, `x += sin(wobble)·0.8·motion`,
     `y += cos(wobble·0.7)·0.4·motion`;
   - draw it (below);
   - then if `y > H + 20`, `y < −20`, `x > W + 20`, `x < −20` or
     `life > maxLife`, replace it (same slot) with a respawned particle of the
     same type.

### Drawing a particle

`alpha = opacity · min(life / 60, 1) · max(1 − life / maxLife, 0)`. If
`alpha ≤ 0`, draw nothing (no canvas calls at all). Otherwise set
`globalAlpha = alpha`, draw, and set `globalAlpha = 1` at the end.

| Type   | Drawing                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| rain   | `strokeStyle = "rgba(180,210,255,0.8)"`, `lineWidth = size`, `beginPath`, `moveTo(x, y)`, `lineTo(x + 2vx, y + 2vy)`, `stroke`.                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| snow   | radial gradient `(x, y, 0) → (x, y, size)`, stops 0 `rgba(255,255,255,0.9)`, 1 `rgba(255,255,255,0)`; fill it; `beginPath`, `arc(x, y, size, 0, 2π)`, `fill`.                                                                                                                                                                                                                                                                                                                                                                                                   |
| leaf   | `fillStyle = "hsl(H, 60%, 45%)"` with H = `100 + sin(wobble)·30`; `save`, `translate(x, y)`, `rotate(wobble)`, `beginPath`, `ellipse(0, 0, size, size·0.4, 0, 0, 2π)`, `fill`, `restore`.                                                                                                                                                                                                                                                                                                                                                                       |
| petal  | as leaf with `hsl(340 + sin(wobble)·15, 80%, 80%)` and `ellipse(0, 0, size, size·0.5, 0, 0, 2π)`.                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| fog    | radial gradient `(x, y, 0) → (x, y, size)`, stops 0 `rgba(200,200,220,0.06)`, 1 `rgba(200,200,220,0)`; then as snow.                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| dust   | `fillStyle = "rgba(255,240,220,0.6)"`, `beginPath`, `arc(x, y, size, 0, 2π)`, `fill`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ember  | `p = sin(life·0.08)·0.3 + 0.7`; radial gradient `(x, y, 0) → (x, y, size·2.5)`, stops 0 `rgba(255,200,60,p)`, 0.4 `rgba(255,100,20,p·0.6)`, 1 `rgba(255,60,10,0)`; fill it; `beginPath`, `arc(x, y, size·2.5, 0, 2π)`, `fill`.                                                                                                                                                                                                                                                                                                                                  |
| ash    | `fillStyle = color`; `save`, `translate(x, y)`, `rotate(wobble)`, `beginPath`, `ellipse(0, 0, size, size·0.3, 0, 0, 2π)`, `fill`, `restore`.                                                                                                                                                                                                                                                                                                                                                                                                                    |
| sand   | `fillStyle = color`, `beginPath`, `arc(x, y, size, 0, 2π)`, `fill`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| hail   | radial gradient `(x − 0.3size, y − 0.3size, 0) → (x, y, size)`, stops 0 `rgba(255,255,255,0.95)`, 0.7 `rgba(200,220,255,0.7)`, 1 `rgba(180,200,240,0.3)`; fill it; `beginPath`, `arc(x, y, size, 0, 2π)`, `fill`.                                                                                                                                                                                                                                                                                                                                               |
| aurora | `hue = (wobble·60 + life·0.3) mod 360`; linear gradient `(x, y − size) → (x, y + size)`, stops 0 `hsla(hue,80%,60%,0)`, 0.3 `hsla(hue,80%,60%,0.08)`, 0.5 `hsla((hue+40) mod 360,70%,55%,0.12)`, 0.7 `hsla((hue+80) mod 360,80%,60%,0.08)`, 1 `hsla((hue+80) mod 360,80%,60%,0)`; fill it; with `w = size·0.6` and `s = sin(life·0.008 + wobble)·30`: `beginPath`, `moveTo(x + s − w, y − size)`, `quadraticCurveTo(x + s/2, y, x + s + w, y + size)`, `lineTo(x + s − w, y + size)`, `quadraticCurveTo(x + s/2, y, x + s + w, y − size)`, `closePath`, `fill`. |

Colors with a computed number print the number as JavaScript prints it in a
template string (no rounding).

### The sun

`save`. With sunset glow: radial gradient `(x, y, R) → (x, y + 6R, 12R)`, stops
0 `rgba(255,140,50,0.12)`, 0.4 `rgba(255,80,30,0.06)`, 1 `rgba(255,40,20,0)`;
fill it; `fillRect(0, 0, W, H)`.

Outer glow: radial gradient `(x, y, 0.5R) → (x, y, 4R)`, stops 0
`rgba(255,120,40,0.15)` (sunset) or `rgba(255,240,180,0.12)`, 0.5
`rgba(255,80,20,0.05)` (sunset) or `rgba(255,240,180,0.04)`, 1
`rgba(255,240,180,0)`; `globalAlpha = 1`; fill it; `beginPath`,
`arc(x, y, 4R, 0, 2π)`, `fill`.

Disc: radial gradient `(x, y, 0) → (x, y, R)`, stops (sunset) 0
`rgba(255,200,100,0.9)`, 0.7 `rgba(255,120,40,0.7)`, 1 `rgba(255,80,20,0.3)`,
or 0 `rgba(255,250,220,0.8)`, 0.7 `rgba(255,240,180,0.5)`, 1
`rgba(255,230,150,0.2)`; `globalAlpha = 0.8`; fill it; `beginPath`,
`arc(x, y, R, 0, 2π)`, `fill`.

Rays (when sun rays): `globalAlpha = 0.06`; for i = 0..11 with clock `c` (the
animation clock in ms): angle `a = i/12·2π + c·0.00012`, pulse
`0.8 + sin(c·0.0006 + 1.5i)·0.2`, length `L = R·(3.5 + 2·pulse)`, spread 0.08;
`fillStyle` `rgba(255,160,60,0.5)` (sunset) or `rgba(255,250,200,0.4)`;
`beginPath`, `moveTo(x, y)`, `lineTo(x + cos(a − 0.08)·L, y + sin(a − 0.08)·L)`,
`lineTo(x + cos(a + 0.08)·L, y + sin(a + 0.08)·L)`, `closePath`, `fill`.

`restore`.

### The moon

`save`. Glow: radial gradient `(x, y, 0.5r) → (x, y, 5r)` (r = the moon's
radius), stops 0 `rgba(180,200,255,0.10)`, 0.4 `rgba(150,180,255,0.04)`, 1
`rgba(150,180,255,0)`; `globalAlpha = 1`; fill it; `beginPath`,
`arc(x, y, 5r, 0, 2π)`, `fill`.

Disc: radial gradient `(x − 0.15r, y − 0.15r, 0) → (x, y, r)`, stops 0
`rgba(230,235,255,0.85)`, 0.8 `rgba(200,210,240,0.6)`, 1
`rgba(180,190,220,0.3)`; `globalAlpha = 0.7`; fill it; `beginPath`,
`arc(x, y, r, 0, 2π)`, `fill`.

Crescent: `globalCompositeOperation = "destination-out"`, `globalAlpha = 0.65`,
`fillStyle = "black"`, `beginPath`, `arc(x + 0.45r, y − 0.1r, 0.85r, 0, 2π)`,
`fill`, `globalCompositeOperation = "source-over"`.

Craters: `globalAlpha = 0.06`, `fillStyle = "rgba(150,160,190,1)"`; three times
`beginPath`, `arc(…)`, `fill` at `(x − 0.25r, y − 0.15r)` radius `0.12r`,
`(x − 0.4r, y + 0.25r)` radius `0.08r`, `(x − 0.05r, y + 0.35r)` radius `0.1r`.

`restore`.

## Layout

The canvas covers its positioned parent (`absolute inset-0 h-full w-full`),
sits at `z-0` and lets every pointer event through. It adds nothing else to the
page.

## Removed

- The type-specific drawing for fireflies and stars (never reached; see
  decision 1).

## Decisions

The rebuild keeps every canvas call and every rendered element exactly as
above.

1. **Fireflies and stars never show.** Night and dusk scenes create 15 fireflies
   and 30 stars, but both start with opacity 0, so they are never drawn; the
   old code still had drawing for them. Recommended: keep them invisible in the
   rebuild (the recordings pin it), drop the dead drawing, and offer a small
   follow-up PR that gives them a real opacity, judged by eye. They still use up
   random numbers and move, which no one can see.
2. **Lightning decays with the uncapped frame count.** After a long pause (the
   tab was busy), the flash fades by `0.88^frames` with no cap while particles
   move at most 4 frames. Recommended: keep as is (it only makes a flash end
   sooner).
3. **Sandstorms read as heavy rain.** Found during the rebuild: the `storm`
   in `sandstorm` and `dust storm` hits row 2 first. Kept (the recordings pin
   it); possible follow-up: test the sand words before row 2.
4. **No `prefers-reduced-motion`.** Particles, rays and lightning animate even
   when the system asks for reduced motion; the only off switch is the setting.
   Recommended: not in this rebuild; possible follow-up.

## Tests

The new module's tests use the recordings:

- Fixed random: with `Math.random` returning the same constant every time (0,
  0.25, 0.5 and 0.999), for every recorded scenario (weather, time,
  `showCelestial`, canvas size, `devicePixelRatio`, frame timestamps, resizes,
  hidden/visible), the canvas size, the rendered element, the
  `requestAnimationFrame`/`cancelAnimationFrame` pattern and every canvas call
  with its arguments and every canvas property set match the recording
  (numbers within 1e-6 relative). A constant random makes the result
  independent of the order in which random numbers are drawn.
- Real random: with a seeded random, every particle field stays within the
  ranges above, and the particles of one type differ from each other (each
  field draws its own random number).
- The existing `WeatherEffects.spec.tsx` tests pass unchanged except for the
  import path.

## Acceptance checks

- Real Chrome, a throwaway roleplay chat on a local server, weather effects on,
  at 1366x900 and 660x900: replaying the recorded weather and time list with
  the same fixed random and fixed frame clock gives the same canvas calls as
  the old build, and screenshots match the old ones by eye.
- A local copy of the Pi data: every roleplay chat's stored weather and time
  gives the same canvas calls in the new build as in the old one (fixed
  random, fixed clock).
- `WeatherEffects.tsx` is gone and nothing imports it.

## Black-box recording plan

Recorded by someone other than the builder, on `main` before the old file is
deleted, with no real data and no model calls (this screen makes none).
Saved under
`src/features/runtime/visuals/components/weather-effects/test-fixtures/` as
one-line JSON (listed in `.prettierignore`, so the provenance report doesn't
count recordings as code).

1. **Component recordings** (`recorded-frames.json`): the old component
   rendered in the test environment as a black box: a logging canvas context
   (every call and property set, numbers as given), a manual
   `requestAnimationFrame` clock, a fixed `getBoundingClientRect`,
   `innerWidth`/`innerHeight` and `devicePixelRatio`, and `Math.random` fixed
   to each constant above. Scenarios: every weather row (with heavy and storm
   variants), no weather, every time rule (named times, `14:30`, `2 pm`,
   `12 am`, `1400`, hour edges 4/5/8/9/16/17/20/21), `showCelestial` false,
   unknown words, sizes 640x360, 1366x900 at dpr 1 and 2, a size over the
   pixel cap, a zero size, and frame timelines with 16 ms, 34 ms and long
   (500 ms) gaps, a resize, and a hidden-then-visible tab. Long runs (enough
   frames for particles to expire and respawn) log selected frames in full; the
   rest are checked by count. Plus seeded-random runs for the range checks.
2. **Real Chrome** (`recorded-chrome.json` plus screenshots, kept local), headless
   Chrome with a local server and a throwaway roleplay chat whose tracker
   weather and time are set per scenario: the same logging canvas, fixed random
   and manual frame clock injected before the app loads, at 1366x900 and
   660x900, and a screenshot of each scenario with a seeded random and a normal
   clock.

The builder gets the recordings, the screenshots and this spec.
