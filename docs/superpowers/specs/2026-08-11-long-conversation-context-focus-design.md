# Long Conversation Context Focus Design

## Problem

Long Conversation chats keep accumulating two competing style sources: the complete character card and every prior assistant reply. Live GLM-5.2 replays showed that adding a near-boundary voice reminder, swapping examples, or merely shortening the alternating transcript did not stop generic writing. Even a generated, character-specific Dracula voice profile lost to one recent generic assistant reply. Prompt concentration is still required, but removing every recent assistant reply also removes the answers that make follow-up user messages coherent.

The problem is therefore balancing prompt concentration against conversational causality. Relevant identity and continuity are diluted by thousands of tokens of appearance, roleplay-shaped examples, repeated assistant prose, and unrelated durable facts. The focused tail must remain small enough to limit self-imitation while retaining the immediately preceding assistant answers that give user follow-ups their referents.

## Evidence

- Dracula baseline: 52 prompt messages and about 11,148 input tokens. Anchor-only and history-only variants remained generic.
- Dracula production-shaped focus with recent alternating history still produced detached third-person analysis, including two identical retries. Keeping only one recent assistant reply also reproduced the drift.
- Dracula production-shaped focus with the latest five user messages, compact character core, existing continuity systems, and no prior assistant replies used 896 input tokens and replied from inside Dracula's viewpoint: "You perceive it clearly... I did not make her a beast. I made her free."
- Harlequin baseline: 94 prompt messages and 7,984 input tokens.
- Harlequin production-shaped focus without prior assistant replies used 2,249 input tokens and preserved his terse lowercase voice and hidden-memory behavior.
- A later live Harlequin chat crossed the 20-reply focus threshold and exposed the missing causal contract: five user messages were merged without Harlequin's answers, so follow-ups such as "if what's worth it" reached the model without the statement they referred to.
- A compact hidden-command contract still emitted a valid `[memory: ...]` tag when given a new durable fact.

These were non-persisting `/api/invoke` completion calls. The saved chats were unchanged.

## Behavior

Focus context only for long single-speaker Conversation generations:

- The chat mode is `conversation`.
- The request is not impersonation.
- There is one character, or a group Conversation turn has an explicit target character.
- At least 20 visible assistant replies exist in the current conversation segment.

Once active:

- Keep the default/custom Conversation system prompt, preset instructions, depth instructions, lorebook context, presence/freshness/schedule context, linked-chat context, Conversation prose guidance, and hidden command contracts.
- Replace the full prompt-facing character payload with bounded identity/voice fields. Preserve the beginning and end of long fields so typing rules at the end of a card survive.
- Omit roleplay-shaped first messages, appearance-only material, creator notes, public profile, and behavioral interpretation from the focused character payload.
- Prefer up to two clean card dialogue samples converted to plain Conversation dialogue; fill any remaining slots with early, non-roleplay Conversation pairs.
- Keep the normal Conversation transcript (see "Update 2026-11-06": this used to be only the newest five messages).
- Continue using existing rolling summary, chat-memory recall, and canonical-memory retrieval for older continuity. Give those projections bounded long-conversation budgets rather than introducing another summarizer or provider call.
- Preserve image-bearing recent history and assistant provider metadata through the existing history selector.

Short Conversation chats, untargeted group generations, impersonation, Roleplay, Visual Novel, and Game keep their existing prompt behavior.

## Ownership

`src/engine/generation/conversation-context-focus.ts` owns the pure activation, text compaction, and Conversation-example selection. `src/engine/generation/prompt-assembly.ts` owns mode/target selection and applies focused history, summary, and memory budgets through existing assembly seams.

No storage, provider, Rust, shared API, React, or mode-routing boundary changes.

## Failure Policy

Focus is deterministic and does not call a provider. If a character lacks suitable historical examples, the compact card simply omits them. Existing rolling summaries and memory recall remain optional exactly as they are today; their absence does not block generation.

## Verification

A focused prompt-assembly spec proves:

- activation at the long-conversation threshold;
- bounded prompt-facing character data with head/tail voice rules retained;
- roleplay actions are stripped from card dialogue examples and early Conversation pairs remain available as fallback examples;
- the whole transcript stays, including the assistant answers required by user follow-ups, while everything else in the prompt stays small;
- hidden command guidance and current user input survive;
- short Conversation, impersonation, untargeted group, and Roleplay paths remain unchanged.

## Update 2026-11-06: keep the whole transcript

The five-message tail relied on the rolling summary for older continuity, but Conversation summaries only cover past days, never today. A long same-day chat therefore lost everything said more than five messages ago except what keyword recall or a `[memory: ...]` tag happened to bring back: characters re-confessed secrets told twenty texts earlier, forgot whose dog it was, and lost dates.

Evidence (Opus 5.5 writer, conversation quality lab, 30-text games, 12 per side, judge v3): continuity 5.25 -> 6.33, time 5.75 -> 6.83, attunement 7.08 -> 7.67, overall 6.54 -> 7.13; voice 7.79 -> 7.96 (no drift), habit hits and reply time unchanged. Tails of 12 and 20 messages helped less (continuity 5.8), because the missed facts were 40+ messages back. A blind replay of five late moments from real Harlequin chats preferred the whole-transcript reply 2 to 1, with one tie. The cost is a larger prompt in long chats (about twice the size by text 30).

The focused card, voice examples and bounded memory budgets stay: they were the part of the August fix that carried the voice evidence. The August drift was measured on GLM-5.2; a weaker model that drifts on its own long history can still be capped with the chat's `contextMessageLimit`.

Run the focused spec, neighboring Conversation/prompt-priority specs, TypeScript validation, architecture validation, and whitespace checks.
