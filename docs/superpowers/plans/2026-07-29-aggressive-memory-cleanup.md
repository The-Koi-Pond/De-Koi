# Aggressive Memory Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make De-Koi's review-first **Tidy memories** action surface substantially more valid multi-memory consolidations without rewriting standalone memories, dropping details, resolving conflicts, or weakening atomic apply and undo.

**Architecture:** Broaden deterministic candidate recall in the React-free engine entity layer, cover every retained candidate edge with bounded model-facing neighborhoods, and resolve overlapping model proposals deterministically in the generation layer. Keep the existing UI, shared runtime API, Rust storage apply/undo paths, and version 1 preview contract unchanged.

**Tech Stack:** TypeScript 5.9, Vitest 4, Zod structured generation, React 19 regression tests, Rust/Tauri storage regression checks, pnpm.

## Global Constraints

- Cleanup requires at least two active or pinned memories in one chat, scene, or character owner scope.
- Standalone rewriting and shortening remain out of scope.
- Preserve every supported fact, qualifier, time reference, relationship, promise, uncertainty marker, and attribution.
- Merely related memories remain separate.
- Contradictions produce unselected `conflict` proposals; cleanup never decides which claim is true.
- Candidate thresholds are exact equality, shared message provenance, two shared meaningful tokens plus containment `>= 0.35`, three shared meaningful tokens plus Jaccard `>= 0.30`, or existing embedding cosine similarity `>= 0.78`.
- Retain at most four strongest qualifying neighbors per source.
- Model-facing groups contain at most eight records and normally at most 12,000 characters; the seed edge's two endpoints are mandatory even when they exceed the character budget.
- Every retained candidate edge must appear in a group; there is no 20-group analysis ceiling.
- A completed version 1 preview returns `deferredCandidateCount: 0`.
- Analysis remains sequential, cancellable, and write-free.
- Exact duplicates outrank semantic suggestions; conflicts block overlapping actionable suggestions; final visible proposals are non-overlapping across all referenced IDs, including `winnerId`.
- No new Tauri command, HTTP route, storage collection, embedding request, dependency, or cross-owner query.
- Product rules remain in `src/engine`; no React, Zustand, Tauri, feature, or concrete shared API imports enter the engine.
- The authoritative design is `docs/superpowers/specs/2026-07-29-aggressive-memory-cleanup-design.md`.

---

## File map

- Modify `src/engine/entities/memory-maintenance.ts`: own candidate evidence, wider pair qualification, stable neighbor selection, and edge-covering bounded groups.
- Modify `src/engine/entities/memory-maintenance.spec.ts`: prove recall thresholds, negative controls, full edge coverage, oversize seed handling, removal of the 20-group ceiling, and determinism.
- Modify `src/engine/generation/memory-cleanup.ts`: own aggressive prompt wording, global exact-duplicate proposals, ranked model proposals, overlap resolution, and preview totals.
- Modify `src/engine/generation/memory-cleanup.spec.ts`: prove prompt behavior, sequential full analysis, conflict precedence, exact precedence, maximum reduction, and singleton rejection.
- Regression-only `src/features/catalog/memory-maintenance/hooks/use-memory-cleanup.spec.tsx`: prove owner invalidation, selected-only apply, and undo remain unchanged.
- Regression-only `src/features/catalog/memory-maintenance/components/MemoryCleanupReviewModal.spec.tsx`: prove review-before-write, no-op copy, apply gating, and undo remain unchanged.
- Regression-only `src-tauri/src/commands/storage/memory_maintenance/chat.rs`: prove chat apply/undo and eligibility remain unchanged.
- Regression-only `src-tauri/src/commands/storage/memory_maintenance/canonical.rs`: prove canonical apply/undo and eligibility remain unchanged.

No contract, UI, shared API, or Rust production file should change unless a failing test demonstrates that the approved behavior cannot be implemented within these owners.

---

### Task 1: Broaden deterministic pair recall

**Files:**

- Modify: `src/engine/entities/memory-maintenance.spec.ts`
- Modify: `src/engine/entities/memory-maintenance.ts`

**Interfaces:**

- Produces:

```ts
export type MemoryCleanupEvidenceKind = "exact" | "provenance" | "embedding" | "containment" | "jaccard";

export interface MemoryCleanupCandidateEvidence {
  kind: MemoryCleanupEvidenceKind;
  similarity: number;
  sharedTokenCount: number;
  pair: [string, string];
}

export function compareMemoryCleanupEvidence(
  left: MemoryCleanupCandidateEvidence,
  right: MemoryCleanupCandidateEvidence,
): number;
```

- Preserves:

```ts
export function prepareMemoryCleanupCandidates(sources: MemoryCleanupSource[]): PreparedMemoryCleanupCandidates;
export function isMemoryCleanupEligible(source: MemoryCleanupSource): boolean;
export function validateCleanupProposal(
  proposal: MemoryCleanupProposal,
  sourcesById: ReadonlyMap<string, MemoryCleanupSource>,
): MemoryCleanupProposal;
```

- [ ] **Step 1: Add focused failing tests for containment, embeddings, and negative controls**

Add this helper near the existing `source()` helper:

