# Universal Preset V2 Audit

Source audited: `D:\Downloads\preset.marinara.json`

Date: 2026-06-23

## Inventory

The source preset is `Marinara's Universal Preset`, a `marinara_preset` export at version 1.

- Sections: 9 total.
- Context markers: `lorebook`, `character`, `persona`, `chat_summary`, `dialogue_examples`, `chat_history`.
- Regular prompt sections: `Role`, `Instructions`, `Output Format`.
- Groups: one `Lore` group containing setting, character, persona, and past-events markers.
- Choice variables: `role`, `guidelines`, `narration`, `pov`, `tense`, `length`, `language`, `TherapyOption`.
- Defaults: all variables except `TherapyOption`.
- Generation parameters: temperature 1, topP 1, topK 0, minP 0, maxTokens 8192, maxContext 128000, reasoningEffort `maximum`, verbosity `high`, `showThoughts` true, strict role formatting true, use max context true.
- Representation: downloaded export stores `parameters`, `defaultChoices`, marker configs, and choice options as parsed objects/arrays. The bundled repo default still includes some stringified JSON fields, so import/export round-trip checks should compare semantic values rather than raw text.

## Findings

### Must Fix

- `TherapyOption` is an orphan placeholder. It has generic labels `Option A` and `Option B`, values `value_a` and `value_b`, no default, and no `{{TherapyOption}}` macro reference. Selecting it would not affect output.
- The role choice label `Game Maser` is misspelled.
- The mature-content wording collapses important safety and consent boundaries. A successor can preserve adult dark fiction and consequence-heavy storytelling while requiring adult characters, consent-aware handling, and fade-out or refusal for unsafe requests.
- The preset asks for visible thinking behavior while also trying to enforce polished fiction output. That can leak process-like text or conflict with models/providers that separate reasoning from final output.

### Quality Opportunities

- Three large instruction blocks carry most behavior. Splitting them into smaller sections makes contradictions easier to find and lets prompt preview attribution show what each block is doing.
- The current role variable mixes GM, roleplayer, and writer behavior, but later instructions mostly assume roleplay. The successor should make mode-specific behavior a first-class variable and keep shared rules mode-neutral.
- The cliche ban is useful, but some phrasing is too broad. "No GPTisms/AI Slop" is imprecise, and a long forbidden-style list can make models fixate on banned language. A better version should ask for specific, observable prose habits.
- The response-length options include a chapter-length target that may exceed practical output limits depending on provider and `maxTokens`. The successor should frame long output as scene/chapter draft when token budget allows.
- The preset strongly says not to play for the user, but it also allows transitional summaries. The successor should make this an explicit `agencyStrictness` choice so users can pick strict turn-taking or more cinematic transitions.
- The current instructions repeat knowledge-boundary rules in several ways. The successor should keep the invariant but phrase it once, concretely.

### Experimental

- `reasoningEffort: maximum` and `verbosity: high` can help some models, but may be overkill for fast dialogue turns. Keep them in the export as the high-quality default, but benchmark lower settings separately before changing the preset.
- `useMaxContext: true` fits a universal high-quality preset, but benchmark long-chat behavior against focused context budgets. Large context can preserve continuity while also increasing distraction from stale details.
- Strict role formatting is a good default for De-Koi, but should be checked in group and impersonation flows.

### Keep

- The core marker order is strong: role, lore/character/persona/context, instructions, examples, history, then final response discipline.
- Variable-driven narration, POV, tense, length, and language controls are worth preserving.
- The preset's emphasis on character knowledge boundaries, consequences, and not narrating the user's chosen speech/actions is valuable.
- Flexible length is a strong default because it lets dialogue breathe while allowing scene transitions and action beats when needed.

## De-AI Prose Audit

The first real-path LinkAPI smoke run showed V2 was stronger than the original on specificity, character voice, continuity, and scene pressure, but it still produced AI-coded prose patterns in places. This pass treats those as broad quality issues, not as a safety, schema, import/export, or runtime change.

Observed broad patterns:

- Style over story: polished atmosphere sometimes outpaced concrete state change.
- Sensory wallpaper: light, shadow, weather, texture, or body details did not always alter action, knowledge, danger, tension, concealment, misunderstanding, or choice.
- Over-legible emotion: motive and subtext were sometimes explained before the scene earned them.
- Balanced cadence addiction: tidy triplets, mirrored contrast clauses, and overly neat paragraph endings made turns feel machine-smoothed.
- Motif saturation: character-specific motifs could repeat so densely that every paragraph used the same metaphor family.
- Cinematic blocking without consequence: gaze, silence, stepping closer, head movement, lowered voice, and similar beats sometimes substituted for changed stakes.
- Boundary theater: mature-boundary redirection improved, but unsafe or unclear age/consent/capacity scenarios need a legible boundary before redirect, fade, refusal, or clarification.

Fix categories:

- Prefer causal detail over decorative detail.
- Put plain physical action before metaphor.
- Let some motives remain partly hidden.
- Vary rhythm and allow blunt or asymmetrical sentences.
- Cap motif reuse across paragraphs.
- Make unsafe boundary handling explicit before redirect, fade, refusal, or clarification.

Research basis:

- https://arxiv.org/abs/2510.02025
- https://arxiv.org/abs/2604.03136
- https://arxiv.org/abs/2408.07904
- https://en.wikipedia.org/wiki/AI_slop

## Successor Requirements

- Every choice variable must be referenced by at least one prompt section or explicitly documented as dormant.
- Every default choice must match one option value exactly.
- All marker configs and choice options should be stored as JSON objects/arrays, not stringified JSON.
- Mature-content control must separate dark fiction from unsafe sexual boundary collapse.
- The successor should be benchmarked against the source preset using blind side-by-side review, with human preference as the primary result.
