# Deferred Flush Memory Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent deferred storage flushes from cloning every dirty collection before compaction selection.

**Architecture:** Keep the repair inside the Rust storage capability. Split metadata-only candidate selection from row cloning, then serialize one selected collection at a time while preserving the existing global write boundary and journal recovery semantics.

**Tech Stack:** Rust, serde_json, De-Koi file storage journals, Cargo, pnpm repository checks.

---

### Task 1: Prove the clone amplification

**Files:**
- Modify: `src-tauri/crates/storage/src/lib.rs`

- [ ] Add a test-only observer at the exact row-clone boundary.
- [ ] Add a focused test with two dirty generic collections where only one journal reaches the entry threshold.
- [ ] Run the focused test and confirm it fails because both dirty collections are cloned.

### Task 2: Select before cloning

**Files:**
- Modify: `src-tauri/crates/storage/src/lib.rs`

- [ ] Snapshot dirty collection names without cloning row vectors.
- [ ] Evaluate all compaction candidates before any writes so errors stay fail-closed.
- [ ] Clone, write, rebuild derived chat data, remove the journal, and mark clean for one selected collection at a time.
- [ ] Run the focused test and adjacent storage compaction/recovery tests.

### Task 3: Verify and ship

**Files:**
- Modify only proof or workflow files required by repository gates.

- [ ] Run formatting, the complete storage crate suite, Rust workspace checks, architecture checks, and `pnpm check`.
- [ ] Review the full diff and run Bunny; resolve all blocking findings.
- [ ] Commit intentionally, push only to `origin`, create the PR, wait for required CI, rerun Bunny after PR-affecting pushes, and merge.
- [ ] Deploy the exact merged revision to the Pi and verify health, image labels, containers, mounts, memory, and representative read latency.
