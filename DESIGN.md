---
name: "De-Koi"
description: "A playful immersive AI chat, roleplay, and game engine with visual novel warmth."
colors:
  pond-depth: "#05090d"
  parchment-text: "#f1dfc9"
  ink-glass: "#081218ec"
  ember-primary: "#f06f3f"
  ember-primary-foreground: "#0a0a0a"
  lotus-panel: "#0a2325"
  lotus-text: "#65d1c3"
  koi-mist: "#a98c75"
  pond-accent: "#174946"
  accent-parchment: "#fff0dc"
  coral-danger: "#ff7a59"
  lotus-border: "#a45d3d3d"
  sidebar-pond: "#02070a"
  sidebar-divider: "#355d574d"
  light-rice-paper: "#faf6ee"
  light-ink: "#1a2a2e"
  light-lacquer-primary: "#c75a26"
  light-celadon: "#e8efe9"
  light-panel: "#ffffffee"
  sillytavern-blue: "#4a72b0"
typography:
  display:
    fontFamily: "Straight Quotes, Inter, -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 700
    lineHeight: 1.3
    letterSpacing: "0"
  headline:
    fontFamily: "Straight Quotes, Inter, -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 700
    lineHeight: 1.3
    letterSpacing: "0"
  title:
    fontFamily: "Straight Quotes, Inter, -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif"
    fontSize: "1rem"
    fontWeight: 700
    lineHeight: 1.35
    letterSpacing: "0"
  body:
    fontFamily: "Straight Quotes, Inter, -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "0"
  label:
    fontFamily: "Straight Quotes, Inter, -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif"
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

De-Koi should feel like a lovingly built story machine: visual, intimate, a little magical, and still practical enough for power users who live in settings panels. The "Velvet Game Console" soul stays, but the default identity now reads as koi moving through dark water: near-black pond depth, warm ember-orange actions, lotus-teal support accents, copper rims, and parchment text. Light mode exists for comfort and accessibility as a rice-paper / shallow-pond version of the same identity.

The system rejects sterile SaaS dashboards, bland SillyTavern cloning, generic Discord surfaces, and developer-only control panels. Even dense controls should feel like part of an immersive engine, not a spreadsheet of toggles.

**Key Characteristics:**

- Near-black pond shell with warm parchment text, subtle copper edge contrast, and clear mode color separation.
- Compact control density, large enough tap targets, no hidden hover-only essentials.
- Character and scene surfaces may be expressive; settings and editing surfaces stay calm.
- Mobile layouts are first-class play surfaces, not reduced desktop leftovers.

## 2. Colors

The palette is a pond nocturne: black-teal depth, warm koi-orange action, lotus-teal atmosphere, parchment text, subtle copper rims, and restrained coral danger.

### Primary

- **Ember Primary** (`#f06f3f`): Main action color, active icons, highlighted controls, and glow accents in the dark theme.
- **Light Lacquer Primary** (`#c75a26`): Light theme equivalent for primary actions and active states.

### Secondary

- **Lotus Panel** (`#0a2325`): Secondary panels, muted controls, and low-emphasis button backgrounds.
- **Pond Accent** (`#174946`): Active tabs, selected areas, and roleplay mood accents.

### Tertiary

- **Koi Mist** (`#a98c75`): Warm quiet metadata, low-emphasis labels, and footer text.
- **Copper Rim** (`#a45d3d3d`): Default dark-theme border and input stroke; use it to give ink surfaces a quiet edge without outlining every panel loudly.
- **SillyTavern Blue** (`#4a72b0`): Compatibility theme primary color only. Do not let it overtake the De-Koi default identity.

### Neutral

- **Pond Depth** (`#05090d`): Default app background.
- **Parchment Text** (`#f1dfc9`): Default body text on dark surfaces.
- **Ink Glass** (`#081218ec`): Card, popover, and elevated shell surfaces.
- **Sidebar Pond** (`#02070a`): Persistent navigation and app frame.
- **Sidebar Divider** (`#355d574d`): Faint teal shell edge used to separate menus from atmospheric art without louder copper.
- **Light Rice Paper** (`#faf6ee`): Light theme app background.
- **Light Panel** (`#ffffffee`): Light theme panels and popovers.
- **Lotus Border / Copper Rim** (`#a45d3d3d`): Default border and input stroke.

### Named Rules

**The Ember Is Earned Rule.** Ember orange is for actions, selection, and emotional emphasis. Do not flood panels with orange; the pond should breathe.

**The Pond Reads First Rule.** The background is teal-ink, not violet-ink. Do not reintroduce purple casts in card surfaces, popovers, or scrollbars.

**The Rim Gives Shape Rule.** Dark cards need a quiet copper rim, inset highlight, or mode-specific label color. Do not leave primary home tiles as flat teal panels, and do not let borders become the dominant visual.

**The Compatibility Theme Rule.** The SillyTavern visual theme is a compatibility skin, not the source of De-Koi's default visual identity.

### Signature Motifs

