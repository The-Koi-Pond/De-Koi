# Memory Recall Relevance Repair

## Problem

Memory Recall can report a sudden burst of memories after an ordinary group-chat
message. Two independent selection mistakes cause the burst:

1. A transcript chunk may be recalled even when its source message is already in
   the visible prompt history.
2. A canonical record is treated as relevant merely because it exists in the
   scoped memory index. Character scope narrows ownership, but does not establish
   relevance to the current message.

The UI is accurately showing what prompt assembly injected, so hiding the count
would conceal the bug instead of fixing it.

## Invariants

- A transcript memory whose source message overlaps selected visible prompt
  history must not be recalled.
- Transcript memories older than the selected visible-history window remain
  eligible for recall.
- Index membership and character ownership do not qualify an unpinned canonical
  memory.
- An unpinned canonical memory must have lexical overlap with the current query.
- Pinned canonical memories remain eligible without lexical overlap.
- Existing scope isolation, supersession, status, token-budget, and attribution
  behavior remain intact.

## Design

Prompt assembly will select visible history before starting its parallel context
lookups. The selected history will be passed to transcript recall, which will
combine those message IDs with the existing read-behind exclusion. Both the
storage query and the in-memory fallback filter will use the combined exclusion.

Canonical ranking will stop assigning a synthetic semantic-relevance score to
every index result. Until the index API supplies an actual query similarity,
index membership is retrieval provenance only. Candidate eligibility will
require lexical overlap or pinned status; scope, confidence, importance, and
recency will continue to rank eligible candidates.

## Proof

Focused regressions will cover:

- a prior assistant line present in selected visible history and in a transcript
  memory;
- an older transcript memory outside the selected history window;
- one relevant and several unrelated indexed memories owned by the answering
  character;
- pinned unrelated canonical memory behavior.

The implementation will then run the focused prompt tests, type checking,
architecture checks, the repository check lane, Bunny review, and live Pi
revision/health verification.
