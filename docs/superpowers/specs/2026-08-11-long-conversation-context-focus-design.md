# Long Conversation Context Focus Design

## Problem

Long Conversation chats keep accumulating two competing style sources: the complete character card and every prior assistant reply. Live GLM-5.2 replays showed that adding a near-boundary voice reminder, swapping examples, or merely shortening the alternating transcript did not stop generic writing. Even a generated, character-specific Dracula voice profile lost to one recent generic assistant reply. The reliable one-call fix was to retain recent user context while removing the model's own drifted replies as demonstrations.

The problem is therefore prompt concentration plus self-imitation, not missing character data. Relevant identity and continuity are present, but they are diluted by thousands of tokens of appearance, roleplay-shaped examples, repeated assistant prose, and unrelated durable facts. Once bland assistant turns enter the visible tail, the model treats them as stronger style examples than the card and reproduces them.

## Evidence

- Dracula baseline: 52 prompt messages and about 11,148 input tokens. Anchor-only and history-only variants remained generic.
- Dracula production-shaped focus with recent alternating history still produced detached third-person analysis, including two identical retries. Keeping only one recent assistant reply also reproduced the drift.
- Dracula production-shaped focus with the latest five user messages, compact character core, existing continuity systems, and no prior assistant replies used 896 input tokens and replied from inside Dracula's viewpoint: "You perceive it clearly... I did not make her a beast. I made her free."
- Harlequin baseline: 94 prompt messages and 7,984 input tokens.
- Harlequin production-shaped focus without prior assistant replies used 2,249 input tokens and preserved his terse lowercase voice and hidden-memory behavior.
- A compact hidden-command contract still emitted a valid `[memory: ...]` tag when given a new durable fact.

These were non-persisting `/api/invoke` completion calls. The saved chats were unchanged.

## Behavior

Focus context only for long single-speaker Conversation generations:

- The chat mode is `conversation`.
- The request is not impersonation.
- There is one character, or a group Conversation turn has an explicit target character.
- At least 20 visible assistant replies exist in the current conversation segment.

Once active:

- Keep the default/custom Conversation system prompt, preset instructions, depth instructions, lorebook context, presence/freshness/schedule context, linked-chat context, Conversation Craft injection, and hidden command contracts.
- Replace the full prompt-facing character payload with bounded identity/voice fields. Preserve the beginning and end of long fields so typing rules at the end of a card survive.
- Omit roleplay-shaped first messages, appearance-only material, creator notes, public profile, and behavioral interpretation from the focused character payload.
- Prefer up to two clean card dialogue samples converted to plain Conversation dialogue; fill any remaining slots with early, non-roleplay Conversation pairs.
- Keep the newest five visible user messages, including image attachments, but omit prior assistant history. This prevents drifted model output from recursively becoming the dominant style demonstration.
- Continue using existing rolling summary, chat-memory recall, and canonical-memory retrieval for older continuity. Give those projections bounded long-conversation budgets rather than introducing another summarizer or provider call.
- Preserve image-bearing recent user history through the existing history selector. Assistant provider metadata is intentionally omitted with assistant history.

Short Conversation chats, untargeted group generations, impersonation, Roleplay, Visual Novel, and Game keep their existing prompt behavior.

## Ownership

`src/engine/generation/conversation-context-focus.ts` owns the pure activation, text compaction, Conversation-example selection, and user-only history policy. `src/engine/generation/prompt-assembly.ts` owns mode/target selection and applies focused history, summary, and memory budgets through existing assembly seams.

No storage, provider, Rust, shared API, React, or mode-routing boundary changes.

## Failure Policy

Focus is deterministic and does not call a provider. If a character lacks suitable historical examples, the compact card simply omits them. Existing rolling summaries and memory recall remain optional exactly as they are today; their absence does not block generation.

## Verification

A focused prompt-assembly spec proves:

- activation at the long-conversation threshold;
- bounded prompt-facing character data with head/tail voice rules retained;
- roleplay actions are stripped from card dialogue examples and early Conversation pairs remain available as fallback examples;
- only the latest five user messages remain as recent history, with prior assistant drift omitted;
- hidden command guidance and current user input survive;
- short Conversation, impersonation, untargeted group, and Roleplay paths remain unchanged.

Run the focused spec, neighboring Conversation/prompt-priority specs, TypeScript validation, architecture validation, and whitespace checks.
