# Pi Storage Memory-Pressure Fix

## Problem

On the 2 GiB Raspberry Pi, generation requests can end with the generic
"Your message was kept" recovery toast when the De-Koi server is killed by the
kernel OOM killer during a storage transaction.

The storage transaction path temporarily amplifies memory use in two places:

1. `update_collections_atomically` clones every changed `Vec<Value>` while the
   original collection rows are still retained.
2. `replace_all_many_locked` serializes every staged collection into a complete
   `Vec<u8>` before writing it, retaining the rows and their serialized copy at
   the same time.

Large chat, message, swipe, and character-version collections make those
temporary copies unsafe on the Pi even though the persisted data is valid.

## Design

Consume the atomic-update entries when constructing replacements, moving each
requested row vector into the transaction instead of cloning it.

Stage each JSON collection directly into its temporary file through a buffered
writer using `serde_json::to_writer_pretty`. Flush and sync that file before
continuing with the existing transaction manifest and rename protocol.

The transaction journal, backup installation, rollback behavior, checkpoint
handling, cache invalidation, and post-commit cache population remain unchanged.

## Verification

- A unit test proves requested replacements take ownership of their row vectors
  and omit entries that did not request a write.
- A unit test uses a writer that rejects large individual writes, proving JSON
  staging streams rather than submitting a collection-sized byte buffer.
- Existing storage transaction, recovery, checkpoint, and cache tests remain
  green.
- The Tauri crate compiles and architecture checks remain green.

## Scope

This is a Rust storage-capability repair. It does not change frontend retry
wording, generation semantics, persisted JSON format, or the public storage API.
Deployment to the Pi is a separate shipping step.
