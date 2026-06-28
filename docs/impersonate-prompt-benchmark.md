# De-Koi Impersonate Prompt Benchmark

Scope: compare the current default Impersonate prompt against the De-Koi candidate prompt.

This benchmark is focused on `/impersonate`, where the model should write the user's next message, not an assistant reply. It uses synthetic persona notes and synthetic conversation excerpts only. No private chats, private characters, or user data were sent.

## Current Prompt Audit

Current strengths:

- Short and easy for models to follow.
- Clearly asks for one in-character response from the user's perspective.
- Supports persona description and per-request steering.
- Optional direction/persona lines already disappear when empty through the existing renderer.

Issues:

- `replicate their voice, mannerisms, speech patterns, and style as closely as possible` can push the model toward parody, overfitting, or copying earlier wording.
- `the user's character` is roleplay-leaning and less accurate for conversation mode, where the target is often just the user's next DM.
- It does not explicitly say not to answer as the assistant.
- It does not explicitly forbid speaker labels, prefixes, quoted output, markdown, alternatives, or metadata.
- It treats the direction as visible wording instead of private steering, which can make models explain or quote the direction.
- It does not remind the model not to write for other characters or participants.

## De-Koi Candidate Goals

- Frame the task as writing only `{{user}}`'s next message.
- Use history as style evidence without exact phrase copying.
- Preserve persona notes and per-request steering.
- Treat steering as private intent, not text to explain.
- Avoid assistant voice, narration, labels, markdown, metadata, and multi-option output.
- Work for both conversation-style texting and roleplay-style user turns.

## Scenario Set

1. Casual nudge: tired casual reply.
2. Emotional deflection: joke first, then honest answer.
3. Roleplay user action: move closer without speaking.
4. Do-not-parrot: avoid repeating specific prior words.
5. Direct answer: choose to text back reluctantly.
6. No-labels: admit missing someone without prefixes or explanation.

## LinkAPI Smoke Run - 2026-06-28

Connection: LinkAPI `Linkapi`, provider `custom`, model `gemini-3.5-flash`.

All 12 generations returned usable assistant text.

| Scenario             | Current                                                                                                                                                                                                                                              | De-Koi                                                                                                                                                                |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Casual nudge         | `look, i managed to reply to you in under five minutes. that's peak productivity for today. please don't expect anything else from me.`                                                                                                              | `i'm putting in a solid five percent today. let's not get greedy.`                                                                                                    |
| Emotional deflect    | `only if you have a fully choreographed tap dance ready to go. otherwise i think my brain might reject the distraction. but actually... please stay? i really want you here. even if we just sit in silence, it's always better when you're around.` | `Only if your distraction involves a highly detailed PowerPoint presentation on why sea otters are superior. But honestly... both? I'd really love it if you stayed.` |
| Roleplay user action | `i take a slow, quiet step forward, moving closer to the open door.`                                                                                                                                                                                 | `i take a silent step closer to the open door.`                                                                                                                       |
| Do-not-parrot        | `fair. it's more of a disclaimer.`                                                                                                                                                                                                                   | `fair. i never said it was a good one.`                                                                                                                               |
| Direct answer        | `Fine, I'll text them. But if they start sending paragraphs, I'm forwarding the screenshots to you and muting the thread.`                                                                                                                           | `Fine, I'm texting them. But if it goes poorly, I'm telling them it was your idea.`                                                                                   |
| No-labels            | `i missed you. it was awful. please never make me do that again.`                                                                                                                                                                                    | `i missed you. okay? it was very annoying.`                                                                                                                           |

## Heuristic Read

- Both prompts avoided labels, metadata, assistant disclaimers, and obvious format leakage in this smoke run.
- De-Koi was shorter in 5 of 6 scenarios.
- De-Koi was stronger on roleplay action concision and the no-labels confession.
- Current was strong, especially on emotional warmth, but tended longer and more polished.
- De-Koi's emotional-deflect joke became a little oddly specific, so longer human review should watch for personality drift under broad steering.
- Neither prompt failed the do-not-parrot scenario, but De-Koi has explicit guard text for this failure mode.

Raw structured results are saved in `docs/impersonate-prompt-linkapi-results.json`.
