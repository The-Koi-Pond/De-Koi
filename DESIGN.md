---
name: "De-Koi"
description: "A playful immersive AI chat, roleplay, and fanfic engine with visual novel warmth."
colors:
  pond-depth: "#020a12"
  parchment-text: "#f2e6d4"
  ink-glass: "#061722ec"
  ember-primary: "#ff8957"
  ember-primary-foreground: "#130804"
  lotus-panel: "#082733"
  lotus-text: "#52e1da"
  koi-mist: "#a8a196"
  pond-accent: "#0e4b58"
  accent-parchment: "#fff0dc"
  coral-danger: "#ff755f"
  teal-rim: "#37d5ca34"
  teal-input-rim: "#37d5ca38"
  sidebar-pond: "#01070d"
  sidebar-divider: "#1a536166"
  light-rice-paper: "#faf6ee"
  light-ink: "#1a2a2e"
  light-lacquer-primary: "#ad4b1c"
  light-celadon: "#e8efe9"
  light-panel: "#ffffffee"
  sillytavern-blue: "#4a72b0"
  pond-theme-abyss: "#0e1313"
  pond-theme-water: "#141b1b"
  pond-theme-shallow: "#202928"
  pond-theme-raise: "#26302f"
  pond-theme-line: "#34403e"
  pond-theme-ink: "#f1ebe5"
  pond-theme-mist: "#a9b3ae"
  pond-theme-koi: "#f7694a"
  pond-theme-koi-tint: "#2d2d2a"
  pond-theme-jade: "#7fbfae"
  pond-theme-danger: "#ff6470"
typography:
  display:
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 700
    lineHeight: 1.3
    letterSpacing: "0"
  headline:
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 700
    lineHeight: 1.3
    letterSpacing: "0"
  title:
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif"
    fontSize: "1rem"
    fontWeight: 700
    lineHeight: 1.35
    letterSpacing: "0"
  body:
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "0"
  label:
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "0"
rounded:
  xs: "2px"
  sm: "4px"
  md: "8px"
  lg: "12px"
  xl: "16px"
  full: "9999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "20px"
components:
  button-primary:
    backgroundColor: "{colors.ember-primary}"
    textColor: "{colors.ember-primary-foreground}"
    rounded: "{rounded.sm}"
    padding: "8px 20px"
  surface-glass:
    backgroundColor: "{colors.ink-glass}"
    textColor: "{colors.parchment-text}"
    rounded: "{rounded.lg}"
    padding: "16px"
  input-default:
    backgroundColor: "{colors.lotus-panel}"
    textColor: "{colors.parchment-text}"
    rounded: "{rounded.md}"
    padding: "8px 12px"
---

# Design System: De-Koi

## 1. Overview

**Creative North Star: "Koi Pond at Dusk"**

De-Koi should feel like a lovingly built story machine: visual, intimate, a little magical, and still practical enough for power users who live in settings panels. The "Velvet Game Console" soul stays, but the default identity now reads as koi moving through dark water: near-black pond depth, warm ember-orange actions, lotus-teal support accents and rims, and parchment text. Light mode exists for comfort and accessibility as a rice-paper / shallow-pond version of the same identity.

This file describes the **Default** visual theme (`src/styles/globals/02-theme-tokens.css`), which is what the hex values below are. The opt-in **Pond** theme, De-Koi's new look, is described in section 7.

The system rejects sterile SaaS dashboards, bland SillyTavern cloning, generic Discord surfaces, and developer-only control panels. Even dense controls should feel like part of an immersive engine, not a spreadsheet of toggles.

**Key Characteristics:**

- Near-black pond shell with warm parchment text, subtle copper edge contrast, and clear mode color separation.
- Compact control density, large enough tap targets, no hidden hover-only essentials.
- Character and scene surfaces may be expressive; settings and editing surfaces stay calm.
- Mobile layouts are first-class play surfaces, not reduced desktop leftovers.

## 2. Colors

The palette is a pond nocturne: black-teal depth, warm koi-orange action, lotus-teal atmosphere and rims, parchment text, and restrained coral danger.

### Primary

- **Ember Primary** (`#ff8957`, `--primary`): Main action color, active icons, highlighted controls, and glow accents in the dark theme.
- **Light Lacquer Primary** (`#ad4b1c`): Light theme equivalent for primary actions and active states. Dark enough for 4.5:1 as text on rice paper and under white button text.

### Secondary

