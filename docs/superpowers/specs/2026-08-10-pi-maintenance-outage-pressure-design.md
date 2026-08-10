# Pi Maintenance Outage Pressure Design

## Problem

On the live Pi, a temporary Nano-GPT DNS outage caused automatic memory maintenance to attempt 44 provider calls in 28 minutes. Each job independently backed off, but the queue immediately advanced to another pending job using the same unavailable background provider. Chat and scene jobs also fetched the complete chat record across the remote bridge only to read `connectionId`; one observed response was 1.92 MB.

## Design

Keep the fix in the existing owners:

- The TypeScript engine maintenance queue owns provider-failure scheduling. A transient failure raised by either maintenance analysis call marks the current job `retryable` with `lastErrorCode: "provider_unavailable"`, stops the current drain, and acts as a durable queue-wide cooldown. Pending jobs must not bypass that future `nextAttemptAt`. Provider availability failures continue retrying with the existing 1 minute, 5 minute, then 30 minute capped backoff instead of exhausting the ordinary three-attempt job limit and moving the outage to the next job.
- The app startup binding owns background connection selection. It will keep using `StorageGateway.get`, but request only `connectionId` through the existing projected-read option. No new shared API, Tauri command, HTTP dispatch, Rust capability, or persisted schema is required.

The cooldown is deliberately queue-wide. Automatic maintenance selects one preferred background text connection for the worker, and pausing low-priority cleanup is safer than probing every queued target during a provider outage. Foreground generation remains unaffected.

## Error Handling

Only failures thrown by the two provider-backed analysis operations trigger the queue-wide cooldown. Storage, stale-state, lease, and apply failures retain their existing behavior. Explicit terminal provider configuration failures remain failed jobs; transient provider failures remain retryable beyond the ordinary attempt cap so the queue cannot roll the same outage into the next pending target.

## Verification

- A queue regression proves one transient provider failure stops the drain, leaves later jobs untouched, and blocks a direct rerun before `nextAttemptAt`.
- A second queue regression proves the provider circuit breaker remains retryable at and beyond the ordinary maximum attempt count.
- A startup regression proves chat connection selection requests `{ fields: ["connectionId"] }`.
- Focused Vitest, typecheck, architecture checks, full `pnpm check`, Bunny review, hosted CI, and exact-image Pi deployment are required.
- Live proof records health, image revisions, mounts, restart/OOM counters, provider-error cadence, and RSS/memory-limit counters without deleting user data.

## Non-goals

- Cleaning existing orphaned temp files.
- Changing foreground generation retry behavior.
- Changing chat, roleplay, or game prompt/mode semantics.
- Claiming the remaining high Pi RSS is fixed before post-deploy measurement.
