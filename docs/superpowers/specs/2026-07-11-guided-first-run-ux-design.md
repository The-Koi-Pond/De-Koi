# Guided First-Run UX Design

## Purpose

De-Koi should carry a user's intent from the Home screen to a working Conversation, Roleplay, or Game without making them understand runtime architecture or remember where they were after configuring prerequisites. This design replaces the passive first-run tour with a resumable readiness journey, simplifies desktop navigation, focuses Home on common tasks, and makes recovery states accurate and actionable.

The work covers both the Tauri desktop app and the self-hosted web shell. Existing editors remain the owners of runtime, provider, character, persona, preset, and lorebook data.

## Product Outcomes

- A first-time desktop user can choose a mode, connect and test a model, configure the chat, and enter it without restarting the flow.
- A first-time web user can configure and verify the De-Koi server, then complete the same model and chat journey.
- De-Koi remembers the requested mode and originating context across prerequisite detours.
- Returning users see recent work and quick-start actions before feature education.
- Desktop navigation uses understandable labeled groups rather than nine peer-level icon-only destinations.
- Known failures name the failed layer and offer the relevant recovery action.

## Non-Goals

- Rebuilding provider, runtime, character, persona, preset, lorebook, or chat setup editors.
- Removing advanced settings or power-user controls.
- Changing the separation between Conversation, Roleplay, and Game.
- Changing provider storage, credential storage, generation behavior, or remote runtime protocols.
- Redesigning the in-chat transcript, roleplay scene, or Game HUD.
- Replacing the optional spotlight tour; it remains available as `Show me around`.

## Chosen Approach

Use shared journey state to coordinate existing surfaces. A small React-free state model derives readiness, the next action, and completion from environment facts plus a lightweight persisted user intent. React shell components render the journey, open existing editors, and resume after those editors report success.

This is preferred over a monolithic setup wizard because it avoids duplicating mature provider and content editors. It is preferred over copy-only navigation changes because it preserves task context through detours.

## Ownership And Boundaries

- `src/engine/onboarding`: React-free setup journey types and state derivation. It must not import stores, React, Tauri APIs, feature code, or shared runtime adapters.
- `src/features/shell/onboarding`: readiness checklist UI and shell orchestration.
- `src/features/shell/connections`: existing connection creation and testing UI; it emits focused completion signals but remains the connection owner.
- `src/features/shell/settings`: existing remote runtime configuration; it emits focused completion signals but remains the runtime-settings owner.
- `src/features/modes/router`: action-focused Home composition.
- `src/app/shell`: desktop navigation grouping and shell-level routing between existing surfaces.
- `src/features/modes/shared/chat-ui`: consumes preserved setup intent and continues into existing mode-specific chat setup.
- `src/shared/stores`: persists lightweight setup journey intent and dismissal/completion presentation state only. It must never persist credentials, API keys, provider payloads, or runtime secrets.

Any touched import, shared API, runtime adapter, storage, or cross-feature boundary must continue to satisfy `skills/de-koi-architecture-guard/SKILL.md` and `pnpm check:architecture`.

## Setup Journey Model

The journey stores only user intent:

- requested mode: `conversation`, `roleplay`, or `game`;
- optional originating character identifier;
- whether the readiness checklist is dismissed;
- the last journey action shown, for stable resumption;
- completion presentation state so previously onboarded users are not interrupted.

Readiness facts are derived live rather than persisted:

- execution environment is embedded desktop or web shell;
- web shell has a configured runtime URL;
- configured runtime is reachable and storage is writable;
- at least one language-generation connection exists;
- the selected/default connection has passed the existing validation path where validation is supported.

The model returns one next action:

1. `configure-runtime` for a web shell without a configured server;
2. `repair-runtime` for an unreachable or unhealthy configured server;
3. `create-connection` when no usable language connection exists;
4. `test-connection` when the chosen connection has not passed validation;
5. `configure-chat` when prerequisites are satisfied and a mode intent exists;
6. `choose-experience` when prerequisites are satisfied but no mode is requested;
7. `complete` after setup has produced a usable experience.

Transitions must be deterministic and idempotent. Repeated health or connection completion events must not create multiple chats. Cancelling a detour preserves intent until the user explicitly clears or replaces it.

## First-Run Interaction

Home presents `Start your first experience` with Conversation, Roleplay, and Game choices. Selecting one records intent before checking prerequisites.

An adaptive readiness checklist then shows only relevant work:

- Desktop: `Connect an AI model`, `Test the model`, `Set up your experience`.
- Web: `Connect to your De-Koi server`, `Connect an AI model`, `Test the model`, `Set up your experience`.

The checklist is dismissible. Dismissal never clears intent or progress. A compact `Finish setup` status remains available on Home and in Help until the journey is complete.

For users whose existing `hasCompletedOnboarding` state is true, the checklist does not reopen as a blocking first-run experience. It appears only when a requested action is blocked by a missing prerequisite or when the user explicitly chooses `Finish setup`.

The existing spotlight tutorial becomes an optional `Show me around` action. It explains interface regions but no longer claims that viewing the tour means the product is configured.

## Runtime And Connection Detours

The setup journey opens existing owners rather than embedding duplicate forms.

