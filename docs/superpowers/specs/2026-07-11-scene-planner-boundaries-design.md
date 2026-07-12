# Scene Planner Boundaries Design

## Goal

Keep `/scene` faithful to an explicitly requested adult tone, prevent planner-authored safety language from overriding De-Koi's deterministic scene choices, and render planner-authored multiline text correctly.

## Design

The roleplay scene service remains the sole owner. Scene planning may propose narrative content, but it may not select Universal preset choices; De-Koi infers those choices deterministically from the completed plan and originating conversation. This prevents a planner from selecting a restrictive boundary that contradicts an explicit NSFW request.

Planner narrative fields are normalized at the scene-plan boundary. Double-escaped carriage returns, newlines, and tabs become their intended control characters before the plan is persisted. The normalization is limited to planner-produced narrative prose and does not alter arbitrary chat messages.

The planner no longer authors `systemPrompt`, `participationGuide`, or Universal preset choices. De-Koi supplies its deterministic scene guidelines and Universal preset inference instead. Sanitization ignores those legacy planner fields rather than trying to classify arbitrary policy-like prose after generation.

## Data Flow

1. `/scene` sends the request and context to the planner.
2. The returned JSON is parsed.
3. Narrative prose fields are normalized; planner instruction fields and preset choices are ignored.
4. `resolveSceneUniversalPreset` infers boundary, erotic tone, agency, pacing, and related settings from the sanitized plan and source conversation.
5. Scene metadata and initial messages are persisted with real line breaks.

## Verification

- A planner response that requests `boundary_explicit_adult_safe` cannot override the deterministic mature-adult boundary for an explicitly NSFW scene.
- Double-escaped newlines in `firstMessage` persist as real line breaks.
- Planner-authored system and participation instructions are not persisted.
- Existing roleplay scene tests, TypeScript checks, architecture checks, and the full shipping gate pass.
