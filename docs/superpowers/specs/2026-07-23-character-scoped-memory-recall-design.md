# Character-Scoped Memory Recall Design

## Goal

In a multi-character conversation, each generated reply may recall:

- chat-scoped canonical memories for the active chat; and
- character-scoped canonical memories owned by the character answering.

A reply must not inherit character-scoped memories owned only by another participant.

## Root Cause

Prompt assembly currently supplies every chat participant to canonical-memory retrieval. Its reusable prompt context also treats conversation targets as equivalent, so a later character reply can reuse the first character's canonical-memory block.

## Design

Prompt assembly will derive a canonical-memory character scope from the generation request:

- If `forCharacterId` identifies a participant, canonical recall receives only that character.
- Otherwise, canonical recall keeps the existing participant set. This preserves single-character, impersonation, game, and genuinely merged ensemble generation.

The reusable-context scope key will also include the effective requested target for both conversation and individual roleplay generation. A changed target will rebuild target-sensitive prompt context, including canonical memories, instead of reusing another character's block.

Chat-scoped memories remain eligible because canonical-memory retrieval always queries the active chat independently of character scopes.

## Verification

A prompt-assembly regression test will build two consecutive replies in one group conversation with reusable context:

1. Jester receives the active chat memory plus Jester's character memory, but not Harlequin's.
2. Harlequin receives the active chat memory plus Harlequin's character memory, but not Jester's.

The test must fail on the current implementation, pass after the fix, and retain the existing canonical-memory suite.
