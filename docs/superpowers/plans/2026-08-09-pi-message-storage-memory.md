# Pi Message Storage Memory Implementation Plan

> Approved by Celia on 2026-08-09 with: `fix, test, pr, merge to main, update pi`.

- [x] Add failing storage tests for record-local journal patches and dirty-cache append recovery.
- [x] Add a failing message/swipe persistence test for dirty-session externalization.
- [x] Implement the record-local checkpoint-journal patch capability.
- [x] Preserve dirty state while applying atomic appends to cached collections.
- [x] Route metadata-only message patches through the new capability and remove the embedded fallback.
- [x] Run focused Rust tests and architecture/Rust checks.
- [x] Run Bunny and the full De-Koi shipping gates.
- [ ] Publish a ready PR, wait for hosted CI and Bunny, then merge.
- [ ] Wait for matched ARM64 images and deploy the exact merge SHA to the Pi.