- **Lotus Panel** (`#082733`, `--secondary`): Secondary panels, muted controls, and low-emphasis button backgrounds. Its text color is **Lotus Text** (`#52e1da`).
- **Pond Accent** (`#0e4b58`, `--accent`): Active tabs, selected areas, and roleplay mood accents.

### Tertiary

- **Koi Mist** (`#a8a196`, `--muted-foreground`): Warm quiet metadata, low-emphasis labels, and footer text.
- **Teal Rim** (`#37d5ca34`, `--border`; a touch stronger, `#37d5ca38`, for `--input`): Default dark-theme border and input stroke; use it to give ink surfaces a quiet edge without outlining every panel loudly.
- **SillyTavern Blue** (`#4a72b0`): Compatibility theme primary color only. Do not let it overtake the De-Koi default identity.

### Neutral

- **Pond Depth** (`#020a12`, `--background`): Default app background.
- **Parchment Text** (`#f2e6d4`, `--foreground`): Default body text on dark surfaces.
- **Ink Glass** (`#061722ec`, `--card`; popovers use the slightly more solid `#061722f2`, `--popover`): Card, popover, and elevated shell surfaces.
- **Sidebar Pond** (`#01070d`, `--sidebar`): Persistent navigation and app frame.
- **Sidebar Divider** (`#1a536166`, `--sidebar-border`): Faint teal shell edge used to separate menus from atmospheric art.
- **Light Rice Paper** (`#faf6ee`): Light theme app background.
- **Light Panel** (`#ffffffee`): Light theme panels and popovers.

### Named Rules

**The Ember Is Earned Rule.** Ember orange is for actions, selection, and emotional emphasis. Do not flood panels with orange; the pond should breathe.

**The Pond Reads First Rule.** The background is teal-ink, not violet-ink. Do not reintroduce purple casts in card surfaces, popovers, or scrollbars.

**The Rim Gives Shape Rule.** Dark cards need a quiet teal rim, inset highlight, or mode-specific label color. Do not leave primary home tiles as flat teal panels, and do not let borders become the dominant visual.

**The Compatibility Theme Rule.** The SillyTavern visual theme is a compatibility skin, not the source of De-Koi's default visual identity.

### Signature Motifs

- **Koi Mark** (`public/koi-mark.svg`): Small two-stroke mark used around the home wordmark.
- **Lotus Divider** (`public/lotus-divider.svg`): Thin teal divider with a central lotus diamond for lightweight separators. Nothing uses it at the moment.
- **Koi Pond Background** (`public/koi-bg.svg`): Sumi-e koi silhouette mask for opt-in atmospheric shells only, starting with the mode home surface. Color it through CSS gradients, keep the center dark enough for content, and prefer the simplified silhouette over the detailed one for app chrome.
- **Koi Ripple** (`.koi-ripple`): Short active-press feedback for quick-start tiles, disabled by reduced-motion preference.

## 3. Typography

**Display and Body Font:** Inter when it is installed on the device, otherwise the system sans (Segoe UI on Windows, Roboto on Android, San Francisco on Apple). Inter is not bundled, so most Windows users see Segoe UI. A font chosen in Settings > Appearance replaces Inter (`--font-user`).
**Straight Quotes:** Not a real font. A tiny `@font-face` (`03-base-shell.css`) that draws only `"` and `'` from Arial or Helvetica, so quotes stay straight whatever the main font is.
**Label/Mono Font:** System sans for labels; Consolas, Monaco, Courier New for inline and fenced code.

**Character:** The type system is clean and readable, with personality coming from color, surfaces, motion, sprites, and game UI rather than ornate fonts.

### Hierarchy

- **Display** (700, `1.5rem`, 1.3): Compact page and modal headings. Reserve larger hero scale for true first-viewport brand moments.
- **Headline** (700, `1.25rem`, 1.3): Section headings and important drawer titles.
- **Title** (700, `1rem`, 1.35): Card titles, message author labels, compact panels.
- **Body** (400, `0.875rem`, 1.5): Default app text, chat metadata, settings descriptions, and dense controls. Keep prose line length around 65 to 75 characters where possible.
- **Label** (600, `0.8125rem`, 1.25): Buttons, chips, tabs, field labels, compact status text.
- **Micro** (500 to 700, `0.5625rem`): Tag chips, counters, badges, and HUD readouts. This is the smallest size in the app.

### Named Rules

**The No Tiny Mystery Rule.** Mobile controls must keep labels and icon buttons readable without hover help.

**The Compact Is Not Cramped Rule.** Dense panels may use small type, but text must not clip, overlap, or rely on negative letter spacing.

