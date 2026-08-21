# Prompt and Generation Profile Contracts Design

## Goal

Make NanoGPT GLM-5.2 and LinkAPI Claude/Gemini generation profiles authoritative, provider-visible diagnostics truthful, and Conversation/roleplay prompts internally consistent and bounded.

## Design

Generation settings are resolved in three stages. Connection and prompt-preset defaults form the inherited layer. The maintained provider/model profile then applies its tested defaults and suppresses parameters that must not leak back from generic presets. Explicit chat and request parameters remain the final user-controlled layer. Provider-visible snapshots use the same OpenAI-compatible serialization rules as Rust, including custom LinkAPI routes, so omitted transport parameters are not reported as effective.

The LinkAPI Claude profile deliberately targets the existing OpenAI-compatible custom route. LinkAPI documents native Anthropic Messages as the route for adaptive thinking, so the current profile will omit unsupported reasoning and verbosity controls rather than guess at a payload. LinkAPI Gemini retains its maintained no-sampling profile.

Conversation group prompts use a neutral group role contract plus turn-specific speaker guidance. Automatic multi-speaker turns may write the selected characters; targeted and sequential turns write only the selected character. No shared base prompt claims that a list of all characters is one exclusive speaker.

Roleplay uses a 50-message default history tail while preserving explicit chat/request limits up to the existing 300-message ceiling. The universal preset defaults to SFW across every entrypoint, uses conservative generic output/reasoning defaults, and retains adult-dark as an explicit selectable option. Existing bundled adult, 8192-token, and maximum-reasoning defaults migrate to the safer values only when they still exactly match the prior bundle; custom values remain untouched.

Per-mode prose guidance remains a late system instruction but becomes positive and compact. Literal negative examples and duplicate lists of banned constructions are removed; dynamic repetition detection remains responsible for concrete phrases already repeating in history.

The startup default-data pass removes only the obsolete `providerMetadata.roleplayProsePilot` key from saved connections, preserving every other metadata field.

## Verification

Every behavior change receives a failing regression test first. Focused Vitest and Rust tests cover parameter precedence, LinkAPI/Nano serialization, prompt composition, roleplay history limits, preset defaults, and metadata migration. Final validation includes the focused suites, TypeScript checks, relevant Rust tests, deterministic repository checks, diff checks, and Bunny review.
