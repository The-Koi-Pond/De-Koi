# Memory Recall Copy Design

## Problem

Memory Recall is described as recalling fragments from the current chat, but the enabled runtime can also retrieve eligible character-wide canonical memories. Automatic capture stores speaker-labeled exchanges, and character-wide memories can follow a character into other chats. Provider embeddings rank relevant memories; they do not inherently summarize them.

## Approved Scope

GitHub issue #1053 is the approved product contract for this slice. This change updates explanatory copy only. It does not change recall, capture, ranking, storage, or persistence behavior.

## Considered Approaches

1. **Central copy contract (selected).** Put the shared Memory Recall explanation in a small React-free chat UI library module, consume it from Chat Settings and Continuity, and verify Discover copy against the same required concepts. This gives the wording one owner and a narrow test seam.
2. **Inline copy edits.** Change each string where it appears. This is smaller initially but leaves the current drift mechanism intact.
3. **Generate help from runtime capability metadata.** This could make copy fully data-driven, but it introduces a new product contract for a documentation-only correction and is unnecessary for the current behavior.

## Design

Create `memory-recall-copy.ts` under the shared chat UI library. It owns:

- the compact toggle description;
- the detailed settings explanation;
- the Memory Console scope explanation;
- enabled and disabled Continuity descriptions, including the read-behind count.

Chat Settings imports the compact and detailed descriptions. The Memory Console always shows the scope explanation above its controls. Continuity uses the shared detail builder. Discover remains JSON-backed, so its registry test verifies that the continuity entry names chat-local memory, character-wide memory, automatic speaker-labeled exchange capture, and embedding-based ranking.

## Error Handling and Safety

There are no new data or runtime paths. All copy is static. Existing memory controls and read-only character-memory behavior remain unchanged.

## Verification

- A focused copy-contract test locks the required concepts and singular/plural Continuity wording.
- The Continuity view-model test proves the shared copy is rendered.
- The Discover registry test proves its JSON entry carries the same concepts.
- TypeScript, architecture, docs/discovery, and the full PR gate verify integration.