**The Nine-Pixel Floor Rule.** No text renders smaller than `0.5625rem` (9px at the default root size). When a badge or tile cannot fit its text at that size, change the layout, not the type.

## 4. Elevation

De-Koi uses a hybrid of tonal layering, low glow, and selective frosted surfaces. Core reading areas should stay stable and legible; blur and glow belong to shell chrome, overlays, and special immersive moments.

### Shadow Vocabulary

- **Glass Strong** (`--glass-strong-shadow`: `0 18px 46px rgba(0, 0, 0, 0.48), inset 0 1px rgba(255, 230, 194, 0.12)`): Modals, strong popovers, and elevated shell panels.
- **Control Lift** (`0 2px 6px rgba(0, 0, 0, 0.2)`): Primary compact buttons at rest.
- **Control Hover Lift** (`0 3px 8px rgba(0, 0, 0, 0.3)`): Buttons that rise on hover or focus.
- **Character Glow** (`.glimmer-avatar-ring`: `0 0 12px` of the primary color at 25%, `0 4px 12px rgba(0, 0, 0, 0.15)`): Avatar rings, roleplay focus, and expressive character states.

### Named Rules

**The Reading Surface Rule.** Never put heavy blur behind long chat text, JSON editors, prompt editors, or logs. Use solid or near-solid surfaces there.

## 5. Components

### Buttons

- **Shape:** Compact rounded rectangles with 4px to 8px radius for tools; circular icon buttons for icon-only actions.
- **Primary:** Ember Primary background with dark foreground in dark mode; Light Lacquer Primary with light foreground in light mode.
- **Hover / Focus:** Small lift, low glow, or border contrast. Focus states must be visible without relying on color alone.
- **Secondary / Ghost:** Use muted lotus surfaces, borders, and icon color shifts. Do not invent large pill buttons for every action.

### Chips

- **Style:** Small rounded pills or compact segmented controls with border and tint.
- **State:** Selected states need both tonal fill and clear text/icon treatment. Color alone is not enough.

### Cards / Containers

- **Corner Style:** 8px to 12px for most panels; keep repeated cards restrained.
- **Background:** Use Ink Glass or tokenized card surfaces. Use stronger opacity for editors, logs, and settings.
- **Shadow Strategy:** Flat by default, lifted only for popovers, modals, hoverable cards, and special game surfaces.
- **Border:** Use tokenized borders such as the Teal Rim (`--border`). Avoid decorative side stripes.
- **Internal Padding:** 12px to 20px depending on density.

### Inputs / Fields

- **Style:** Tokenized input stroke, muted lotus or card background, 8px radius, readable contrast.
- **Focus:** Ring color uses the primary token, with visible outline or border shift.
- **Error / Disabled:** Error state uses Coral Danger plus text or icon. Disabled controls reduce opacity but must remain readable.

### Navigation

- **Style:** Persistent sidebars use Sidebar Pond, compact labels, active ember or lotus accents, and enough contrast for long sessions.
- **Mobile Treatment:** Navigation and settings controls must be touch-friendly, avoid hover-only disclosure, and keep primary chat actions reachable.

### Chat and Roleplay Surfaces

Conversation mode can use familiar message bubbles, but roleplay should feel more like a visual novel surface. Sprites, backgrounds, narration boxes, dice, maps, and command badges should support the scene without making logs or controls hard to scan.

## 6. Do's and Don'ts

### Do:

- **Do** use the existing semantic tokens (`--primary`, `--background`, `--card`, `--muted`, `--border`) before adding one-off colors.
- **Do** keep roleplay surfaces immersive, with room for sprites, backgrounds, voice, image prompts, and command results.
- **Do** make mobile controls touch-friendly and readable, especially settings drawers, prompt editors, maps, logs, and modal workflows.
- **Do** pair color with labels, icons, shape, or state text for color-blind support. Status dots that differ only by color use the shared shapes: solid, `cb-shape-crescent`, `cb-shape-bar`, `cb-shape-ring` (`presenceDotClass` for presence), with `--cb-cutout` set to the surface behind the dot.
- **Do** use solid or near-solid surfaces for long text, JSON repair, prompt previews, and advanced parameter fields.

### Don't:

