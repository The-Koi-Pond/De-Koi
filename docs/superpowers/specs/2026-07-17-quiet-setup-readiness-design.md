# Quiet setup readiness design

## Claim

Starting a new chat should not mount setup UI until De-Koi knows that a required runtime or language connection is unavailable.

## Owner and boundary

`SetupReadinessJourney` owns both asynchronous readiness discovery and the decision to render the checklist. `useStartNewChat` continues to preserve the requested mode and close detail surfaces. Chat creation, recovery, character shortcuts, and starred-preset application remain unchanged.

## Behavior

- While web runtime health is unknown or checking, render nothing.
- After a healthy web runtime is known, render nothing while connections load.
- In embedded mode, render nothing while connections load.
- Launch automatically when readiness is confirmed.
- Render setup after a runtime failure or a completed connection query with no usable language connection.
- Render launch errors and recovery actions as before.

## Proof

Component tests cover unknown runtime, pending connections, healthy launch, unhealthy runtime, and no connections. The existing start-new-chat test preserves detail closing and pending-mode behavior.
