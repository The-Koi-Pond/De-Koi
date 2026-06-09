# De-Koi Global CSS Map

This folder splits the former monolithic `src/styles/globals.css` into ordered CSS modules. `../globals.css` stays the entrypoint and import order is part of the cascade contract.

- `00-mobile-world-widgets.css`: mobile world/tracker widget sizing overrides that must load early.
- `01-tailwind-theme.css`: Tailwind custom variant and `@theme` token mapping.
- `02-theme-tokens.css`: dark/light semantic tokens, decorative palette, glass variables, and light-mode overrides.
- `03-base-shell.css`: reset, body, cursors, scrollbars, app chrome, titlebar, and core shell controls.
- `04-surfaces-components.css`: glass panels, side/right panels, home surface, quick-start cards, discovery, settings, reusable UI components.
- `05-effects-utilities.css`: shared keyframes, button effects, dividers, gradient utilities, animation utilities.
- `06-chat-mode-themes.css`: conversation, roleplay, RPG overlays, sprites, HUD, and function-call cards.
- `07-responsive-accessibility.css`: breakpoints, mobile/touch behavior, reduced motion, performance hints.
- `08-game-cinematic-effects.css`: game-mode visual effects, animated text, cinematic direction, Professor Mari pixel scene.

When editing, prefer the narrowest module. Keep selectors in their current module unless moving a whole section and preserving import order.
