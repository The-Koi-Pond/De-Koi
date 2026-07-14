# Storage Append Journal Implementation Plan

## Goal

Make paired message/swipe creation perform bounded foreground I/O while retaining atomic crash recovery and canonical JSON compatibility.

## Tasks

1. Add focused red tests in the storage crate for bounded append behavior, paired recovery, partial-application recovery, and corrupt journal fail-closed behavior.
2. Add a versioned multi-collection append journal with validation, synchronized append, idempotent replay, checkpoint, and evidence-preserving errors.
3. Add a bounded in-place JSON-array append helper that validates the closing array boundary, writes only the new suffix, truncates stale tail bytes, and synchronizes the file.
4. Replace `append_many_uncached_locked` staging transactions with journal commit followed by bounded application; keep the existing fallback for unsupported collection shapes.
5. Integrate startup replay before ordinary collection-journal recovery and checkpoint pending appends before superseding replacement paths.
6. Run formatting, focused storage tests, architecture and Rust checks, then the full shipping gate.
7. Run Bunny review, address actionable findings, publish a draft PR, wait for clean checks, mark ready, and merge to `main`.
