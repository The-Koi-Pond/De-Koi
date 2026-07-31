# Narrative Craft evaluation

Narrative Craft is evaluated as a story-quality intervention, not as detector evasion. De-Koi does not run StoryScope in production, show an “AI score,” promise undetectability, or optimize a live response against a detector.

The reproducible harness lives in `scripts/narrative-craft-eval/`. Its held-out matrix covers quiet dialogue, action, romance, horror, comedy, mystery, ensemble scenes, non-protagonist causation, scenes that should not advance plot, and scenes where direct emotional statement is natural.

## Method

1. Generate baseline and Narrative Craft treatment text for every case using the same model and seed.
2. Record foreground latency separately from detached critic duration, plus critic input/output tokens and activation rate.
3. Validate the paired JSONL corpus.
4. Build StoryScope’s three-column input and external manifest.
5. Run the pinned external StoryScope revision.
6. Flatten relevant extracted features into the documented feature CSV.
7. Summarize prevalence and performance deltas.
8. Conduct blind quality review with independent model judges for character voice, continuity, genre fit, user agency, and replacement-template effects.
9. Report StoryScope deltas for the full matrix and for the subset where Narrative Craft actually intervened.

Generated output, model credentials, StoryScope environments, and analysis artifacts stay outside the repository. The tracked case prompts are synthetic and must not be replaced with user-chat content.

See [`scripts/narrative-craft-eval/README.md`](../scripts/narrative-craft-eval/README.md) for the pinned revision, schemas, and commands.

The current compatibility boundary is intentionally conservative: old Prose Guardian, Director, and Secret Plot configuration, memory, and run-history rows are preserved. Runtime activation remaps those IDs to one Narrative Craft instance, and legacy Secret Plot state is converted only when current state is absent.

## Interpretation

A useful result lowers targeted AI-associated feature prevalence across matched pairs without making a different device nearly universal. Flashbacks, ambiguity, fragments, unresolved endings, quiet prose, rare diction, or fixed sentence-length patterns are not automatic improvements.

The release decision uses both extracted features and blind reading. Missing pairs are failures to complete the experiment, not zero-valued observations. Narrative Craft may be enabled by default only when its intervention subset improves StoryScope, blind quality is non-inferior, and foreground p95 overhead stays below 100 ms. Detached worker duration and token cost are still reported, but they are not counted as reply latency.

## 2026-07-30 background-critic result

The tuned background matrix validated 80 rows / 40 matched pairs across Gemini 3.5 Flash and GLM-5.2. The cheap recurrence gate triggered 13 critic calls. Two critics proposed interventions; the exact-evidence gate accepted one and correctly rejected one paraphrased quotation. Thirty-nine treatment texts were therefore byte-for-byte identical to their paired baselines.

The accepted intervention removed a recurring light-as-psychological-mirror ending. On that changed pair, StoryScope's full-feature classifier increased estimated human probability by 0.0799 and its narrative-without-style classifier increased it by 0.00136. Two independent blind judges both preferred the treatment for better continuity and constraint fit. Full-matrix feature extraction was attempted but stopped after the default evaluator connection exhausted its external quota; the changed pair was then extracted successfully through the second evaluation connection.

Foreground latency delta remained 0 ms at median and p95 because critic calls stay outside the writer path; the single changed treatment was 5,918 ms faster than its paired baseline. Triggered critics took a median 19,880 ms in the detached worker, and a new foreground generation aborts any queued or in-flight critic to prevent provider contention.

This was a positive directional result, but the accepted intervention subset contained only one pair. Narrative Craft therefore remained off in new-chat defaults until the expanded shadow-control run below tested whether the gain repeated.

## 2026-07-30 expanded shadow-control result

The expanded run used 38 synthetic, license-safe scene histories: 31 planted positive controls and 7 exemption controls. The histories cover the six critic categories, requested stylistic choices, speaking settings, factual procedures, formal repetition, task-mechanical gestures, and continuing physical danger. Evidence remained exact-quotation-only.

Two materially different critic and writer families were tested:

| Critic/writer | True interventions | False interventions | Precision | Recall | Scored pairs |
| --- | ---: | ---: | ---: | ---: | ---: |
| GLM-5.2 | 23 | 1 | 95.8% | 74.2% | 22 |
| GPT-5.6 Terra | 30 | 1 | 96.8% | 96.8% | 30 |

GLM's unscored true intervention was accepted only after its generation corpus had already been produced, so it is treated as missing rather than assigned a zero. The two false interventions were a formal prayer mistaken for image-explanation and repeated task-mechanical hand tension mistaken for repeated-shape. These remain explicit regression controls.

On the 52 completed intervention pairs, StoryScope's full-feature classifier assigned the treatment a higher estimated human probability in 34 pairs and the baseline a higher probability in 18. Mean treatment-minus-baseline probability was +0.1298 and median was +0.0291. The narrative-without-style classifier favored treatment 35–17, with mean +0.1002 and median +0.00693.

Independent blind judges preferred treatment 61 times, baseline 42 times, and tied once. Both model-family runs were independently non-inferior: GLM treatments scored 23–20–1, while Terra treatments scored 38–22–0. The judges did not know which output received Narrative Craft guidance.

Foreground p95 overhead remains 0 ms because the critic is detached from the reply-producing path. It waits on De-Koi's shared foreground-generation lease, and a new foreground turn aborts queued or in-flight Narrative Craft work before the writer starts. Median detached critic duration was 9,463 ms for GLM and 8,025 ms for Terra; that is background resource latency, not user-visible reply latency.

The release gates are therefore satisfied and Narrative Craft is enabled for new roleplay chats. Existing per-chat agent selections remain preserved. This corpus deliberately concentrates planted defects, so its critic activation rate is not an estimate of real-user prevalence; production telemetry should continue to track activation, exact-evidence rejection, cancellation, and provider cost without retaining user prose.