- **Koi Mark** (`public/koi-mark.svg`): Small two-stroke mark used around the home wordmark.
- **Lotus Divider** (`public/lotus-divider.svg`): Thin teal divider with a central lotus diamond for lightweight separators.
- **Koi Pond Background** (`public/koi-bg.svg`): Sumi-e koi silhouette mask for opt-in atmospheric shells only, starting with the mode home surface. Color it through CSS gradients, keep the center dark enough for content, and prefer the simplified silhouette over the detailed one for app chrome.
- **Koi Ripple** (`.koi-ripple`): Short active-press feedback for quick-start tiles, disabled by reduced-motion preference.

## 3. Typography

**Display Font:** Straight Quotes with Inter and system sans fallbacks.
**Body Font:** Straight Quotes with Inter and system sans fallbacks.
**Label/Mono Font:** System sans for labels; Consolas, Monaco, Courier New for inline and fenced code.

**Character:** The type system is clean and readable, with personality coming from color, surfaces, motion, sprites, and game UI rather than ornate fonts.

### Hierarchy

- **Display** (700, `1.5rem`, 1.3): Compact page and modal headings. Reserve larger hero scale for true first-viewport brand moments.
- **Headline** (700, `1.25rem`, 1.3): Section headings and important drawer titles.
- **Title** (700, `1rem`, 1.35): Card titles, message author labels, compact panels.
- **Body** (400, `0.875rem`, 1.5): Default app text, chat metadata, settings descriptions, and dense controls. Keep prose line length around 65 to 75 characters where possible.
- **Label** (600, `0.8125rem`, 1.25): Buttons, chips, tabs, field labels, compact status text.

### Named Rules

**The No Tiny Mystery Rule.** Mobile controls must keep labels and icon buttons readable without hover help.

**The Compact Is Not Cramped Rule.** Dense panels may use small type, but text must not clip, overlap, or rely on negative letter spacing.

## 4. Elevation

De-Koi uses a hybrid of tonal layering, low glow, and selective frosted surfaces. Core reading areas should stay stable and legible; blur and glow belong to shell chrome, overlays, and special immersive moments.

### Shadow Vocabulary

- **Glass Strong** (`0 8px 32px rgba(0, 0, 0, 0.3), inset 0 1px rgba(255, 255, 255, 0.1)`): Modals, strong popovers, and elevated shell panels.
- **Control Lift** (`0 2px 6px rgba(0, 0, 0, 0.2)`): Primary compact buttons at rest.
- **Control Hover Lift** (`0 3px 8px rgba(0, 0, 0, 0.3)`): Buttons that rise on hover or focus.
- **Character Glow** (`0 0 10px rgba(240, 111, 63, 0.16), 0 4px 12px rgba(0, 0, 0, 0.15)`): Avatar rings, roleplay focus, and expressive character states.

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
- **Border:** Use tokenized borders such as Copper Rim / Lotus Border. Avoid decorative side stripes.
- **Internal Padding:** 12px to 20px depending on density.

### Inputs / Fields

- **Style:** Tokenized input stroke, muted lotus or card background, 8px radius, readable contrast.
- **Focus:** Ring color uses the primary token, with visible outline or border shift.
- **Error / Disabled:** Error state uses Coral Danger plus text or icon. Disabled controls reduce opacity but must remain readable.

### Navigation

- **Style:** Persistent sidebars use Sidebar Pond, compact labels, active ember or lotus accents, and enough contrast for long sessions.
- **Mobile Treatment:** Navigation and settings controls must be touch-friendly, avoid hover-only disclosure, and keep primary chat/game actions reachable.

### Chat, Roleplay, and Game Surfaces

Conversation mode can use familiar message bubbles, but roleplay and game mode should feel more like visual novel and RPG surfaces. Sprites, backgrounds, narration boxes, dice, maps, and command badges should support the scene without making logs or controls hard to scan.

## 6. Do's and Don'ts

### Do:

- **Do** use the existing semantic tokens (`--primary`, `--background`, `--card`, `--muted`, `--border`) before adding one-off colors.
- **Do** keep game and roleplay surfaces immersive, with room for sprites, backgrounds, voice, image prompts, and command results.
- **Do** make mobile controls touch-friendly and readable, especially settings drawers, prompt editors, maps, logs, and modal workflows.
- **Do** pair color with labels, icons, shape, or state text for color-blind support.
- **Do** use solid or near-solid surfaces for long text, JSON repair, prompt previews, and advanced parameter fields.

### Don't:

- **Don't** turn De-Koi into a sterile SaaS dashboard with gray card grids and dry enterprise spacing.
- **Don't** make it a bland SillyTavern clone. Compatibility themes may exist, but De-Koi's default should keep its own koi-pond visual novel identity.
- **Don't** make it feel like a generic Discord clone. Chat familiarity is useful, but roleplay and game mode need their own atmosphere.
- **Don't** build developer-only control panels that assume technical confidence. Advanced settings still need clear labels, forgiving defaults, and helpful validation.
- **Don't** use colored side-stripe borders, decorative gradient text, nested cards, or glassmorphism as the default layout answer.
- **Don't** rely on hover for important mobile actions.
