# Setup Test Guidance Design

## Problem

The setup checklist marks “Connect a language model” complete when a usable connection exists, while the journey still requires that connection to pass a test. The completed row hides its action, so users can be left with a blocked “Choose your experience” row and no explanation or control for the missing test.

## Design

Keep connection creation and connection testing as separate visible prerequisites. The checklist will show these steps in order:

1. Connect to your De-Koi server (web only).
2. Connect a language model.
3. Test your language model.
4. Choose your experience.

The test row is complete only when `selectedConnectionTest` is `passed`. Before a connection exists it remains visible but non-actionable; after a connection exists it exposes the existing `onTestConnection` callback with a “Test connection” button. The experience row remains gated on runtime, connection, and test readiness.

## Boundaries

This is owned by the shell onboarding UI. It changes no engine contract, persistence, runtime adapter, or remote HTTP behavior. Existing callbacks continue routing to the Connections owner.

## Verification

Add a focused component regression test for the stuck state: a usable connection exists, its test is still required, the connection row is complete, and a visible “Test connection” action invokes `onTestConnection`. Run the component test, `pnpm typecheck`, `pnpm check:architecture`, and the full shipping gate before merge.
