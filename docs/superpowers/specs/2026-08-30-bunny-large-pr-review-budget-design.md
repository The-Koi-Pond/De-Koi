# Bunny Large-PR Review Budget Design

## Goal

Keep Bunny's maintainer-equivalent verdict useful on large pull requests while making its model-call budget fit inside the existing hosted workflow deadline.

## Problem

Bunny currently splits oversized review packets into bounded file chunks, then runs the complete three-pass review pipeline against every chunk. An eight-chunk pull request therefore needs at least twenty-four large model calls before any schema repair or context request. A single exhausted chunk failure discards all completed chunk results and fails the run. Raising the per-request timeout does not fix this multiplication and can instead let the workflow hit its twenty-five-minute hard deadline.

## Design

The non-chunked path keeps the existing broad, skeptical, and judge passes. Chunked reviews use a different bounded orchestration:

1. Each raw chunk receives one combined broad-and-skeptical review. The prompt retains the existing reviewer contract and explicitly requires both defect discovery and adversarial challenge in that pass.
2. Only the failed chunk is retried, once, after timeout, empty output, malformed JSON, or schema rejection. Already completed chunk results remain in memory and are never rerun.
3. After every chunk has a schema-valid result, one final PR-wide judge reviews compact chunk-result JSON plus PR metadata. The judge resolves duplicates and conflicts, applies the existing severity and verdict contract, and never receives the raw chunk packets again.

For eight chunks, the normal path falls from at least twenty-four large calls to nine calls: eight chunk reviews and one compact final judge. Existing schema repair or targeted context retrieval can still add calls when necessary, but they remain scoped to the affected chunk. The run still fails honestly if a chunk exhausts its bounded attempts or final judging fails.

## Review Semantics

The optimization changes orchestration, not the release bar:

- Every changed file remains present in exactly one raw review chunk.
- Each chunk pass must exercise both the broad maintainer lens and skeptical counter-review lens.
- The final judge owns the single PR-wide verdict and finding deduplication.
- `Ready` remains impossible when any blocking finding survives judging.
- Incomplete model coverage, malformed output, or exhausted retries remains a failed Bunny status rather than a partial success.
- The existing deterministic guidance, risk matrix, CI evidence, branch metadata, and reviewer skill remain inputs.

The final judge is grounded only in schema-valid chunk results. It cannot invent file locations absent from those results. Deterministic validation continues to reject invalid finding paths, lines, severities, and verdicts.

## Retry and Failure Contract

Chunk retry is application-owned and bounded to two total attempts. The retry receives the same chunk packet and does not restart the chunk loop. The OpenAI client transport retry remains unchanged. Final judging uses the existing model-call failure behavior and does not recursively restart chunk work.

No durable cross-run checkpoint is added in this slice. Workflow reruns still begin from the current pull-request head, which avoids stale review reuse and additional storage/authentication machinery.

## Telemetry

Emit one concise line for each chunk attempt and completion containing:

- chunk index and total;
- attempt and maximum attempts;
- raw packet character count;
- elapsed seconds;
- successful model-call count at that point;
- success or failure state and exception class.

Emit a final-judge start/completion line with compact input size and elapsed time. Logs must not include source text, prompts, secrets, or model output. Existing aggregate telemetry remains authoritative for total tokens, calls, packet characters, and elapsed time.

## Verification

Add deterministic orchestration tests using a fake model client. The tests must prove:

- eight chunks use nine successful calls on the normal path;
- a transient failure retries only its chunk and does not rerun completed chunks;
- an exhausted chunk failure prevents final judging and fails the run;
- the final judge receives compact chunk results rather than raw packets;
- non-chunked review still uses the existing three-pass path;
- per-chunk telemetry identifies progress without leaking packet content.

Run the focused Bunny guidance suite, a representative large-PR packet simulation, the repository's full `pnpm check`, a local Bunny pass over the tooling diff, and then hosted CI plus Bunny on the tooling pull request. After merge, rerun Bunny on the original large pull request to prove the production workflow completes on its exact head.
