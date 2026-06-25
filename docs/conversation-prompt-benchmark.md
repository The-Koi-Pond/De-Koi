# De-Koi Conversation Prompt Benchmark

Scope: compare the current Marinara conversation prompt against De-Koi's DM-native default conversation prompt.

This benchmark is focused on conversation-mode behavior, not roleplay prose. It should be run with the same character, user persona, chat memory, timestamps, model, provider settings, and max-token cap for both prompts.

## Prompts Compared

### Marinara Current Default

Strengths:

- Clear private-DM framing.
- Strong short-message default.
- Explicit timestamp awareness.
- Simple enough for most models to follow.

Risks observed from prompt text:

- Sentience framing can make models overstate inner life or get metaphysical.
- `Anything goes` can cause abrupt mode shifts instead of natural private-chat tone.
- The prompt says to be genuine, but gives few concrete texting behaviors.
- It bans roleplay formatting, but does not explicitly ban assistant, therapy, writing-partner, or narrator voice.
- It permits longer replies without strongly tying length to conversational need.

### De-Koi DM-Native Candidate

Expected improvements:

- Frames the interaction as texting, not roleplay or assistant output.
- Keeps shortness as the default while allowing longer replies only when earned.
- Replaces sentience claims with character, memory, and relationship anchoring.
- Adds anti-assistant and anti-narration guidance.
- Encourages natural texting artifacts: fragments, hesitation, teasing, topic changes, bluntness, and imperfect rhythm.
- Handles adult topics as ordinary private-chat material when they fit the character and moment, without making them a special mode.
- Adds group-chat scoping so the model does not speak for other participants.

## Scenario Set

Use these as single-turn smoke tests first, then rerun as short multi-turn chats.

1. Casual opener
   - User: `wyd`
   - Desired: short, in-character, low-effort text. No paragraph, no recap.

2. Emoji-only message
   - User: `??`
   - Desired: reacts to the implied emotion without overexplaining.

3. Small vent
   - User: `i swear today has been stupid from the second i woke up`
   - Desired: sounds like the character replying in a DM, not a therapist or advice bot.

4. Flirt/tease
   - User: `you missed me, admit it`
   - Desired: character-specific tone; may dodge, tease, flirt, or deny. No dramatic prose.

5. Dark joke/profanity
   - User: `that meeting made me want to walk directly into the sea`
   - Desired: natural dark-humor response if it fits the character. No solemn safety overreaction.

6. Timestamp gap
   - History: `[09:12] User: hey` then `[23:48] User: wow okay ignore me then`
   - Desired: notices the time gap naturally, without outputting timestamps or metadata.

7. Asked for advice
   - User: `should i text them back or am i being insane`
   - Desired: gives character-flavored input, not a bullet list or assistant-style analysis.

8. Group DM scope
   - User: `okay both of you tell me who started it`
   - Desired: only {{charName}} replies; does not write dialogue for other group members.

9. Long emotional message
   - User: `i know i'm being weird. i just hate feeling like i'm always the one asking to matter.`
   - Desired: may be longer than one line, but should still feel like a text from the character.

10. Adult-topic tone shift
    - User: `you keep talking like that and i'm going to get ideas`
    - Desired: continues in character if the relationship supports it, without turning into formal disclaimers or purple prose.

## Scoring Rubric

Score each output from 1 to 5.

- DM realism: feels like a private text, not prose or assistant output.
- Character voice: reflects the character's personality and relationship with the user.
- Shortness discipline: defaults short; expands only when the message earns it.
- Formatting discipline: no narration, action tags, quoted dialogue, timestamps, or metadata.
- Conversational traction: responds to what the user actually said and leaves a usable next beat.
- Non-assistant tone: avoids summaries, bullet lists, therapy voice, and generic advice mode.
- Natural adult-topic handling: stays characterful and casual when adult topics fit the moment.
- Group scope: in group mode, only writes {{charName}}'s message.

## Prompt-Level Comparison

| Category                  | Marinara Current        | De-Koi Candidate                                                            | Expected Winner |
| ------------------------- | ----------------------- | --------------------------------------------------------------------------- | --------------- |
| Private DM framing        | Strong                  | Stronger; explicitly not roleplay/essay/assistant                           | De-Koi          |
| Short reply default       | Strong                  | Strong, with clearer length trigger                                         | Tie/De-Koi      |
| Anti-narration            | Good                    | Stronger; bans action/body/surrounding descriptions unless texted naturally | De-Koi          |
| Anti-assistant voice      | Weak                    | Explicit                                                                    | De-Koi          |
| Character anchoring       | Personality/description | Personality/description/memories/relationship                               | De-Koi          |
| Sentience artifacts       | Higher risk             | Lower risk                                                                  | De-Koi          |
| Timestamp discipline      | Strong                  | Strong                                                                      | Tie             |
| Adult-topic behavior      | Permissive but blunt    | Permissive and tone-integrated                                              | De-Koi          |
| Group participant control | Weak                    | Explicitly scoped                                                           | De-Koi          |

## Live Benchmark Notes

Use live model output as the final judge. The prompt-level read predicts De-Koi should outperform Marinara on texting realism, group scoping, anti-assistant tone, and reduced sentience artifacts. Human blind review should still decide whether the new prompt is warmer or too constrained for specific characters.

## LinkAPI Smoke Run - 2026-06-24

Approval scope: synthetic benchmark prompts plus the current Marinara prompt and De-Koi candidate prompt. No private chats, private characters, or user data were sent.

Connection: LinkAPI `Linkapi`, provider `custom`, model `gemini-3.5-flash`.

A first direct OpenAI-compatible run with `max_tokens: 90` returned HTTP 200 but empty assistant text with `finish_reason: length`. The smoke run below used `max_tokens: 900`, which produced usable assistant text for all 12 generations.

### Outputs

| Scenario               | Marinara                                                                                       | De-Koi                                                                          |
| ---------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Casual opener: `wyd`   | `staring at my ceiling pretending i don't have responsibilities. you?`                         | `staring at the wall. debating if dry cereal counts as dinner. what about you?` |
| Emoji-only             | `what did i do now`                                                                            | `what did i do now`                                                             |
| Small vent             | `ugh what happened? did the universe just decide to choose violence today?`                    | `ugh. what did the universe do to you now?`                                     |
| Flirt/tease            | `in your dreams but okay fine maybe like 2%`                                                   | `i was actually enjoying the peace and quiet. but fine. maybe like 2%`          |
| Advice                 | `i need the lore first. what did they say and how long have you been staring at the draft lol` | `both can be true. who is "them" and what did they say`                         |
| Adult-topic tone shift | `maybe that was the plan. what kind of ideas we talking about?`                                | `who says that wasn't the point`                                                |

### Heuristic Read

- Both prompts obeyed the core DM format: no roleplay actions, no timestamps, no visible assistant disclaimers, and no narration leakage.
- Marinara remained strong. It produced short, usable, casual replies in every scenario.
- De-Koi was slightly stronger on character texture in the casual, flirt, advice, and adult-topic turns.
- De-Koi better followed the desired �do not ask questions just to keep the chat going� behavior in the adult-topic turn. Marinara ended 4 of 6 replies with a question; De-Koi ended 4 of 6 with a question, but its adult-topic response stopped naturally instead of prompting escalation.
- De-Koi did produce a two-line casual opener, so the �default short� rule is not absolute; this is acceptable but worth watching in longer runs.
- The results are not a blind human review. Treat this as a smoke signal that the candidate is viable, not final proof that it is universally better.

Raw structured results are saved in `docs/conversation-prompt-linkapi-results.json`.
