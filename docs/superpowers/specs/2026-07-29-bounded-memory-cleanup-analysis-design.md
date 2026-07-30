# Bounded Memory Cleanup Analysis Design

## Problem

Harlequin has 94 active canonical memories. The current Tidy Memories preparation creates 12 value-review groups and 169 overlapping consolidation groups, producing an upper bound of 181 sequential model calls. Live Pi evidence showed the request advancing normally past 100 calls with no failures, but the modal exposed only an indefinite spinner.

The low-value scan is intentionally exhaustive. The consolidation lane is opportunistic and must not be allowed to multiply a bounded source set into an unbounded amount of provider work.

## Chosen design

Keep value review exhaustive while packing up to 32 records per request, subject to the existing 12,000-character prompt ceiling. Limit model-assisted consolidation to the first 12 deterministic candidate groups per analysis and report the remaining group count through the existing `deferredCandidateCount` field.

`analyzeMemoryCleanup` will expose a narrow progress callback containing completed and total model groups. The feature hook will own that transient progress state, reset it on cancellation or owner changes, and the modal will render `Analyzing memories… X of Y`.

For Harlequin's measured data, the new upper bound is three value-review calls plus twelve consolidation calls: 15 sequential calls instead of 181. Every eligible memory still reaches the low-value review lane.

## Alternatives rejected

1. Run all 181 calls with bounded concurrency. This reduces wall-clock time but preserves excessive provider usage, rate-limit pressure, and cost.
2. Send all memories and consolidation evidence in one prompt. This is fragile across provider context limits and makes structured-output failures more expensive.
3. Cap the complete analysis, including low-value review. This would violate the aggressive-cleanup requirement because later memories could never be judged for junk value.

## Ownership and data flow

- `src/engine/entities/memory-maintenance.ts` owns deterministic group packing, the consolidation budget, and deferred counts.
- `src/engine/generation/memory-cleanup.ts` owns sequential execution and progress events.
- `src/features/catalog/memory-maintenance/hooks/use-memory-cleanup.ts` owns transient React progress state.
- `src/features/catalog/memory-maintenance/components/MemoryCleanupReviewModal.tsx` renders progress and keeps the existing cancellation behavior.

No storage, shared API, provider transport, Rust, migration, or persistence contract changes are required.

## Cancellation and errors

Cancel or modal close aborts the active request and prevents subsequent groups from starting. Analysis remains read-only. Progress resets when analysis is cancelled, restarted, completed, or the memory owner changes. Existing provider and structured-response errors remain visible through the current error state.

## Proof

- A Harlequin-scale deterministic engine test must fail against the current 181-call preparation and pass with three exhaustive value groups, twelve consolidation groups, and a positive deferred count.
- A generation test must prove progress starts at zero, advances once per completed model group, and ends at the exact total.
- Hook and modal tests must prove progress is exposed, rendered, and reset on cancellation.
- Focused suites, typecheck, architecture checks, and the full shipping baseline must pass.

## Out of scope

- Parallel provider calls.
- Server-side job persistence or resume.
- Changing cleanup proposal semantics, selection defaults, storage apply, or undo.
- Claiming every provider will make identical subjective low-value judgments.
