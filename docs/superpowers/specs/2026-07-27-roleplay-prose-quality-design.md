# Universal Roleplay Prose Quality Design

## Goal

Improve prose quality across De-Koi Roleplay without tuning for one scene, genre, character card, provider, or desired response length. The system should catch strong evidence of repetition, user parroting, pacing mismatch, identity or agency drift, and malformed prose while preserving intentional style, explicit content, long-form writing, character voice, and user-selected preset controls.

The fix applies only to Roleplay and the legacy `visual_novel` alias. Conversation and Game generation must not inherit Roleplay prose policy.

## Existing Behavior And Failure

De-Koi already has a two-part Roleplay quality system:

- `roleplay-quality-signals.ts` adds compact pre-generation guidance for exact repeated phrases, openings, closings, and gestures found in recent assistant turns.
- `start-generation.ts` runs a focused second-pass editor only for high-confidence strict-agency candidates. Invalid, failed, or timed-out editor output is discarded.

This architecture is sound but its detection boundary is too narrow. The Director's Chair transcript contained severe structural repetition, user parroting, excessive response length, identity drift, and corrupted prose without triggering the focused editor. Static Universal V2 instructions explicitly warned against many of those habits, demonstrating that a prompt-only repair is insufficient.

## Approaches Considered

### Prompt-only revision

Strengthen Universal V2's prose instructions and lower its default verbosity.

This has no added latency, but it cannot react to conversation-local repetition and it may override legitimate long, cinematic, or lyrical selections. The live failure already ignored strong instructions covering the reported habits. This is insufficient alone.

### Always-on model editor

Send every Roleplay reply through a second model call.

This can judge subtle prose problems, but it doubles calls, adds latency to clean replies, increases cost, and risks flattening distinctive voices. This is too broad for a default.

### Evidence-gated focused editor

Expand the existing local TypeScript signals, then call the focused editor only when accumulated evidence crosses a conservative threshold. Validate any proposed rewrite deterministically and preserve the original on uncertainty.

This is the selected approach. It keeps clean replies fast, adapts to selected preset controls, and can address nuanced prose problems without treating a phrase blacklist as a universal definition of quality.

## Architecture

### 1. Local signal collection

Extend the Roleplay-owned quality analysis under `src/engine/generation` rather than adding logic to UI, storage, Conversation, or Game owners.

The local checker will analyze the candidate reply, latest user turn, recent visible Roleplay history, active character names, persona identity information, and selected Roleplay controls. It will emit typed evidence, not a single "AI score."

Signals fall into two classes:

- **Hard signals:** likely strict-agency violations, malformed internal output, corrupted text, and explicit persona identity contradictions when authoritative identity data exists.
- **Accumulation signals:** user-turn echo, repeated opening or closing shape, repeated rhetorical construction, repeated gestures or motifs, cast saturation, and response-length mismatch.

Accumulation signals are individually minor. They authorize a model audit only when several independent signals occur in one reply or when a pattern recurs across recent turns. This prevents one em dash, one intentional echo, one long transition, or one character catchphrase from causing a rewrite.

The routing threshold is deterministic:

- one hard signal authorizes an audit immediately;
- otherwise, at least two different accumulation-signal kinds must occur in the candidate reply; or
- the same normalized structural pattern must occur in the candidate and at least two of the previous six visible assistant replies.

Response length, cast coverage, or an English-specific rhetorical pattern can never authorize an audit by itself. A deliberate echo explicitly requested by the user or defined as a character habit is suppressed before thresholding.

The checker will remain Unicode-safe and use normalized phrase overlap where possible. English structural patterns may contribute evidence but cannot be the sole trigger, so non-English Roleplay does not depend on an English blacklist.

### 2. Selected-control awareness

Quality judgments must use the active Roleplay settings:

- Long or chapter-length output is not suspicious merely for being long.
- Lyrical prose is allowed more figurative language than grounded prose.
- Cinematic pacing may service wider blocking and more characters than snappy pacing.
- Multi-character scenes may include every participant when each materially changes the beat.
- Explicit, dark, coercive, violent, or otherwise uncomfortable fictional content is not itself a quality signal.
- User-requested repetition and card-defined verbal habits override generic repetition guidance.

Length mismatch will therefore be relative to the selected length, pacing, latest user request, and recent response distribution rather than a universal word cap. Explicit bounded controls such as `One Line`, `under 150 words`, or `150 to 300 words` provide their own range. Flexible or unbounded presets use both the latest user-turn ratio and the median of recent assistant turns; `Long` and `Scene Draft` selections disable length-only concern. These comparisons contribute one accumulation signal and never make a reply suspicious on their own.

### 3. Focused model audit

When local evidence crosses the threshold, the existing focused editor receives a bounded packet:

- candidate reply;
- latest user turn and a small recent-turn window;
- selected style, pacing, length, narration, POV, tense, and agency controls;
- active character and persona identity facts needed for the cited issue;
- typed local signals with exact source evidence.

