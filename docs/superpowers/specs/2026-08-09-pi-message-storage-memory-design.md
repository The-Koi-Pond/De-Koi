# Pi Message Storage Memory Design

## Problem

The Pi server repeatedly reaches its 2 GiB cgroup limit and is OOM-killed, producing a short 502. Live journals show tiny automatic-memory metadata patches repeatedly persisting full message rows whose embedded swipe prompt snapshots are roughly 250 KiB each. The generic patch path clones the full parsed `messages` collection and replaces its dirty cache on every patch.

## Owner and constraints

The owner is the Rust storage capability plus the message/swipe persistence adapter. Preserve journal durability, restart recovery, message ordering, legacy embedded-swipe reads, external API output, and caller-supplied-ID replacement behavior. Do not raise the Pi memory limit or delete user data.

## Design

1. Add a journal-backed record patch capability for checkpoint-tracked collections. It reads and clones only the target record, appends the durable upsert, updates an existing authoritative dirty cache in place when present, and otherwise leaves the large collection uncached.
2. Allow the existing atomic append transaction for `messages` plus `message-swipes` to operate while either collection has a dirty cache. Append rows to disk under the existing crash-recovery journal, extend any cached rows in place, and preserve the prior dirty state so later compaction cannot lose earlier mutations.
3. Route metadata-only message updates through the record-local capability. Generated-message creation then continues using the existing externalized sidecar path even during a dirty session; the embedded-swipe fallback is no longer needed for that condition.

## Proof

- A record-local patch test proves the cached collection allocation is unchanged, only the target row changes, the journal stays compact, and restart recovery retains the patch.
- A dirty-cache append test proves prior dirty mutations plus new message/swipe rows survive restart.
- A message persistence test proves dirty-session generated messages store swipe prompt snapshots only in `message-swipes` while returning the same materialized output.
- Run focused Rust tests, `cargo check --manifest-path src-tauri/Cargo.toml`, `pnpm check:architecture`, full `pnpm check`, Bunny, hosted PR gates, then exact-image Pi deployment proof.