For web runtime setup, open the existing settings surface directly at the runtime section with a focused banner explaining why it is needed. Prefer user-facing copy such as `Connect to your De-Koi server`; expose `Remote Runtime URL` as the technical field label within the form. After a successful health and writable-storage check, return to the checklist and advance automatically.

For model setup, open Connections with a focused banner and the normal connection creation flow. After a new or existing language-generation connection passes its supported test, return to the checklist and advance automatically. If a provider has no test capability, a successfully saved usable connection satisfies the step and the UI states that limitation honestly.

The journey must not ask the user to choose the same connection again during chat creation. It passes the validated connection identifier into the existing chat creation/setup path.

## Chat Creation And Intent Preservation

Chat creation occurs only after required prerequisites pass. No placeholder or ghost chat is created while runtime or model setup is incomplete.

The preserved intent includes the requested mode and optional character origin. When readiness becomes complete, De-Koi creates exactly one chat using the selected usable connection, applies the starred preset behavior already used by quick start, selects the chat, and opens the existing mode-specific setup flow.

The current settings/wizard booleans should be coordinated behind one setup intent consumption path. A consumed intent is cleared atomically before or while creating the chat so rerenders and repeated events cannot create duplicates. Failure keeps enough intent to retry safely.

Users may cancel chat configuration and return later. The resulting state must be explicit: either no chat was created, or the created draft is visibly identified and resumable. The implementation should prefer delaying creation until the existing wizard requires a chat identifier; if that is not compatible with current hooks, retain the draft and surface a `Finish setup` action rather than leaving an unexplained empty chat.

## Home And Discover

Home prioritizes:

1. readiness or blocked-task continuation when applicable;
2. recent chats;
3. Conversation, Roleplay, and Game quick starts;
4. at most three contextual suggestions.

Contextual suggestions include importing a library, exploring the sample world without a model, and opening Discover. Suggestions depend on current readiness and library state where that information is already cheaply available.

The full feature registry, search, category filters, coverage filters, and inventory counts move to a dedicated Discover surface reachable from labeled navigation and Help. Internal maturity vocabulary such as `coverage`, `experimental`, and `preview` should not dominate Home.

## Desktop Navigation

Desktop navigation always provides labeled access to:

- `Chats`;
- `Deki-senpai`;
- the active workspace;
- `Library` menu: Browser, Characters, Personas, Lorebooks, Presets, Gallery;
- `Tools` menu: Connections, Agents, Settings, Discover.

Only the current workspace and highest-frequency destinations remain persistently visible. Menus use text labels, icons, active state, keyboard navigation, and tooltips as supplemental—not primary—identification. Compact icon-only presentation may be used only when width is constrained, with an accessible labeled overflow control.

Mobile retains the existing labeled Chats, Deki-senpai, and Tools model. Its Tools sheet adopts the same Library/Tools grouping for cross-platform consistency.

## Recovery States

Known failure states distinguish:

- startup loading;
- remote runtime missing;
- remote runtime unreachable or unhealthy;
- storage unavailable;
- connection unavailable or invalid;
- unknown chat-list failure.

Every state offers `Try again` plus at most one primary recovery action appropriate to the failed layer: `Connect server`, `Open Connections`, `View Health`, or `Copy support details`. Unknown errors link to Health rather than claiming the app is still waking up.

Filtered chat empty states provide `Clear filters`; true empty libraries provide the relevant create action.

Error copy remains warm but must not assert a cause the app has not established.

## Accessibility And Responsive Behavior

- Core navigation and checklist controls have persistent visible labels.
- Completion and failure do not rely on color alone; use icons and text.
- Touch targets remain at least 44 CSS pixels on mobile.
- Focus returns to the checklist item that launched a detour when the user comes back.
- Menus and dialogs support Escape, focus containment where modal, and logical keyboard order.
- Checklist progress is announced through semantic list/status markup without noisy repeated live-region updates.
- Existing reduced-motion preferences continue to suppress decorative entrance effects.

## Testing Strategy

Use behavior-first tests and the narrowest stable owner.

- Pure model tests cover every derived next action, desktop/web differences, dismissal/resumption, event idempotency, and intent replacement.
- Home checklist component tests cover adaptive steps, contextual action labels, dismissal, and resumption.
- Navigation tests cover labeled groups, active state, keyboard operation, responsive overflow behavior, and mobile grouping.
- Connections/settings integration tests prove focused setup context and successful return signals.
- Chat orchestration tests prove preserved mode and character context, reuse of the validated connection, exactly-once creation, failure retry, and no ghost chat before readiness.
- Sidebar tests cover mapped recovery actions and filter clearing.

Verification gates:

1. focused Vitest files for each changed unit;
2. `pnpm typecheck`;
3. `pnpm check:architecture`;
4. `pnpm build`;
5. `pnpm check` before shipping;
6. visual validation of desktop and mobile Home, navigation, setup, and recovery states;
7. Bunny review before ready/merge.

## Delivery Shape

Ship one pull request with reviewable commits in this dependency order:

1. setup journey model and persistence contract;
2. readiness checklist plus runtime/connection completion integration;
3. exactly-once chat intent consumption;
4. Home and Discover separation;
5. grouped desktop/mobile navigation;
6. contextual recovery states and final integration polish.

No change is merged until focused tests, architecture checks, the full shipping gate, visual validation, and Bunny review are clean. The PR starts as a draft and is marked ready only after those gates pass.
