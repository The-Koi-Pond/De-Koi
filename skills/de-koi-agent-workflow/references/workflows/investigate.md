# Investigation Workflow Card

Use this when the user reports a symptom, log, screenshot, confusing runtime behavior, or suspected regression but has not clearly asked for a code fix or issue filing.

## Core Loop

1. Capture expected behavior, actual behavior, repro steps, environment, data involved, and intermittency from screenshots, logs, local inspection, or code before asking questions.
2. Trace from the visible entrypoint through UI, hooks, routes, services, shared contracts, storage, prompt assembly, provider, or external capability as relevant.
3. For traces crossing roughly 5 or more files, keep a short local trace when it helps continuity. Do not store secrets, private user data, or bulky raw logs.
4. State the root cause or leading hypothesis, evidence, blast radius, likely files, core claim, and residual uncertainty before patching.
5. If the first assumption was wrong, say so plainly and revise the diagnosis instead of stacking patches.
6. Decide the lane: switch to bugfix when the bug is clear and the user wants it fixed; switch to feature-build when product intent is unclear; switch to issue-submission when GitHub needs a report first.

## Avoid

- Do not patch before diagnosis except for tiny mechanical mistakes.
- Do not quietly pivot when the diagnosis changes.
- Do not invent issue facts or claim screenshots/files are attached when they are not available.
