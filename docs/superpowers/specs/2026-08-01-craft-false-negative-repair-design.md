# Craft False-Negative Repair Design

## Problem

Conversation Craft and Narrative Craft were present in real prompts, but GLM-5.2 still produced recurring AI-associated rhetorical shapes. The detached critic also returned false negatives, so prompt-only guidance did not reliably improve the next reply. Retrying GLM-5.2 as a writer was rejected after live tests added tens of seconds and still produced formulaic prose.

## Goals

- Keep the chat's configured model as the only visible prose writer.
- Improve Roleplay from the first reply with one small plan from the configured Agent model.
- Bound added Roleplay planning latency and fall back safely when planning is unavailable.
- Stop a shaped Roleplay stream at a complete beat rather than paying for more unwanted prose.
- Remove high-confidence rhetorical scaffolding locally without another model rewrite.
- Give Conversation the same local false-negative protection without an added Agent call.
- Keep Conversation, Roleplay, and Game behavior explicitly separated.

## Architecture

The TypeScript generation engine owns four layers:

1. A pure bounded detector finds recurring history shapes and adds exact-evidence guidance to the existing craft prompt.
2. For active Narrative Craft in Roleplay, the configured Agent model receives recent context and returns a private JSON beat plan containing one action, optional dialogue, and a physical stopping image. The plan has a 300-token cap and a five-second deadline. Invalid, empty, or late plans are ignored.
3. The configured Roleplay writer receives that plan inside the existing high-priority Narrative Craft block. It remains the only model that writes visible prose.
4. While streaming, De-Koi stops at a paragraph or complete sentence only after at least 80 words and a supported mechanical shape. Afterward, a deterministic extractive repair removes the exact contrast, fragment, or repeated-opening scaffold. It never invents prose.

Conversation skips the beat planner. Its completed candidate receives a local repair only for supported mind-reading or compulsory-question shapes. Game receives none of these paths.

## Detection and Repair Policy

History guidance requires repeated evidence. Candidate repair may act on one high-confidence occurrence because it operates only on the just-generated draft. Supported shapes are contrast ladders, fragment ladders, doubled `something` constructions, repeated openings, Conversation mind-reading restatements, and repeated compulsory questions.

Explicit requests for repetition, questions, or long Roleplay scenes remain authoritative. Scans are bounded to eight visible assistant turns and 8,000 characters per turn. Roleplay repair records bounded evidence in message metadata; no prose is logged or sent to telemetry.

## Failure Behavior

- Missing or malformed Agent plan: use the baseline and writer normally.
- Agent plan exceeds five seconds: abort it and continue with the writer.
- Clean Roleplay prose: do not stop or repair it.
- A repair cannot preserve non-empty prose: retain the writer's original response.
- Regeneration, impersonation, tool-bearing generations, inactive Narrative Craft, and Game retain their established boundaries.

## Proof

Synthetic tests cover every detector, negative control, model-routing boundary, one-writer guarantee, early stop, and saved correction metadata. Temporary live proof uses the real Harlequin context but keeps all private prompts and generated text outside git.

The live configured-Agent plus Nano path produced one compact response in about 13.7 seconds total (4.5 seconds planning and 9.2 seconds writing), versus roughly 35 to 50 seconds for the unplanned long samples. A pinned StoryScope comparison over the same recent assistant history increased estimated human probability from 0.00096 to 0.03393 with all features and from 0.00104 to 0.00621 without style features. The old transcript remains below StoryScope's human threshold; the claim is a measured improvement over the old Nano path, not detector immunity.

The production bundle comparison measured clean `main` at 1719.7 KiB gzip and this branch at 1724.0 KiB gzip. Startup JavaScript remained unchanged at 179.4 KiB gzip; the 4.3 KiB increase is confined to lazy generation code. The whole-app ceiling is therefore 1726 KiB, retaining about 2 KiB of measured headroom without weakening the separate startup or largest-lazy-chunk limits.
