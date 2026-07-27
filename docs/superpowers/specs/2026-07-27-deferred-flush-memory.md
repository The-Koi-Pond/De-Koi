# Deferred Flush Memory Repair

## Problem

De-Koi's file storage keeps dirty collection rows in memory until their append
journal reaches a compaction threshold. A deferred flush currently clones every
dirty collection before deciding which journals need compaction. On the Pi,
large dirty message, swipe, and chat collections therefore create multiple
full in-memory copies while the global storage write lock is held. Unrelated UI
reads wait behind that work, and memory pressure can reach the container limit.

## Owner and boundary

This belongs to the `src-tauri/crates/storage` Rust capability. Public storage
CRUD contracts, journal formats, frontend APIs, and runtime dispatch remain
unchanged.

## Design

Deferred flush will:

1. Snapshot only the names of dirty cached collections.
2. Evaluate journal compaction policy from those names and journal metadata.
3. Recover the append checkpoint once if a selected collection requires it.
4. Clone, serialize, and release one selected collection at a time.
5. Leave dirty collections below their compaction threshold journal-backed and
   un-cloned.

Shutdown flush keeps its existing force-compaction behavior. Candidate
evaluation errors still occur before any selected collection is written.

## Verification

A focused test-only clone observer will prove that a deferred flush containing
two dirty collections clones only the collection whose journal crosses the
threshold. Existing threshold, shutdown, recovery, corruption, and workspace
tests cover the preserved behavior. Architecture and full repository checks
remain required because this is a shipping storage change.

## Scope boundary

This repair removes the reproduced deferred-flush clone amplification. It does
not redesign multi-collection atomic updates, which intentionally load their
transaction working set together.
