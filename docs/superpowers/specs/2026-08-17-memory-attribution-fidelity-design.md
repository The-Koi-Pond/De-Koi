# Automatic Memory Attribution Fidelity

## Goal

Prevent automatic canonical memories from changing who made a statement, using an unverified third-person pronoun, or broadening one specific observation into a general rule.

## Reported regressions

- A memory changed Agent Cobalt's pronouns while paraphrasing a returned-Machina observation.
- A memory attributed Agent Cobalt's statement about grief and return to Shlo.
- A memory generalized one returned-Machina case into a rule about returned Machina.

## Design

The owner remains `src/engine/generation/automatic-memory-capture.ts`. Source snapshots already preserve message ID, role, stable speaker label, and content, so storage and runtime contracts do not change.

Before a model-produced candidate becomes a canonical memory, the existing deterministic acceptance gate will additionally require:

1. Named people instead of third-person personal pronouns. Automatic memories must repeat the supported name rather than guess whether `he`, `her`, `them`, or a possessive pronoun refers to the right person.
2. Speaker-local support for reporting clauses. If a candidate says a named participant `said`, `says`, `believes`, `discussed`, or made a similar attributed statement, the cited message rows for that participant must independently support the attributed clause.
3. Specificity preservation. If cited evidence explicitly describes `one`, `this`, `that`, or a `single` observation, the candidate must preserve that specificity instead of converting it into an unqualified class-wide statement.

The extraction prompt will state the same rules so compliant providers generate useful candidates rather than merely having bad candidates rejected.

## Alternatives considered

- Prompt-only steering is too weak because the current prompt already asks for supported standalone memories and still admitted these examples.
- A second semantic-review request could catch more paraphrase drift, but adds latency, cost, and another nondeterministic failure point. The existing pipeline already performs value review; these guaranteed fidelity failures belong in the deterministic pre-storage gate.
- Disabling assistant-derived canonical consequences would avoid the bug but would also remove intended cross-chat character continuity.

## Mode and architecture impact

This is shared TypeScript generation behavior used by Conversation, Roleplay, Visual Novel, and other paths that schedule automatic memory capture. No mode orchestration, React UI, storage schema, Tauri command, HTTP route, or provider transport changes.

## Verification

- Add exact regression fixtures for wrong pronouns, false speaker attribution, and singular-to-general drift.
- Preserve positive fixtures for named, correctly attributed, specificity-preserving memories.
- Run focused Vitest, `pnpm typecheck`, `pnpm check:architecture`, and full `pnpm check` before shipping.