- **Don't** turn De-Koi into a sterile SaaS dashboard with gray card grids and dry enterprise spacing.
- **Don't** make it a bland SillyTavern clone. Compatibility themes may exist, but De-Koi's default should keep its own koi-pond visual novel identity.
- **Don't** make it feel like a generic Discord clone. Chat familiarity is useful, but roleplay needs its own atmosphere.
- **Don't** build developer-only control panels that assume technical confidence. Advanced settings still need clear labels, forgiving defaults, and helpful validation.
- **Don't** use colored side-stripe borders, decorative gradient text, nested cards, or glassmorphism as the default layout answer.
- **Don't** rely on hover for important mobile actions.

## 7. The Pond theme (the new look, opt-in)

Pond is De-Koi's new look, picked in Settings > Appearance > Visual Style ("Pond (new look)"). It is being built in steps beside the Default theme, and is planned to become the default once the team is happy with it. Its styles live in `src/styles/themes/pond.css`, active when `data-visual-theme="pond"` is set on the root element.

**Direction:** a measured step towards the De-Koi logo and The Koi Pond's studio look, without turning into a cartoon. Pond uses the studio palette from the website repository's `branding/BRAND.md` ("The pond colours"): the pond at night (dark) and tea-rice (light), paper, ink, mist, line, koi vermilion, jade and danger crimson. Change them there first, then here.

### Colors

A stack of solid surfaces, from deepest to highest. Water, Shallow and Line are the brand's own colours; Abyss and Raise are derived one step either side:

| Layer   | Dark      | Light     | Source                                | Used for                                                                |
| ------- | --------- | --------- | ------------------------------------- | ----------------------------------------------------------------------- |
| Abyss   | `#0e1313` | `#ebefed` | water, a step deeper                  | sidebars and the app frame, muted wells (`--sidebar`, `--muted`)        |
| Water   | `#141b1b` | `#f3f6f4` | brand "Pond at night" / "Tea-rice"    | the app background (`--background`)                                     |
| Shallow | `#202928` | `#ffffff` | brand "Paper"                         | cards, panels and most inputs (`--card`, `--secondary`); light popovers |
| Raise   | `#26302f` | `#e5eae8` | paper 30% / tea-rice 50% towards Line | dark popovers, hover states (`--popover`, `--accent`)                   |
| Line    | `#34403e` | `#d8dddb` | brand "Line"                          | borders and input strokes (`--border`, `--input`)                       |

- **Ink** (`#f1ebe5`; `#2b2420` in light): text.
- **Mist** (`#a9b3ae`; `#5f6b67` in light): quiet text.
- **Koi vermilion** (`#f7694a`; `#b8341c` in light): actions, selection, focus rings and titles only. A clear, saturated orange-red (hue about 10°), deliberately not the dusty clay orange (about 15–19°, around 60% saturation) that reads as AI-made next to cream. Text on vermilion buttons is `#141b1b` in dark and white in light.
- **Vermilion tint** (`#2d2d2a`; `#f8ebe8` in light, the brand's): behind selected sidebar rows (`--sidebar-accent`), with vermilion text on it (4.65 and 5.09:1). Anything warmer drops below 4.5:1.
- **Danger crimson** (`#ff6470`; `#b0213a` in light, `--destructive`): kept apart by hue from the vermilion and from Fanfic's pink. Still pair it with words or icons, never color alone.
- **Jade** (`#7fbfae`; `#3f7668` in light): quiet accents and secondary text.
- **Scrollbars:** a grey-green thumb (`#738d88`; `#6e807b` in light), at least 3.4:1 against every layer, on a clear track.

Every text colour reaches 4.5:1 on every layer, except jade on a light hover row (4.31:1).

### Rules

**The Solid Water Rule.** Surfaces are solid layers, not frosted glass. The surface tokens are opaque, so the shell panels (sidebars, right panel, top bar) show no blur even where their classes still carry one. Other panels with their own see-through backgrounds (`bg-[var(--card)]/80` and similar plus `backdrop-blur-*`: the tracker panel, some toolbars and overlays) are not restyled yet.

**The One Glow Rule.** Barely any glow. No Y2K stars, scanlines, noise or glowing title text; the body background and the home screen's koi silhouette give way to plain water. The sidebar, right panel and top bar still keep the default's soft shading and drop shadows for now.

**The Pond Pebbles Rule.** Pond Pebbles (`public/fonts/PondPebbles.woff2`, The Koi Pond's own font) is for the app name and big panel titles only, in koi orange, through the `de-koi-display-title` class (which does nothing in other themes). Never for body text, buttons or labels. Body text keeps the plain app font.

### Still to come

The icon-only navigation rail, settings as a drawer with a hint under each tab, and the home screen's fish ring (three koi circling the logo, with ripples spreading out) with the random splash line kept beside the logo.
