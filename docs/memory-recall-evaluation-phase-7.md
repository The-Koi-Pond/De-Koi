# Memory Recall Phase 7 Evaluation

## Scope

Phase 7 evaluates whether canonical Memory Recall improves long-running roleplay continuity without turning stale or superseded facts into false canon and without growing prompt cost too aggressively.

The deterministic evaluation pack lives in `src/engine/generation/memory-recall-evaluation.ts` with tests in `src/engine/generation/memory-recall-evaluation.spec.ts`.

## Fixture Coverage

The fixture builds 56 roleplay turns and covers:

- direct recall questions
- contradictions and supersession
- time skips
- relationship changes
- message edits and deletes
- branchy scenes
- multiple participants
- user correction behavior
- migrated canonical memories
- extraction failure / empty-control behavior

## Measured Results

Totals from the deterministic fixture after tuning:

| Retrieval mode | Correct recall | Wrong recall | Missing recall | Stale/superseded recall | Token cost |
| --- | ---: | ---: | ---: | ---: | ---: |
| Vector-only candidates | 6 | 0 | 3 | 0 | 108 |
| Lexical fallback | 9 | 0 | 0 | 0 | 249 |
| Hybrid vector + canonical rerank | 9 | 0 | 0 | 0 | 173 |
| Hybrid without stale/superseded filtering | 9 | 0 | 0 | 1 | 187 |

Interpretation: embeddings/indexes improve precision and token cost when available, lexical fallback prevents missing recall when migrated memories have no rebuildable vector yet, and stale/superseded filtering removes a false-canon risk that hybrid ranking alone does not solve.

## Recommended Defaults

- Memory recall default budget: 768 tokens.
- Minimum budget: 256 tokens.
- Maximum budget: 1536 tokens.
- Context share: 10% of model context when context size is known.
- Similarity threshold: 0.28.
- Strong lexical fallback: at least two meaningful overlapping query tokens with 0.66 coverage.
- Read-behind exclusion: 1 latest visible message by default.
- Max scoring rows: 500 recent candidates.
- Treat `deletedAt`, `correctedAt`, `supersededAt`, and `supersededByMemoryId` as non-retrievable index/prompt rows.
- Keep lexical fallback enabled when embeddings are missing or dimension-mismatched.

## Tuning Decisions

- Tightened prompt budget from 1024 / 15% / 2048 max to 768 / 10% / 1536 max to lower prompt bloat.
- Raised semantic similarity floor from 0.25 to 0.28 to reduce weak vector drift.
- Lowered strong lexical coverage from 0.75 to 0.66 so specific two-token fact matches can survive missing embeddings.
- Added `is` to recall stopwords so grammar glue does not dilute query intent.
- Updated recall prompt wording to say recalled fragments are context, not immutable canon, and newer visible chat wins on contradiction.
- Canonicalized automatic transcript refresh rows and correction replacement rows.

## Risk Report

- Deterministic fixture coverage is strong for known RP continuity shapes, but it is not a substitute for live long-running model behavior.
- The pack measures retrieval and prompt composition, not LLM truthfulness after injection.
- Vector-only behavior uses deterministic local embeddings in tests; provider embedding quality may vary.
- Global migration automation is still separate from this evaluation; the preflight covers a per-chat migration path.
- Existing unrelated architecture violation in `src/app/shell/folder-row-layout.spec.tsx` can still block aggregate architecture checks.

## Manual Test List

1. Import an old chat with `chats.memories[]`, summary metadata, and character memories.
2. Run memory migration for that chat.
3. Open the Memory Console and confirm imported/manual/summary/character rows are visible with canonical type/scope/status.
4. Generate a turn asking about a migrated memory with no embedding and confirm lexical fallback recalls it.
5. Generate enough turns to trigger refresh and confirm a new canonical `transcript` memory appears.
6. Correct a wrong memory with replacement text and confirm the old row is wrong while the replacement is active/canonical/indexed.
7. Ask about the corrected fact and verify the old contradicted fact is not injected.
8. Edit and delete source messages, refresh, and verify transcript-owned chunks update while imported/manual rows remain.
9. Try a branchy roleplay scene with two participants and verify only the active branch facts are recalled.
10. Compare prompt snapshots before/after tuning and confirm recall block stays below the recommended budget.

## Health Checks

Run these before considering the memory rework shipping-ready:

```bash
pnpm test src/engine/generation/memory-recall-evaluation.spec.ts src/engine/generation/prompt-assembly.context-priority.spec.ts src/engine/generation/start-generation.memory-recall.e2e.spec.ts
cargo test --manifest-path src-tauri/Cargo.toml chat_memory::tests::
pnpm typecheck
pnpm check:architecture
```

If `pnpm check:architecture` fails only on the known folder-row layout cross-package test import, run these subchecks and record the aggregate blocker:

```bash
node scripts/check-rust-structure.mjs
node scripts/check-frontend-runtime-boundaries.mjs
node scripts/check-remote-runtime-dispatch.mjs
```
