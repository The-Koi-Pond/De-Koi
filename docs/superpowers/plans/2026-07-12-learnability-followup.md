# Learnability Follow-up Implementation Plan

**Goal:** Complete the two remaining learnability defects after PR #991 without changing its setup orchestration.

## Task 1: Reduce the optional tour to stable orientation

- Update `src/features/shell/onboarding/components/OnboardingTutorial.copy.spec.tsx` first to require five steps and reject connection/import steps.
- Run the focused test and confirm it fails.
- Update `src/features/shell/onboarding/components/OnboardingTutorial.tsx` by removing the mode, connection, and import steps; revise workspace-navigation and final copy to point users to Home, readiness, Discover, and Help.
- Run the focused test and confirm it passes.

## Task 2: Standardize missing-model recovery copy

- Add a narrow exported pure copy constant near the shared chat input owner and a focused spec that requires `Connections` and rejects `Chat Settings`.
- Run the focused test and confirm it fails before implementation.
- Use the constant in the existing missing-model alert path.
- Run the focused test and confirm it passes.

## Task 3: Shipping proof

- Run both focused tests together.
- Run `pnpm typecheck`.
- Run `pnpm check:architecture`.
- Run `pnpm build`.
- Run `pnpm check`.
- Review the diff against `origin/main`, run Bunny, commit only intended files, push to `origin`, open a draft PR, mark ready after clean gates, and merge to `main` as explicitly requested.
