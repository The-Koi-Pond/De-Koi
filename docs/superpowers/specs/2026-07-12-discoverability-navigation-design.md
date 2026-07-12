# Discoverability Navigation Design

## Goal

Make De-Koi features findable from anywhere in the app, let users search for individual settings, and turn discovery results into reliable deep links instead of directions that still require menu hunting.

## Scope

This change will:

- Add persistent Discover entry points to desktop navigation, mobile Tools, and Help.
- Add stable destination identifiers for panels, Settings tabs, and specific Settings sections.
- Add Settings search that opens and highlights the owning section.
- Rank Discover results by user intent instead of registry order alone.
- Replace the default flat Discover preview with task-oriented starting points while preserving full browsing.
- Present user-facing maturity labels as Everyday, Advanced, and Experimental.

Analytics and telemetry are explicitly excluded. Measuring searches or navigation behavior requires a separate privacy and product decision.

## Architecture

The existing `src/features/shell/discovery` package remains the owner of feature metadata, search, ranking, destination contracts, and Discover UI. Shell components may open Discover through a small discovery event or focused navigation action, but they will not duplicate feature metadata.

Settings remains owned by `src/features/shell/settings`. It will expose a focused registry of searchable Settings destinations, including stable section IDs and user-facing search metadata. Discovery actions may reference these IDs, while Settings owns resolving them to tabs, scrolling after render, and temporary highlighting.

The UI store will contain only durable navigation state needed to cross the shell boundary: the active Settings tab and a pending Settings destination. It will not contain search indexes or DOM nodes. All scrolling uses stable element IDs registered by Settings surfaces, never CSS selectors derived from display copy.

## User Experience

### Persistent entry points

- Desktop: add a Discover action to the title-bar panel navigation with an accessible label and active state.
- Mobile: add Discover to the Tools sheet alongside the existing panels.
- Help Hub: add a prominent `Find a feature` action.
- All three routes open the same Discover surface and preserve the current chat.

Discover will become a normal right-panel destination rather than requiring the user to return Home. The Home version remains available as a larger landing presentation.

### Discover landing view

Search remains the primary control. When no query or filter is active, the panel shows task-oriented starting points:

- Start chatting
- Customize characters and worlds
- Improve responses
- Add images, voice, or music
- Import or back up data
- Troubleshoot something

Each task applies an explicit category or curated feature-ID filter. `Browse all features` reveals the complete catalog. Search and manual category filters always override the task preview.

### Search ranking

Matching remains deterministic and local. Results receive descending weights for:

1. Exact normalized title match.
2. Title prefix match.
3. Title term match.
4. Keyword match.
5. Summary, audience, location, category, and maturity match.

Every query term must still match somewhere, preventing unrelated fuzzy results. Ties preserve registry order. Everyday features receive a small tie-break boost over Advanced and Experimental features. No fuzzy dependency will be added.

### Settings search and deep links

Settings adds a search field above its tabs. Results identify the owning tab and section. Selecting a result:

1. Activates the Settings panel and owning tab.
2. Waits for the section to render.
3. Scrolls the stable destination element into view with reduced-motion-aware behavior.
4. Applies a short, non-blocking highlight.
5. Clears the pending destination so reopening Settings does not repeat the jump.

If a registered destination is unavailable, Settings still opens the owning tab and silently omits scrolling. Invalid destination identifiers are rejected by registry validation and tests rather than producing user-facing errors.

## Data Contracts

Discovery actions will distinguish broad navigation from Settings destinations. A Settings action may provide a validated destination ID in addition to its tab. Destination metadata includes:

- Stable ID.
- Owning Settings tab.
- User-facing title.
- Search keywords.
- Optional description.

The discovery registry validator and `check:discovery` script must reject unknown Settings tabs and destination IDs. Existing broad Settings actions remain valid when no narrower destination exists.

Current internal coverage values can remain stable for compatibility, but the UI maps them to user language:

- `core` -> `Everyday`
- `advanced` -> `Advanced`
- `experimental` -> `Experimental`
- `needs-polish` -> `Experimental`

The `needs-polish` maintenance distinction is not shown to users.

## Accessibility and Responsive Behavior

- New navigation controls receive visible tooltips where the surrounding surface uses icon-only actions, `aria-label`, and pressed/selected state.
- Settings search is keyboard accessible and exposes its result count.
- Search results use buttons with descriptive names including the owning Settings tab.
- Scrolling honors `prefers-reduced-motion`.
- The highlight cannot be the only indicator; the selected result and tab change provide semantic context.
- Desktop and mobile entry points open the identical Discover owner.

## Testing and Proof

Use behavior-first tests for:

- Weighted Discover ranking and deterministic ties.
- Task-oriented filters and full-catalog fallback.
- Discovery registry rejection of invalid Settings destinations.
- Desktop and mobile Discover navigation availability.
- Help Hub `Find a feature` routing.
- Settings search matching and selection.
- Pending destination consumption, tab selection, scroll request, and clearing.
- User-facing maturity labels.

Required verification:

- Focused Vitest suites for discovery, Settings, and shell navigation.
- `pnpm typecheck`
- `pnpm check:architecture`
- `pnpm build`
- `pnpm check`
- Browser proof at desktop and mobile widths for persistent access, Settings search, and one deep-linked destination.

## Boundaries and Risks

- Do not introduce analytics, telemetry, remote search, or a fuzzy-search dependency.
- Do not move Settings ownership into the shell or discovery package.
- Do not encode DOM selectors or translated display copy as destination identifiers.
- Do not redesign unrelated right-panel navigation or Settings controls.
- Preserve the current Home quick-start cards, onboarding flow, and separation between chat modes.
- The main regression risk is stale destination metadata. Shared validation and tests must fail when a discovery entry references an unknown Settings target.

## Success Criteria

- A user can open Discover without leaving an active chat on desktop and mobile.
- Help offers a direct route for finding features.
- Searching Settings returns individual sections rather than only requiring tab knowledge.
- Selecting a deep-linked result opens, scrolls to, and identifies the correct Settings section.
- Discover results rank obvious title and keyword matches ahead of incidental description matches.
- The default Discover state teaches user goals without hiding the complete catalog.
- No telemetry or external service is introduced.