```ts
function containsEverySource(group: { sourceIds: string[] }, ids: string[]): boolean {
  return ids.every((id) => group.sourceIds.includes(id));
}
```

Replace exact-array assumptions in the existing grouping test with
`prepared.groups.some((group) => containsEverySource(group, ids))`, because
the wider graph may place related pairs in one larger neighborhood.

Add:

```ts
it("finds a short fact inside a longer elaboration with two shared meaningful tokens", () => {
  const prepared = prepareMemoryCleanupCandidates([
    source({ id: "short", content: "The brass key remains." }),
    source({
      id: "elaboration",
      content: "Mira hid the old brass key beneath the loose floorboard yesterday.",
    }),
  ]);

  expect(prepared.groups.some((group) => containsEverySource(group, ["short", "elaboration"]))).toBe(true);
});

it("accepts useful 0.80 embedding similarity without grouping unrelated vectors", () => {
  const prepared = prepareMemoryCleanupCandidates([
    source({ id: "near-a", content: "North window.", embedding: [1, 0] }),
    source({ id: "near-b", content: "Unrelated wording.", embedding: [0.8, 0.6] }),
    source({ id: "far", content: "Different wording.", embedding: [0, 1] }),
  ]);

  expect(prepared.groups.some((group) => containsEverySource(group, ["near-a", "near-b"]))).toBe(true);
  expect(prepared.groups.some((group) => containsEverySource(group, ["near-a", "far"]))).toBe(false);
});

it("keeps same-subject memories separate when no qualifying signal exists", () => {
  const prepared = prepareMemoryCleanupCandidates([
    source({ id: "harbor", content: "Mira visited the harbor at dawn." }),
    source({ id: "ferry", content: "Mira promised to board the evening ferry." }),
  ]);

  expect(prepared.groups).toEqual([]);
});
```

- [ ] **Step 2: Run the entity tests and verify the new recall cases fail**

Run:

```powershell
pnpm vitest run src/engine/entities/memory-maintenance.spec.ts
```

Expected: the containment and `0.80` embedding cases fail because the current
gates require three shared tokens with `0.60` Jaccard or `0.88` cosine
similarity. The same-subject negative control remains green.

- [ ] **Step 3: Replace boolean pair matching with typed deterministic evidence**

In `memory-maintenance.ts`, retain `MEMORY_CLEANUP_MAX_GROUPS` until Task 2
removes the old grouping ceiling. Remove `LEXICAL_SIMILARITY_THRESHOLD`,
`EMBEDDING_SIMILARITY_THRESHOLD`,
`MIN_SHARED_LEXICAL_TOKENS`, `lexicalSimilarity()`,
and `embeddingSimilarity()`. Replace `shouldGroup()` later in this step.

Add the public types from the Interfaces block and these constants:

```ts
const MEMORY_CLEANUP_MAX_GROUP_RECORDS = 8;
const MEMORY_CLEANUP_MAX_GROUP_CHARS = 12_000;
const MEMORY_CLEANUP_MAX_NEIGHBORS = 4;
const CONTAINMENT_THRESHOLD = 0.35;
const JACCARD_THRESHOLD = 0.3;
const EMBEDDING_THRESHOLD = 0.78;
const MIN_CONTAINMENT_SHARED_TOKENS = 2;
const MIN_JACCARD_SHARED_TOKENS = 3;

const EVIDENCE_PRIORITY: Record<MemoryCleanupEvidenceKind, number> = {
  exact: 5,
  provenance: 4,
  embedding: 3,
  containment: 2,
  jaccard: 1,
};
```

Add:

```ts
function orderedPair(leftId: string, rightId: string): [string, string] {
  return leftId.localeCompare(rightId) <= 0 ? [leftId, rightId] : [rightId, leftId];
}

function lexicalMetrics(left: MemoryCleanupSource, right: MemoryCleanupSource) {
  const leftTokens = meaningfulTokens(left.content);
  const rightTokens = meaningfulTokens(right.content);
  const sharedTokenCount = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  const smaller = Math.min(leftTokens.size, rightTokens.size);
  const union = new Set([...leftTokens, ...rightTokens]).size;
  return {
    sharedTokenCount,
    containment: smaller > 0 ? sharedTokenCount / smaller : 0,
    jaccard: union > 0 ? sharedTokenCount / union : 0,
  };
}

function candidateEvidence(
  left: MemoryCleanupSource,
  right: MemoryCleanupSource,
): MemoryCleanupCandidateEvidence | null {
  if (scopeKey(left.scope) !== scopeKey(right.scope)) return null;
  const pair = orderedPair(left.id, right.id);
  const lexical = lexicalMetrics(left, right);
  if (normalizedContent(left.content) === normalizedContent(right.content)) {
    return { kind: "exact", similarity: 1, sharedTokenCount: lexical.sharedTokenCount, pair };
  }
  if (hasSharedMessageId(left, right)) {
    return { kind: "provenance", similarity: 1, sharedTokenCount: lexical.sharedTokenCount, pair };
  }
  if (left.embedding && right.embedding) {
    const similarity = cosineSimilarity(left.embedding, right.embedding);
    if (similarity !== null && similarity >= EMBEDDING_THRESHOLD) {
      return { kind: "embedding", similarity, sharedTokenCount: lexical.sharedTokenCount, pair };
    }
  }
  if (lexical.sharedTokenCount >= MIN_CONTAINMENT_SHARED_TOKENS && lexical.containment >= CONTAINMENT_THRESHOLD) {
    return {
      kind: "containment",
      similarity: lexical.containment,
      sharedTokenCount: lexical.sharedTokenCount,
      pair,
    };
  }
  if (lexical.sharedTokenCount >= MIN_JACCARD_SHARED_TOKENS && lexical.jaccard >= JACCARD_THRESHOLD) {
    return {
      kind: "jaccard",
      similarity: lexical.jaccard,
      sharedTokenCount: lexical.sharedTokenCount,
      pair,
    };
  }
  return null;
}

export function compareMemoryCleanupEvidence(
  left: MemoryCleanupCandidateEvidence,
  right: MemoryCleanupCandidateEvidence,
): number {
  const priority = EVIDENCE_PRIORITY[right.kind] - EVIDENCE_PRIORITY[left.kind];
  if (priority !== 0) return priority;
  const similarity = right.similarity - left.similarity;
  if (similarity !== 0) return similarity;
  const shared = right.sharedTokenCount - left.sharedTokenCount;
  if (shared !== 0) return shared;
  return left.pair.join("\u0000").localeCompare(right.pair.join("\u0000"));
}
```

