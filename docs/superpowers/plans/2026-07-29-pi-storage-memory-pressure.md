# Pi Storage Memory-Pressure Implementation Plan

**Goal:** Prevent storage transactions from producing collection-sized memory
copies that can OOM-kill De-Koi on a 2 GiB Raspberry Pi.

**Architecture:** Keep ownership in `src-tauri/crates/storage`. Move updated
row vectors into the transaction and stream their JSON representation into the
existing staged files. Preserve the current manifest, fsync, rename, rollback,
checkpoint, and cache lifecycle.

**Tech stack:** Rust, serde_json, std::io::BufWriter, Cargo tests.

## Task 1: Move requested collection rows

**Files:**

- Modify: `src-tauri/crates/storage/src/lib.rs`

1. Add a focused unit test for extracting only write-requested entries while
   preserving their owned row values.
2. Run the test and confirm it fails because the ownership helper is absent.
3. Implement the helper with `into_iter`, not `clone`.
4. Change the internal transaction replacement representation to own collection
   names and row vectors.
5. Run the focused test and storage crate tests.

## Task 2: Stream staged JSON

**Files:**

- Modify: `src-tauri/crates/storage/src/lib.rs`

1. Add a focused unit test whose writer rejects collection-sized writes.
2. Run the test and confirm it fails because the streaming helper is absent.
3. Implement pretty JSON serialization through `serde_json::to_writer_pretty`.
4. Use a `BufWriter<File>` in the transaction staging loop, then flush and sync.
5. Run the focused test and storage crate tests.

## Task 3: Validate the owner boundary

1. Run `cargo fmt --check`.
2. Run the complete storage crate test suite.
3. Run `cargo check --manifest-path src-tauri/Cargo.toml`.
4. Run the repository architecture check when dependencies are available.
5. Perform the Bunny review pass and address any substantiated findings.

No commit, push, pull request, merge, or Pi deployment is included without
separate authorization.
