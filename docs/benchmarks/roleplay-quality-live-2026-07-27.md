# Roleplay prose quality live benchmark — 2026-07-27

## Scope

- Candidate branch: `fix/roleplay-prose-quality`
- Runtime: local De-Koi Rust server against an isolated copy of the app data
- Prompt preset: De-Koi Universal Preset V2
- Model: configured custom `gemini-3.5-flash` connection
- Entry point: the production `dryRunGeneration` path, including prompt assembly, local response analysis, the focused editor, and exact-span validation
- Safety: synthetic chats only; the source app data was not modified

## Diverse Roleplay matrix

Eight scenarios covered grounded noir dialogue, lyrical romance, dark horror, dry comedy, Spanish Roleplay, a four-character ensemble scene, a strict-agency choice, and adult-content boundaries.

| Result                                        | Count |
| --------------------------------------------- | ----: |
| Non-empty valid responses                     | 8 / 8 |
| Internal editor or analysis tags leaked       | 0 / 8 |
| Clean responses kept on one model call        | 7 / 8 |
| High-confidence response routed to the editor | 1 / 8 |
| Routed response safely corrected              | 1 / 1 |

The ensemble response assigned the user a deliberate lean and crossed-arm pose. The local checker detected it under strict agency, and the editor removed only that exact span while preserving the rest of the scene.

## Injected suspicious-response matrix

Five deterministic bad main responses were fed into the same production post-generation path while the configured model performed the focused edit.

| Case                                                            | Outcome                                                             |
| --------------------------------------------------------------- | ------------------------------------------------------------------- |
| User signs and speaks under strict agency                       | Corrected                                                           |
| Mixed-script malformed word                                     | Corrected                                                           |
| User deliberately leans under strict agency                     | Corrected                                                           |
| User deliberately grips an object under strict agency           | Corrected                                                           |
| User echo plus repetitive “not because … but because …” cadence | Editor returned unusable output after its retry; original preserved |

The final result was 4 / 5 repaired and 1 / 5 failed closed. No rejected editor output changed the original response.

## Environment findings

- The copied ChatGPT-auth connection referenced a model unsupported by that auth type.
- The copied NanoGPT connection depended on credentials outside the copied data directory.
- The custom connection completed the benchmark after it was selected as the agent default in the isolated copy.

## Known gap

The local strict-agency verb evidence is deliberately high precision and strongest in English. Non-English replies still receive Unicode corruption, echo, structural repetition, and other language-agnostic checks, but equivalent deliberate-action wording in every supported language is not exhaustively recognized without a model call on every turn.