For this task, retain the existing connected-component grouping and
`MemoryCleanupCandidateGroup` shape. Replace `shouldGroup()` with this exact
wrapper:

```ts
function shouldGroup(left: MemoryCleanupSource, right: MemoryCleanupSource): boolean {
  return candidateEvidence(left, right) !== null;
}
```

Task 2 adds evidence to groups and removes the ceiling as one coherent slice.

- [ ] **Step 4: Run the focused tests and typecheck**

Run:

```powershell
pnpm vitest run src/engine/entities/memory-maintenance.spec.ts
pnpm typecheck
```

Expected: both commands pass. Existing inactive, cross-scope, singleton, and
proposal-validation tests remain green.

- [ ] **Step 5: Commit the pair-recall slice**

```powershell
git add src/engine/entities/memory-maintenance.ts src/engine/entities/memory-maintenance.spec.ts
git commit -m "memory: broaden cleanup candidate recall"
```

---

### Task 2: Cover every retained candidate edge with bounded groups

**Files:**

- Modify: `src/engine/entities/memory-maintenance.spec.ts`
- Modify: `src/engine/entities/memory-maintenance.ts`

**Interfaces:**

- Consumes: `MemoryCleanupCandidateEvidence`,
  `compareMemoryCleanupEvidence(left, right)` from Task 1.
- Produces:

```ts
export interface MemoryCleanupCandidateGroup {
  id: string;
  sourceIds: string[];
  evidence: MemoryCleanupCandidateEvidence;
}
```

It also produces the existing
`prepareMemoryCleanupCandidates(sources)` result with all groups,
deterministic ordering, and `deferredCandidateCount: 0`.

- [ ] **Step 1: Replace the old cap test and add edge-coverage, oversize, and determinism tests**

Replace `"caps model-facing groups and reports deferred candidates"` with:

```ts
it("returns more than twenty independent candidate groups without deferring any", () => {
  const prepared = prepareMemoryCleanupCandidates(
    Array.from({ length: 22 }, (_, index) => [
      source({ id: `pair-${index}-a`, content: `unique-${index}` }),
      source({ id: `pair-${index}-b`, content: `unique-${index}` }),
    ]).flat(),
  );

  expect(prepared.groups).toHaveLength(22);
  expect(prepared.deferredCandidateCount).toBe(0);
});
```

Add:

```ts
it("covers every edge in a component larger than one model group", () => {
  const chain = Array.from({ length: 12 }, (_, index) =>
    source({
      id: `chain-${index.toString().padStart(2, "0")}`,
      content: `Distinct memory ${index}.`,
      messageIds: [`edge-${index - 1}`, `edge-${index}`],
    }),
  );
  const prepared = prepareMemoryCleanupCandidates(chain);

  expect(prepared.groups.every((group) => group.sourceIds.length <= 8)).toBe(true);
  for (let index = 0; index < chain.length - 1; index += 1) {
    expect(
      prepared.groups.some((group) =>
        containsEverySource(group, [
          `chain-${index.toString().padStart(2, "0")}`,
          `chain-${(index + 1).toString().padStart(2, "0")}`,
        ]),
      ),
    ).toBe(true);
  }
  expect(prepared.deferredCandidateCount).toBe(0);
});

it("keeps an oversized qualifying seed pair instead of dropping it", () => {
  const prepared = prepareMemoryCleanupCandidates([
    source({ id: "large-a", content: "a".repeat(7_000), messageIds: ["shared"] }),
    source({ id: "large-b", content: "b".repeat(7_000), messageIds: ["shared"] }),
    source({ id: "extra", content: "c".repeat(2_000), messageIds: ["shared"] }),
  ]);

  expect(prepared.groups.some((group) => containsEverySource(group, ["large-a", "large-b"]))).toBe(true);
  expect(prepared.groups.find((group) => containsEverySource(group, ["large-a", "large-b"]))?.sourceIds).toHaveLength(
    2,
  );
});

it("builds the same groups regardless of source input order", () => {
  const sources = [
    source({ id: "a", content: "Mira keeps the brass key." }),
    source({ id: "b", content: "The brass key remains with Mira." }),
    source({ id: "c", content: "Mira stores the brass key in her coat." }),
  ];

  expect(prepareMemoryCleanupCandidates(sources).groups).toEqual(
    prepareMemoryCleanupCandidates([...sources].reverse()).groups,
  );
});
```

