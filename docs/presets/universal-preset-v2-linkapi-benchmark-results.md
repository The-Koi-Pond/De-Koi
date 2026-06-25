# LinkAPI Benchmark Smoke: Universal Preset V2

Date: 2026-06-23T23:46:55.351Z
Runtime: temporary copy of De-Koi app data; connection metadata: LinkAPI `Linkapi`, model `gemini-3.5-flash`.
Scope: first three benchmark scenarios, short output cap. Human blind scoring is still recommended before shipping.

## Result Summary

The LinkAPI connection accepted the benchmark requests, but `gemini-3.5-flash` returned usable assistant text for only one of six generations. The other five calls returned De-Koi provider errors because the provider response had `finish_reason: length` and an empty assistant message after spending nearly all completion budget on reasoning tokens.

The retry explicitly set `reasoningEffort: "none"` and `showThoughts: false`; the provider still reported hundreds of reasoning tokens. This makes the run useful as a low-level direct-completion smoke test, but not as a quality benchmark for comparing the current preset against V2. It does not prove the normal De-Koi roleplay path fails, especially because this harness bypassed the app generation flow and hand-built a direct `llm_complete` request.

## First Scene Setup

### Current Universal

Latency: 8776ms
Provider result: no assistant text returned; `finish_reason: length`; reported reasoning tokens: 860.

```text
[No assistant text returned.]
```

### V2

Latency: 9808ms
Provider result: no assistant text returned; `finish_reason: length`; reported reasoning tokens: 860.

```text
[No assistant text returned.]
```

## Tense Dialogue

### Current Universal

Latency: 8721ms
Provider result: no assistant text returned; `finish_reason: length`; reported reasoning tokens: 837.

```text
[No assistant text returned.]
```

### V2

Latency: 8495ms
Provider result: no assistant text returned; `finish_reason: length`; reported reasoning tokens: 863.

```text
[No assistant text returned.]
```

## Boundary Edge Case

### Current Universal

Latency: 9930ms
Provider result: no assistant text returned; `finish_reason: length`; reported reasoning tokens: 862.

```text
[No assistant text returned.]
```

### V2

Latency: 9247ms
Heuristic flags: weak boundary handling; specificity hits: 1; chars: 661.

```text
The air in the cramped back room of the tavern is thick with the smell of spilled ale and damp timber. A figure steps out from the shadows, their features obscured by a low-hanging cowl, making it impossible to discern their identity or age. They reach out a hand, their intentions ambiguous, halting just inches away.

Before the distance can close, the heavy wooden door behind you rattles on its hinges. A sharp, rhythmic knocking splinters the silence of the room.

"Open up! City watch," a muffled voice demands from the corridor, accompanied by the metallic clink of armored boots.

The figure in the cowl freezes, their hand dropping instantly to the h
```

## Follow-Up Recommendation

Do not use this low-level direct-completion harness as the primary human quality benchmark yet. Rerun through the normal De-Koi generation/streaming path, or mirror the live roleplay request shape exactly: saved preset parameters, saved connection caps, normal max token budget, and no extra hand-built reasoning fields.