The editor returns a bounded list of replacement edits rather than permission to rewrite the whole reply. Every edit contains:

- an exact, non-empty `before` excerpt from the candidate;
- its replacement `after` text, which may be empty when removing repetition;
- a reason from the allowed reason set;
- a concise description of the repair.

Allowed reasons will cover agency, identity or continuity, repetition, pacing, and malformed prose. The editor must preserve events, character intent, quoted dialogue unrelated to a cited issue, content intensity, and user steering. It must edit rather than continue the scene.

### 4. Deterministic rewrite validation

De-Koi applies the replacement edits to the original candidate only when all checks pass:

- every reason was authorized by a triggering signal;
- every `before` excerpt occurs exactly once in the original;
- edits do not overlap and are applied from the end of the reply toward the beginning;
- replacement text is plain prose rather than JSON, tags, analysis, or duplicated content;
- the result does not become longer;
- quoted dialogue and required speaker or persona names outside edited spans are mechanically untouched;
- the output remains non-empty and structurally complete;
- the request did not time out or abort.

This span-based contract prevents the auditor from silently rewriting unrelated paragraphs or inventing an additional scene continuation. It cannot prove the artistic or factual quality of replacement text inside an authorized span, so preservation within edited spans is also covered by adversarial validator fixtures and the blind benchmark.

Any ambiguous excerpt, overlapping edit, unauthorized reason, malformed replacement, or other validation failure preserves the original response. Clean replies and low-confidence findings never make a second model call.

### 5. User control and observability

The existing `Automatic high-confidence correction` Roleplay setting remains the control surface. The feature remains enabled by default, with copy updated to explain that it can correct high-confidence prose or agency problems.

Saved correction metadata records the reason, bounded evidence, duration, and whether a correction changed the reply. It must not store the auditor's private reasoning.

## Testing Strategy

### Deterministic red-green tests

Add clean and deliberately flawed fixtures for:

- terse one-to-one dialogue;
- action with clear spatial logic;
- slow emotional restraint;
- multi-character debate;
- horror and dark fiction;
- romance or adult intimacy;
- intentionally lyrical long-form prose;
- non-English prose;
- strict and non-strict agency modes.

Tests must prove:

- each hard fixture triggers the intended signal;
- accumulated structural problems cross the threshold;
- isolated stylistic features do not;
- explicit content is not a trigger;
- long and lyrical selections retain their intended shape;
- quoted dialogue and source facts outside authorized spans survive accepted corrections;
- ambiguous, overlapping, out-of-range, or overreaching replacement edits are rejected;
- invalid or overreaching editor results preserve the original;
- Conversation and Game do not receive Roleplay quality context or audits.

### Real De-Koi generation benchmark

Run before-and-after generations through De-Koi's normal prompt assembly and streaming dry-run path using a fixed connection, identical context, and identical generation settings.

The live matrix will cover at least:

1. tense dialogue;
2. action;
3. slow emotional scene;
4. multi-character scene;
5. horror or dark fiction;
6. romance or adult intimacy;
7. intentionally long lyrical prose;
8. a short grounded exchange.

At least two scenarios will run as short multi-turn sequences to test conversation-local repetition. If a second provider family is configured and usable, repeat representative dialogue and multi-character cases there; otherwise record the single-provider limitation.

Outputs will be shuffled before manual scoring against continuity, agency, character voice, specificity, pacing, non-repetition, state change, and preservation of selected style. Deterministic metrics will record output length, echo overlap, repeated n-grams, repeated opening shape, structural-cadence counts, and whether an audit call occurred.

## Acceptance Criteria

- All deliberately flawed deterministic fixtures trigger the expected review path.
- All clean controls avoid the review path.
- Existing strict-agency correction remains covered.
- Accepted rewrites contain source-backed changes only and pass the strengthened validator.
- Clean live benchmark replies incur no second call.
- Post-fix output is preferred in at least six of eight shuffled live scenario comparisons, with no critical loss of continuity, agency, character voice, or selected style in any scenario.
- Long, lyrical, explicit, and multi-character controls remain recognizably intentional rather than being shortened or sanitized.
- The audited Director's Chair patterns trigger for structural evidence, not for sexual content.
- Roleplay-focused tests, `pnpm typecheck`, and architecture checks pass.

## Risks And Boundaries

- No automated system can prove that prose is artistically good. The local checker is a conservative routing gate; the focused editor remains a fallible model.
- Provider behavior varies. A fixed-model benchmark proves the tested path, not every future provider snapshot.
- Structural English patterns do not generalize perfectly to every language, so they cannot trigger an audit alone.
- The change must not modify the Universal V2 content boundary, sanitize opted-in adult fiction, or introduce a permanent list of banned prose.
- No live user chat is modified during testing. Real-path tests use dry runs or isolated temporary data.