Update the existing oversized-exact-duplicate assertion to tolerate the new
diagnostic evidence field:

```ts
expect(prepared.groups).toEqual([
  expect.objectContaining({
    id: "cleanup-group-1",
    sourceIds: ["oversized-a", "oversized-b"],
  }),
]);
```

- [ ] **Step 2: Run the entity tests and verify the old grouping fails**

Run:

```powershell
pnpm vitest run src/engine/entities/memory-maintenance.spec.ts
```

Expected: the 22-group, full-chain coverage, and deterministic-order tests fail
against connected-component truncation and the 20-group ceiling.

- [ ] **Step 3: Implement top-neighbor retention and edge-covering neighborhoods**

Replace `boundedGroup()`, `exactDuplicateGroup()`, and
`buildBoundedCandidateGroups()` with the code below. Delete
`MEMORY_CLEANUP_MAX_GROUPS`, and replace the private candidate-group interface
with the exported interface from this task's Interfaces block.

```ts
interface MemoryCleanupCandidateEdge {
  key: string;
  leftId: string;
  rightId: string;
  evidence: MemoryCleanupCandidateEvidence;
}

function edgeKey(leftId: string, rightId: string): string {
  return orderedPair(leftId, rightId).join("\u0000");
}

function compareCandidateEdges(left: MemoryCleanupCandidateEdge, right: MemoryCleanupCandidateEdge): number {
  return compareMemoryCleanupEvidence(left.evidence, right.evidence) || left.key.localeCompare(right.key);
}

function allCandidateEdges(eligible: MemoryCleanupSource[]): MemoryCleanupCandidateEdge[] {
  const ordered = [...eligible].sort((left, right) => left.id.localeCompare(right.id));
  const edges: MemoryCleanupCandidateEdge[] = [];
  for (let leftIndex = 0; leftIndex < ordered.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < ordered.length; rightIndex += 1) {
      const left = ordered[leftIndex];
      const right = ordered[rightIndex];
      if (!left || !right) continue;
      const evidence = candidateEvidence(left, right);
      if (!evidence) continue;
      edges.push({
        key: edgeKey(left.id, right.id),
        leftId: left.id,
        rightId: right.id,
        evidence,
      });
    }
  }
  return edges.sort(compareCandidateEdges);
}

function retainStrongestNeighbors(edges: MemoryCleanupCandidateEdge[]): MemoryCleanupCandidateEdge[] {
  const bySource = new Map<string, MemoryCleanupCandidateEdge[]>();
  for (const edge of edges) {
    for (const id of [edge.leftId, edge.rightId]) {
      const current = bySource.get(id) ?? [];
      current.push(edge);
      bySource.set(id, current);
    }
  }
  const retainedKeys = new Set<string>();
  for (const sourceEdges of bySource.values()) {
    for (const edge of sourceEdges.sort(compareCandidateEdges).slice(0, MEMORY_CLEANUP_MAX_NEIGHBORS)) {
      retainedKeys.add(edge.key);
    }
  }
  return edges.filter((edge) => retainedKeys.has(edge.key)).sort(compareCandidateEdges);
}

function buildEdgeCoveringGroups(
  eligible: MemoryCleanupSource[],
  retainedEdges: MemoryCleanupCandidateEdge[],
): MemoryCleanupCandidateGroup[] {
  const sourcesById = new Map(eligible.map((source) => [source.id, source]));
  const uncovered = new Map(retainedEdges.map((edge) => [edge.key, edge]));
  const groups: MemoryCleanupCandidateGroup[] = [];

  while (uncovered.size > 0) {
    const seed = [...uncovered.values()].sort(compareCandidateEdges)[0];
    if (!seed) break;
    const selected = new Set([seed.leftId, seed.rightId]);
    let characters =
      (sourcesById.get(seed.leftId)?.content.length ?? 0) + (sourcesById.get(seed.rightId)?.content.length ?? 0);

    while (selected.size < MEMORY_CLEANUP_MAX_GROUP_RECORDS) {
      const next = retainedEdges
        .filter(
          (edge) =>
            (selected.has(edge.leftId) && !selected.has(edge.rightId)) ||
            (selected.has(edge.rightId) && !selected.has(edge.leftId)),
        )
        .sort(compareCandidateEdges)
        .map((edge) => (selected.has(edge.leftId) ? edge.rightId : edge.leftId))
        .find((id) => {
          const source = sourcesById.get(id);
          return source && characters + source.content.length <= MEMORY_CLEANUP_MAX_GROUP_CHARS;
        });
      if (!next) break;
      selected.add(next);
      characters += sourcesById.get(next)?.content.length ?? 0;
    }

    const sourceIds = [...selected].sort();
    groups.push({
      id: `cleanup-group-${groups.length + 1}`,
      sourceIds,
      evidence: seed.evidence,
    });
    for (const edge of retainedEdges) {
      if (selected.has(edge.leftId) && selected.has(edge.rightId)) uncovered.delete(edge.key);
    }
  }

  return groups;
}

function buildBoundedCandidateGroups(eligible: MemoryCleanupSource[]): MemoryCleanupCandidateGroup[] {
  return buildEdgeCoveringGroups(eligible, retainStrongestNeighbors(allCandidateEdges(eligible)));
}
```

