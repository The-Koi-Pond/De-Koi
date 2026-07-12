# Learnability Follow-up Design

## Purpose

Finish the remaining learnability gaps after the guided first-run work in PR #991. Keep the existing resumable setup journey and navigation architecture intact.

## Behaviors

1. The optional spotlight tour teaches only stable interface regions: welcome, chats, workspace navigation, main workspace, and completion/help. Provider setup, mode comparison, and importing remain contextual tasks owned by Home/readiness, setup flows, and Discover.
2. A send attempt without a model uses one consistent recovery message that names Connections and tells the user to use the guided setup action. It must not direct users to Chat Settings.

## Boundaries

- UI feature lane only: onboarding copy/step definitions and shared chat-input recovery copy.
- No changes to setup-journey state, storage, providers, runtime adapters, or chat creation.
- Preserve the three separate mode owners.

## Proof

- Focused onboarding copy test proves the shorter five-step tour and absence of setup/import lectures.
- Focused recovery-copy test proves the message points to Connections and not Chat Settings.
- `pnpm typecheck`, `pnpm check:architecture`, `pnpm build`, and `pnpm check` gate shipping.
