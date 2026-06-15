# Token Budget Estimates

De-Koi currently uses deterministic heuristic token estimates in prompt-budget
paths such as lorebook injection and knowledge retrieval. The default heuristic
is intentionally simple: roughly four UTF-16 characters per token.

## Current Decision

Do not bundle tokenizer-backed estimators for general chat models until the
project can choose maintained tokenizer assets for the supported provider/model
families.

Reasons:

- provider tokenizers for newer GPT, Claude, Gemini, and other model families are
  not consistently published as portable local assets;
- using one tokenizer as a pretend universal tokenizer would create false
  precision;
- tokenizer bundles would affect app size and offline distribution;
- budget behavior must stay React-free and provider-independent inside
  `src/engine`.

## Requirements For Future Tokenizer Support

A future tokenizer-backed implementation should define:

- tokenizer availability by provider/model family;
- local asset source, version, and license;
- deterministic fallback when a tokenizer is unavailable;
- Unicode and boundary-string regression coverage;
- behavior for lorebook prompt injection and knowledge retrieval budgets;
- app-size impact and whether tokenizer assets are optional downloads.

Until then, token counts shown or used for budgeting should be treated as
estimates, not provider-exact accounting.

## Provider-Aware Tokenizer Spike Note

This is a design note only. Do not implement tokenizer-backed estimation in this
PR.

Tokenizer support should be provider-aware instead of global. OpenAI-family,
Anthropic-family, Gemini-family, Mistral-family, Cohere-family,
OpenRouter-routed, NanoGPT-routed, xAI, custom OpenAI-compatible, local sidecar,
and future provider connections may not share a portable tokenizer asset or
boundary behavior. The estimator contract should accept provider and model
family metadata, select an exact tokenizer only when a maintained local asset is
available for that family, and otherwise keep the existing deterministic
heuristic.

Candidate tokenizer assets must be documented before bundling or downloading:

- upstream project or model-family source;
- exact version, checksum, and update cadence;
- license and redistribution terms;
- whether the asset covers the model family or only a specific model revision;
- whether the asset is bundled with the app, downloaded on demand, or supplied by
  the user.

Fallback behavior must stay deterministic and React-free. If no tokenizer is
available, if an optional tokenizer download fails, or if a provider/model is
unknown, prompt budgets should continue to use the current heuristic and label
the result as an estimate. The fallback must not silently mix a near-enough
tokenizer into budget enforcement.

Unicode coverage should include regression rows for ASCII, combining marks,
emoji with variation selectors, zero-width joiner emoji sequences, CJK text,
right-to-left text, mixed scripts, code blocks, long whitespace runs, prompt
separator strings, and model-specific boundary strings. Boundary tests should
verify that tokenizer selection does not change prompt assembly text or trim
instructions differently than the heuristic path.

Lorebook and knowledge budget behavior should remain conservative. Lorebook
prompt injection, recursive scanning budgets, knowledge retrieval budgets, and
agent load-cost displays should all call the same engine-owned estimation
contract so a provider-exact tokenizer improves accounting without moving budget
logic into React features or provider UI. When exact tokenization is unavailable,
these paths should preserve today's deterministic estimates and avoid false
precision in user-facing labels.

App-size impact should be measured before any implementation. Tokenizer assets
can be large, may need per-provider updates, and may complicate offline
distribution. The default release should avoid bundling broad tokenizer packs
unless the size, license, and maintenance cost are accepted explicitly. Optional
downloads or user-supplied assets are preferable for large or provider-specific
tokenizers, but they require clear offline fallback behavior and release-note
disclosure.