Update `prepareMemoryCleanupCandidates()`:

```ts
export function prepareMemoryCleanupCandidates(sources: MemoryCleanupSource[]): PreparedMemoryCleanupCandidates {
  const eligible = sources.filter(isMemoryCleanupEligible);
  return {
    eligible,
    groups: buildBoundedCandidateGroups(eligible),
    deferredCandidateCount: 0,
  };
}
```

Ensure the oversize seed rule is implemented exactly as shown: the character
budget is checked only when adding neighbors, never when admitting the two seed
endpoints.

- [ ] **Step 4: Run focused tests, typecheck, and architecture checks**

Run:

```powershell
pnpm vitest run src/engine/entities/memory-maintenance.spec.ts
pnpm typecheck
pnpm check:architecture
```

Expected: all pass; the architecture check confirms the engine owner remains
React- and runtime-independent.

- [ ] **Step 5: Commit complete candidate coverage**

```powershell
git add src/engine/entities/memory-maintenance.ts src/engine/entities/memory-maintenance.spec.ts
git commit -m "memory: analyze every cleanup candidate group"
```

---

### Task 3: Make model review actively seek lossless consolidation

**Files:**

- Modify: `src/engine/generation/memory-cleanup.spec.ts`
- Modify: `src/engine/generation/memory-cleanup.ts`

**Interfaces:**

- Consumes: `prepareMemoryCleanupCandidates()` groups and their `evidence`
  from Tasks 1 and 2.
- Preserves:

```ts
export async function analyzeMemoryCleanup(input: {
  scope: MemoryCleanupScope;
  sources: MemoryCleanupSource[];
  connectionId: string;
  llm: LlmGateway;
  signal?: AbortSignal;
}): Promise<MemoryCleanupPreview>;
```

- [ ] **Step 1: Add failing prompt and full-analysis tests**

In the first generation test, add:

```ts
expect(systemPrompt).toContain("Compare every supplied source");
expect(systemPrompt).toContain("different wording");
expect(systemPrompt).toContain("Preserve distinct events");
expect(systemPrompt).toContain("return no proposal");
```

Add:

```ts
it("analyzes more than twenty candidate groups sequentially without deferral", async () => {
  const requests: LlmRequest[] = [];
  let active = 0;
  let maxActive = 0;
  const llm = gateway(async (request) => {
    requests.push(request);
    active += 1;
    maxActive = Math.max(maxActive, active);
    await Promise.resolve();
    active -= 1;
    return JSON.stringify({ proposals: [] });
  });
  const sources = Array.from({ length: 22 }, (_, index) => [
    source({
      id: `pair-${index}-a`,
      content: `Alpha${index}.`,
      messageIds: [`pair-message-${index}`],
    }),
    source({
      id: `pair-${index}-b`,
      content: `Beta${index}.`,
      messageIds: [`pair-message-${index}`],
    }),
  ]).flat();

  const preview = await analyzeMemoryCleanup({
    scope: { kind: "character", id: "mira" },
    sources,
    connectionId: "connection-1",
    llm,
  });

  expect(requests).toHaveLength(22);
  expect(maxActive).toBe(1);
  expect(preview.deferredCandidateCount).toBe(0);
  expect(preview.proposals).toEqual([]);
});
```

- [ ] **Step 2: Run the generation tests and verify the prompt assertions fail**

Run:

```powershell
pnpm vitest run src/engine/generation/memory-cleanup.spec.ts
```

Expected: the new prompt phrases fail. The 22-group test passes only after Task
2 removed the cap, proving this task is operating on the intended candidate
pipeline.

- [ ] **Step 3: Strengthen the cleanup system prompt without relaxing validation**

Keep the current security, JSON shape, allowed reasons, pinned winner, and
conflict rules. Insert these exact lines after the lossless-consolidation rule:

```ts
"Compare every supplied source, even when compatible memories use different wording.",
"Actively propose consolidation when fewer records can carry the same supported meaning.",
"Preserve distinct events, qualifiers, chronology, uncertainty, relationships, promises, and attribution.",
"A replacement may be longer than any individual source when that is needed to preserve details.",
"If memories are merely about the same subject, return no proposal for them.",
```

Retain:

```ts
"Length alone is never a cleanup reason.",
"Return conflicts as conflict proposals and never decide which side is true.",
```

Do not add new proposal types, change `maxTokens`, weaken
`normalizeModelProposal()`, or change structured-output repair.

- [ ] **Step 4: Run focused generation and entity tests**

Run:

```powershell
pnpm vitest run src/engine/generation/memory-cleanup.spec.ts src/engine/entities/memory-maintenance.spec.ts
pnpm typecheck
```

Expected: all pass.

- [ ] **Step 5: Commit the model-review behavior**

```powershell
git add src/engine/generation/memory-cleanup.ts src/engine/generation/memory-cleanup.spec.ts
git commit -m "memory: seek lossless cleanup consolidation"
```

---

### Task 4: Resolve duplicate and overlapping proposals deterministically

**Files:**

- Modify: `src/engine/generation/memory-cleanup.spec.ts`
- Modify: `src/engine/generation/memory-cleanup.ts`

**Interfaces:**

- Consumes:

```ts
MemoryCleanupCandidateGroup["evidence"];
compareMemoryCleanupEvidence(left, right);
```

- Produces no new public runtime contract. Internal generation type:

```ts
interface RankedCleanupProposal {
  proposal: MemoryCleanupProposal;
  evidence?: MemoryCleanupCandidateEvidence;
  groupId: string;
  exact: boolean;
}
```

- [ ] **Step 1: Change the overlap expectation and add exact- and reduction-precedence tests**

Change `"rejects conflict and actionable proposals that overlap the same
sources"` to expect one visible conflict:

```ts
const preview = await analyzeMemoryCleanup(/* existing fixture */);
expect(preview.proposals).toEqual([
  expect.objectContaining({
    type: "conflict",
    sourceIds: ["alive", "dead"],
    selected: false,
  }),
]);
```

Add:

```ts
it("keeps a global exact-duplicate proposal ahead of an overlapping semantic proposal", async () => {
  const llm = gateway(async () =>
    JSON.stringify({
      proposals: [
        {
          type: "combine",
          sourceIds: ["duplicate-a", "related"],
          replacement: { content: "Mira keeps the brass key in her coat.", kind: "fact" },
          reason: "Overlapping memories",
        },
      ],
    }),
  );
  const preview = await analyzeMemoryCleanup({
    scope: { kind: "character", id: "mira" },
    sources: [
      source({ id: "duplicate-a", content: "Mira keeps the brass key.", confidence: 0.7 }),
      source({ id: "duplicate-b", content: "Mira keeps the brass key.", confidence: 0.9 }),
      source({ id: "related", content: "Mira stores the brass key in her coat." }),
    ],
    connectionId: "connection-1",
    llm,
  });

  expect(preview.proposals).toEqual([
    expect.objectContaining({
      type: "keep_one",
      sourceIds: expect.arrayContaining(["duplicate-a"]),
      winnerId: "duplicate-b",
    }),
  ]);
});

it("keeps the non-overlapping actionable set with the greatest memory-count reduction", async () => {
  const llm = gateway(async () =>
    JSON.stringify({
      proposals: [
        {
          type: "combine",
          sourceIds: ["memory-a", "memory-b"],
          replacement: { content: "Two-source replacement.", kind: "fact" },
          reason: "Overlapping memories",
        },
        {
          type: "combine",
          sourceIds: ["memory-a", "memory-b", "memory-c"],
          replacement: { content: "Three-source replacement preserving every detail.", kind: "fact" },
          reason: "Overlapping memories",
        },
      ],
    }),
  );
  const preview = await analyzeMemoryCleanup({
    scope: { kind: "character", id: "mira" },
    sources: [
      source({ id: "memory-a", content: "Mira keeps the brass key." }),
      source({ id: "memory-b", content: "The brass key remains with Mira." }),
      source({ id: "memory-c", content: "Mira stores the brass key in her coat." }),
    ],
    connectionId: "connection-1",
    llm,
  });

  expect(preview.proposals).toEqual([
    expect.objectContaining({
      type: "combine",
      sourceIds: ["memory-a", "memory-b", "memory-c"],
    }),
  ]);
  expect(preview.afterCount).toBe(1);
});

it("coalesces duplicate model proposals for the same referenced source set", async () => {
  const llm = gateway(async () =>
    JSON.stringify({
      proposals: [
        {
          type: "combine",
          sourceIds: ["memory-a", "memory-b"],
          replacement: { content: "First valid replacement.", kind: "fact" },
          reason: "Overlapping memories",
        },
        {
          type: "combine",
          sourceIds: ["memory-b", "memory-a"],
          replacement: { content: "Second valid replacement.", kind: "fact" },
          reason: "Overlapping memories",
        },
      ],
    }),
  );
  const preview = await analyzeMemoryCleanup({
    scope: { kind: "character", id: "mira" },
    sources: [
      source({ id: "memory-a", content: "Mira keeps the brass key." }),
      source({ id: "memory-b", content: "The brass key remains with Mira." }),
    ],
    connectionId: "connection-1",
    llm,
  });

  expect(preview.proposals).toHaveLength(1);
  expect(preview.proposals[0]).toEqual(
    expect.objectContaining({
      type: "combine",
      sourceIds: expect.arrayContaining(["memory-a", "memory-b"]),
    }),
  );
});
```

- [ ] **Step 2: Run the generation tests and verify overlap cases fail**

Run:

```powershell
pnpm vitest run src/engine/generation/memory-cleanup.spec.ts
```

Expected: the conflict fixture still throws `"more than once"`; global exact
duplicates inside a mixed group are not guaranteed to win; competing
actionable proposals still violate the overlap assertion.

- [ ] **Step 3: Collect global exact duplicates before model proposal resolution**

Import the candidate evidence types and comparator:

```ts
import {
  compareMemoryCleanupEvidence,
  isMemoryCleanupEligible,
  memoryCleanupExpectedState,
  prepareMemoryCleanupCandidates,
  validateCleanupProposal,
  type MemoryCleanupCandidateEvidence,
} from "../entities/memory-maintenance";
```

Replace `deterministicDuplicateProposal(groupSources, sourcesById)` with a
global collector:

```ts
function deterministicDuplicateProposals(
  sources: MemoryCleanupSource[],
  sourcesById: ReadonlyMap<string, MemoryCleanupSource>,
): RankedCleanupProposal[] {
  const byContent = new Map<string, MemoryCleanupSource[]>();
  for (const source of sources.filter(isMemoryCleanupEligible)) {
    const key = normalizedContent(source.content);
    byContent.set(key, [...(byContent.get(key) ?? []), source]);
  }
  return [...byContent.values()]
    .filter((group) => group.length >= 2)
    .map((group) => {
      const ordered = [...group].sort((left, right) => left.id.localeCompare(right.id));
      const winner = chooseExactDuplicateWinner(ordered);
      const sourceIds = ordered.filter((source) => source.id !== winner.id).map((source) => source.id);
      const proposal = validateCleanupProposal(
        {
          id: `cleanup-exact-${stableHash(ordered.map((source) => source.id).join(":"))}`,
          type: "keep_one",
          sourceIds,
          expected: expectedStates(sourceIds, winner.id, sourcesById),
          winnerId: winner.id,
          reason: "Repeated fact",
          selected: true,
          estimatedTokensBefore: ordered.reduce((total, source) => total + estimateTokens(source.content), 0),
          estimatedTokensAfter: estimateTokens(winner.content),
        },
        sourcesById,
      );
      return { proposal, groupId: `exact:${stableHash(normalizedContent(winner.content))}`, exact: true };
    });
}
```

This intentionally consolidates every exact duplicate in one proposal,
including sets larger than one model-facing group.

- [ ] **Step 4: Add ranked proposal coalescing and overlap resolution**

Add:

```ts
interface RankedCleanupProposal {
  proposal: MemoryCleanupProposal;
  evidence?: MemoryCleanupCandidateEvidence;
  groupId: string;
  exact: boolean;
}

function referencedIds(proposal: MemoryCleanupProposal): string[] {
  return [...new Set([...proposal.sourceIds, ...(proposal.winnerId ? [proposal.winnerId] : [])])].sort();
}

function reduction(proposal: MemoryCleanupProposal): number {
  if (proposal.type === "conflict") return 0;
  return proposal.sourceIds.length - (proposal.type === "combine" ? 1 : 0);
}

function compareRankedProposals(left: RankedCleanupProposal, right: RankedCleanupProposal): number {
  if (left.exact !== right.exact) return left.exact ? -1 : 1;
  const countReduction = reduction(right.proposal) - reduction(left.proposal);
  if (countReduction !== 0) return countReduction;
  if (left.evidence && right.evidence) {
    const evidence = compareMemoryCleanupEvidence(left.evidence, right.evidence);
    if (evidence !== 0) return evidence;
  } else if (left.evidence || right.evidence) {
    return left.evidence ? -1 : 1;
  }
  const sourceCount = referencedIds(right.proposal).length - referencedIds(left.proposal).length;
  if (sourceCount !== 0) return sourceCount;
  return left.groupId.localeCompare(right.groupId) || left.proposal.id.localeCompare(right.proposal.id);
}

function coalesceRankedProposals(proposals: RankedCleanupProposal[]): RankedCleanupProposal[] {
  const byShape = new Map<string, RankedCleanupProposal>();
  for (const candidate of [...proposals].sort(compareRankedProposals)) {
    const key = `${candidate.proposal.type}:${referencedIds(candidate.proposal).join("\u0000")}`;
    if (!byShape.has(key)) byShape.set(key, candidate);
  }
  return [...byShape.values()];
}

function resolveCleanupProposals(proposals: RankedCleanupProposal[]): MemoryCleanupProposal[] {
  const coalesced = coalesceRankedProposals(proposals);
  const accepted: RankedCleanupProposal[] = [];
  const claimed = new Set<string>();
  const acceptAvailable = (candidate: RankedCleanupProposal) => {
    const ids = referencedIds(candidate.proposal);
    if (ids.some((id) => claimed.has(id))) return;
    accepted.push(candidate);
    ids.forEach((id) => claimed.add(id));
  };

  coalesced
    .filter((candidate) => candidate.exact)
    .sort(compareRankedProposals)
    .forEach(acceptAvailable);
  coalesced
    .filter((candidate) => !candidate.exact && candidate.proposal.type === "conflict")
    .sort(compareRankedProposals)
    .forEach(acceptAvailable);
  coalesced
    .filter((candidate) => !candidate.exact && candidate.proposal.type !== "conflict")
    .sort(compareRankedProposals)
    .forEach(acceptAvailable);

  return accepted.map((candidate) => candidate.proposal);
}
```

In `analyzeMemoryCleanup()`:

1. Initialize `rankedProposals` from
   `deterministicDuplicateProposals(scopedSources, sourcesById)`.
2. Delete the old per-group `deterministicDuplicateProposal()` block. Build an
   `exactClaimedIds` set from every global exact proposal's referenced IDs.
   Skip a group only when all of its IDs are in `exactClaimedIds`, preserving
   the existing no-model-call behavior for exact-only cleanup. Do not skip a
   mixed semantic group merely because some IDs are exact duplicates; the
   global exact proposal must beat that overlap during resolution.
3. Wrap every valid normalized model proposal with the current group's
   `evidence`, `group.id`, and `exact: false`.
4. Replace `assertNoOverlappingProposals()` with
   `const proposals = resolveCleanupProposals(rankedProposals)`.
5. Calculate totals only from the resolved proposals.

Delete `assertNoOverlappingProposals()`.

- [ ] **Step 5: Run all memory cleanup TypeScript tests**

Run:

```powershell
pnpm vitest run src/engine/entities/memory-maintenance.spec.ts src/engine/generation/memory-cleanup.spec.ts src/features/catalog/memory-maintenance/hooks/use-memory-cleanup.spec.tsx src/features/catalog/memory-maintenance/components/MemoryCleanupReviewModal.spec.tsx
pnpm typecheck
pnpm check:architecture
```

Expected: all pass. The public preview contains only non-overlapping proposals,
conflicts are unselected, and review/apply UI behavior is unchanged.

- [ ] **Step 6: Commit deterministic proposal resolution**

```powershell
git add src/engine/generation/memory-cleanup.ts src/engine/generation/memory-cleanup.spec.ts
git commit -m "memory: resolve cleanup proposals deterministically"
```

---

### Task 5: Run cross-boundary regression and release-quality validation

**Files:**

- Verify only: all files listed in the File map.
- Modify only if a check exposes an in-scope defect; return to the task that
  owns that defect and repeat its red-green cycle.

**Interfaces:**

- Consumes the completed engine and generation behavior from Tasks 1-4.
- Produces verification evidence; no new API.

- [ ] **Step 1: Run focused frontend and engine regression tests**

```powershell
pnpm vitest run src/engine/entities/memory-maintenance.spec.ts src/engine/generation/memory-cleanup.spec.ts src/features/catalog/memory-maintenance/hooks/use-memory-cleanup.spec.tsx src/features/catalog/memory-maintenance/components/MemoryCleanupReviewModal.spec.tsx
```

Expected: all tests pass with zero failures.

- [ ] **Step 2: Prove unchanged Rust eligibility and atomic apply/undo**

```powershell
cargo test --manifest-path src-tauri/Cargo.toml -p de-koi cleanup_eligibility_accepts_all_active_origins_and_rejects_inactive_or_foreign_rows
cargo test --manifest-path src-tauri/Cargo.toml -p de-koi chat_cleanup_combines_eligible_rows_and_undo_restores_them
cargo test --manifest-path src-tauri/Cargo.toml -p de-koi character_cleanup_updates_canonical_rows_and_indexes_and_can_undo
```

Expected: the first filter passes both chat and canonical eligibility tests;
the other two commands each pass their focused apply/undo test.

- [ ] **Step 3: Run matching repository checks**

```powershell
pnpm typecheck
pnpm check:architecture
pnpm check:docs
pnpm build
cargo check --manifest-path src-tauri/Cargo.toml --workspace
```

Expected: every command exits `0`.

- [ ] **Step 4: Inspect the final branch boundary**

```powershell
git status --short --branch
git log --oneline origin/main..HEAD
git diff --stat origin/main...HEAD
git diff --check origin/main...HEAD
```

Expected:

- only the approved design, this plan, and the four TypeScript implementation/test files differ from `origin/main`;
- no shared API, UI production, Rust production, dependency, lockfile, or generated artifact change;
- no whitespace errors;
- worktree status is clean.

- [ ] **Step 5: Record the manual proof boundary**

If a configured cleanup connection and a disposable mixed-memory owner scope
are available, manually run **Tidy memories** with exact duplicates, a
short-fact/elaboration pair, differently worded compatible memories, distinct
same-topic events, a contradiction, and more than 20 neighborhoods. Confirm
the broader preview, preserved details, unresolved conflict, apply, and undo.

If that runtime fixture is unavailable, record exactly:

```text
Manual gap: no disposable live owner scope and configured cleanup connection were available. Mocked public-path tests prove candidate coverage, sequential model calls, proposal resolution, review gating, and unchanged storage regression tests; a real provider's consolidation judgment remains unverified.
```

- [ ] **Step 6: Commit the plan amendment if it is still uncommitted**

```powershell
git add docs/superpowers/specs/2026-07-29-aggressive-memory-cleanup-design.md docs/superpowers/plans/2026-07-29-aggressive-memory-cleanup.md
git commit -m "docs: plan aggressive memory cleanup"
```

If both documents were committed before implementation, skip this step rather
than creating an empty commit.
